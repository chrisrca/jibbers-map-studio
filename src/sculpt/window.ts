// A brush's view of the terrain: a regular grid of absolute heights over the area a dab touches, sampled across
// however many chunks lie under it. Brushes work on the grid ( so smoothing, erosion or a smudge carry straight over
// chunk borders ), and the change is written back into every chunk under it.
//
// The grid is laid on the sample lattice of the finest chunk under the brush, so with chunks of one detail level the
// grid points are exactly the chunk samples: nothing is interpolated and nothing blurs.

import type { Terrain, TerrainChunk } from "../terrain/terrain";

// Reads a chunk sample ( height above the chunk base ); lets a window be filled from the stroke-start terrain.
export type SampleReader = ( c: TerrainChunk, ci: number, i: number, j: number ) => number;
// A changed rectangle of chunk samples ( inclusive ).
export interface ChunkRect {
  ci: number;
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

export const liveReader: SampleReader = ( c, _ci, i, j ) => c.heights[j * c.res + i];

// Window points i0..i1, j0..j1 ( inclusive ): the part of a window a dab can change.
export type Box = [number, number, number, number];

export class HeightWindow {
  // absolute heights
  readonly H:     Float32Array;
  // 1 where the grid point is on the map
  readonly valid: Uint8Array;
  // 0..1, how much each point is protected by the mask ( empty where no chunk under the window has one )
  mask: Float32Array;
  hasMask = false;

  constructor(
    readonly t:  Terrain,
    // world position of grid point ( 0, 0 )
    readonly x0: number,
    readonly z0: number,
    readonly sp: number,
    readonly w:  number,
    readonly h:  number,
  ) {
    this.H     = new Float32Array( w * h );
    this.valid = new Uint8Array( w * h );
    this.mask  = new Float32Array( 0 );
  }

  /**
   * A window covering [minx, maxx] × [minz, maxz] ( world ), or null if no chunk is there.
  **/
  static around( t: Terrain, minx: number, minz: number, maxx: number, maxz: number, read: SampleReader = liveReader ): HeightWindow | null {
    let fine: TerrainChunk | null = null;
    for ( const c of t.chunks ) {
      if ( maxx < c.position[0] || minx > c.position[0] + c.size[0] || maxz < c.position[2] || minz > c.position[2] + c.size[2] ) continue;
      if ( !fine || c.spacing < fine.spacing ) fine = c;
    }
    if ( !fine ) return null;
    const sp = fine.spacing, ox = fine.position[0], oz = fine.position[2];
    const i0 = Math.floor( ( minx - ox ) / sp ), i1 = Math.ceil( ( maxx - ox ) / sp );
    const j0 = Math.floor( ( minz - oz ) / sp ), j1 = Math.ceil( ( maxz - oz ) / sp );
    const w  = i1 - i0 + 1, h = j1 - j0 + 1;
    if ( w <= 0 || h <= 0 || w * h > 16e6 ) return null;
    const win = new HeightWindow( t, ox + i0 * sp, oz + j0 * sp, sp, w, h );
    win.fill( read );
    return win;
  }

  wx( i: number ) {
    return this.x0 + i * this.sp;
  }
  wz( j: number ) {
    return this.z0 + j * this.sp;
  }

