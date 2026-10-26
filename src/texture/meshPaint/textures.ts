// A piece's painted textures ( colour, metallic, roughness, height ): held by piece, told of their changes, read as
// the game's shader reads them.

import type { CustomObjectEntry } from "../../core/types";
import { useEditor } from "../../map/store";
import type { TileStore } from "../../paint/engine/stroke";

// What a piece's texture paints: its colour, or ( grey, as the game's shader reads them ) how metal, how rough, and
// bumps ( height, made into a normal map ).
export type Channel = "colour" | "metallic" | "roughness" | "height";

/**
 * A grey channel's key in the map's library.
**/
export const channelKey = ( uid: string, ch: Exclude<Channel, "colour"> ) => `Models/${uid}/${ch === "height" ? "normal" : ch}`;

export interface PieceTexture {
  uid:     string;
  n:       number;
  rgba:    Uint8Array;
  // the grey channels painted so far ( RGBA, grey )
  ch:      Partial<Record<Exclude<Channel, "colour">, Uint8Array>>;
  // the normal map made from the height ( RGB )
  normal:  Uint8Array | null;
  // the shape it's painted on
  sig:     string;
  dirty:   boolean;
  version: number;
  pending: [number, number, number, number] | "all" | null;
}

export const textures = new Map<string, PieceTexture>();

export const pieceTexture = ( uid: string ) => textures.get( uid ) ?? null;

/**
 * A piece's paint put back as it was kept ( an asset opened in the Assets workspace ): its colour and grey maps.
**/
export function putPieceTexture( uid: string, sig: string, n: number, rgba: Uint8Array, ch: PieceTexture["ch"] ) {
  const T: PieceTexture = { uid, n, rgba, ch, normal: null, sig, dirty: true, version: 0, pending: "all" };
  textures.set( uid, T );
  updateNormal( T );
  changed( T );
  for ( const c of Object.keys( ch ) as Exclude<Channel, "colour">[] ) changed( T, undefined, c );
}

type Listener = ( uid: string, ch: Channel, rect?: [number, number, number, number] ) => void;

export const listeners = new Set<Listener>();

export const onPieceTexture = ( l: Listener ) => {
  listeners.add( l );
  return () => void listeners.delete( l );
};

// What changed in each channel since the renderer last uploaded it ( the colour's is `pending` ).
export const pendingOf = new WeakMap<PieceTexture, Partial<Record<Channel, [number, number, number, number] | "all">>>();

export function changed( T: PieceTexture, rect?: [number, number, number, number], ch: Channel = "colour" ) {
  if ( ch === "colour" ) {
    const p   = T.pending;
    T.pending = !rect || p === "all" ? "all" : p ? [Math.min( p[0], rect[0] ), Math.min( p[1], rect[1] ), Math.max( p[2], rect[2] ), Math.max( p[3], rect[3] )] : rect;
  } else {
    const all = pendingOf.get( T ) ?? {};
    const p   = all[ch];
    all[ch]   = !rect || p === "all" ? "all" : p ? [Math.min( p[0], rect[0] ), Math.min( p[1], rect[1] ), Math.max( p[2], rect[2] ), Math.max( p[3], rect[3] )] : rect;
    pendingOf.set( T, all );
  }
  T.version++;
  T.dirty = true;
  useEditor.setState( { dirty: true } );
  listeners.forEach( ( l ) => l( T.uid, ch, rect ) );
}

/**
 * A channel's pixels ( the grey ones made the first time, from the piece's material, so nothing changes to look at ).
**/
export function channelPixels( T: PieceTexture, ch: Channel, o?: CustomObjectEntry ): Uint8Array {
  if ( ch === "colour" ) return T.rgba;
  let px = T.ch[ch];
  if ( !px ) {
    const m = o?.parts[0]?.materials[0];
    const v = ch === "metallic" ? ( m?.metallic ?? 0 ) : ch === "roughness" ? 1 - ( m?.smoothness ?? 0.3 ) : 0.5;
    const b = Math.round( Math.max( 0, Math.min( 1, v ) ) * 255 );
    px      = new Uint8Array( T.n * T.n * 4 );
    for ( let k = 0; k < T.n * T.n; k++ ) px.set( [b, b, b, 255], k * 4 );
    T.ch[ch] = px;
    if ( o ) materialFor( o, ch );
    changed( T, undefined, ch );
  }
  return px;
}

/**
 * The piece's material set to read a grey channel from its own map ( its slider values to nothing: the map is it ).
**/
export function materialFor( o: CustomObjectEntry, ch: Exclude<Channel, "colour"> ) {
  const st  = useEditor.getState();
  const key = channelKey( o.uid, ch );
  useEditor.setState( {
    customObjects: st.customObjects.map( ( x ) =>
      x.uid !== o.uid
        ? x
        : {
            ...x,
            parts: x.parts.map( ( p, i ) =>
              i !== 0
                ? p
                : {
                    ...p,
                    materials: p.materials.map( ( m ) =>
                      ch === "metallic" ? { ...m, metallic_tex: key, metallic: 0 } : ch === "roughness" ? { ...m, roughness_tex: key, smoothness: 0 } : { ...m, normal_tex: key },
                    ),
                  },
            ),
          },
    ),
  } );
}

/**
 * The piece's texture ( a channel of it ) as the paint engine's image ( one tile ).
**/
export function storeOf( T: PieceTexture, ch: Channel = "colour" ): TileStore {
  return {
    size:    T.n,
    get:     ( tx, ty ) => ( tx === 0 && ty === 0 ? ( ch === "colour" ? T.rgba : T.ch[ch] ?? null ) : null ),
    make:    () => channelPixels( T, ch ),
    changed: ( _tx, _ty, rect ) => changed( T, rect, ch ),
  };
}

/**
 * The normal map of the height ( bumps `strength` deep across a texel's worth ), made again after a height stroke.
**/
export function updateNormal( T: PieceTexture, strength = 2 ) {
  const h = T.ch.height;
  if ( !h ) return;
  const n  = T.n, out = T.normal ?? new Uint8Array( n * n * 4 );
  const at = ( x: number, y: number ) => h[( Math.min( n - 1, Math.max( 0, y ) ) * n + Math.min( n - 1, Math.max( 0, x ) ) ) * 4] / 255;
  for ( let y = 0; y < n; y++ )
    for ( let x = 0; x < n; x++ ) {
      const dx = ( at( x + 1, y ) - at( x - 1, y ) ) * strength, dy = ( at( x, y + 1 ) - at( x, y - 1 ) ) * strength;
      const l  = Math.hypot( dx, dy, 1 );
      out.set( [Math.round( ( -dx / l * 0.5 + 0.5 ) * 255 ), Math.round( ( -dy / l * 0.5 + 0.5 ) * 255 ), Math.round( ( 1 / l * 0.5 + 0.5 ) * 255 ), 255], ( y * n + x ) * 4 );
    }
  T.normal = out;
  changed( T, undefined, "height" );
}
