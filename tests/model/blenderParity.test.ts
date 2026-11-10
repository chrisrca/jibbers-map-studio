import { describe, expect, it } from "vitest";
import cases from "./blender/cases.json";
import reference from "./blender/reference.json";
import { applyModifier, evaluate, MODIFIERS, newModel, type Modifier } from "../../src/model/build";
import { unwrap, type Unwrap } from "../../src/model/uvEdit";
import { bevel, bevelVerts } from "../../src/model/bevel";
import { ek, edgesOf, faceCenter, primitive, recalcOutside, type Mesh, type PrimitiveId, type V3 } from "../../src/model/mesh";
import {
  bridge, duplicate, edgeLoop, edgeRing, extrudeEdges, extrudeFaces, extrudeVerts, fill, flip, inset, invertSel, linked, loopCut, merge, remove, selectLess, selectMore,
  selFromEdges, selFromFaces, selFromVerts, separate, shortestPath, shrinkFatten, smoothVerts, spin, subdivide, type DeleteKind, type MergeKind, type Sel, type SeparateKind,
} from "../../src/model/ops";

// Edit Mode's operations against Blender's own ( blender/cases.json, done in Blender by blender/make_reference.py into
// blender/reference.json ): the same mesh out, in the studio's coordinates ( Y up ). A reflection of Blender's, so its
// faces' corners run the other way round seen from the same side: by the right-hand rule, their normals are opposite.

type Where = [string, ">" | "<", number][];
type Step  = { sel?: Kind; add?: Kind; where?: Where; op?: string; [k: string]: unknown };
type Kind  = "verts" | "edges" | "faces";
// ( `app`: done through the editor itself, in the app ( selftest/model/blenderTransform.ts ), not here )
// ( `uvTurn`: UVs compared by which way they go round each face, not which corner starts: Blender's start is where its
// own mesh data happens to start )
type Case  = { name: string; prim: PrimitiveId; steps: Step[]; tolerance?: number; why?: string; app?: boolean; uv?: boolean; uvLoose?: boolean; uvTurn?: boolean };
type Picked = { v: V3[]; e: V3[]; f: V3[] };
type Ref    = { v: V3[]; f: number[][]; e: [number, number][]; sel?: Picked; parts?: number[][]; uv?: [V3, [number, number]][][] } | { error: string };

const CASES = ( cases as unknown as { cases: Case[] } ).cases;
const REF   = ( reference as unknown as { cases: Record<string, Ref> } ).cases;

// ( Blender's defaults for each, as make_reference.py adds them )
const OPTS: Partial<Record<PrimitiveId, Parameters<typeof primitive>[1]>> = { circle: { segments: 32 }, uvsphere: { segments: 32, rings: 16 }, icosphere: { rings: 2 }, cylinder: { segments: 32 }, cone: { segments: 32 }, grid: { segments: 10 } };

const holds = ( p: V3, where: Where ) => where.every( ( [a, op, v] ) => ( op === ">" ? p["xyz".indexOf( a )] > v : p["xyz".indexOf( a )] < v ) );
const mid   = ( g: Mesh, k: string ) => {
  const [a, b] = k.split( "_" ).map( Number );
  return g.v[a].map( ( x, i ) => ( x + g.v[b][i] ) / 2 ) as V3;
};

// ( the editor's select mode for a kind of element )
const MODE = { verts: "vert", edges: "edge", faces: "face" } as const;

