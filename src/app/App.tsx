import { Icon, type IconName } from "../ui/widgets/icons";
import { redo, undo } from "../ui/UndoHistory";
import { useEffect, useState } from "react";
import type { V3 } from "../core/coords";
import { exportToGame, isUntitled, keepMapChanges, loadLibrary, newUntitled, playInGame, saveFromMenu, saveProject, saveProjectAs, startSession } from "../map/project";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { bootMark } from "../core/ipc";
import { inAssets } from "../pieces/assetScene";
import { saveAsset, saveAssetAs } from "../pieces/assetFiles";
import { toHide, unlocked, useEditor, workspaceOf } from "../map/store";
import { terrain } from "../terrain/terrain";
import { AssetBrowser } from "../ui/panels/AssetBrowser";
import { GameHeader, GamePanel } from "../ui/GamePanel";
import { Splitter } from "../ui/widgets/controls";
import { pickAndOpenProject, Splash } from "../ui/dialogs/Dialogs";
import { MountainImportDialog } from "../ui/dialogs/mountainImport/MountainImport";
import { MapImportChoice, pickAndImportAny } from "../ui/importAny";
import { FileDropZones } from "../ui/fileDrop";
import { TopBar } from "../ui/MenuBar";
import { Outliner } from "../ui/panels/Outliner";
import { PropertiesEditor } from "../ui/panels/Properties";
import { BRUSH_KEYS, modeOf, ToolHeader, TOOLS, toggleSlope } from "../ui/Toolbar";
import type { ToolId } from "../map/store";
import { copySelection, paste } from "../map/clipboard";
import { startLagWatch } from "./lagWatch";
import { startDiscordPresence } from "./discordPresence";
import type { BrushId } from "../sculpt/brushes";
import { AskDialog } from "../ui/dialogs/Ask";
import { getEngine, Viewport } from "../ui/Viewport";

type Stats = { fps: number; tiles: number; visible: number; triangles: number; cursor: V3 | null; slope: number | null };

const SHORTCUTS: [string, string][] = [
  ["V / B / H / P / N",             "Select · Sculpt · Shapes (jumps, curves, copies) · Place · Spawn tool"],
  ["1–9, 0 (sculpt)",               "Draw · Smooth · Flatten · Layer · Clay · Crease · Grab · Smudge · Noise · Mask"],
  ["F / Shift+F (sculpt)",          "Resize the brush / change its strength by moving the mouse (click to keep, Esc to cancel)"],
  ["[  ]",                          "Brush smaller / bigger"],
  ["Ctrl + drag (sculpt)",          "The brush's other direction (lower, enhance, magnify…)"],
  ["Shift + drag (sculpt)",         "Smooth, whatever the brush"],
  ["Ctrl + click (sculpt)",         "Clone: pick the source · Flatten: pick the height"],
  ["Gizmo (Move / Rotate / Scale)", "Pick the mode in the tool header, then drag the handles"],
  ["Ctrl+A / Alt+A",                "Select all / none"],
  ["Shift+D",                       "Duplicate selection"],
  ["Ctrl+C / Ctrl+V",               "Copy / paste (pastes where the mouse points on the terrain; works between maps)"],
  ["Alt+G / Alt+R / Alt+S",         "Drop to ground / clear rotation / reset scale"],
  ["X / Delete",                    "Delete selection"],
  ["F / Home",                      "Frame selection / whole map"],
  ["Middle mouse",                  "Orbit (Shift = pan, Ctrl = zoom)"],
  ["WASD / QE",                     "Move the camera (with the right mouse held: fly; wheel changes speed, Shift = fast)"],
  ["Ctrl+R",                        "Rider-eye view at 1.75 m"],
  ["Ctrl+Z / Ctrl+Shift+Z",         "Undo / redo"],
  ["Ctrl+S / Ctrl+E / F5",          "Save / export / export and play in the Game tab"],
  ["Ctrl+Tab",                      "Switch between the Editor and Game tabs"],
];

// The window, hidden until the first screen's drawn ( tauri.conf.json ), shown.
let shown = false;
function showWindow() {
  if ( shown ) return;
  shown   = true;
  const w = getCurrentWindow();
  void w.show().then( () => w.setFocus() ).then( () => bootMark( "page: window shown" ) ).catch( () => {} );
}
// ( whatever happens on the way, the window's never left hidden )
setTimeout( showWindow, 15000 );

