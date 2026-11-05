// Formations ( Map-Tools' Formation Builder, its FormationEdit.compute step for step ): a landform in an outline drawn
// on the ground — a dome ( its cross-section a curve ) and noise ( smooth hills, ridged crests, lumpy billows ) laid
// over the ground four ways ( added on top, only raising it, only carving it, or set outright ), smoothed, worn by
// thermal erosion ( steep slopes slumping to their angle of repose ) and hydraulic erosion ( droplets of rain running
// down, cutting channels and dropping what they carry where they slow ), then snowed on ( by height, slope and shape;
// rock shows where it can't hold ). Worked out on the ground's own height samples over the outline ( and 8 more round
// it ), heights as Map-Tools keeps them ( 0..1 of the ground's height range ), on the graphics card when there is one
// ( formationGpu.ts ), once for each version of the formation and the ground under it, and looked up from there.

import { computeDevice } from "../../../core/gpu";
import { evalCurve } from "../../../core/curve";
import { terrain } from "../../terrain";
import { simulateGpu } from "./formationGpu";
import type { FormationShape } from "./types";

// Work done a little at a time ( a live edit's formation worked out over a few frames, the view drawn meanwhile ).
export type Steps<T> = Generator<void, T, void>;

const drive = <T>( g: Steps<T> ): T => {
  for ( ;; ) {
    const r = g.next();
    if ( r.done ) return r.value;
  }
};

// ( Map-Tools' fixed numbers: the profile's samples, the samples worked out round the outline, the heights' scale on
// the integer grid the droplets wear, the spacing and height range with no ground under it )
const PROFILE_RES = 256, PAD = 8, HEIGHT_SCALE = 1048576, LONE_SPACING = 1000 / 4096, LONE_RANGE = 600;

// ( milliseconds the graphics card's given before a formation's worked out here )
const GPU_PATIENCE = 20000;

const sat         = ( x: number ) => ( x < 0 ? 0 : x > 1 ? 1 : x );
const smoothstep  = ( a: number, b: number, x: number ) => { const t = sat( ( x - a ) / ( b - a ) ); return t * t * ( 3 - 2 * t ); };
const lerp        = ( a: number, b: number, t: number ) => a + ( b - a ) * t;
const clamp       = ( v: number, a: number, b: number ) => ( v < a ? a : v > b ? b : v );

/**
 * A point's signed distance to an outline ( + inside ).
**/
export function insideBy( pts: [number, number][], x: number, z: number ) {
  let inside = false, best = Infinity;
  for ( let i = 0, j = pts.length - 1; i < pts.length; j = i++ ) {
    const [ax, az] = pts[i], [bx, bz] = pts[j];
    if ( az > z !== bz > z && x < ( ( bx - ax ) * ( z - az ) ) / ( bz - az ) + ax ) inside = !inside;
    const ux = bx - ax, uz = bz - az, l2 = Math.max( ux * ux + uz * uz, 1e-6 );
    const t  = sat( ( ( x - ax ) * ux + ( z - az ) * uz ) / l2 );
    best     = Math.min( best, ( x - ax - ux * t ) ** 2 + ( z - az - uz * t ) ** 2 );
  }
  return inside ? Math.sqrt( best ) : -Math.sqrt( best );
}

export function formationBounds( s: FormationShape ): [number, number, number, number] {
  const xs = s.points.map( ( p ) => p[0] ), zs = s.points.map( ( p ) => p[1] );
  return [Math.min( ...xs ), Math.min( ...zs ), Math.max( ...xs ), Math.max( ...zs )];
}

/**
 * The outline's area ( square metres ).
**/
export function outlineArea( pts: [number, number][] ) {
  let sum = 0;
  for ( let i = 0, j = pts.length - 1; i < pts.length; j = i++ ) sum += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs( sum ) * 0.5;
}

/**
 * The point deepest inside the outline ( on a 28 × 28 grid over it ) and how deep ( FormationArea.PeakPoint ).
**/
export function peakPoint( pts: [number, number][] ): { at: [number, number]; reach: number } {
  let at: [number, number] = [pts.reduce( ( a, p ) => a + p[0], 0 ) / Math.max( 1, pts.length ), pts.reduce( ( a, p ) => a + p[1], 0 ) / Math.max( 1, pts.length )];
  let reach                = 0;
  if ( pts.length < 3 ) return { at, reach };
  const xs = pts.map( ( p ) => p[0] ), zs = pts.map( ( p ) => p[1] );
  const x0 = Math.min( ...xs ), z0 = Math.min( ...zs ), dx = Math.max( ...xs ) - x0, dz = Math.max( ...zs ) - z0;
  for ( let yi = 0; yi <= 28; yi++ )
    for ( let xi = 0; xi <= 28; xi++ ) {
      const x = x0 + ( dx * xi ) / 28, z = z0 + ( dz * yi ) / 28, d = insideBy( pts, x, z );
      if ( d > reach ) { reach = d; at = [x, z]; }
    }
  return { at, reach };
}

