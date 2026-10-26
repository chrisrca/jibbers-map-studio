// The ground beneath the trails, remembered block by block where they've reached ( so it can always be put back ).

import { TILE, terrain } from "../../terrain/terrain";

// samples per side of a remembered block of ground: the view's tiles' ( terrain/terrain.ts TILE ), so a block changed is
// one tile sent to the GPU
export const BT = TILE;

// chunk key : block i : block j → absolute heights, or one height for a block that's all the same
export const bases = new Map<string, Float32Array | number>();

// blocks not yet saved
export const unsaved = new Set<string>();

export const baseKey = ( chunk: string, bi: number, bj: number ) => `${chunk}:${bi}:${bj}`;

/**
 * Remembers a block's ground as it is now ( when the trails first reach it ).
**/
export function snapshotBlock( ci: number, bi: number, bj: number ) {
  const c = terrain.chunks[ci], key = baseKey( c.key, bi, bj );
  if ( bases.has( key ) ) return;
  const i0  = bi * BT, j0 = bj * BT, w = Math.min( BT, c.res - i0 ), h = Math.min( BT, c.res - j0 );
  const a   = new Float32Array( BT * BT ), y0 = c.position[1];
  let first = NaN, same = true;
  for ( let j = 0; j < h; j++ )
    for ( let i = 0; i < w; i++ ) {
      const v       = y0 + c.heights[( j0 + j ) * c.res + i0 + i];
      a[j * BT + i] = v;
      if ( Number.isNaN( first ) ) first = v;
      else if ( v !== first ) same = false;
    }
  bases.set( key, same ? first : a );
  unsaved.add( key );
}

/**
 * The ground beneath the trails at points ( bilinear; NaN off the terrain ), for many points in a row: the remembered
 * blocks looked up once each.
**/
export function baseSampler() {
  const blocks = new Map<number, Float32Array | number | null>();
  const at     = ( ci: number, i: number, j: number ) => {
    const c = terrain.chunks[ci], bi = Math.floor( i / BT ), bj = Math.floor( j / BT ), key = ( ci * 4096 + bj ) * 4096 + bi;
    let b   = blocks.get( key );
    if ( b === undefined ) blocks.set( key, ( b = bases.get( baseKey( c.key, bi, bj ) ) ?? null ) );
    if ( b === null      ) return c.position[1] + c.heights[j * c.res + i];
    return typeof b === "number" ? b : b[( j % BT ) * BT + ( i % BT )];
  };
  return ( x: number, z: number ) => {
    const ci = terrain.chunkAt( x, z );
    if ( ci < 0 ) return NaN;
    const c        = terrain.chunks[ci];
    const [fx, fz] = c.toSample( x, z );
    const i        = Math.min( c.res - 2, Math.max( 0, Math.floor( fx ) ) ), j = Math.min( c.res - 2, Math.max( 0, Math.floor( fz ) ) );
    const tx       = Math.min( 1, Math.max( 0, fx - i ) ), tz = Math.min( 1, Math.max( 0, fz - j ) );
    const a        = at( ci, i, j ), b = at( ci, i + 1, j ), cc = at( ci, i, j + 1 ), d = at( ci, i + 1, j + 1 );
    return ( a + ( b - a ) * tx ) * ( 1 - tz ) + ( cc + ( d - cc ) * tx ) * tz;
  };
}
