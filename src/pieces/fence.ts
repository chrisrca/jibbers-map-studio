// Fences ( the fence builder ): a path of points over the ground, posts along it ( one at every point, the rest spaced
// evenly between ), and what's between the posts: rails, a net, ropes hanging between them, panels, or nothing. Made
// from a piece of your own ( one section of fence, sectionFence ): that section repeated along the path, one between
// every two posts ( spaced its length ), each standing on the ground at both its ends, tilted with the slope.
// Everything follows the ground: each post stands where the ground is, sunk into it a little, and what's between runs
// from post to post. The fence is one piece, made again from its path and style whenever either changes: a modelled
// piece ( posts, rails, ropes and nets made as its mesh: posts in one material, rails and ropes in another, the net in
// a third, see-through ), with any piece of the map used for its posts or its panels copied along it beside that
// ( "kit" parts, and their colliders ). Grindable, its top rail ( or rope, or the line over its posts ) is its rail.

import { toThree, toUnity, type V3 } from "../core/coords";
import { pieceMatrix, transformCustom, composeUnity } from "../core/transform";
import { xyz, type CustomCollider, type CustomMaterial, type CustomObjectEntry, type CustomPart } from "../core/types";
import { type Mesh } from "../model/mesh";
import { evaluate, joinMeshes, newModel } from "../model/build";
import { defaultMaterial, isModel, newModelObject, withModel } from "../model/objects";
import { toPiece, toView, withRail } from "./rail";

export interface FenceStyle {
  // the most metres between two posts
  spacing: number;
  post: {
    kind:   "round" | "square" | "none" | "piece";
    // a round post's radius, a square one's half width ( metres )
    size:   number;
    height: number;
    // metres into the ground
    sink:   number;
    // "piece": the map's piece copied for every post
    piece?: string;
  };
  infill: {
    kind:    "rails" | "net" | "rope" | "panel" | "none";
    // rails and ropes: their heights over the ground
    heights: number[];
    profile: "round" | "square" | "flat";
    // a rail's or rope's radius ( a flat rail's half height, its half thickness a fifth of it )
    size:    number;
    // ropes: how far they hang down mid-way; nets: how far the net's bottom and top are over the ground
    sag:     number;
    bottom:  number;
    top:     number;
    // "panel": the map's piece fitted into every gap, its length along its own X ( `section`: a copy of it kept with
    // the fence, along +X, its middle at the origin, its foot at 0: the piece itself can go; `sectionMesh`: a piece
    // modelled here, its mesh and materials so, made part of the fence's own mesh )
    piece?:       string;
    length?:      number;
    section?:     CustomObjectEntry;
    sectionMesh?: { mesh: Mesh; materials: CustomMaterial[] };
  };
  // the colours of the posts, the rails or ropes, the net ( sRGB 0..1 ) and how see-through the net is
  postColour:  [number, number, number];
  railColour:  [number, number, number];
  netColour:   [number, number, number];
  netOpacity:  number;
  // the top rail ( rope, the line over the posts ) can be ground
  grind:       boolean;
}

export interface FenceData {
  // the path, in the fence's own XZ, and how far each point stands over the ground ( metres; under it, less than 0 )
  points: [number, number][];
  lift?:  number[];
  closed: boolean;
  style:  FenceStyle;
}

// A repeat ( Make Repeat ): a fence of a section of your own. It rides as the piece it was made of ( its surface and
// rail its own, as any piece's ), where a fence made here is ground along its top if it's grindable.
export const isRepeat = ( f: FenceData | null ) => !!f && f.style.infill.kind === "panel" && !!( f.style.infill.section || f.style.infill.sectionMesh );

// how far a fence's point `i` stands over the ground
export const liftAt = ( f: FenceData, i: number ) => f.lift?.[i] ?? 0;

const ROAD: FenceStyle = {
  spacing: 2.4, post: { kind: "square", size: 0.06, height: 1.1, sink: 0.3 },
  infill:  { kind: "rails", heights: [0.45, 0.95], profile: "flat", size: 0.08, sag: 0, bottom: 0, top: 1 },
  postColour: [0.42, 0.29, 0.18], railColour: [0.52, 0.37, 0.24], netColour: [1, 0.45, 0.1], netOpacity: 0.7, grind: true,
};

