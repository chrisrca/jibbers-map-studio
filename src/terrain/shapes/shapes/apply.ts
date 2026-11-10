// Shapes on the ground: each baked into patches added to the ground ( taken out again to change it ), a formation's
// rock painted into the snow mask the same way, edits kept as one undo step, the ground as it would be without one.
//
// Built on one another, in layers: the trails the ground's base ( trails/ground ), formations on them, ski lines on
// those, the rest on top. A change in a layer goes under the shapes above it ( not taken for sculpting done on them ),
// and the formations and ski lines there are made again on the new ground, a ski line's points moved with it. In the
// snow mask, a formation's rock goes over the markings ( a ski line's stripes, a real map's runs ).

import { nextFrame, overBudget } from "../../../core/frameBudget";
import { history } from "../../../map/history";
import { terrain } from "../../terrain";
import { formationGridSteps, formationRockAt, rushFormations, rushing, type FormationGrid } from "./formation";
import { evalCurve, evalRepeated } from "../../../core/curve";
import { shapeAt, shapeBounds, strokeAt } from "./height";
import { MARKING_VALUES, rampStripes, skiLineStripes } from "./skiline";
import type { CurveShape, Shape, SkiLineNode, SkiLineShape } from "./types";

// What one shape did to one chunk: per sample in [i0..i0+w)×[j0..j0+h), the height it added and its surface ( the
// height there with nothing on top of it: to tell edits made on top afterwards apart from the shape itself, and kept
// up with changes beneath it ); a formation's rock, the snow mask's pixels it shows on and how much ( and once
// written, their snow before and after ).
interface Patch {
  // chunk key ( indices change when the chunk list does )
  key:   string;
  i0:    number;
  j0:    number;
  w:     number;
  h:     number;
  delta: Float32Array;
  out:   Float32Array;
  rock?: RockPatch;
  paint?: PaintPatch;
}

// A paint stroke's pixels of a chunk's mask, how much it paints each, what it paints ( and once written, the pixels'
// RGBA before and after ).
interface PaintPatch {
  idx:   Uint32Array;
  cov:   Float32Array;
  rect:  [number, number, number, number];
  // ( `most`: a ski line's stripe, its coverage the most of what's there and what it paints, as Map-Tools paints them )
  op:    { target: "snow" | "marking" | "powder"; erase: boolean; hue: number; depth: number; most?: boolean };
  was?:  Uint8Array;
  now?:  Uint8Array;
}

interface RockPatch {
  idx:  Uint32Array;
  cov:  Float32Array;
  rect: [number, number, number, number];
  was?: Uint8Array;
  now?: Uint8Array;
}

// The chunks' paint layers rock goes into ( paint/ground hands them over: the shapes don't load the editor ).
export interface RockLayers {
  // ( `four`: it has markings and powder )
  layerOf( key: string ): { m: number; rgba: Uint8Array; four?: boolean } | null;
  // ( markings and powder: the layer made 4-channel first )
  four( key: string ): void;
  ensure( key: string ): Promise<unknown>;
  changed( key: string, rect: [number, number, number, number] ): void;
}

let paint: RockLayers | null = null;

export const setRockLayers = ( p: RockLayers ) => {
  paint = p;
};

// The shapes' list, from the editor ( set by terrain/shapes/edits.ts: the shapes don't load the editor ), and a shape
// built on ground that's changed under it made again there ( put in the list as it's given: a ski line's points
// moved with the ground; no undo step of its own ).
export interface ShapeDoc {
  list(): Shape[];
  follow( s: Shape ): void;
}

let doc: ShapeDoc | null = null;

export const setShapeDoc = ( d: ShapeDoc ) => {
  doc = d;
};

/**
 * A shape's layer: what it's built on is lower ( the trails 0 ).
**/
export const layerOf = ( s: Shape | undefined ) => ( s?.kind === "formation" ? 1 : s?.kind === "skiline" ? 2 : 3 );

/**
 * A patch's rock taken out of the snow mask ( where it's still as the formation left it ), or put back.
**/
function rockDelta( p: Patch, sign: 1 | -1 ) {
  const r = p.rock, L = r?.now && paint?.layerOf( p.key );
  if ( !r || !L || !r.was || !r.now ) return;
  for ( let n = 0; n < r.idx.length; n++ ) {
    const o = r.idx[n] * 4;
    if ( sign > 0 ) L.rgba[o] = r.now[n];
    else if ( L.rgba[o] === r.now[n] ) L.rgba[o] = r.was[n];
  }
  paint!.changed( p.key, r.rect );
}

/**
 * A paint stroke's patch taken out ( where the mask's as it left it ) or put back.
**/
function paintDelta( p: Patch, sign: 1 | -1 ) {
  const r = p.paint, L = r?.now && paint?.layerOf( p.key );
  if ( !r || !L || !r.was || !r.now ) return;
  for ( let n = 0; n < r.idx.length; n++ ) {
    const o = r.idx[n] * 4, k = n * 4;
    if ( sign > 0 ) L.rgba.set( r.now.subarray( k, k + 4 ), o );
    else if ( L.rgba[o] === r.now[k] && L.rgba[o + 1] === r.now[k + 1] && L.rgba[o + 2] === r.now[k + 2] && L.rgba[o + 3] === r.now[k + 3] ) L.rgba.set( r.was.subarray( k, k + 4 ), o );
  }
  paint!.changed( p.key, r.rect );
}

