// The Assets workspace's files: an asset opened from the library to work on, saved back to My assets ( over itself,
// or as a new one ). Pieces placed on a map from an asset remember it; saving over the asset brings them up to date
// ( where they are, as they're turned and scaled ), and a map opened later catches up with what was saved meanwhile.
// What the library file can't hold ( the model behind a modelled piece, its paint ) is kept beside it in the studio's
// data folder, so the asset opens again as the model it was.

import { create } from "zustand";
import { encodePng } from "../core/png";
import { ipc, joinPath } from "../core/ipc";
import { deltaBetween, transformCustom } from "../core/transform";
import { arr3, customName, type CustomObjectEntry } from "../core/types";
import { ask } from "../app/ask";
import { recoverRail } from "./rail";
import { assetObjects, inAssets, mapState, setAssetScene, setMapCustomObjects } from "./assetScene";
import { pieceTexture, putPieceTexture } from "../texture/meshPaint";
import { history } from "../map/history";
import { useEditor } from "../map/store";
import { loadUserAssets } from "./userAssets";
import { loadLibrary, placeEntry } from "./library";
import { updateModelMeshes } from "../model/export";
import { getEngine } from "../ui/Viewport";

// The asset the scene was opened from ( null: a new one, not saved yet ).
export const useAssetFile = create<{ ref: { id: string; path: string; name: string } | null }>( () => ( { ref: null } ) );

const pathOf   = ( id: string ) => id.slice( id.indexOf( ":" ) + 1 );
// the asset scene as it was opened or last saved ( whether there's anything to lose )
let saved      = "[]";
const snapshot = () => JSON.stringify( assetObjects() );

/**
 * Whether the asset scene has changes a new one would lose: asks to save them; false: cancelled.
**/
async function keepChanges() {
  if ( !assetObjects().length || snapshot() === saved ) return true;
  const name = useAssetFile.getState().ref?.name ?? "the asset";
  const a    = await ask( { title: `Save the changes to “${name}”?`, answers: [{ id: "save", label: "Save", primary: true }, { id: "drop", label: "Don't Save" }, { id: "cancel", label: "Cancel" }] } );
  if ( !a || a.id === "cancel" ) return false;
  if ( a.id === "save" ) return saveAsset();
  return true;
}
const editable = ( id: string ) => id.startsWith( "user:" );

/**
 * Where an asset's model and paint are kept ( the studio's data folder, by the asset's file ).
**/
export async function sideDir( path: string ) {
  let h = 2166136261;
  for ( const c of path.toLowerCase() ) h = Math.imul( h ^ c.charCodeAt( 0 ), 16777619 );
  return joinPath( ( await ipc.appInfo() ).dataDir, "Asset edits", ( h >>> 0 ).toString( 16 ) );
}

/**
 * A library asset opened in the Assets workspace, in place of what was there.
**/
export async function openAsset( id: string, name: string ) {
  const st = useEditor.getState();
  if ( !st.projectDir || !( await keepChanges() ) ) return;
  if ( !inAssets() ) st.setTool( "model" );
  setAssetScene( [] );
  useAssetFile.setState( { ref: { id, path: pathOf( id ), name } } );
  // as it was saved from here: the model behind it, and its paint
  const side  = await sideDir( pathOf( id ) );
  const kept  = await ipc.readText( joinPath( side, "model.json" ) ).then( ( t ) => JSON.parse( t ) as { object: CustomObjectEntry; stamp: number; paint?: { sig: string; n: number; ch: string[] } } ).catch( () => null );
  // ( only while it's the asset file it was saved with )
  const stamp = ( await ipc.fileStamp( pathOf( id ) ).catch( () => null ) )?.[1] ?? 0;
  if ( kept?.object.model && Math.abs( kept.stamp - stamp ) < 2000 ) {
    // its textures and meshes into the project ( what the materials use besides the paint )
    await ipc.placeLibraryMesh( st.projectDir, id ).catch( () => null );
    const o = kept.object;
    if ( kept.paint ) {
      const img                            = async ( f: string ) => new Uint8Array( ( await ipc.readImageRgba( joinPath( side, f ) ) ).data );
      const ch: Record<string, Uint8Array> = {};
      for ( const c of kept.paint.ch ) ch[c] = await img( `${c}.png` );
      putPieceTexture( o.uid, kept.paint.sig, kept.paint.n, await img( "paint.png" ), ch );
    }
    setAssetScene( [o] );
  } else {
    // a piece as the library has it ( Tab makes it a model to edit )
    await placeEntry( id, [0, 0, 0] );
    history.clear();
  }
  saved = snapshot();
  getEngine()?.nav.frameAll();
}

/**
 * A new, empty asset.
**/
export async function newAsset() {
  if ( !( await keepChanges() ) ) return;
  useAssetFile.setState( { ref: null } );
  setAssetScene( [] );
  saved = snapshot();
}

/**
 * Saves the asset as a new one in My assets, by a name asked for.
**/
export async function saveAssetAs() {
  const ref = useAssetFile.getState().ref, o = assetPiece();
  const st  = useEditor.getState();
  const a   = await ask( { title: "Save as New Asset", text: { label: "Name", value: ref?.name ?? ( o ? st.labels[o.uid] || customName( o ) : "" ) }, answers: [{ id: "save", label: "Save", primary: true, usesText: true }, { id: "cancel", label: "Cancel" }] } );
  if ( a?.id === "save" && a.text.trim() ) await saveAsset( a.text.trim() );
}