export default function App() {
  const projectDir              = useEditor( ( s ) => s.projectDir     );
  const busy                    = useEditor( ( s ) => s.busy           );
  const mountainImport          = useEditor( ( s ) => s.mountainImport );
  const toasts                  = useEditor( ( s ) => s.toasts         );
  const splash                  = useEditor( ( s ) => s.splash         );
  const [showKeys, setShowKeys] = useState( false );
  const [ready,    setReady   ] = useState( false );

  useEffect( () => {
    loadLibrary()
      .then( async () => {
        bootMark( "page: asset library in" );
        setReady( true );
        // ( a self-test run opens what it tests )
        if ( await invoke<string | null>( "selftest_dir" ) ) {
          showWindow();
          return import( "../selftest/index" ).then( ( m ) => m.maybeRunSelftest() );
        }
        // as Blender opens: an untitled map in Design, and the start window over it
        await startSession();
        bootMark( "page: untitled map open" );
        useEditor.setState( { splash: true } );
        // the window shown once the view behind the start window has been drawn: it opens on the finished screen
        const drawn = getEngine()?.firstDrawn ?? Promise.resolve();
        await Promise.race( [drawn, new Promise( ( r ) => setTimeout( r, 4000 ) )] );
        bootMark( "page: start window drawn" );
        // a new version of the studio, asked about each time it opens
        void import( "./updates" ).then( ( m ) => m.checkForUpdate() );
      } )
      .catch( ( e ) => {
        useEditor.getState().toast( `Couldn't load the asset library: ${e}`, "error" );
        setReady( true );
      } )
      .finally( showWindow );
  }, [] );

  useEffect( () => {
    const onKey = ( e: KeyboardEvent ) => {
      if ( ( e.target as HTMLElement )?.closest?.( "input, textarea, select" ) ) return;
      // ( a key the 3D view used already: Edit Mode's )
      if ( e.defaultPrevented ) return;
      const st = useEditor.getState();
      const k  = e.key.toLowerCase();
      // Edit Mode has Blender's keys: only undo, redo and saving pass through
      if ( st.tool === "model" && st.modelEdit && !( e.ctrlKey && ["z", "y", "s"].includes( k ) ) ) return;
      if ( e.ctrlKey && k === "z" && !e.shiftKey ) { e.preventDefault(); undo(); }
      else if ( e.ctrlKey && ( k === "y" || ( k === "z" && e.shiftKey ) ) ) { e.preventDefault(); redo(); }
      else if ( e.ctrlKey && k === "s" && inAssets() ) { e.preventDefault(); void ( e.shiftKey ? saveAssetAs() : saveAsset() ); }
      else if ( e.ctrlKey && k === "s" ) { e.preventDefault(); if ( st.projectDir ) void ( e.shiftKey ? saveProjectAs() : saveFromMenu() ); }
      else if ( e.ctrlKey && k === "i" ) { e.preventDefault(); pickAndImportAny(); }
      else if ( e.ctrlKey && k === "e" ) { e.preventDefault(); if ( st.projectDir ) exportToGame(); }
      else if ( e.ctrlKey && k === "n" ) { e.preventDefault(); void newUntitled(); }
      else if ( e.ctrlKey && k === "o" ) { e.preventDefault(); pickAndOpenProject(); }
      else if ( e.ctrlKey && k === "r" ) { e.preventDefault(); if ( getEngine()?.nav.enterRider() ) useEditor.setState( { cameraMode: "rider" } ); }
      else if ( e.ctrlKey && k === "l" ) { e.preventDefault(); toggleSlope(); }
      else if ( e.ctrlKey && e.key === "Tab" ) { e.preventDefault(); if ( st.projectDir ) st.setCenterTab( st.centerTab === "game" ? "editor" : "game" ); }
      else if ( e.key === "F5" ) { e.preventDefault(); if ( st.projectDir ) playInGame(); }
      else if ( e.altKey  && k === "a" ) { e.preventDefault(); st.setSelection( [] ); }
      else if ( e.altKey  && k === "h" ) { e.preventDefault(); if ( st.projectDir ) st.setHidden( Object.keys( st.hiddenInView ), false ); }
      // ( Ctrl+A, not A: A is the camera's, with W, S and D )
      else if ( e.ctrlKey && !e.shiftKey && k === "a" ) { if ( st.projectDir && st.tool === "select" ) { e.preventDefault(); selectAll(); } }
      else if ( e.ctrlKey && !e.shiftKey && k === "c" ) { if ( st.projectDir && copySelection() ) e.preventDefault(); }
      else if ( e.ctrlKey && !e.shiftKey && k === "v" ) { if ( st.projectDir ) { e.preventDefault(); paste(); } }
      else if ( e.ctrlKey || e.altKey || e.metaKey ) return;
      else if ( e.key === "?" ) setShowKeys( true );
      // ( in Assets, Esc only cancels what's under way, as Blender's: it never leaves the workspace; with the Trails
      // tool it lets go of the picked point, ending the run being laid )
      else if ( e.key === "Escape" && workspaceOf( st.tool ) !== "assets" ) { st.setSelection( [] ); if ( st.tool !== "select" && st.tool !== "trail" ) st.setTool( "select" ); }
      else if ( e.key === "Home" ) getEngine()?.nav.frameAll();
      // Blender's H in Object Mode: the selection hidden in the view ( Shift: everything else ); in Terrain Mode it's
      // the shapes' key
      else if ( k === "h" && st.projectDir && modeOf( st.tool ) === "object" ) st.setHidden( toHide( st, e.shiftKey ), true );
      else if ( !e.shiftKey && st.projectDir ) {
        // ( Design's tool keys: in the Assets workspace a key never takes you out of it )
        const tool = workspaceOf( st.tool ) === "assets" ? undefined : TOOLS.find( ( t ) => t.key.toLowerCase() === k );
        // ( B into Terrain Mode starts on the trails; in it, the brushes )
        if ( tool ) st.setTool( tool.id === "sculpt" && workspaceOf( st.tool ) !== "sculpting" ? "trail" : tool.id );
        const brush = ( Object.entries( BRUSH_KEYS ) as [BrushId, string][] ).find( ( [, key] ) => key === k )?.[0];
        if ( st.tool === "paint" && /^[1-5]$/.test( k ) ) st.setPaint( { tool: ( ["snow", "marking", "powder", "grip", "flow"] as const )[+k - 1] } );
        else if ( brush && ( st.tool === "sculpt" || st.tool === "shape" ) ) {
          st.setTool( "sculpt" );
          st.setSculpt( { brush } );
        }
      }
    };
    window.addEventListener( "keydown", onKey );
    const beforeUnload = ( e: BeforeUnloadEvent ) => {
      if ( useEditor.getState().dirty ) e.preventDefault();
    };
    window.addEventListener( "beforeunload", beforeUnload );
    return () => {
      window.removeEventListener( "keydown",      onKey        );
      window.removeEventListener( "beforeunload", beforeUnload );
    };
  }, [] );

  return (
    <>
      {ready && projectDir ? <Editor onShortcuts={() => setShowKeys( true )} /> : <div className="app-blank" />}
      {splash && projectDir && <Splash onClose={() => useEditor.setState( { splash: false } )} />}
      {mountainImport && <MountainImportDialog onClose={() => useEditor.setState( { mountainImport: false } )} />}
      <MapImportChoice />
      <FileDropZones />
      <AskDialog />
      { showKeys && (
        <div className="modal-back" onMouseDown={() => setShowKeys( false )}>
          <div className="modal" style={{ width: 640 }}>
            <h2>Keyboard shortcuts</h2>
            <div className="props" style={{ gridTemplateColumns: "200px 1fr", marginTop: 14 }}>
              { SHORTCUTS.map( ( [k, d] ) => (
                <div key={k} style={{ display: "contents" }}>
                  <b>{k}</b>
                  <span>{d}</span>
                </div>
              ) ) }
            </div>
          </div>
        </div>
      ) }
      { busy && (
        <div className="busy">
          <div className="box">
            <div className="spinner" />
            {busy}
          </div>
        </div>
      ) }
      <div className="reports">
        { toasts.map( ( t ) => (
          <div key={t.id} className={`report ${t.kind}`}>
            <Icon name={t.kind === "success" ? "check" : t.kind === "error" ? "error" : "info"} size={14} />
            <span>{t.text}</span>
          </div>
        ) ) }
      </div>
    </>
  );
}

