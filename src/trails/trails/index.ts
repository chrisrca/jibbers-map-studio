// Trails: points in the world joined by runs ( any number at a point ). A run curves between its two points
// ( Bezier, each end's handle turns and stretches it ), has a width at each end, a roll, heights at its four corners
// and the middles of its sides ( each smoothing into the rest ), a profile along it and a cross-section across it.
// Everything in metres, Unity axes ( Y up ). Pure geometry: the ground made from it is trails/ground/.

import type { TrailNet } from "./net";
import { runStrip, skirtOf } from "./strip";

export { type TrailNode, type TrailRun, type TrailNet, NET_VERSION, emptyNet, defaultEdge, trailId, newRun, nodeOf, runsAt, RUN_PROFILES } from "./net";
export { controls, runLength, pointOnRun, nearestOnRun } from "./line";
export { type Strip, skirtOf, runStrip, junctionPad, handlePoints, stripTriangles } from "./strip";
export { splitRun, fitToGround, mergePoints, smoothedGround, tiltToGround } from "./changes";

/**
 * Bounds ( Unity XZ ) of everything the net touches, skirts included.
**/
export function netBounds( net: TrailNet ): [number, number, number, number] | null {
  if ( !net.runs.length ) return null;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for ( const r of net.runs ) {
    const s = runStrip( net, r, 4 );
    for ( let o = 0; o < s.pts.length; o += 4 ) { x0 = Math.min( x0, s.pts[o] ); x1 = Math.max( x1, s.pts[o] ); z0 = Math.min( z0, s.pts[o + 2] ); z1 = Math.max( z1, s.pts[o + 2] ); }
  }
  // ( v7: a run's ground reaches past its points by its half width and edge )
  const pad = ( net.v ?? 1 ) >= 7 ? Math.max( ...net.runs.map( ( r ) => Math.max( r.wa, r.wb ) / 2 + ( r.edge ?? skirtOf( Math.max( r.wa, r.wb ) ) ) ) ) : 0;
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}