export const FENCE_PRESETS: { name: string; style: FenceStyle }[] = [
  { name: "Wooden roadside", style: ROAD },
  { name: "Crowd barrier",   style: { ...ROAD, spacing: 2, post: { kind: "square", size: 0.03, height: 1.1, sink: 0.05 }, infill: { ...ROAD.infill, profile: "round", size: 0.025, heights: [0.15, 1.05] }, postColour: [0.55, 0.57, 0.6], railColour: [0.62, 0.64, 0.67] } },
  { name: "Safety net",      style: { ...ROAD, spacing: 3, post: { kind: "round", size: 0.035, height: 1.8, sink: 0.4 }, infill: { ...ROAD.infill, kind: "net", bottom: 0.05, top: 1.75 }, postColour: [0.2, 0.2, 0.2] } },
  { name: "Rope line",       style: { ...ROAD, spacing: 4, post: { kind: "round", size: 0.025, height: 1.2, sink: 0.4 }, infill: { ...ROAD.infill, kind: "rope", heights: [1], profile: "round", size: 0.012, sag: 0.15 }, postColour: [0.95, 0.75, 0.1], railColour: [0.15, 0.15, 0.15] } },
  { name: "Chain",           style: { ...ROAD, spacing: 2.5, post: { kind: "round", size: 0.05, height: 0.9, sink: 0.3 }, infill: { ...ROAD.infill, kind: "rope", heights: [0.75], profile: "round", size: 0.02, sag: 0.25 }, postColour: [0.75, 0.75, 0.75], railColour: [0.3, 0.3, 0.32] } },
];

export const fenceOf = ( o: CustomObjectEntry ) => ( o as { fence?: FenceData } ).fence ?? null;

/**
 * Where the posts go, in the fence's own XZ: a post at every point, and between two points as many more as keep them
 * no more than `spacing` apart ( `nearest`: as near it as can be ), spread evenly; a closed fence's last gap back to
 * its first post.
**/
export function postSpots( points: [number, number][], closed: boolean, spacing: number, nearest = false ): [number, number][] {
  return liftedSpots( points, [], closed, spacing, nearest ).map( ( p ) => p.at );
}

/**
 * The posts' places as postSpots has them, each with how far it stands over the ground ( `lift`, a point's each; those
 * between two points as far along from one's to the other's ).
**/
function liftedSpots( points: [number, number][], lift: number[], closed: boolean, spacing: number, nearest: boolean ) {
  const out: { at: [number, number]; lift: number }[] = [];
  const n = points.length, gaps = closed && n > 2 ? n : n - 1, up = ( i: number ) => lift[i] ?? 0;
  if ( !n ) return out;
  for ( let i = 0; i < gaps; i++ ) {
    const a = points[i], b = points[( i + 1 ) % n], q = Math.hypot( b[0] - a[0], b[1] - a[1] ) / Math.max( 0.2, spacing ), k = Math.max( 1, nearest ? Math.round( q ) : Math.ceil( q - 1e-9 ) );
    for ( let j = 0; j < k; j++ ) out.push( { at: [a[0] + ( ( b[0] - a[0] ) * j ) / k, a[1] + ( ( b[1] - a[1] ) * j ) / k], lift: up( i ) + ( ( up( ( i + 1 ) % n ) - up( i ) ) * j ) / k } );
  }
  if ( !( closed && n > 2 ) ) out.push( { at: points[n - 1], lift: up( n - 1 ) } );
  return out;
}

// ---------------------------------------------------------------- the mesh

