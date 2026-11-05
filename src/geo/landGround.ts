// Ground and surroundings made of the land around a map ( geo/land.ts ): a chunk of it turned into ground ( previewed
// first, its settings adjusted ), at full detail, blended into the chunks beside it; a chunk taken away; and the
// surroundings, on or off, built again round the map whenever its ground changes.

import { newUid, useEditor } from "../map/store";
import { isScenery, SCENERY_ROCK_ANGLE, type CustomObjectEntry } from "../core/types";
import { groundRes } from "../terrain/generate";
import { current, setLayout } from "../terrain/mapSize/edges";
import { terrain, type ChunkInit } from "../terrain/terrain";
import { landOf, type Heights, type MadeOptions, type MapBox } from "./land";
import { buildScenery } from "./scenery/scenery";

// The squares the map's chunks cover ( west, south, east, north ).
export const chunkCells = (): MapBox[] => terrain.chunks.map( ( c ) => [c.position[0], c.position[2], c.position[0] + c.size[0], c.position[2] + c.size[2]] );

/**
 * The chunk size and where the map's grid of them lies ( a chunk's south-west corner is at ox + i·S, oz + j·S ).
**/
export function chunkGrid() {
  const c0  = terrain.chunks[0];
  const S   = c0 ? c0.size[0] : 1000;
  const mod = ( v: number ) => ( ( v % S ) + S ) % S;
  return { S, ox: c0 ? mod( c0.position[0] ) : 0, oz: c0 ? mod( c0.position[2] ) : 0 };
}

/**
 * The empty squares next to the map's chunks ( beside one, or at a corner ): where more ground can go.
**/
export function ringCells(): MapBox[] {
  const { S, ox, oz } = chunkGrid();
  const at            = ( x: number, z: number ) => `${Math.round( ( x - ox ) / S )},${Math.round( ( z - oz ) / S )}`;
  const have          = new Set( terrain.chunks.map( ( c ) => at( c.position[0], c.position[2] ) ) );
  const out           = new Map<string, MapBox>();
  for ( const c of terrain.chunks )
    for ( let dj = -1; dj <= 1; dj++ )
      for ( let di = -1; di <= 1; di++ ) {
        const x = c.position[0] + di * S, z = c.position[2] + dj * S, k = at( x, z );
        if ( !have.has( k ) && !out.has( k ) ) out.set( k, [x, z, x + S, z + S] );
      }
  return [...out.values()];
}

// A new chunk's settings ( Map Size ): made-up land's hills and bumps and which variation of it ( the real land is as
// it is ), and how far it's eased into the ground beside it ( metres ).
export interface ChunkSettings extends MadeOptions {
  blend: number;
}

/**
 * A new chunk's settings to start from: the real land meets its neighbours nearly as it is, made-up land needs longer.
**/
export const chunkDefaults = ( kind: "real" | "made" ): ChunkSettings => ( { hills: 1, bumps: 1, variation: 0, blend: kind === "real" ? 60 : 200 } );

/**
 * The chunk at the square ( x0, z0 ), `res` samples a side, from `heights`, eased into the chunks beside it: along each
 * side that meets one, the difference to its edge faded out inwards over `blend` metres.
**/
function chunkFrom( x0: number, z0: number, res: number, heights: Heights, blend: number ): { init: ChunkInit; near: string[] } {
  const { S } = chunkGrid();
  const sp    = S / ( res - 1 );
  const h     = new Float32Array( res * res );
  for ( let r = 0; r < res; r++ ) for ( let c = 0; c < res; c++ ) h[r * res + c] = heights( x0 + c * sp, z0 + r * sp );
  // ( a hole in the data: the nearest height along its row, else the map's own level )
  for ( let r = 0; r < res; r++ ) {
    let last = NaN;
    for ( let c = 0; c < res; c++ ) {
      const k = r * res + c;
      if ( Number.isNaN( h[k] ) ) h[k] = last;
      else last = h[k];
    }
  }
  const c0    = terrain.chunks[0];
  const level = c0 ? terrain.heightAt( c0.position[0] + S / 2, c0.position[2] + S / 2 ) : 0;
  for ( let k = 0; k < h.length; k++ ) if ( Number.isNaN( h[k] ) ) h[k] = Number.isNaN( level ) ? 0 : level;
  const n    = Math.max( 1, Math.min( res - 1, Math.ceil( blend / sp ) ) );
  const near: string[] = [];
  for ( const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]] ) {
    const nb = terrain.chunks.find( ( c ) => Math.abs( c.position[0] - ( x0 + dx * S ) ) < 0.01 && Math.abs( c.position[2] - ( z0 + dz * S ) ) < 0.01 );
    if ( !nb ) continue;
    near.push( nb.key );
    for ( let t = 0; t < res; t++ ) {
      // the edge sample ( index along it t ), and its height in the chunk beside, just over the line
      const [c, r] = dx < 0 ? [0, t] : dx > 0 ? [res - 1, t] : dz < 0 ? [t, 0] : [t, res - 1];
      const theirs = terrain.heightAt( x0 + c * sp + dx * 0.01, z0 + r * sp + dz * 0.01 );
      if ( Number.isNaN( theirs ) ) continue;
      const diff = theirs - h[r * res + c];
      for ( let d = 0; d <= n; d++ ) {
        const w  = 1 - d / n, f = w * w * ( 3 - 2 * w );
        const cc = dx < 0 ? d : dx > 0 ? res - 1 - d : c, rr = dz < 0 ? d : dz > 0 ? res - 1 - d : r;
        h[rr * res + cc] += diff * f;
      }
    }
  }
  let lo = Infinity, hi = -Infinity;
  for ( const v of h ) { lo = Math.min( lo, v ); hi = Math.max( hi, v ); }
  const base = Math.floor( lo ) - 20, size = Math.max( 400, Math.ceil( hi - base + 150 ) );
  for ( let k = 0; k < h.length; k++ ) h[k] -= base;
  const { ox, oz } = chunkGrid();
  let key          = `c_${Math.round( ( x0 - ox ) / S )}_${Math.round( ( z0 - oz ) / S )}`;
  while ( terrain.indexOf( key ) >= 0 ) key += "b";
  return { init: { key, position: [x0, base, z0], size: [S, size, S], res, heights: h, snowMask: null }, near };
}

