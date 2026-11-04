// Shapes on the ground: each baked into patches added to the ground ( taken out again to change it ), edits kept as
// one undo step, the ground as it would be without one.

import { nextFrame, overBudget } from "../../../core/frameBudget";
import { history } from "../../../map/history";
import { terrain } from "../../terrain";
import { formationGridSteps } from "./formation";
import { shapeAt, shapeBounds } from "./height";
import type { Shape } from "./types";

// What one shape did to one chunk: per sample in [i0..i0+w)×[j0..j0+h), the height it added and the value it
// wrote ( to tell edits made on top afterwards apart from the shape itself ).
interface Patch {
  // chunk key ( indices change when the chunk list does )
  key:   string;
  i0:    number;
  j0:    number;
  w:     number;
  h:     number;
  delta: Float32Array;
  out:   Float32Array;
}

type Applied = Patch[];

// uid → what that shape currently contributes to the terrain.
const applied = new Map<string, Applied>();

function addDelta( patches: Applied, sign: 1 | -1 ) {
  const touched = new Set<number>();
  for ( const p of patches ) {
    const ci = terrain.indexOf( p.key );
    const c  = terrain.chunks[ci];
    if ( !c ) continue;
    const H = c.heights, res = c.res, top = c.size[1];
    for ( let j = 0; j < p.h; j++ )
      for ( let i = 0; i < p.w; i++ ) {
        const d = p.delta[j * p.w + i];
        if ( d === 0 ) continue;
        const idx = ( p.j0 + j ) * res + p.i0 + i;
        const v   = H[idx] + sign * d;
        H[idx]    = v < 0 ? 0 : v > top ? top : v;
      }
    terrain.markDirtyRect( ci, p.i0, p.j0, p.i0 + p.w - 1, p.j0 + p.h - 1 );
    touched.add( ci );
  }
  if ( touched.size ) terrain.syncEdges( [...touched] );
}

// Edits made on top of a shape since it was applied ( sculpting ): chunk key → sample index → extra height.
type Extras = Map<string, Map<number, number>>;

function extrasOf( patches: Applied | undefined ): Extras {
  const ex: Extras = new Map();
  for ( const p of patches ?? [] ) {
    const c = terrain.chunks[terrain.indexOf( p.key )];
    if ( !c ) continue;
    let m = ex.get( p.key );
    for ( let j = 0; j < p.h; j++ )
      for ( let i = 0; i < p.w; i++ ) {
        const k = j * p.w + i;
        if ( p.delta[k] === 0 ) continue;
        const idx   = ( p.j0 + j ) * c.res + p.i0 + i;
        const extra = c.heights[idx] - p.out[k];
        if ( Math.abs( extra ) < 1e-5 ) continue;
        if ( !m ) ex.set( p.key, ( m = new Map() ) );
        m.set( idx, extra );
      }
  }
  return ex;
}

// Sub-sample offsets ( × spacing ): curves and circles are averaged over 2×2 points per sample, so a sharp side lands
// between samples smoothly instead of stair-stepping along the grid.
const SUB: [number, number][] = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];

/**
 * Writes the shape into the terrain ( as it is now, minus `extras` which ride on top ) and returns what it changed.
 * `only`: chunk keys to write into ( the rest are left alone ).
**/
function bake( s: Shape, extras: Extras = new Map(), only?: Set<string> ): Applied {
  const g = bakeSteps( s, extras, only );
  let r   = g.next();
  while ( !r.done ) r = g.next();
  writePatches( r.value );
  return r.value;
}

/**
 * Its new heights written into the terrain ( where they change ), and the chunks told.
**/
function writePatches( patches: Applied ) {
  for ( const p of patches ) {
    const c = terrain.chunks[terrain.indexOf( p.key )], res = c.res;
    for ( let j = 0; j < p.h; j++ )
      for ( let i = 0, k = j * p.w; i < p.w; i++, k++ ) if ( p.delta[k] !== 0 ) c.heights[( p.j0 + j ) * res + p.i0 + i] = p.out[k];
  }
  for ( const p of patches ) terrain.markDirtyRect( terrain.indexOf( p.key ), p.i0, p.j0, p.i0 + p.w - 1, p.j0 + p.h - 1 );
  if ( patches.length ) terrain.syncEdges( [...new Set( patches.map( ( p ) => terrain.indexOf( p.key ) ) )] );
}

