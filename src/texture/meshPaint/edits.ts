// Edits to a piece's paint: each one undo step.

import type { CustomObjectEntry } from "../../core/types";
import { history } from "../../map/history";
import type { ModelData } from "../../model/build";
import { prepare } from "./carry";
import { type Channel, type PieceTexture, changed, channelPixels, textures, updateNormal } from "./textures";

/**
 * Records a change to a piece's texture ( made by `f` ) as one undo step.
**/
export function editTexture( uid: string, label: string, f: ( T: PieceTexture ) => void ) {
  const T = textures.get( uid );
  if ( !T ) return;
  const before = T.rgba.slice();
  f( T );
  const after = T.rgba.slice();
  const put   = ( px: Uint8Array ) => {
    const t = textures.get( uid );
    if ( !t ) return;
    t.rgba = px.slice();
    changed( t );
  };
  changed( T );
  history.push( { label, undo: () => put( before ), redo: () => put( after ), bytes: before.byteLength * 2 } );
}

export function recordStroke( uid: string, label: string, before: Uint8Array, ch: Channel = "colour" ) {
  const T = textures.get( uid );
  if ( !T ) return;
  const after = channelPixels( T, ch ).slice();
  const put   = ( px: Uint8Array ) => {
    const t = textures.get( uid );
    if ( !t ) return;
    if ( ch === "colour" ) t.rgba = px.slice();
    else t.ch[ch] = px.slice();
    if ( ch === "height" ) updateNormal( t );
    changed( t, undefined, ch );
  };
  history.push( { label, undo: () => put( before ), redo: () => put( after ), bytes: before.byteLength * 2 } );
}

/**
 * Several channels of a piece's texture changed together ( a generator's ), as one undo step.
**/
export function editChannels( o: CustomObjectEntry & { model: ModelData }, label: string, chs: Channel[], f: ( px: Partial<Record<Channel, Uint8Array>>, T: PieceTexture ) => void ) {
  const { T }                                    = prepare( o );
  const px: Partial<Record<Channel, Uint8Array>> = {}, before: Partial<Record<Channel, Uint8Array>> = {};
  for ( const ch of chs ) {
    px[ch]     = channelPixels( T, ch, o );
    before[ch] = px[ch]!.slice();
  }
  f( px, T );
  const after: Partial<Record<Channel, Uint8Array>> = {};
  for ( const ch of chs ) after[ch] = px[ch]!.slice();
  const put = ( from: Partial<Record<Channel, Uint8Array>> ) => {
    const t = textures.get( o.uid );
    if ( !t ) return;
    for ( const ch of chs ) {
      if ( ch === "colour" ) t.rgba = from[ch]!.slice();
      else t.ch[ch] = from[ch]!.slice();
      changed( t, undefined, ch );
    }
    if ( chs.includes( "height" ) ) updateNormal( t );
  };
  for ( const ch of chs ) changed( T, undefined, ch );
  if ( chs.includes( "height" ) ) updateNormal( T );
  history.push( { label, undo: () => put( before ), redo: () => put( after ), bytes: chs.length * T.rgba.byteLength * 2 } );
}
