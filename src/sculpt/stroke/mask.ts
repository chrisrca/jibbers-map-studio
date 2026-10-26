// The Mask brush: painting the sculpt mask ( and its snapshots, for undo ).

import type { TerrainChunk } from "../../terrain/terrain";
import { makeTip } from "../tip";
import type { BrushStroke } from "./stroke";
import { Dab, MaskSnap } from "./stroke";

// The Mask brush.
export class StrokeMask {
  constructor( private stroke: BrushStroke ) {}

  maskBefore = new Map<string, MaskSnap>();

  paintMask( d: Dab ) {
    const tip = makeTip( this.stroke.s, d.x, d.z, d.r, d.angle );
    const add = this.stroke.sign > 0;
    this.stroke.t.chunks.forEach( ( c, ci ) => {
      const x0 = c.position[0], z0 = c.position[2], sp = c.spacing, res = c.res;
      if ( d.x + d.r < x0 || d.x - d.r > x0 + c.size[0] || d.z + d.r < z0 || d.z - d.r > z0 + c.size[2] ) return;
      const i0 = Math.max( 0, Math.floor( ( d.x - d.r - x0 ) / sp ) ), i1 = Math.min( res - 1, Math.ceil( ( d.x + d.r - x0 ) / sp ) );
      const j0 = Math.max( 0, Math.floor( ( d.z - d.r - z0 ) / sp ) ), j1 = Math.min( res - 1, Math.ceil( ( d.z + d.r - z0 ) / sp ) );
      if ( !c.mask ) {
        if ( !add ) return;
        c.mask = new Uint8Array( res * res );
      }
      this.snapMask( c, ci, i0, j0, i1, j1 );
      const M = c.mask;
      for ( let j = j0; j <= j1; j++ )
        for ( let i = i0; i <= i1; i++ ) {
          const wt = tip.weight( x0 + i * sp, z0 + j * sp ) * d.strength;
          if ( wt <= 0 ) continue;
          const idx = j * res + i;
          const v   = add ? Math.max( M[idx], wt * 255 ) : M[idx] * ( 1 - wt );
          M[idx]    = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      this.stroke.t.markDirtyRect( ci, i0, j0, i1, j1 );
      this.stroke.changed = true;
    } );
  }

  private snapMask( c: TerrainChunk, ci: number, i0: number, j0: number, i1: number, j1: number ) {
    for ( const ti of c.tilesTouching( i0, j0, i1, j1 ) ) {
      const key = `${ci}:${ti}`;
      if ( this.maskBefore.has( key ) ) continue;
      const q    = c.tileQuads, tx = ti % c.tilesPerSide, tz = Math.floor( ti / c.tilesPerSide );
      const a0   = tx * q, b0 = tz * q, a1 = Math.min( c.res - 1, a0 + q ), b1 = Math.min( c.res - 1, b0 + q );
      const w    = a1 - a0 + 1, h = b1 - b0 + 1;
      const data = new Uint8Array( w * h );
      for ( let j = 0; j < h; j++ ) data.set( c.mask!.subarray( ( b0 + j ) * c.res + a0, ( b0 + j ) * c.res + a0 + w ), j * w );
      this.maskBefore.set( key, { ci, i0: a0, j0: b0, w, h, data } );
    }
  }
}
