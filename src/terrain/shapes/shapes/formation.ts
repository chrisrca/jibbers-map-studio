// Formations ( Map-Tools' Formation Builder ): a landform in an outline drawn on the ground — a dome and noise ( smooth
// hills, ridged crests, lumpy billows ), laid over the ground four ways ( added on top, only raising it, only carving
// it, or set outright ), smoothed, then worn by thermal erosion ( steep slopes slumping to their angle of repose ) and
// hydraulic erosion ( droplets of rain running down, cutting channels and dropping what they carry where they slow ).
// Worked out on a grid over the outline, once for each version of the formation ( and the ground under it ), and
// looked up from there.

import { fbm, valueNoise } from "../../generate";
import type { FormationShape } from "./types";

// cells across the grid at most ( the erosion's cost grows with them )
const MOST = 192;

// Work done a little at a time ( a live edit's formation worked out over a few frames, the view drawn meanwhile ).
export type Steps<T> = Generator<void, T, void>;

const drive = <T>( g: Steps<T> ): T => {
  for ( ;; ) {
    const r = g.next();
    if ( r.done ) return r.value;
  }
};

const smooth = ( u: number ) => u * u * ( 3 - 2 * u );
const sat    = ( x: number ) => ( x < 0 ? 0 : x > 1 ? 1 : x );

/**
 * A point's signed distance to an outline ( + inside ).
**/
export function insideBy( pts: [number, number][], x: number, z: number ) {
  let inside = false, best = Infinity;
  for ( let i = 0, j = pts.length - 1; i < pts.length; j = i++ ) {
    const [ax, az] = pts[i], [bx, bz] = pts[j];
    if ( az > z !== bz > z && x < ( ( bx - ax ) * ( z - az ) ) / ( bz - az ) + ax ) inside = !inside;
    const ux = bx - ax, uz = bz - az, l2 = ux * ux + uz * uz || 1;
    const t  = sat( ( ( x - ax ) * ux + ( z - az ) * uz ) / l2 );
    best     = Math.min( best, Math.hypot( x - ax - ux * t, z - az - uz * t ) );
  }
  return inside ? best : -best;
}

export function formationBounds( s: FormationShape ): [number, number, number, number] {
  const xs = s.points.map( ( p ) => p[0] ), zs = s.points.map( ( p ) => p[1] );
  return [Math.min( ...xs ), Math.min( ...zs ), Math.max( ...xs ), Math.max( ...zs )];
}

/**
 * The noise at a point ( −1..1 ), in the formation's style.
**/
function noiseAt( s: FormationShape, x: number, z: number ) {
  if ( s.noiseMirror?.x != null ) x = s.noiseMirror.x - x;
  if ( s.noiseMirror?.z != null ) z = s.noiseMirror.z - z;
  const f = 1 / Math.max( 1, s.featureSize );
  let u   = x * f, v = z * f;
  if ( s.warp > 0 ) {
    u += s.warp * fbm( u + 5.2, v + 1.3, 3, s.seed + 101 );
    v += s.warp * fbm( u + 1.7, v + 9.2, 3, s.seed + 202 );
  }
  const oct = Math.max( 1, Math.min( 8, Math.round( s.detail ) ) );
  if ( s.style === "smooth" ) return fbm( u, v, oct, s.seed, s.lacunarity, s.gain );
  let sum = 0, amp = 1, norm = 0;
  for ( let o = 0; o < oct; o++ ) {
    const n = valueNoise( u, v, s.seed + o * 17 );
    sum    += amp * ( s.style === "ridged" ? ( 1 - Math.abs( n ) ) ** 2 * 2 - 1 : Math.abs( n ) * 2 - 1 );
    norm   += amp;
    amp    *= s.gain;
    u      *= s.lacunarity;
    v      *= s.lacunarity;
  }
  return sum / norm;
}

export interface FormationGrid {
  x0: number;
  z0: number;
  sp: number;
  w:  number;
  h:  number;
  // the ground made: target heights ( world ) and how much of the ground they take ( 0..1 )
  y:  Float32Array;
  k:  Float32Array;
}

const grids = new Map<string, FormationGrid>();
// the last one asked for: writing a formation into the ground looks it up for every sample ( five times ), with the
// same shape and the same ground ( keyed by the whole shape and a look at the ground, that took 30 s a 200 m one )
let last: { s: FormationShape; ground: unknown; g: FormationGrid } | null = null;

