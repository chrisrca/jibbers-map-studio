// A terrain chunk repeated ( the map format's repeats and repeat-offset, Map-Tools 0.5 ): the game draws it again
// `repeats` times, each copy `offset` on from the one before — a run that goes on and on. Set per chunk in the Map Size
// editor, seen in the view as ghost copies ( Preview Repeats ), and the Seam Fixer: where a copy's far edge meets the
// next copy's near edge, both sides' ground ( and snow ) blended towards a shared profile over a distance.

import { create } from "zustand";
import type { V3 } from "../core/coords";
import { history } from "../map/history";
import { layerEdit } from "../paint/ground";
import { useEditor } from "../map/store";
import { terrain, type TerrainChunk } from "./terrain";

// Whether repeated chunks' copies show in the view ( editor only, as Map-Tools' Preview Repeats ).
export const useRepeatPreview = create<{ on: boolean }>( () => ( { on: true } ) );

export interface Repeat {
  repeats: number;
  offset:  V3;
}

/**
 * A chunk's repeat ( once, no offset, when it has none ).
**/
export function repeatOf( key: string ): Repeat {
  const e = useEditor.getState().chunkExtras[key] as { repeats?: number; repeatOffset?: V3 } | undefined;
  return { repeats: Math.max( 1, e?.repeats ?? 1 ), offset: e?.repeatOffset ?? [0, 0, 0] };
}

/**
 * Every chunk that repeats, with its copies' offsets ( each one's, from the chunk ).
**/
export function repeatedChunks(): { key: string; offsets: V3[] }[] {
  const out: { key: string; offsets: V3[] }[] = [];
  for ( const c of terrain.chunks ) {
    const r = repeatOf( c.key );
    if ( r.repeats < 2 ) continue;
    out.push( { key: c.key, offsets: Array.from( { length: r.repeats - 1 }, ( _, k ) => r.offset.map( ( v ) => v * ( k + 1 ) ) as V3 ) } );
  }
  return out;
}

/**
 * A chunk's repeat set, one undo step.
**/
export function setRepeat( key: string, r: Repeat, label = "Repeat chunk" ) {
  const before = useEditor.getState().chunkExtras;
  const after  = { ...before, [key]: { ...before[key], repeats: Math.max( 1, Math.round( r.repeats ) ), repeatOffset: r.offset } };
  useEditor.setState( { chunkExtras: after, dirty: true } );
  history.push( {
    label,
    undo: () => useEditor.setState( { chunkExtras: before, dirty: true } ),
    redo: () => useEditor.setState( { chunkExtras: after,  dirty: true } ),
  } );
}

/**
 * The way the copies go, when they go straight on from an edge ( the offset a whole chunk along X or Z, give or take
 * a step up or down ): the axis ( 0 X, 2 Z ) and its sign; null when they don't ( no seam to fix ).
**/
export function seamAxis( c: TerrainChunk, offset: V3 ): { axis: 0 | 2; dir: 1 | -1 } | null {
  const [ox, , oz] = offset, [sx, , sz] = c.size;
  const near       = ( a: number, b: number ) => Math.abs( a - b ) <= Math.max( 0.01, b * 0.01 );
  if ( near( Math.abs( ox ), sx ) && Math.abs( oz ) <= sz * 0.01 ) return { axis: 0, dir: ox > 0 ? 1 : -1 };
  if ( near( Math.abs( oz ), sz ) && Math.abs( ox ) <= sx * 0.01 ) return { axis: 2, dir: oz > 0 ? 1 : -1 };
  return null;
}

const smooth = ( t: number ) => {
  const x = Math.max( 0, Math.min( 1, t ) );
  return x * x * ( 3 - 2 * x );
};

/**
 * How far apart a chunk's copies' edges are where they meet now: the biggest step in the ground ( metres ).
**/
export function seamGap( key: string ): number | null {
  const c = terrain.chunks[terrain.indexOf( key )];
  if ( !c ) return null;
  const r = repeatOf( key ), s = seamAxis( c, r.offset );
  if ( !s ) return null;
  const n   = c.res, at = ( i: number, j: number ) => c.heights[j * n + i];
  let worst = 0;
  for ( let k = 0; k < n; k++ ) {
    // ( this copy's edge that meets the next, and the next's that meets it: lifted by the offset's step )
    const [a, b] = s.axis === 2 ? ( s.dir > 0 ? [at( k, n - 1 ), at( k, 0 )] : [at( k, 0 ), at( k, n - 1 )] ) : s.dir > 0 ? [at( n - 1, k ), at( 0, k )] : [at( 0, k ), at( n - 1, k )];
    worst        = Math.max( worst, Math.abs( b + r.offset[1] - a ) );
  }
  return worst;
}

