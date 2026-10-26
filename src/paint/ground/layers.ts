// Each chunk's paint layer ( its snow mask, and the flow angles ): loaded when first painted, told of its changes.

import { ipc, joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";
import type { TerrainChunk } from "../../terrain/terrain";

export interface PaintLayer {
  key:     string;
  // pixels per side
  m:       number;
  rgba:    Uint8Array;
  flow:    Uint8Array | null;
  // G/B/A carry markings and powder ( the chunk's snow-mask-4channel flag )
  four:    boolean;
  // changed since saved
  dirty:   boolean;
  // bumps on every change ( the renderer re-uploads )
  version: number;
  // what changed since the renderer last uploaded it: pixels x0, y0, x1, y1 ( inclusive ), or all of it
  pending: Rect | "all" | null;
}

export type Rect = [number, number, number, number];

export const union = ( a: Rect, b: Rect ): Rect => [Math.min( a[0], b[0] ), Math.min( a[1], b[1] ), Math.max( a[2], b[2] ), Math.max( a[3], b[3] )];

export const layers = new Map<string, PaintLayer>();

const loading = new Map<string, Promise<PaintLayer>>();

type Listener = ( key: string ) => void;

const listeners = new Set<Listener>();

export const onPaintChange = ( l: Listener ) => {
  listeners.add( l );
  return () => void listeners.delete( l );
};

/**
 * The layer changed ( just `rect`, when given ): saved and redrawn.
**/
export const changed = ( L: PaintLayer, rect?: Rect ) => {
  L.pending = !rect || L.pending === "all" ? "all" : L.pending ? union( L.pending, rect ) : rect;
  L.version++;
  L.dirty = true;
  useEditor.setState( { dirty: true } );
  listeners.forEach( ( l ) => l( L.key ) );
};

/**
 * Mask pixels per side for a chunk without one: about 0.5 m per pixel, and at least as fine as its ground ( a pixel
 * per sample, as the game's own maps have it ), 256..4096.
**/
export function defaultMaskSize( c: TerrainChunk ) {
  let m = 256;
  while ( m < 4096 && ( c.size[0] / m > 0.5 || m < c.res - 1 ) ) m *= 2;
  return m;
}

export const layerOf = ( key: string ) => layers.get( key ) ?? null;

/**
 * A mask brought up from `m` to `M` pixels a side ( a mask made coarser than its chunk's ground ): snow, coverage and
 * powder blended between pixels, the marking hue from the nearest ( it's a colour number, not a blend ).
**/
export function upsampleMask( rgba: Uint8Array, m: number, M: number ): Uint8Array {
  const out = new Uint8Array( M * M * 4 );
  for ( let J = 0; J < M; J++ ) {
    const fy = Math.min( m - 1, Math.max( 0, ( ( J + 0.5 ) * m ) / M - 0.5 ) );
    const y0 = Math.floor( fy ), y1 = Math.min( m - 1, y0 + 1 ), b = fy - y0;
    const yn = Math.min( m - 1, Math.floor( ( ( J + 0.5 ) * m ) / M ) );
    for ( let I = 0; I < M; I++ ) {
      const fx  = Math.min( m - 1, Math.max( 0, ( ( I + 0.5 ) * m ) / M - 0.5 ) );
      const x0  = Math.floor( fx ), x1 = Math.min( m - 1, x0 + 1 ), a = fx - x0;
      const xn  = Math.min( m - 1, Math.floor( ( ( I + 0.5 ) * m ) / M ) );
      const o   = ( J * M + I ) * 4;
      const p00 = ( y0 * m + x0 ) * 4, p10 = ( y0 * m + x1 ) * 4, p01 = ( y1 * m + x0 ) * 4, p11 = ( y1 * m + x1 ) * 4;
      for ( const c of [0, 2, 3] )
        out[o + c] = Math.round( ( rgba[p00 + c] * ( 1 - a ) + rgba[p10 + c] * a ) * ( 1 - b ) + ( rgba[p01 + c] * ( 1 - a ) + rgba[p11 + c] * a ) * b );
      out[o + 1] = rgba[( yn * m + xn ) * 4 + 1];
    }
  }
  return out;
}

/**
 * The chunk's paint layer, loaded from its mask files ( or made, all snow ).
**/
export function ensureLayer( c: TerrainChunk ): Promise<PaintLayer> {
  const have = layers.get( c.key );
  if ( have ) return Promise.resolve( have );
  let p = loading.get( c.key );
  if ( !p ) {
    p = ( async () => {
      const st                    = useEditor.getState();
      const extras                = ( st.chunkExtras[c.key] ?? {} ) as { snowMask4Channel?: boolean; snowMask2?: string | null };
      let rgba: Uint8Array | null = null, m = defaultMaskSize( c ), four = !!extras.snowMask4Channel, flow: Uint8Array | null = null;
      if ( c.snowMask && st.projectDir ) {
        try {
          const img = await ipc.readImageRgba( joinPath( st.projectDir, c.snowMask ) );
          if ( img.width === img.height ) {
            m          = img.width;
            rgba       = new Uint8Array( img.data );
            // coarser than the ground ( made before maps went to a pixel per sample ): brought up to it
            const want = defaultMaskSize( c );
            if ( m < want ) {
              rgba = upsampleMask( rgba, m, want );
              m    = want;
            }
          }
        } catch ( e ) {
          console.warn( "snow mask unreadable", c.snowMask, e );
        }
      }
      if ( !rgba ) {
        rgba = new Uint8Array( m * m * 4 );
        for ( let k = 0; k < m * m; k++ ) rgba[k * 4] = 255;
        four = true;
      }
      if ( extras.snowMask2 && st.projectDir ) {
        try {
          const img = await ipc.readImageRgba( joinPath( st.projectDir, extras.snowMask2 ) );
          // resampled ( nearest ) to the snow mask's size, so one pixel grid serves both
          flow      = new Uint8Array( m * m );
          for ( let j = 0; j < m; j++ )
            for ( let i = 0; i < m; i++ ) flow[j * m + i] = img.data[( Math.floor( ( j * img.height ) / m ) * img.width + Math.floor( ( i * img.width ) / m ) ) * 4];
        } catch ( e ) {
          console.warn( "flow mask unreadable", extras.snowMask2, e );
        }
      }
      const L: PaintLayer = { key: c.key, m, rgba, flow, four, dirty: false, version: 0, pending: "all" };
      layers.set( c.key, L );
      loading.delete( c.key );
      return L;
    } )();
    loading.set( c.key, p );
  }
  return p;
}

/**
 * Forget every layer ( another project was opened ).
**/
export function resetPaint() {
  layers.clear();
  loading.clear();
}

// A 4-channel chunk with markings or powder on it ( grip can't go there: it would show ).
const blockedAt = new WeakMap<PaintLayer, { version: number; v: boolean }>();

export function gripBlocked( L: PaintLayer ) {
  if ( !L.four ) return false;
  const was = blockedAt.get( L );
  if ( was?.version === L.version ) return was.v;
  let v = false;
  for ( let k = 0, n = L.m * L.m * 4; k < n && !v; k += 4 ) v = L.rgba[k + 2] > 2 || L.rgba[k + 3] > 2;
  blockedAt.set( L, { version: L.version, v } );
  return v;
}

/**
 * The chunk now carries markings/powder: G/B/A switch from unused to meaningful ( cleared first ).
**/
export function makeFour( L: PaintLayer ) {
  if ( L.four ) return;
  for ( let k = 0; k < L.m * L.m; k++ ) {
    L.rgba[k * 4 + 1] = 0;
    L.rgba[k * 4 + 2] = 0;
    L.rgba[k * 4 + 3] = 0;
  }
  L.four = true;
}