function Editor( { onShortcuts }: { onShortcuts: () => void } ) {
  const [sideW,     setSideW    ] = useState( 360 );
  const [assetsH,   setAssetsH  ] = useState( 236 );
  const [outlinerH, setOutlinerH] = useState( 250 );
  const [stats, setStats]         = useState<Stats | null>( null );
  const centerTab                 = useEditor( ( s ) => s.centerTab );
  // Modeling and Materials work on pieces on their own: no asset browser there
  const onStage                   = useEditor( ( s ) => s.tool === "model" || s.tool === "material" );

  useEffect( () => startLagWatch(),        [] );
  useEffect( () => startDiscordPresence(), [] );

  // an untitled map is kept in the studio's own data every 30 seconds ( recovered with Recover Last Session ); a map of
  // yours is only written when you save it
  useEffect( () => {
    const t = setInterval( () => {
      const st = useEditor.getState();
      if ( st.dirty && isUntitled( st.projectDir ) ) saveProject().catch( () => {} );
    }, 30_000 );
    return () => clearInterval( t );
  }, [] );
  // closing the studio: unsaved changes asked about first
  useEffect( () => {
    let off: ( () => void ) | null = null;
    void getCurrentWindow()
      .onCloseRequested( async ( e ) => {
        if ( !( await keepMapChanges() ) ) e.preventDefault();
      } )
      .then( ( f ) => ( off = f ) );
    return () => off?.();
  }, [] );

  const tri = stats ? ( stats.triangles > 1e6 ? `${( stats.triangles / 1e6 ).toFixed( 1 )}M` : `${( stats.triangles / 1e3 ).toFixed( 0 )}k` ) : "";
  return (
    <div className="app">
      <TopBar onShortcuts={onShortcuts} />
      <div className="areas" style={{ gridTemplateColumns: `minmax(0, 1fr) var(--gap) ${sideW}px` }}>
        <div className="col" style={{ gridTemplateRows: onStage ? "minmax(0, 1fr)" : `minmax(0, 1fr) var(--gap) ${assetsH}px` }}>
          <div className="area view3d">
            {centerTab === "game" ? <GameHeader /> : <ToolHeader />}
            <div className="stage">
              <Viewport onStats={setStats} hidden={centerTab === "game"} />
              <GamePanel active={centerTab === "game"} />
            </div>
          </div>
          { !onStage && (
            <>
              <Splitter dir="v" onDrag={( d ) => setAssetsH( ( h ) => Math.min( 700, Math.max( 120, h - d ) ) )} />
              <div className="area assets">
                <AssetBrowser />
              </div>
            </>
          ) }
        </div>
        <Splitter dir="h" onDrag={( d ) => setSideW( ( w ) => Math.min( 720, Math.max( 260, w - d ) ) )} />
        <div className="col" style={{ gridTemplateRows: `${outlinerH}px var(--gap) minmax(0, 1fr)` }}>
          <div className="area outliner">
            <Outliner />
          </div>
          <Splitter dir="v" onDrag={( d ) => setOutlinerH( ( h ) => Math.min( 800, Math.max( 80, h + d ) ) )} />
          <div className="area">
            <PropertiesEditor />
          </div>
        </div>
      </div>
      <div className="statusbar">
        <Hints />
        <span className="spacer" />
        { stats?.cursor && (
          <span className="stats">
            {stats.cursor[0].toFixed( 1 )}, {stats.cursor[1].toFixed( 1 )}, {stats.cursor[2].toFixed( 1 )} m
            {stats.slope !== null && ` · ${stats.slope.toFixed( 1 )}°`}
          </span>
        ) }
        <SaveStatus />
        <span className="stats">{terrain.chunks.length} chunks · {stats?.visible ?? 0}/{stats?.tiles ?? 0} tiles · {tri} tris{stats ? ` · ${stats.fps.toFixed( 0 )} fps` : ""}</span>
      </div>
    </div>
  );
}

