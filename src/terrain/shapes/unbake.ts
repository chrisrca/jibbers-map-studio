// Shapes that came in already worked into the ground ( a Unity scene's terrain inserts: Map-Tools writes them into the
// heights and keeps nothing of what was there ) made shapes like any other: the ground under them worked out again from
// the ground round them, and each one's change from that taken as made, the heights left as they are. Moved or edited,
// a shape then takes its change out first, as one made in the studio does.

import { terrain } from "../terrain";
import { adoptShape, clearStripesUnder, previewShape, settleShape, type Shape } from "./shapes";
import { shapeAt, shapeBounds } from "./shapes/height";

type Rect = [number, number, number, number];

/**
 * The cells of chunk `ci` a world rectangle covers ( clamped ).
**/
function cellsOf( ci: number, [x0, z0, x1, z1]: Rect ): Rect | null {
  const c   = terrain.chunks[ci];
  const i0  = Math.max( 0, Math.floor( ( x0 - c.position[0] ) / c.spacing ) ), j0 = Math.max( 0, Math.floor( ( z0 - c.position[2] ) / c.spacing ) );
  const i1  = Math.min( c.res - 1, Math.ceil( ( x1 - c.position[0] ) / c.spacing ) ), j1 = Math.min( c.res - 1, Math.ceil( ( z1 - c.position[2] ) / c.spacing ) );
  return i0 <= i1 && j0 <= j1 ? [i0, j0, i1, j1] : null;
}

/**
 * The heights over `mask` ( 1: to work out ) made again from the ground round it: smooth across, meeting it at the
 * edge ( Laplace's equation; a slope runs on under as it was ). `H` the rectangle's heights, `w` × `h`; changed in place.
**/
export function fillUnder( H: Float32Array, mask: Uint8Array, w: number, h: number ) {
  // a start: along each row and each column, straight across from the ground either side, the two put together
  const guess = new Float32Array( w * h ), seen = new Float32Array( w * h );
  const line  = ( n: number, at: ( k: number ) => number ) => {
    let k = 0;
    while ( k < n ) {
      if ( !mask[at( k )] ) { k++; continue; }
      const a = k - 1;
      while ( k < n && mask[at( k )] ) k++;
      const b  = k < n ? k : -1;
      const ha = a >= 0 ? H[at( a )] : NaN, hb = b >= 0 ? H[at( b )] : NaN;
      if ( Number.isNaN( ha ) && Number.isNaN( hb ) ) continue;
      for ( let q = a + 1; q < ( b < 0 ? n : b ); q++ ) {
        const v = Number.isNaN( ha ) ? hb : Number.isNaN( hb ) ? ha : ha + ( ( hb - ha ) * ( q - a ) ) / ( b - a );
        guess[at( q )] += v;
        seen[at( q )]  += 1;
      }
    }
  };
  for ( let j = 0; j < h; j++ ) line( w, ( i ) => j * w + i );
  for ( let i = 0; i < w; i++ ) line( h, ( j ) => j * w + i );
  for ( let k = 0; k < w * h; k++ ) if ( mask[k] && seen[k] ) H[k] = guess[k] / seen[k];
  // then smoothed till it settles ( over-relaxed, the cells taken in a chequer )
  const cells: number[] = [];
  for ( let k = 0; k < w * h; k++ ) if ( mask[k] ) cells.push( k );
  const odd = cells.filter( ( k ) => ( ( k % w ) + Math.floor( k / w ) ) % 2 === 1 ), even = cells.filter( ( k ) => ( ( k % w ) + Math.floor( k / w ) ) % 2 === 0 );
  const relax = ( list: number[] ) => {
    let most = 0;
    for ( const k of list ) {
      const i = k % w, j = ( k - i ) / w;
      let sum = 0, n = 0;
      if ( i > 0     ) { sum += H[k - 1]; n++; }
      if ( i < w - 1 ) { sum += H[k + 1]; n++; }
      if ( j > 0     ) { sum += H[k - w]; n++; }
      if ( j < h - 1 ) { sum += H[k + w]; n++; }
      if ( !n ) continue;
      const d = ( sum / n - H[k] ) * 1.9;
      H[k]   += d;
      most    = Math.max( most, Math.abs( d ) );
    }
    return most;
  };
  for ( let it = 0; it < 6000; it++ ) if ( Math.max( relax( odd ), relax( even ) ) < 1e-4 ) break;
}