/**
 * A paint stroke's patch painted ( BetterTerrainEditor.BuildPaint ): snow towards full ( or rock ), a marking's hue
 * and coverage, or powder towards its depth, by how much it paints each pixel.
**/
function writePaint( p: Patch ) {
  const r = p.paint;
  if ( !r || !paint ) return;
  if ( r.op.target !== "snow" ) paint.four( p.key );
  const L = paint.layerOf( p.key );
  if ( !L ) return;
  r.was = new Uint8Array( r.idx.length * 4 );
  r.now = new Uint8Array( r.idx.length * 4 );
  const lerp = ( a: number, b: number, t: number ) => Math.round( a + ( b - a ) * t );
  // ( a ski line's stripes kept off a formation's rock )
  const rock = r.op.most ? rockUnder( p.key ) : null;
  for ( let n = 0; n < r.idx.length; n++ ) {
    const o = r.idx[n] * 4, k = n * 4, c = r.cov[n];
    r.was.set( L.rgba.subarray( o, o + 4 ), k );
    if ( r.op.target === "snow" ) L.rgba[o] = lerp( L.rgba[o], r.op.erase ? 0 : 255, c );
    else if ( r.op.target === "powder" ) L.rgba[o + 3] = lerp( L.rgba[o + 3], r.op.erase ? 0 : r.op.depth * 255, c );
    else if ( r.op.erase ) L.rgba[o + 2] = lerp( L.rgba[o + 2], 0, c );
    else if ( r.op.most ) {
      const v = Math.round( c * ( 1 - Math.min( 1, rock?.get( r.idx[n] ) ?? 0 ) ) * 255 );
      if ( v > 0 ) {
        L.rgba[o + 1] = Math.round( r.op.hue * 255 );
        L.rgba[o + 2] = Math.max( L.rgba[o + 2], v );
      }
    }
    else {
      L.rgba[o + 1] = Math.round( r.op.hue * 255 );
      L.rgba[o + 2] = lerp( L.rgba[o + 2], 255, c );
    }
    r.now.set( L.rgba.subarray( o, o + 4 ), k );
  }
  paint.changed( p.key, r.rect );
}

/**
 * The formations' rock in chunk `key`'s snow mask: each pixel it shows on, the most it does.
**/
function rockUnder( key: string ): Map<number, number> {
  const out = new Map<number, number>();
  for ( const ps of applied.values() )
    for ( const p of ps ) {
      const r = p.rock;
      if ( p.key !== key || !r ) continue;
      for ( let n = 0; n < r.idx.length; n++ ) out.set( r.idx[n], Math.max( out.get( r.idx[n] ) ?? 0, r.cov[n] ) );
    }
  return out;
}

/**
 * A patch's rock painted: the snow there now, faded to bare rock as far as it shows ( FormationBuilder.PaintRock ).
**/
function writeRock( p: Patch ) {
  const r = p.rock, L = r && paint?.layerOf( p.key );
  if ( !r || !L ) return;
  r.was = new Uint8Array( r.idx.length );
  r.now = new Uint8Array( r.idx.length );
  for ( let n = 0; n < r.idx.length; n++ ) {
    const o   = r.idx[n] * 4, b = L.rgba[o];
    r.was[n]  = b;
    r.now[n]  = Math.round( b * ( 1 - Math.min( 1, r.cov[n] ) ) );
    L.rgba[o] = r.now[n];
  }
  paint!.changed( p.key, r.rect );
}

type Applied = Patch[];

// uid → what that shape currently contributes to the terrain, and how many times that's changed ( saved again when
// it has ).
const applied = new Map<string, Applied>();
const changes = new Map<string, number>();

function setApplied( uidKey: string, a: Applied | undefined ) {
  if ( a ) applied.set( uidKey, a );
  else applied.delete( uidKey );
  changes.set( uidKey, ( changes.get( uidKey ) ?? 0 ) + 1 );
}

/**
 * The shapes with a change in the ground, and each one's count of changes ( saving: those changed since are written ).
**/
export function shapeChanges(): [string, number][] {
  return [...applied.keys()].map( ( u ) => [u, changes.get( u ) ?? 0] );
}

// ( a shape's change as bytes: "JSP1", its patches — chunk key, rectangle, what it added and wrote, its rock )
const MAGIC = 0x3150534a;

/**
 * What shape `uidKey` contributes, as bytes for the project's shapes/ folder ( null: nothing ).
**/
export function packShape( uidKey: string ): Uint8Array | null {
  const a = applied.get( uidKey );
  if ( !a ) return null;
  const enc  = new TextEncoder();
  const keys = a.map( ( p ) => enc.encode( p.key ) );
  let size   = 8;
  a.forEach( ( p, k ) => {
    size += 4 + keys[k].length + 16 + p.delta.byteLength + p.out.byteLength + 4;
    const r = p.rock;
    if ( r?.was && r.now ) size += 16 + r.idx.length * ( 4 + 4 + 2 );
    const q = p.paint;
    size   += 4;
    if ( q?.was && q.now ) size += 16 + 16 + q.idx.length * ( 4 + 4 + 8 );
  } );
  size        = ( size + 3 ) & ~3;
  const buf   = new ArrayBuffer( size + 64 ), dv = new DataView( buf ), b = new Uint8Array( buf );
  let o       = 0;
  const u32   = ( v: number ) => { dv.setUint32( o, v, true ); o += 4; };
  const f32s  = ( v: Float32Array ) => { for ( const x of v ) { dv.setFloat32( o, x, true ); o += 4; } };
  u32( MAGIC );
  u32( a.length );
  a.forEach( ( p, k ) => {
    u32( keys[k].length );
    b.set( keys[k], o );
    o += keys[k].length;
    [p.i0, p.j0, p.w, p.h].forEach( u32 );
    f32s( p.delta );
    f32s( p.out );
    const r = p.rock;
    if ( r?.was && r.now ) {
      u32( r.idx.length );
      r.rect.forEach( ( v ) => u32( v ) );
      r.idx.forEach( ( v ) => u32( v ) );
      f32s( r.cov );
      b.set( r.was, o );
      o += r.was.length;
      b.set( r.now, o );
      o += r.now.length;
    } else u32( 0 );
    const q = p.paint;
    if ( q?.was && q.now ) {
      u32( q.idx.length );
      q.rect.forEach( ( v ) => u32( v ) );
      u32( ["snow", "marking", "powder"].indexOf( q.op.target ) );
      u32( q.op.most ? 2 : q.op.erase ? 1 : 0 );
      dv.setFloat32( o, q.op.hue, true );
      o += 4;
      dv.setFloat32( o, q.op.depth, true );
      o += 4;
      q.idx.forEach( ( v ) => u32( v ) );
      f32s( q.cov );
      b.set( q.was, o );
      o += q.was.length;
      b.set( q.now, o );
      o += q.now.length;
    } else u32( 0 );
  } );
  return b.slice( 0, o );
}

