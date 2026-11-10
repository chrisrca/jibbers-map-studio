// The Assets workspace's files, as Blender's File menu has them: an asset opened ( from the library, or a file ) to
// work on, models imported into it, the whole of it saved back to My assets ( over itself, or as a new one ) as one
// piece — every object in the scene, joined or not — or exported as a .glb. Pieces placed on a map from an asset
// remember it; saving over the asset brings them up to date ( where they are, as they're turned and scaled ), and a
// map opened later catches up with what was saved meanwhile. What the library file can't hold ( the scene's objects
// one by one, the models behind modelled pieces, their paint ) is kept beside it in the studio's data folder, so the
// asset opens again as the objects it was made of.

import { create } from "zustand";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { encodePng } from "../core/png";
import { ipc, joinPath } from "../core/ipc";
import { deltaBetween, transformCustom } from "../core/transform";
import { arr3, customName, xyz, type CustomObjectEntry } from "../core/types";
import { newUid } from "../map/store";
import { MODEL_EXTENSIONS } from "./userAssets";
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
  // as it was saved from here: its objects one by one ( the models behind them, their paint )
  const side  = await sideDir( pathOf( id ) );
  const kept  = await keptScene( side );
  // ( only while it's the asset file it was saved with )
  const stamp = ( await ipc.fileStamp( pathOf( id ) ).catch( () => null ) )?.[1] ?? 0;
  if ( kept && Math.abs( kept.stamp - stamp ) < 2000 ) {
    // its textures and meshes into the project ( what the materials use besides the paint )
    await ipc.placeLibraryMesh( st.projectDir, id ).catch( () => null );
    useEditor.setState( { library: useEditor.getState().library ?? "assets/library.jbrmap" } );
    getEngine()?.customR.reloadLibrary();
    for ( const k of kept.objects ) {
      const p = kept.paint[k.uid];
      if ( !p ) continue;
      const img                            = async ( f: string ) => new Uint8Array( ( await ipc.readImageRgba( joinPath( side, f ) ) ).data );
      const ch: Record<string, Uint8Array> = {};
      for ( const c of p.ch ) ch[c] = await img( `${p.file}-${c}.png` );
      putPieceTexture( k.uid, p.sig, p.n, await img( `${p.file}.png` ), ch );
    }
    setAssetScene( kept.objects );
    if ( kept.labels ) useEditor.setState( { labels: kept.labels } );
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
  const ref = useAssetFile.getState().ref;
  const a   = await ask( { title: "Save as New Asset", text: { label: "Name", value: ref?.name ?? sceneName() }, answers: [{ id: "save", label: "Save", primary: true, usesText: true }, { id: "cancel", label: "Cancel" }] } );
  if ( a?.id === "save" && a.text.trim() ) await saveAsset( a.text.trim() );
}

/**
 * What the scene's called before it's saved: its one object's name, else the first's.
**/
function sceneName() {
  const st = useEditor.getState(), o = assetObjects()[0];
  return o ? st.labels[o.uid] || customName( o ) : "Asset";
}

// The scene as it was saved, beside the asset: its objects one by one, their names, and each modelled one's paint.
interface KeptScene {
  objects: CustomObjectEntry[];
  labels?: Record<string, string>;
  stamp:   number;
  paint:   Record<string, { file: string; sig: string; n: number; ch: string[] }>;
}

async function keptScene( side: string ): Promise<KeptScene | null> {
  const scene = await ipc.readText( joinPath( side, "scene.json" ) ).then( ( t ) => JSON.parse( t ) as KeptScene ).catch( () => null );
  if ( scene ) return scene;
  // ( one saved before the whole scene was: the model behind its one piece, and its paint )
  const one = await ipc.readText( joinPath( side, "model.json" ) ).then( ( t ) => JSON.parse( t ) as { object: CustomObjectEntry; stamp: number; paint?: { sig: string; n: number; ch: string[] } } ).catch( () => null );
  if ( !one?.object.model ) return null;
  const paint: KeptScene["paint"] = {};
  if ( one.paint ) paint[one.object.uid] = { ...one.paint, file: "paint", ch: one.paint.ch };
  // ( its channels were kept as "<channel>.png" )
  if ( one.paint ) for ( const c of one.paint.ch ) await ipc.readBinary( joinPath( side, `${c}.png` ) ).then( ( b ) => ipc.writeBinary( joinPath( side, `paint-${c}.png` ), new Uint8Array( b ) ) ).catch( () => {} );
  return { objects: [one.object], stamp: one.stamp, paint };
}

