// The editor's state: the map being edited and the UI's. Terrain heights live in `terrain` ( terrain/terrain.ts ), not here,
// because they're large typed arrays edited in place.

import { create } from "zustand";
import { type CustomObjectEntry, type ObjectEntry, type SpawnEntry, customName } from "../../core/types";
import { copyPiece } from "../../model/objects";
import { NEW_GROUND } from "../../trails/ground";
import { emptyNet } from "../../trails/trails";
import { history } from "../history";
import { namesFor, pieceName } from "../names";
import { intoActive, newUid, workspaceOf } from "./helpers";
import { loadPaint, loadSculpt, saveSculpt } from "./remembered";
import type { Collection, EditorState, Selection, Undoable } from "./types";

export type { SculptState } from "../../sculpt/brushes";
export { type ToolId, type CameraMode, type LastAdd, type Selection, type Collection, type Toast, type ChunkExtras, type GameLaunch, type EditorState, type TerrainView, type Shading, type AssetTool, type View3d } from "./types";
export { newUid, workspaceOf, unlocked, toHide, paramDefault } from "./helpers";

// Set while the automated self-test runs: it mustn't change what the user's own settings/lists remember.
export const testRun = { active: false };

let toastId = 0;

export const useEditor = create<EditorState>( ( set, get ) => ( {
  projectDir:       null,
  dirty:            false,
  map:              null,
  chunkExtras:      {},
  customObjects:    [],
  shapes:           [],
  trails:           emptyNet(),
  trailGround:      NEW_GROUND,
  trailTool:        { width: 15, follow: true },
  trailHandle:      null,
  shapeKind:        "curve",
  gizmoMode:        "translate",
  scatter:          { picks: [], radius: 8, spacing: 4, scaleJitter: 0.15, followSlope: 0.5, tilt: 4 },
  terrainView:      { slope: false, slopeMin: 10, slopeMax: 45, slopeStep: 0, slopeOpacity: 0.85, hillshade: 0, exaggeration: 2, sunDir: 315, sunHeight: 35, contours: 0, contourOpacity: 0.5, relief: 0.75 },
  library:          null,
  objects:          [],
  spawns:           [],
  collections:      [],
  membership:       {},
  labels:           {},
  activeCollection: null,
  locked:           {},

  selection: [],
  tool:      "select",
  sculpt:    loadSculpt(),
  paint:     loadPaint(),

  placeId:                 null,
  placeEntry:              null,
  alignToSurface:          true,
  defaultPlaceholderScale: 0.5,
  cameraMode:              "orbit",
  centerTab:               "editor",
  gamePoppedOut:           false,
  railEdit:                null,
  modelEdit:               null,
  materialMode:            "object",
  modelTool:               "select",
  selectOp:                "set",
  hiddenInView:            {},
  cursor3d:                [0, 0, 0],
  view3d:                  { shading: "solid", xray: false, gizmos: true, orientation: "global", overlays: { grid: true, faceOrientation: false, stats: false } },
  lastAdd:                 null,
  modelTools:              { snap: false, snapTo: "increment", proportional: false, propRadius: 1, pivot: "median" },

  placeholders:    [],
  userAssets:      [],
  userMaterials:   [],
  assetLibrary:    [],
  libraryDir:      "",
  toasts:          [],
  busy:            null,
  mountainImport:  false,
  splash:          false,
  mapImportChoice: null,
  liftPick:        null,
  lastSavedAt:     null,
  saveState:       "idle",
  gameCopy:        "none",
  gameLaunch:      null,

  setTool:      ( tool      ) => set( { tool      } ),
  setCenterTab: ( centerTab ) => set( { centerTab } ),
  setSculpt: ( p ) =>
    set( ( s ) => {
      const sculpt = { ...s.sculpt, ...p };
      saveSculpt( sculpt );
      return { sculpt };
    } ),
  setPaint: ( p ) =>
    set( ( s ) => {
      const paint = { ...s.paint, ...p };
      if ( !testRun.active )
        try {
          localStorage.setItem( "jibbers.paint.v1", JSON.stringify( paint ) );
        } catch {
          // not remembered
        }
      return { paint };
    } ),
  setBrush: ( p ) =>
    set( ( s ) => {
      const id     = s.sculpt.brush;
      const sculpt = { ...s.sculpt, brushes: { ...s.sculpt.brushes, [id]: { ...s.sculpt.brushes[id], ...p } } };
      saveSculpt( sculpt );
      return { sculpt };
    } ),
  setSelection: ( selection ) => set( { selection } ),
  toast: ( text, kind = "info" ) => {
    const id = ++toastId;
    set( ( s ) => ( { toasts: [...s.toasts, { id, text, kind }] } ) );
    setTimeout( () => set( ( s ) => ( { toasts: s.toasts.filter( ( t ) => t.id !== id ) } ) ), kind === "error" ? 8000 : 3500 );
  },
  setBusy:   ( busy ) => set( { busy } ),
  markDirty: () => set( { dirty: true } ),

  commit( label, next ) {
    const g              = get();
    const prev: Undoable = {
      objects:     g.objects,     spawns:     g.spawns,     customObjects: g.customObjects, map:    g.map,
      collections: g.collections, membership: g.membership, labels:        g.labels,        shapes: g.shapes, locked: g.locked,
    };
    const after: Undoable = { ...prev, ...next };
    set( { ...after, dirty: true } );
    history.push( {
      label,
      undo: () => set( { ...prev,  dirty: true } ),
      redo: () => set( { ...after, dirty: true } ),
    } );
  },

  addObject( o ) {
    get().commit( `Add ${o.id}`, { objects: [...get().objects, o], membership: intoActive( get(), [o.uid] ) } );
    set( { selection: [{ kind: "object", uid: o.uid }] } );
  },

  updateObjects( label, uids, f ) {
    const ids = new Set( uids );
    get().commit( label, { objects: get().objects.map( ( o ) => ( ids.has( o.uid ) ? f( o ) : o ) ) } );
  },

  removeSelected() {
    const sel = get().selection;
    if ( !sel.length ) return;
    const objs = new Set( sel.filter( ( s ) => s.kind === "object" ).map( ( s ) => s.uid ) );
    const sps  = new Set( sel.filter( ( s ) => s.kind === "spawn"  ).map( ( s ) => s.uid ) );
    const cus  = new Set( sel.filter( ( s ) => s.kind === "custom" ).map( ( s ) => s.uid ) );
    get().commit( `Delete ${sel.length} item${sel.length > 1 ? "s" : ""}`, {
      objects:       get().objects.filter( ( o ) => !objs.has( o.uid ) ),
      spawns:        get().spawns.filter( ( s ) => !sps.has( s.uid ) ),
      customObjects: get().customObjects.filter( ( o ) => !cus.has( o.uid ) ),
    } );
    set( { selection: [] } );
  },

  duplicateSelected() {
    const sel                            = get().selection;
    const newObjs:   ObjectEntry[]       = [];
    const newSpawns: SpawnEntry[]        = [];
    const newCustom: CustomObjectEntry[] = [];
    const newSel:    Selection[]         = [];
    for ( const s of sel ) {
      if ( s.kind === "object" ) {
        const o = get().objects.find( ( x ) => x.uid === s.uid );
        if ( !o ) continue;
        const c = { ...structuredClone( o ), uid: newUid() };
        newObjs.push( c );
        newSel.push( { kind: "object", uid: c.uid } );
      } else if ( s.kind === "custom" ) {
        const o = get().customObjects.find( ( x ) => x.uid === s.uid );
        if ( !o ) continue;
        const c = copyPiece( o, newUid() );
        newCustom.push( c );
        newSel.push( { kind: "custom", uid: c.uid } );
      } else {
        const o = get().spawns.find( ( x ) => x.uid === s.uid );
        if ( !o ) continue;
        const c = { ...structuredClone( o ), uid: newUid(), name: `${o.name} copy` };
        newSpawns.push( c );
        newSel.push( { kind: "spawn", uid: c.uid } );
      }
    }
    if ( !newSel.length ) return [];
    const membership = { ...get().membership };
    const named: { uid: string; want: string }[] = [];
    sel.forEach( ( s, k ) => {
      const copy = newSel[k]?.uid;
      if ( !copy ) return;
      if ( membership[s.uid] ) membership[copy] = membership[s.uid];
      const o = get().customObjects.find( ( x ) => x.uid === s.uid );
      if ( o ) named.push( { uid: copy, want: pieceName( get(), o ) } );
    } );
    // ( Blender's: "Cube" copied is "Cube.001" )
    const labels = namesFor( { labels: get().labels, customObjects: [...get().customObjects, ...newCustom] }, named );
    get().commit( "Duplicate", {
      objects:       [...get().objects,       ...newObjs  ],
      spawns:        [...get().spawns,        ...newSpawns],
      customObjects: [...get().customObjects, ...newCustom],
      membership,
      labels,
    } );
    set( { selection: newSel } );
    return newSel.map( ( s ) => s.uid );
  },

  addSpawn( sp ) {
    get().commit( "Add spawn", { spawns: [...get().spawns, sp], membership: intoActive( get(), [sp.uid] ) } );
    set( { selection: [{ kind: "spawn", uid: sp.uid }] } );
  },

  updateSpawn( label, uid, f ) {
    get().commit( label, { spawns: get().spawns.map( ( s ) => ( s.uid === uid ? f( s ) : s ) ) } );
  },

  updateCustom( label, uids, f ) {
    const ids = new Set( uids );
    get().commit( label, { customObjects: get().customObjects.map( ( o ) => ( ids.has( o.uid ) ? f( o ) : o ) ) } );
  },

  addCustom( o, name ) {
    const customObjects = [...get().customObjects, o];
    const labels        = namesFor( { labels: get().labels, customObjects }, [{ uid: o.uid, want: name ?? customName( o ) }] );
    get().commit( `Add ${labels[o.uid]}`, { customObjects, labels, membership: intoActive( get(), [o.uid] ) } );
    set( { selection: [{ kind: "custom", uid: o.uid }] } );
  },

  setMap( label, p ) {
    const m = get().map;
    if ( m ) get().commit( label, { map: { ...m, ...p } } );
  },

  newCollection( parent, name ) {
    const taken = new Set( get().collections.map( ( c ) => c.name ) );
    let n       = name ?? "Collection";
    for ( let k = 2; !name && taken.has( n ); k++ ) n = `Collection ${k}`;
    const c: Collection = { id: `col_${newUid()}`, name: n, parent };
    get().commit( "New collection", { collections: [...get().collections, c] } );
    return c.id;
  },
  renameCollection( id, name ) {
    const n = name.trim();
    if ( !n ) return;
    get().commit( "Rename collection", { collections: get().collections.map( ( c ) => ( c.id === id ? { ...c, name: n } : c ) ) } );
  },
  deleteCollection( id ) {
    const gone = get().collections.find( ( c ) => c.id === id );
    if ( !gone ) return;
    const membership: Record<string, string> = {};
    for ( const [uid, col] of Object.entries( get().membership ) ) {
      if ( col !== id ) membership[uid] = col;
      else if ( gone.parent ) membership[uid] = gone.parent;
    }
    get().commit( `Delete collection ${gone.name}`, {
      collections: get().collections.filter( ( c ) => c.id !== id ).map( ( c ) => ( c.parent === id ? { ...c, parent: gone.parent } : c ) ),
      membership,
    } );
    if ( get().activeCollection === id ) set( { activeCollection: gone.parent } );
  },
  moveToCollection( uids, to ) {
    const membership = { ...get().membership };
    for ( const uid of uids ) {
      if ( to ) membership[uid] = to;
      else delete membership[uid];
    }
    // ( the map's name without its rich-text tags )
    const name = to ? get().collections.find( ( c ) => c.id === to )?.name : get().map?.name.replace( /<[^>]*>/g, "" );
    get().commit( `Move ${uids.length} to ${name ?? "the map"}`, { membership } );
  },
  moveCollection( id, to ) {
    // never into itself or one of its own
    for ( let p = to; p; p = get().collections.find( ( c ) => c.id === p )?.parent ?? null ) if ( p === id ) return;
    get().commit( "Move collection", { collections: get().collections.map( ( c ) => ( c.id === id ? { ...c, parent: to } : c ) ) } );
  },
  renameItem( item, name ) {
    const n = name.trim();
    if ( !n ) return;
    if ( item.kind === "spawn" ) get().commit( "Rename spawn", { spawns: get().spawns.map( ( s ) => ( s.uid === item.uid ? { ...s, name: n } : s ) ) } );
    else if ( item.kind === "shape" ) get().commit( "Rename shape", { shapes: get().shapes.map( ( s ) => ( s.uid === item.uid ? { ...s, name: n } : s ) ) } );
    else get().commit( "Rename", { labels: { ...get().labels, [item.uid]: n } } );
  },
  setActiveCollection: ( activeCollection ) => set( { activeCollection } ),
  setLocked( uids, on ) {
    const locked = { ...get().locked };
    for ( const u of uids ) {
      if ( on ) locked[u] = true;
      else delete locked[u];
    }
    get().commit( `${on ? "Lock" : "Unlock"} ${uids.length > 1 ? `${uids.length} items` : "item"}`, { locked } );
  },
  setHidden( uids, on ) {
    const hiddenInView = { ...get().hiddenInView };
    for ( const u of uids ) {
      if ( on ) hiddenInView[u] = true;
      else delete hiddenInView[u];
    }
    const gone = new Set( on ? uids : [] );
    set( { hiddenInView, selection: get().selection.filter( ( s ) => !gone.has( s.uid ) ) } );
  },
} ) );

// another map workspace ( Layout, Sculpting, Painting ) starts with nothing selected ( Assets has a scene of its own,
// pieces/assetScene.ts )
useEditor.subscribe( ( s, prev ) => {
  if ( s.tool === prev.tool || workspaceOf( s.tool ) === workspaceOf( prev.tool ) || !s.selection.length ) return;
  if ( workspaceOf( s.tool ) === "assets" || workspaceOf( prev.tool ) === "assets" ) return;
  useEditor.setState( { selection: [] } );
} );