/**
 * A shape's change read back ( a project opened ): its later edits take it out before putting the new one in.
**/
export function unpackShape( uidKey: string, bytes: ArrayBuffer ) {
  const dv = new DataView( bytes ), b = new Uint8Array( bytes );
  let o    = 0;
  const u32  = () => { const v = dv.getUint32( o, true ); o += 4; return v; };
  const f32s = ( n: number ) => { const v = new Float32Array( n ); for ( let k = 0; k < n; k++ ) { v[k] = dv.getFloat32( o, true ); o += 4; } return v; };
  if ( bytes.byteLength < 8 || u32() !== MAGIC ) return;
  const n    = u32(), out: Applied = [];
  for ( let k = 0; k < n; k++ ) {
    const kl  = u32(), key = new TextDecoder().decode( b.subarray( o, o + kl ) );
    o        += kl;
    const [i0, j0, w, h] = [u32(), u32(), u32(), u32()];
    const delta = f32s( w * h ), written = f32s( w * h );
    const rn    = u32();
    let rock: RockPatch | undefined;
    if ( rn ) {
      const rect = [u32(), u32(), u32(), u32()] as [number, number, number, number];
      const idx  = new Uint32Array( rn );
      for ( let q = 0; q < rn; q++ ) idx[q] = u32();
      const cov  = f32s( rn );
      const was  = b.slice( o, o + rn );
      o         += rn;
      const now  = b.slice( o, o + rn );
      o         += rn;
      rock       = { idx, cov, rect, was, now };
    }
    // ( a paint stroke's, when the file has it )
    let painted: PaintPatch | undefined;
    const pn = o + 4 <= bytes.byteLength ? u32() : 0;
    if ( pn ) {
      const rect   = [u32(), u32(), u32(), u32()] as [number, number, number, number];
      const target = ( ["snow", "marking", "powder"] as const )[u32()] ?? "snow";
      const how    = u32(), erase = how === 1, most = how === 2;
      const hue    = dv.getFloat32( o, true ), depth = dv.getFloat32( o + 4, true );
      o           += 8;
      const idx    = new Uint32Array( pn );
      for ( let q = 0; q < pn; q++ ) idx[q] = u32();
      const cov    = f32s( pn );
      const was    = b.slice( o, o + pn * 4 );
      o           += pn * 4;
      const now    = b.slice( o, o + pn * 4 );
      o           += pn * 4;
      painted      = { idx, cov, rect, op: { target, erase, hue, depth, ...( most ? { most } : {} ) }, was, now };
    }
    // ( a chunk that's gone since: left out )
    if ( terrain.indexOf( key ) >= 0 ) out.push( { key, i0, j0, w, h, delta, out: written, rock, paint: painted } );
  }
  if ( out.length ) applied.set( uidKey, out );
}

/**
 * A shape's change in a chunk taken as made already, the heights left as they are ( a shape that came worked into the
 * ground: terrain/shapes/unbake.ts ): added to what it's changed so far.
**/
export function adoptShape( uidKey: string, p: { key: string; i0: number; j0: number; w: number; h: number; delta: Float32Array } ) {
  const c = terrain.chunks[terrain.indexOf( p.key )];
  if ( !c ) return;
  const out = new Float32Array( p.w * p.h );
  for ( let j = 0; j < p.h; j++ ) for ( let i = 0; i < p.w; i++ ) out[j * p.w + i] = c.heights[( p.j0 + j ) * c.res + p.i0 + i];
  setApplied( uidKey, [...( applied.get( uidKey ) ?? [] ), { ...p, out }] );
}

/**
 * What a shape's patches wrote taken as the heights there now ( after its change was taken as made, the rest of it
 * added: nothing there to read as sculpted on top ).
**/
export function settleShape( uidKey: string ) {
  for ( const p of applied.get( uidKey ) ?? [] ) {
    const c = terrain.chunks[terrain.indexOf( p.key )];
    if ( !c ) continue;
    for ( let j = 0; j < p.h; j++ ) for ( let i = 0; i < p.w; i++ ) if ( p.delta[j * p.w + i] !== 0 ) p.out[j * p.w + i] = c.heights[( p.j0 + j ) * c.res + p.i0 + i];
  }
}

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
    // ( taken out the other way round from how it's written: a formation's markings cleared after its rock )
    if ( sign > 0 ) { rockDelta( p, 1 ); paintDelta( p, 1 ); }
    else { paintDelta( p, -1 ); rockDelta( p, -1 ); }
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
function bake( s: Shape, extras: Extras = new Map(), only?: Set<string>, full = false ): Applied {
  const g = bakeSteps( s, extras, only, undefined, full );
  let r   = g.next();
  while ( !r.done ) r = g.next();
  writePatches( r.value );
  return r.value;
}