// Samples a side of a new chunk's preview.
const PREVIEW_RES = 129;

/**
 * A new chunk at the square ( x0, z0 ) as it would come out with `s`, coarsely ( for its preview: quick to make again
 * as its settings change ).
**/
export async function previewLandChunk( x0: number, z0: number, s: ChunkSettings, signal?: AbortSignal ): Promise<ChunkInit> {
  const land = landOf();
  if ( !land ) throw new Error( "This map has no land round it to add" );
  const { S } = chunkGrid();
  const h     = await land.coarse( [x0, z0, x0 + S, z0 + S], S / ( PREVIEW_RES - 1 ), signal, s );
  return chunkFrom( x0, z0, PREVIEW_RES, h, s.blend ).init;
}

/**
 * The square ( x0, z0 ) of the land made ground with `s`, at full detail, blended into the chunks beside it: one undo
 * step. What it was made of, for the user.
**/
export async function addLandChunk( x0: number, z0: number, s: ChunkSettings, onProgress?: ( f: number ) => void, signal?: AbortSignal ): Promise<string> {
  const land = landOf();
  if ( !land ) throw new Error( "This map has no land round it to add" );
  const { S }  = chunkGrid();
  const res    = terrain.chunks[0]?.res ?? groundRes( S );
  const fine   = await land.fine( [x0, z0, x0 + S, z0 + S], S / ( res - 1 ), ( f ) => onProgress?.( f * 0.9 ), signal, s );
  await new Promise( ( k ) => setTimeout( k, 0 ) );
  const { init, near } = chunkFrom( x0, z0, res, fine.heights, s.blend );
  setLayout( [...current(), init], "Add ground", [init.key, ...near] );
  land.keep();
  onProgress?.( 1 );
  return fine.source;
}

/**
 * The chunk `key` taken away ( one undo step ); not the last one.
**/
export function removeChunk( key: string ): boolean {
  if ( terrain.chunks.length < 2 ) return false;
  setLayout( current().filter( ( c ) => c.key !== key ), "Remove ground" );
  return true;
}

/**
 * The surroundings built ( again ) round the map as it is now, `radius` metres out, in place of any it had.
**/
export async function buildSurroundings( radius: number, onProgress?: ( stage: string, f: number ) => void, signal?: AbortSignal ) {
  const st   = useEditor.getState();
  const land = landOf();
  if ( !st.projectDir || !land ) throw new Error( "This map has no land round it" );
  const made = ( await buildScenery( {
    dir:        st.projectDir,
    cells:      chunkCells(),
    radius,
    edge:       ( x, z ) => terrain.heightAt( x, z ),
    far:        ( box, step, sig ) => land.coarse( box, step, sig ),
    onProgress,
    signal,
  } ) ) as Omit<CustomObjectEntry, "uid">;
  land.keep();
  const now   = useEditor.getState();
  const was   = now.customObjects.find( isScenery );
  const piece = { ...made, uid: was?.uid ?? newUid(), scenery: { rockAngle: was?.scenery?.rockAngle ?? SCENERY_ROCK_ANGLE, radius } } as CustomObjectEntry;
  // ( the map's library read again first, its new meshes in it: drawn before, the old ones were drawn, or none )
  if ( !now.library ) useEditor.setState( { library: "assets/library.jbrmap" } );
  ( await import( "../ui/Viewport" ) ).getEngine()?.customR.reloadLibrary();
  useEditor.setState( {
    customObjects: [...now.customObjects.filter( ( o ) => !isScenery( o ) ), piece],
    locked:        { ...now.locked, [piece.uid]: true },
    labels:        { ...now.labels, [piece.uid]: now.labels[piece.uid] ?? "Surroundings" },
    dirty:         true,
  } );
  // ( painted with rock from another slope before: painted so again, as it was )
  const angle = was?.scenery?.rockAngle;
  if ( angle !== undefined && angle !== SCENERY_ROCK_ANGLE ) await ( await import( "./scenery/inner" ) ).repaintScenery( piece.uid, angle );
}

/**
 * The surroundings taken away.
**/
export function removeSurroundings() {
  const st = useEditor.getState();
  if ( !st.customObjects.some( isScenery ) ) return;
  useEditor.setState( { customObjects: st.customObjects.filter( ( o ) => !isScenery( o ) ), dirty: true } );
}

/**
 * The map's ground changed ( a chunk added or taken away ): its surroundings, if it has them, built again to fit, the
 * app busy meanwhile.
**/
export async function refitSurroundings() {
  const st = useEditor.getState();
  const sc = st.customObjects.find( isScenery );
  if ( !sc ) return;
  await buildSurroundings( sc.scenery?.radius ?? 8000, ( stage, f ) => st.setBusy( `${stage} ${Math.round( f * 100 )}%` ) );
}