  /**
   * Fills H ( and the mask ) from the chunks; grid points off the map take the nearest point on it.
  **/
  fill( read: SampleReader ) {
    const { t, w, h, sp, H, valid } = this;
    const eps                       = 1e-6;
    // ( the mask array made only when a chunk under the window has a mask )
    for ( const c of t.chunks ) if ( c.mask && this.mask.length === 0 ) this.mask = new Float32Array( w * h );
    const mask = this.mask;
    t.chunks.forEach( ( c, ci ) => {
      const cx0 = c.position[0], cz0 = c.position[2], cx1 = cx0 + c.size[0], cz1 = cz0 + c.size[2];
      const i0  = Math.max( 0, Math.ceil( ( cx0 - this.x0 ) / sp - eps ) ), i1 = Math.min( w - 1, Math.floor( ( cx1 - this.x0 ) / sp + eps ) );
      const j0  = Math.max( 0, Math.ceil( ( cz0 - this.z0 ) / sp - eps ) ), j1 = Math.min( h - 1, Math.floor( ( cz1 - this.z0 ) / sp + eps ) );
      if ( i0 > i1 || j0 > j1 ) return;
      const base = c.position[1], csp = c.spacing, res = c.res, cm = c.mask;
      // fast path: same lattice as the window ( the usual case ) and reading the live heights
      const fx0  = ( this.x0 + i0 * sp - cx0 ) / csp, fz0 = ( this.z0 + j0 * sp - cz0 ) / csp;
      if ( read === liveReader && Math.abs( csp - sp ) < 1e-9 && Math.abs( fx0 - Math.round( fx0 ) ) < 1e-4 && Math.abs( fz0 - Math.round( fz0 ) ) < 1e-4 ) {
        const ci0 = Math.round( fx0 ), cj0 = Math.round( fz0 ), Hc = c.heights;
        for ( let j = j0; j <= j1; j++ ) {
          const src = ( cj0 + j - j0 ) * res + ci0, dst = j * w;
          for ( let i = i0; i <= i1; i++ ) {
            const k = dst + i;
            if ( valid[k] ) continue;
            const idx = src + i - i0;
            H[k]      = Hc[idx] + base;
            valid[k]  = 1;
            if ( cm && cm[idx] ) {
              mask[k]      = cm[idx] / 255;
              this.hasMask = true;
            }
          }
        }
        return;
      }
      for ( let j = j0; j <= j1; j++ ) {
        const fz = ( this.z0 + j * sp - cz0 ) / csp;
        for ( let i = i0; i <= i1; i++ ) {
          const k = j * w + i;
          if ( valid[k] ) continue; // shared edges: already read from the neighbour ( they match )
          const fx         = ( this.x0 + i * sp - cx0 ) / csp;
          const ri         = Math.round( fx ), rj = Math.round( fz );
          let v: number, m = 0;
          if ( Math.abs( fx - ri ) < 1e-4 && Math.abs( fz - rj ) < 1e-4 ) {
            const ii = Math.min( res - 1, Math.max( 0, ri ) ), jj = Math.min( res - 1, Math.max( 0, rj ) );
            v        = read( c, ci, ii, jj );
            if ( cm ) m = cm[jj * res + ii];
          } else {
            const a = Math.min( res - 2, Math.max( 0, Math.floor( fx ) ) ), b = Math.min( res - 2, Math.max( 0, Math.floor( fz ) ) );
            const u = Math.min( 1, Math.max( 0, fx - a ) ), vv = Math.min( 1, Math.max( 0, fz - b ) );
            v       = ( read( c, ci, a, b ) * ( 1 - u ) + read( c, ci, a + 1, b ) * u ) * ( 1 - vv ) + ( read( c, ci, a, b + 1 ) * ( 1 - u ) + read( c, ci, a + 1, b + 1 ) * u ) * vv;
            if ( cm ) m = cm[Math.min( res - 1, Math.max( 0, Math.round( fz ) ) ) * res + Math.min( res - 1, Math.max( 0, Math.round( fx ) ) )];
          }
          H[k]     = v + base;
          valid[k] = 1;
          if ( m ) {
            mask[k]      = m / 255;
            this.hasMask = true;
          }
        }
      }
    } );
    // off the map: copy the nearest valid point along the row, then along the column
    let any = false;
    for ( let k = 0; k < valid.length; k++ ) if ( !valid[k] ) { any = true; break; }
    if ( !any ) return;
    const filled = valid.slice();
    for ( let j = 0; j < h; j++ ) {
      const row = j * w;
      let last  = -1;
      for ( let i = 0; i < w; i++ ) if ( valid[row + i] ) { last = i; break; }
      if ( last < 0 ) continue;
      for ( let i = 0; i < w; i++ ) {
        if ( valid[row + i] ) last = i;
        else { H[row + i] = H[row + last]; filled[row + i] = 1; }
      }
    }
    for ( let i = 0; i < w; i++ ) {
      let last = -1;
      for ( let j = 0; j < h; j++ ) if ( filled[j * w + i] ) { last = j; break; }
      if ( last < 0 ) continue;
      for ( let j = 0; j < h; j++ ) {
        if ( filled[j * w + i] ) last = j;
        else H[j * w + i] = H[last * w + i];
      }
    }
  }

  /**
   * A window over the same grid, filled with `read` ( e.g. the terrain as it was when the stroke started ).
  **/
  sameGrid( read: SampleReader ): HeightWindow {
    const win = new HeightWindow( this.t, this.x0, this.z0, this.sp, this.w, this.h );
    win.fill( read );
    return win;
  }

