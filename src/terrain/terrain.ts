// Terrain document: chunks of height samples ( Unity space ), split into render tiles.
//
// A chunk is a square grid of `res` x `res` samples ( res = 2^n + 1 ) covering size.x metres, with
// heights in metres above position.y. Rows run along +Z ( Unity ), exactly like the .jbrmap R16 data.
// For rendering and partial GPU uploads each chunk is cut into tiles of up to TILE quads per side.

import * as THREE from "three";
import { clamp } from "../core/coords";

export const TILE = 512;

export interface ChunkInit {
  key:       string;
  position:  [number, number, number];
  size:      [number, number, number];
  res:       number;
  heights:   Float32Array;
  snowMask?: string | null;
}

export class TerrainChunk {
  readonly key:          string;
  readonly position:     [number, number, number];
  readonly size:         [number, number, number];
  readonly res:          number;
  readonly heights:      Float32Array;
  readonly spacing:      number;
  readonly tileQuads:    number;
  readonly tilesPerSide: number;
  snowMask:              string     | null;
  // sculpt mask ( editor only ): 0 = free … 255 = fully protected from brushes; null until something is masked
  mask:                  Uint8Array | null = null;
  // Chunks sharing a border with this one, by side ( 0 -X, 1 +X, 2 -Z, 3 +Z ). A side can have several: chunks may be
  // different sizes.
  adjacent:              { side: number; c: TerrainChunk }[] = [];

  constructor( init: ChunkInit ) {
    this.key          = init.key;
    this.position     = init.position;
    this.size         = init.size;
    this.res          = init.res;
    this.heights      = init.heights;
    this.snowMask     = init.snowMask ?? null;
    this.spacing      = init.size[0] / ( init.res - 1 );
    this.tileQuads    = Math.min( TILE, init.res - 1 );
    this.tilesPerSide = ( init.res - 1 ) / this.tileQuads;
  }

  contains( ux: number, uz: number ) {
    return ux >= this.position[0] && ux <= this.position[0] + this.size[0] && uz >= this.position[2] && uz <= this.position[2] + this.size[2];
  }

  /**
   * Continuous sample coordinates ( may be fractional ) for a Unity XZ position.
  **/
  toSample( ux: number, uz: number ): [number, number] {
    return [( ux - this.position[0] ) / this.spacing, ( uz - this.position[2] ) / this.spacing];
  }

  sample( i: number, j: number ) {
    const r = this.res;
    i       = i < 0 ? 0 : i >= r ? r - 1 : i;
    j       = j < 0 ? 0 : j >= r ? r - 1 : j;
    return this.heights[j * r + i];
  }

  /**
   * Bilinear height ( metres above position.y ) at fractional sample coordinates.
  **/
  sampleBilinear( fx: number, fz: number ) {
    const i  = Math.floor( fx ), j = Math.floor( fz );
    const tx = fx - i, tz = fz - j;
    const a  = this.sample( i, j ), b = this.sample( i + 1, j ), c = this.sample( i, j + 1 ), d = this.sample( i + 1, j + 1 );
    return ( a + ( b - a ) * tx ) * ( 1 - tz ) + ( c + ( d - c ) * tx ) * tz;
  }

  tileIndex( tx: number, tz: number ) {
    return tz * this.tilesPerSide + tx;
  }

  /**
   * Tiles whose sample range ( inclusive of shared edges and the 1-sample normal apron ) intersects [i0,i1]x[j0,j1].
  **/
  tilesTouching( i0: number, j0: number, i1: number, j1: number ): number[] {
    const q             = this.tileQuads, n = this.tilesPerSide;
    const tx0           = clamp( Math.floor( ( i0 - 1 ) / q ), 0, n - 1 ), tx1 = clamp( Math.floor( ( i1 + 1 ) / q ), 0, n - 1 );
    const tz0           = clamp( Math.floor( ( j0 - 1 ) / q ), 0, n - 1 ), tz1 = clamp( Math.floor( ( j1 + 1 ) / q ), 0, n - 1 );
    const out: number[] = [];
    for ( let tz = tz0; tz <= tz1; tz++ ) for ( let tx = tx0; tx <= tx1; tx++ ) out.push( this.tileIndex( tx, tz ) );
    return out;
  }
}

