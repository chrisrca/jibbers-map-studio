// Opening a project ( or a map, made one ), the library with it, and a new one.

import { documentDir } from "@tauri-apps/api/path";
import { ipc, joinPath } from "../../core/ipc";
import { type CustomObjectEntry, type PlaceholderInfo, type Project, isScenery } from "../../core/types";
import { resetPaint } from "../../paint/ground";
import { leaveAssetsForNewMap } from "../../pieces/assetScene";
import { fitMissingParts, fixJibs, refreshGameLook, undoUpMethodSwitch } from "../../pieces/library";
import { recoverRail, withRail } from "../../pieces/rail";
import type { NewMapOptions } from "../../terrain/generate";
import { type Shape, resetShapes } from "../../terrain/shapes/shapes";
import { type ChunkInit, terrain } from "../../terrain/terrain";
import { loadPieceTextures, resetPieceTextures } from "../../texture/meshPaint";
import { loadTrailData } from "../../trails/edits";
import { history } from "../history";
import { holdLoading } from "../loadingHolds";
import { useEditor } from "../store";
import { recentProjects, rememberRecent } from "./recent";
import { isUntitled, rememberSession } from "./sessions";
import { type EditorData, chunkVersion, meta, savedArray, savedVersion, uidAt, usedUids, uuid } from "./state";

export async function loadLibrary() {
  const info         = await ipc.appInfo();
  const text         = await ipc.readText( joinPath( info.libraryDir, "placeholders", "placeholders.json" ) );
  const placeholders = JSON.parse( text ) as PlaceholderInfo[];
  useEditor.setState( { libraryDir: info.libraryDir, placeholders } );
  return info;
}

function resetHistoryAfterLoad() {
  history.clear();
  savedVersion.clear();
  chunkVersion.clear();
  savedArray.clear();
  terrain.chunks.forEach( ( c ) => {
    chunkVersion.set( c.key, 1 );
    savedVersion.set( c.key, 1 );
    savedArray.set( c.key, c.heights );
  } );
}

/**
 * Where projects are made, unless you pick somewhere else.
**/
export async function defaultProjectsDir() {
  return joinPath( await documentDir(), "Jibbers Maps" );
}

async function applyProject( dir: string, p: Project, heights: Float32Array[] ) {
  const editor     = ( p.editor ?? {} ) as EditorData;
  meta.exported    = editor.exported;
  meta.sourceMapId = editor.sourceMapId;
  meta.realTerrain = editor.realTerrain;
  usedUids.clear();
  const inits: ChunkInit[] = p.chunks.map( ( c, i ) => ( {
    key:      c.key,
    position: c.position,
    size:     c.size,
    res:      c.resolution,
    heights:  heights[i],
    snowMask: c.snowMask ?? null,
  } ) );
  const chunkExtras: Record<string, object> = {};
  for ( const c of p.chunks ) {
    const { key, position: _p, size: _s, resolution: _r, heights: _h, snowMask: _m, ...extras } = c;
    chunkExtras[key] = extras;
  }
  // uids are editor-only ( the map format has none ): they come back from the editor data, in the same order
  const customObjects = ( ( p.customObjects ?? [] ) as Omit<CustomObjectEntry, "uid">[] ).map( ( o, i ) => ( { ...o, uid: uidAt( editor.customUids, i ) } ) );
  const locked        = editor.locked ?? customObjects.filter( isScenery ).map( ( o ) => o.uid );
  useEditor.setState( {
    projectDir:       dir,
    map:              p.map,
    objects:          p.objects,
    spawns:           p.spawns,
    customObjects,
    locked:           Object.fromEntries( locked.map( ( u ) => [u, true as const] ) ),
    hiddenInView:     Object.fromEntries( ( editor.hidden ?? [] ).map( ( u ) => [u, true as const] ) ),
    collections:      editor.collections ?? [],
    membership:       editor.membership ?? {},
    labels:           editor.labels ?? {},
    activeCollection: null,
    library:          p.library ?? null,
    chunkExtras,
    selection:        [],
    dirty:            false,
  } );
  resetPaint();
  await loadPieceTextures( dir, useEditor.getState().customObjects );
  terrain.setChunks( inits );
  // shapes are already baked into the saved heights; edits from here on re-apply relative to that
  resetShapes();
  useEditor.setState( { shapes: ( editor.shapes ?? [] ) as Shape[] } );
  await loadTrailData( dir, editor.trails );

  resetHistoryAfterLoad();
  // "intended up" put back where the first version of the jib fix had changed it
  if ( ( editor.jibFix ?? 0 ) < 2 ) {
    const undo = undoUpMethodSwitch( useEditor.getState().customObjects );
    if ( undo.fixed ) {
      useEditor.setState( { customObjects: undo.list, dirty: true } );
      useEditor.getState().toast( `Put "Intended up" back to Local Body on ${undo.fixed} piece${undo.fixed > 1 ? "s" : ""} (an earlier version had changed it)`, "info" );
    }
  }
  // pieces whose rail an earlier save dropped ( only its capsules were left ): rail and own collider recovered
  const lost = useEditor.getState().customObjects.map( ( o ) => recoverRail( o ) );
  if ( lost.some( Boolean ) ) {
    useEditor.setState( { customObjects: useEditor.getState().customObjects.map( ( o, i ) => lost[i] ?? o ), dirty: true } );
    const n = lost.filter( Boolean ).length;
    useEditor.getState().toast( `Got back the grind rail on ${n} piece${n > 1 ? "s" : ""} (saving had been dropping it, and the piece's own collider with it)`, "info" );
  }
  // rails without their parts fitted: once the pieces have loaded
  void fitMissingParts();
  // grind rails' colliders made again from their rails ( what they're made of has changed: see pieces/rail.ts )
  const railed = useEditor.getState().customObjects.map( ( o ) => ( o.rail ? withRail( o, o.rail ) : o ) );
  const remade = railed.filter( ( o, i ) => JSON.stringify( o.colliders ) !== JSON.stringify( useEditor.getState().customObjects[i].colliders ) ).length;
  if ( remade ) useEditor.setState( { customObjects: railed, dirty: true } );
  // pieces that look the same flipped over, left flipped ( scaling through zero used to do it ): turned back up
  const jibs = fixJibs( useEditor.getState().customObjects );
  if ( jibs.fixed ) {
    useEditor.setState( { customObjects: jibs.list, dirty: true } );
    useEditor.getState().toast( `Turned ${jibs.fixed} piece${jibs.fixed > 1 ? "s" : ""} the right way up: no different to look at, but the game was reading the underside as the top`, "info" );
  }
  // pieces placed from assets saved over since
  void import( "../../pieces/assetFiles" ).then( ( m ) => m.catchUpPlaced() ).then( ( n ) => n && useEditor.getState().toast( `Updated ${n} piece${n > 1 ? "s" : ""} from assets saved since`, "info" ) );
}

