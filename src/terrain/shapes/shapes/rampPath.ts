// A ramp's run ( CurveShape ): straight from its start to its end, or, with an arm at either end ( startArm, endArm:
// offsets from the end, as a trail run's turning handles ), bent along the curve the two make ( a cubic Bézier ). Where
// a point is along it and across it, how long it is, and where along it a distance is.

import type { CurveShape } from "./types";

// pieces the curve is drawn in
const STEPS = 96;

export interface RampPath {
  x:   Float64Array;
  z:   Float64Array;
  // metres along it at each point
  cum: Float64Array;
  len: number;
}

const made = new WeakMap<CurveShape, RampPath | null>();

/**
 * Whether the ramp bends ( has an arm at either end ).
**/
export const rampBent = ( s: CurveShape ) => !!( s.startArm || s.endArm );

/**
 * Its arms as they are, or a third of the way towards the other end without one ( straight ).
**/
export function rampArms( s: CurveShape ): [[number, number], [number, number]] {
  const dx = s.end[0] - s.start[0], dz = s.end[1] - s.start[1];
  return [s.startArm ?? [dx / 3, dz / 3], s.endArm ?? [-dx / 3, -dz / 3]];
}

/**
 * The run drawn in short straight pieces, with the metres along it at each point ( null: its ends on top of each
 * other ). Worked out once a shape ( shapes are replaced, never changed, when edited ).
**/
export function rampPath( s: CurveShape ): RampPath | null {
  const had = made.get( s );
  if ( had !== undefined ) return had;
  const [a0, a1] = rampArms( s );
  const p0x = s.start[0], p0z = s.start[1], p3x = s.end[0], p3z = s.end[1];
  const p1x = p0x + a0[0], p1z = p0z + a0[1], p2x = p3x + a1[0], p2z = p3z + a1[1];
  const x   = new Float64Array( STEPS + 1 ), z = new Float64Array( STEPS + 1 ), cum = new Float64Array( STEPS + 1 );
  for ( let i = 0; i <= STEPS; i++ ) {
    const u = i / STEPS, v = 1 - u;
    const b0 = v * v * v, b1 = 3 * v * v * u, b2 = 3 * v * u * u, b3 = u * u * u;
    x[i]     = b0 * p0x + b1 * p1x + b2 * p2x + b3 * p3x;
    z[i]     = b0 * p0z + b1 * p1z + b2 * p2z + b3 * p3z;
    if ( i ) cum[i] = cum[i - 1] + Math.hypot( x[i] - x[i - 1], z[i] - z[i - 1] );
  }
  const p = cum[STEPS] < 1e-3 ? null : { x, z, cum, len: cum[STEPS] };
  made.set( s, p );
  return p;
}

/**
 * How long the run is ( metres, along its curve ).
**/
export function rampLength( s: CurveShape ) {
  return rampBent( s ) ? rampPath( s )?.len ?? 0 : Math.hypot( s.end[0] - s.start[0], s.end[1] - s.start[1] );
}

/**
 * Where a point is on the run: metres along it, and across it from its middle ( to its right positive, as a straight
 * ramp's: towards the cross-section's right ); null past its start or its end.
**/
export function rampLocate( p: RampPath, px: number, pz: number ): { along: number; side: number } | null {
  let best = Infinity, seg = 0, tt = 0, along = 0;
  const n = p.x.length - 1;
  for ( let i = 0; i < n; i++ ) {
    const ax = p.x[i], az = p.z[i], sx = p.x[i + 1] - ax, sz = p.z[i + 1] - az;
    const l2 = sx * sx + sz * sz;
    if ( l2 < 1e-12 ) continue;
    const t  = ( ( px - ax ) * sx + ( pz - az ) * sz ) / l2, tc = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - ( ax + sx * tc ), dz = pz - ( az + sz * tc ), d2 = dx * dx + dz * dz;
    if ( d2 < best ) {
      best  = d2;
      seg   = i;
      tt    = t;
      along = p.cum[i] + tc * Math.sqrt( l2 );
    }
  }
  if ( ( seg === 0 && tt < 0 ) || ( seg === n - 1 && tt > 1 ) ) return null;
  const sx = p.x[seg + 1] - p.x[seg], sz = p.z[seg + 1] - p.z[seg];
  const sign = ( px - p.x[seg] ) * sz - ( pz - p.z[seg] ) * sx >= 0 ? 1 : -1;
  return { along, side: sign * Math.sqrt( best ) };
}

/**
 * The point `d` metres along the run, and the way to its right there ( the cross-section's right ).
**/
export function rampAt( p: RampPath, d: number ): { x: number; z: number; rx: number; rz: number } {
  const n = p.x.length - 1;
  let lo  = 0, hi = n;
  while ( hi - lo > 1 ) {
    const m = ( lo + hi ) >> 1;
    if ( p.cum[m] <= d ) lo = m;
    else hi = m;
  }
  const l  = p.cum[hi] - p.cum[lo], t = l > 1e-9 ? Math.min( 1, Math.max( 0, ( d - p.cum[lo] ) / l ) ) : 0;
  const sx = p.x[hi] - p.x[lo], sz = p.z[hi] - p.z[lo], sl = Math.hypot( sx, sz ) || 1;
  return { x: p.x[lo] + sx * t, z: p.z[lo] + sz * t, rx: sz / sl, rz: -sx / sl };
}

/**
 * The way to the run's right at each of its points ( between its pieces' either side ).
**/
export function rampRights( p: RampPath ): [number, number][] {
  const n = p.x.length - 1;
  return Array.from( { length: n + 1 }, ( _, i ) => {
    const a = Math.max( 0, i - 1 ), b = Math.min( n, i + 1 );
    const sx = p.x[b] - p.x[a], sz = p.z[b] - p.z[a], sl = Math.hypot( sx, sz ) || 1;
    return [sz / sl, -sx / sl] as [number, number];
  } );
}