const add   = ( a: V3, b: V3 ): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub   = ( a: V3, b: V3 ): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul   = ( a: V3, k: number ): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = ( a: V3, b: V3 ): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm  = ( a: V3 ): V3 => { const l = Math.hypot( a[0], a[1], a[2] ) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * A closed prism from `a` to `b`: round ( 8 sides ), square ( `r` each way ) or flat ( `r` wide, a fifth of it thick ),
 * its faces in material slot `slot`.
**/
function prism( a: V3, b: V3, profile: "round" | "square" | "flat", r: number, slot: number ): Mesh {
  const d                        = norm( sub( b, a ) );
  const side                     = norm( Math.abs( d[1] ) > 0.95 ? cross( [0, 0, 1], d ) : cross( [0, 1, 0], d ) ), up = cross( d, side );
  const ring: [number, number][] = profile === "round"
    ? Array.from( { length: 8 }, ( _, k ) => [Math.cos( ( k * Math.PI ) / 4 ) * r, Math.sin( ( k * Math.PI ) / 4 ) * r] )
    : profile === "flat" ? [[-r / 5, -r], [r / 5, -r], [r / 5, r], [-r / 5, r]] : [[-r, -r], [r, -r], [r, r], [-r, r]];
  const at            = ( c: V3, [u, w]: [number, number] ) => add( c, add( mul( side, u ), mul( up, w ) ) );
  const v             = [...ring.map( ( q ) => at( a, q ) ), ...ring.map( ( q ) => at( b, q ) )], n = ring.length;
  const f: number[][] = ring.map( ( _, k ) => [k, ( k + 1 ) % n, n + ( ( k + 1 ) % n ), n + k] );
  f.push( ring.map( ( _, k ) => n - 1 - k ), ring.map( ( _, k ) => n + k ) );
  const g = { v, f, m: f.map( () => slot ), s: f.map( ( _, k ) => profile === "round" && k < n ), w: [] as [number, number][] };
  return outward( g );
}

/**
 * A prism's faces turned to face out: they're all wound the one way, so one side face tells which ( a whole-mesh
 * recalcOutside for each post and rail was most of the time a fence took to make ).
**/
function outward( g: Mesh ): Mesh {
  const c = g.v.reduce( ( s, p ) => add( s, p ), [0, 0, 0] as V3 ).map( ( x ) => x / g.v.length ) as V3;
  const f = g.f[0], a = g.v[f[0]], b = g.v[f[1]], d = g.v[f[2]];
  const n = cross( sub( b, a ), sub( d, a ) );
  const m = f.reduce( ( s, i ) => add( s, g.v[i] ), [0, 0, 0] as V3 ).map( ( x ) => x / f.length ) as V3;
  const o = sub( m, c );
  return n[0] * o[0] + n[1] * o[1] + n[2] * o[2] >= 0 ? g : { ...g, f: g.f.map( ( q ) => [...q].reverse() ) };
}

/**
 * Meshes put together into one.
**/
function joined( list: Mesh[] ): Mesh {
  const out: Mesh = { v: [], f: [], m: [], s: [], w: [] };
  for ( const g of list ) {
    const o = out.v.length;
    out.v.push( ...g.v );
    out.f.push( ...g.f.map( ( f ) => f.map( ( i ) => i + o ) ) );
    out.m.push( ...g.m );
    out.s.push( ...g.s );
  }
  return out;
}

export interface FenceShape {
  mesh:  Mesh;
  // the posts' feet ( the fence's own space ) and which way the fence runs there ( a unit XZ )
  posts: { at: V3; dir: [number, number] }[];
  // the line that's ground, and how thick
  rail:  V3[] | null;
  radius: number;
}

/**
 * The fence's mesh worked out over the ground ( `groundAt`: a point of the fence's own XZ → the ground's height under
 * it, in the fence's own space; NaN: none, the fence's own level then ).
**/
export function fenceShape( f: FenceData, groundAt: ( x: number, z: number ) => number ): FenceShape {
  const s             = f.style;
  // ( panels: as many as come nearest their own length, stretched or squashed a little; else never further apart )
  const spots         = liftedSpots( f.points, f.lift ?? [], f.closed, s.spacing, s.infill.kind === "panel" );
  const feet          = spots.map( ( { at: [x, z], lift } ): V3 => { const y = groundAt( x, z ); return [x, ( Number.isNaN( y ) ? 0 : y ) + lift, z]; } );
  const loop          = f.closed && f.points.length > 2;
  const gaps          = feet.map( ( a, i ) => ( i + 1 < feet.length ? [a, feet[i + 1]] : loop ? [a, feet[0]] : null ) ).filter( ( g ): g is V3[] => !!g );
  const parts: Mesh[] = [];
  // the posts ( a piece's posts are kit parts, not mesh )
  if ( s.post.kind === "round" || s.post.kind === "square" )
    for ( const p of feet ) parts.push( prism( [p[0], p[1] - s.post.sink, p[2]], [p[0], p[1] + s.post.height, p[2]], s.post.kind, s.post.size, 0 ) );
  const inf             = s.infill;
  let rail: V3[] | null = null, radius = Math.max( 0.02, inf.size );
  if ( inf.kind === "rails" ) {
    for ( const h of inf.heights ) for ( const [a, b] of gaps ) parts.push( prism( [a[0], a[1] + h, a[2]], [b[0], b[1] + h, b[2]], inf.profile, inf.size, 1 ) );
    const top = Math.max( ...inf.heights );
    rail      = [...feet.map( ( p ): V3 => [p[0], p[1] + top, p[2]] ), ...( loop ? [[feet[0][0], feet[0][1] + top, feet[0][2]] as V3] : [] )];
  } else if ( inf.kind === "rope" ) {
    // each gap a curve hanging between the posts ( a parabola: as near a chain's as the eye can tell ), 8 pieces
    const line: V3[] = [];
    for ( const h of inf.heights )
      for ( const [a, b] of gaps ) {
        const at = ( t: number ): V3 => [a[0] + ( b[0] - a[0] ) * t, a[1] + ( b[1] - a[1] ) * t + h - inf.sag * 4 * t * ( 1 - t ), a[2] + ( b[2] - a[2] ) * t];
        for ( let k = 0; k < 8; k++ ) {
          parts.push( prism( at( k / 8 ), at( ( k + 1 ) / 8 ), "round", inf.size, 1 ) );
          if ( h === Math.max( ...inf.heights ) ) line.push( at( k / 8 ) );
        }
        if ( h === Math.max( ...inf.heights ) && gaps[gaps.length - 1][1] === b ) line.push( at( 1 ) );
      }
    rail = line;
  } else if ( inf.kind === "net" ) {
    for ( const [a, b] of gaps ) {
      const g = { v: [[a[0], a[1] + inf.bottom, a[2]], [b[0], b[1] + inf.bottom, b[2]], [b[0], b[1] + inf.top, b[2]], [a[0], a[1] + inf.top, a[2]]] as V3[], f: [[0, 1, 2, 3]], m: [2], s: [false], w: [] as [number, number][] };
      parts.push( g );
    }
  }
  if ( !rail && feet.length > 1 ) {
    const top = inf.kind === "net" ? inf.top : s.post.height;
    rail      = [...feet.map( ( p ): V3 => [p[0], p[1] + top, p[2]] ), ...( loop ? [[feet[0][0], feet[0][1] + top, feet[0][2]] as V3] : [] )];
    radius    = Math.max( 0.03, s.post.size );
  }
  const posts = feet.map( ( p, i ) => {
    const a = feet[Math.max( 0, i - 1 )], b = feet[Math.min( feet.length - 1, i + 1 )], d = Math.hypot( b[0] - a[0], b[2] - a[2] ) || 1;
    return { at: p, dir: [( b[0] - a[0] ) / d, ( b[2] - a[2] ) / d] as [number, number] };
  } );
  return { mesh: joined( parts ), posts, rail, radius };
}

// ---------------------------------------------------------------- the piece

const material = ( c: [number, number, number], alpha = 1 ): CustomMaterial => {
  const m = defaultMaterial();
  return alpha < 1
    ? { ...m, base_color: { r: c[0], g: c[1], b: c[2], a: alpha }, render_mode: 2, cull_mode: 0 }
    : { ...m, base_color: { r: c[0], g: c[1], b: c[2], a: 1 } };
};

/**
 * A new fence at `at` ( Unity, world ) along `points` ( its own XZ, from there ).
**/
export function newFence( uid: string, at: V3, points: [number, number][], style: FenceStyle = ROAD ): CustomObjectEntry {
  const o = newModelObject( uid, { v: [], f: [], m: [], s: [], w: [] }, at );
  return { ...o, fence: { points, closed: false, style } } as CustomObjectEntry;
}

/**
 * A section's space ( along +X, its middle foot at the origin, `length` long ) laid from foot `a` to foot `b` ( the
 * fence's own space ): stretched to reach, turned to run that way, tilted up or down the slope; as a kit part's copied.
**/
function sectionFrame( a: V3, b: V3, length: number ) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], d = Math.hypot( dx, dz ), run = Math.hypot( d, dy );
  const k  = run / Math.max( 0.05, length );
  // ( along: the way to b; side: level, square to it, where Unity's yaw turns +Z; up: square to both )
  const along: V3 = [dx / run, dy / run, dz / run], side: V3 = [-dz / d, 0, dx / d];
  const up: V3    = [side[1] * along[2] - side[2] * along[1], side[2] * along[0] - side[0] * along[2], side[0] * along[1] - side[1] * along[0]];
  const mid: V3   = [( a[0] + b[0] ) / 2, ( a[1] + b[1] ) / 2, ( a[2] + b[2] ) / 2];
  return ( [x, y, z]: V3 ): V3 => [0, 1, 2].map( ( i ) => mid[i] + along[i] * x * k + up[i] * y + side[i] * z ) as V3;
}

