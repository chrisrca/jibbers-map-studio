// Untitled maps and sessions: a new map is untitled until it's saved; on close, new or open, unsaved changes are
// asked about; the last session can be got back.

import { ask } from "../../app/ask";
import { ipc, joinPath } from "../../core/ipc";
import { mapState } from "../../pieces/assetScene";
import { terrain } from "../../terrain/terrain";
import { projectPath } from "../savePath";
import { testRun, useEditor } from "../store";
import { defaultProjectsDir, openProject } from "./open";
import { saveProject } from "./save";
import { uuid } from "./state";

// The studio opens on an untitled, empty map ( as Blender opens on its startup file ): a project of its own in the
// studio's data folder ( "Sessions" ), saved there as you work ( the autosave ), and somewhere of yours the first time
// you save it. "Recover Last Session" opens whatever was open last time, untitled or not.

let sessions: string | null = null;

/**
 * Where untitled maps are kept.
**/
export async function sessionsDir() {
  return ( sessions ??= joinPath( ( await ipc.appInfo() ).dataDir, "Sessions" ) );
}

/**
 * An untitled map's folder ( not saved anywhere of yours yet ).
**/
export const isUntitled = ( dir: string | null | undefined ) => !!dir && !!sessions && dir.toLowerCase().startsWith( sessions.toLowerCase() );

const SESSION_KEY = "lastSession";

// what was open when the studio started ( before this session opened anything )
let previous: string | null = null;

export function rememberSession( dir: string ) {
  if ( testRun.active ) return;
  try {
    localStorage.setItem( SESSION_KEY, dir );
  } catch {
    // storage unavailable
  }
}

/**
 * The map open last time the studio ran, if it's still there.
**/
export async function lastSession(): Promise<string | null> {
  return previous && ( await ipc.pathExists( joinPath( previous, "project.json" ) ).catch( () => false ) ) ? previous : null;
}

/**
 * A new map with nothing in it yet, written to `dir` and opened.
**/
export async function newEmptyProject( dir: string, name: string ) {
  await ipc.saveProject( dir, {
    format:        "jibbers-studio-project",
    version:       1,
    map:           { id: uuid(), name, camStart: [0, 30, -40], allowBackgroundMountains: true, overrideTime: false, dayTime: 1, dayTimeHours: -1, sunAngle: 0 },
    chunks:        [],
    objects:       [],
    spawns:        [],
    customObjects: [],
    library:       null,
    editor:        {},
  } );
  await openProject( dir );
}

