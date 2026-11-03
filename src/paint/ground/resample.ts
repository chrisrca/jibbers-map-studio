// Masks read and brought to a chunk's size: the work itself ( pure, so a worker can do it off the page's thread ).

import { decodePng } from "../../core/png";

/**
 * A mask brought up from `m` to `M` pixels a side ( a mask made coarser than its chunk's ground ): snow, coverage and
 * powder blended between pixels, the marking hue from the nearest ( it's a colour number, not a blend ).
**/
export function upsampleMask( rgba: Uint8Array, m: number, M: number ): Uint8Array {
  const out = new Uint8Array( M * M * 4 );
  // ( each column's two source pixels, its blend between them and its nearest, worked out once )
  const X0  = new Int32Array( M ), X1 = new Int32Array( M ), XA = new Float64Array( M ), XN = new Int32Array( M );
  for ( let I = 0; I < M; I++ ) {
    const fx = Math.min( m - 1, Math.max( 0, ( ( I + 0.5 ) * m ) / M - 0.5 ) );
    X0[I]    = Math.floor( fx ) * 4;
    X1[I]    = Math.min( m - 1, Math.floor( fx ) + 1 ) * 4;
    XA[I]    = fx - Math.floor( fx );
    XN[I]    = Math.min( m - 1, Math.floor( ( ( I + 0.5 ) * m ) / M ) ) * 4;
  }
  for ( let J = 0; J < M; J++ ) {
    const fy = Math.min( m - 1, Math.max( 0, ( ( J + 0.5 ) * m ) / M - 0.5 ) );
    const y0 = Math.floor( fy ), r0 = y0 * m * 4, r1 = Math.min( m - 1, y0 + 1 ) * m * 4, b = fy - y0;
    const rn = Math.min( m - 1, Math.floor( ( ( J + 0.5 ) * m ) / M ) ) * m * 4;
    for ( let I = 0, o = J * M * 4; I < M; I++, o += 4 ) {
      const a    = XA[I], p00 = r0 + X0[I], p10 = r0 + X1[I], p01 = r1 + X0[I], p11 = r1 + X1[I];
      out[o]     = Math.round( ( rgba[p00]     * ( 1 - a ) + rgba[p10]     * a ) * ( 1 - b ) + ( rgba[p01]     * ( 1 - a ) + rgba[p11]     * a ) * b );
      out[o + 1] = rgba[rn + XN[I] + 1];
      out[o + 2] = Math.round( ( rgba[p00 + 2] * ( 1 - a ) + rgba[p10 + 2] * a ) * ( 1 - b ) + ( rgba[p01 + 2] * ( 1 - a ) + rgba[p11 + 2] * a ) * b );
      out[o + 3] = Math.round( ( rgba[p00 + 3] * ( 1 - a ) + rgba[p10 + 3] * a ) * ( 1 - b ) + ( rgba[p01 + 3] * ( 1 - a ) + rgba[p11 + 3] * a ) * b );
    }
  }
  return out;
}

/**
 * A flow mask's angles ( its red, `w` × `h` RGBA ) resampled ( nearest ) to `m` pixels a side.
**/
export function resampleFlow( data: Uint8Array, w: number, h: number, m: number ): Uint8Array {
  const flow = new Uint8Array( m * m ), cols = new Int32Array( m );
  for ( let i = 0; i < m; i++ ) cols[i] = Math.floor( ( i * w ) / m ) * 4;
  for ( let j = 0; j < m; j++ ) {
    const row = Math.floor( ( j * h ) / m ) * w * 4;
    for ( let i = 0; i < m; i++ ) flow[j * m + i] = data[row + cols[i]];
  }
  return flow;
}

export type Image = { width: number; height: number; data: Uint8Array };

export type ResampleJob =
  | { kind: "up";   rgba: Uint8Array; m: number; M: number }
  | { kind: "flow"; data: Uint8Array; w: number; h: number; m: number }
  // a PNG's pixels ( null: not one the decoder takes )
  | { kind: "png";  png:  Uint8Array };

export async function resample( j: ResampleJob ): Promise<Uint8Array | Image | null> {
  return j.kind === "up" ? upsampleMask( j.rgba, j.m, j.M ) : j.kind === "flow" ? resampleFlow( j.data, j.w, j.h, j.m ) : decodePng( j.png );
}