  /**
   * Bilinear height at fractional grid coordinates ( clamped to the window ).
  **/
  at( fx: number, fz: number, g: Float32Array = this.H ): number {
    const { w, h } = this;
    if ( fx < 0 ) fx = 0; else if ( fx > w - 1 ) fx = w - 1;
    if ( fz < 0 ) fz = 0; else if ( fz > h - 1 ) fz = h - 1;
    const i = Math.min( w - 2, Math.floor( fx ) ), j = Math.min( h - 2, Math.floor( fz ) );
    if ( w < 2 || h < 2 ) return g[0];
    const a = fx - i, b = fz - j, p = j * w + i;
    return ( g[p] * ( 1 - a ) + g[p + 1] * a ) * ( 1 - b ) + ( g[p + w] * ( 1 - a ) + g[p + w + 1] * a ) * b;
  }

  /**
   * Bilinear height at a world point.
  **/
  atWorld( x: number, z: number, g: Float32Array = this.H ) {
    return this.at( ( x - this.x0 ) / this.sp, ( z - this.z0 ) / this.sp, g );
  }

  /**
   * Writes `out` ( new absolute heights for the grid ) back into the chunks: each chunk sample under the window gets
   * the change at its position ( exact where the lattices match ). `before( ci, i0, j0, i1, j1 )` is called first for
   * every chunk rectangle about to change ( the stroke snapshots it for undo ). Returns the touched chunk indices.
  **/
  writeBack( out: Float32Array, before: ( ci: number, i0: number, j0: number, i1: number, j1: number ) => void, box: Box = [0, this.w - 1, 0, this.h - 1], H: Float32Array = this.H ): ChunkRect[] {
    const { t, w, h, sp } = this;
    const D               = new Float32Array( w * h );
    let any               = false;
    let mi0               = w, mi1 = -1, mj0 = h, mj1 = -1;
    // ( only `box` can have changed )
    for ( let j = box[2]; j <= box[3]; j++ )
      for ( let i = box[0]; i <= box[1]; i++ ) {
        const k = j * w + i;
        const d = out[k] - H[k];
        if ( d !== 0 && this.valid[k] ) {
          D[k] = d;
          any  = true;
          if ( i < mi0 ) mi0 = i;
          if ( i > mi1 ) mi1 = i;
          if ( j < mj0 ) mj0 = j;
          if ( j > mj1 ) mj1 = j;
        }
      }
    if ( !any ) return [];
    // only the part of the window that changed ( plus one point for interpolation )
    const ax                   = this.x0 + Math.max( 0, mi0 - 1 ) * sp, bx = this.x0 + Math.min( w - 1, mi1 + 1 ) * sp;
    const az                   = this.z0 + Math.max( 0, mj0 - 1 ) * sp, bz = this.z0 + Math.min( h - 1, mj1 + 1 ) * sp;
    const touched: ChunkRect[] = [];
    t.chunks.forEach( ( c, ci ) => {
      const cx0 = c.position[0], cz0 = c.position[2];
      if ( bx < cx0 || ax > cx0 + c.size[0] || bz < cz0 || az > cz0 + c.size[2] ) return;
      const csp = c.spacing, res = c.res;
      const i0  = Math.max( 0, Math.ceil( ( ax - cx0 ) / csp - 1e-6 ) ), i1 = Math.min( res - 1, Math.floor( ( bx - cx0 ) / csp + 1e-6 ) );
      const j0  = Math.max( 0, Math.ceil( ( az - cz0 ) / csp - 1e-6 ) ), j1 = Math.min( res - 1, Math.floor( ( bz - cz0 ) / csp + 1e-6 ) );
      if ( i0 > i1 || j0 > j1 ) return;
      before( ci, i0, j0, i1, j1 );
      const Hc    = c.heights, top = c.size[1];
      let changed = false;
      const fx0   = ( cx0 + i0 * csp - this.x0 ) / sp, fz0 = ( cz0 + j0 * csp - this.z0 ) / sp;
      if ( Math.abs( csp - sp ) < 1e-9 && Math.abs( fx0 - Math.round( fx0 ) ) < 1e-4 && Math.abs( fz0 - Math.round( fz0 ) ) < 1e-4 ) {
        // same lattice: chunk sample ( i, j ) is window point ( wi0 + i - i0, wj0 + j - j0 )
        const wi0 = Math.round( fx0 ), wj0 = Math.round( fz0 );
        for ( let j = j0; j <= j1; j++ ) {
          const row = ( wj0 + j - j0 ) * w + wi0 - i0, crow = j * res;
          for ( let i = i0; i <= i1; i++ ) {
            const d = D[row + i];
            if ( d === 0 ) continue;
            const v      = Hc[crow + i] + d;
            Hc[crow + i] = v < 0 ? 0 : v > top ? top : v;
            changed      = true;
          }
        }
        if ( changed ) {
          t.markDirtyRect( ci, i0, j0, i1, j1 );
          touched.push( { ci, i0, j0, i1, j1 } );
        }
        return;
      }
      for ( let j = j0; j <= j1; j++ ) {
        const fz = ( cz0 + j * csp - this.z0 ) / sp;
        for ( let i = i0; i <= i1; i++ ) {
          const fx = ( cx0 + i * csp - this.x0 ) / sp;
          const ri = Math.round( fx ), rj = Math.round( fz );
          const d  = Math.abs( fx - ri ) < 1e-4 && Math.abs( fz - rj ) < 1e-4 ? D[rj * w + ri] : this.at( fx, fz, D );
          if ( d === 0 ) continue;
          const idx = j * res + i;
          const v   = Hc[idx] + d;
          Hc[idx]   = v < 0 ? 0 : v > top ? top : v;
          changed   = true;
        }
      }
      if ( changed ) {
        t.markDirtyRect( ci, i0, j0, i1, j1 );
        touched.push( { ci, i0, j0, i1, j1 } );
      }
    } );
    return touched;
  }
}

/**
 * Separable box blur of a w×h grid, edges clamped. Two passes ≈ a gaussian.
**/
export function blurGrid( src: Float32Array, w: number, h: number, r: number ): Float32Array {
  if ( r < 1 ) return src.slice();
  const tmp = new Float32Array( w * h ), out = new Float32Array( w * h ), n = 2 * r + 1;
  for ( let j = 0; j < h; j++ ) {
    const row = j * w;
    let sum   = 0;
    for ( let d = -r; d <= r; d++ ) sum += src[row + Math.min( w - 1, Math.max( 0, d ) )];
    for ( let i = 0; i < w; i++ ) {
      tmp[row + i] = sum / n;
      sum         += src[row + Math.min( w - 1, i + r + 1 )] - src[row + Math.max( 0, i - r )];
    }
  }
  for ( let i = 0; i < w; i++ ) {
    let sum = 0;
    for ( let d = -r; d <= r; d++ ) sum += tmp[Math.min( h - 1, Math.max( 0, d ) ) * w + i];
    for ( let j = 0; j < h; j++ ) {
      out[j * w + i] = sum / n;
      sum           += tmp[Math.min( h - 1, j + r + 1 ) * w + i] - tmp[Math.max( 0, j - r ) * w + i];
    }
  }
  return out;
}

export const gaussianish = ( src: Float32Array, w: number, h: number, r: number ) => {
  const half = Math.max( 1, Math.round( r / 2 ) );
  return blurGrid( blurGrid( src, w, h, half ), w, h, half );
};

// Every f-th point of a window ( on the world's lattice, so the points line up from one dab to the next ), for the
// smooth parts of a big brush's work ( its weights, blurs, planes, how much of the stroke has covered a spot ): worked
// out there and read back between them, the brush's result is still made at every sample. With f = 1 it's the window.
export class Lattice {
  // the coarse points: columns and rows
  readonly cw:  number;
  readonly ch:  number;
  // the window index of coarse column 0 / row 0
  readonly oi:  number;
  readonly oj:  number;
  // the world lattice index of coarse column 0 / row 0 ( in coarse steps )
  readonly gi0: number;
  readonly gj0: number;