/**
 * Its change added to the terrain ( where it changes anything ), and the chunks told.
**/
function writePatches( patches: Applied ) {
  for ( const p of patches ) {
    const c = terrain.chunks[terrain.indexOf( p.key )], res = c.res, top = c.size[1];
    for ( let j = 0; j < p.h; j++ )
      for ( let i = 0, k = j * p.w; i < p.w; i++, k++ ) {
        if ( p.delta[k] === 0 ) continue;
        const idx = ( p.j0 + j ) * res + p.i0 + i, v = c.heights[idx] + p.delta[k];
        c.heights[idx] = v < 0 ? 0 : v > top ? top : v;
      }
  }
  for ( const p of patches ) {
    terrain.markDirtyRect( terrain.indexOf( p.key ), p.i0, p.j0, p.i0 + p.w - 1, p.j0 + p.h - 1 );
    writeRock( p );
    writePaint( p );
  }
  if ( patches.length ) terrain.syncEdges( [...new Set( patches.map( ( p ) => terrain.indexOf( p.key ) ) )] );
}

/**
 * What writing the shape would change, worked out a few rows at a time, nothing written. `old`: the shape's change
 * still in the terrain, the ground read as if it weren't ( it's taken out when this is written ). `full`: a formation
 * worked out in full ( its erosion, the snow softened ).
**/
function* bakeSteps( s: Shape, extras: Extras = new Map(), only?: Set<string>, old?: Applied, full = false ): Generator<void, Applied, void> {
  // ( a formation switched off: nothing; a paint stroke: the mask's pixels it paints, its layers loaded first )
  if ( ( s.kind === "formation" || s.kind === "skiline" ) && s.enabled === false ) return [];
  if ( s.kind === "paint" ) return yield* paintSteps( s );
  const [minx, minz, maxx, maxz] = shapeBounds( s );
  const patches: Applied         = [];
  const olds                     = byChunk( old ?? [] );
  // ( the ground beneath it: without its own change, nor what's on top of it )
  const without                  = old || extras.size ? groundOff( olds, extras ) : null;
  const ground                   = ( x: number, z: number ) => {
    const g = without ? without( x, z ) : terrain.heightAt( x, z );
    return Number.isNaN( g ) ? 0 : g;
  };
  // ( a formation's own grid first, a little at a time: then it's looked up between its points; the paint layers its
  // rock goes into loaded meanwhile )
  let fg: FormationGrid | null = null;
  if ( s.kind === "formation" && s.points.length >= 3 ) {
    const rocky = s.snow.on && s.snow.rock > 0 && !!paint;
    const wait  = rocky ? Promise.all( terrain.chunks.filter( ( c ) => overlaps( c, minx, minz, maxx, maxz ) ).map( ( c ) => paint!.ensure( c.key ) ) ) : null;
    let loaded  = !wait;
    void wait?.then( () => ( loaded = true ), () => ( loaded = true ) );
    fg          = yield* formationGridSteps( s, ground, full );
    while ( !loaded && !rushing() ) yield;
    if ( !rocky ) fg = null;
  }
  // ( a ski line's stripes: the snow mask's layers they go into loaded meanwhile )
  const striped = !!paint && ( s.kind === "skiline" ? s.features.some( ( f ) => f.enabled && f.stripes.length ) : s.kind === "curve" && !!s.stripes?.length );
  if ( striped ) {
    let loaded = false;
    void Promise.all( terrain.chunks.filter( ( c ) => overlaps( c, minx, minz, maxx, maxz ) ).map( ( c ) => paint!.ensure( c.key ) ) ).then( () => ( loaded = true ), () => ( loaded = true ) );
    while ( !loaded && !rushing() ) yield;
  }
  for ( let ci = 0; ci < terrain.chunks.length; ci++ ) {
    const c  = terrain.chunks[ci];
    const x0 = c.position[0], z0 = c.position[2], sp = c.spacing, res = c.res;
    if ( only && !only.has( c.key ) ) continue;
    if ( maxx < x0 || minx > x0 + c.size[0] || maxz < z0 || minz > z0 + c.size[2] ) continue;
    const i0 = Math.max( 0, Math.floor( ( minx - x0 ) / sp ) ), i1 = Math.min( res - 1, Math.ceil( ( maxx - x0 ) / sp ) );
    const j0 = Math.max( 0, Math.floor( ( minz - z0 ) / sp ) ), j1 = Math.min( res - 1, Math.ceil( ( maxz - z0 ) / sp ) );
    const w  = i1 - i0 + 1, h = j1 - j0 + 1;
    if ( w <= 0 || h <= 0 ) continue;
    const op = olds.get( c.key ) ?? [];
    const delta       = new Float32Array( w * h );
    const out         = new Float32Array( w * h );
    const ex          = extras.get( c.key );
    const base        = c.position[1], top = c.size[1];
    // ( copies are grid data already: exact, not averaged; a formation is worked out on the ground's own samples )
    // ( and a ski line, as Map-Tools carves it, a sample at a time )
    const supersample = s.kind !== "stamp" && s.kind !== "formation" && s.kind !== "skiline";
    for ( let j = j0; j <= j1; j++ ) {
      if ( ( j - j0 ) % 16 === 15 ) yield;
      for ( let i = i0; i <= i1; i++ ) {
        const x     = x0 + i * sp, z = z0 + j * sp;
        const idx   = j * res + i;
        const cur   = c.heights[idx] - deltaAt( op, i, j );
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
        out[( j - j0 ) * w + ( i - i0 )]   = target - extra;
      }
    }
    const rock = fg ? rockPatch( c, fg, minx, minz, maxx, maxz ) : undefined;
    patches.push( { key: c.key, i0, j0, w, h, delta, out, rock, paint: rock && clearsMarkings( c.key, rock ) } );
    if ( striped && ( s.kind === "skiline" || s.kind === "curve" ) ) patches.push( ...stripePatches( s, c ) );
  }
  return patches;
}