/**
 * The case done with the studio's own operations ( as Edit Mode does them ): the mesh, and what's selected.
**/
function run( c: Case ): { g: Mesh; sel: Sel; parts?: Mesh[] } {
  let g: Mesh = primitive( c.prim, OPTS[c.prim] ?? {} );
  let sel: Sel = { v: new Set(), e: new Set(), f: new Set() };
  let kind: Kind = "verts";
  const pick = ( k: Kind, where: Where ) =>
    k === "verts" ? g.v.flatMap( ( p, i ) => ( holds( p, where ) ? [i] : [] ) )
    : k === "edges" ? [...edgesOf( g ).keys()].filter( ( e ) => holds( mid( g, e ), where ) )
    : g.f.flatMap( ( _, i ) => ( holds( faceCenter( g, i ), where ) ? [i] : [] ) );
  const selOf = ( k: Kind, items: ( number | string )[] ) => ( k === "verts" ? selFromVerts( g, items as number[] ) : k === "edges" ? selFromEdges( g, items as string[] ) : selFromFaces( g, items as number[] ) );
  const mods: Modifier[] = [];
  let parts: Mesh[] | undefined;
  for ( const s of c.steps ) {
    if ( s.sel ) {
      kind = s.sel;
      sel  = selOf( kind, pick( kind, s.where! ) );
      continue;
    }
    if ( s.add ) {
      kind     = s.add;
      const was = kind === "verts" ? [...sel.v] : kind === "edges" ? [...sel.e] : [...sel.f];
      sel       = selOf( kind, [...was, ...pick( kind, s.where! )] as ( number | string )[] );
      continue;
    }
    const keep = ( r: { mesh: Mesh; sel: Sel } ) => { g = r.mesh; sel = r.sel; };
    switch ( s.op ) {
      case "extrude": keep( kind === "faces" ? extrudeFaces( g, sel.f ) : kind === "edges" ? extrudeEdges( g, sel.e ) : extrudeVerts( g, sel.v ) ); break;
      case "move": {
        const by = s.by as V3;
        g        = { ...g, v: g.v.map( ( p, i ) => ( sel.v.has( i ) ? ( p.map( ( x, k ) => x + by[k] ) as V3 ) : p ) ) };
        break;
      }
      case "inset": keep( inset( g, sel.f, s.thickness as number, ( s.depth as number ) ?? 0, !!s.individual ) ); break;
      case "bevel": keep( s.verts ? bevelVerts( g, sel.v, s.width as number ) : bevel( g, sel.e, s.width as number, s.segments as number ) ); break;
      case "loopcut": {
        const e = [...edgesOf( g ).keys()].find( ( k ) => holds( mid( g, k ), s.edge as Where ) )!;
        keep( loopCut( g, e, s.cuts as number, 0 ) );
        break;
      }
      case "subdivide": keep( subdivide( g, sel.f ) ); break;
      case "merge": keep( merge( g, [...sel.v], s.kind as MergeKind, ( s.distance as number ) ?? 0.0001, s.kind === "collapse" && kind !== "verts" ? sel.e : undefined ) ); break;
      case "delete": keep( remove( g, sel, s.kind as DeleteKind ) ); break;
      case "fill": keep( fill( g, [...sel.v] ) ); break;
      case "bridge": keep( bridge( g, sel.e ) ); break;
      // ( Blender's Spin turns clockwise seen from the axis: in its mirror, the piece's coordinates, counter-clockwise )
      case "spin": keep( spin( g, sel, s.center as V3, s.axis as V3, ( ( s.deg as number ) * Math.PI ) / 180, s.steps as number ) ); break;
      case "smooth": keep( smoothVerts( g, sel.v, s.factor as number, s.repeat as number ) ); break;
      case "shrinkfatten": keep( shrinkFatten( g, sel.v, s.d as number ) ); break;
      case "flip": g = flip( g, sel.f ); break;
      case "recalc": g = recalcOutside( g, sel.f.size ? sel.f : undefined ); break;
      case "duplicate": keep( duplicate( g, sel ) ); break;
      case "crease": g = { ...g, c: { ...g.c, ...Object.fromEntries( [...sel.e].map( ( k ) => [k, s.value as number] ) ) } }; break;
      // ( a modifier applied: made part of the mesh as if first, gone from the list )
      case "apply": {
        const i = s.index as number;
        g       = applyModifier( { ...newModel( g ), modifiers: mods }, i ).mesh;
        mods.splice( i, 1 );
        break;
      }
      case "separate": {
        const r = separate( g, s.kind as SeparateKind, sel );
        parts   = [r.rest, ...r.parts];
        break;
      }
      case "uv": g = unwrap( g, sel.f, s.kind as Unwrap ); break;
      case "materials": g = { ...g, m: g.f.map( ( _, i ) => ( holds( faceCenter( g, i ), s.where as Where ) ? 1 : 0 ) ) }; break;
      case "selmore": sel = selectMore( g, sel, MODE[kind] ); break;
      case "selless": sel = selectLess( g, sel, MODE[kind] ); break;
      case "invert": sel = invertSel( g, sel, MODE[kind] ); break;
      // ( Ctrl+L, as the editor does it )
      case "linked": {
        const s2 = selFromVerts( g, linked( g, sel.v ) );
        sel      = kind === "faces" ? selFromFaces( g, s2.f ) : s2;
        break;
      }
      case "edgeloop": sel = selFromEdges( g, [...sel.e].flatMap( ( k ) => edgeLoop( g, k ) ) ); break;
      case "edgering": sel = selFromEdges( g, [...sel.e].flatMap( ( k ) => edgeRing( g, k ).ring.map( ( [a, b] ) => ek( a, b ) ) ) ); break;
      case "path": {
        const ends = kind === "verts" ? [...sel.v] : kind === "edges" ? [...sel.e] : [...sel.f];
        const way  = shortestPath( g, ends[0], ends[1], MODE[kind] );
        sel        = kind === "verts" ? selFromVerts( g, [...sel.v, ...( way as number[] )] ) : kind === "edges" ? selFromEdges( g, [...sel.e, ...( way as string[] )] ) : selFromFaces( g, [...sel.f, ...( way as number[] )] );
        break;
      }
      // ( a select mode switched: as the editor converts )
      case "mode": {
        kind = s.to as Kind;
        sel  = kind === "faces" ? selFromFaces( g, sel.f ) : kind === "edges" ? selFromEdges( g, sel.e ) : selFromVerts( g, sel.v );
        break;
      }
      case "modifier": {
        const make = MODIFIERS.find( ( m ) => m.type === s.type )!.make();
        const m    = { ...make, ...( s.type === "subsurf" ? { levels: s.levels } : s.type === "array" ? { count: s.count } : s.type === "solidify" ? { thickness: s.thickness } : s.type === "bevel" ? { width: s.width, segments: s.segments, angle: s.angle } : {} ) } as Modifier;
        mods.push( m );
        break;
      }
      default: throw new Error( `no ${s.op}` );
    }
  }
  return { g: mods.length ? evaluate( { ...newModel( g ), modifiers: mods } ) : g, sel, parts };
}