export interface TileSnapshot {
  chunk: number;
  i0:    number;
  j0:    number;
  w:     number;
  h:     number;
  data:  Float32Array;
}

// Chunk-sample rectangle [i0, j0, i1, j1] ( inclusive ).
export type Rect     = [number, number, number, number];
// chunk index → tile index → the part of that tile that changed
export type DirtyMap = Map<number, Map<number, Rect>>;
type Listener        = ( dirty: DirtyMap ) => void;

export class Terrain {
  chunks: TerrainChunk[]  = [];
  private dirty: DirtyMap = new Map();
  private listeners       = new Set<Listener>();
  private layoutListeners = new Set<() => void>();
  // bumps whenever chunks are added/removed ( renderer rebuilds )
  layoutVersion = 0;

  // chunk key → index in `chunks`
  private keyIndex = new Map<string, number>();

  setChunks( inits: ChunkInit[] ) {
    this.chunks   = inits.map( ( c ) => new TerrainChunk( c ) );
    this.keyIndex = new Map( this.chunks.map( ( c, i ) => [c.key, i] ) );
    this.linkNeighbours();
    this.layoutVersion++;
    this.dirty = new Map();
    this.layoutListeners.forEach( ( l ) => l() );
  }

  /**
   * Called after the chunk set changes ( new/open project ); renderers rebuild their tiles.
  **/
  onLayout( l: () => void ) {
    this.layoutListeners.add( l );
    return () => this.layoutListeners.delete( l );
  }

  /**
   * Index of the chunk with this key, or -1.
  **/
  indexOf( key: string ): number {
    return this.keyIndex.get( key ) ?? -1;
  }

  private linkNeighbours() {
    const eps = 0.01;
    for ( const a of this.chunks ) a.adjacent = [];
    for ( const a of this.chunks )
      for ( const b of this.chunks ) {
        if ( a === b ) continue;
        const [ax0, , az0] = a.position, [bx0, , bz0] = b.position;
        const ax1          = ax0 + a.size[0], az1 = az0 + a.size[2], bx1 = bx0 + b.size[0], bz1 = bz0 + b.size[2];
        const overlapZ     = Math.min( az1, bz1 ) - Math.max( az0, bz0 ) > eps, overlapX = Math.min( ax1, bx1 ) - Math.max( ax0, bx0 ) > eps;
        if ( overlapZ && Math.abs( bx1 - ax0 ) < eps ) a.adjacent.push( { side: 0, c: b } );
        if ( overlapZ && Math.abs( bx0 - ax1 ) < eps ) a.adjacent.push( { side: 1, c: b } );
        if ( overlapX && Math.abs( bz1 - az0 ) < eps ) a.adjacent.push( { side: 2, c: b } );
        if ( overlapX && Math.abs( bz0 - az1 ) < eps ) a.adjacent.push( { side: 3, c: b } );
      }
  }

  bounds() {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, y1 = -Infinity;
    for ( const c of this.chunks ) {
      x0 = Math.min( x0, c.position[0] );
      z0 = Math.min( z0, c.position[2] );
      x1 = Math.max( x1, c.position[0] + c.size[0] );
      z1 = Math.max( z1, c.position[2] + c.size[2] );
      y1 = Math.max( y1, c.position[1] + c.size[1] );
    }
    return { x0, z0, x1, z1, y1 };
  }

  chunkAt( ux: number, uz: number ): number {
    // Prefer the finest chunk on shared edges.
    let best = -1;
    for ( let i = 0; i < this.chunks.length; i++ ) {
      const c = this.chunks[i];
      if ( c.contains( ux, uz ) && ( best < 0 || c.spacing < this.chunks[best].spacing ) ) best = i;
    }
    return best;
  }

