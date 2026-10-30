// Cutting: the Knife ( K ), edge loops and rings, Loop Cut ( Ctrl+R ), Subdivide.

import { type Mesh, type V3, add, cloneMesh, cross, dot, edgesOf, ek, ekv, faceCenter, faceNormal, len, lerp3, mul, norm, sub, vertexFaces } from "../mesh";
import { type OpResult, selFromEdges, selFromFaces, selFromVerts } from "./selection";

// A knife point: an existing corner, a place on an edge ( between its two corners ), or a place inside a face.
export type KnifePoint = { v: number } | { a: number; b: number; p: V3 } | { f: number; p: V3 };

/**
 * Whether a point on a face's plane lies inside it ( seen square to the face ).
**/
function insideFace( g: Mesh, f: number[], p: V3 ) {
  const n    = faceNormal( { ...g, f: [f] }, 0 );
  const u    = norm( Math.abs( n[1] ) < 0.9 ? cross( [0, 1, 0], n ) : cross( [1, 0, 0], n ) ), w = cross( n, u );
  const x    = dot( p, u ), y = dot( p, w );
  let inside = false;
  for ( let i = 0, j = f.length - 1; i < f.length; j = i++ ) {
    const xi = dot( g.v[f[i]], u ), yi = dot( g.v[f[i]], w ), xj = dot( g.v[f[j]], u ), yj = dot( g.v[f[j]], w );
    if ( yi > y !== yj > y && x < ( ( xj - xi ) * ( y - yi ) ) / ( yj - yi ) + xi ) inside = !inside;
  }
  return inside;
}

/**
 * Knife: the points put into the mesh ( those on edges become corners of every face along that edge, those inside a
 * face new vertices in it ), then each face cut between one point and the next where both are its corners, or along
 * the points inside it from one of its corners to another. A cut that ends inside a face is left there as loose edges
 * ( as Blender leaves it ). The cut's corners come back selected.
**/
export function knifeCut( g0: Mesh, pts: KnifePoint[] ): OpResult {
  const g             = cloneMesh( g0 );
  const ids: number[] = [];
  // the points inside faces ( new vertices no face has yet )
  const inner         = new Set<number>();
  const onSeg         = ( p: V3, u: V3, w: V3 ) => {
    const d = sub( w, u ), l2 = dot( d, d );
    if ( l2 < 1e-16 ) return false;
    const t = dot( sub( p, u ), d ) / l2;
    return t > 1e-6 && t < 1 - 1e-6 && len( sub( p, add( u, mul( d, t ) ) ) ) < 1e-6 * Math.max( 1, Math.sqrt( l2 ) );
  };
  for ( const k of pts ) {
    if ( "v" in k ) {
      ids.push( k.v );
      continue;
    }
    if ( "f" in k ) {
      const at = g.v.push( [...k.p] as V3 ) - 1;
      inner.add( at );
      ids.push( at );
      continue;
    }
    // the place on its edge, or on the part of it left after an earlier point went in
    let at = g.v.findIndex( ( q ) => len( sub( q, k.p ) ) < 1e-7 );
    if ( at < 0 ) {
      at = g.v.push( [...k.p] as V3 ) - 1;
      for ( const f of g.f )
        for ( let i = 0; i < f.length; i++ ) {
          const u = f[i], w = f[( i + 1 ) % f.length];
          if ( onSeg( k.p, g.v[u], g.v[w] ) ) {
            f.splice( i + 1, 0, at );
            break;
          }
        }
    }
    ids.push( at );
  }
  // face `fi` cut from corner p to corner q, through `through` ( inside it, in order from p )
  const split = ( fi: number, p: number, q: number, through: number[] ) => {
    const f             = g.f[fi], a = f.indexOf( p ), b = f.indexOf( q );
    const one: number[] = [], two: number[] = [];
    for ( let j = a; ; j = ( j + 1 ) % f.length ) {
      one.push( f[j] );
      if ( j === b ) break;
    }
    for ( let j = b; ; j = ( j + 1 ) % f.length ) {
      two.push( f[j] );
      if ( j === a ) break;
    }
    g.f[fi] = [...one, ...[...through].reverse()];
    g.f.push( [...two, ...through] );
    g.m.push( g.m[fi] );
    g.s.push( g.s[fi] );
  };
  for ( let i = 0; i + 1 < ids.length; i++ ) {
    const p = ids[i], q = ids[i + 1];
    if ( p === q ) continue;
    if ( inner.has( p ) ) {
      // ( from inside a face, not from one of its corners: left loose )
      g.w.push( [p, q] );
      continue;
    }
    if ( inner.has( q ) ) {
      // into a face from its corner p: on through the points inside it to the corner it leaves by
      let j = i + 1;
      while ( j < ids.length && inner.has( ids[j] ) ) j++;
      const through = ids.slice( i + 1, j ), out = ids[j];
      const fi      = out === undefined || out === p ? -1 : g.f.findIndex( ( f ) => f.includes( p ) && f.includes( out ) && insideFace( g, f, g.v[through[0]] ) );
      if ( fi < 0 ) {
        for ( let k = i; k + 1 < Math.min( j + 1, ids.length ); k++ ) g.w.push( [ids[k], ids[k + 1]] );
      } else split( fi, p, out, through );
      i = j - 1;
      continue;
    }
    const fi = g.f.findIndex( ( f ) => {
      const a = f.indexOf( p ), b = f.indexOf( q );
      if ( a < 0 || b < 0 ) return false;
      const d = Math.abs( a - b );
      return d !== 1 && d !== f.length - 1;
    } );
    if ( fi >= 0 ) split( fi, p, q, [] );
  }
  return { mesh: g, sel: selFromVerts( g, ids ) };
}