// The samples a formation's worked out on: the ground's own under its peak ( x0 + i·sp, z0 + j·sp ), and the height
// range Map-Tools' heights are fractions of ( the ground's: posY + h·sizeY ).
export interface FormationFrame {
  x0:    number;
  z0:    number;
  sp:    number;
  w:     number;
  h:     number;
  posY:  number;
  sizeY: number;
}

/**
 * The chunk a formation belongs to ( under its peak, else the first it's over ), if any.
**/
export function formationChunk( s: FormationShape ) {
  const at = peakPoint( s.points ).at, ci = terrain.chunkAt( at[0], at[1] );
  if ( ci >= 0 ) return terrain.chunks[ci];
  const [x0, z0, x1, z1] = formationBounds( s );
  return terrain.chunks.find( ( c ) => x1 >= c.position[0] && x0 <= c.position[0] + c.size[0] && z1 >= c.position[2] && z0 <= c.position[2] + c.size[2] ) ?? null;
}

/**
 * The samples `s` is worked out on ( `spacing`: other than the ground's ).
**/
export function formationFrame( s: FormationShape, spacing?: number ): FormationFrame {
  const c                    = formationChunk( s );
  const sp                   = spacing ?? ( c ? c.spacing : LONE_SPACING ), ox = c ? c.position[0] : 0, oz = c ? c.position[2] : 0;
  const [bx0, bz0, bx1, bz1] = formationBounds( s );
  const i0                   = Math.floor( ( bx0 - ox ) / sp ) - PAD, i1 = Math.ceil( ( bx1 - ox ) / sp ) + PAD;
  const j0                   = Math.floor( ( bz0 - oz ) / sp ) - PAD, j1 = Math.ceil( ( bz1 - oz ) / sp ) + PAD;
  return { x0: ox + i0 * sp, z0: oz + j0 * sp, sp, w: i1 - i0 + 1, h: j1 - j0 + 1, posY: c ? c.position[1] : 0, sizeY: c ? c.size[1] : LONE_RANGE };
}

/**
 * How many noise octaves the ground's samples can show ( finer would only alias: spikes ), as asked or fewer.
**/
export function effectiveOctaves( s: FormationShape, sp: number ) {
  const oct    = clamp( Math.round( s.detail ), 1, 9 );
  const finest = Math.max( sp * 3, 0.001 );
  if ( s.featureSize <= finest || s.lacunarity <= 1.001 ) return 1;
  const allowed = 1 + Math.floor( Math.log( s.featureSize / finest ) / Math.log( s.lacunarity ) );
  return clamp( Math.min( oct, allowed ), 1, 9 );
}

// Everything the simulation is given ( the same on the graphics card ): the samples, the outline, the profile, the
// ground ( 0..1 ), and the settings as FormationBuilder hands them to its shader.
export interface SimInput {
  w:           number;
  h:           number;
  sp:          number;
  x0:          number;
  z0:          number;
  posY:        number;
  sizeY:       number;
  poly:        Float32Array;
  dome:        Float32Array;
  ground:      Float32Array;
  edgeFalloff: number;
  domeReach:   number;
  peakHeight:  number;
  blendMode:   number;
  baseHeight:  number;
  baseLevel:   number;
  noiseType:   number;
  noiseHeight: number;
  noiseScale:  number;
  octaves:     number;
  lacunarity:  number;
  gain:        number;
  warp:        number;
  seed:        number;
  onPeak:      number;
  // ( NaN: not mirrored ), and where the noise is read from
  mirrorX:     number;
  mirrorZ:     number;
  noiseOX:     number;
  noiseOZ:     number;
  smooth:      number;
  smoothIters: number;
  thermal:     { iters: number; talus: number; strength: number } | null;
  hydraulic:   { droplets: number; lifetime: number; inertia: number; capacity: number; deposit: number; erode: number; evaporate: number; radius: number; seed: number; maxErodeStep: number } | null;
  snow:        { lineLow: number; lineHigh: number; slopeStart: number; slopeFull: number; crevice: number; stencil: number; settle: number; amount: number; addsHeight: number; rock: number } | null;
}

// What it makes: the heights ( 0..1, before they're blended into the ground ), how much of the ground they take, and
// the rock showing through the snow ( 0..1 ).
export interface SimOutput {
  h:    Float32Array;
  k:    Float32Array;
  rock: Float32Array;
}

/**
 * Whether working the formation out in full ( erosion, the snow softened ) differs from its quick version.
**/
export const simulates = ( s: FormationShape ) => ( s.thermal.on && s.thermal.iterations > 0 && s.thermal.amount > 0 ) || s.hydraulic.on || ( s.snow.on && s.snow.soften > 0 );