  /**
   * Absolute world height ( Unity Y ) at Unity XZ, or NaN outside the terrain.
  **/
  heightAt( ux: number, uz: number ): number {
    const ci = this.chunkAt( ux, uz );
    if ( ci < 0 ) return NaN;
    const c        = this.chunks[ci];
    const [fx, fz] = c.toSample( ux, uz );
    return c.position[1] + c.sampleBilinear( fx, fz );
  }

  /**
   * Unity-space normal from central differences.
  **/
  normalAt( ux: number, uz: number, d = 0.5 ): THREE.Vector3 {
    const hl = this.heightAt( ux - d, uz ), hr = this.heightAt( ux + d, uz );
    const hd = this.heightAt( ux, uz - d ), hu = this.heightAt( ux, uz + d );
    if ( [hl, hr, hd, hu].some( Number.isNaN ) ) return new THREE.Vector3( 0, 1, 0 );
    return new THREE.Vector3( hl - hr, 2 * d, hd - hu ).normalize();
  }

  /**
   * Slope in degrees at a point.
  **/
  slopeAt( ux: number, uz: number ) {
    const n = this.normalAt( ux, uz );
    return ( Math.acos( clamp( n.y, -1, 1 ) ) * 180 ) / Math.PI;
  }

  /**
   * Ray vs terrain in three.js space ( Z mirrored ). Marches with a step relative to the local
   * sample spacing, then bisects. Returns the hit in three space, or null. `ground`: the heights to hit ( Unity XZ →
   * absolute Y, NaN off the terrain ), the terrain's own by default.
  **/
  raycast( origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 20000, ground = ( x: number, z: number ) => this.heightAt( x, z ) ): THREE.Vector3 | null {
    const b = this.bounds();
    if ( !Number.isFinite( b.x0 ) ) return null;
    const d    = dir.clone().normalize();
    // Clip to the terrain's bounding box ( three space: z mirrored ).
    const box  = new THREE.Box3( new THREE.Vector3( b.x0, -1e4, -b.z1 ), new THREE.Vector3( b.x1, b.y1 + 10, -b.z0 ) );
    const ray  = new THREE.Ray( origin, d );
    let tStart = 0;
    if ( !box.containsPoint( origin ) ) {
      const hit = ray.intersectBox( box, new THREE.Vector3() );
      if ( !hit ) return null;
      tStart = origin.distanceTo( hit );
    }
    const above = ( t: number ) => {
      const p = origin.clone().addScaledVector( d, t );
      const h = ground( p.x, -p.z );
      return Number.isNaN( h ) ? 1 : p.y - h;
    };
    let t = tStart, prev = above( t );
    if ( prev < 0 ) return null;
    while ( t < maxDist ) {
      const p  = origin.clone().addScaledVector( d, t );
      const ci = this.chunkAt( p.x, -p.z );
      if ( ci < 0 && !box.containsPoint( p ) ) break;
      const spacing = ci >= 0 ? this.chunks[ci].spacing : 1;
      const step    = Math.max( spacing * 0.75, prev * 0.5 );
      const nt      = t + step;
      const cur     = above( nt );
      if ( cur <= 0 ) {
        let lo = t, hi = nt;
        for ( let k = 0; k < 24; k++ ) {
          const mid = ( lo + hi ) / 2;
          if ( above( mid ) > 0 ) lo = mid;
          else hi = mid;
        }
        return origin.clone().addScaledVector( d, hi );
      }
      t    = nt;
      prev = cur;
    }
    return null;
  }

  // ---------------------------------------------------------------- dirty tracking

