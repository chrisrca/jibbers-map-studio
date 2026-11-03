// How the mask's channels are written: a marking's hue spread past its edges, the corduroy's flow as an angle.

/**
 * The game reads a marking's hue from the nearest mask pixel ( unblended ) but its coverage blended, so a marking
 * with no hue stored just outside it ends in a hard, pixel-stepped edge where the blended coverage fades out over
 * pixels without a hue. Give the uncovered pixels within `reach` of a marking that marking's hue ( the strongest
 * nearby ), so its soft edge shows. Works on the pixels x0..x1, y0..y1 ( and up to `reach` around them ).
**/
export function spreadHue( rgba: Uint8Array, m: number, x0 = 0, y0 = 0, x1 = m - 1, y1 = m - 1, reach = 2 ) {
  // ( looked at from the uncovered pixels: each takes the hue of the strongest marking within reach, the first in
  // row order of the strongest; a marking's covered middle, most of a big brush's pixels, costs nothing )
  const ax0 = Math.max( 0, x0 ), ay0 = Math.max( 0, y0 ), ax1 = Math.min( m - 1, x1 ), ay1 = Math.min( m - 1, y1 );
  const bx0 = Math.max( 0, ax0 - reach ), by0 = Math.max( 0, ay0 - reach ), bx1 = Math.min( m - 1, ax1 + reach ), by1 = Math.min( m - 1, ay1 + reach );
  const r2  = reach * reach + 0.5;
  if ( ax0 > ax1 || ay0 > ay1 ) return;
  // how many marked pixels up and left of each ( a summed-area table ): a pixel with none within reach skips at once
  const W   = ax1 - ax0 + 2, sat = new Int32Array( W * ( ay1 - ay0 + 2 ) );
  for ( let y = ay0; y <= ay1; y++ ) {
    let row = 0;
    for ( let x = ax0, o = ( y * m + x ) * 4; x <= ax1; x++, o += 4 ) {
      if ( rgba[o + 2] >= 8 && rgba[o + 1] !== 0 ) row++;
      sat[( y - ay0 + 1 ) * W + x - ax0 + 1] = sat[( y - ay0 ) * W + x - ax0 + 1] + row;
    }
  }
  for ( let yy = by0; yy <= by1; yy++ ) {
    const sy0 = Math.max( ay0, yy - reach ), sy1 = Math.min( ay1, yy + reach );
    if ( sy0 > sy1 ) continue;
    const t0  = ( sy0 - ay0 ) * W, t1 = ( sy1 - ay0 + 1 ) * W;
    for ( let xx = bx0; xx <= bx1; xx++ ) {
      const q = ( yy * m + xx ) * 4;
      if ( rgba[q + 2] >= 8 ) continue;
      const sx0 = Math.max( ax0, xx - reach ), sx1 = Math.min( ax1, xx + reach );
      if ( sx0 > sx1 ) continue;
      const c0  = sx0 - ax0, c1 = sx1 - ax0 + 1;
      if ( sat[t1 + c1] - sat[t0 + c1] - sat[t1 + c0] + sat[t0 + c0] === 0 ) continue;
      let best  = 0, hue = -1;
      for ( let y = sy0; y <= sy1; y++ )
        for ( let x = sx0, o = ( y * m + x ) * 4; x <= sx1; x++, o += 4 ) {
          const b = rgba[o + 2];
          if ( b <= best || b < 8 || rgba[o + 1] === 0 || ( x - xx ) * ( x - xx ) + ( y - yy ) * ( y - yy ) > r2 ) continue;
          best = b;
          hue  = rgba[o + 1];
        }
      if ( hue >= 0 ) rgba[q + 1] = hue;
    }
  }
}

/**
 * Unity XZ direction → the flow byte ( 0..1 = 0..360° from +Z towards +X ).
**/
export function encodeAngle( dx: number, dz: number ) {
  let a = Math.atan2( dx, dz ) / ( Math.PI * 2 );
  if ( a < 0 ) a += 1;
  return Math.round( a * 255 ) % 256;
}

// ( each byte's direction, worked out once )
const SIN = new Float64Array( 256 ), COS = new Float64Array( 256 );
for ( let b = 0; b < 256; b++ ) {
  SIN[b] = Math.sin( ( b / 255 ) * Math.PI * 2 );
  COS[b] = Math.cos( ( b / 255 ) * Math.PI * 2 );
}

export function decodeAngle( b: number ): [number, number] {
  if ( b >= 0 && b < 256 && b === Math.floor( b ) ) return [SIN[b], COS[b]];
  const a = ( b / 255 ) * Math.PI * 2;
  return [Math.sin( a ), Math.cos( a )];
}

export function blendAngle( cur: number, target: number, w: number ) {
  const x = SIN[cur] + ( SIN[target] - SIN[cur] ) * w, z = COS[cur] + ( COS[target] - COS[cur] ) * w;
  return Math.hypot( x, z ) < 1e-4 ? target : encodeAngle( x, z );
}

/**
 * blendAngle towards one direction, for many pixels ( a dab's ): each byte and weight ( in 128ths ) blended once.
**/
export function angleTowards( target: number ) {
  const memo = new Int16Array( 256 * 129 ).fill( -1 );
  return ( cur: number, w: number ) => {
    const k = cur * 129 + Math.round( Math.min( 1, Math.max( 0, w ) ) * 128 );
    let v   = memo[k];
    if ( v < 0 ) v = memo[k] = blendAngle( cur, target, ( k % 129 ) / 128 );
    return v;
  };
}