/**
 * Blender's edge loop through an edge ( Alt+click ): on across vertices with four edges, to the edge opposite; along
 * an open border, round the border.
**/
export function edgeLoop( g: Mesh, start: string ): string[] {
  const edges   = edgesOf( g );
  const vf      = vertexFaces( g );
  const valence = new Map<number, string[]>();
  for ( const [k, e] of edges ) for ( const v of [e.a, e.b] ) ( valence.get( v ) ?? valence.set( v, [] ).get( v )! ).push( k );
  const out    = new Set<string>( [start] );
  const border = edges.get( start )?.faces.length === 1;
  const walk   = ( k: string, from: number ) => {
    let cur = k, v = from;
    for ( let guard = 0; guard < 100000; guard++ ) {
      const es = valence.get( v ) ?? [];
      // ( along the border: the one other border edge at v )
      const on = border ? es.filter( ( e ) => e !== cur && edges.get( e )!.faces.length === 1 ) : [];
      if ( border && on.length !== 1 ) return;
      if ( !border && ( es.length !== 4 || vf[v].length !== 4 ) ) return;
      // the edge at v sharing no face with this one
      const faces = new Set( edges.get( cur )!.faces );
      const next  = border ? on[0] : es.find( ( e ) => e !== cur && !edges.get( e )!.faces.some( ( f ) => faces.has( f ) ) );
      if ( !next || out.has( next ) ) return;
      out.add( next );
      const [a, b] = ekv( next );
      v            = a === v ? b : a;
      cur          = next;
    }
  };
  const [a, b] = ekv( start );
  walk( start, b );
  walk( start, a );
  return [...out];
}

