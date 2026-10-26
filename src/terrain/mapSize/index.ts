// Growing or shrinking a map after it's made: whole strips of chunks added to ( or removed from ) one side.

import { terrain } from "../terrain";
import { EPS, type Side, bounds, current, edgeChunks, setLayout } from "./edges";

export { type Side, type EdgeCell } from "./edges";
export { type GrowParams, DEFAULT_GROW, growMap } from "./grow";
export { type GrowPreview, onGrowPreview, previewGrow, applyGrow, cancelGrow } from "./preview";
export { type EdgeAnalysis, analyzeEdge } from "./ground";

/**
 * Removes the strip of chunks along `side` ( never the last strip ).
**/
export function shrinkMap( side: Side ): boolean {
  // a whole strip: smaller chunks near the edge go with the strip they're part of
  const edges = edgeChunks( side );
  if ( !edges.length ) return false;
  const S    = Math.max( ...edges.map( ( c ) => c.size[0] ) );
  const b    = bounds();
  const edge = new Set(
    terrain.chunks.filter( ( c ) =>
      side === "west" ? c.position[0] < b.minx + S - EPS
      : side === "east"  ? c.position[0] + c.size[0] > b.maxx - S + EPS
      : side === "south" ? c.position[2] < b.minz + S - EPS
      : c.position[2] + c.size[2] > b.maxz - S + EPS,
    ),
  );
  if ( edge.size === terrain.chunks.length ) return false;
  setLayout( current().filter( ( _, i ) => !edge.has( terrain.chunks[i] ) ), `Remove ground (${side})` );
  return true;
}

export function mapSize() {
  const b = bounds();
  return { width: b.maxx - b.minx, depth: b.maxz - b.minz };
}
