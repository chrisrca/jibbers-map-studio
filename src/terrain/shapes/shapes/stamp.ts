// Stamps: ground copied into a grid, or a piece's top surface pressed in ( its imprint ), and read back.

import { terrain } from "../../terrain";
import type { StampGrid } from "./types";

// Longest a copy may be on each side, in samples ( keeps saved projects small ).
const MAX_STAMP_SAMPLES = 320;

/**
 * Copies the terrain in a world rectangle into a stamp grid: exact heights, measured from the ground level around
 * it ( the average along the box's edge ) so a jump keeps standing on the ground wherever it's put.
**/
export function captureStamp( minx: number, minz: number, maxx: number, maxz: number ): StampGrid {
  const finest        = Math.min( ...terrain.chunks.map( ( c ) => c.spacing ) );
  const spacing       = Math.max( finest, Math.max( maxx - minx, maxz - minz ) / MAX_STAMP_SAMPLES, 0.1 );
  const w             = Math.max( 2, Math.round( ( maxx - minx ) / spacing ) + 1 ), h = Math.max( 2, Math.round( ( maxz - minz ) / spacing ) + 1 );
  const cx            = ( minx + maxx ) / 2, cz = ( minz + maxz ) / 2;
  const raw: number[] = [];
  for ( let j = 0; j < h; j++ )
    for ( let i = 0; i < w; i++ ) raw.push( terrain.heightAt( cx + ( i - ( w - 1 ) / 2 ) * spacing, cz + ( j - ( h - 1 ) / 2 ) * spacing ) );
  const edge = raw.filter( ( v, k ) => {
    const i = k % w, j = Math.floor( k / w );
    return !Number.isNaN( v ) && ( i === 0 || j === 0 || i === w - 1 || j === h - 1 );
  } );
  const origin  = edge.length ? edge.reduce( ( a, b ) => a + b, 0 ) / edge.length : 0;
  const heights = raw.map( ( v ) => ( Number.isNaN( v ) ? null : Math.round( ( v - origin ) * 1000 ) / 1000 ) );
  return { w, h, spacing, heights, origin };
}