/**
 * The fence made again from its path and style over the ground ( `ground`: Unity world x, z → the height, NaN off the
 * terrain ); `pieceOf` finds the map's piece a style copies for its posts or panels.
**/
export function withFence( o: CustomObjectEntry, ground: ( x: number, z: number ) => number, pieceOf: ( uid: string ) => CustomObjectEntry | undefined, quick = false ): CustomObjectEntry {
  const f = fenceOf( o );
  if ( !f ) return o;
  // a point of the fence's own XZ → the ground under it, in its own space
  const groundAt = ( x: number, z: number ) => {
    const w = toUnity( toView( o, [x, 0, z] ) ), y = ground( w[0], w[2] );
    return Number.isNaN( y ) ? NaN : toPiece( o, toThree( [w[0], y, w[2]] ) )[1];
  };
  const shape = fenceShape( f, groundAt ), s = f.style, own = s.infill.kind === "panel" ? s.infill.sectionMesh : undefined;
  // ( a repeat's materials its piece's alone; a fence made here: its posts', rails' and net's )
  const made  = isRepeat( f ) ? [] : [material( s.postColour ), material( s.railColour ), material( s.netColour, s.netOpacity )];
  const mats  = [...made, ...( own?.materials ?? [] )];
  if ( !mats.length ) mats.push( defaultMaterial() );
  // the gaps between the posts ( feet a to b ), each a section's place
  const feet  = shape.posts.map( ( p ) => p.at ), loop = f.closed && f.points.length > 2;
  const gaps  = feet.map( ( a, i ) => ( i + 1 < feet.length || loop ? { a, b: feet[( i + 1 ) % feet.length] } : null ) )
    .filter( ( g ): g is { a: V3; b: V3 } => !!g && Math.hypot( g.b[0] - g.a[0], g.b[2] - g.a[2] ) >= 1e-3 );
  // ( a section modelled here: its mesh laid into every gap, as the kit's parts are below )
  if ( own ) shape.mesh = gaps.reduce( ( m, { a, b } ) => {
    const lay = sectionFrame( a, b, s.infill.length ?? 1 );
    return joinMeshes( m, { ...own.mesh, v: own.mesh.v.map( lay ), m: own.mesh.m.map( ( k ) => k + made.length ) } );
  }, shape.mesh );
  // ( `quick`, while a point's being moved: no colliders or grind rail, made once it's put down )
  const model = { ...newModel( shape.mesh ), ...( o.model ? { smoothAngle: o.model.smoothAngle } : {} ), ...( quick ? { colliders: "none" as const } : {} ) };
  const part  = { ...o.parts[0], materials: mats };
  // ( the generated mesh's own part alone: the kit's made afresh below. A repeat rides as it was set to, its rail kept
  // ( fenceTool's railAgain lays it along the new shape ); a fence made here is a jib along its top if it's grindable )
  const repeat = isRepeat( f ), riding = repeat ? {} : { surface_type: s.grind ? "Jib" : "Generic", can_magnetize: s.grind };
  let next     = withModel( { ...o, parts: [part], kitColliders: undefined, ...riding, rail: undefined } as CustomObjectEntry, model );
  if ( repeat && !quick && o.rail && next.surface_type === "Jib" ) next = withRail( next, o.rail );
  if ( !repeat && s.grind && !quick && shape.rail && shape.rail.length > 1 )
    next = withRail( next, { points: shape.rail, radius: shape.radius, ...( s.infill.kind === "rails" && s.infill.profile !== "round" ? { box: [s.infill.size / ( s.infill.profile === "flat" ? 5 : 1 ), s.infill.size] as [number, number] } : {} ) } );
  // the map's pieces copied along it: a post at every foot, a panel in every gap
  const kitParts: CustomPart[] = [], kitColliders: CustomCollider[] = [];
  // ( `rise`: metres up per metre along, a section tilted to run from one foot to the next )
  const copy                   = ( src: CustomObjectEntry, at: V3, dir: [number, number], stretch: number, rise = 0 ) => {
    const yaw   = ( Math.atan2( -dir[1], dir[0] ) * 180 ) / Math.PI, pitch = ( Math.atan( rise ) * 180 ) / Math.PI;
    const world = toUnity( toView( o, at ) );
    const delta = composeUnity( world, [0, yaw, pitch], [stretch, 1, 1] ).multiply( pieceMatrix( src ).invert() );
    const moved = transformCustom( src, delta );
    kitParts.push( ...moved.parts.filter( ( p ) => p.lod_index <= 0 ) );
    kitColliders.push( ...moved.colliders.map( ( c ) => ( { ...c, surface_type: repeat ? next.surface_type : ( "Generic" as const ) } ) ) );
  };
  const postPiece = s.post.kind === "piece" && s.post.piece ? pieceOf( s.post.piece ) : undefined;
  if ( postPiece ) for ( const p of shape.posts ) copy( postPiece, p.at, p.dir, 1 );
  const panel = s.infill.kind !== "panel" ? undefined : s.infill.section ?? ( s.infill.piece ? pieceOf( s.infill.piece ) : undefined );
  if ( panel )
    for ( const { a, b } of gaps ) {
      const d    = Math.hypot( b[0] - a[0], b[2] - a[2] );
      // ( a section of your own: from foot to foot, up or down the slope; else level, as long as the gap )
      const mine = !!s.infill.section, rise = mine ? ( b[1] - a[1] ) / d : 0, run = mine ? Math.hypot( d, b[1] - a[1] ) : d;
      copy( panel, [( a[0] + b[0] ) / 2, ( a[1] + b[1] ) / 2, ( a[2] + b[2] ) / 2], [( b[0] - a[0] ) / d, ( b[2] - a[2] ) / d], run / Math.max( 0.05, s.infill.length ?? d ), rise );
    }
  // ( `quick`: the rail it had kept meanwhile, so its grind line has one to follow and isn't worked out from the mesh )
  const kept = quick && o.rail ? { rail: o.rail } : {};
  return { ...next, ...kept, parts: [...next.parts, ...kitParts], colliders: [...next.colliders, ...kitColliders], ...( kitColliders.length ? { kitColliders } : {} ) } as CustomObjectEntry;
}