/**
 * The seam between a chunk's copies fixed: along the edge where one meets the next, the two sides brought together
 * ( the next copy's lifted by the offset's step ), easing back to as they were over `distance` metres; the snow mask
 * ( and its flow ) the same over the same distance. An edge shared with another chunk of the map stays as it is ( it
 * meets that one too ): the other side goes all the way; with neither shared, each goes halfway. One undo step.
 * Whether there was a seam to fix.
**/
export async function fixSeam( key: string, distance: number ): Promise<boolean> {
  const ci = terrain.indexOf( key ), c = terrain.chunks[ci];
  if ( !c ) return false;
  const r = repeatOf( key ), s = seamAxis( c, r.offset );
  if ( !s ) return false;
  const n             = c.res, dy = r.offset[1];
  // ( which of its edges meet other chunks: 0 -X, 1 +X, 2 -Z, 3 +Z )
  const farSide       = s.axis === 0 ? ( s.dir > 0 ? 1 : 0 ) : s.dir > 0 ? 3 : 2, nearSide = farSide ^ 1;
  const shared        = ( side: number ) => c.adjacent.some( ( a ) => a.side === side );
  const [wFar, wNear] = shared( nearSide ) && !shared( farSide ) ? [1, 0] : shared( farSide ) && !shared( nearSide ) ? [0, 1] : [0.5, 0.5];
  // ( never past the middle: both edges are the same chunk's )
  const reach         = Math.min( Math.floor( ( n - 1 ) / 2 ), Math.max( 1, Math.ceil( distance / c.spacing ) ) );
  const before        = terrain.snapshot( ci, 0, 0, n - 1, n - 1 );
  const idx           = ( along: number, across: number ) => ( s.axis === 2 ? across * n + along : along * n + across );
  // the edge that meets the next copy, and the one the next copy meets it with
  const farRow        = s.dir > 0 ? n - 1 : 0, nearRow = s.dir > 0 ? 0 : n - 1, inward = s.dir > 0 ? -1 : 1;
  for ( let k = 0; k < n; k++ ) {
    const a    = c.heights[idx( k, farRow )], b = c.heights[idx( k, nearRow )] + dy;
    const step = b - a;
    for ( let d = 0; d <= reach; d++ ) {
      const w                                    = smooth( 1 - d / reach );
      c.heights[idx( k, farRow  + inward * d )] += step * wFar * w;
      c.heights[idx( k, nearRow - inward * d )] -= step * wNear * w;
    }
  }
  terrain.markDirtyRect( ci, 0, 0, n - 1, n - 1 );
  // ( the chunks beside it met again where the moved ground reaches their edges: no crack, though right at those
  // corners the seam can't close all the way — that ground is theirs too )
  terrain.syncEdges( [ci] );
  const after = terrain.snapshot( ci, 0, 0, n - 1, n - 1 );
  // the snow the same way, by its own pixels
  const paint = await layerEdit( c, ( L ) => {
    const m   = L.m, px = Math.min( Math.floor( ( m - 1 ) / 2 ), Math.max( 1, Math.ceil( ( distance / c.size[s.axis] ) * ( m - 1 ) ) ) );
    const p   = ( along: number, across: number ) => ( s.axis === 2 ? across * m + along : along * m + across );
    const far = s.dir > 0 ? m - 1 : 0, nearP = s.dir > 0 ? 0 : m - 1, inP = s.dir > 0 ? -1 : 1;
    for ( let k = 0; k < m; k++ ) {
      for ( let ch = 0; ch < 4; ch++ ) {
        const a = L.rgba[p( k, far ) * 4 + ch], b = L.rgba[p( k, nearP ) * 4 + ch];
        for ( let d = 0; d <= px; d++ ) {
          const w    = smooth( 1 - d / px ), i1 = p( k, far + inP * d ) * 4 + ch, i2 = p( k, nearP - inP * d ) * 4 + ch;
          L.rgba[i1] = Math.round( L.rgba[i1] + ( b - a ) * wFar  * w );
          L.rgba[i2] = Math.round( L.rgba[i2] + ( a - b ) * wNear * w );
        }
      }
      if ( L.flow ) {
        const a = L.flow[p( k, far )], b = L.flow[p( k, nearP )];
        for ( let d = 0; d <= px; d++ ) {
          const w    = smooth( 1 - d / px ), i1 = p( k, far + inP * d ), i2 = p( k, nearP - inP * d );
          L.flow[i1] = Math.round( L.flow[i1] + ( b - a ) * wFar  * w );
          L.flow[i2] = Math.round( L.flow[i2] + ( a - b ) * wNear * w );
        }
      }
    }
  } );
  terrain.flush();
  useEditor.setState( { dirty: true } );
  history.push( {
    label: "Fix seam",
    bytes: before.data.byteLength * 2 + paint.bytes,
    undo: () => {
      terrain.restore( before );
      terrain.flush();
      paint.undo();
    },
    redo: () => {
      terrain.restore( after );
      terrain.flush();
      paint.redo();
    },
  } );
  return true;
}
