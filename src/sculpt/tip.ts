// The brush tip: how strong the brush is at each point under it ( falloff, round or square, alpha stamps ).

import { evalCurve, type Curve } from "../core/curve";
import { fbm, ridged, valueNoise } from "../terrain/generate";
import type { AlphaId, BrushSettings, FalloffPreset } from "./brushes";

const clamp01 = ( x: number ) => ( x < 0 ? 0 : x > 1 ? 1 : x );

// Falloff curves as Blender names them: f( t ), t = 0 at the core edge … 1 at the rim, value 1 → 0.
// ( Blender's shapes; formulas are the standard ones for each name. )
export const FALLOFFS: Record<Exclude<FalloffPreset, "custom">, { label: string; f: ( t: number ) => number }> = {
  smooth:   { label: "Smooth",   f: ( t ) => 1 - t * t * ( 3 - 2 * t ) },
  smoother: { label: "Smoother", f: ( t ) => 1 - t * t * t * ( t * ( t * 6 - 15 ) + 10 ) },
  sphere:   { label: "Sphere",   f: ( t ) => Math.sqrt( Math.max( 0, 1 - t * t ) ) },
  root:     { label: "Root",     f: ( t ) => 1 - Math.sqrt( t ) },
  sharp:    { label: "Sharp",    f: ( t ) => ( 1 - t ) * ( 1 - t ) },
  linear:   { label: "Linear",   f: ( t ) => 1 - t },
  sharper:  { label: "Sharper",  f: ( t ) => ( 1 - t ) ** 4 },
  constant: { label: "Constant", f: () => 1 },
};

/**
 * Falloff weight at `d` ( distance / radius, 0..1+ ).
**/
export function falloffAt( d: number, preset: FalloffPreset, hardness: number, curve: Curve ): number {
  if ( d >= 1 ) return 0;
  const h = clamp01( hardness );
  if ( d <= h && preset !== "custom" ) return 1;
  const t = preset === "custom" ? d : ( d - h ) / Math.max( 1e-6, 1 - h );
  return clamp01( preset === "custom" ? evalCurve( curve, t ) : FALLOFFS[preset].f( t ) );
}

/**
 * Distance to the rim, 0..1, for a tip between round ( roundness 1 ) and square ( 0 ), in brush-local coords.
**/
export function tipDistance( lx: number, lz: number, roundness: number ): number {
  if ( roundness >= 0.999 ) return Math.hypot( lx, lz );
  // superellipse: p = 2 ( circle ) … ~12 ( square with slightly rounded corners )
  const p = 2 + ( 1 - clamp01( roundness ) ) * 10;
  return ( Math.abs( lx ) ** p + Math.abs( lz ) ** p ) ** ( 1 / p );
}

// ---------------------------------------------------------------- alphas

// Alpha stamps: greyscale height shapes, ALPHA_N × ALPHA_N, 0..1, used as a multiplier on the falloff.
export const ALPHA_N = 128;

export const ALPHAS: Record<Exclude<AlphaId, "none">, { label: string; tip: string; make: ( u: number, v: number ) => number }> = {
  crater: {
    label: "Crater",
    tip:   "A raised rim around a dip (Ctrl digs a pit with a ring)",
    make: ( u, v ) => {
      const r = Math.hypot( u, v );
      return clamp01( Math.exp( -( ( r - 0.62 ) ** 2 ) / 0.02 ) - 0.55 * Math.exp( -( r * r ) / 0.12 ) + 0.3 );
    },
  },
  rocks: {
    label: "Rocks",
    tip:   "Lumpy rock and boulder shapes",
    make: ( u, v ) => {
      const n = 1 - Math.abs( valueNoise( u * 3.1 + 7, v * 3.1 + 3, 11 ) );
      return clamp01( n ** 3 * 1.5 + fbm( u * 6, v * 6, 3, 5 ) * 0.25 );
    },
  },
  ridges: {
    label: "Ridges",
    tip:   "Sharp mountain ridges",
    make:  ( u, v ) => clamp01( ridged( u * 1.6 + 4, v * 1.6 + 2, 5, 3 ) * 1.6 - 0.2 ),
  },
  dunes: {
    label: "Dunes",
    tip:   "Wind-blown waves (rotate it to set their direction)",
    make: ( u, v ) => {
      const w = u * 4 + fbm( u * 2, v * 2, 3, 9 ) * 1.2;
      const s = w - Math.floor( w );
      return clamp01( s < 0.8 ? s / 0.8 : ( 1 - s ) / 0.2 ) * 0.9 + 0.05;
    },
  },
  peaks: {
    label: "Peaks",
    tip:   "A cluster of pointy peaks",
    make:  ( u, v ) => clamp01( ridged( u * 1.2 + 9, v * 1.2 + 1, 4, 21 ) ** 1.6 * 1.4 ),
  },
  cliffs: {
    label: "Cliffs",
    tip:   "Stepped, layered rock",
    make: ( u, v ) => {
      const n     = ( fbm( u * 1.5 + 2, v * 1.5 + 6, 4, 13 ) + 1 ) / 2;
      const steps = 5, x = n * steps, k = Math.floor( x ), f = x - k;
      return clamp01( ( k + Math.min( 1, f * 4 ) ) / steps );
    },
  },
  mogul: {
    label: "Moguls",
    tip:   "Bumps in a staggered grid, like a mogul run",
    make: ( u, v ) => {
      const k = 3.2;
      const a = Math.sin( ( u * k + 0.5 * Math.floor( v * k ) ) * Math.PI * 2 ) * 0.5 + 0.5;
      const b = Math.sin( v * k * Math.PI * 2 + Math.PI / 2 ) * 0.5 + 0.5;
      return clamp01( a * b ) ** 1.4;
    },
  },
};