/**
 * The ring of edges across quads from an edge ( what a loop cut cuts ): each edge oriented so their ends match up
 * across the quads; and whether it closes.
**/
export function edgeRing( g: Mesh, start: string ): { ring: [number, number][]; faces: number[]; closed: boolean } {
  const edges    = edgesOf( g );
  const opposite = ( fi: number, a: number, b: number ): [number, number] | null => {
    const f = g.f[fi];
    if ( f.length !== 4 ) return null;
    const i = f.indexOf( a ), j = f.indexOf( b );
    // a quad p0 p1 p2 p3 with this edge p0 p1 ( either way round ): the opposite edge p3 p2, matched end to end
    if ( f[( i + 1 ) % 4] === b ) return [f[( i + 3 ) % 4], f[( j + 1 ) % 4]];
    return [f[( i + 1 ) % 4], f[( j + 3 ) % 4]];
  };
  const [s0, s1] = ekv( start );
  const fwd: { e: [number, number]; f: number }[] = [];
  const seen = new Set<string>( [start] );
  let closed = false;
  // one way round, then the other
  const walk = ( a: number, b: number, from: number | null, into: { e: [number, number]; f: number }[] ) => {
    let cur: [number, number] = [a, b], prev = from;
    for ( let guard = 0; guard < 100000; guard++ ) {
      const faces = edges.get( ek( cur[0], cur[1] ) )!.faces.filter( ( f ) => f !== prev );
      const fi    = faces.find( ( f ) => g.f[f].length === 4 );
      if ( fi === undefined ) return;
      const next = opposite( fi, cur[0], cur[1] )!;
      const k    = ek( next[0], next[1] );
      if ( k === start ) {
        closed = true;
        into.push( { e: [s0, s1], f: fi } );
        return;
      }
      if ( seen.has( k ) ) return;
      seen.add( k );
      into.push( { e: next, f: fi } );
      cur  = next;
      prev = fi;
    }
  };
  walk( s0, s1, null, fwd );
  const ring: [number, number][] = [[s0, s1]], faces: number[] = [];
  for ( const x of fwd ) {
    faces.push( x.f );
    if ( !( closed && x === fwd[fwd.length - 1] ) ) ring.push( x.e );
  }
  if ( !closed ) {
    const back: { e: [number, number]; f: number }[] = [];
    const firstFace = fwd[0]?.f ?? null;
    walk( s0, s1, firstFace, back );
    for ( const x of back ) {
      ring.unshift( x.e );
      faces.unshift( x.f );
    }
  }
  return { ring, faces, closed };
}

/**
 * Blender's face loop ( Alt+click in face select mode ): the quads the edge's ring runs across.
**/
export const faceLoop = ( g: Mesh, start: string ): number[] => edgeRing( g, start ).faces;