/**
 * The simulation's input for `s` over `ground` ( absolute heights; NaN off the terrain ), in full or quick ( as
 * Map-Tools does while a handle's held: no erosion, the snow not softened ).
**/
export function* simInput( s: FormationShape, ground: ( x: number, z: number ) => number, full: boolean, F: FormationFrame ): Steps<SimInput> {
  const { w, h, sp, x0, z0, posY, sizeY } = F;
  const n                                 = s.points.length;
  const poly                              = new Float32Array( n * 2 );
  s.points.forEach( ( p, k ) => { poly[k * 2] = p[0]; poly[k * 2 + 1] = p[1]; } );
  const dome = new Float32Array( PROFILE_RES );
  for ( let i = 0; i < PROFILE_RES; i++ ) dome[i] = s.profile?.length ? evalCurve( s.profile, i / ( PROFILE_RES - 1 ) ) : i / ( PROFILE_RES - 1 );
  // the rim: the ground's mean height at the outline's points ( Raise, Carve and Set build from it )
  let rim = 0, rn = 0;
  for ( const p of s.points ) {
    const g = ground( p[0], p[1] );
    if ( !Number.isNaN( g ) ) { rim += g - posY; rn++; }
  }
  const baseLevel = rn ? rim / rn / sizeY : 0;
  const G         = new Float32Array( w * h );
  for ( let j = 0; j < h; j++ ) {
    if ( j % 32 === 31 ) yield;
    for ( let i = 0; i < w; i++ ) {
      const g      = ground( x0 + i * sp, z0 + j * sp );
      G[j * w + i] = Number.isNaN( g ) ? baseLevel : ( g - posY ) / sizeY;
    }
  }
  const area = outlineArea( s.points ), cell = sp * sp;
  const hy   = s.hydraulic, th = s.thermal, sn = s.snow;
  return {
    w, h, sp, x0, z0, posY, sizeY, poly, dome, ground: G,
    edgeFalloff: s.edgeBlend, domeReach: s.peakWidth, peakHeight: s.height, blendMode: ["add", "raise", "carve", "set"].indexOf( s.mode ),
    baseHeight:  s.baseY / sizeY, baseLevel, noiseType: ["smooth", "ridged", "billow"].indexOf( s.style ), noiseHeight: s.roughness, noiseScale: s.featureSize,
    octaves:     effectiveOctaves( s, sp ), lacunarity: s.lacunarity, gain: s.gain, warp: s.warp, seed: ( Math.imul( s.seed | 0, 1013904223 ) + 1 ) >>> 0, onPeak: s.onPeak,
    mirrorX:     s.noiseMirror?.x ?? NaN, mirrorZ: s.noiseMirror?.z ?? NaN, noiseOX: s.noiseOffset?.[0] ?? 0, noiseOZ: s.noiseOffset?.[1] ?? 0,
    smooth:      s.smooth, smoothIters: s.smooth > 0 && s.smoothSteps > 0 ? Math.min( Math.round( s.smoothSteps ), 64 ) : 0,
    thermal:     full && th.on && th.iterations > 0 && th.amount > 0 ? { iters: Math.min( Math.round( th.iterations ), 512 ), talus: ( Math.tan( ( clamp( th.repose, 1, 85 ) * Math.PI ) / 180 ) * sp ) / sizeY, strength: th.amount } : null,
    hydraulic:   full && hy.on
      ? {
          droplets:     clamp( Math.round( ( area / Math.max( cell, 1e-6 ) ) * Math.max( hy.droplets, 0.02 ) ), 256, 400000 ),
          lifetime:     clamp( Math.round( hy.lifetime ), 8, 4000 ),
          inertia:      sat( hy.inertia ), capacity: Math.max( hy.capacity, 0.01 ), deposit: sat( hy.deposit ), erode: sat( hy.erode ), evaporate: sat( hy.evaporate ),
          radius:       clamp( Math.round( hy.radius ), 1, 4 ), seed: ( Math.imul( s.seed | 0, 747796405 ) + 1 ) >>> 0,
          maxErodeStep: Math.max( 2 * sp, 0.5 ) / sizeY,
        }
      : null,
    snow: sn.on
      ? {
          lineLow: sn.lineLow, lineHigh: sn.lineHigh, slopeStart: sn.rockFrom, slopeFull: sn.rockFull, crevice: sn.crevices, stencil: clamp( Math.round( 0.5 / sp ), 1, 8 ),
          settle:  full ? Math.min( Math.max( 0, Math.round( sn.soften ) ), 64 ) : 0, amount: sn.depth / sizeY, addsHeight: sn.addsHeight, rock: sn.rock,
        }
      : null,
  };
}

// ---- the shader's kernels, here ( no graphics card, or one that can't wait )