  constructor( readonly win: HeightWindow, readonly f: number ) {
    const gi = Math.round( win.x0 / win.sp ), gj = Math.round( win.z0 / win.sp );
    this.oi  = ( f - ( ( ( gi % f ) + f ) % f ) ) % f;
    this.oj  = ( f - ( ( ( gj % f ) + f ) % f ) ) % f;
    this.cw  = Math.max( 1, Math.floor( ( win.w - 1 - this.oi ) / f ) + 1 );
    this.ch  = Math.max( 1, Math.floor( ( win.h - 1 - this.oj ) / f ) + 1 );
    this.gi0 = ( gi + this.oi ) / f;
    this.gj0 = ( gj + this.oj ) / f;
  }

  /**
   * the window index of coarse column I / row J
  **/
  fi( I: number ) {
    return Math.min( this.win.w - 1, this.oi + I * this.f );
  }
  fj( J: number ) {
    return Math.min( this.win.h - 1, this.oj + J * this.f );
  }

  /**
   * The coarse points ( columns I0..I1, rows J0..J1 ) round window points `box`.
  **/
  range( box: Box = [0, this.win.w - 1, 0, this.win.h - 1] ): Box {
    const { f } = this;
    return [
      Math.max( 0, Math.floor( ( box[0] - this.oi ) / f ) ), Math.min( this.cw - 1, Math.ceil( ( box[1] - this.oi ) / f ) ),
      Math.max( 0, Math.floor( ( box[2] - this.oj ) / f ) ), Math.min( this.ch - 1, Math.ceil( ( box[3] - this.oj ) / f ) ),
    ];
  }