  /**
   * Records that samples in the rectangle changed. Normals depend on neighbours, so the rect grows by one.
  **/
  markDirtyRect( ci: number, i0: number, j0: number, i1: number, j1: number ) {
    const c   = this.chunks[ci];
    let tiles = this.dirty.get( ci );
    if ( !tiles ) this.dirty.set( ci, ( tiles = new Map() ) );
    const a0 = i0 - 1, b0 = j0 - 1, a1 = i1 + 1, b1 = j1 + 1;
    for ( const t of c.tilesTouching( i0, j0, i1, j1 ) ) {
      const r = tiles.get( t );
      tiles.set( t, r ? [Math.min( r[0], a0 ), Math.min( r[1], b0 ), Math.max( r[2], a1 ), Math.max( r[3], b1 )] : [a0, b0, a1, b1] );
    }
  }

  markAllDirty() {
    this.chunks.forEach( ( c, ci ) => this.markDirtyRect( ci, 0, 0, c.res - 1, c.res - 1 ) );
    this.flush();
  }

  /**
   * Hands accumulated changes to the renderers. The viewport calls this once per frame, so a stroke's many dabs
   * cost one upload per tile per frame.
  **/
  flush() {
    if ( this.dirty.size === 0 ) return false;
    const d    = this.dirty;
    this.dirty = new Map();
    this.listeners.forEach( ( l ) => l( d ) );
    return true;
  }

  subscribe( l: Listener ) {
    this.listeners.add( l );
    return () => this.listeners.delete( l );
  }

  // ---------------------------------------------------------------- edits

  snapshot( ci: number, i0: number, j0: number, i1: number, j1: number ): TileSnapshot {
    const c    = this.chunks[ci];
    i0         = clamp( i0, 0, c.res - 1 ); j0 = clamp( j0, 0, c.res - 1 );
    i1         = clamp( i1, 0, c.res - 1 ); j1 = clamp( j1, 0, c.res - 1 );
    const w    = i1 - i0 + 1, h = j1 - j0 + 1;
    const data = new Float32Array( w * h );
    for ( let j = 0; j < h; j++ ) data.set( c.heights.subarray( ( j0 + j ) * c.res + i0, ( j0 + j ) * c.res + i0 + w ), j * w );
    return { chunk: ci, i0, j0, w, h, data };
  }

  restore( s: TileSnapshot ) {
    const c = this.chunks[s.chunk];
    for ( let j = 0; j < s.h; j++ ) c.heights.set( s.data.subarray( j * s.w, ( j + 1 ) * s.w ), ( s.j0 + j ) * c.res + s.i0 );
    this.markDirtyRect( s.chunk, s.i0, s.j0, s.i0 + s.w - 1, s.j0 + s.h - 1 );
  }

  /**
   * Re-sync shared borders after edits: equal-resolution neighbours get the average of both
   * edges; a finer chunk's edge is re-sampled to the coarser neighbour's linear interpolation so
   * the two meshes meet without cracks ( and the game sees no seam ).
  **/
  syncEdges( chunkIndices: Iterable<number> ) {
    const done = new Set<string>();
    for ( const ci of chunkIndices ) {
      const a = this.chunks[ci];
      if ( !a ) continue;
      for ( const { side, c: b } of a.adjacent ) {
        const bi = this.indexOf( b.key );
        const id = ci < bi ? `${ci}:${bi}` : `${bi}:${ci}`;
        if ( done.has( id ) ) continue;
        done.add( id );
        this.syncPair( ci, side, bi );
      }
    }
  }

  /**
   * Index of edge sample k on `side` of chunk c.
  **/
  edgeIndex( c: TerrainChunk, side: number, k: number ): number {
    const r = c.res;
    return side === 0 ? k * r : side === 1 ? k * r + r - 1 : side === 2 ? k : ( r - 1 ) * r + k;
  }

