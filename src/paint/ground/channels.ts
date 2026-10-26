// How the mask's channels are written: a marking's hue spread past its edges, the corduroy's flow as an angle.

/**
 * The game reads a marking's hue from the nearest mask pixel ( unblended ) but its coverage blended, so a marking
 * with no hue stored just outside it ends in a hard, pixel-stepped edge where the blended coverage fades out over
 * pixels without a hue. Give the uncovered pixels within `reach` of a marking that marking's hue ( the strongest
 * nearby ), so its soft edge shows. Works on the pixels x0..x1, y0..y1 ( and up to `reach` around them ).
**/
export function spreadHue( rgba: Uint8Array, m: number, x0 = 0, y0 = 0, x1 = m - 1, y1 = m - 1, reach = 2 ) {
  const bx0  = Math.max( 0, x0 - reach ), by0 = Math.max( 0, y0 - reach ), bx1 = Math.min( m - 1, x1 + reach ), by1 = Math.min( m - 1, y1 + reach );
  const W    = bx1 - bx0 + 1;
  const best = new Uint8Array( W * ( by1 - by0 + 1 ) );
  const r2   = reach * reach + 0.5;
  for ( let y = Math.max( 0, y0 ); y <= Math.min( m - 1, y1 ); y++ )
    for ( let x = Math.max( 0, x0 ); x <= Math.min( m - 1, x1 ); x++ ) {
      const o = ( y * m + x ) * 4, b = rgba[o + 2];
      if ( b < 8 || rgba[o + 1] === 0 ) continue;
      for ( let dy = -reach; dy <= reach; dy++ ) {
        const yy = y + dy;
        if ( yy < by0 || yy > by1 ) continue;
        for ( let dx = -reach; dx <= reach; dx++ ) {
          const xx = x + dx;
          if ( xx < bx0 || xx > bx1 || dx * dx + dy * dy > r2 ) continue;
          const q = ( yy * m + xx ) * 4, bk = ( yy - by0 ) * W + ( xx - bx0 );
          if ( rgba[q + 2] >= 8 || b <= best[bk] ) continue;
          best[bk]    = b;
          rgba[q + 1] = rgba[o + 1];
        }
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

export function decodeAngle( b: number ): [number, number] {
  const a = ( b / 255 ) * Math.PI * 2;
  return [Math.sin( a ), Math.cos( a )];
}

export function blendAngle( cur: number, target: number, w: number ) {
  const [ax, az] = decodeAngle( cur ), [bx, bz] = decodeAngle( target );
  const x        = ax + ( bx - ax ) * w, z = az + ( bz - az ) * w;
  return Math.hypot( x, z ) < 1e-4 ? target : encodeAngle( x, z );
}
