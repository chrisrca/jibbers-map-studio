// The map's edges: the chunks along a side, their edge cells, and the layout set again ( one undo step ).

import { history } from "../../map/history";
import { useEditor } from "../../map/store";
import { type ChunkInit, terrain } from "../terrain";

export type Side = "west" | "east" | "south" | "north";

export const EPS = 0.01;

export function current(): ChunkInit[] {
  return terrain.chunks.map( ( c ) => ( { key: c.key, position: c.position, size: c.size, res: c.res, heights: c.heights, snowMask: c.snowMask } ) );
}

export function bounds() {
  let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
  for ( const c of terrain.chunks ) {
    minx = Math.min( minx, c.position[0] );
    minz = Math.min( minz, c.position[2] );
    maxx = Math.max( maxx, c.position[0] + c.size[0] );
    maxz = Math.max( maxz, c.position[2] + c.size[2] );
  }
  return { minx, minz, maxx, maxz };
}

// One whole-size square along an edge ( chunks there may be smaller than a cell; new ground is made per cell ).
export interface EdgeCell {
  position: [number, number, number];
  size:     [number, number, number];
  // finest spacing of the chunks in this cell
  spacing:  number;
}

/**
 * The edge as whole-size cells: the largest chunk size along it, stepped along the edge.
**/
export function edgeCells( side: Side ): EdgeCell[] {
  const edge = edgeChunks( side );
  if ( !edge.length ) return [];
  const S                 = Math.max( ...edge.map( ( c ) => c.size[0] ) );
  const b                 = bounds();
  const alongX            = side === "north" || side === "south";
  const u0                = alongX ? b.minx : b.minz, u1 = alongX ? b.maxx : b.maxz;
  const cells: EdgeCell[] = [];
  for ( let u = u0; u < u1 - EPS; u += S ) {
    const x       = alongX ? u : side === "west" ? b.minx : b.maxx - S;
    const z       = alongX ? ( side === "south" ? b.minz : b.maxz - S ) : u;
    const inCell  = edge.filter( ( c ) => c.position[0] < x + S - EPS && c.position[0] + c.size[0] > x + EPS && c.position[2] < z + S - EPS && c.position[2] + c.size[2] > z + EPS );
    const spacing = inCell.length ? Math.min( ...inCell.map( ( c ) => c.spacing ) ) : edge[0].spacing;
    cells.push( { position: [x, 0, z], size: [S, 0, S], spacing } );
  }
  return cells;
}

/**
 * Chunks along one side of the map.
**/
export function edgeChunks( side: Side ) {
  const b = bounds();
  return terrain.chunks.filter( ( c ) => {
    if ( side === "west"  ) return Math.abs( c.position[0] - b.minx ) < EPS;
    if ( side === "east"  ) return Math.abs( c.position[0] + c.size[0] - b.maxx ) < EPS;
    if ( side === "south" ) return Math.abs( c.position[2] - b.minz ) < EPS;
    return Math.abs( c.position[2] + c.size[2] - b.maxz ) < EPS;
  } );
}

/**
 * Switches to a new chunk layout as one undo step. `stitch`: chunk keys whose edges are matched up with their
 * neighbours afterwards ( that can nudge a neighbour's edge, so those neighbours are kept as copies for undo ).
**/
export function setLayout( inits: ChunkInit[], label: string, stitch: string[] = [], touched: string[] = [] ) {
  // only the chunks the stitching can change are copied ( copying every chunk of a big map would cost gigabytes )
  const copy   = new Set( [...stitch, ...touched] );
  const snap   = ( list: ChunkInit[] ) => list.map( ( c ) => ( copy.has( c.key ) ? { ...c, heights: c.heights.slice() } : c ) );
  const before = snap( current() );
  let after    = inits;
  const apply  = ( list: ChunkInit[], doStitch: boolean ) => {
    // ( shapes keep working: what they did is recorded per chunk key, and the chunks that stay keep theirs )
    terrain.setChunks( list );
    if ( doStitch ) terrain.syncEdges( stitch.map( ( k ) => terrain.indexOf( k ) ).filter( ( i ) => i >= 0 ) );
    useEditor.setState( { dirty: true } );
  };
  apply( inits, stitch.length > 0 );
  if ( stitch.length ) after = snap( current() ); // as stitched
  const held = ( list: ChunkInit[] ) => list.filter( ( c ) => copy.has( c.key ) ).reduce( ( n, c ) => n + c.heights.byteLength, 0 );
  history.push( { label, undo: () => apply( before, false ), redo: () => apply( after, false ), bytes: held( before ) + held( after ) } );
}