/**
 * The shapes, worked into the ground as they are, taken as made: the ground they change worked out again from round
 * them, each laid on it in turn as the studio lays a shape ( its change its own: one moved leaves the others as they
 * were ), and what's left between that and the heights as they came the last one over each place's. The heights are
 * left as they came.
**/
export async function unbakeShapes( shapes: Shape[] ) {
  const ground = ( x: number, z: number ) => terrain.heightAt( x, z );
  // ( ski lines' stripes, painted in as they came: taken out first, to be painted again as they're laid )
  for ( const s of shapes ) if ( s.kind === "skiline" ) await clearStripesUnder( s );
  // ( by chunk: where the shapes reach, which one is last over each place within their bounds, and the heights as they
  // came there: laying a shape can touch the odd sample past where it reaches )
  const kept: { ci: number; own: Map<number, number>; last: Map<number, number>; was: Map<number, number> }[] = [];
  for ( let ci = 0; ci < terrain.chunks.length; ci++ ) {
    const c    = terrain.chunks[ci];
    const own  = new Map<number, number>(), last = new Map<number, number>();
    const mine = shapes.map( ( s, n ) => {
      const r = cellsOf( ci, shapeBounds( s ) );
      if ( !r ) return null;
      let any = false;
      for ( let j = Math.max( 0, r[1] - 2 ); j <= Math.min( c.res - 1, r[3] + 2 ); j++ ) for ( let i = Math.max( 0, r[0] - 2 ); i <= Math.min( c.res - 1, r[2] + 2 ); i++ ) last.set( j * c.res + i, n );
      for ( let j = r[1]; j <= r[3]; j++ )
        for ( let i = r[0]; i <= r[2]; i++ ) {
          const hit = shapeAt( s, c.position[0] + i * c.spacing, c.position[2] + j * c.spacing, ground );
          if ( hit && hit.blend > 0 ) {
            own.set( j * c.res + i, n );
            any = true;
          }
        }
      return any ? r : null;
    } );
    if ( !own.size ) continue;
    // the ground under all of them here, worked out once ( a cell's neighbours may be another shape's )
    let i0 = c.res, j0 = c.res, i1 = -1, j1 = -1;
    for ( const r of mine ) if ( r ) { i0 = Math.min( i0, r[0] ); j0 = Math.min( j0, r[1] ); i1 = Math.max( i1, r[2] ); j1 = Math.max( j1, r[3] ); }
    i0 = Math.max( 0, i0 - 1 ); j0 = Math.max( 0, j0 - 1 ); i1 = Math.min( c.res - 1, i1 + 1 ); j1 = Math.min( c.res - 1, j1 + 1 );
    const w = i1 - i0 + 1, h = j1 - j0 + 1;
    const under = new Float32Array( w * h ), mask = new Uint8Array( w * h );
    for ( let j = 0; j < h; j++ )
      for ( let i = 0; i < w; i++ ) {
        const k = ( j0 + j ) * c.res + i0 + i;
        under[j * w + i] = c.heights[k];
        mask[j * w + i]  = own.has( k ) ? 1 : 0;
      }
    fillUnder( under, mask, w, h );
    // ( put down for the shapes to be laid on )
    const was = new Map<number, number>();
    for ( const k of last.keys() ) was.set( k, c.heights[k] );
    for ( const k of own.keys() ) c.heights[k] = under[( Math.floor( k / c.res ) - j0 ) * w + ( k % c.res ) - i0];
    for ( const [k, n] of own ) last.set( k, n );
    kept.push( { ci, own, last, was } );
  }
  if ( !kept.length ) return;
  // each laid on that ground in turn, as the studio lays a shape
  for ( const s of shapes ) previewShape( s );
  // what's left between that and the heights as they came: the last shape's over each place; the heights put back
  for ( const { ci, last, was } of kept ) {
    const c     = terrain.chunks[ci];
    const by    = new Map<number, number[]>();
    for ( const [k, n] of last ) {
      const d = was.get( k )! - c.heights[k];
      if ( Math.abs( d ) > 1e-6 ) ( by.get( n ) ?? by.set( n, [] ).get( n )! ).push( k );
    }
    for ( const [n, cells] of by ) {
      let i0 = c.res, j0 = c.res, i1 = -1, j1 = -1;
      for ( const k of cells ) { const i = k % c.res, j = ( k - i ) / c.res; i0 = Math.min( i0, i ); j0 = Math.min( j0, j ); i1 = Math.max( i1, i ); j1 = Math.max( j1, j ); }
      const pw = i1 - i0 + 1, ph = j1 - j0 + 1, delta = new Float32Array( pw * ph );
      for ( const k of cells ) {
        const i = k % c.res, j = ( k - i ) / c.res;
        delta[( j - j0 ) * pw + i - i0] = was.get( k )! - c.heights[k];
      }
      for ( const k of cells ) c.heights[k] = was.get( k )!;
      adoptShape( shapes[n].uid, { key: c.key, i0, j0, w: pw, h: ph, delta } );
    }
    for ( const [k, v] of was ) c.heights[k] = v;
    let a0 = c.res, b0 = c.res, a1 = -1, b1 = -1;
    for ( const k of last.keys() ) { const i = k % c.res, j = ( k - i ) / c.res; a0 = Math.min( a0, i ); b0 = Math.min( b0, j ); a1 = Math.max( a1, i ); b1 = Math.max( b1, j ); }
    terrain.markDirtyRect( ci, a0, b0, a1, b1 );
  }
  terrain.syncEdges( kept.map( ( k ) => k.ci ) );
  for ( const s of shapes ) settleShape( s.uid );
}