/**
 * A paint stroke's patches: each chunk's mask pixels it covers, and how much it paints each.
**/
function* paintSteps( s: Extract<Shape, { kind: "paint" }> ): Generator<void, Applied, void> {
  const [minx, minz, maxx, maxz] = shapeBounds( s );
  const chunks                   = terrain.chunks.filter( ( c ) => overlaps( c, minx, minz, maxx, maxz ) );
  if ( !paint ) return [];
  let loaded = false;
  void Promise.all( chunks.map( ( c ) => paint!.ensure( c.key ) ) ).then( () => ( loaded = true ), () => ( loaded = true ) );
  while ( !loaded && !rushing() ) yield;
  const out: Applied = [];
  const hue          = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8][Math.max( 0, Math.min( 15, Math.round( s.colour ) ) )];
  for ( const c of chunks ) {
    const L = paint.layerOf( c.key );
    if ( !L ) continue;
    const m  = L.m, px = c.size[0] / m;
    const i0 = Math.max( 0, Math.floor( ( minx - c.position[0] ) / px ) ), i1 = Math.min( m - 1, Math.ceil( ( maxx - c.position[0] ) / px ) );
    const j0 = Math.max( 0, Math.floor( ( minz - c.position[2] ) / px ) ), j1 = Math.min( m - 1, Math.ceil( ( maxz - c.position[2] ) / px ) );
    const idx: number[] = [], cov: number[] = [];
    let x0 = m, y0 = m, x1 = -1, y1 = -1;
    for ( let j = j0; j <= j1; j++ ) {
      if ( ( j - j0 ) % 64 === 63 ) yield;
      for ( let i = i0; i <= i1; i++ ) {
        const at = strokeAt( s, c.position[0] + ( i + 0.5 ) * px, c.position[2] + ( j + 0.5 ) * px );
        if ( !at ) continue;
        const v = Math.min( 1, Math.max( 0, evalRepeated( s.along, at.t, s.repeats, s.repeatScaling ) * evalCurve( s.cross, at.ct ) * s.coverage ) );
        if ( v <= 0 ) continue;
        idx.push( j * m + i );
        cov.push( v );
        x0 = Math.min( x0, i );
        y0 = Math.min( y0, j );
        x1 = Math.max( x1, i );
        y1 = Math.max( y1, j );
      }
    }
    if ( !idx.length ) continue;
    out.push( {
      key: c.key, i0: 0, j0: 0, w: 0, h: 0, delta: new Float32Array( 0 ), out: new Float32Array( 0 ),
      paint: { idx: Uint32Array.from( idx ), cov: Float32Array.from( cov ), rect: [x0, y0, x1, y1], op: { target: s.target, erase: s.erase, hue, depth: s.depth } },
    } );
  }
  return out;
}

/**
 * A ski line that came with its stripes painted in ( a Unity scene's ): its chunks' snow masks loaded, and the marking
 * under its stripes taken out, so laying it paints them as they were and moving it takes them with it
 * ( terrain/shapes/unbake.ts ).
**/
export async function clearStripesUnder( s: SkiLineShape ) {
  if ( !paint || !s.features.some( ( f ) => f.enabled && f.stripes.length ) ) return;
  const [minx, minz, maxx, maxz] = shapeBounds( s );
  const chunks                   = terrain.chunks.filter( ( c ) => overlaps( c, minx, minz, maxx, maxz ) );
  await Promise.all( chunks.map( ( c ) => paint!.ensure( c.key ) ) );
  for ( const c of chunks ) {
    paint.four( c.key );
    const L = paint.layerOf( c.key );
    if ( !L ) continue;
    let x0 = L.m, y0 = L.m, x1 = -1, y1 = -1;
    for ( const k of skiLineStripes( s, c.position[0], c.position[2], c.size[0], L.m ).keys() ) {
      L.rgba[k * 4 + 2] = 0;
      const i = k % L.m, j = ( k - i ) / L.m;
      x0 = Math.min( x0, i ); y0 = Math.min( y0, j ); x1 = Math.max( x1, i ); y1 = Math.max( y1, j );
    }
    if ( x1 >= 0 ) paint.changed( c.key, [x0, y0, x1, y1] );
  }
}

/**
 * A ski line's stripes ( or a ramp's ) on chunk `c`'s snow mask: a patch a colour, each pixel in the one whose colour
 * it ends up ( the last stripe to reach it ), at the most coverage any paints it.
**/
function stripePatches( s: SkiLineShape | CurveShape, c: { key: string; position: number[]; size: number[] } ): Applied {
  const L = paint?.layerOf( c.key );
  if ( !L ) return [];
  const got = s.kind === "skiline" ? skiLineStripes( s, c.position[0], c.position[2], c.size[0], L.m ) : rampStripes( s, c.position[0], c.position[2], c.size[0], L.m );
  const by  = new Map<number, { idx: number[]; cov: number[] }>();
  for ( const [k, v] of got ) {
    const g = by.get( v.colour ) ?? by.set( v.colour, { idx: [], cov: [] } ).get( v.colour )!;
    g.idx.push( k );
    g.cov.push( v.cov );
  }
  return [...by].map( ( [colour, g] ) => {
    let x0 = L.m, y0 = L.m, x1 = -1, y1 = -1;
    for ( const k of g.idx ) { const i = k % L.m, j = ( k - i ) / L.m; x0 = Math.min( x0, i ); y0 = Math.min( y0, j ); x1 = Math.max( x1, i ); y1 = Math.max( y1, j ); }
    return {
      key: c.key, i0: 0, j0: 0, w: 0, h: 0, delta: new Float32Array( 0 ), out: new Float32Array( 0 ),
      paint: { idx: Uint32Array.from( g.idx ), cov: Float32Array.from( g.cov ), rect: [x0, y0, x1, y1] as [number, number, number, number], op: { target: "marking" as const, erase: false, hue: MARKING_VALUES[colour], depth: 0, most: true } },
    };
  } );
}

/**
 * A formation's rock over the markings ( a real map's runs, a ski line's stripes ): taken out under it as far as it
 * shows, where the chunk has any.
**/
function clearsMarkings( key: string, r: RockPatch ): PaintPatch | undefined {
  if ( !paint?.layerOf( key )?.four ) return undefined;
  return { idx: r.idx, cov: r.cov, rect: r.rect, op: { target: "marking", erase: true, hue: 0, depth: 0 } };
}