/**
 * The scene's objects as the one piece the asset is: one of them as it is; several, joined as they stand ( their
 * parts, colliders and lights together, the piece's pivot the scene's origin, its settings the first's ). Their
 * grind rails go as the colliders they made ( the objects themselves are kept beside the asset, to open again ).
**/
export function scenePiece( objects: CustomObjectEntry[] ): Omit<CustomObjectEntry, "uid"> {
  if ( objects.length === 1 ) {
    const o   = objects[0];
    const cur = { pos: arr3( o.position ), rot: arr3( o.rotation ), scl: arr3( o.scale ) };
    const { uid: _u, model: _m, source: _s, ...one } = transformCustom( o, deltaBetween( cur, { ...cur, pos: [0, 0, 0] } ) );
    return one;
  }
  const first = objects[0];
  let groups  = 0;
  const parts = objects.flatMap( ( o ) => {
    const base = groups;
    groups    += o.lod_groups.length;
    return o.parts.map( ( p ) => ( p.lod_group_index >= 0 ? { ...p, lod_group_index: p.lod_group_index + base } : p ) );
  } );
  const { uid: _u, model: _m, source: _s, rail: _r, kitColliders: _k, scenery: _sc, tree: _t, hue: _h, adjust: _a, ...rest } = first;
  return {
    ...rest,
    position:   xyz( [0, 0, 0] ),
    rotation:   xyz( [0, 0, 0] ),
    scale:      xyz( [1, 1, 1] ),
    parts,
    colliders:  objects.flatMap( ( o ) => o.colliders ),
    lights:     objects.flatMap( ( o ) => o.lights ),
    lod_groups: objects.flatMap( ( o ) => o.lod_groups ),
  };
}

