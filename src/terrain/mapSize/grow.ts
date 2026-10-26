// Growing the map out from a side: a strip of new chunks, their ground made to carry on from the edge's.

import { type ChunkInit, terrain } from "../terrain";
import { type Side, current, edgeCells, edgeChunks, setLayout } from "./edges";
import { type EdgeAnalysis, analyzeEdge, groundFrom } from "./ground";

// How new ground is made; every value at its default gives "more of the same".
export interface GrowParams {
  // small bumps ( finer than ~10 m ) in the copied detail, x as found
  roughness: number;
  // the copied detail ( ridges, gullies, lumps ), x as found
  hills:     number;
  // how far the slope and bend at the edge keep going, x the default ( 0 = levels off at once )
  carry:     number;
  // metres the far side of the strip ends up raised ( or lowered ), easing in from the join
  raise:     number;
  // metres over which the existing ground's own detail at the edge fades into the new
  join:      number;
  // a different random layout
  seed:      number;
  // metres in from the edge that copied ground mostly comes from: the chance of a spot being used halves every
  // ~0.7x this, so features further in ( sculpted jumps, flattened areas ) rarely get copied
  reach:     number;
}

export const DEFAULT_GROW: GrowParams = {
  roughness: 1,
  hills:     1,
  carry:     1,
  raise:     0,
  join:      100,
  seed:      0,
  reach:     150,
};

/**
 * Chunks for a new strip along `side` ( not added ). `maxWork`: cap on the samples per side actually computed.
**/
export function stripChunks( side: Side, res: number, an: EdgeAnalysis, p: GrowParams, maxWork = Infinity ): ChunkInit[] {
  const ground             = groundFrom( an, p );
  const keys               = new Set( terrain.chunks.map( ( c ) => c.key ) );
  const added: ChunkInit[] = [];
  for ( const c of an.edge ) {
    const [x0, , z0] = c.position;
    const [sx, , sz] = c.size;
    const pos: [number, number, number] =
      side === "west" ? [x0 - sx, 0, z0] : side === "east" ? [x0 + sx, 0, z0] : side === "south" ? [x0, 0, z0 - sz] : [x0, 0, z0 + sz];
    // work at up to ~1 m spacing ( the detail is sampled at about that ), then interpolate to the chunk's detail
    const cres   = Math.min( res, maxWork, Math.max( 65, 1 + Math.ceil( sx / Math.max( 1, c.spacing ) ) ) );
    const cs     = sx / ( cres - 1 );
    const coarse = new Float32Array( cres * cres );
    let lo       = Infinity, hi = -Infinity;
    for ( let j = 0; j < cres; j++ )
      for ( let i = 0; i < cres; i++ ) {
        const h              = ground( pos[0] + i * cs, pos[2] + j * cs );
        coarse[j * cres + i] = h;
        if ( h < lo ) lo = h;
        if ( h > hi ) hi = h;
      }
    // vertical range fitted to the new ground ( as the new-map generator does ): room below and above for sculpting
    const base    = Math.floor( lo - 60 ), top = Math.max( 400, Math.ceil( hi + 200 - base ) );
    pos[1]        = base;
    const r       = Math.min( res, maxWork );
    const heights = new Float32Array( r * r );
    const f       = ( cres - 1 ) / ( r - 1 );
    for ( let j = 0; j < r; j++ )
      for ( let i = 0; i < r; i++ ) {
        const fi = i * f, fj = j * f;
        const i0 = Math.min( cres - 2, Math.floor( fi ) ), j0 = Math.min( cres - 2, Math.floor( fj ) );
        const u  = fi - i0, v = fj - j0;
        const h  =
          ( coarse[j0 * cres + i0] * ( 1 - u ) + coarse[j0 * cres + i0 + 1] * u ) * ( 1 - v ) +
          ( coarse[( j0 + 1 ) * cres + i0] * ( 1 - u ) + coarse[( j0 + 1 ) * cres + i0 + 1] * u ) * v;
        heights[j * r + i] = h - base;
      }
    // the joining edge: exactly the existing ground there
    for ( let k = 0; k < r; k++ ) {
      const i = side === "east"  ? 0 : side === "west"  ? r - 1 : k;
      const j = side === "north" ? 0 : side === "south" ? r - 1 : k;
      const h = terrain.heightAt( pos[0] + i * ( sx / ( r - 1 ) ), pos[2] + j * ( sx / ( r - 1 ) ) );
      if ( !Number.isNaN( h ) ) heights[j * r + i] = h - base;
    }
    let key = `c_${Math.round( pos[0] / sx )}_${Math.round( pos[2] / sz )}`;
    while ( keys.has( key ) ) key += "_";
    keys.add( key );
    added.push( { key, position: pos, size: [sx, top, sz], res: r, heights } );
  }
  return added;
}

/**
 * Adds a strip of chunks along `side`, one per edge chunk, the same size and at `res`. The new ground is generated
 * for the whole strip at once from the terrain along that edge ( see `analyzeEdge` / `groundFrom` ), so it looks like
 * more of the same, joins without a seam, and neighbouring new chunks agree.
**/
export function growMap( side: Side, res: number, p: GrowParams = DEFAULT_GROW, an?: EdgeAnalysis ) {
  const edge = edgeChunks( side );
  if ( !edge.length ) return;
  const added = stripChunks( side, res, an ?? analyzeEdge( side, edgeCells( side ) ), p );
  setLayout( [...current(), ...added], `Add ground (${side})`, added.map( ( a ) => a.key ), edge.map( ( c ) => c.key ) );
}

/**
 * Separable box blur of a w x h grid, edges clamped.
**/
export function blur( src: Float32Array, w: number, h: number, r: number ): Float32Array {
  const tmp = new Float32Array( w * h ), out = new Float32Array( w * h ), n = 2 * r + 1;
  const ci  = ( i: number, m: number ) => ( i < 0 ? 0 : i >= m ? m - 1 : i );
  for ( let j = 0; j < h; j++ ) {
    let sum = 0;
    for ( let d = -r; d <= r; d++ ) sum += src[j * w + ci( d, w )];
    for ( let i = 0; i < w; i++ ) {
      tmp[j * w + i] = sum / n;
      sum           += src[j * w + ci( i + r + 1, w )] - src[j * w + ci( i - r, w )];
    }
  }
  for ( let i = 0; i < w; i++ ) {
    let sum = 0;
    for ( let d = -r; d <= r; d++ ) sum += tmp[ci( d, h ) * w + i];
    for ( let j = 0; j < h; j++ ) {
      out[j * w + i] = sum / n;
      sum           += tmp[ci( j + r + 1, h ) * w + i] - tmp[ci( j - r, h ) * w + i];
    }
  }
  return out;
}

/**
 * Small seeded random generator ( mulberry32 ), so the same settings always give the same ground.
**/
export function rng( seed: number ) {
  let a = seed >>> 0;
  return () => {
    a     = ( a + 0x6d2b79f5 ) >>> 0;
    let t = a;
    t     = Math.imul( t ^ ( t >>> 15 ), t | 1 );
    t    ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
    return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
  };
}