/**
 * Everything that can be selected: features, spawns and custom pieces ( Blender's A ).
**/
function selectAll() {
  const st = useEditor.getState();
  st.setSelection( unlocked( st, [
    ...st.objects.map( ( o ) => ( { kind: "object" as const, uid: o.uid } ) ),
    ...st.spawns.map( ( o ) => ( { kind: "spawn"  as const, uid: o.uid } ) ),
    ...st.customObjects.map( ( o ) => ( { kind: "custom" as const, uid: o.uid } ) ),
  ].filter( ( x ) => !st.hiddenInView[x.uid] ) ) );
}

type Hint                           = [IconName | string, string];
const MOUSE_NAV: Hint[]             = [["mouseMiddle", "Orbit"], ["mouseRight", "Fly"]];
const HINTS: Record<ToolId, Hint[]> = {
  select:   [["mouseLeft", "Select"                            ], ["Shift",      "Add to selection"   ], ...MOUSE_NAV, ["Shift D", "Duplicate"], ["X", "Delete"], ["F", "Frame"]],
  sculpt:   [["mouseLeft", "Sculpt"                            ], ["Ctrl",       "Invert"             ], ["Shift", "Smooth"], ["F", "Size"], ["Shift F", "Strength"], ...MOUSE_NAV],
  shape:    [["mouseLeft", "Draw a shape, or click one to edit"], ["Del",        "Remove"             ], ...MOUSE_NAV],
  trail:    [["mouseLeft", "Add point"                         ], ["Ctrl click", "Join / insert point"], ["F", "Join two"], ["X", "Delete"], ["Esc", "Deselect"], ...MOUSE_NAV],
  paint:    [["mouseLeft", "Paint"                             ], ["Ctrl",       "Other way"          ], ["[ ]", "Size"], ["1-5", "Snow, Markings, Powder, Grip, Corduroy"], ["X", "Swap colours"], ...MOUSE_NAV],
  place:    [["mouseLeft", "Place"                             ], ["V",          "Done"               ], ...MOUSE_NAV],
  spawn:    [["mouseLeft", "Add a spawn"                       ], ...MOUSE_NAV],
  scatter:  [["mouseLeft", "Scatter"                           ], ["Ctrl",       "Take away"          ], ["Ctrl click", "Pick pieces in the asset browser"], ...MOUSE_NAV],
  model:    [["mouseLeft", "Select"                            ], ["Shift A",    "Add"                ], ["Tab", "Edit Mode"], ...MOUSE_NAV],
  material: [["mouseLeft", "Select, or paint in Texture Paint" ], ["Ctrl",       "Erase"              ], ["[ ]", "Size"], ...MOUSE_NAV],
};
const EDIT_MODE: Hint[] = [
  ["mouseLeft", "Select"], ["Alt",    "Loop"    ], ["1 2 3",      "Vertex, Edge, Face"], ["G R S", "Move, Rotate, Scale"], ["E", "Extrude"], ["I", "Inset"],
  ["Ctrl B",    "Bevel" ], ["Ctrl R", "Loop Cut"], ["mouseRight", "Menu"              ], ["Tab",   "Object Mode"        ],
];
const RIDER: Hint[] = [["WASD", "Walk"], ["Shift", "Run"], ["Space", "Jump"], ["Esc", "Leave rider view"]];