/**
 * What writing the shape would change, worked out a few rows at a time, nothing written. `old`: the shape's change
 * still in the terrain, the ground read as if it weren't ( it's taken out when this is written ).
**/
function* bakeSteps( s: Shape, extras: Extras = new Map(), only?: Set<string>, old?: Applied ): Generator<void, Applied, void> {
  const [minx, minz, maxx, maxz] = shapeBounds( s );
  const patches: Applied         = [];
  const olds                     = new Map( ( old ?? [] ).map( ( p ) => [p.key, p] ) );
  const without                  = old ? groundOff( olds ) : null;
  const ground                   = ( x: number, z: number ) => {
    const g = without ? without( x, z ) : terrain.heightAt( x, z );
    return Number.isNaN( g ) ? 0 : g;
  };
  // ( a formation's own grid first, a little at a time: then it's looked up between its points )
  if ( s.kind === "formation" && s.points.length >= 3 ) yield* formationGridSteps( s, ground );
  for ( let ci = 0; ci < terrain.chunks.length; ci++ ) {
    const c  = terrain.chunks[ci];
    const x0 = c.position[0], z0 = c.position[2], sp = c.spacing, res = c.res;
    if ( only && !only.has( c.key ) ) continue;
    if ( maxx < x0 || minx > x0 + c.size[0] || maxz < z0 || minz > z0 + c.size[2] ) continue;
    const i0 = Math.max( 0, Math.floor( ( minx - x0 ) / sp ) ), i1 = Math.min( res - 1, Math.ceil( ( maxx - x0 ) / sp ) );
    const j0 = Math.max( 0, Math.floor( ( minz - z0 ) / sp ) ), j1 = Math.min( res - 1, Math.ceil( ( maxz - z0 ) / sp ) );
    const w  = i1 - i0 + 1, h = j1 - j0 + 1;
    if ( w <= 0 || h <= 0 ) continue;
    const op = olds.get( c.key );
    const delta       = new Float32Array( w * h );
    const out         = new Float32Array( w * h );
    const ex          = extras.get( c.key );
    const base        = c.position[1], top = c.size[1];
    // ( copies are grid data already: exact, not averaged; a formation with a soft edge is smooth already, a grid of
    // its own looked up between its points )
    const supersample = s.kind !== "stamp" && !( s.kind === "formation" && s.edgeBlend >= 2 * sp );
    for ( let j = j0; j <= j1; j++ ) {
      if ( ( j - j0 ) % 16 === 15 ) yield;
      for ( let i = i0; i <= i1; i++ ) {
        const x     = x0 + i * sp, z = z0 + j * sp;
        const idx   = j * res + i;
        const pi    = op ? i - op.i0 : -1, pj = op ? j - op.j0 : -1;
        const cur   = c.heights[idx] - ( op && pi >= 0 && pj >= 0 && pi < op.w && pj < op.h ? op.delta[pj * op.w + pi] : 0 );
        const extra = ex?.get( idx ) ?? 0;
        const under = cur - extra; // the ground the shape sits on
        let lift    = 0, any = false;
        if ( supersample ) {
          // the height is the shape's exact height here; only how much of the sample it covers ( the blend ) is
          // averaged over the sub-samples — interiors, lips and peaks stay exact, edges stop stair-stepping
          const r0  = shapeAt( s, x, z, ground );
          let cover = 0, hSum = 0, hN = 0;
          for ( const [ox, oz] of SUB ) {
            const r = shapeAt( s, x + ox * sp, z + oz * sp, ground );
            if ( r && r.blend > 0 ) {
              cover += r.blend;
              hSum  += r.h;
              hN++;
            }
          }
          cover /= SUB.length;
          if ( r0 && r0.blend > 0 && hN === SUB.length ) cover = Math.max( cover, r0.blend );
          if ( cover > 0 ) {
            const hh = r0 ? r0.h : hSum / hN;
            lift     = ( hh - base - under ) * cover;
            any      = true;
          }
        } else {
          const r = shapeAt( s, x, z, ground );
          if ( r && r.blend > 0 ) {
            lift = ( r.h - base - under ) * r.blend;
            any  = true;
          }
        }
        if ( !any ) continue;
        let target                         = under + lift + extra;
        target                             = target < 0 ? 0 : target > top ? top : target;
        delta[( j - j0 ) * w + ( i - i0 )] = target - cur;
        out[( j - j0 ) * w + ( i - i0 )]   = target;
      }
    }
    patches.push( { key: c.key, i0, j0, w, h, delta, out } );
  }
  return patches;
}

// A live edit's change worked out a frame's share at a time ( a big formation took a tenth of a second a change, the
// view stopped while it did ): the newest change waits while one is under way, each written in one go once it's ready.
let job: { uid: string; before: Applied | undefined; steps: Generator<void, Applied, void> } | null = null;
let waiting: Shape | null = null;
let pumping                = false;
const settled: ( () => void )[] = [];

/**
 * previewShape, a frame's share at a time ( the terrain follows a frame or few behind ).
**/
export function previewShapeSoon( s: Shape ) {
  if ( typeof requestAnimationFrame !== "function" ) return previewShape( s );
  if ( job && job.uid !== s.uid ) settleShapes();
  waiting = s;
  if ( !pumping ) void pump();
}

async function pump() {
  pumping = true;
  try {
    while ( job || waiting ) {
      while ( ( job || waiting ) && !overBudget() ) stepJob();
      if ( job || waiting ) await nextFrame();
    }
  } finally {
    pumping = false;
  }
  for ( const f of settled.splice( 0 ) ) f();
}

function stepJob() {
  if ( !job ) {
    const s    = waiting!, before = applied.get( s.uid );
    waiting    = null;
    job        = { uid: s.uid, before, steps: bakeSteps( s, extrasOf( before ), undefined, before ) };
  }
  const r = job.steps.next();
  if ( !r.done ) return;
  const j = job;
  job     = null;
  if ( j.before ) addDelta( j.before, -1 );
  writePatches( r.value );
  applied.set( j.uid, r.value );
}