const overlaps = ( c: { position: number[]; size: number[] }, minx: number, minz: number, maxx: number, maxz: number ) =>
  !( maxx < c.position[0] || minx > c.position[0] + c.size[0] || maxz < c.position[2] || minz > c.position[2] + c.size[2] );

/**
 * The snow mask's pixels of chunk `c` a formation's rock shows on, and how much ( its grid looked up at each pixel's
 * middle ).
**/
function rockPatch( c: { key: string; position: number[]; size: number[] }, g: FormationGrid, minx: number, minz: number, maxx: number, maxz: number ): RockPatch | undefined {
  const L = paint?.layerOf( c.key );
  if ( !L ) return undefined;
  const m              = L.m, px = c.size[0] / m;
  const i0             = Math.max( 0, Math.floor( ( minx - c.position[0] ) / px ) ), i1 = Math.min( m - 1, Math.ceil( ( maxx - c.position[0] ) / px ) );
  const j0             = Math.max( 0, Math.floor( ( minz - c.position[2] ) / px ) ), j1 = Math.min( m - 1, Math.ceil( ( maxz - c.position[2] ) / px ) );
  const idx: number[]  = [], cov: number[] = [];
  let x0               = m, y0 = m, x1 = -1, y1 = -1;
  for ( let j = j0; j <= j1; j++ )
    for ( let i = i0; i <= i1; i++ ) {
      const v = formationRockAt( g, c.position[0] + ( i + 0.5 ) * px, c.position[2] + ( j + 0.5 ) * px );
      if ( v <= 0 ) continue;
      idx.push( j * m + i );
      cov.push( v );
      x0 = Math.min( x0, i );
      y0 = Math.min( y0, j );
      x1 = Math.max( x1, i );
      y1 = Math.max( y1, j );
    }
  return idx.length ? { idx: Uint32Array.from( idx ), cov: Float32Array.from( cov ), rect: [x0, y0, x1, y1] } : undefined;
}

// A live edit's change worked out a frame's share at a time ( a big formation took a tenth of a second a change, the
// view stopped while it did; worked out in full it waits on the graphics card ): edits in the order made, the newest
// of one shape's in a row standing for those before it, each written in one go once it's ready. One something waits
// for ( an edit's end, recorded once it's in ) stays as it is: what comes after goes behind it.
interface Item {
  s:     Shape;
  full:  boolean;
  after: ( () => void )[];
}

let job: { item: Item; before: Applied | undefined; steps: Generator<void, Applied, void> } | null = null;
const queue: Item[] = [];
let pumping          = false;

/**
 * previewShape, a frame's share at a time ( the terrain follows a frame or few behind ). `full`: a formation worked
 * out in full ( its erosion, the snow softened ), as once an edit's let go.
**/
export function previewShapeSoon( s: Shape, full = false ) {
  if ( typeof requestAnimationFrame !== "function" ) return void swap( s.uid, s, full );
  const tail = queue[queue.length - 1];
  if ( tail && !tail.after.length && tail.s.uid === s.uid ) {
    tail.s    = s;
    tail.full = full;
  } else queue.push( { s, full, after: [] } );
  if ( !pumping ) void pump();
}

/**
 * Whether live edits are still being worked out.
**/
export const shapesBusy = () => !!job || queue.length > 0;

async function pump() {
  pumping = true;
  try {
    while ( shapesBusy() ) {
      while ( shapesBusy() && !overBudget() ) stepJob();
      if ( shapesBusy() ) await nextFrame();
    }
  } finally {
    pumping = false;
  }
}

function stepJob() {
  if ( !job ) {
    const item   = queue.shift()!, before = applied.get( item.s.uid );
    job          = { item, before, steps: bakeSteps( item.s, extrasOf( before ), undefined, before, item.full ) };
  }
  const r = job.steps.next();
  if ( !r.done ) return;
  const j = job;
  job     = null;
  keepOn( layerOf( j.item.s ), keysOf( j.before, r.value ), j.item.s.uid, () => {
    if ( j.before ) addDelta( j.before, -1 );
    writePatches( r.value );
  } );
  setApplied( j.item.s.uid, r.value );
  for ( const f of j.item.after ) f();
}

/**
 * The live edits still being worked out, finished now ( before anything reads or changes what the shapes did; any on
 * the graphics card finished here instead ).
**/
export function settleShapes() {
  rushFormations( () => {
    while ( shapesBusy() ) stepJob();
  } );
}

/**
 * `f` once the live edits made so far are in the terrain ( now, if they are ).
**/
export function whenShapesSettled( f: () => void ) {
  const tail = queue[queue.length - 1] ?? job?.item;
  if ( !tail ) return f();
  tail.after.push( f );
}

/**
 * Replaces what shape `uid` contributes: its old change comes out, `next` ( if any ) goes in.
**/
function swap( uidKey: string, next: Shape | null, full = false ): { before: Applied | undefined; after: Applied | undefined } {
  settleShapes();
  const before = applied.get( uidKey );
  const extras = extrasOf( before ); // sculpting done on top since; carried over to the new shape
  let after: Applied | undefined;
  const keys   = keysOf( before, [] );
  if ( next ) {
    const [minx, minz, maxx, maxz] = shapeBounds( next );
    for ( const c of terrain.chunks ) if ( overlaps( c, minx, minz, maxx, maxz ) ) keys.add( c.key );
  }
  keepOn( layerOf( next ?? doc?.list().find( ( s ) => s.uid === uidKey ) ), keys, uidKey, () => {
    if ( before ) addDelta( before, -1 );
    after = next ? rushFormations( () => bake( next, extras, undefined, full ) ) : undefined;
  } );
  setApplied( uidKey, after );
  return { before, after };
}

