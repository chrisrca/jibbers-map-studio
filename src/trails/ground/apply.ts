// Applying a change of trails to the ground: the old net's making taken out and the new one's put in, block by
// block, near ones first ( the far part a slice a frame ).

import { type ChunkInit, terrain } from "../../terrain/terrain";
import type { TrailNet } from "../trails";
import { BT, baseKey, bases, snapshotBlock } from "./base";
import { detailOf, fieldAt, fieldBlock, fieldBlockSmooth } from "./field";
import { type Placed, type Raster, place, rasterRuns } from "./runs";
import type { Field, Rect } from "./types";

const overlaps = ( a: Rect, b: Rect ) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/**
 * Where going from one net/field to another can change the ground: runs that differ, cells whose bend differs
 * ( merged where they overlap ); and the runs' own areas.
**/
function changedRects( fromP: Placed[], toP: Placed[], ff: Field | null, tf: Field | null ): { rects: Rect[]; runBoxes: Rect[] } {
  const rects: Rect[]    = [];
  const key              = ( p: Placed ) => p.strip.pts;
  const same             = ( a: Float32Array, b: Float32Array ) => a === b || ( a.length === b.length && a.every( ( v, i ) => v === b[i] ) );
  const fromBy           = new Map( fromP.map( ( p ) => [p.strip.run, p] ) ), toBy = new Map( toP.map( ( p ) => [p.strip.run, p] ) );
  const runBoxes: Rect[] = [];
  // ( the runs' own ground: its bands, a few rows each, so a long run across the map isn't all its bounding box )
  const bandsOf          = ( p: Placed ) => {
    const B = p.bands, n = B.length / 4, step = 8;
    for ( let k = 0; k < n; k += step ) {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for ( let q = k; q < Math.min( n, k + step ); q++ ) { a = Math.min( a, B[q * 4] ); b = Math.min( b, B[q * 4 + 1] ); c = Math.max( c, B[q * 4 + 2] ); d = Math.max( d, B[q * 4 + 3] ); }
      runBoxes.push( [a, b, c, d] );
    }
  };
  for ( const [id, p] of fromBy ) {
    const q = toBy.get( id );
    if ( !q || q.detail !== p.detail || !same( key( p ), key( q ) ) ) { rects.push( p.box ); bandsOf( p ); }
  }
  for ( const [id, q] of toBy ) {
    const p = fromBy.get( id );
    if ( !p || q.detail !== p.detail || !same( key( p ), key( q ) ) ) { rects.push( q.box ); bandsOf( q ); }
  }
  // the bend: blocks of 16 × 16 cells where it differs ( a cell's width more round them: samples near read them )
  const fields = [ff, tf].filter( ( f ): f is Field => !!f );
  if ( fields.length && fields.every( ( f ) => f.sp === fields[0].sp && f.v === fields[0].v ) ) {
    const sp   = fields[0].sp;
    const I0   = Math.round( Math.min( ...fields.map( ( f ) => f.x0 ) ) / sp ), J0 = Math.round( Math.min( ...fields.map( ( f ) => f.z0 ) ) / sp );
    const I1   = Math.round( Math.max( ...fields.map( ( f ) => f.x0 + ( f.w - 1 ) * f.sp ) ) / sp ), J1 = Math.round( Math.max( ...fields.map( ( f ) => f.z0 + ( f.h - 1 ) * f.sp ) ) / sp );
    // a field's cell at world cell ( I, J ): its bend, and its smoothed ground ( 0 where it has none )
    const cell = ( f: Field | null, I: number, J: number, arr: "c" | "b" ) => {
      if ( !f ) return 0;
      const i = I - Math.round( f.x0 / sp ), j = J - Math.round( f.z0 / sp );
      const a = f[arr];
      return a && i >= 0 && j >= 0 && i < f.w && j < f.h ? a[j * f.w + i] : 0;
    };
    const pad = 3 * sp;
    for ( let BJ = J0; BJ <= J1; BJ += 16 )
      for ( let BI = I0; BI <= I1; BI += 16 ) {
        let differs = false;
        for ( let J = BJ; J < BJ + 16 && J <= J1 && !differs; J++ )
          for ( let I = BI; I < BI + 16 && I <= I1; I++ )
            if ( Math.abs( cell( ff, I, J, "c" ) - cell( tf, I, J, "c" ) ) > 1e-4 || cell( ff, I, J, "b" ) !== cell( tf, I, J, "b" ) ) {
              differs = true;
              break;
            }
        if ( differs ) rects.push( [BI * sp - pad, BJ * sp - pad, ( BI + 16 ) * sp + pad, ( BJ + 16 ) * sp + pad] );
      }
  } else if ( fields.length ) {
    const sp = Math.min( ...fields.map( ( f ) => f.sp ) );
    const X0 = Math.min( ...fields.map( ( f ) => f.x0 ) ), Z0 = Math.min( ...fields.map( ( f ) => f.z0 ) );
    const X1 = Math.max( ...fields.map( ( f ) => f.x0 + ( f.w - 1 ) * f.sp ) ), Z1 = Math.max( ...fields.map( ( f ) => f.z0 + ( f.h - 1 ) * f.sp ) );
    const B  = 16 * sp;
    for ( let bz = Z0; bz <= Z1; bz += B )
      for ( let bx = X0; bx <= X1; bx += B ) {
        let differs = false;
        for ( let z = bz; z < bz + B && z <= Z1 && !differs; z += sp )
          for ( let x = bx; x < bx + B && x <= X1; x += sp )
            if ( Math.abs( fieldAt( ff, x, z ) - fieldAt( tf, x, z ) ) > 1e-4 ) {
              differs = true;
              break;
            }
        if ( differs ) rects.push( [bx - 2 * sp, bz - 2 * sp, bx + B + 2 * sp, bz + B + 2 * sp] );
      }
  }
  // overlapping ones merged ( each sample worked on once )
  const merged: Rect[] = [];
  for ( const r of rects ) {
    let cur: Rect = [...r];
    for ( let k = 0; k < merged.length; k++ )
      if ( overlaps( merged[k], cur ) ) {
        const m = merged.splice( k, 1 )[0];
        cur     = [Math.min( m[0], cur[0] ), Math.min( m[1], cur[1] ), Math.max( m[2], cur[2] ), Math.max( m[3], cur[3] )];
        k       = -1;
      }
    merged.push( cur );
  }
  return { rects: merged, runBoxes };
}