  /**
   * A field at the coarse points round `box` from `at( i, j, K )` ( window indices of the point, its coarse index );
   * 0 elsewhere.
  **/
  make( at: ( i: number, j: number, K: number ) => number, box?: Box ): Float32Array {
    const out              = new Float32Array( this.cw * this.ch );
    const [I0, I1, J0, J1] = this.range( box );
    for ( let J = J0; J <= J1; J++ ) {
      const j = this.fj( J );
      for ( let I = I0; I <= I1; I++ ) out[J * this.cw + I] = at( this.fi( I ), j, J * this.cw + I );
    }
    return out;
  }

  /**
   * A window field averaged over each coarse point's f × f block, round `box` ( the window field itself when
   * f = 1 ).
  **/
  down( F: Float32Array, box?: Box ): Float32Array {
    const { f, win } = this;
    if ( f === 1 ) return F;
    const out              = new Float32Array( this.cw * this.ch ), half = Math.floor( f / 2 );
    const [I0, I1, J0, J1] = this.range( box );
    for ( let J = J0; J <= J1; J++ ) {
      const jc = this.fj( J ), j0 = Math.max( 0, jc - half ), j1 = Math.min( win.h - 1, jc + f - 1 - half );
      for ( let I = I0; I <= I1; I++ ) {
        const ic = this.fi( I ), i0 = Math.max( 0, ic - half ), i1 = Math.min( win.w - 1, ic + f - 1 - half );
        let s    = 0;
        for ( let j = j0; j <= j1; j++ ) for ( let i = i0, k = j * win.w + i0; i <= i1; i++, k++ ) s += F[k];
        out[J * this.cw + I] = s / ( ( j1 - j0 + 1 ) * ( i1 - i0 + 1 ) );
      }
    }
    return out;
  }

  /**
   * A coarse field read at every window point ( bilinear between the coarse points; held past the outer ones ): in
   * `box` only ( 0 elsewhere ).
  **/
  up( C: Float32Array, box: Box = [0, this.win.w - 1, 0, this.win.h - 1] ): Float32Array {
    const { f, win, cw, ch } = this;
    if ( f === 1 ) return C;
    const { w } = win, out = new Float32Array( w * win.h );
    const cols  = new Int32Array( w ), ct = new Float32Array( w );
    for ( let i = box[0]; i <= box[1]; i++ ) {
      const u = ( i - this.oi ) / f, I = Math.min( Math.max( 0, cw - 2 ), Math.max( 0, Math.floor( u ) ) );
      cols[i] = I;
      ct[i]   = cw < 2 ? 0 : Math.min( 1, Math.max( 0, ( i - this.fi( I ) ) / Math.max( 1, this.fi( I + 1 ) - this.fi( I ) ) ) );
    }
    for ( let j = box[2]; j <= box[3]; j++ ) {
      const v  = ( j - this.oj ) / f, J = Math.min( Math.max( 0, ch - 2 ), Math.max( 0, Math.floor( v ) ) );
      const tj = ch < 2 ? 0 : Math.min( 1, Math.max( 0, ( j - this.fj( J ) ) / Math.max( 1, this.fj( J + 1 ) - this.fj( J ) ) ) );
      const r0 = J * cw, r1 = ch < 2 ? r0 : r0 + cw, row = j * w;
      for ( let i = box[0]; i <= box[1]; i++ ) {
        const I      = cols[i], t = ct[i], I1 = cw < 2 ? I : I + 1;
        const a      = C[r0 + I] + ( C[r0 + I1] - C[r0 + I] ) * t, b = C[r1 + I] + ( C[r1 + I1] - C[r1 + I] ) * t;
        out[row + i] = a + ( b - a ) * tj;
      }
    }
    return out;
  }
}
