// A piece's look baked into its paint: for each texel, the original triangle under it ( by position ), its texture
// at that point through the material's tiling, times the material's colour; and its metallic and roughness maps
// the same way, as the game's shader reads them.

import type { SourceTris } from "../model/importMesh";
import type { TexelMap } from "./meshPaint";

// An image as decoded ( RGBA, the top row first, as in the file ).
export interface BakeImage {
  w:    number;
  h:    number;
  data: Uint8Array;
}

// A slot's material, as far as its look goes.
export interface BakeMaterial {
  // sRGB 0..1
  colour:     [number, number, number];
  tex?:       BakeImage | null;
  tiling:     [number, number];
  offset:     [number, number];
  metallic:   number;
  smoothness: number;
  metalTex?:  BakeImage | null;
  roughTex?:  BakeImage | null;
}

const toLin = Array.from( { length: 256 }, ( _, i ) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ( ( c + 0.055 ) / 1.055 ) ** 2.4;
} );
const toSrgb = ( l: number ) => {
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.max( 0, l ) ** ( 1 / 2.4 ) - 0.055;
  return Math.round( Math.min( 1, Math.max( 0, c ) ) * 255 );
};
const lin = ( c: number ) => ( c <= 0.04045 ? c / 12.92 : ( ( c + 0.055 ) / 1.055 ) ** 2.4 );

/**
 * An image's pixel at a Unity UV ( v = 0 the bottom ), bilinear, wrapping; channel by channel into `out` ( 0..255 ).
**/
function sample( im: BakeImage, u: number, v: number, out: Float32Array ) {
  const x    = ( u - Math.floor( u ) ) * im.w - 0.5, y = ( 1 - ( v - Math.floor( v ) ) ) * im.h - 0.5;
  const x0   = Math.floor( x ), y0 = Math.floor( y ), tx = x - x0, ty = y - y0;
  const wrap = ( a: number, n: number ) => ( ( a % n ) + n ) % n;
  const xa   = wrap( x0, im.w ), xb = wrap( x0 + 1, im.w ), ya = wrap( y0, im.h ), yb = wrap( y0 + 1, im.h );
  for ( let c = 0; c < 4; c++ ) {
    const p   = ( xx: number, yy: number ) => im.data[( yy * im.w + xx ) * 4 + c];
    const top = p( xa, ya ) + ( p( xb, ya ) - p( xa, ya ) ) * tx, bot = p( xa, yb ) + ( p( xb, yb ) - p( xa, yb ) ) * tx;
    out[c]    = top + ( bot - top ) * ty;
  }
}

/**
 * The closest point of triangle abc to p, as barycentric weights ( Ericson, Real-Time Collision Detection 5.1.5 ).
**/
function closest( p: number[], a: number[], b: number[], c: number[], w: Float64Array ) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const d  = ( x: number[], y: number[] ) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const d1 = d( ab, ap ), d2 = d( ac, ap );
  if ( d1 <= 0 && d2 <= 0 ) return w.set( [1, 0, 0] );
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
  const d3 = d( ab, bp ), d4 = d( ac, bp );
  if ( d3 >= 0 && d4 <= d3 ) return w.set( [0, 1, 0] );
  const vc = d1 * d4 - d3 * d2;
  if ( vc <= 0 && d1 >= 0 && d3 <= 0 ) {
    const t = d1 / ( d1 - d3 );
    return w.set( [1 - t, t, 0] );
  }
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  const d5 = d( ab, cp ), d6 = d( ac, cp );
  if ( d6 >= 0 && d5 <= d6 ) return w.set( [0, 0, 1] );
  const vb = d5 * d2 - d1 * d6;
  if ( vb <= 0 && d2 >= 0 && d6 <= 0 ) {
    const t = d2 / ( d2 - d6 );
    return w.set( [1 - t, 0, t] );
  }
  const va = d3 * d6 - d5 * d4;
  if ( va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0 ) {
    const t = ( d4 - d3 ) / ( d4 - d3 + ( d5 - d6 ) );
    return w.set( [0, 1 - t, t] );
  }
  const den = 1 / ( va + vb + vc );
  const v   = vb * den, ww = vc * den;
  w.set( [1 - v - ww, v, ww] );
}