export async function openProject( dir: string ) {
  leaveAssetsForNewMap();
  const st = useEditor.getState();
  st.setBusy( "Opening project…" );
  try {
    const p       = await ipc.loadProject( dir );
    const heights = await Promise.all( p.chunks.map( async ( c ) => new Float32Array( await ipc.readBinary( joinPath( dir, c.heights ) ) ) ) );
    await applyProject( dir, p, heights );
    // ( an untitled map isn't a project of yours yet: not in the recent list )
    if ( !isUntitled( dir ) ) rememberRecent( dir, p.map.name, p.map.id );
    rememberSession( dir );
    // is the map in the game, and as new as the project?
    const inGame = await ipc.pathExists( joinPath( ( await ipc.appInfo() ).mapsDir, `${p.map.id}.jbrmap` ) ).catch( () => false );
    useEditor.setState( { lastSavedAt: null, gameCopy: inGame ? "current" : "none" } );
  } finally {
    st.setBusy( null );
  }
  // pieces with an older build of the game's look get the current one ( under the loading veil )
  holdLoading( refreshGameLook().catch( ( e ) => console.warn( "game look refresh failed", e ) ) );
}

/**
 * Back to the home screen: saves what changed, lets go of the game window, and closes the project.
**/
export async function closeProject() {
  leaveAssetsForNewMap();
  const st = useEditor.getState();
  if ( !st.projectDir ) return;
  await ipc.gameRelease().catch( () => {} );
  history.clear();
  resetShapes();
  resetPaint();
  resetPieceTextures();
  terrain.setChunks( [] );
  useEditor.setState( {
    projectDir:  null, map: null, objects: [], spawns: [], customObjects: [], shapes: [], selection: [],
    collections: [], membership: {}, labels: {}, activeCollection: null, locked: {}, hiddenInView: {},
    library:     null, chunkExtras: {}, dirty: false, centerTab: "editor", tool: "select", gameCopy: "none", lastSavedAt: null,
  } );
}

/**
 * The project made from ( or for ) the game map with this id, if there is one on disk: in the recent list, or in the
 * projects folder ( the recent list only keeps the last few; going by it alone, opening an older one's map imported it
 * all over again as a copy ).
**/
export async function projectForMap( mapId: string ): Promise<string | null> {
  for ( const r of recentProjects() ) if ( r.mapId === mapId && ( await ipc.pathExists( joinPath( r.dir, "project.json" ) ).catch( () => false ) ) ) return r.dir;
  const found = await projectsOnDisk();
  return ( found.find( ( p ) => p.mapId === mapId ) ?? found.find( ( p ) => p.sourceMapId === mapId ) )?.dir ?? null;
}

/**
 * The projects in the projects folder.
**/
export async function projectsOnDisk() {
  return ipc.findProjects( await defaultProjectsDir() ).catch( () => [] );
}

export async function importMap( mapPath: string, dir: string ) {
  const st = useEditor.getState();
  st.setBusy( "Importing map…" );
  try {
    const p = await ipc.importJbrmap( mapPath, dir );
    // which map it came from: it's this project's own until it's saved as a new one
    await ipc.saveProject( dir, { ...p, editor: { ...( p.editor as object | undefined ), sourceMapId: p.map.id } } );
  } finally {
    st.setBusy( null );
  }
  await openProject( dir );
}

export async function newProject( dir: string, name: string, opts: NewMapOptions, _onProgress?: ( f: number ) => void ) {
  const st = useEditor.getState();
  st.setBusy( "Generating terrain…" );
  try {
    const { layout } = opts;
    await ipc.generateProject( dir, name, uuid(), {
      radius: layout.radius, ringRes:  layout.ringRes, chunkSize:   layout.chunkSize,
      base:   opts.base,     slopeDeg: opts.slopeDeg,  heightRange: opts.heightRange, seed: opts.seed,
    } );
  } finally {
    st.setBusy( null );
  }
  await openProject( dir );
  rememberRecent( dir, name );
}