/**
 * How what the studio has selected differs from Blender's: vertices by where they are, edges by their middles, faces
 * by their centres.
**/
function selDifferences( g: Mesh, sel: Sel, ref: Picked ): string[] {
  const key   = ( p: V3 ) => p.map( ( x ) => ( Math.round( x * 1e3 ) / 1e3 + 0 ).toFixed( 3 ) ).join( "," );
  const mine  = {
    v: [...sel.v].map( ( i ) => g.v[i] ),
    e: [...sel.e].map( ( k ) => mid( g, k ) ),
    f: [...sel.f].map( ( i ) => faceCenter( g, i ) ),
  };
  return ( ["v", "e", "f"] as const ).flatMap( ( t ) => {
    const a = new Set( mine[t].map( key ) ), b = new Set( ref[t].map( key ) );
    const missing = [...b].filter( ( k ) => !a.has( k ) ).length, more = [...a].filter( ( k ) => !b.has( k ) ).length;
    const name    = { v: "vertices", e: "edges", f: "faces" }[t];
    return missing || more ? [`${name} selected: ${a.size}, Blender ${b.size} ( ${missing} of Blender's not, ${more} not Blender's )`] : [];
  } );
}

// ( a face's normal by the right-hand rule ( Newell's ), and its corners as a key )
const nrm  = ( vs: V3[], f: number[] ) => {
  const n: V3 = [0, 0, 0];
  for ( let i = 0; i < f.length; i++ ) {
    const a = vs[f[i]], b = vs[f[( i + 1 ) % f.length]];
    n[0] += ( a[1] - b[1] ) * ( a[2] + b[2] );
    n[1] += ( a[2] - b[2] ) * ( a[0] + b[0] );
    n[2] += ( a[0] - b[0] ) * ( a[1] + b[1] );
  }
  const l = Math.hypot( ...n ) || 1;
  return n.map( ( x ) => x / l ) as V3;
};
const fkey = ( f: number[] ) => [...f].sort( ( a, b ) => a - b ).join( "," );

/**
 * Whether two sets of faces on the same points make the same flat patches ( neighbours in one plane joined ): flat
 * quads cut the other way across are the same surface.
**/
function samePatches( v: V3[], fa: number[][], fb: number[][] ) {
  const patches = ( f: number[][] ) => {
    const up   = f.map( ( _, i ) => i ), n = f.map( ( x ) => nrm( v, x ) );
    const find = ( i: number ): number => ( up[i] === i ? i : ( up[i] = find( up[i] ) ) );
    const by   = new Map<string, number>();
    f.forEach( ( x, i ) => x.forEach( ( a, k ) => {
      const e = ek( a, x[( k + 1 ) % x.length] ), j = by.get( e );
      if ( j === undefined ) by.set( e, i );
      else if ( Math.abs( n[i].reduce( ( s, c, m ) => s + c * n[j][m], 0 ) ) > 1 - 1e-6 ) up[find( i )] = find( j );
    } ) );
    const got = new Map<number, Set<number>>();
    f.forEach( ( x, i ) => x.forEach( ( a ) => ( got.get( find( i ) ) ?? got.set( find( i ), new Set() ).get( find( i ) )! ).add( a ) ) );
    return [...got.values()].map( ( s ) => fkey( [...s] ) ).sort().join( " " );
  };
  return patches( fa ) === patches( fb );
}