/**
 * The look of `src`'s triangles on each used texel of `map` ( same space ): colour, and the metallic and roughness
 * maps when any material has one ( else null ).
**/
export function bakeLook( map: TexelMap, src: SourceTris, mats: BakeMaterial[] ) {
  const nT   = src.slot.length, n = map.n;
  // the triangles by cell ( a big one in each cell it spans, unless it spans a great many: those are always looked at )
  const cell = map.cell, grid = new Map<string, number[]>(), big: number[] = [];
  const fn   = new Float32Array( nT * 3 );
  for ( let t = 0; t < nT; t++ ) {
    const P  = ( k: number, c: number ) => src.pos[t * 9 + k * 3 + c];
    const e1 = [P( 1, 0 ) - P( 0, 0 ), P( 1, 1 ) - P( 0, 1 ), P( 1, 2 ) - P( 0, 2 )], e2 = [P( 2, 0 ) - P( 0, 0 ), P( 2, 1 ) - P( 0, 1 ), P( 2, 2 ) - P( 0, 2 )];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l  = Math.hypot( nx, ny, nz ) || 1;
    fn.set( [nx / l, ny / l, nz / l], t * 3 );
    const lo = [0, 1, 2].map( ( c ) => Math.floor( Math.min( P( 0, c ), P( 1, c ), P( 2, c ) ) / cell ) );
    const hi = [0, 1, 2].map( ( c ) => Math.floor( Math.max( P( 0, c ), P( 1, c ), P( 2, c ) ) / cell ) );
    if ( ( hi[0] - lo[0] + 1 ) * ( hi[1] - lo[1] + 1 ) * ( hi[2] - lo[2] + 1 ) > 512 ) {
      big.push( t );
      continue;
    }
    for ( let x = lo[0]; x <= hi[0]; x++ )
      for ( let y = lo[1]; y <= hi[1]; y++ )
        for ( let z = lo[2]; z <= hi[2]; z++ ) {
          const key = `${x},${y},${z}`;
          ( grid.get( key ) ?? grid.set( key, [] ).get( key )! ).push( t );
        }
  }
  const metal     = mats.some( ( m ) => m.metalTex ), rough = mats.some( ( m ) => m.roughTex );
  const rgba      = new Uint8Array( n * n * 4 );
  const mOut      = metal ? new Uint8Array( n * n * 4 ) : null, rOut = rough ? new Uint8Array( n * n * 4 ) : null;
  const w         = new Float64Array( 3 ), px = new Float32Array( 4 );
  const p         = [0, 0, 0], a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  const colourLin = mats.map( ( m ) => m.colour.map( lin ) );
  for ( let k = 0; k < n * n; k++ ) {
    if ( !map.used[k] ) continue;
    p[0]         = map.pos[k * 3];
    p[1]         = map.pos[k * 3 + 1];
    p[2]         = map.pos[k * 3 + 2];
    const nx     = map.nrm[k * 3], ny = map.nrm[k * 3 + 1], nz = map.nrm[k * 3 + 2];
    const cx     = Math.floor( p[0] / cell ), cy = Math.floor( p[1] / cell ), cz = Math.floor( p[2] / cell );
    let best     = -1, bd = Infinity;
    const bw     = [0, 0, 0];
    const tryTri = ( t: number ) => {
      for ( let q = 0; q < 3; q++ ) { a[q] = src.pos[t * 9 + q]; b[q] = src.pos[t * 9 + 3 + q]; c[q] = src.pos[t * 9 + 6 + q]; }
      closest( p, a, b, c, w );
      const qx     = a[0] * w[0] + b[0] * w[1] + c[0] * w[2], qy = a[1] * w[0] + b[1] * w[1] + c[1] * w[2], qz = a[2] * w[0] + b[2] * w[1] + c[2] * w[2];
      const facing = nx * fn[t * 3] + ny * fn[t * 3 + 1] + nz * fn[t * 3 + 2];
      // nearest, the ones facing the texel's way first
      const dist   = Math.hypot( p[0] - qx, p[1] - qy, p[2] - qz ) + ( 1 - facing ) * cell * 0.5;
      if ( dist < bd ) { bd = dist; best = t; bw[0] = w[0]; bw[1] = w[1]; bw[2] = w[2]; }
    };
    for ( const t of grid.get( `${cx},${cy},${cz}` ) ?? [] ) tryTri( t );
    if ( best < 0 )
      for ( let x = -1; x <= 1; x++ )
        for ( let y = -1; y <= 1; y++ ) for ( let z = -1; z <= 1; z++ ) for ( const t of grid.get( `${cx + x},${cy + y},${cz + z}` ) ?? [] ) tryTri( t );
    for ( const t of big ) tryTri( t );
    if ( best < 0 ) continue;
    const m  = mats[src.slot[best]] ?? mats[0];
    const u  = src.uv[best * 6] * bw[0] + src.uv[best * 6 + 2] * bw[1] + src.uv[best * 6 + 4] * bw[2];
    const v  = src.uv[best * 6 + 1] * bw[0] + src.uv[best * 6 + 3] * bw[1] + src.uv[best * 6 + 5] * bw[2];
    const tu = u * m.tiling[0] + m.offset[0], tv = v * m.tiling[1] + m.offset[1];
    const cl = colourLin[src.slot[best]] ?? colourLin[0];
    if ( m.tex ) {
      sample( m.tex, tu, tv, px );
      for ( let q = 0; q < 3; q++ ) rgba[k * 4 + q] = toSrgb( toLin[Math.round( px[q] )] * cl[q] );
    } else for ( let q = 0; q < 3; q++ ) rgba[k * 4 + q] = toSrgb( cl[q] );
    rgba[k * 4 + 3] = 255;
    if ( mOut ) {
      let val = m.metallic;
      if ( m.metalTex ) { sample( m.metalTex, tu, tv, px ); val = Math.min( 1, px[0] / 255 + m.metallic ); }
      mOut.set( [Math.round( val * 255 ), Math.round( val * 255 ), Math.round( val * 255 ), 255], k * 4 );
    }
    if ( rOut ) {
      let smooth = m.smoothness;
      if ( m.roughTex ) { sample( m.roughTex, tu, tv, px ); smooth = Math.min( 1, Math.max( 0, 1 - px[0] / 255 + m.smoothness ) ); }
      const r = Math.round( ( 1 - smooth ) * 255 );
      rOut.set( [r, r, r, 255], k * 4 );
    }
  }
  return { rgba, metallic: mOut, roughness: rOut };
}