/**
 * Puts a contribution back exactly ( undo/redo ).
**/
function restore( uidKey: string, from: Applied | undefined, to: Applied | undefined ) {
  settleShapes();
  keepOn( layerOf( doc?.list().find( ( s ) => s.uid === uidKey ) ), keysOf( from, to ), uidKey, () => {
    if ( from ) addDelta( from, -1 );
    if ( to ) addDelta( to, 1 );
  } );
  setApplied( uidKey, to );
}

/**
 * The chunks two changes of a shape's are in ( where its heights change ).
**/
function keysOf( a: Applied | undefined, b: Applied | undefined ): Set<string> {
  return new Set( [...( a ?? [] ), ...( b ?? [] )].filter( ( p ) => p.w > 0 ).map( ( p ) => p.key ) );
}

/**
 * The heights under a patch now.
**/
function heightsUnder( p: Patch ): Float32Array | null {
  const c = terrain.chunks[terrain.indexOf( p.key )];
  if ( !c || !p.w ) return null;
  const out = new Float32Array( p.w * p.h );
  for ( let j = 0; j < p.h; j++ ) out.set( c.heights.subarray( ( p.j0 + j ) * c.res + p.i0, ( p.j0 + j ) * c.res + p.i0 + p.w ), j * p.w );
  return out;
}

/**
 * How a patch's ground has changed since `was` ( its heights then ) gone under it: its surface moved with it.
**/
function moveUnder( p: Patch, was: Float32Array ) {
  const c = terrain.chunks[terrain.indexOf( p.key )];
  if ( !c ) return;
  for ( let j = 0; j < p.h; j++ )
    for ( let i = 0, k = j * p.w; i < p.w; i++, k++ ) if ( p.delta[k] !== 0 ) p.out[k] += c.heights[( p.j0 + j ) * c.res + p.i0 + i] - was[k];
}

// A shape above a change, as it was before: its patches' heights ( in the chunks changing ), a ski line's points'
// ground.
interface Above {
  uid:   string;
  s:     Shape | undefined;
  was:   ( Float32Array | null )[];
  under: number[] | null;
}

/**
 * The shapes above layer `layer` in chunks `keys` ( not `self` ), as they are now: for `followOn` once the ground
 * beneath has changed.
**/
function shapesAbove( layer: number, keys: Set<string>, self?: string ): Above[] {
  const shapes      = new Map( ( doc?.list() ?? [] ).map( ( s ) => [s.uid, s] ) );
  const out: Above[] = [];
  for ( const [uid, ps] of applied ) {
    const s = shapes.get( uid );
    if ( uid === self || layerOf( s ) <= layer || !ps.some( ( p ) => p.w > 0 && keys.has( p.key ) ) ) continue;
    let under: number[] | null = null;
    if ( s?.kind === "skiline" ) {
      const g = groundWithout( uid );
      under   = s.nodes.map( ( n ) => g( n.p[0], n.p[2] ) );
    }
    out.push( { uid, s, was: ps.map( ( p ) => ( keys.has( p.key ) ? heightsUnder( p ) : null ) ), under } );
  }
  return out;
}

/**
 * The shapes above a change ( as `shapesAbove` found them ) kept on the ground now: the change under their patches,
 * and the formations and ski lines made again on it ( `moved`: their patches kept up with it already ).
**/
function followOn( above: Above[], moved = false ) {
  for ( const a of above ) {
    const ps = applied.get( a.uid ) ?? [];
    if ( !moved )
      ps.forEach( ( p, k ) => {
        const w = a.was[k];
        if ( w ) moveUnder( p, w );
      } );
    const s = a.s;
    if ( !s || !doc ) continue;
    if ( s.kind === "formation" ) doc.follow( s );
    else if ( s.kind === "skiline" && a.under ) {
      const g     = groundWithout( a.uid ), under = a.under;
      const nodes = s.nodes.map( ( n, k ): SkiLineNode => {
        const d = g( n.p[0], n.p[2] ) - under[k];
        return Number.isFinite( d ) && Math.abs( d ) > 1e-6 ? { ...n, p: [n.p[0], n.p[1] + d, n.p[2]] } : n;
      } );
      doc.follow( { ...s, nodes } );
    }
  }
}

/**
 * `write` ( a change of the ground in layer `layer`, in chunks `keys` ) with the shapes above it kept on it.
**/
function keepOn( layer: number, keys: Set<string>, self: string, write: () => void ) {
  const above = doc ? shapesAbove( layer, keys, self ) : [];
  write();
  if ( above.length ) followOn( above );
}

/**
 * The trails changing the ground in chunks `keys` ( trails/ground/apply.ts, a block at a time, each gone under the
 * shapes there: `trailsMoved` ): the shapes there as they are now; called once it's all in, the formations and ski
 * lines made again on it.
**/
export function trailsChanging( keys: Set<string> ): () => void {
  if ( !doc || !applied.size ) return () => {};
  const above = shapesAbove( 0, keys );
  return () => followOn( above, true );
}

/**
 * The trails' change of chunk `key`'s samples [i0..i0+w)×[j0..j0+h) ( `d`, rows of w ) gone under every shape there.
**/
export function trailsMoved( key: string, i0: number, j0: number, w: number, h: number, d: Float32Array ) {
  for ( const ps of applied.values() )
    for ( const p of ps ) {
      if ( p.key !== key || !p.w || p.i0 >= i0 + w || i0 >= p.i0 + p.w || p.j0 >= j0 + h || j0 >= p.j0 + p.h ) continue;
      for ( let j = Math.max( j0, p.j0 ); j < Math.min( j0 + h, p.j0 + p.h ); j++ )
        for ( let i = Math.max( i0, p.i0 ); i < Math.min( i0 + w, p.i0 + p.w ); i++ ) {
          const k = ( j - p.j0 ) * p.w + i - p.i0;
          if ( p.delta[k] !== 0 ) p.out[k] += d[( j - j0 ) * w + i - i0];
        }
    }
}