  /**
   * Makes the shared part of two chunks' borders match: where both have samples at the same places they get the
   * average; otherwise the finer edge takes the coarser one's straight-line interpolation ( so the meshes meet without
   * cracks and the game sees no step ). Works for chunks of different sizes and resolutions. Only samples that change
   * are marked for upload ( a 4097 chunk's whole border, every edit, is dozens of tiles sent to the GPU again ).
  **/
  private syncPair( ai: number, side: number, bi: number ) {
    const a        = this.chunks[ai], b = this.chunks[bi];
    const opposite = side ^ 1;
    const axis     = side < 2 ? 2 : 0; // along the shared border: z for ±X sides, x for ±Z sides
    const a0       = a.position[axis], b0 = b.position[axis];
    const lo       = Math.max( a0, b0 ), hi = Math.min( a0 + a.size[axis], b0 + b.size[axis] );
    if ( hi - lo < 1e-6 ) return;
    const eps   = 1e-4;
    const sa    = a.spacing, sb = b.spacing;
    const same  = Math.abs( sa - sb ) < 1e-9 && Math.abs( ( ( a0 - b0 ) / sa ) - Math.round( ( a0 - b0 ) / sa ) ) < eps;
    let ka0     = 0, ka1 = -1, kb0 = 0, kb1 = -1;
    // ( heights are float32 over different bases: they can disagree by a rounding without being apart )
    const apart = 1e-4;
    if ( same ) {
      const k0 = Math.round( ( lo - a0 ) / sa ), k1 = Math.round( ( hi - a0 ) / sa ), off = Math.round( ( a0 - b0 ) / sb );
      let c0   = Infinity, c1 = -Infinity;
      for ( let k = k0; k <= k1; k++ ) {
        const ia = this.edgeIndex( a, side, k ), ib = this.edgeIndex( b, opposite, k + off );
        const va = a.heights[ia] + a.position[1], vb = b.heights[ib] + b.position[1];
        if ( Math.abs( va - vb ) > apart ) {
          const m       = ( va + vb ) / 2;
          a.heights[ia] = m - a.position[1];
          b.heights[ib] = m - b.position[1];
          c0            = Math.min( c0, k );
          c1            = Math.max( c1, k );
        }
      }
      ka0 = c0; ka1 = c1; kb0 = c0 + off; kb1 = c1 + off;
    } else {
      const [fine, coarse, fs, cs] = sa < sb ? [a, b, side, opposite] : [b, a, opposite, side];
      const f0                     = fine.position[axis], c0 = coarse.position[axis];
      const k0                     = Math.max( 0, Math.ceil( ( lo - f0 ) / fine.spacing - eps ) ), k1 = Math.min( fine.res - 1, Math.floor( ( hi - f0 ) / fine.spacing + eps ) );
      let m0                       = Infinity, m1 = -Infinity;
      for ( let k = k0; k <= k1; k++ ) {
        const t  = ( f0 + k * fine.spacing - c0 ) / coarse.spacing;
        const j  = Math.min( coarse.res - 2, Math.max( 0, Math.floor( t ) ) ), u = Math.min( 1, Math.max( 0, t - j ) );
        const v0 = coarse.heights[this.edgeIndex( coarse, cs, j )], v1 = coarse.heights[this.edgeIndex( coarse, cs, j + 1 )];
        const at = this.edgeIndex( fine, fs, k ), v = v0 + ( v1 - v0 ) * u + coarse.position[1] - fine.position[1];
        if ( Math.abs( fine.heights[at] - v ) > apart ) {
          fine.heights[at] = v;
          m0               = Math.min( m0, k );
          m1               = Math.max( m1, k );
        }
      }
      if ( fine === a ) { ka0 = m0; ka1 = m1; } else { kb0 = m0; kb1 = m1; }
    }
    const mark = ( ci: number, c: TerrainChunk, s2: number, k0: number, k1: number ) => {
      if ( k1 < k0 ) return;
      const r = c.res - 1;
      if ( s2 === 0 ) this.markDirtyRect( ci, 0, k0, 0, k1 );
      else if ( s2 === 1 ) this.markDirtyRect( ci, r,  k0, r,  k1 );
      else if ( s2 === 2 ) this.markDirtyRect( ci, k0, 0,  k1, 0  );
      else this.markDirtyRect( ci, k0, r, k1, r );
    };
    mark( ai, a, side,     ka0, ka1 );
    mark( bi, b, opposite, kb0, kb1 );
  }
}

export const terrain = new Terrain();
