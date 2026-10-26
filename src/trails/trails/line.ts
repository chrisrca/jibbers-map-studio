// A run's centre line: a cubic Bézier from point to point ( its handles the ends' directions ), its length, the point
// at a fraction along it and the nearest to a place.

import { evalCurve } from "../../core/curve";
import { type TrailNet, type TrailRun, type V3, nodeOf } from "./net";

export const bez = ( p0: number, p1: number, p2: number, p3: number, t: number ) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};

export const bezD = ( p0: number, p1: number, p2: number, p3: number, t: number ) => {
  const u = 1 - t;
  return 3 * u * u * ( p1 - p0 ) + 6 * u * t * ( p2 - p1 ) + 3 * t * t * ( p3 - p2 );
};

export const bezDD = ( p0: number, p1: number, p2: number, p3: number, t: number ) => 6 * ( 1 - t ) * ( p2 - 2 * p1 + p0 ) + 6 * t * ( p3 - 2 * p2 + p1 );

/**
 * The run's four Bezier points.
**/
export function controls( net: TrailNet, r: TrailRun ): [V3, V3, V3, V3] {
  const pa = nodeOf( net, r.a ).p, pb = nodeOf( net, r.b ).p;
  return [pa, [pa[0] + r.ha[0], pa[1] + r.ha[1], pa[2] + r.ha[2]], [pb[0] + r.hb[0], pb[1] + r.hb[1], pb[2] + r.hb[2]], pb];
}

/**
 * Length along the ground ( an estimate from 32 steps ).
**/
export function runLength( net: TrailNet, r: TrailRun ) {
  const c = controls( net, r );
  let len = 0, px = c[0][0], pz = c[0][2];
  for ( let k = 1; k <= 32; k++ ) {
    const t = k / 32, x = bez( c[0][0], c[1][0], c[2][0], c[3][0], t ), z = bez( c[0][2], c[1][2], c[2][2], c[3][2], t );
    len    += Math.hypot( x - px, z - pz );
    px      = x;
    pz      = z;
  }
  return len;
}

/**
 * The point on a run's centre line `t` ( 0..1 ) along it, on its surface ( with its shape along it ).
**/
export function pointOnRun( net: TrailNet, r: TrailRun, t: number ): V3 {
  const c = controls( net, r );
  const y = bez( c[0][1], c[1][1], c[2][1], c[3][1], t ) + ( r.bump ? evalCurve( r.profile, t ) * r.bump : 0 );
  return [bez( c[0][0], c[1][0], c[2][0], c[3][0], t ), y, bez( c[0][2], c[1][2], c[2][2], c[3][2], t )];
}

/**
 * Where along a run ( 0..1 ) its centre line comes nearest a point ( Unity XZ ), and how far off it is there.
**/
export function nearestOnRun( net: TrailNet, r: TrailRun, x: number, z: number ): { t: number; d: number } {
  const c  = controls( net, r );
  const at = ( t: number ) => [bez( c[0][0], c[1][0], c[2][0], c[3][0], t ), bez( c[0][2], c[1][2], c[2][2], c[3][2], t )];
  let best = 0, bd = Infinity;
  for ( let k = 0; k <= 64; k++ ) {
    const p = at( k / 64 ), d = Math.hypot( p[0] - x, p[1] - z );
    if ( d < bd ) { bd = d; best = k / 64; }
  }
  // ( narrowed down about the nearest of those )
  let lo = Math.max( 0, best - 1 / 64 ), hi = Math.min( 1, best + 1 / 64 );
  for ( let k = 0; k < 20; k++ ) {
    const m1 = lo + ( hi - lo ) / 3, m2 = hi - ( hi - lo ) / 3;
    const p1 = at( m1 ), p2 = at( m2 );
    if ( Math.hypot( p1[0] - x, p1[1] - z ) < Math.hypot( p2[0] - x, p2[1] - z ) ) hi = m2;
    else lo = m1;
  }
  const t = ( lo + hi ) / 2, p = at( t );
  return { t, d: Math.hypot( p[0] - x, p[1] - z ) };
}