/**
 * A folder for a new untitled map ( named after `label` ): kept in the studio's own data until you save it somewhere.
**/
export async function untitledDir( label = "Untitled" ) {
  const stamp = new Date().toISOString().replace( /[:T]/g, "-" ).slice( 0, 19 );
  const safe  = label.replace( /<[^>]*>/g, "" ).replace( /[<>:"/\\|?*]+/g, "_" ).trim() || "Untitled";
  return joinPath( await sessionsDir(), `${safe} ${stamp}.jbrproj` );
}

/**
 * A new untitled map ( File › New Map, and the studio's start ), once what's open is saved or let go.
**/
export async function newUntitled() {
  if ( !( await keepMapChanges() ) ) return;
  await newEmptyProject( await untitledDir(), "Untitled" );
}

/**
 * Before what's open is closed ( a new map, another opened, the studio closed ): with changes not saved, asks whether
 * to save them. Resolves false when that's cancelled ( stay on this map ).
**/
export async function keepMapChanges(): Promise<boolean> {
  const st = useEditor.getState();
  // ( an untitled map with anything on it is never saved yet: its copy kept for recovery isn't yours )
  if ( !st.projectDir || ( !st.dirty && !( isUntitled( st.projectDir ) && hasContent() ) ) ) return true;
  const name = st.map?.name && st.map.name !== "Untitled" ? plainName( st.map.name ) : "this map";
  const a    = await ask( {
    title:   `Save changes to ${name}?`,
    answers: [
      { id: "discard", label: "Don't Save" },
      { id: "save",    label: "Save", primary: true },
    ],
  } );
  if ( !a || a.id === "cancel" ) return false;
  if ( a.id === "discard" ) {
    useEditor.setState( { dirty: false } );
    return true;
  }
  // ( an untitled map asks where to keep it: not picking anywhere is cancelling )
  return saveFromMenu();
}

/**
 * Whether the map has anything on it ( ground, objects, spawns, trails ).
**/
function hasContent() {
  const s = mapState();
  return terrain.chunks.length > 0 || s.objects.length > 0 || s.spawns.length > 0 || s.customObjects.length > 0 || s.shapes.length > 0 || useEditor.getState().trails.nodes.length > 0;
}

const plainName = ( s: string ) => s.replace( /<[^>]*>/g, "" ).trim() || "this map";

/**
 * The studio's start: what was open before noted ( for Recover Last Session ), and an untitled map opened: one left
 * empty last time, or a new one. Other empty ones are cleared away behind it.
**/
export async function startSession() {
  try {
    previous = localStorage.getItem( SESSION_KEY );
  } catch {
    previous = null;
  }
  const base            = await sessionsDir();
  const empty: string[] = [];
  for ( const p of await ipc.findProjects( base ).catch( () => [] ) ) {
    const pr = await ipc.loadProject( p.dir ).catch( () => null );
    if ( pr && !pr.chunks.length && !pr.objects.length && !pr.spawns.length && !pr.customObjects.length ) empty.push( p.dir );
  }
  // ( deleted outright, not waited for: the Recycle Bin took Windows ten seconds a folder, and held the start )
  const reuse = empty.pop();
  for ( const dir of empty ) if ( dir !== previous ) void ipc.removeEmptySession( dir ).catch( () => {} );
  if ( reuse ) await openProject( reuse );
  else await newUntitled();
}

/**
 * Opens the map open last time.
**/
export async function recoverLastSession() {
  const dir = await lastSession();
  if ( !dir ) return useEditor.getState().toast( "Nothing to recover", "info" );
  await openProject( dir );
}

/**
 * Save, from you ( Ctrl+S, File › Save ): an untitled map asks where to keep it first. Resolves whether it was saved.
**/
export async function saveFromMenu(): Promise<boolean> {
  const st = useEditor.getState();
  if ( isUntitled( st.projectDir ) ) return saveProjectAs();
  await saveProject();
  st.toast( "Saved", "success" );
  return true;
}

/**
 * Save As: the map, as it is now, kept in a folder of its own choosing ( a project of yours from here on ).
**/
export async function saveProjectAs(): Promise<boolean> {
  const st   = useEditor.getState();
  const from = st.projectDir;
  if ( !from ) return false;
  const { save } = await import( "@tauri-apps/plugin-dialog" );
  const name     = st.map?.name && st.map.name !== "Untitled" ? plainName( st.map.name ).replace( /[<>:"/\\|?*]+/g, "_" ) : "My Map";
  // ( offered under a name not taken: an existing project's folder offered, the dialog went into it, and the map was
  // saved inside that project )
  const maps     = await defaultProjectsDir();
  let offer      = name;
  for ( let n = 2; await ipc.pathExists( joinPath( maps, `${offer}.jbrproj` ) ).catch( () => false ); n++ ) offer = `${name} ${n}`;
  const picked = await save( { title: "Save map as", defaultPath: joinPath( maps, `${offer}.jbrproj` ), filters: [{ name: "Jibbers Map Studio project", extensions: ["jbrproj"] }] } );
  if ( !picked ) return false;
  // a project is never put inside another one: beside it instead
  const to    = projectPath( picked );
  const parts = to.split( /[\\/]/ );
  if ( to.toLowerCase() !== from.toLowerCase() && ( await ipc.pathExists( to ).catch( () => false ) ) ) {
    const a = await ask( { title: `${parts[parts.length - 1].replace( /\.jbrproj$/i, "" )} already exists. Replace it?`, answers: [{ id: "replace", label: "Replace", primary: true }] } );
    if ( a?.id !== "replace" ) return false;
    await ipc.recycle( to ).catch( () => {} );
  }
  const title = to.split( /[\\/]/ ).pop()!.replace( /\.jbrproj$/i, "" );
  // ( what's open written first: the copy is of the map as it is now )
  if ( st.map?.name === "Untitled" ) useEditor.setState( { map: { ...st.map, name: title }, dirty: true } );
  await saveProject();
  st.setBusy( "Saving…" );
  try {
    await ipc.copyDir( from, to );
  } catch ( e ) {
    st.toast( `Couldn't save there: ${e}`, "error" );
    return false;
  } finally {
    st.setBusy( null );
  }
  await openProject( to );
  if ( isUntitled( from ) ) await ipc.recycle( from ).catch( () => {} );
  useEditor.getState().toast( "Saved", "success" );
  return true;
}