// headroom kept below and above a tile's ground ( room to sculpt )
export const BELOW = 60, ABOVE = 200;

// One block of a tile to work on: its samples [a0..a1] × [b0..b1], those marked in `mask` ( block-relative ) only
// when two changed areas share the block.
interface Task {
  key:  string;
  bi:   number;
  bj:   number;
  a0:   number;
  a1:   number;
  b0:   number;
  b1:   number;
  mask: Uint8Array | null;
  // how far from a run that changed ( nearest done first; 0 under one )
  d:    number;
}

interface Job {
  fromP:   Placed[];
  toP:     Placed[];
  ff:      Field | null;
  tf:      Field | null;
  tasks:   Task[];
  next:    number;
  // tile key → the lowest and highest heights written there
  need:    Map<string, [number, number]>;
  // blocks that went beyond their tile's height range: written once the tile has room
  staged:  { key: string; i0: number; j0: number; w: number; h: number; v: Float32Array; mask: Uint8Array | null; bi: number; bj: number }[];
  changed: number;
}

// The ground still to be brought up to date ( the far part of the last change ), if any.
let pending: Job | null = null;

/**
 * The blocks to work on for a change, near ones first.
**/
function planJob( fromP: Placed[], toP: Placed[], ff: Field | null, tf: Field | null ): Job {
  const { rects, runBoxes } = changedRects( fromP, toP, ff, tf );
  const byBlock             = new Map<string, Task>();
  for ( const r of rects )
    for ( const c of terrain.chunks ) {
      const x0 = c.position[0], z0 = c.position[2], sp = c.spacing;
      if ( r[2] < x0 || r[0] > x0 + c.size[0] || r[3] < z0 || r[1] > z0 + c.size[2] ) continue;
      const i0 = Math.max( 0, Math.floor( ( r[0] - x0 ) / sp ) ), i1 = Math.min( c.res - 1, Math.ceil( ( r[2] - x0 ) / sp ) );
      const j0 = Math.max( 0, Math.floor( ( r[1] - z0 ) / sp ) ), j1 = Math.min( c.res - 1, Math.ceil( ( r[3] - z0 ) / sp ) );
      if ( i1 < i0 || j1 < j0 ) continue;
      for ( let bj = Math.floor( j0 / BT ); bj <= Math.floor( j1 / BT ); bj++ )
        for ( let bi = Math.floor( i0 / BT ); bi <= Math.floor( i1 / BT ); bi++ ) {
          const a0 = Math.max( i0, bi * BT ), a1 = Math.min( i1, bi * BT + BT - 1 ), b0 = Math.max( j0, bj * BT ), b1 = Math.min( j1, bj * BT + BT - 1 );
          const id = baseKey( c.key, bi, bj );
          const t  = byBlock.get( id );
          if ( !t ) {
            const cx       = x0 + ( ( a0 + a1 ) / 2 ) * sp, cz = z0 + ( ( b0 + b1 ) / 2 ) * sp;
            const bx: Rect = [x0 + a0 * sp, z0 + b0 * sp, x0 + a1 * sp, z0 + b1 * sp];
            const d        = runBoxes.some( ( q ) => overlaps( q, bx ) ) ? 0 : runBoxes.length ? Math.min( ...runBoxes.map( ( q ) => Math.hypot( Math.max( q[0] - cx, 0, cx - q[2] ), Math.max( q[1] - cz, 0, cz - q[3] ) ) ) ) : 0;
            byBlock.set( id, { key: c.key, bi, bj, a0, a1, b0, b1, mask: null, d } );
            continue;
          }
          // a second area in the same block: the samples of both marked, each worked on once
          if ( !t.mask ) {
            t.mask = new Uint8Array( BT * BT );
            for ( let j = t.b0; j <= t.b1; j++ ) t.mask.fill( 1, ( j - bj * BT ) * BT + t.a0 - bi * BT, ( j - bj * BT ) * BT + t.a1 - bi * BT + 1 );
          }
          for ( let j = b0; j <= b1; j++ ) t.mask.fill( 1, ( j - bj * BT ) * BT + a0 - bi * BT, ( j - bj * BT ) * BT + a1 - bi * BT + 1 );
          t.a0 = Math.min( t.a0, a0 );
          t.a1 = Math.max( t.a1, a1 );
          t.b0 = Math.min( t.b0, b0 );
          t.b1 = Math.max( t.b1, b1 );
        }
    }
  const tasks = [...byBlock.values()].sort( ( a, b ) => a.d - b.d );
  return { fromP, toP, ff, tf, tasks, next: 0, need: new Map(), staged: [], changed: 0 };
}

