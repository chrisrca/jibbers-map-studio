// A rail made from a piece's shape: along the top of its surface, simplified to a few points.

import * as THREE from "three/webgpu";
import type { Rail } from "../../core/types";
import { type P3, clamp, median, vec } from "./common";

/**
 * Points spread over a mesh's surface ( its triangles ), not just its corners: a low-detail tube has corners only in
 * rings far apart, with nothing between them to find its top by. `pos` xyz…, `index` the triangles ( or null for a
 * plain list ); about `perSqm` points a square metre, at least one a triangle, its corners included.
**/
export function surfacePoints( pos: ArrayLike<number>, index: ArrayLike<number> | null, perSqm: number ): number[] {
  const out: number[] = [];
  for ( let i = 0; i < pos.length; i++ ) out.push( pos[i] );
  const tris = index ? index.length / 3 : pos.length / 9;
  const at   = ( t: number, k: number ) => ( index ? index[t * 3 + k] : t * 3 + k ) * 3;
  for ( let t = 0; t < tris; t++ ) {
    const a    = at( t, 0 ), b = at( t, 1 ), c = at( t, 2 );
    const ux   = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx   = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const area = 0.5 * Math.hypot( uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx );
    const n    = Math.min( 400, Math.max( 1, Math.round( area * perSqm ) ) );
    for ( let k = 0; k < n; k++ ) {
      // an even spread over the triangle ( R2 sequence, folded into it )
      let s = ( 0.5 + k * 0.7548776662 ) % 1, r = ( 0.5 + k * 0.5698402910 ) % 1;
      if ( s + r > 1 ) { s = 1 - s; r = 1 - r; }
      out.push( pos[a] + ux * s + vx * r, pos[a + 1] + uy * s + vy * r, pos[a + 2] + uz * s + vz * r );
    }
  }
  return out;
}

/**
 * Douglas–Peucker: the fewest points that keep the line within `tol`.
**/
export function simplify( pts: P3[], tol: number ): P3[] {
  if ( pts.length <= 2 ) return pts;
  const a   = vec( pts[0] ), b = vec( pts[pts.length - 1] );
  const seg = new THREE.Line3( a, b );
  const on  = new THREE.Vector3();
  let worst = -1, dist = 0;
  for ( let i = 1; i < pts.length - 1; i++ ) {
    const p = vec( pts[i] );
    const d = seg.closestPointToPoint( p, true, on ).distanceTo( p );
    if ( d > dist ) { dist = d; worst = i; }
  }
  if ( dist <= tol ) return [pts[0], pts[pts.length - 1]];
  return [...simplify( pts.slice( 0, worst + 1 ), tol ).slice( 0, -1 ), ...simplify( pts.slice( worst ), tol )];
}

