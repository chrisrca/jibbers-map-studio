// A seam between two chunks of the map smoothed ( Map-Tools 0.5's Seam Fixer, for chunks side by side ): the studio
// keeps their shared edge at one height, but two chunks made apart ( one grown beside an imported one, a copied one )
// can still meet at a kink. Across the seam, the ground within `distance` of it each side is made one smooth curve
// from the ground at that distance on one side to the other's, meeting each at its own slope: no step, no kink. One
// undo step.

import { history } from "../map/history";
import { type TerrainChunk, terrain } from "./terrain";

/**
 * The seam on `side` of chunk `key` ( 0 −X, 1 +X, 2 −Z, 3 +Z ) smoothed over `distance` metres each way. False when
 * there's no chunk there, or it's on another grid of samples.
**/
export function smoothSeam( key: string, side: 0 | 1 | 2 | 3, distance: number ): boolean {
  const a  = terrain.chunks[terrain.indexOf( key )];
  const nb = a?.adjacent.find( ( x ) => x.side === side );
  if ( !a || !nb ) return false;
  const b  = nb.c, sp = a.spacing;
  if ( Math.abs( b.spacing - sp ) > 1e-9 ) return false;
  const n  = Math.max( 2, Math.min( Math.round( distance / sp ), a.res - 3, b.res - 3 ) );
  // the seam's line, and the way across it from this chunk into the other
  const ax   = side < 2, sx = side === 1 ? a.position[0] + a.size[0] : side === 0 ? a.position[0] : 0, sz = side === 3 ? a.position[2] + a.size[2] : side === 2 ? a.position[2] : 0;
  const into = side === 0 || side === 2 ? -1 : 1;
  const lo   = Math.max( ax ? a.position[2] : a.position[0], ax ? b.position[2] : b.position[0] );
  const hi   = Math.min( ax ? a.position[2] + a.size[2] : a.position[0] + a.size[0], ax ? b.position[2] + b.size[2] : b.position[0] + b.size[0] );
  // the sample of either chunk at a world point ( on their shared grid )
  const at = ( x: number, z: number ): { c: TerrainChunk; k: number } | null => {
    for ( const c of [a, b] ) {
      const i = Math.round( ( x - c.position[0] ) / sp ), j = Math.round( ( z - c.position[2] ) / sp );
      if ( i >= 0 && j >= 0 && i < c.res && j < c.res && Math.abs( c.position[0] + i * sp - x ) < 1e-6 && Math.abs( c.position[2] + j * sp - z ) < 1e-6 ) return { c, k: j * c.res + i };
    }
    return null;
  };
  const height                                                              = ( x: number, z: number ) => { const s = at( x, z ); return s ? s.c.heights[s.k] + s.c.position[1] : NaN; };
  const changes: { c: TerrainChunk; k: number; was: number; now: number }[] = [];
  for ( let u = lo; u <= hi + 1e-6; u += sp ) {
    // ( across the seam: o samples from it, − on this chunk's side )
    const p  = ( o: number ): [number, number] => ( ax ? [sx + o * into * sp, u] : [u, sz + o * into * sp] );
    const hs = ( o: number ) => height( ...p( o ) );
    const P0 = hs( -n ), P1 = hs( n ), M0 = P0 - hs( -n - 1 ), M1 = hs( n + 1 ) - P1;
    if ( [P0, P1, M0, M1].some( Number.isNaN ) ) continue;
    const L  = 2 * n;
    for ( let o = -n + 1; o <= n - 1; o++ ) {
      const t = ( o + n ) / L, t2 = t * t, t3 = t2 * t;
      // ( Hermite: the ends' heights and slopes, the slopes in samples, so × the span )
      const v = ( 2 * t3 - 3 * t2 + 1 ) * P0 + ( t3 - 2 * t2 + t ) * L * M0 + ( -2 * t3 + 3 * t2 ) * P1 + ( t3 - t2 ) * L * M1;
      for ( const c of [a, b] ) {
        const [x, z] = p( o ), i = Math.round( ( x - c.position[0] ) / sp ), j = Math.round( ( z - c.position[2] ) / sp );
        if ( i < 0 || j < 0 || i >= c.res || j >= c.res ) continue;
        const k = j * c.res + i, now = Math.max( 0, Math.min( c.size[1], v - c.position[1] ) );
        changes.push( { c, k, was: c.heights[k], now } );
      }
    }
  }
  if ( !changes.length ) return true;
  const put = ( which: "was" | "now" ) => {
    for ( const ch of changes ) ch.c.heights[ch.k] = ch[which];
    for ( const c of [a, b] ) terrain.markDirtyRect( terrain.indexOf( c.key ), 0, 0, c.res - 1, c.res - 1 );
    terrain.syncEdges( [terrain.indexOf( a.key ), terrain.indexOf( b.key )] );
  };
  put( "now" );
  history.push( { label: "Smooth seam", undo: () => put( "was" ), redo: () => put( "now" ), bytes: changes.length * 24 } );
  return true;
}
