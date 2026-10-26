// Pieces' paint saved with the project and loaded with it, and the texture the game gets.

import { ipc, joinPath } from "../../core/ipc";
import { encodePng } from "../../core/png";
import type { CustomObjectEntry } from "../../core/types";
import { type PieceTexture, listeners, textures, updateNormal } from "./textures";

const fileOf = ( dir: string, uid: string ) => joinPath( dir, "paint", "models", `${uid}.png` );

/**
 * The project's painted pieces' textures.
**/
export async function loadPieceTextures( dir: string, pieces: CustomObjectEntry[] ) {
  textures.clear();
  for ( const o of pieces ) {
    if ( !o.model?.paint ) continue;
    try {
      const img             = await ipc.readImageRgba( fileOf( dir, o.uid ) );
      const T: PieceTexture = { uid: o.uid, n: img.width, rgba: new Uint8Array( img.data ), ch: {}, normal: null, sig: o.model.paint.sig, dirty: false, version: 0, pending: "all" };
      for ( const ch of ["metallic", "roughness", "height"] as const ) {
        const f = fileOf( dir, `${o.uid}-${ch}` );
        if ( !( await ipc.pathExists( f ).catch( () => false ) ) ) continue;
        const c = await ipc.readImageRgba( f );
        if ( c.width === T.n ) T.ch[ch] = new Uint8Array( c.data );
      }
      textures.set( o.uid, T );
      updateNormal( T );
      T.dirty = false;
      listeners.forEach( ( l ) => l( o.uid, "colour" ) );
    } catch ( e ) {
      console.warn( "piece texture unreadable", o.uid, e );
    }
  }
}

export function resetPieceTextures() {
  const uids = [...textures.keys()];
  textures.clear();
  uids.forEach( ( u ) => listeners.forEach( ( l ) => l( u, "colour" ) ) );
}

export async function savePieceTextures( dir: string, only?: Set<string> ) {
  for ( const T of textures.values() ) {
    if ( !T.dirty || ( only && !only.has( T.uid ) ) ) continue;
    await ipc.writeBinary( fileOf( dir, T.uid ), await encodePng( T.n, T.n, T.rgba ) );
    for ( const [ch, px] of Object.entries( T.ch ) ) if ( px ) await ipc.writeBinary( fileOf( dir, `${T.uid}-${ch}` ), await encodePng( T.n, T.n, px ) );
    T.dirty = false;
  }
}

/**
 * The texture ( or a channel's map ) as the game reads a picture ( its first row the top: v = 1 ).
**/
export function textureForGame( T: PieceTexture, px: Uint8Array = T.rgba ): Uint8Array {
  const out = new Uint8Array( px.length ), row = T.n * 4;
  for ( let y = 0; y < T.n; y++ ) out.set( px.subarray( y * row, ( y + 1 ) * row ), ( T.n - 1 - y ) * row );
  return out;
}