/**
 * Blender's status bar hints: what the mouse buttons and keys do right now.
**/
function Hints() {
  const tool  = useEditor( ( s ) => s.tool                   );
  const rider = useEditor( ( s ) => s.cameraMode === "rider" );
  const game  = useEditor( ( s ) => s.centerTab  === "game"  );
  const edit  = useEditor( ( s ) => s.modelEdit              );
  // an operator running in Edit Mode says what it's doing instead
  if ( edit?.status ) return <div className="hints"><span className="hint-item">{edit.status}</span></div>;
  const list: Hint[] = game ? [["Ctrl Tab", "Back to the editor"]] : rider ? RIDER : tool === "model" && edit ? EDIT_MODE : HINTS[tool];
  return (
    <div className="hints">
      { list.map( ( [k, text], i ) => (
        <span key={i} className="hint-item">
          {k.startsWith( "mouse" ) ? <Icon name={k as IconName} size={15} /> : <kbd>{k}</kbd>}
          {text}
        </span>
      ) ) }
    </div>
  );
}

/**
 * Status bar: is the project saved, and is the game's copy of the map up to date? Click to save / update.
**/
function SaveStatus() {
  const dirty  = useEditor( ( s ) => s.dirty                  );
  const saving = useEditor( ( s ) => s.saveState === "saving" );
  const at     = useEditor( ( s ) => s.lastSavedAt            );
  const game   = useEditor( ( s ) => s.gameCopy               );
  const time   = at ? new Date( at ).toLocaleTimeString( [], { hour: "numeric", minute: "2-digit" } ) : null;
  return (
    <>
      <button
        className={`status-btn ${dirty ? "dirty" : ""}`}
        title="Ctrl+S · changes are also saved automatically every 30 seconds"
        onClick={() => saveFromMenu()}
      >
        {saving ? "Saving…" : dirty ? <><Icon name="dot" size={8} /> Unsaved</> : time ? `Saved ${time}` : "Saved"}
      </button>
      <button
        className={`status-btn ${game !== "current" ? "dirty" : ""}`}
        title="The copy of this map in the game's Maps folder. Play or Ctrl+E updates it."
        onClick={() => exportToGame()}
      >
        <Icon name="game" size={14} />
        {game === "none" ? "Not in game yet" : game === "stale" ? "Game copy out of date" : "Game copy current"}
      </button>
    </>
  );
}