/**
 * A rail along a piece from its mesh ( `pts`: vertices in the piece's own coordinates, xyz… ). The piece is sliced
 * along its length ( the longer of its level axes ); the top of each slice is the top of the rail there, and how the
 * top curves gives the rail's thickness. No rail ( and why ) where slicing can't follow the shape: when it doubles back
 * over itself, like a spiral.
**/
export function autoRail( pts: Float32Array ): { rail: Rail | null; why?: string; radius?: number } {
  const n = Math.floor( pts.length / 3 );
  if ( n < 3 ) return { rail: null, why: "it has no shape to follow" };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for ( let i = 0; i < n; i++ ) {
    x0 = Math.min( x0, pts[i * 3] );
    x1 = Math.max( x1, pts[i * 3] );
    z0 = Math.min( z0, pts[i * 3 + 2] );
    z1 = Math.max( z1, pts[i * 3 + 2] );
  }
  const A   = x1 - x0 >= z1 - z0 ? 0 : 2; // along
  const C   = 2 - A;                      // across
  const lo  = A === 0 ? x0 : z0;
  const len = A === 0 ? x1 - x0 : z1 - z0;
  if ( len < 1e-3 ) return { rail: null, why: "it has no length" };
  const N   = Math.min( 48, Math.max( 12, Math.round( len / 0.05 ) ) );
  const bin = ( i: number ) => Math.min( N - 1, Math.floor( ( ( pts[i * 3 + A] - lo ) / len ) * N ) );

  // the top of each slice, and how wide each slice is across
  const top = new Float64Array( N ).fill( -Infinity );
  const w0  = new Float64Array( N ).fill( Infinity  ), w1 = new Float64Array( N ).fill( -Infinity );
  for ( let i = 0; i < n; i++ ) {
    const b = bin( i );
    top[b]  = Math.max( top[b], pts[i * 3 + 1] );
    w0[b]   = Math.min( w0[b],  pts[i * 3 + C] );
    w1[b]   = Math.max( w1[b],  pts[i * 3 + C] );
  }
  const used = [...Array( N ).keys()].filter( ( k ) => top[k] > -Infinity );
  if ( used.length < 2 ) return { rail: null, why: "it has no length" };
  // the band just under each slice's top: its middle across, and from its width the rail's thickness
  const h   = clamp( median( used.map( ( k ) => w1[k] - w0[k] ) ) * 0.25, 0.004, 0.08 );
  const c0  = new Float64Array( N ).fill( Infinity ), c1 = new Float64Array( N ).fill( -Infinity );
  const a0  = new Float64Array( N ).fill( Infinity ), a1 = new Float64Array( N ).fill( -Infinity );
  const low = new Float64Array( N ).fill( Infinity );
  // and how wide the very top is ( flat on a box or a square rail, a sliver on a round one )
  const f0  = new Float64Array( N ).fill( Infinity ), f1 = new Float64Array( N ).fill( -Infinity );
  for ( let i = 0; i < n; i++ ) {
    const b = bin( i );
    if ( pts[i * 3 + 1] < top[b] - h ) continue;
    c0[b]  = Math.min( c0[b],  pts[i * 3 + C] );
    c1[b]  = Math.max( c1[b],  pts[i * 3 + C] );
    a0[b]  = Math.min( a0[b],  pts[i * 3 + A] );
    a1[b]  = Math.max( a1[b],  pts[i * 3 + A] );
    low[b] = Math.min( low[b], pts[i * 3 + 1] );
    if ( pts[i * 3 + 1] >= top[b] - Math.max( 0.004, 0.03 * ( w1[b] - w0[b] ) ) ) { f0[b] = Math.min( f0[b], pts[i * 3 + C] ); f1[b] = Math.max( f1[b], pts[i * 3 + C] ); }
  }
  // a circle's chord d below its top is w wide: r = ( w²/4 + d² ) / 2d — with d how deep the band's points really go
  // ( a mesh's ring has corners, not a smooth edge )
  // where the rail runs at a slant across a slice it looks wider there ( and deeper, where it climbs ): take out how
  // far it drifts within the slice, and the slant
  const step = len / N;
  const mid  = ( k: number ) => ( c0[k] + c1[k] ) / 2;
  const cuts = used
    .map( ( k, j ) => {
      const prev   = used[Math.max( 0, j - 1 )], next = used[Math.min( used.length - 1, j + 1 )];
      const span   = Math.max( step, ( ( next - prev ) * len ) / N );
      const slope  = ( mid( next ) - mid( prev ) ) / span, climb = ( top[next] - top[prev] ) / span;
      const across = ( wide: number ) => Math.max( wide * 0.5, wide - Math.abs( slope ) * step ) / Math.sqrt( 1 + slope * slope );
      const w      = across( c1[k] - c0[k] );
      const d      = Math.max( ( top[k] - low[k] ) * 0.5, top[k] - low[k] - Math.abs( climb ) * step );
      return { w, d, flat: f1[k] > f0[k] ? across( f1[k] - f0[k] ) : 0 };
    } )
    .filter( ( { w, d } ) => w > 1e-4 && d > 1e-4 );
  const radii   = cuts.map( ( { w, d } ) => clamp( ( w * w ) / ( 8 * d ) + d / 2, 0.006, w ) );
  // a flat top nearly as wide as the band under it ( a box, a square rail ) isn't a circle: half its width
  const flatTop = cuts.length ? median( cuts.map( ( c ) => c.flat ) ) : 0;
  const flat    = cuts.length > 0 && flatTop >= 0.6 * median( cuts.map( ( c ) => c.w ) );
  const r       = clamp( flat ? flatTop / 2 : radii.length ? median( radii ) : 0.03, 0.01, 0.3 );

  const line: P3[] = used.map( ( k ) => {
    const p: P3 = [0, top[k] - r, 0];
    p[A]        = ( a0[k] + a1[k] ) / 2;
    p[C]        = ( c0[k] + c1[k] ) / 2;
    return p;
  } );
  // the top hopping across or up and down from slice to slice: the slices are cutting the shape twice
  const jumps = line.slice( 1 ).filter( ( p, i ) => Math.abs( p[C] - line[i][C] ) > 3 * step + 4 * r || Math.abs( p[1] - line[i][1] ) > 3 * step + 4 * r ).length;
  const why   = "it doubles back over itself (like a spiral), so it can't be followed slice by slice";
  if ( jumps > 1 ) return { rail: null, why, radius: r };
  // seen from above, the rail should cover the piece ( legs and posts are small dots under it ): a spiral's slices
  // only find its highest turn
  const cell  = Math.max( r, len / 200 );
  const key   = ( x: number, z: number ) => `${Math.floor( x / cell )},${Math.floor( z / cell )}`;
  const shape = new Set<string>();
  for ( let i = 0; i < n; i++ ) shape.add( key( pts[i * 3], pts[i * 3 + 2] ) );
  const reach   = Math.ceil( ( 2.5 * r ) / cell );
  const covered = new Set<string>();
  for ( let i = 0; i < line.length; i++ ) {
    const p = line[i], q = line[Math.min( i + 1, line.length - 1 )];
    for ( let t = 0; t <= 1; t += 0.25 ) {
      const cx = Math.floor( ( p[0] + ( q[0] - p[0] ) * t ) / cell ), cz = Math.floor( ( p[2] + ( q[2] - p[2] ) * t ) / cell );
      for ( let dx = -reach; dx <= reach; dx++ ) for ( let dz = -reach; dz <= reach; dz++ ) covered.add( `${cx + dx},${cz + dz}` );
    }
  }
  let inside = 0;
  for ( const c of shape ) if ( covered.has( c ) ) inside++;
  if ( inside < shape.size * 0.65 ) return { rail: null, why, radius: r };
  // the ends reach the ends of the rail, carrying on the way it runs just inside them ( the very end is often rounded
  // off, lower than the rail )
  const reachTo = ( end: number, i: number, j: number, to: number ) => {
    const p     = line[i], q = line[j];
    const t     = ( to - p[A] ) / ( q[A] - p[A] || 1e-9 );
    const e: P3 = [...p];
    for ( const ax of [1, C] ) e[ax] = p[ax] + ( q[ax] - p[ax] ) * t;
    e[A]      = to;
    line[end] = e;
  };
  if ( line.length >= 4 ) {
    reachTo( 0,               1,               2,               a0[used[0]]               );
    reachTo( line.length - 1, line.length - 2, line.length - 3, a1[used[used.length - 1]] );
  } else if ( line.length > 1 ) {
    line[0][A]               = a0[used[0]];
    line[line.length - 1][A] = a1[used[used.length - 1]];
  }
  // evened out a little ( not along ), then just the points that shape it
  const even = line.map( ( p, i ) => {
    if ( i === 0 || i === line.length - 1 ) return p;
    const q: P3 = [...p];
    for ( const ax of [1, C] ) q[ax] = ( line[i - 1][ax] + p[ax] + line[i + 1][ax] ) / 3;
    return q;
  } );
  return { rail: { points: simplify( even, Math.max( 0.01, len * 0.01 ) ), radius: r } };
}

/**
 * A straight rail over the top of the piece along its length: a start for shaping one by hand.
**/
export function straightRail( pts: Float32Array ): Rail {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = -Infinity;
  for ( let i = 0; i + 2 < pts.length; i += 3 ) {
    x0 = Math.min( x0, pts[i] );
    x1 = Math.max( x1, pts[i] );
    z0 = Math.min( z0, pts[i + 2] );
    z1 = Math.max( z1, pts[i + 2] );
    y1 = Math.max( y1, pts[i + 1] );
  }
  const r            = 0.04, y = y1 - r, xm = ( x0 + x1 ) / 2, zm = ( z0 + z1 ) / 2;
  const points: P3[] = x1 - x0 >= z1 - z0 ? [[x0, y, zm], [x1, y, zm]] : [[xm, y, z0], [xm, y, z1]];
  return { points, radius: r };
}
