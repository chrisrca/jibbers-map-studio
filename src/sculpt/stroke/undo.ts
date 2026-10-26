// A sculpt stroke's snapshots: every tile it touches kept as it was, read back for "the ground as it was", and the
// whole stroke one undo step.

import type { TerrainChunk, TileSnapshot } from "../../terrain/terrain";
import { HeightWindow, liveReader, type ChunkRect, type SampleReader } from "../window";
import type { BrushStroke } from "./stroke";

// Snapshots and undo.
export class StrokeUndo {
  constructor( private stroke: BrushStroke ) {}

  before = new Map<number, Map<number, TileSnapshot>>();
  private origReader: SampleReader = ( _c, ci, i, j ) => this.orig( ci, i, j );

  snap( ci: number, i0: number, j0: number, i1: number, j1: number ) {
    const c = this.stroke.t.chunks[ci];
    let m   = this.before.get( ci );
    if ( !m ) this.before.set( ci, ( m = new Map() ) );
    for ( const ti of c.tilesTouching( i0, j0, i1, j1 ) ) {
      if ( m.has( ti ) ) continue;
      const tx = ti % c.tilesPerSide, tz = Math.floor( ti / c.tilesPerSide ), q = c.tileQuads;
      m.set( ti, this.stroke.t.snapshot( ci, tx * q, tz * q, tx * q + q, tz * q + q ) );
    }
  }

  /**
   * The height of a chunk sample when the stroke started ( above the chunk base ).
  **/
  private orig( ci: number, i: number, j: number ): number {
    const c = this.stroke.t.chunks[ci];
    const m = this.before.get( ci );
    if ( m ) {
      const q  = c.tileQuads, n = c.tilesPerSide;
      const tx = Math.min( n - 1, Math.floor( i / q ) ), tz = Math.min( n - 1, Math.floor( j / q ) );
      for ( const [ax, az] of [[tx, tz], [tx - 1, tz], [tx, tz - 1], [tx - 1, tz - 1]] ) {
        if ( ax < 0 || az < 0 ) continue;
        const s = m.get( az * n + ax );
        if ( s && i >= s.i0 && j >= s.j0 && i < s.i0 + s.w && j < s.j0 + s.h ) return s.data[( j - s.j0 ) * s.w + ( i - s.i0 )];
      }
    }
    return c.heights[j * c.res + i];
  }

  /**
   * The ground as it was when the stroke started, on `win`'s grid: the live heights, with every snapshotted
   * ( already changed ) tile copied over them.
  **/
  original( win: HeightWindow ): Float32Array {
    const O            = win.sameGrid( liveReader );
    const { w, h, sp } = O;
    for ( const [ci, m] of this.before ) {
      const c       = this.stroke.t.chunks[ci];
      const aligned = Math.abs( c.spacing - sp ) < 1e-9;
      for ( const snap of m.values() ) {
        const sx0 = c.position[0] + snap.i0 * c.spacing, sz0 = c.position[2] + snap.j0 * c.spacing;
        const fi  = ( sx0 - O.x0 ) / sp, fj = ( sz0 - O.z0 ) / sp;
        const sw  = ( ( snap.w - 1 ) * c.spacing ) / sp, sh = ( ( snap.h - 1 ) * c.spacing ) / sp;
        if ( fi > w - 1 || fj > h - 1 || fi + sw < 0 || fj + sh < 0 ) continue;
        if ( !aligned || Math.abs( fi - Math.round( fi ) ) > 1e-4 || Math.abs( fj - Math.round( fj ) ) > 1e-4 ) return win.sameGrid( this.origReader ).H;
        const a = Math.round( fi ), b = Math.round( fj ), base = c.position[1];
        for ( let j = Math.max( 0, -b ); j < snap.h && b + j < h; j++ )
          for ( let i = Math.max( 0, -a ); i < snap.w && a + i < w; i++ ) O.H[( b + j ) * w + a + i] = snap.data[j * snap.w + i] + base;
      }
    }
    return O.H;
  }

  commit( rects: ChunkRect[] ) {
    if ( !rects.length ) return;
    this.stroke.changed = true;
    for ( const r of rects ) {
      const c = this.stroke.t.chunks[r.ci], e = c.res - 1;
      if ( r.i0 === 0 || r.j0 === 0 || r.i1 === e || r.j1 === e ) this.syncBorders( r.ci );
    }
  }

  private syncBorders( ci: number ) {
    const c    = this.stroke.t.chunks[ci];
    const edge = ( x: TerrainChunk, side: number ): [number, number, number, number] => {
      const r = x.res - 1;
      return side === 0 ? [0, 0, 0, r] : side === 1 ? [r, 0, r, r] : side === 2 ? [0, 0, r, 0] : [0, r, r, r];
    };
    // snapshot both sides of every shared edge before they change
    for ( const { side, c: n } of c.adjacent ) {
      this.snap( ci,                             ...edge( c, side     ) );
      this.snap( this.stroke.t.indexOf( n.key ), ...edge( n, side ^ 1 ) );
    }
    this.stroke.t.syncEdges( [ci] );
  }

  restoreAll() {
    for ( const m of this.before.values() ) for ( const s of m.values() ) this.stroke.t.restore( s );
    for ( const s of this.stroke.mask.maskBefore.values() ) {
      const c = this.stroke.t.chunks[s.ci];
      if ( !c.mask ) continue;
      for ( let j = 0; j < s.h; j++ ) c.mask.set( s.data.subarray( j * s.w, ( j + 1 ) * s.w ), ( s.j0 + j ) * c.res + s.i0 );
      this.stroke.t.markDirtyRect( s.ci, s.i0, s.j0, s.i0 + s.w - 1, s.j0 + s.h - 1 );
    }
    this.stroke.ops.plane = null;
  }
}