/**
 * Loop Cut ( Ctrl+R ): `cuts` new edge loops across the ring through `start`, at even steps slid by `slide` ( -1..1 ).
**/
export function loopCut( g0: Mesh, start: string, cuts = 1, slide = 0 ): OpResult {
  const g                       = cloneMesh( g0 );
  const { ring, faces, closed } = edgeRing( g0, start );
  // the cut points along each ring edge, from its first end
  const pts                     = new Map<string, number[]>();
  // ( one cut slides from one side, -1, to the other, 1; several are evenly spaced )
  const t                       = ( j: number ) => ( cuts === 1 ? 0.5 + 0.5 * Math.max( -0.98, Math.min( 0.98, slide ) ) : ( j + 1 ) / ( cuts + 1 ) );
  for ( const [a, b] of ring ) {
    const list: number[] = [];
    for ( let j = 0; j < cuts; j++ ) list.push( g.v.push( lerp3( g0.v[a], g0.v[b], t( j ) ) ) - 1 );
    pts.set( `${a}>${b}`, list );
  }
  const along              = ( a: number, b: number ) => pts.get( `${a}>${b}` ) ?? [...( pts.get( `${b}>${a}` ) ?? [] )].reverse();
  // each quad of the ring: split into cuts + 1 quads
  const newLoops: string[] = [];
  faces.forEach( ( fi, k ) => {
    const e0                = ring[k];
    const f                 = g0.f[fi];
    // the quad as p0 p1 p2 p3 with e0 = ( p0, p1 ) in its own direction
    const i                 = f.indexOf( e0[0] );
    const forward           = f[( i + 1 ) % 4] === e0[1];
    const p                 = forward ? [f[i], f[( i + 1 ) % 4], f[( i + 2 ) % 4], f[( i + 3 ) % 4]] : [f[( i + 3 ) % 4], f[i], f[( i + 1 ) % 4], f[( i + 2 ) % 4]];
    const c                 = along( p[0], p[1] ), d = along( p[3], p[2] );
    const cs                = [p[0], ...c, p[1]], ds = [p[3], ...d, p[2]];
    const quads: number[][] = [];
    for ( let j = 0; j <= cuts; j++ ) quads.push( [cs[j], cs[j + 1], ds[j + 1], ds[j]] );
    g.f[fi] = quads[0];
    for ( let j = 1; j < quads.length; j++ ) {
      g.f.push( quads[j] );
      g.m.push( g0.m[fi] );
      g.s.push( g0.s[fi] );
    }
    for ( let j = 0; j < cuts; j++ ) newLoops.push( ek( c[j], d[j] ) );
  } );
  // the faces at an open ring's ends get the cut points in their outline
  if ( !closed ) {
    const used = new Set( faces );
    for ( const [a, b] of [ring[0], ring[ring.length - 1]] ) {
      for ( let fi = 0; fi < g0.f.length; fi++ ) {
        if ( used.has( fi ) ) continue;
        const f = g.f[fi];
        const i = f.indexOf( a );
        if ( i < 0 ) continue;
        if ( f[( i + 1 ) % f.length] === b ) g.f[fi] = [...f.slice( 0, i + 1 ), ...along( a, b ), ...f.slice( i + 1 )];
        else if ( f[( i - 1 + f.length ) % f.length] === b ) {
          const j = ( i - 1 + f.length ) % f.length;
          g.f[fi] = [...f.slice( 0, j + 1 ), ...along( b, a ), ...f.slice( j + 1 )];
        }
      }
    }
  }
  return { mesh: g, sel: selFromEdges( g, newLoops ) };
}

/**
 * Subdivide ( one cut ): each selected face into quads round a new middle; neighbours get the new edge midpoints.
**/
export function subdivide( g0: Mesh, faces: Set<number> ): OpResult {
  const g     = cloneMesh( g0 );
  const mid   = new Map<string, number>();
  const midOf = ( a: number, b: number ) => {
    const k = ek( a, b );
    let m   = mid.get( k );
    if ( m === undefined ) mid.set( k, ( m = g.v.push( lerp3( g0.v[a], g0.v[b], 0.5 ) ) - 1 ) );
    return m;
  };
  const keep: number[] = [];
  for ( const fi of faces ) {
    const f     = g0.f[fi], n = f.length;
    const c     = g.v.push( faceCenter( g0, fi ) ) - 1;
    const quads = f.map( ( v, i ) => [v, midOf( v, f[( i + 1 ) % n] ), c, midOf( f[( i - 1 + n ) % n], v )] );
    g.f[fi]     = quads[0];
    keep.push( fi );
    for ( let i = 1; i < n; i++ ) {
      keep.push( g.f.length );
      g.f.push( quads[i] );
      g.m.push( g0.m[fi] );
      g.s.push( g0.s[fi] );
    }
  }
  // faces next to the subdivided ones keep a closed surface: the midpoints go into their outlines
  for ( let fi = 0; fi < g0.f.length; fi++ ) {
    if ( faces.has( fi ) ) continue;
    const f = g.f[fi], out: number[] = [];
    for ( let i = 0; i < f.length; i++ ) {
      out.push( f[i] );
      const m = mid.get( ek( f[i], f[( i + 1 ) % f.length] ) );
      if ( m !== undefined ) out.push( m );
    }
    g.f[fi] = out;
  }
  return { mesh: g, sel: selFromFaces( g, keep ) };
}
