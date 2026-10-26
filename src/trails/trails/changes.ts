// Changes to a net: a run split, fitted or tilted to the ground, points merged.

import { evalCurve } from "../../core/curve";
import { bez, controls } from "./line";
import { FLAT, type TrailNet, type TrailRun, type V3, trailId } from "./net";
import { handlePoints, smooth, through3 } from "./strip";

/**
 * A run cut in two at `t` ( 0..1 ) by a new point there: the two halves follow the same curve exactly, its width and
 * side heights carried on where it was cut. Returns the new point's id.
**/
export function splitRun( net: TrailNet, runId: string, t: number ): string {
  const r                = net.runs.find( ( x ) => x.id === runId )!;
  const [P0, P1, P2, P3] = controls( net, r );
  const lerp             = ( a: V3, b: V3, f: number ): V3 => [a[0] + ( b[0] - a[0] ) * f, a[1] + ( b[1] - a[1] ) * f, a[2] + ( b[2] - a[2] ) * f];
  const Q0               = lerp( P0, P1, t ), Q1 = lerp( P1, P2, t ), Q2 = lerp( P2, P3, t ), R0 = lerp( Q0, Q1, t ), R1 = lerp( Q1, Q2, t ), S = lerp( R0, R1, t );
  const sub              = ( a: V3, b: V3 ): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  // ( on the run's surface there: a run with a shape along it keeps that shape in each half )
  const node             = { id: trailId( "pt" ), p: [S[0], S[1] + ( r.bump ? evalCurve( r.profile, t ) * r.bump : 0 ), S[2]] as V3 };
  const w                = r.wa + ( r.wb - r.wa ) * smooth( t );
  const side             = ( k: 0 | 1, f: number ) => through3( r.corners[k], r.mids[k], r.corners[k + 2], f );
  const first: TrailRun  = {
    ...structuredClone( r ),
    id:      trailId( "run" ),
    b:       node.id,
    ha:      sub( Q0, P0 ),
    hb:      sub( R0, S ),
    wb:      w,
    corners: [r.corners[0], r.corners[1], side( 0, t ), side( 1, t )],
    mids:    [side( 0, t / 2 ), side( 1, t / 2 )],
  };
  const second: TrailRun = {
    ...structuredClone( r ),
    id:      trailId( "run" ),
    a:       node.id,
    ha:      sub( R1, S ),
    hb:      sub( Q2, P3 ),
    wa:      w,
    corners: [side( 0, t ), side( 1, t ), r.corners[2], r.corners[3]],
    mids:    [side( 0, ( 1 + t ) / 2 ), side( 1, ( 1 + t ) / 2 )],
  };
  net.nodes.push( node );
  net.runs.splice( net.runs.indexOf( r ), 1, first, second );
  return node.id;
}

/**
 * A run shaped to the ground under it ( in `net`, a copy being edited ): its profile along it following the ground
 * between its points, its corners and side middles at the ground's height there. `ground` gives the height at a
 * point ( NaN off the map ).
**/
export function fitToGround( net: TrailNet, r: TrailRun, rough: ( x: number, z: number ) => number ) {
  // ( its shape from the ground's smoothed ( 8 m ) shape: bumps and rolls are the ground's detail, not the run's )
  const ground           = smoothedGround( rough );
  const [P0, P1, P2, P3] = controls( net, r );
  // the points' heights above the ground are meant ( a point raised 3 m lifts the run there 3 m, all across ): the
  // run follows the ground that much higher at each end, eased from one end's lift to the other's along it
  // ( above the ground as it is there: a point put down on a bump isn't raised )
  const above            = ( p: V3 ) => {
    const g = rough( p[0], p[2] );
    return Number.isNaN( g ) ? 0 : p[1] - g;
  };
  const liftA = above( P0 ), liftB = above( P3 );
  const lift  = ( t: number ) => liftA + ( liftB - liftA ) * smooth( t );
  // along: that less the line between the points, at 10 places ( the ends are the points: nought there )
  const N     = 10, off: number[] = [];
  for ( let k = 0; k <= N; k++ ) {
    const t = k / N;
    const g = ground( bez( P0[0], P1[0], P2[0], P3[0], t ), bez( P0[2], P1[2], P2[2], P3[2], t ) );
    off.push( k === 0 || k === N || Number.isNaN( g ) ? 0 : g + lift( t ) - bez( P0[1], P1[1], P2[1], P3[1], t ) );
  }
  const most = Math.max( ...off.map( Math.abs ) );
  if ( most < 0.05 ) {
    r.bump    = 0;
    r.profile = structuredClone( FLAT );
  } else {
    r.bump    = Math.round( most * 100 ) / 100;
    r.profile = off.map( ( v, k ) => ( { t: k / N, v: v / r.bump } ) );
  }
  r.fit     = true;
  r.corners = [0, 0, 0, 0];
  r.mids    = [0, 0];
  // across: the corners and side middles where the ground is ( lifted as their end, or half way, is )
  for ( const h of handlePoints( net, r, true ) ) {
    const g = ground( h.p[0], h.p[2] );
    if ( Number.isNaN( g ) ) continue;
    const up = h.which === "mid" ? lift( 0.5 ) : h.index < 2 ? liftA : liftB;
    const v  = Math.round( ( g + up - h.p[1] ) * 10 ) / 10;
    if ( h.which === "corner" ) r.corners[h.index] = v;
    else r.mids[h.index] = v;
  }
}

/**
 * Point `from` joined into point `into`: its runs go to `into` ( a run between the two, or one already there, goes ).
**/
export function mergePoints( net: TrailNet, from: string, into: string ): TrailNet {
  const n    = structuredClone( net );
  const seen = new Set<string>();
  n.runs     = n.runs.flatMap( ( r ) => {
    const a   = r.a === from ? into : r.a, b = r.b === from ? into : r.b;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if ( a === b || seen.has( key ) ) return [];
    seen.add( key );
    return [{ ...r, a, b }];
  } );
  n.nodes = n.nodes.filter( ( x ) => x.id !== from );
  return n;
}

/**
 * The ground at a point as the average of nine 4 m apart round it ( NaN where any is off the map ).
**/
export function smoothedGround( g: ( x: number, z: number ) => number ) {
  return ( x: number, z: number ) => {
    let s = 0;
    for ( let b = -1; b <= 1; b++ ) for ( let a = -1; a <= 1; a++ ) s += g( x + a * 4, z + b * 4 );
    return s / 9;
  };
}

/**
 * Points given the ground's slope under them ( what runs meeting there ease into ).
**/
export function tiltToGround( net: TrailNet, ids: Iterable<string>, ground: ( x: number, z: number ) => number ) {
  const d = 4;
  for ( const id of ids ) {
    const n = net.nodes.find( ( x ) => x.id === id );
    if ( !n ) continue;
    const [x, , z] = n.p;
    const gx       = ( ground( x + d, z ) - ground( x - d, z ) ) / ( 2 * d ), gz = ( ground( x, z + d ) - ground( x, z - d ) ) / ( 2 * d );
    if ( Number.isFinite( gx ) && Number.isFinite( gz ) ) n.tilt = [Math.round( gx * 1000 ) / 1000, Math.round( gz * 1000 ) / 1000];
  }
}