const hash = ( x: number, y: number, s: number ) => {
  let h = ( Math.imul( x, 374761393 ) + Math.imul( y, 668265263 ) + Math.imul( s, 362437 ) ) >>> 0;
  h     = Math.imul( h ^ ( h >>> 13 ), 1274126177 ) >>> 0;
  return ( h ^ ( h >>> 16 ) ) >>> 0;
};

const hash1 = ( v: number ) => {
  let x = v >>> 0;
  x     = Math.imul( x ^ ( x >>> 16 ), 0x7feb352d );
  x     = Math.imul( x ^ ( x >>> 15 ), 0x846ca68b );
  return ( x ^ ( x >>> 16 ) ) >>> 0;
};

function perlin( px: number, py: number, s: number ) {
  const ix = Math.floor( px ), iy = Math.floor( py ), fx = px - ix, fy = py - iy;
  const ux = fx * fx * ( 3 - 2 * fx ), uy = fy * fy * ( 3 - 2 * fy );
  const g  = ( i: number, j: number, dx: number, dy: number ) => {
    const ang = ( ( hash( ( i + 8192 ) >>> 0, ( j + 8192 ) >>> 0, s ) & 0xffff ) / 65535 ) * 6.28318530718;
    return Math.cos( ang ) * dx + Math.sin( ang ) * dy;
  };
  const a = g( ix, iy, fx, fy ), b = g( ix + 1, iy, fx - 1, fy ), c = g( ix, iy + 1, fx, fy - 1 ), d = g( ix + 1, iy + 1, fx - 1, fy - 1 );
  return lerp( lerp( a, b, ux ), lerp( c, d, ux ), uy );
}