// The runs' ground worked out on blocks by the last change and by this one: the next change's old ground is this
// one's new ( the same nets, the same strips ), so it isn't worked out twice.
const rasters: { job: Job | null; last: Map<string, { placed: Placed[]; r: Raster }>; now: Map<string, { placed: Placed[]; r: Raster }> } = { job: null, last: new Map(), now: new Map() };

/**
 * Works on one block: the old net's ground out, the new one's in. Returns whether anything changed.
**/
function runTask( job: Job, t: Task ): boolean {
  const ci = terrain.indexOf( t.key );
  const c  = terrain.chunks[ci];
  if ( !c ) return false;
  snapshotBlock( ci, t.bi, t.bj );
  const sp = c.spacing, w = t.a1 - t.a0 + 1, h = t.b1 - t.b0 + 1;
  const gx = c.position[0] + t.a0 * sp, gz = c.position[2] + t.b0 * sp;
  if ( rasters.job !== job ) {
    rasters.job  = job;
    rasters.last = rasters.now;
    rasters.now  = new Map();
  }
  const at  = `${t.key}:${t.a0},${t.b0},${w},${h}`, kept = rasters.last.get( at ) ?? rasters.now.get( at );
  const old = kept && kept.placed === job.fromP ? kept.r : rasterRuns( job.fromP, gx, gz, sp, w, h ), now = rasterRuns( job.toP, gx, gz, sp, w, h );
  rasters.now.set( at, { placed: job.toP, r: now } );
  const fo = fieldBlock( job.ff, gx, gz, sp, w, h ), fn = fieldBlock( job.tf, gx, gz, sp, w, h );
  if ( !old && !now && !fo && !fn ) return false;
  const v    = new Float32Array( w * h );
  const H    = c.heights, res = c.res, y0 = c.position[1], top = y0 + c.size[1];
  const base = bases.get( baseKey( c.key, t.bi, t.bj ) )!, bArr = typeof base === "number" ? null : base, bNum = typeof base === "number" ? base : 0;
  const oy   = old?.y, oc = old?.cover, ny = now?.y, nc = now?.cover, M = t.mask;
  // ( runs keeping the ground's detail: the smoothed ground under them, for the detail = ground less it )
  const ok   = old?.k, nk = now?.k;
  const Bo   = ok && job.ff?.b ? fieldBlockSmooth( job.ff, job.ff.b, gx, gz, sp, w, h ) : null, Bn = nk && job.tf?.b ? fieldBlockSmooth( job.tf, job.tf.b, gx, gz, sp, w, h ) : null;
  let lo     = Infinity, hi = -Infinity, any = false;
  for ( let j = 0; j < h; j++ ) {
    const row = ( t.b0 + j ) * res + t.a0, brow = ( t.b0 + j - t.bj * BT ) * BT + t.a0 - t.bi * BT;
    for ( let i = 0; i < w; i++ ) {
      if ( M && !M[brow + i] ) continue;
      const k = j * w + i, cur = y0 + H[row + i];
      let nv: number;
      if ( !oc && !nc ) {
        // no run here: just the change in the bend
        nv = cur + ( ( fn ? fn[k] : 0 ) - ( fo ? fo[k] : 0 ) );
      } else {
        const b      = bArr ? bArr[brow + i] : bNum;
        let co       = oc ? oc[k] : 0, cn = nc ? nc[k] : 0;
        co           = co * co * ( 3 - 2 * co );
        cn           = cn * cn * ( 3 - 2 * cn );
        const so     = ( oy ? oy[k] : 0 ) + ( ok && Bo ? ok[k] * detailOf( b - Bo[k] ) : 0 ), sn = ( ny ? ny[k] : 0 ) + ( nk && Bn ? nk[k] * detailOf( b - Bn[k] ) : 0 );
        const outOld = ( b + ( fo ? fo[k] : 0 ) ) * ( 1 - co ) + so * co;
        const outNew = ( b + ( fn ? fn[k] : 0 ) ) * ( 1 - cn ) + sn * cn;
        nv           = cur + ( outNew - outOld );
      }
      v[k] = nv;
      if ( nv !== cur ) {
        job.changed++;
        any = true;
        if ( nv >= y0 && nv <= top ) H[row + i] = nv - y0;
      }
      if ( nv < lo ) lo = nv;
      if ( nv > hi ) hi = nv;
    }
  }
  if ( !any ) return false;
  terrain.markDirtyRect( ci, t.a0, t.b0, t.a1, t.b1 );
  if ( lo < y0 || hi > top ) job.staged.push( { key: t.key, i0: t.a0, j0: t.b0, w, h, v, mask: M, bi: t.bi, bj: t.bj } );
  const n = job.need.get( t.key );
  job.need.set( t.key, n ? [Math.min( n[0], lo ), Math.max( n[1], hi )] : [lo, hi] );
  return true;
}

