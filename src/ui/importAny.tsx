// The Import… command, for every kind of file ( files dropped on the window: fileDrop.tsx ):
//  - .jbrmap maps: opened as a project, or ( with a project open ) your choice of that or adding the map's pieces and
//    materials to your asset library;
//  - Unity scenes made with Map-Tools ( .unity ): opened as a project; and .unitypackage files, unpacked: their one scene
//    opened, or one picked of several ( no scene: their models added to My imports );
//  - 3D models ( .glb/.gltf/.obj/.fbx ): added to My imports as meshes;
//  - images ( .png/.jpg ): added to My imports as materials.

import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { ask } from "../app/ask";
import { ipc, joinPath } from "../core/ipc";
import { useEditor } from "../map/store";
import { IMAGE_EXTENSIONS, importDroppedFiles, MODEL_EXTENSIONS } from "../pieces/userAssets";
import { pickAndImportMap } from "./dialogs/Dialogs";
import { addMapToLibrary } from "./fileDrop";
import { Icon } from "./widgets/icons";

const ext  = ( p: string ) => p.split( "."     ).pop()?.toLowerCase() ?? "";
const base = ( p: string ) => p.split( /[\\/]/ ).pop()!.replace( /\.jbrmap$/i, "" );

async function importAny( paths: string[] ) {
  const unity = paths.find( ( p ) => ext( p ) === "unity" || ext( p ) === "unitypackage" );
  if ( unity ) return importUnityFile( unity );
  const maps   = paths.filter( ( p ) => ext( p ) === "jbrmap" );
  const others = paths.filter( ( p ) => ext( p ) !== "jbrmap" );
  const known  = others.filter( ( p ) => MODEL_EXTENSIONS.includes( ext( p ) ) || IMAGE_EXTENSIONS.includes( ext( p ) ) );
  if ( known.length < others.length ) useEditor.getState().toast( `Skipped ${others.length - known.length} file(s) the studio can't import (maps, .glb/.gltf/.obj/.fbx models and .png/.jpg images can be)`, "error" );
  if ( known.length ) await importDroppedFiles( known );
  if ( !maps.length ) return;
  if ( !useEditor.getState().projectDir ) {
    // nothing open: the ( first ) map becomes the project
    await pickAndImportMap( maps[0], base( maps[0] ) );
    return;
  }
  useEditor.setState( { mapImportChoice: maps[0] } );
}

export async function pickAndImportAny() {
  const picked = await open( {
    multiple:    true,
    title:       "Import",
    defaultPath: ( await ipc.appInfo().catch( () => null ) )?.mapsDir,
    filters:     [
      { name: "Maps, models and images",   extensions: ["jbrmap", "unity", "unitypackage", ...MODEL_EXTENSIONS, ...IMAGE_EXTENSIONS] },
      { name: "Jibbers maps",              extensions: ["jbrmap"] },
      { name: "Unity scenes and packages", extensions: ["unity", "unitypackage"] },
      { name: "3D models",               extensions: MODEL_EXTENSIONS },
      { name: "Images (materials)",      extensions: IMAGE_EXTENSIONS },
    ],
  } );
  if ( !picked ) return;
  await importAny( Array.isArray( picked ) ? picked : [picked] );
}

// A scene's name, from its path ( "Assets/Scenes/Park.unity": Park )
const sceneName = ( p: string ) => p.split( /[\\/]/ ).pop()!.replace( /\.unity$/i, "" );

/**
 * A Unity scene opened as a map. A .unitypackage unpacked first ( Map-Tools put in beside it when it hasn't it ): its
 * one scene opened, or the one picked of several; with none, its models added to My imports.
**/
export async function importUnityFile( path: string ): Promise<void> {
  if ( ext( path ) === "unity" ) return pickAndImportMap( path, sceneName( path ) );
  const st = useEditor.getState();
  st.setBusy( "Unpacking the package…" );
  let pkg: Awaited<ReturnType<typeof ipc.openUnityPackage>>;
  try {
    pkg = await ipc.openUnityPackage( path );
  } catch ( e ) {
    st.toast( `Couldn't open the package: ${e}`, "error" );
    return;
  } finally {
    st.setBusy( null );
  }
  for ( const n of pkg.notes ) st.toast( n, "info" );
  if ( !pkg.scenes.length ) {
    if ( pkg.models.length ) return importDroppedFiles( pkg.models );
    return st.toast( "No scenes or models in this package", "info" );
  }
  let scene = pkg.scenes[0];
  if ( pkg.scenes.length > 1 ) {
    const folder = ( s: string ) => s.replace( /\/[^/]*$/, "" );
    const a      = await ask( { title: "Import which scene?", answers: pkg.scenes.map( ( s, i ) => ( { id: s, label: `${sceneName( s )} · ${folder( s )}`, primary: i === 0 } ) ) } );
    if ( !a ) return;
    scene = a.id;
  }
  await pickAndImportMap( joinPath( pkg.dir, scene ), sceneName( scene ) );
}

/**
 * With a project open, a map can be opened instead of it, or have its pieces added to the asset library.
**/
export function MapImportChoice() {
  const path            = useEditor( ( s ) => s.mapImportChoice );
  const [busy, setBusy] = useState( false );
  if ( !path ) return null;
  const close = () => useEditor.setState( { mapImportChoice: null } );
  const name  = base( path );
  return (
    <div className="modal-back" onMouseDown={( e ) => e.target === e.currentTarget && !busy && close()}>
      <div className="modal" style={{ width: "min(520px, 94vw)" }}>
        <h2>Import “{name}”</h2>
        <div className="sub">What should happen with this map?</div>
        <div className="choice-list">
          <button
            className="choice"
            disabled={busy}
            onClick={async () => {
              close();
              // ( yours asked about first: kept, let go, or the import called off )
              await pickAndImportMap( path, name );
            }}
          >
            <Icon name="folderOpen" size={20} />
            <span>
              <b>Open it as a project</b>
              <small>You're asked about saving your current map first.</small>
            </span>
          </button>
          <button
            className="choice"
            disabled={busy}
            onClick={async () => {
              setBusy( true );
              await addMapToLibrary( path );
              setBusy( false );
              close();
            }}
          >
            <Icon name="libraryAdd" size={20} />
            <span>
              <b>Add its pieces to my asset library</b>
              <small>Every custom piece and material the map uses, ready to place in any map.</small>
            </span>
          </button>
        </div>
        {busy && <div className="note"><span className="spinner-inline" /> Adding the pieces (large maps take a few seconds)…</div>}
        <div className="actions">
          <button className="btn" disabled={busy} onClick={close}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