function fbm( I: SimInput, px: number, py: number, oct: number, s: number ) {
  let sum = 0, amp = 0.5, norm = 0;
  for ( let o = 0; o < oct; o++ ) {
    sum  += perlin( px, py, ( s + o ) >>> 0 ) * amp;
    norm += amp;
    amp  *= I.gain;
    px   *= I.lacunarity;
    py   *= I.lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

function ridged( I: SimInput, px: number, py: number, oct: number, s: number ) {
  let sum = 0, amp = 0.5, norm = 0, weight = 1;
  for ( let o = 0; o < oct; o++ ) {
    let n   = 1 - Math.abs( perlin( px, py, ( s + o ) >>> 0 ) );
    n      *= n;
    n      *= weight;
    weight  = sat( n );
    sum    += n * amp;
    norm   += amp;
    amp    *= I.gain;
    px     *= I.lacunarity;
    py     *= I.lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

function noiseAt( I: SimInput, x: number, z: number, domeT: number ) {
  if ( !Number.isNaN( I.mirrorX ) ) x = I.mirrorX - x;
  if ( !Number.isNaN( I.mirrorZ ) ) z = I.mirrorZ - z;
  let u           = ( x - I.noiseOX ) / Math.max( I.noiseScale, 0.01 ), v = ( z - I.noiseOZ ) / Math.max( I.noiseScale, 0.01 );
  const warpOct   = Math.min( I.octaves, 4 );
  if ( I.warp > 0 ) {
    const qx = fbm( I, u + 11.5, v + 11.5, warpOct, ( I.seed + 37 ) >>> 0 ), qy = fbm( I, u + 27.3, v + 27.3, warpOct, ( I.seed + 91 ) >>> 0 );
    u       += qx * I.warp;
    v       += qy * I.warp;
  }
  const n = I.noiseType === 1 ? ridged( I, u, v, I.octaves, I.seed ) - 0.4 : I.noiseType === 2 ? ( Math.abs( fbm( I, u, v, I.octaves, I.seed ) ) - 0.2 ) * 2 : fbm( I, u, v, I.octaves, I.seed );
  return n * I.noiseHeight * lerp( 1, domeT, sat( I.onPeak ) );
}

function sampleDome( I: SimInput, t: number ) {
  const fi = sat( t ) * ( I.dome.length - 1 ), lo = Math.floor( fi ), hi = Math.min( lo + 1, I.dome.length - 1 );
  return lerp( I.dome[lo], I.dome[hi], fi - lo );
}

function polyDistance( I: SimInput, x: number, z: number ) {
  const P = I.poly, n = P.length / 2;
  let inside = false, md = 1e30;
  for ( let i = 0, j = n - 1; i < n; j = i++ ) {
    const ax = P[i * 2], ay = P[i * 2 + 1], bx = P[j * 2], by = P[j * 2 + 1];
    if ( ay > z !== by > z && x < ( ( bx - ax ) * ( z - ay ) ) / ( by - ay ) + ax ) inside = !inside;
    const abx = bx - ax, aby = by - ay, t = sat( ( ( x - ax ) * abx + ( z - ay ) * aby ) / Math.max( abx * abx + aby * aby, 1e-6 ) );
    md        = Math.min( md, ( x - ax - abx * t ) ** 2 + ( z - ay - aby * t ) ** 2 );
  }
  return inside ? Math.sqrt( md ) : -1;
}

/**
 * The whole of FormationBuilder.RunFormation and its shader, here.
**/
export function* simulateCpu( I: SimInput ): Steps<SimOutput> {
  const { w, h } = I, N = w * h;
  const X        = ( v: number ) => ( v < 0 ? 0 : v > w - 1 ? w - 1 : v ), Y = ( v: number ) => ( v < 0 ? 0 : v > h - 1 ? h - 1 : v );
  let cur        = new Float32Array( N ), alt = new Float32Array( N );
  const base     = I.ground, mask = new Float32Array( N );
  const swap     = () => { const t = cur; cur = alt; alt = t; };
  // Generate
  for ( let y = 0; y < h; y++ ) {
    if ( y % 16 === 15 ) yield;
    for ( let x = 0; x < w; x++ ) {
      const q = y * w + x, orig = base[q], px = I.x0 + x * I.sp, pz = I.z0 + y * I.sp;
      cur[q]  = orig;
      const d = polyDistance( I, px, pz );
      if ( d < 0 ) continue;
      let m         = I.edgeFalloff > 0 ? sat( d / I.edgeFalloff ) : 1;
      m             = m * m * ( 3 - 2 * m );
      const domeT   = I.domeReach > 0 ? sat( d / I.domeReach ) : 1;
      const surf    = ( sampleDome( I, domeT ) * I.peakHeight + noiseAt( I, px, pz, domeT ) ) / I.sizeY + I.baseHeight;
      if ( I.blendMode === 0 ) cur[q] = orig + surf * m;
      else {
        const target = I.baseLevel + surf;
        cur[q]       = lerp( orig, I.blendMode === 1 ? Math.max( orig, target ) : I.blendMode === 2 ? Math.min( orig, target ) : target, m );
      }
      mask[q] = m;
    }
  }
  const blur = ( src: Float32Array, dst: Float32Array, f: ( q: number, v: number, avg: number ) => number ) => {
    for ( let y = 0; y < h; y++ )
      for ( let x = 0; x < w; x++ ) {
        let sum = 0;
        for ( let dy = -1; dy <= 1; dy++ ) for ( let dx = -1; dx <= 1; dx++ ) sum += src[Y( y + dy ) * w + X( x + dx )];
        dst[y * w + x] = f( y * w + x, src[y * w + x], sum / 9 );
      }
  };
  // Smooth
  for ( let i = 0; i < I.smoothIters; i++ ) {
    yield;
    blur( cur, alt, ( q, v, avg ) => lerp( v, avg, I.smooth * mask[q] ) );
    swap();
  }
  const thermal = ( talus: number, strength: number ) => {
    for ( let y = 0; y < h; y++ )
      for ( let x = 0; x < w; x++ ) {
        const c = cur[y * w + x];
        let net = 0;
        for ( let k = 0; k < 8; k++ ) {
          const dx     = k === 0 || k === 4 || k === 6 ? -1 : k === 1 || k === 5 || k === 7 ? 1 : 0;
          const dy     = k === 2 || k === 4 || k === 5 ? -1 : k === 3 || k === 6 || k === 7 ? 1 : 0;
          const dh     = c - cur[Y( y + dy ) * w + X( x + dx )];
          const flow   = 0.125 * strength * Math.max( 0, Math.abs( dh ) - ( k < 4 ? talus : talus * Math.SQRT2 ) );
          net         += dh > 0 ? -flow : flow;
        }
        alt[y * w + x] = c + net;
      }
    swap();
  };
  // Thermal
  if ( I.thermal ) for ( let i = 0; i < I.thermal.iters; i++ ) { yield; thermal( I.thermal.talus, I.thermal.strength ); }
  // Hydraulic: the droplets in waves ( each sees the ground the waves before left )
  if ( I.hydraulic ) {
    yield* droplets( I, cur, mask );
    const talus = ( Math.tan( ( 70 * Math.PI ) / 180 ) * I.sp ) / I.sizeY;
    for ( let i = 0; i < 3; i++ ) thermal( talus, 0.5 );
  }
  let snow: Float32Array | null = null;
  if ( I.snow ) {
    yield;
    const S = I.snow, D = Math.max( S.stencil, 1 ), D2 = Math.min( D * 2, 8 );
    // ( the ground's structure: twice blurred )
    const a = new Float32Array( N ), st = new Float32Array( N );
    blur( cur, a, ( _q, v, avg ) => sat( lerp( v, avg, 1 ) ) );
    blur( a, st, ( _q, v, avg ) => sat( lerp( v, avg, 1 ) ) );
    snow = new Float32Array( N );
    for ( let y = 0; y < h; y++ )
      for ( let x = 0; x < w; x++ ) {
        const dhx   = ( ( st[y * w + X( x + D )] - st[y * w + X( x - D )] ) * I.sizeY ) / ( 2 * I.sp * D );
        const dhz   = ( ( st[Y( y + D ) * w + x] - st[Y( y - D ) * w + x] ) * I.sizeY ) / ( 2 * I.sp * D );
        const slope = ( Math.atan( Math.hypot( dhx, dhz ) ) * 180 ) / Math.PI;
        let high    = 1;
        if ( S.lineHigh >= 0 ) high = smoothstep( S.lineLow, Math.max( S.lineHigh, S.lineLow + 0.01 ), I.posY + cur[y * w + x] * I.sizeY );
        const sf    = 1 - smoothstep( S.slopeStart, Math.max( S.slopeFull, S.slopeStart + 0.01 ), slope );
        const curv  = ( ( ( st[y * w + X( x - D2 )] + st[y * w + X( x + D2 )] + st[Y( y - D2 ) * w + x] + st[Y( y + D2 ) * w + x] ) * 0.25 - st[y * w + x] ) * I.sizeY ) / ( D2 * I.sp );
        snow[y * w + x] = sat( sf + clamp( curv * S.crevice * 1.5, -0.6, 0.6 ) ) * high;
      }
    for ( let i = 0; i < S.settle; i++ ) {
      const next = new Float32Array( N );
      blur( snow, next, ( _q, v, avg ) => sat( lerp( v, avg, 0.5 ) ) );
      snow = next;
    }
  }
  // Composite: the snow's depth and its drifts into hollows, and the rock where it doesn't hold
  const out = new Float32Array( N ), rock = new Float32Array( N );
  const S   = I.snow, D = Math.min( Math.max( S?.stencil ?? 1, 1 ) * 2, 8 );
  for ( let y = 0; y < h; y++ )
    for ( let x = 0; x < w; x++ ) {
      const q = y * w + x, hn = cur[q];
      if ( !S || !snow ) { out[q] = hn; continue; }
      const cov  = sat( snow[q] );
      const avg  = ( cur[y * w + X( x - D )] + cur[y * w + X( x + D )] + cur[Y( y - D ) * w + x] + cur[Y( y + D ) * w + x] ) * 0.25;
      out[q]     = hn + S.addsHeight * cov * ( S.amount + Math.max( 0, avg - hn ) );
      rock[q]    = smoothstep( 0.3, 0.7, 1 - cov ) * mask[q] * S.rock;
    }
  return { h: out, k: mask, rock };
}

function* droplets( I: SimInput, cur: Float32Array, mask: Float32Array ): Steps<void> {
  const o     = I.hydraulic!, { w, h } = I;
  const H     = new Int32Array( w * h );
  for ( let q = 0; q < H.length; q++ ) H[q] = Math.trunc( cur[q] * HEIGHT_SCALE );
  const at    = ( x: number, y: number ) => clamp( H[clamp( y, 0, h - 1 ) * w + clamp( x, 0, w - 1 )] / HEIGHT_SCALE, -1, 3 );
  const add   = ( x: number, y: number, a: number ) => { H[clamp( y, 0, h - 1 ) * w + clamp( x, 0, w - 1 )] += Math.round( a * HEIGHT_SCALE ); };
  const R     = o.radius;
  let wSum    = 1;
  if ( R > 1 ) {
    wSum = 0;
    for ( let wy = -R; wy <= R; wy++ ) for ( let wx = -R; wx <= R; wx++ ) wSum += Math.max( 0, 1 - Math.sqrt( wx * wx + wy * wy ) / R );
  }
  const brush = ( nx: number, ny: number, a: number ) => {
    for ( let by = -R; by <= R; by++ )
      for ( let bx = -R; bx <= R; bx++ ) {
        const cx = nx + bx, cy = ny + by;
        if ( cx < 0 || cy < 0 || cx >= w || cy >= h ) continue;
        const wt = Math.max( 0, 1 - Math.sqrt( bx * bx + by * by ) / R );
        if ( wt > 0 ) add( cx, cy, ( a * wt ) / wSum );
      }
  };
  const corners = ( nx: number, ny: number, ox: number, oy: number, a: number ) => {
    add( nx, ny, a * ( 1 - ox ) * ( 1 - oy ) );
    add( nx + 1, ny, a * ox * ( 1 - oy ) );
    add( nx, ny + 1, a * ( 1 - ox ) * oy );
    add( nx + 1, ny + 1, a * ox * oy );
  };
  const waves = clamp( Math.ceil( o.droplets / 8192 ), 1, 64 ), size = Math.ceil( o.droplets / waves );
  for ( let wv = 0; wv < waves; wv++ ) {
    const count = Math.min( size, o.droplets - wv * size );
    for ( let id = 0; id < count; id++ ) {
      if ( id % 128 === 127 ) yield;
      let rng = hash1( Math.imul( ( id + wv * size ) >>> 0, 1973 ) + Math.imul( o.seed, 9277 ) + 1 );
      let px  = 0, py = 0, spawned = false;
      for ( let t = 0; t < 8; t++ ) {
        px  = ( ( rng & 0xffff ) / 65535 ) * ( w - 1 );
        rng = hash1( rng );
        py  = ( ( rng & 0xffff ) / 65535 ) * ( h - 1 );
        rng = hash1( rng );
        if ( mask[Math.trunc( py ) * w + Math.trunc( px )] > 0.01 ) { spawned = true; break; }
      }
      if ( !spawned ) continue;
      let dx = 0, dy = 0, speed = 1, water = 1, sediment = 0, left = false;
      for ( let life = 0; life < o.lifetime; life++ ) {
        const nx   = Math.trunc( px ), ny = Math.trunc( py ), ox = px - nx, oy = py - ny;
        const nw   = at( nx, ny ), ne = at( nx + 1, ny ), sw = at( nx, ny + 1 ), se = at( nx + 1, ny + 1 );
        const hgt  = nw * ( 1 - ox ) * ( 1 - oy ) + ne * ox * ( 1 - oy ) + sw * ( 1 - ox ) * oy + se * ox * oy;
        const gx   = ( ne - nw ) * ( 1 - oy ) + ( se - sw ) * oy, gy = ( sw - nw ) * ( 1 - ox ) + ( se - ne ) * ox;
        dx         = dx * o.inertia - gx * ( 1 - o.inertia );
        dy         = dy * o.inertia - gy * ( 1 - o.inertia );
        const len  = Math.sqrt( dx * dx + dy * dy );
        if ( len <= 1e-6 ) break;
        dx /= len;
        dy /= len;
        px += dx;
        py += dy;
        if ( px < 0 || px > w - 1 || py < 0 || py > h - 1 ) { left = true; break; }
        const mx   = Math.trunc( px ), my = Math.trunc( py ), ax = px - mx, ay = py - my;
        const nh   = at( mx, my ) * ( 1 - ax ) * ( 1 - ay ) + at( mx + 1, my ) * ax * ( 1 - ay ) + at( mx, my + 1 ) * ( 1 - ax ) * ay + at( mx + 1, my + 1 ) * ax * ay;
        const dh   = nh - hgt;
        const cap  = Math.max( -dh, 0.0004 ) * speed * water * o.capacity;
        if ( sediment > cap || dh > 0 ) {
          const amount = dh > 0 ? Math.min( dh, sediment ) : ( sediment - cap ) * o.deposit;
          sediment    -= amount;
          corners( nx, ny, ox, oy, amount );
        } else {
          const amount = Math.min( Math.min( ( cap - sediment ) * o.erode, -dh ), o.maxErodeStep );
          sediment    += amount;
          if ( R <= 1 ) corners( nx, ny, ox, oy, -amount );
          else brush( nx, ny, -amount );
        }
        speed  = Math.sqrt( Math.max( 0, speed * speed - dh * 4 ) );
        water *= 1 - o.evaporate;
        if ( water < 0.01 ) break;
      }
      if ( !left && sediment > 0.0001 ) {
        const nx = Math.trunc( px ), ny = Math.trunc( py );
        if ( R <= 1 ) corners( nx, ny, px - nx, py - ny, sediment );
        else brush( nx, ny, sediment );
      }
    }
  }
  for ( let q = 0; q < H.length; q++ ) cur[q] = clamp( H[q] / HEIGHT_SCALE, -1, 3 );
}

// ---- worked out once, looked up after

// A formation as worked out: on its samples ( x0 + i·sp, z0 + j·sp ), its heights ( world, before blending ), how
// much of the ground they take, and the rock showing through the snow.
export interface FormationGrid {
  x0:   number;
  z0:   number;
  sp:   number;
  w:    number;
  h:    number;
  y:    Float32Array;
  k:    Float32Array;
  rock: Float32Array;
}

const grids = new Map<string, FormationGrid>();
// the last one asked for: writing a formation into the ground looks it up for every sample, with the same shape and
// the same ground
let last: { s: FormationShape; ground: unknown; g: FormationGrid } | null = null;

// ( working one out has to finish now: on the graphics card, it's done here instead )
let rushes = 0;

export const rushing = () => rushes > 0;

/**
 * `f` run with any formation being worked out on the graphics card finished here at once instead.
**/
export function rushFormations<T>( f: () => T ): T {
  rushes++;
  try {
    return f();
  } finally {
    rushes--;
  }
}

/**
 * The formation worked out over the ground ( `ground`: the height under a point without it ), from the cache when it's
 * the same formation over the same ground. `full`: with its erosion and the snow softened.
**/
export function formationGrid( s: FormationShape, ground: ( x: number, z: number ) => number, full = false, frame?: FormationFrame ): FormationGrid {
  if ( last && last.s === s && last.ground === ground ) return last.g;
  return rushFormations( () => drive( formationGridSteps( s, ground, full, frame ) ) );
}

/**
 * formationGrid, stopping now and then ( and while the graphics card works it out ); it's then the one formationGrid
 * gives for the same shape and ground.
**/
export function* formationGridSteps( s: FormationShape, ground: ( x: number, z: number ) => number, full = false, frame?: FormationFrame ): Steps<FormationGrid> {
  if ( last && last.s === s && last.ground === ground ) return last.g;
  const g = yield* keyedGrid( s, ground, full && simulates( s ), frame ?? formationFrame( s ) );
  last    = { s, ground, g };
  return g;
}

function* keyedGrid( s: FormationShape, ground: ( x: number, z: number ) => number, full: boolean, F: FormationFrame ): Steps<FormationGrid> {
  // ( the ground checked at a few spots: a change under it makes it again )
  const x1    = F.x0 + ( F.w - 1 ) * F.sp, z1 = F.z0 + ( F.h - 1 ) * F.sp;
  const probe = [[F.x0, F.z0], [x1, z1], [( F.x0 + x1 ) / 2, ( F.z0 + z1 ) / 2], [F.x0, z1], [x1, F.z0]].map( ( [x, z] ) => ground( x, z ).toFixed( 3 ) ).join( "," );
  const key   = JSON.stringify( s ) + full + JSON.stringify( F ) + probe;
  const had   = grids.get( key );
  if ( had ) return had;
  const I     = yield* simInput( s, ground, full, F );
  const out   = yield* simulate( I );
  const y     = new Float32Array( out.h.length );
  for ( let q = 0; q < y.length; q++ ) y[q] = F.posY + out.h[q] * F.sizeY;
  const g     = { x0: F.x0, z0: F.z0, sp: F.sp, w: F.w, h: F.h, y, k: out.k, rock: out.rock };
  if ( grids.size > 24 ) grids.delete( grids.keys().next().value! );
  grids.set( key, g );
  return g;
}

/**
 * The simulation, on the graphics card when there is one ( stopping each frame till it's done ), else here.
**/
function* simulate( I: SimInput ): Steps<SimOutput> {
  const device = rushes ? null : computeDevice();
  if ( device ) {
    let done: SimOutput | null = null, failed = false;
    simulateGpu( device, I ).then( ( r ) => ( done = r ), ( e ) => { console.warn( "formation on the graphics card", e ); failed = true; } );
    // ( a card that doesn't answer in time: worked out here instead, the edits behind it not held up for good )
    const t0 = performance.now();
    while ( !done && !failed && !rushes && performance.now() - t0 < GPU_PATIENCE ) yield;
    if ( done ) return done;
    if ( !failed && !rushes ) console.warn( "formation: the graphics card took too long, worked out here instead" );
  }
  return yield* simulateCpu( I );
}

/**
 * The formation's height and how much of the ground it takes at a point, or null outside it.
**/
export function formationAt( s: FormationShape, x: number, z: number, ground: ( x: number, z: number ) => number ): { h: number; blend: number } | null {
  if ( s.points.length < 3 ) return null;
  const g = formationGrid( s, ground );
  const u = ( x - g.x0 ) / g.sp, v = ( z - g.z0 ) / g.sp;
  if ( u < 0 || v < 0 || u > g.w - 1 || v > g.h - 1 ) return null;
  const blend = bilinear( g, g.k, u, v );
  return blend > 0 ? { h: bilinear( g, g.y, u, v ), blend } : null;
}

/**
 * The rock showing through the snow at a point ( 0..1 ), from the grid as last worked out.
**/
export function formationRockAt( g: FormationGrid, x: number, z: number ) {
  const u = ( x - g.x0 ) / g.sp, v = ( z - g.z0 ) / g.sp;
  if ( u < 0 || v < 0 || u > g.w - 1 || v > g.h - 1 ) return 0;
  return bilinear( g, g.rock, u, v );
}

function bilinear( g: FormationGrid, A: Float32Array, u: number, v: number ) {
  const i = Math.min( g.w - 2, Math.floor( u ) ), j = Math.min( g.h - 2, Math.floor( v ) ), a = u - i, b = v - j;
  return ( A[j * g.w + i] * ( 1 - a ) + A[j * g.w + i + 1] * a ) * ( 1 - b ) + ( A[( j + 1 ) * g.w + i] * ( 1 - a ) + A[( j + 1 ) * g.w + i + 1] * a ) * b;
}