/**
 * How the studio's UVs differ from Blender's: each face's corners, by where they are, given the same u, v ( so the
 * texture lies on it the same way ).
**/
function uvDifferences( g: Mesh, ref: [V3, [number, number]][][], turn = false ): string[] {
  const at   = ( p: V3 ) => p.map( ( x ) => x.toFixed( 3 ) ).join( "," );
  const mine = new Map<string, Map<string, [number, number]>>();
  g.f.forEach( ( f, fi ) => {
    const uv = g.u?.[fi] ?? [], corners = new Map<string, [number, number]>();
    f.forEach( ( v, k ) => corners.set( at( g.v[v] ), [uv[k * 2], uv[k * 2 + 1]] ) );
    mine.set( [...corners.keys()].sort().join( "|" ), corners );
  } );
  let off = 0, faces = 0;
  for ( const face of ref ) {
    const corners = mine.get( face.map( ( [p] ) => at( p ) ).sort().join( "|" ) );
    if ( !corners ) { faces++; continue; }
    // ( the face's UVs in Blender's order round it, and the studio's at the same corners: the same, or turned round )
    const want = face.map( ( [, uv] ) => uv ), got = face.map( ( [p] ) => corners.get( at( p ) ) ?? [NaN, NaN] );
    const by   = ( s: number ) => Math.max( ...want.map( ( w, k ) => Math.hypot( got[( k + s ) % got.length][0] - w[0], got[( k + s ) % got.length][1] - w[1] ) ) );
    off        = Math.max( off, turn ? Math.min( ...want.map( ( _, s ) => by( s ) ) ) : by( 0 ) );
  }
  return [...( faces ? [`${faces} of Blender's faces not found`] : [] ), ...( off > 1e-3 ? [`UVs off by up to ${off.toFixed( 4 )}`] : [] )];
}

/**
 * What any unwrap must give, as Blender's Smart UV Project does: every face laid out, inside the texture, nowhere on top
 * of another ( a fine grid's cells each covered once at most ).
**/
function uvSound( g: Mesh ): string[] {
  const out: string[] = [];
  if ( g.f.some( ( f, i ) => ( g.u?.[i]?.length ?? 0 ) !== f.length * 2 ) ) out.push( "faces without UVs" );
  const all = ( g.u ?? [] ).flat();
  if ( all.some( ( x ) => x < -1e-6 || x > 1 + 1e-6 ) ) out.push( "UVs outside 0..1" );
  const N = 200, cover = new Uint8Array( N * N );
  const inTri = ( px: number, py: number, a: number[], b: number[], c: number[] ) => {
    const d1 = ( px - b[0] ) * ( a[1] - b[1] ) - ( a[0] - b[0] ) * ( py - b[1] ), d2 = ( px - c[0] ) * ( b[1] - c[1] ) - ( b[0] - c[0] ) * ( py - c[1] ), d3 = ( px - a[0] ) * ( c[1] - a[1] ) - ( c[0] - a[0] ) * ( py - a[1] );
    return !( ( d1 < 0 || d2 < 0 || d3 < 0 ) && ( d1 > 0 || d2 > 0 || d3 > 0 ) );
  };
  let twice = 0;
  g.f.forEach( ( f, fi ) => {
    const uv  = g.u?.[fi] ?? [], pts = f.map( ( _, k ) => [uv[k * 2], uv[k * 2 + 1]] );
    const hit = new Uint8Array( N * N );
    for ( let k = 1; k + 1 < pts.length; k++ ) {
      const [a, b, c] = [pts[0], pts[k], pts[k + 1]];
      const x0 = Math.max( 0, Math.floor( Math.min( a[0], b[0], c[0] ) * N ) ), x1 = Math.min( N - 1, Math.ceil( Math.max( a[0], b[0], c[0] ) * N ) );
      const y0 = Math.max( 0, Math.floor( Math.min( a[1], b[1], c[1] ) * N ) ), y1 = Math.min( N - 1, Math.ceil( Math.max( a[1], b[1], c[1] ) * N ) );
      for ( let y = y0; y <= y1; y++ ) for ( let x = x0; x <= x1; x++ ) if ( inTri( ( x + 0.5 ) / N, ( y + 0.5 ) / N, a, b, c ) ) hit[y * N + x] = 1;
    }
    for ( let i = 0; i < N * N; i++ ) if ( hit[i] ) { if ( cover[i] ) twice++; cover[i] = 1; }
  } );
  if ( twice > N * N * 0.002 ) out.push( `faces on top of each other ( ${twice} cells of ${N * N} covered twice )` );
  return out;
}