/**
 * Works on blocks until `until` ( performance.now ); once all are done, finishes the job.
**/
function work( job: Job, until: number ) {
  const touched = new Set<number>();
  while ( job.next < job.tasks.length && performance.now() < until ) {
    const t = job.tasks[job.next++];
    if ( runTask( job, t ) ) touched.add( terrain.indexOf( t.key ) );
  }
  if ( touched.size ) terrain.syncEdges( touched );
  if ( job.next >= job.tasks.length ) finish( job );
}

function finish( job: Job ) {
  if ( pending === job ) pending = null;
  // tiles too shallow for the new heights: more room ( the same ground, a new base and height )
  const regrow = [...job.need].filter( ( [key, [lo, hi]] ) => {
    const c = terrain.chunks[terrain.indexOf( key )];
    return c && ( lo < c.position[1] || hi > c.position[1] + c.size[1] );
  } );
  if ( regrow.length ) {
    const keys = new Map( regrow );
    terrain.setChunks(
      terrain.chunks.map( ( c ): ChunkInit => {
        const n     = keys.get( c.key );
        const plain = { key: c.key, position: c.position, size: c.size, res: c.res, heights: c.heights, snowMask: c.snowMask };
        if ( !n ) return plain;
        let lo = Infinity, hi = -Infinity;
        for ( const v of c.heights ) { lo = Math.min( lo, v ); hi = Math.max( hi, v ); }
        lo         = Math.min( lo + c.position[1], n[0] );
        hi         = Math.max( hi + c.position[1], n[1] );
        const base = Math.floor( lo - BELOW ), top = Math.ceil( hi - base + ABOVE );
        const H    = new Float32Array( c.heights.length ), shift = c.position[1] - base;
        for ( let k = 0; k < H.length; k++ ) H[k] = c.heights[k] + shift;
        return { ...plain, position: [c.position[0], base, c.position[2]], size: [c.size[0], top, c.size[2]], heights: H };
      } ),
    );
  }
  const touched = new Set<number>();
  for ( const wr of job.staged ) {
    const ci = terrain.indexOf( wr.key ), c = terrain.chunks[ci], y0 = c.position[1];
    for ( let j = 0; j < wr.h; j++ )
      for ( let i = 0; i < wr.w; i++ ) {
        if ( wr.mask && !wr.mask[( wr.j0 + j - wr.bj * BT ) * BT + wr.i0 + i - wr.bi * BT] ) continue;
        c.heights[( wr.j0 + j ) * c.res + wr.i0 + i] = wr.v[j * wr.w + i] - y0;
      }
    terrain.markDirtyRect( ci, wr.i0, wr.j0, wr.i0 + wr.w - 1, wr.j0 + wr.h - 1 );
    touched.add( ci );
  }
  if ( touched.size ) terrain.syncEdges( touched );
}

