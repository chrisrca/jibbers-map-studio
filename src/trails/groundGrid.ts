// The trails' ground's coarse grid ( trails/ground/ ): its cells, noise, and distances to the runs.

export interface FillGrid {
  // its corner ( Unity XZ ) and spacing ( metres )
  x0:    number;
  z0:    number;
  sp:    number;
  w:     number;
  h:     number;
  // 1 where the height is given ( a run, or ground to meet ), 0 where it's worked out
  fixed: Uint8Array;
  // 1 where a run is ( no noise there, and it fades in from there )
  run:   Uint8Array;
  value: Float32Array;
}

// ---------------------------------------------------------------- noise

function hash( ix: number, iz: number, seed: number ) {
  let h = Math.imul( ix, 0x8da6b343 ) ^ Math.imul( iz, 0xd8163841 ) ^ Math.imul( seed, 0x9e3779b9 );
  h     = Math.imul( h ^ ( h >>> 13 ), 0x85ebca6b );
  h    ^= h >>> 16;
  return ( h & 0xffff ) / 65535;
}

function valueNoise( x: number, z: number, seed: number ) {
  const x0 = Math.floor( x ), z0 = Math.floor( z ), fx = x - x0, fz = z - z0;
  const sx = fx * fx * ( 3 - 2 * fx ), sz = fz * fz * ( 3 - 2 * fz );
  const a  = hash( x0, z0, seed ), b = hash( x0 + 1, z0, seed ), c = hash( x0, z0 + 1, seed ), d = hash( x0 + 1, z0 + 1, seed );
  return ( ( a + ( b - a ) * sx ) * ( 1 - sz ) + ( c + ( d - c ) * sx ) * sz ) * 2 - 1;
}

/**
 * Smooth noise about nought ( −1..1 ), features about `size` metres across, finer ones as strong as `roughness` of the
 * last ( 5 of them ).
**/
export function fbm( x: number, z: number, size: number, roughness: number, seed: number ) {
  let sum = 0, amp = 1, norm = 0, f = 1 / size;
  for ( let o = 0; o < 5; o++ ) {
    sum  += amp * valueNoise( x * f, z * f, seed + o * 17 );
    norm += amp;
    amp  *= roughness;
    f    *= 2;
  }
  return sum / norm;
}

/**
 * Metres from each sample to the nearest run sample ( an estimate: two passes over the grid ).
**/
export function distanceToRuns( g: FillGrid ) {
  const { w, h } = g, D = new Float32Array( w * h ).fill( 1e9 ), d1 = g.sp, d2 = g.sp * Math.SQRT2;
  for ( let k = 0; k < w * h; k++ ) if ( g.run[k] ) D[k] = 0;
  for ( let j = 0; j < h; j++ )
    for ( let i = 0; i < w; i++ ) {
      const k = j * w + i;
      if ( i > 0 ) D[k] = Math.min( D[k], D[k - 1] + d1 );
      if ( j > 0 ) {
        D[k] = Math.min( D[k], D[k - w] + d1 );
        if ( i > 0 ) D[k] = Math.min( D[k], D[k - w - 1] + d2 );
        if ( i < w - 1 ) D[k] = Math.min( D[k], D[k - w + 1] + d2 );
      }
    }
  for ( let j = h - 1; j >= 0; j-- )
    for ( let i = w - 1; i >= 0; i-- ) {
      const k = j * w + i;
      if ( i < w - 1 ) D[k] = Math.min( D[k], D[k + 1] + d1 );
      if ( j < h - 1 ) {
        D[k] = Math.min( D[k], D[k + w] + d1 );
        if ( i < w - 1 ) D[k] = Math.min( D[k], D[k + w + 1] + d2 );
        if ( i > 0 ) D[k] = Math.min( D[k], D[k + w - 1] + d2 );
      }
    }
  return D;
}