/**
 * Chunk `key`'s heights all moved by `shift` ( given more room: its base lowered ): the shapes' surfaces there with
 * them.
**/
export function shapesRebased( key: string, shift: number ) {
  for ( const ps of applied.values() ) for ( const p of ps ) if ( p.key === key ) for ( let k = 0; k < p.out.length; k++ ) p.out[k] += shift;
}

/**
 * What the shapes add at chunk `key`'s samples ( taken off the ground the trails remember beneath them:
 * trails/ground/base.ts ).
**/
export function shapesLift( key: string ): ( i: number, j: number ) => number {
  const ps = [...applied.values()].flatMap( ( a ) => a.filter( ( p ) => p.key === key && p.w > 0 ) );
  return ( i, j ) => deltaAt( ps, i, j );
}

/**
 * Live update while a shape is being edited ( dragging a handle, a slider ): applies immediately without an undo
 * step. `commitShape` records the whole edit as one step afterwards.
**/
export function previewShape( s: Shape, full = false ) {
  swap( s.uid, s, full );
}

export interface ShapeEdit {
  uid:   string;
  // the contribution before the edit began
  start: Applied | undefined;
}

/**
 * Starts an edit session: remembers the shape's contribution for undo ( as it is once the edits made before are in ).
**/
export function beginShapeEdit( uidKey: string ): ShapeEdit {
  const edit: ShapeEdit = { uid: uidKey, start: applied.get( uidKey ) };
  whenShapesSettled( () => ( edit.start = applied.get( uidKey ) ) );
  return edit;
}

/**
 * Records an edit ( create / change / delete ) as one undo step; `apply` swaps the shape lists in the document.
**/
export function commitShapeEdit( edit: ShapeEdit, label: string, setShapes: { undo: () => void; redo: () => void } ) {
  settleShapes();
  const end = applied.get( edit.uid );
  if ( end === edit.start ) return;
  const size = ( a: Applied | undefined ) => ( a ?? [] ).reduce( ( n, p ) => n + p.delta.byteLength + p.out.byteLength + ( p.rock ? p.rock.idx.byteLength * 2 + p.rock.idx.length * 2 : 0 ) + ( p.paint ? p.paint.idx.byteLength * 2 + p.paint.idx.length * 8 : 0 ), 0 );
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
 * Shape `uid`'s change made the ground's own ( Map-Tools' Bake Into Terrain ): it stays, the shape no longer holds it.
 * How to undo and redo that.
**/
export function bakeShapeIn( uidKey: string ) {
  settleShapes();
  const had = applied.get( uidKey );
  setApplied( uidKey, undefined );
  return {
    undo: () => setApplied( uidKey, had ),
    redo: () => setApplied( uidKey, undefined ),
  };
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
  job          = null;
  queue.length = 0;
  applied.clear();
  changes.clear();
}

/**
 * The ground ( Unity XZ → absolute height, NaN off the terrain ) as it would be without shape `uid`'s change.
**/
export function groundWithout( uidKey: string ): ( x: number, z: number ) => number {
  // ( a live edit still being worked out isn't waited for: the terrain and what the shape did are written together )
  return groundOff( byChunk( applied.get( uidKey ) ?? [] ) );
}

/**
 * A shape's patches by chunk key ( a chunk can have more than one: a ski line's stripes, the rest of a change brought
 * in, terrain/shapes/unbake.ts ).
**/
function byChunk( patches: Applied ): Map<string, Patch[]> {
  const m = new Map<string, Patch[]>();
  for ( const p of patches ) ( m.get( p.key ) ?? m.set( p.key, [] ).get( p.key )! ).push( p );
  return m;
}

/**
 * What a chunk's patches change at sample ( i, j ), all of them.
**/
function deltaAt( ps: Patch[], i: number, j: number ) {
  // ( most often one patch, or none )
  if ( ps.length === 0 ) return 0;
  if ( ps.length === 1 ) {
    const p = ps[0], pi = i - p.i0, pj = j - p.j0;
    return pi >= 0 && pj >= 0 && pi < p.w && pj < p.h ? p.delta[pj * p.w + pi] : 0;
  }
  let d = 0;
  for ( const p of ps ) {
    const pi = i - p.i0, pj = j - p.j0;
    if ( pi >= 0 && pj >= 0 && pi < p.w && pj < p.h ) d += p.delta[pj * p.w + pi];
  }
  return d;
}

/**
 * The ground with `patches` ( a shape's change, by chunk key ) taken off, and `extras` ( what's on top of it ).
**/
function groundOff( patches: Map<string, Patch[]>, extras?: Extras ): ( x: number, z: number ) => number {
  return ( x, z ) => {
    const ci = terrain.chunkAt( x, z );
    if ( ci < 0 ) return NaN;
    const c  = terrain.chunks[ci];
    const p  = patches.get( c.key ) ?? [];
    const ex = extras?.get( c.key );
    if ( !p.length && !ex ) return terrain.heightAt( x, z );
    const [fx, fz] = c.toSample( x, z );
    const i        = Math.min( c.res - 2, Math.max( 0, Math.floor( fx ) ) ), j = Math.min( c.res - 2, Math.max( 0, Math.floor( fz ) ) );
    const tx       = fx - i, tz = fz - j;
    const at       = ( ii: number, jj: number ) => c.heights[jj * c.res + ii] - deltaAt( p, ii, jj ) - ( ex?.get( jj * c.res + ii ) ?? 0 );
    const a = at( i, j ), b = at( i + 1, j ), cc = at( i, j + 1 ), d = at( i + 1, j + 1 );
    return c.position[1] + ( a + ( b - a ) * tx ) * ( 1 - tz ) + ( cc + ( d - cc ) * tx ) * tz;
  };
}