/**
 * The formation worked out over the ground ( `ground`: the height under a point without it ), from the cache when it's
 * the same formation over the same ground.
**/
export function formationGrid( s: FormationShape, ground: ( x: number, z: number ) => number ): FormationGrid {
  if ( last && last.s === s && last.ground === ground ) return last.g;
  return drive( formationGridSteps( s, ground ) );
}

/**
 * formationGrid, stopping now and then; it's then the one formationGrid gives for the same shape and ground.
**/
export function* formationGridSteps( s: FormationShape, ground: ( x: number, z: number ) => number ): Steps<FormationGrid> {
  if ( last && last.s === s && last.ground === ground ) return last.g;
  const g = yield* keyedGrid( s, ground );
  last    = { s, ground, g };
  return g;
}

function* keyedGrid( s: FormationShape, ground: ( x: number, z: number ) => number ): Steps<FormationGrid> {
  const [x0, z0, x1, z1] = formationBounds( s );
  // ( the ground checked at a few spots: a change under it makes it again )
  const probe = [[x0, z0], [x1, z1], [( x0 + x1 ) / 2, ( z0 + z1 ) / 2], [x0, z1], [x1, z0]].map( ( [x, z] ) => ground( x, z ).toFixed( 3 ) ).join( "," );
  const key   = JSON.stringify( s ) + probe;
  const had   = grids.get( key );
  if ( had ) return had;
  const g = yield* makeGrid( s, ground );
  if ( grids.size > 24 ) grids.delete( grids.keys().next().value! );
  grids.set( key, g );
  return g;
}

function* makeGrid( s: FormationShape, ground: ( x: number, z: number ) => number ): Steps<FormationGrid> {
  const [bx0, bz0, bx1, bz1] = formationBounds( s );
  const span                 = Math.max( bx1 - bx0, bz1 - bz0, 1 );
  const sp                   = Math.max( 0.5, span / MOST );
  const w                    = Math.ceil( ( bx1 - bx0 ) / sp ) + 1, h = Math.ceil( ( bz1 - bz0 ) / sp ) + 1;
  const y                    = new Float32Array( w * h ), k = new Float32Array( w * h ), under = new Float32Array( w * h );
  // the rim: the ground's mean height round the outline ( Raise, Carve and Set build from it )
  let rim                    = 0, n = 0;
  for ( let i = 0; i < s.points.length; i++ ) {
    const a = s.points[i], b = s.points[( i + 1 ) % s.points.length];
    for ( let t = 0; t < 1; t += 0.125 ) {
      const g = ground( a[0] + ( b[0] - a[0] ) * t, a[1] + ( b[1] - a[1] ) * t );
      if ( !Number.isNaN( g ) ) { rim += g; n++; }
    }
  }
  rim = n ? rim / n : 0;
  // ( the peak's reach: as asked, or half the outline's narrower side )
  const reach = s.peakWidth > 0 ? s.peakWidth : Math.max( 1, Math.min( bx1 - bx0, bz1 - bz0 ) / 2 );
  for ( let j = 0; j < h; j++ ) {
    if ( j % 8 === 7 ) yield;
    for ( let i = 0; i < w; i++ ) {
      const x = bx0 + i * sp, z = bz0 + j * sp, q = j * w + i;
      const d = insideBy( s.points, x, z ), g0 = ground( x, z ), g = Number.isNaN( g0 ) ? rim : g0;
      under[q] = g;
      if ( d <= 0 ) { y[q] = g; continue; }
      const dome = smooth( sat( d / reach ) );
      const lift = s.height * dome + s.roughness * noiseAt( s, x, z ) * ( 1 - s.onPeak + s.onPeak * dome );
      switch ( s.mode ) {
        case "raise": y[q] = Math.max( g, rim + s.baseY + lift ); break;
        case "carve": y[q] = Math.min( g, rim + s.baseY - lift ); break;
        case "set":   y[q] = rim + s.baseY + lift; break;
        default:      y[q] = g + s.baseY + lift;
      }
      k[q] = s.edgeBlend > 0 ? smooth( sat( d / s.edgeBlend ) ) : 1;
    }
  }
  // smoothing: box blurs of the change ( rounding off what's sharp ), inside the outline
  for ( let p = 0; p < ( s.smooth > 0 ? Math.max( 1, Math.round( s.smoothSteps ) ) : 0 ); p++ ) yield* blurChange( y, under, k, w, h, Math.max( 1, Math.round( ( s.smooth * 4 ) / sp ) ) );
  if ( s.thermal.on ) yield* thermal( y, k, w, h, sp, s.thermal );
  if ( s.hydraulic.on ) yield* hydraulic( y, k, w, h, s.hydraulic, s.seed );
  return { x0: bx0, z0: bz0, sp, w, h, y, k };
}