/**
 * An object pressed into the ground: `tris` its triangles ( Unity coordinates, 9 numbers each ) drawn from above onto
 * the terrain's lattice ( `sp` apart, or a multiple of it for a big object ): its top surface where it covers, and for
 * `margin` metres around it the height of its nearest covered sample with the distance to it ( see StampGrid.dist ).
**/
export function imprintOf( tris: ArrayLike<number>, sp: number, margin: number, maxSide = 320 ): { center: [number, number]; grid: StampGrid } | null {
  let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
  for ( let k = 0; k < tris.length; k += 3 ) {
    minx = Math.min( minx, tris[k] );
    maxx = Math.max( maxx, tris[k] );
    minz = Math.min( minz, tris[k + 2] );
    maxz = Math.max( maxz, tris[k + 2] );
  }
  if ( !( maxx >= minx ) ) return null;
  const spacing = sp * Math.max( 1, Math.ceil( Math.max( maxx - minx, maxz - minz, 0 ) / sp / ( maxSide - 1 - ( 2 * margin ) / sp ) ) );
  // on the lattice, so the copy lands exactly on the terrain's samples
  const x0      = Math.floor( ( minx - margin ) / spacing ) * spacing, z0 = Math.floor( ( minz - margin ) / spacing ) * spacing;
  const w       = Math.round( ( Math.ceil( ( maxx + margin ) / spacing ) * spacing - x0 ) / spacing ) + 1;
  const h       = Math.round( ( Math.ceil( ( maxz + margin ) / spacing ) * spacing - z0 ) / spacing ) + 1;
  const top     = new Float32Array( w * h ).fill( -Infinity );
  for ( let t = 0; t + 8 < tris.length; t += 9 ) {
    const ax  = tris[t], ay = tris[t + 1], az = tris[t + 2], bx = tris[t + 3], by = tris[t + 4], bz = tris[t + 5];
    const cx  = tris[t + 6], cy = tris[t + 7], cz = tris[t + 8];
    const det = ( bz - cz ) * ( ax - cx ) + ( cx - bx ) * ( az - cz );
    if ( Math.abs( det ) < 1e-12 ) continue; // on edge seen from above: no top to it
    const i0 = Math.max( 0, Math.ceil( ( Math.min( ax, bx, cx ) - x0 ) / spacing ) ), i1 = Math.min( w - 1, Math.floor( ( Math.max( ax, bx, cx ) - x0 ) / spacing ) );
    const j0 = Math.max( 0, Math.ceil( ( Math.min( az, bz, cz ) - z0 ) / spacing ) ), j1 = Math.min( h - 1, Math.floor( ( Math.max( az, bz, cz ) - z0 ) / spacing ) );
    for ( let j = j0; j <= j1; j++ ) {
      const z = z0 + j * spacing;
      for ( let i = i0; i <= i1; i++ ) {
        const x  = x0 + i * spacing;
        const l1 = ( ( bz - cz ) * ( x - cx ) + ( cx - bx ) * ( z - cz ) ) / det, l2 = ( ( cz - az ) * ( x - cx ) + ( ax - cx ) * ( z - cz ) ) / det, l3 = 1 - l1 - l2;
        if ( l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6 ) continue;
        const y = l1 * ay + l2 * by + l3 * cy, k = j * w + i;
        if ( y > top[k] ) top[k] = y;
      }
    }
  }
  // each sample's nearest covered one ( two sweeps, passing on the neighbours' nearest )
  const near = new Int32Array( w * h ).fill( -1 );
  for ( let k = 0; k < w * h; k++ ) if ( top[k] > -Infinity ) near[k] = k;
  const d2    = ( k: number, s: number ) => ( ( k % w ) - ( s % w ) ) ** 2 + ( Math.floor( k / w ) - Math.floor( s / w ) ) ** 2;
  const offer = ( k: number, from: number ) => {
    const s = near[from];
    if ( s >= 0 && ( near[k] < 0 || d2( k, s ) < d2( k, near[k] ) ) ) near[k] = s;
  };
  for ( let j = 0; j < h; j++ )
    for ( let i = 0; i < w; i++ ) {
      const k = j * w + i;
      if ( i > 0 ) offer( k, k - 1 );
      if ( j > 0 ) {
        offer( k, k - w );
        if ( i > 0 ) offer( k, k - w - 1 );
        if ( i < w - 1 ) offer( k, k - w + 1 );
      }
    }
  for ( let j = h - 1; j >= 0; j-- )
    for ( let i = w - 1; i >= 0; i-- ) {
      const k = j * w + i;
      if ( i < w - 1 ) offer( k, k + 1 );
      if ( j < h - 1 ) {
        offer( k, k + w );
        if ( i < w - 1 ) offer( k, k + w + 1 );
        if ( i > 0 ) offer( k, k + w - 1 );
      }
    }
  if ( !near.some( ( s ) => s >= 0 ) ) return null;
  const heights: ( number | null )[] = [], dist: ( number | null )[] = [];
  for ( let k = 0; k < w * h; k++ ) {
    const s  = near[k], d = Math.sqrt( d2( k, s ) ) * spacing;
    const on = s >= 0 && d <= margin + spacing;
    heights.push( on ? Math.round( top[s] * 1000 ) / 1000 : null );
    dist.push( on ? Math.round( d * 1000 ) / 1000 : null );
  }
  const center: [number, number] = [x0 + ( ( w - 1 ) * spacing ) / 2, z0 + ( ( h - 1 ) * spacing ) / 2];
  return { center, grid: { w, h, spacing, heights, origin: 0, dist, margin } };
}

export function stampSample( g: StampGrid, u: number, v: number ): number | null {
  const i = Math.floor( u ), j = Math.floor( v );
  if ( i < 0 || j < 0 || i >= g.w - 1 || j >= g.h - 1 ) {
    if ( u < 0 || v < 0 || u > g.w - 1 || v > g.h - 1 ) return null;
  }
  const i0 = Math.min( Math.max( i, 0 ), g.w - 2 ), j0 = Math.min( Math.max( j, 0 ), g.h - 2 );
  const fu = u - i0, fv = v - j0;
  const at = ( a: number, b: number ) => g.heights[b * g.w + a];
  const a  = at( i0, j0 ), b = at( i0 + 1, j0 ), c = at( i0, j0 + 1 ), d = at( i0 + 1, j0 + 1 );
  if ( a === null || b === null || c === null || d === null ) {
    // edges of an imprint: take the nearest covered sample
    const n = at( Math.round( u ), Math.round( v ) );
    return n ?? null;
  }
  return ( a * ( 1 - fu ) + b * fu ) * ( 1 - fv ) + ( c * ( 1 - fu ) + d * fu ) * fv;
}
