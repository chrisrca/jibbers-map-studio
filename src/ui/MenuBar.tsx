import { Icon } from "./widgets/icons";
import { redo, undo } from "./UndoHistory";
import { useState, useSyncExternalStore } from "react";
import { history } from "../map/history";
import { exportToGame, newUntitled, playInGame, saveFromMenu, saveProjectAs } from "../map/project";
import { useEditor, workspaceOf, type ToolId } from "../map/store";
import { pickAndOpenProject } from "./dialogs/Dialogs";
import { pickAndImportAny } from "./importAny";
import { saveGameDiagnostics } from "../app/diagnostics";
import { saveLagReport } from "../app/lagWatch";
import { discordShown, setDiscordShown } from "../app/discordPresence";
import { PopupMenu, type MenuItem } from "./widgets/widgets";
import { RichText } from "./widgets/RichText";
import { copySelection, hasClipboard, paste } from "../map/clipboard";

export type { MenuItem };

/**
 * Blender's top bar: the app button ( home screen ), the File / Edit / … pulldowns, the workspace tabs and, on the
 * right, the map and the export / play buttons. Once a menu is open, moving over another title opens that one.
**/
export function TopBar( { onShortcuts }: { onShortcuts: () => void } ) {
  const [open, setOpen] = useState<{ name: string; rect: DOMRect } | null>( null );
  const name            = useEditor( ( s ) => s.map?.name );
  const dirty           = useEditor( ( s ) => s.dirty     );
  // ( the Edit menu's undo and redo steps: drawn again when they change )
  useSyncExternalStore( history.subscribe.bind( history ), () => `${history.canUndo}${history.nextUndo}${history.canRedo}${history.nextRedo}` );

  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: "New Map", icon: "plus",       keys: "Ctrl N", run: () => newUntitled() },
      { label: "Open…",   icon: "folderOpen", keys: "Ctrl O", run: pickAndOpenProject },
      { sep:   true,                      label: "" },
      { label: "Import…",                 icon:  "import", keys: "Ctrl I", title: "Maps (.jbrmap), 3D models and images — or drop them on the window", run: () => pickAndImportAny() },
      { label: "Import a real mountain…", icon:  "mountain", run: () => useEditor.setState( { mountainImport: true } ) },
      { sep:   true,                      label: "" },
      { label: "Save",                    keys:  "Ctrl S", run: () => saveFromMenu() },
      { label: "Save As…",                keys:  "Ctrl Shift S", run: () => saveProjectAs() },
      { label: "Export to game",          icon:  "export", keys: "Ctrl E", run: exportToGame },
      { label: "Export and play",         icon:  "play", keys: "F5", run: playInGame },
    ],
    Edit: [
      { label: history.canUndo ? `Undo ${history.nextUndo}` : "Undo", keys: "Ctrl Z",       disabled: !history.canUndo, run: undo },
      { label: history.canRedo ? `Redo ${history.nextRedo}` : "Redo", keys: "Ctrl Shift Z", disabled: !history.canRedo, run: redo },
      { sep:   true,        label: "" },
      { label: "Copy",      keys:  "Ctrl C", run: () => copySelection() },
      { label: "Paste",     keys:  "Ctrl V", disabled: !hasClipboard(), run: () => paste() },
      { label: "Duplicate", keys:  "Shift D", run: () => useEditor.getState().duplicateSelected() },
      { label: "Delete",    icon:  "trash", keys: "X", run: () => useEditor.getState().removeSelected() },
    ],
    Help: [
      { label: "Splash Screen",          run:     () => useEditor.setState( { splash: true } ) },
      { label: "Keyboard shortcuts",     keys:    "?", run: onShortcuts },
      { label: "Show in Discord Status", checked: discordShown(), run: () => setDiscordShown( !discordShown() ) },
      { sep:   true,                     label:   "" },
      { label: "Save game diagnostics…", run:     () => saveGameDiagnostics() },
      {
        label: "Save a lag report now",
        title: "Saves what the editor and the game are doing right now (the editor also does this by itself when it gets very slow)",
        run:   () => saveLagReport( "asked for from the Help menu" ).then( ( p ) => p && useEditor.getState().toast( `Saved ${p}`, "success" ) ),
      },
    ],
  };

  const title = ( n: string ) => (
    <button
      key={n}
      type="button"
      data-menu={n}
      className={`bpull ${open?.name === n ? "open" : ""}`}
      onMouseDown={( e ) => {
        if ( e.button !== 0 ) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        setOpen( open?.name === n ? null : { name: n, rect } );
      }}
    >
      {n}
    </button>
  );

  return (
    <div className="topbar">
      <button className="app-btn" title="Splash Screen" onClick={() => useEditor.setState( { splash: true } )}>
        <Icon name="logo" size={16} />
      </button>
      {Object.keys( menus ).map( title )}
      { open && (
        <PopupMenu
          anchor={open.rect}
          items={menus[open.name]}
          onClose={() => setOpen( null )}
          onHover={( e ) => {
            const t = ( e.target as HTMLElement | null )?.closest?.<HTMLElement>( ".topbar [data-menu]" );
            const n = t?.dataset.menu;
            if ( t && n && n !== open.name ) setOpen( { name: n, rect: t.getBoundingClientRect() } );
          }}
        />
      ) }
      <span className="sep" />
      <Workspaces />
      <span className="spacer" />
      <span className="scene-box" title="The map (its settings are in the Properties editor's Map tab)">
        <Icon name="mountain" size={14} />
        <span className="nm">{name && <RichText text={name} />}</span>
        {dirty && <span className="dirty-dot" title="Unsaved changes"><Icon name="dot" size={10} /></span>}
      </span>
      <button className="btn" onClick={exportToGame} title="Export to the game's Maps folder (Ctrl+E)">
        <Icon name="export" size={14} /> Export
      </button>
      <button className="btn play" style={{ marginLeft: 4 }} onClick={playInGame} title="Export and play it in the Game tab (F5)">
        <Icon name="play" size={12} /> Play
      </button>
    </div>
  );
}

// The Design workspace's tool when it was last left ( its mode comes back with it ).
let lastDesign: ToolId = "select";

/**
 * Blender-style workspace tabs: Design ( the map, in Object, Sculpt or Paint Mode ), Assets, and the game.
**/
function Workspaces() {
  const tab  = useEditor( ( s ) => s.centerTab );
  const tool = useEditor( ( s ) => s.tool      );
  if ( ["layout", "sculpting", "painting"].includes( workspaceOf( tool ) ) ) lastDesign = tool;
  const go = ( t: "editor" | "game", toolId?: ToolId ) => {
    useEditor.getState().setCenterTab( t );
    if ( toolId ) useEditor.getState().setTool( toolId );
  };
  const on = ( w: ReturnType<typeof workspaceOf> ) => ( tab === "editor" && workspaceOf( tool ) === w ? "on" : "" );
  return (
    <div className="workspaces">
      <button className={on( "layout" ) || on( "sculpting" ) || on( "painting" )} onClick={() => go( "editor", lastDesign )}>Design</button>
      <span className="ws-sep" />
      <button className={on( "assets" )} onClick={() => go( "editor", tool === "material" ? "material" : "model" )}>Assets</button>
      <span className="ws-sep" />
      <button className={tab === "game" ? "on" : ""} onClick={() => go( "game" )}>Game</button>
    </div>
  );
}