/**
 * A fence made of a piece of your own ( one section of fence ): `local`, its vertices in its own space ( three
 * numbers each ), tells how long it is and which way it runs ( the longer of its own X and Z ). The fence starts as
 * that one section where the piece stood, its path from one end of it to the other; the section is copied into it,
 * turned to run along +X, its middle at the origin, its foot at 0. Posts none, one gap a section long; grindable along
 * its top.
**/
export function sectionFence( uid: string, o: CustomObjectEntry, local: Float32Array ): CustomObjectEntry {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for ( let i = 0; i < local.length; i += 3 ) {
    x0 = Math.min( x0, local[i] ); x1 = Math.max( x1, local[i] );
    y0 = Math.min( y0, local[i + 1] ); y1 = Math.max( y1, local[i + 1] );
    z0 = Math.min( z0, local[i + 2] ); z1 = Math.max( z1, local[i + 2] );
  }
  const sc: V3  = [Math.abs( o.scale.x ), Math.abs( o.scale.y ), Math.abs( o.scale.z )];
  // ( which of its own axes it runs along: the longer )
  const alongZ  = ( z1 - z0 ) * sc[2] > ( x1 - x0 ) * sc[0];
  const length  = Math.max( 0.05, alongZ ? ( z1 - z0 ) * sc[2] : ( x1 - x0 ) * sc[0] );
  // its middle, at its foot ( its own space, Unity's )
  const mid: V3 = [( x0 + x1 ) / 2, y0, ( z0 + z1 ) / 2];
  // its own space to the section's: scaled as it was, that middle foot at the origin, turned a quarter if it runs along
  // Z ( Z becoming X, as Unity's yaw of 90 turns it )
  const into    = ( p: V3 ): V3 => {
    const x = ( p[0] - mid[0] ) * sc[0], y = ( p[1] - mid[1] ) * sc[1], z = ( p[2] - mid[2] ) * sc[2];
    return alongZ ? [z, y, -x] : [x, y, z];
  };
  // ( the same for its parts, which are in the world: its place taken off, then that; kept with its own place at the
  // origin, so copying it along is just placing it. A piece modelled here: its mesh instead, its own part left out )
  const moved   = transformCustom( o, composeUnity( into( [0, 0, 0] ), [0, alongZ ? 90 : 0, 0], sc ).multiply( pieceMatrix( o ).invert() ) );
  const model   = isModel( o ) ? `Models/${o.uid}/` : null;
  const section = { ...moved, model: undefined, rail: undefined, position: xyz( [0, 0, 0] ), rotation: xyz( [0, 0, 0] ), scale: xyz( [1, 1, 1] ), ...( model ? { parts: moved.parts.filter( ( p ) => !p.mesh.startsWith( model ) ), colliders: [] } : {} ) };
  const mesh    = isModel( o ) ? evaluate( o.model ) : null;
  // where it stood, and the way it ran ( Unity, world )
  const where   = toUnity( toView( o, mid ) );
  const end     = toUnity( toView( o, alongZ ? [mid[0], y0, z1] : [x1, y0, mid[2]] ) );
  const dx      = end[0] - where[0], dz = end[2] - where[2], dl = Math.hypot( dx, dz ) || 1;
  const style: FenceStyle = {
    ...structuredClone( ROAD ),
    spacing: length,
    post:    { kind: "none", size: 0.05, height: Math.max( 0.1, ( y1 - y0 ) * sc[1] ), sink: 0 },
    infill:  {
      ...structuredClone( ROAD.infill ), kind: "panel", length, section,
      ...( mesh ? { sectionMesh: { mesh: { ...mesh, v: mesh.v.map( into ) }, materials: o.parts[0].materials } } : {} ),
    },
    grind:   false,
  };
  // ( it rides as the piece did: its surface and how a jib of it rides )
  const f    = { ...newFence( uid, where, [], style ), surface_type: o.surface_type, can_magnetize: o.can_magnetize, can_stabilize: o.can_stabilize, can_rotate: o.can_rotate };
  const ends = [-length / 2, length / 2].map( ( t ) => fenceLocal( f, [where[0] + ( dx / dl ) * t, where[1], where[2] + ( dz / dl ) * t] ) );
  return { ...f, fence: { points: ends, closed: false, style } } as CustomObjectEntry;
}

/**
 * Where a point of the view ( a click on the ground ) is in a fence's own XZ.
**/
export function fenceLocal( o: CustomObjectEntry, w: V3 ): [number, number] {
  const p = toPiece( o, toThree( w ) );
  return [p[0], p[2]];
}

/**
 * A point of a fence's own XZ in the world ( Unity ), on its own level.
**/
export function fenceWorld( o: CustomObjectEntry, p: [number, number] ): V3 {
  return toUnity( toView( o, [p[0], 0, p[1]] ) );
}