/**
 * The live edits still being worked out, finished now ( before anything reads or changes what the shapes did ).
**/
export function settleShapes() {
  while ( job || waiting ) stepJob();
  for ( const f of settled.splice( 0 ) ) f();
}

/**
 * `f` once the live edits are in the terrain ( now, if they are ).
**/
export function whenShapesSettled( f: () => void ) {
  if ( !job && !waiting ) return f();
  settled.push( f );
}

/**
 * Replaces what shape `uid` contributes: its old change comes out, `next` ( if any ) goes in.
**/
function swap( uidKey: string, next: Shape | null ): { before: Applied | undefined; after: Applied | undefined } {
  settleShapes();
  const before = applied.get( uidKey );
  const extras = extrasOf( before ); // sculpting done on top since; carried over to the new shape
  if ( before ) addDelta( before, -1 );
  const after = next ? bake( next, extras ) : undefined;
  if ( after ) applied.set( uidKey, after );
  else applied.delete( uidKey );
  return { before, after };
}

/**
 * Puts a contribution back exactly ( undo/redo ).
**/
function restore( uidKey: string, from: Applied | undefined, to: Applied | undefined ) {
  settleShapes();
  if ( from ) addDelta( from, -1 );
  if ( to ) {
    addDelta( to, 1 );
    applied.set( uidKey, to );
  } else applied.delete( uidKey );
}

/**
 * Live update while a shape is being edited ( dragging a handle, a slider ): applies immediately without an undo
 * step. `commitShape` records the whole edit as one step afterwards.
**/
export function previewShape( s: Shape ) {
  swap( s.uid, s );
}

export interface ShapeEdit {
  uid:   string;
  // the contribution before the edit began
  start: Applied | undefined;
}

/**
 * Starts an edit session: remembers the shape's current contribution for undo.
**/
export function beginShapeEdit( uidKey: string ): ShapeEdit {
  settleShapes();
  return { uid: uidKey, start: applied.get( uidKey ) };
}

/**
 * Records an edit ( create / change / delete ) as one undo step; `apply` swaps the shape lists in the document.
**/
export function commitShapeEdit( edit: ShapeEdit, label: string, setShapes: { undo: () => void; redo: () => void } ) {
  settleShapes();
  const end = applied.get( edit.uid );
  if ( end === edit.start ) return;
  const size = ( a: Applied | undefined ) => ( a ?? [] ).reduce( ( n, p ) => n + p.delta.byteLength + p.out.byteLength, 0 );
  history.push( {
    label,
    bytes: size( end ) + size( edit.start ),
    undo: () => {
      restore( edit.uid, end, edit.start );
      setShapes.undo();
    },
    redo: () => {
      restore( edit.uid, edit.start, end );
      setShapes.redo();
    },
  } );
}

/**
 * Takes a shape out of the terrain ( part of a delete edit ).
**/
export function removeShape( uidKey: string ) {
  swap( uidKey, null );
}

/**
 * Forget all contributions ( a different project was opened: its shapes are already baked into its heights ).
**/
export function resetShapes() {
  job     = null;
  waiting = null;
  applied.clear();
}

/**
 * The ground ( Unity XZ → absolute height, NaN off the terrain ) as it would be without shape `uid`'s change.
**/
export function groundWithout( uidKey: string ): ( x: number, z: number ) => number {
  // ( a live edit still being worked out isn't waited for: the terrain and what the shape did are written together )
  return groundOff( new Map( ( applied.get( uidKey ) ?? [] ).map( ( p ) => [p.key, p] ) ) );
}

/**
 * The ground with `patches` ( a shape's change, by chunk key ) taken off.
**/
function groundOff( patches: Map<string, Patch> ): ( x: number, z: number ) => number {
  return ( x, z ) => {
    const ci = terrain.chunkAt( x, z );
    if ( ci < 0 ) return NaN;
    const c = terrain.chunks[ci];
    const p = patches.get( c.key );
    if ( !p ) return terrain.heightAt( x, z );
    const [fx, fz] = c.toSample( x, z );
    const i        = Math.min( c.res - 2, Math.max( 0, Math.floor( fx ) ) ), j = Math.min( c.res - 2, Math.max( 0, Math.floor( fz ) ) );
    const tx       = fx - i, tz = fz - j;
    const at       = ( ii: number, jj: number ) => {
      const pi = ii - p.i0, pj = jj - p.j0;
      return c.heights[jj * c.res + ii] - ( pi >= 0 && pj >= 0 && pi < p.w && pj < p.h ? p.delta[pj * p.w + pi] : 0 );
    };
    const a = at( i, j ), b = at( i + 1, j ), cc = at( i, j + 1 ), d = at( i + 1, j + 1 );
    return c.position[1] + ( a + ( b - a ) * tx ) * ( 1 - tz ) + ( cc + ( d - cc ) * tx ) * tz;
  };
}