const alphaCache = new Map<string, Float32Array>();

/**
 * The alpha as a grid, made once. Custom alphas ( imported images ) are registered with `setCustomAlpha`.
**/
export function alphaGrid( id: AlphaId ): Float32Array | null {
  if ( id === "none" ) return null;
  let g = alphaCache.get( id );
  if ( !g ) {
    g       = new Float32Array( ALPHA_N * ALPHA_N );
    const a = ALPHAS[id];
    for ( let j = 0; j < ALPHA_N; j++ )
      for ( let i = 0; i < ALPHA_N; i++ ) g[j * ALPHA_N + i] = a.make( ( i / ( ALPHA_N - 1 ) ) * 2 - 1, ( j / ( ALPHA_N - 1 ) ) * 2 - 1 );
    alphaCache.set( id, g );
  }
  return g;
}

/**
 * Alpha value at brush-local ( u, v ) in -1..1 ( bilinear ); outside the square = 0.
**/
export function sampleAlpha( g: Float32Array, u: number, v: number ): number {
  if ( u <= -1 || u >= 1 || v <= -1 || v >= 1 ) return 0;
  const fx = ( ( u + 1 ) / 2 ) * ( ALPHA_N - 1 ), fz = ( ( v + 1 ) / 2 ) * ( ALPHA_N - 1 );
  const i  = Math.min( ALPHA_N - 2, Math.floor( fx ) ), j = Math.min( ALPHA_N - 2, Math.floor( fz ) );
  const a  = fx - i, b = fz - j, p = j * ALPHA_N + i;
  return ( g[p] * ( 1 - a ) + g[p + 1] * a ) * ( 1 - b ) + ( g[p + ALPHA_N] * ( 1 - a ) + g[p + ALPHA_N + 1] * a ) * b;
}

// A dab's tip, ready to evaluate at world points.
export interface Tip {
  cx:     number;
  cz:     number;
  r:      number;
  // radians
  angle:  number;
  weight: ( x: number, z: number ) => number;
}

export function makeTip( s: BrushSettings, cx: number, cz: number, r: number, angle: number, useAlpha = true ): Tip {
  const ca     = Math.cos( angle ), sa = Math.sin( angle );
  const alpha  = useAlpha ? alphaGrid( s.alpha ) : null;
  const square = s.roundness < 0.999;
  // falloff as a lookup table ( it's evaluated for every point under the brush, every dab )
  const N      = 1024, lut = new Float32Array( N + 2 );
  for ( let k = 0; k <= N + 1; k++ ) lut[k] = falloffAt( k / N, s.falloff, s.hardness, s.curve );
  const inv = 1 / r;
  return {
    cx, cz, r, angle,
    weight: ( x, z ) => {
      const dx = ( x - cx ) * inv, dz = ( z - cz ) * inv;
      let d2   = dx * dx + dz * dz;
      if ( !square && d2 >= 1 ) return 0;
      let lx = dx, lz = dz;
      if ( square || alpha ) {
        lx = dx * ca + dz * sa;
        lz = -dx * sa + dz * ca;
      }
      let d: number;
      if ( square ) {
        d = tipDistance( lx, lz, s.roundness );
        if ( d >= 1 ) return 0;
      } else d = Math.sqrt( d2 );
      const f = d * N, k = f | 0;
      let w   = lut[k] + ( lut[k + 1] - lut[k] ) * ( f - k );
      if ( alpha ) w *= sampleAlpha( alpha, lx, lz );
      return w;
    },
  };
}