function* blurChange( y: Float32Array, under: Float32Array, k: Float32Array, w: number, h: number, r: number ): Steps<void> {
  const d = Float32Array.from( y, ( v, q ) => v - under[q] ), out = new Float32Array( d.length );
  for ( let j = 0; j < h; j++ ) {
    if ( j % 4 === 3 ) yield;
    for ( let i = 0; i < w; i++ ) {
      let sum = 0, n = 0;
      for ( let b = Math.max( 0, j - r ); b <= Math.min( h - 1, j + r ); b++ )
        for ( let a = Math.max( 0, i - r ); a <= Math.min( w - 1, i + r ); a++ ) { sum += d[b * w + a]; n++; }
      out[j * w + i] = sum / n;
    }
  }
  for ( let q = 0; q < y.length; q++ ) if ( k[q] > 0 ) y[q] = under[q] + out[q];
}

/**
 * Thermal erosion: where the ground is steeper than its angle of repose, some of what's above the angle slides to the
 * lower neighbours, each step.
**/
function* thermal( y: Float32Array, k: Float32Array, w: number, h: number, sp: number, o: FormationShape["thermal"] ): Steps<void> {
  const talus = Math.tan( ( Math.max( 1, Math.min( 89, o.repose ) ) * Math.PI ) / 180 ) * sp, move = new Float32Array( y.length );
  const nb    = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for ( let it = 0; it < Math.round( o.iterations ); it++ ) {
    yield;
    move.fill( 0 );
    for ( let j = 1; j < h - 1; j++ )
      for ( let i = 1; i < w - 1; i++ ) {
        const q = j * w + i;
        if ( k[q] <= 0 ) continue;
        let total = 0, most = 0;
        for ( const [a, b] of nb ) { const d = y[q] - y[( j + b ) * w + i + a]; if ( d > talus ) { total += d - talus; most = Math.max( most, d - talus ); } }
        if ( total <= 0 ) continue;
        const amount = most * 0.5 * o.amount;
        for ( const [a, b] of nb ) {
          const r = ( j + b ) * w + i + a, d = y[q] - y[r];
          if ( d > talus ) { const m = ( amount * ( d - talus ) ) / total; move[q] -= m; move[r] += m; }
        }
      }
    for ( let q = 0; q < y.length; q++ ) if ( k[q] > 0 ) y[q] += move[q];
  }
}

