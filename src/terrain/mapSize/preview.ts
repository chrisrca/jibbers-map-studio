// New ground previewed before it's added ( Map Size ): shown, adjusted, kept or let go.

import { type ChunkInit, terrain } from "../terrain";
import { type Side, edgeCells } from "./edges";
import { type EdgeAnalysis, analyzeEdge } from "./ground";
import { type GrowParams, growMap, stripChunks } from "./grow";

// A strip shown ( not yet added ) while its settings are adjusted.
export interface GrowPreview {
  side:   Side;
  chunks: ChunkInit[];
}

let preview: { side: Side; an: EdgeAnalysis; layout: number } | null = null;

const previewListeners = new Set<( p: GrowPreview | null ) => void>();

export function onGrowPreview( l: ( p: GrowPreview | null ) => void ) {
  previewListeners.add( l );
  return () => void previewListeners.delete( l );
}

const PREVIEW_RES = 257;

/**
 * Shows ( or refreshes ) a preview of the strip `side` would get with `p`; the analysis of the edge is reused.
**/
export function previewGrow( side: Side, p: GrowParams ) {
  if ( !preview || preview.side !== side || preview.layout !== terrain.layoutVersion ) {
    const cells = edgeCells( side );
    if ( !cells.length ) return;
    preview = { side, an: analyzeEdge( side, cells ), layout: terrain.layoutVersion };
  }
  const chunks = stripChunks( side, PREVIEW_RES, preview.an, p, PREVIEW_RES );
  previewListeners.forEach( ( l ) => l( { side, chunks } ) );
}

/**
 * Adds the previewed strip for real at `res`.
**/
export function applyGrow( side: Side, res: number, p: GrowParams ) {
  const an = preview && preview.side === side && preview.layout === terrain.layoutVersion ? preview.an : undefined;
  cancelGrow();
  growMap( side, res, p, an );
}

export function cancelGrow() {
  preview = null;
  previewListeners.forEach( ( l ) => l( null ) );
}