/**
 * Saves the asset — the whole scene, as one piece: over the one it was opened from ( `asNew`: as a new one, by that
 * name ).
**/
export async function saveAsset( asNew?: string ): Promise<boolean> {
  const st = useEditor.getState(), ref = useAssetFile.getState().ref;
  // ( a piece's own Hue is baked into its paint at export: kept as it is in the asset, and in the scene beside it )
  const objects = assetObjects();
  if ( !st.projectDir || !objects.length ) {
    st.toast( "Nothing to save: the scene is empty", "info" );
    return false;
  }
  const over = !asNew && ref && editable( ref.id ) ? ref.path : undefined;
  const name = asNew ?? ref?.name ?? sceneName();
  st.setBusy( "Saving the asset…" );
  try {
    // their meshes and paint into the project's library first ( what the asset file copies )
    await updateModelMeshes( objects );
    const object = scenePiece( objects );
    const info   = await ipc.saveCustomAsAsset( st.projectDir, useEditor.getState().library ?? "assets/library.jbrmap", object, name, over );
    const id     = over ? ref!.id : `user:${info.path}`;
    // what the library file can't hold, beside it: the objects one by one, and the modelled ones' paint
    const side   = await sideDir( info.path );
    const paint: KeptScene["paint"] = {};
    for ( const [k, o] of objects.entries() ) {
      const T = o.model ? pieceTexture( o.uid ) : null;
      if ( !T ) continue;
      const file = `paint${k}`;
      await ipc.writeBinary( joinPath( side, `${file}.png` ), await encodePng( T.n, T.n, T.rgba ) );
      for ( const [c, px] of Object.entries( T.ch ) ) if ( px ) await ipc.writeBinary( joinPath( side, `${file}-${c}.png` ), await encodePng( T.n, T.n, px ) );
      paint[o.uid] = { file, sig: T.sig, n: T.n, ch: Object.keys( T.ch ).filter( ( c ) => T.ch[c as keyof typeof T.ch] ) };
    }
    const stamp  = ( await ipc.fileStamp( info.path ).catch( () => null ) )?.[1] ?? 0;
    const labels = Object.fromEntries( objects.map( ( o ) => [o.uid, useEditor.getState().labels[o.uid] ?? customName( o )] ) );
    // ( a single plain piece is the asset file itself: nothing beside it to keep )
    if ( objects.length > 1 || objects[0].model ) await ipc.writeText( joinPath( side, "scene.json" ), JSON.stringify( { objects, labels, stamp, paint } satisfies KeptScene ) );
    else await ipc.writeText( joinPath( side, "scene.json" ), "" ).catch( () => {} );
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

// a file's name, without its folder
const baseName = ( p: string ) => p.split( /[\\/]/ ).pop() ?? p;

/**
 * An asset file opened ( Blender's File › Open ): picked from My assets, or anywhere ( one of the app's opens as it
 * is, saved as a new one ).
**/
export async function openAssetFile() {
  const mine = joinPath( ( await ipc.appInfo() ).dataDir, "Asset Library" );
  const file = await openDialog( { title: "Open Asset", defaultPath: mine, filters: [{ name: "Assets", extensions: ["jbrasset"] }] } );
  if ( typeof file !== "string" ) return;
  const inMine = file.replace( /\\/g, "/" ).toLowerCase().startsWith( mine.replace( /\\/g, "/" ).toLowerCase() );
  const name   = baseName( file ).replace( /\.jbrasset$/i, "" );
  await openAsset( `${inMine ? "user" : "app"}:${file}`, name );
}

/**
 * Model files ( .glb, .gltf, .obj, .fbx ) brought into the scene as they are ( Blender's File › Import ): each an
 * object of its own at `at` ( the 3D cursor ), not kept in your library. Picked when none are given.
**/
export async function importModels( files?: string[], at?: [number, number, number] ) {
  const st = useEditor.getState();
  if ( !st.projectDir ) return;
  if ( !files ) {
    const got = await openDialog( { title: "Import", multiple: true, filters: [{ name: "Models", extensions: MODEL_EXTENSIONS }] } );
    if ( !got ) return;
    files = Array.isArray( got ) ? got : [got];
  }
  const here = at ?? st.cursor3d;
  st.setBusy( files.length > 1 ? `Importing ${files.length} models…` : "Importing…" );
  try {
    for ( const f of files ) {
      try {
        const got = await ipc.importModelToProject( st.projectDir, f );
        useEditor.setState( { library: got.library } );
        getEngine()?.customR.reloadLibrary();
        const o = { ...( got.object as Omit<CustomObjectEntry, "uid"> ), uid: newUid() } as CustomObjectEntry;
        useEditor.getState().addCustom( transformCustom( o, deltaBetween( { pos: [0, 0, 0], rot: [0, 0, 0], scl: [1, 1, 1] }, { pos: here, rot: [0, 0, 0], scl: [1, 1, 1] } ) ), baseName( f ).replace( /\.[^.]+$/, "" ) );
      } catch ( e ) {
        useEditor.getState().toast( `Couldn't import ${baseName( f )}: ${e}`, "error" );
      }
    }
  } finally {
    useEditor.getState().setBusy( null );
  }
}

/**
 * The scene written out as a .glb ( Blender's File › Export › glTF ): the selected objects when any are, else all.
**/
export async function exportGlb() {
  const st      = useEditor.getState();
  const picked  = new Set( st.selection.filter( ( s ) => s.kind === "custom" ).map( ( s ) => s.uid ) );
  const objects = assetObjects().filter( ( o ) => !picked.size || picked.has( o.uid ) );
  if ( !st.projectDir || !objects.length ) return st.toast( "Nothing to export: the scene is empty", "info" );
  const name = useAssetFile.getState().ref?.name ?? sceneName();
  const out  = await saveDialog( { title: "Export glTF", defaultPath: `${name}.glb`, filters: [{ name: "glTF Binary", extensions: ["glb"] }] } );
  if ( !out ) return;
  st.setBusy( "Exporting…" );
  try {
    await updateModelMeshes( objects );
    const n = await ipc.exportGlb( st.projectDir, useEditor.getState().library ?? "assets/library.jbrmap", objects.map( ( { uid: _u, model: _m, ...o } ) => o ), name, out );
    st.toast( `Exported ${n} mesh${n === 1 ? "" : "es"} to ${baseName( out )}`, "success" );
  } catch ( e ) {
    st.toast( `Couldn't export: ${e}`, "error" );
  } finally {
    useEditor.getState().setBusy( null );
  }
}