/**
 * How the studio's mesh differs from Blender's: counts, points, faces ( by their corners ), which way faces point.
**/
function differences( g: Mesh, ref: { v: V3[]; f: number[][]; e: [number, number][] }, tol = 1e-3 ): string[] {
  const out: string[] = [];
  const edges         = new Set( [...edgesOf( g ).keys(), ...g.w.map( ( [a, b] ) => ek( a, b ) )] ).size;
  const counts        = ( v: number, e: number, f: number ) => `${v} vertices, ${e} edges, ${f} faces`;
  if ( g.v.length !== ref.v.length || edges !== ref.e.length || g.f.length !== ref.f.length ) out.push( `${counts( g.v.length, edges, g.f.length )}; Blender ${counts( ref.v.length, ref.e.length, ref.f.length )}` );
  const nearest = ( p: V3, in_: V3[] ) => {
    let best = -1, d = Infinity;
    in_.forEach( ( q, i ) => {
      const e = Math.hypot( p[0] - q[0], p[1] - q[1], p[2] - q[2] );
      if ( e < d ) { d = e; best = i; }
    } );
    return { i: best, d };
  };
  const far   = Math.max( 0, ...ref.v.map( ( p ) => nearest( p, g.v ).d ) ), extra = Math.max( 0, ...g.v.map( ( p ) => nearest( p, ref.v ).d ) );
  if ( far > tol || extra > tol ) out.push( `points off by up to ${far.toFixed( 4 )} m ( Blender's from the studio's ), ${extra.toFixed( 4 )} m ( the studio's from Blender's )` );
  else {
    // ( the studio's faces on Blender's points, each corner the one where it is: points in one place as one )
    const canon   = ref.v.map( ( p ) => ref.v.findIndex( ( q ) => Math.hypot( p[0] - q[0], p[1] - q[1], p[2] - q[2] ) < 1e-4 ) );
    const to      = g.v.map( ( p ) => canon[nearest( p, ref.v ).i] );
    const faces   = g.f.map( ( f ) => f.map( ( i ) => to[i] ) ), refFaces = ref.f.map( ( f ) => f.map( ( i ) => canon[i] ) );
    const mine    = new Map( faces.map( ( f ) => [fkey( f ), f] ) ), theirs = new Map( refFaces.map( ( f ) => [fkey( f ), f] ) );
    const missing = [...theirs.keys()].filter( ( k ) => !mine.has( k ) ).length, more = [...mine.keys()].filter( ( k ) => !theirs.has( k ) ).length;
    if ( ( missing || more ) && !samePatches( ref.v, faces, refFaces ) ) out.push( `faces: ${missing} of Blender's not made, ${more} not Blender's` );
    const wrong = [...theirs].filter( ( [k, f] ) => mine.has( k ) && nrm( ref.v, mine.get( k )! ).reduce( ( s, x, i ) => s + x * nrm( ref.v, f )[i], 0 ) > -0.9 ).length;
    if ( wrong ) out.push( `${wrong} faces facing the other way` );
  }
  return out;
}

describe( "Edit Mode as Blender does it", () => {
  for ( const c of CASES.filter( ( x ) => !x.app ) ) {
    it( c.name, () => {
      const ref = REF[c.name];
      expect( ref && !( "error" in ref ), `Blender's: ${ref && "error" in ref ? ref.error : "none"}` ).toBe( true );
      // ( a case Blender's does a little differently says so, and by how much )
      const r = ref as { v: V3[]; f: number[][]; e: [number, number][]; sel?: Picked; parts?: number[][]; uv?: [V3, [number, number]][][] }, got = run( c );
      // ( a separate: each mesh it leaves, by its counts )
      if ( r.parts ) {
        const counts = ( m: Mesh ) => [m.v.length, new Set( [...edgesOf( m ).keys(), ...m.w.map( ( [a, b] ) => ek( a, b ) )] ).size, m.f.length];
        expect( ( got.parts ?? [got.g] ).map( counts ).sort( ( a, b ) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] ) ).toEqual( r.parts );
        return;
      }
      // ( UVs: as Blender's, corner for corner; a Smart UV Project, as any unwrap must be )
      const uvs = c.uvLoose ? uvSound( got.g ) : r.uv ? uvDifferences( got.g, r.uv, c.uvTurn ) : [];
      expect( [...differences( got.g, r, c.tolerance ), ...( r.sel ? selDifferences( got.g, got.sel, r.sel ) : [] ), ...uvs] ).toEqual( [] );
    } );
  }
} );