/**
 * Hydraulic erosion: droplets dropped all over the formation run downhill ( keeping some of their way: inertia ),
 * picking up ground where they speed up and can carry more, dropping it where they slow, drying up as they go.
**/
function* hydraulic( y: Float32Array, k: Float32Array, w: number, h: number, o: FormationShape["hydraulic"], seed: number ): Steps<void> {
  let rnd     = ( seed * 2654435761 ) >>> 0 || 1;
  const next  = () => ( ( rnd = ( Math.imul( rnd, 1664525 ) + 1013904223 ) >>> 0 ) / 4294967296 );
  const R     = Math.max( 1, Math.round( o.radius ) );
  const drops = Math.round( Math.max( 0, o.droplets ) * w * h );
  const life  = Math.max( 1, Math.round( o.lifetime ) );
  const at    = ( x: number, z: number ) => {
    const i = Math.min( w - 2, Math.max( 0, Math.floor( x ) ) ), j = Math.min( h - 2, Math.max( 0, Math.floor( z ) ) ), u = x - i, v = z - j;
    const a = y[j * w + i], b = y[j * w + i + 1], c = y[( j + 1 ) * w + i], d = y[( j + 1 ) * w + i + 1];
    return { hgt: a * ( 1 - u ) * ( 1 - v ) + b * u * ( 1 - v ) + c * ( 1 - u ) * v + d * u * v, gx: ( b - a ) * ( 1 - v ) + ( d - c ) * v, gz: ( c - a ) * ( 1 - u ) + ( d - b ) * u };
  };
  const take = ( x: number, z: number, amount: number ) => {
    // ( spread over a round brush, so channels are as wide as the radius )
    const ci                     = Math.round( x ), cj = Math.round( z );
    let sum                      = 0;
    const ws: [number, number][] = [];
    for ( let b = -R; b <= R; b++ )
      for ( let a = -R; a <= R; a++ ) {
        const i = ci + a, j = cj + b, d = Math.hypot( a, b );
        if ( d > R || i < 0 || j < 0 || i >= w || j >= h || k[j * w + i] <= 0 ) continue;
        const wt = 1 - d / ( R + 1 );
        ws.push( [j * w + i, wt] );
        sum += wt;
      }
    // ( as much as the formation has of the ground there: its blended edge hardly wears )
    for ( const [q, wt] of ws ) y[q] -= ( ( amount * wt ) / ( sum || 1 ) ) * k[q];
  };
  // what a droplet carries, dropped where it is ( it stops: dried up, or at the outline )
  const drop = ( x: number, z: number, amount: number ) => {
    const i = Math.min( w - 2, Math.max( 0, Math.floor( x ) ) ), j = Math.min( h - 2, Math.max( 0, Math.floor( z ) ) ), u = x - i, v = z - j;
    y[j * w + i]           += amount * ( 1 - u ) * ( 1 - v );
    y[j * w + i + 1]       += amount * u * ( 1 - v );
    y[( j + 1 ) * w + i]     += amount * ( 1 - u ) * v;
    y[( j + 1 ) * w + i + 1] += amount * u * v;
  };
  for ( let n = 0; n < drops; n++ ) {
    if ( n % 256 === 255 ) yield;
    let x = next() * ( w - 1 ), z = next() * ( h - 1 ), dx = 0, dz = 0, speed = 1, water = 1, sediment = 0;
    if ( k[Math.round( z ) * w + Math.round( x )] <= 0 ) continue;
    for ( let step = 0; step < life; step++ ) {
      const here = at( x, z );
      dx         = dx * o.inertia - here.gx * ( 1 - o.inertia );
      dz         = dz * o.inertia - here.gz * ( 1 - o.inertia );
      const len  = Math.hypot( dx, dz );
      if ( len < 1e-6 ) break;
      dx /= len;
      dz /= len;
      const nx = x + dx, nz = z + dz;
      if ( nx < 0 || nz < 0 || nx > w - 1 || nz > h - 1 || k[Math.round( nz ) * w + Math.round( nx )] <= 0 ) break;
      const dh       = at( nx, nz ).hgt - here.hgt;
      const capacity = Math.max( -dh, 0.01 ) * speed * water * o.capacity;
      if ( sediment > capacity || dh > 0 ) {
        // ( dropped: going uphill, it fills the hollow it's in; else what it can't carry )
        const put = dh > 0 ? Math.min( dh, sediment ) : ( sediment - capacity ) * o.deposit;
        sediment -= put;
        drop( x, z, put );
      } else {
        const cut = Math.min( ( capacity - sediment ) * o.erode, -dh );
        take( x, z, cut );
        sediment += cut;
      }
      speed = Math.sqrt( Math.max( 0, speed * speed - dh ) );
      water *= 1 - o.evaporate;
      x      = nx;
      z      = nz;
    }
    if ( sediment > 0 ) drop( x, z, sediment );
  }
}

/**
 * The formation's height and how much of the ground it takes at a point, or null outside it.
**/
export function formationAt( s: FormationShape, x: number, z: number, ground: ( x: number, z: number ) => number ): { h: number; blend: number } | null {
  if ( s.points.length < 3 ) return null;
  const g = formationGrid( s, ground );
  const u = ( x - g.x0 ) / g.sp, v = ( z - g.z0 ) / g.sp;
  if ( u < 0 || v < 0 || u > g.w - 1 || v > g.h - 1 ) return null;
  const i     = Math.min( g.w - 2, Math.floor( u ) ), j = Math.min( g.h - 2, Math.floor( v ) ), a = u - i, b = v - j;
  const lerp  = ( A: Float32Array ) => ( A[j * g.w + i] * ( 1 - a ) + A[j * g.w + i + 1] * a ) * ( 1 - b ) + ( A[( j + 1 ) * g.w + i] * ( 1 - a ) + A[( j + 1 ) * g.w + i + 1] * a ) * b;
  const blend = lerp( g.k );
  return blend > 0 ? { h: lerp( g.y ), blend } : null;
}