/**
 * Brings the ground fully up to date now ( before another change, undo, a save or an export ).
**/
export function flushTrails() {
  const job = pending;
  if ( job ) work( job, Infinity );
}

// In the app, the far part of a change is done a slice per frame; elsewhere ( tests ) all at once.
const sliced = typeof requestAnimationFrame !== "undefined";

function pump() {
  const job = pending;
  if ( !job ) return;
  // ( a tile or two a frame: each also costs its upload to the GPU and the frame that draws it )
  work( job, performance.now() + 4 );
  if ( pending === job ) requestAnimationFrame( pump );
}

/**
 * Goes from one net ( and its bend ) to another: where anything differs, the ground the old one made comes out and
 * the new one's goes in, whatever was sculpted since staying on top. The blocks next to runs that changed are done
 * at once, the rest a slice per frame ( flushTrails finishes them ). Tiles whose height range is too small are given
 * more room. Returns the samples changed so far.
**/
export function applyNet( from: TrailNet, ff: Field | null, to: TrailNet, tf: Field | null ): number {
  flushTrails();
  const job = planJob( place( from ), place( to ), ff, tf );
  if ( !sliced ) {
    work( job, Infinity );
    return job.changed;
  }
  // ( all of it a slice per frame, nearest first: the drawn trails already show the change )
  pending = job;
  requestAnimationFrame( pump );
  return job.changed;
}

/**
 * The areas of runs that differ between two nets ( as they were and as they are ).
**/
export function changedRuns( from: TrailNet, to: TrailNet ): Rect[] {
  const a           = new Map( place( from ).map( ( p ) => [p.strip.run, p] ) ), b = new Map( place( to ).map( ( p ) => [p.strip.run, p] ) );
  const same        = ( x: Float32Array, y: Float32Array ) => x === y || ( x.length === y.length && x.every( ( v, i ) => v === y[i] ) );
  const out: Rect[] = [];
  for ( const [id, p] of a ) {
    const q = b.get( id );
    if ( !q || q.detail !== p.detail || !same( p.strip.pts, q.strip.pts ) ) out.push( p.box );
  }
  for ( const [id, q] of b ) {
    const p = a.get( id );
    if ( !p || q.detail !== p.detail || !same( p.strip.pts, q.strip.pts ) ) out.push( q.box );
  }
  return out;
}

/**
 * Nothing left to bring up to date ( a different map: its ground is as it was saved ).
**/
export function dropPending() {
  pending = null;
}

/**
 * For tests: the ground being worked on, and the runs' ground kept between changes, forgotten.
**/
export function resetApplying() {
  pending     = null;
  rasters.job = null;
  rasters.last.clear();
  rasters.now.clear();
}