/**
 * The piece the asset is: the active one ( the last picked ), else the only one.
**/
function assetPiece(): CustomObjectEntry | null {
  const st     = useEditor.getState();
  const active = [...st.selection].reverse().find( ( s ) => s.kind === "custom" );
  return st.customObjects.find( ( o ) => o.uid === active?.uid ) ?? ( st.customObjects.length === 1 ? st.customObjects[0] : null );
}

/**
 * Saves the asset: over the one it was opened from ( `asNew`: as a new one, by that name ).
**/
export async function saveAsset( asNew?: string ): Promise<boolean> {
  const st = useEditor.getState(), ref = useAssetFile.getState().ref;
  const o  = assetPiece();
  if ( !st.projectDir || !o ) {
    st.toast( "Select the piece to save", "info" );
    return false;
  }
  const over = !asNew && ref && editable( ref.id ) ? ref.path : undefined;
  const name = asNew ?? ref?.name ?? ( st.labels[o.uid] || customName( o ) );
  st.setBusy( "Saving the asset…" );
  try {
    // its meshes and paint into the project's library first ( what the asset file copies )
    await updateModelMeshes( [o] );
    const cur      = { pos: arr3( o.position ), rot: arr3( o.rotation ), scl: arr3( o.scale ) };
    const atOrigin = transformCustom( o, deltaBetween( cur, { ...cur, pos: [0, 0, 0] } ) );
    const { uid: _u, model: _m, source: _s, ...object } = atOrigin;
    const info     = await ipc.saveCustomAsAsset( st.projectDir, useEditor.getState().library ?? "assets/library.jbrmap", object, name, over );
    const id       = over ? ref!.id : `user:${info.path}`;
    // what the library file can't hold, beside it
    const side     = await sideDir( info.path ), T = pieceTexture( o.uid );
    let paint: { sig: string; n: number; ch: string[] } | undefined;
    if ( T && o.model ) {
      await ipc.writeBinary( joinPath( side, "paint.png" ), await encodePng( T.n, T.n, T.rgba ) );
      for ( const [c, px] of Object.entries( T.ch ) ) if ( px ) await ipc.writeBinary( joinPath( side, `${c}.png` ), await encodePng( T.n, T.n, px ) );
      paint = { sig: T.sig, n: T.n, ch: Object.keys( T.ch ).filter( ( c ) => T.ch[c as keyof typeof T.ch] ) };
    }
    const stamp = ( await ipc.fileStamp( info.path ).catch( () => null ) )?.[1] ?? 0;
    if ( o.model ) await ipc.writeText( joinPath( side, "model.json" ), JSON.stringify( { object: atOrigin, stamp, paint } ) );
    useAssetFile.setState( { ref: { id, path: pathOf( id ), name: info.name } } );
    await Promise.all( [loadUserAssets(), loadLibrary()] );
    // pieces placed from it on this map, brought up to date
    const n = over ? await refreshPlaced( id ) : 0;
    saved   = snapshot();
    st.toast( `Saved “${info.name}”${n ? `, and the ${n} placed on the map` : ""}`, "success" );
    return true;
  } catch ( e ) {
    st.toast( `Couldn't save the asset: ${e}`, "error" );
    return false;
  } finally {
    useEditor.getState().setBusy( null );
  }
}

/**
 * The map's pieces placed from an asset made over in its new form, each where it was; how many.
**/
async function refreshPlaced( id: string ) {
  const placed = mapState().customObjects.filter( ( o ) => o.source?.id === id );
  const dir    = useEditor.getState().projectDir;
  if ( !placed.length || !dir ) return 0;
  // as the asset file has it, what it uses copied into the map
  const got = await ipc.refreshLibraryMesh( dir, id );
  useEditor.setState( { library: got.library } );
  const fresh = got.object as Omit<CustomObjectEntry, "uid">;
  const stamp = ( await ipc.fileStamp( pathOf( id ) ).catch( () => null ) )?.[1] ?? Date.now();
  const byUid = new Map( placed.map( ( o ) => {
    const at    = { pos: arr3( o.position ), rot: arr3( o.rotation ), scl: arr3( o.scale ) };
    const base  = recoverRail( { ...( fresh as CustomObjectEntry ), uid: o.uid } ) ?? { ...( fresh as CustomObjectEntry ), uid: o.uid };
    const moved = transformCustom( base, deltaBetween( { pos: [0, 0, 0], rot: arr3( base.rotation ), scl: arr3( base.scale ) }, at ) );
    return [o.uid, { ...moved, uid: o.uid, source: { id, stamp } }] as const;
  } ) );
  getEngine()?.customR.reloadLibrary();
  setMapCustomObjects( mapState().customObjects.map( ( o ) => byUid.get( o.uid ) ?? o ) );
  return placed.length;
}

/**
 * A map just opened: its pieces from assets saved since they were placed, brought up to date; how many.
**/
export async function catchUpPlaced() {
  const st = useEditor.getState();
  if ( !st.projectDir ) return 0;
  const ids = [...new Set( st.customObjects.map( ( o ) => o.source?.id ).filter( ( x ): x is string => !!x && editable( x ) ) )];
  let n     = 0;
  for ( const id of ids ) {
    const stamp = ( await ipc.fileStamp( pathOf( id ) ).catch( () => null ) )?.[1];
    if ( !stamp || !st.customObjects.some( ( o ) => o.source?.id === id && o.source.stamp < stamp - 1000 ) ) continue;
    n += await refreshPlaced( id ).catch( () => 0 );
  }
  return n;
}
