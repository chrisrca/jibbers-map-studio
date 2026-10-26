// Whole-map mask operations ( the Mask brush paints it; these clear, invert or fill it from the terrain ).
// The mask is editor-only: it protects ground from brushes while you work and isn't saved with the map.

import { history } from "../map/history";
import { terrain } from "../terrain/terrain";

type Masks = ( Uint8Array | null )[];

function snapshot(): Masks {
  return terrain.chunks.map( ( c ) => ( c.mask ? c.mask.slice() : null ) );
}

function put( m: Masks ) {
  terrain.chunks.forEach( ( c, ci ) => {
    c.mask = m[ci] ? m[ci]!.slice() : null;
    terrain.markDirtyRect( ci, 0, 0, c.res - 1, c.res - 1 );
  } );
  terrain.flush();
}

function change( label: string, f: () => void ) {
  const before = snapshot();
  f();
  terrain.chunks.forEach( ( _, ci ) => terrain.markDirtyRect( ci, 0, 0, terrain.chunks[ci].res - 1, terrain.chunks[ci].res - 1 ) );
  terrain.flush();
  const after = snapshot();
  const bytes = [...before, ...after].reduce( ( n, m ) => n + ( m?.byteLength ?? 0 ), 0 );
  history.push( { label, undo: () => put( before ), redo: () => put( after ), bytes } );
}

export function clearMask() {
  change( "Clear mask", () => terrain.chunks.forEach( ( c ) => ( c.mask = null ) ) );
}

export function invertMask() {
  change( "Invert mask", () =>
    terrain.chunks.forEach( ( c ) => {
      const m = c.mask ?? new Uint8Array( c.res * c.res );
      for ( let k = 0; k < m.length; k++ ) m[k] = 255 - m[k];
      c.mask = m;
    } ),
  );
}

/**
 * Masks ground by its slope ( degrees ) or absolute height: everything inside [lo, hi] gets masked, with a soft edge.
**/
export function maskBy( kind: "slope" | "height", lo: number, hi: number ) {
  change( kind === "slope" ? "Mask by slope" : "Mask by height", () =>
    terrain.chunks.forEach( ( c ) => {
      const m    = c.mask ?? new Uint8Array( c.res * c.res );
      const res  = c.res, H = c.heights, sp = c.spacing, base = c.position[1];
      const soft = kind === "slope" ? 2 : Math.max( 0.25, ( hi - lo ) * 0.03 );
      for ( let j = 0; j < res; j++ )
        for ( let i = 0; i < res; i++ ) {
          const k = j * res + i;
          let v: number;
          if ( kind === "height" ) v = H[k] + base;
          else {
            const gx = ( H[j * res + Math.min( res - 1, i + 1 )] - H[j * res + Math.max( 0, i - 1 )] ) / ( 2 * sp );
            const gz = ( H[Math.min( res - 1, j + 1 ) * res + i] - H[Math.max( 0, j - 1 ) * res + i] ) / ( 2 * sp );
            v        = ( Math.atan( Math.hypot( gx, gz ) ) * 180 ) / Math.PI;
          }
          const w = v < lo - soft || v > hi + soft ? 0 : v < lo ? ( v - lo + soft ) / soft : v > hi ? ( hi + soft - v ) / soft : 1;
          m[k]    = Math.max( m[k], Math.round( w * 255 ) );
        }
      c.mask = m;
    } ),
  );
}
