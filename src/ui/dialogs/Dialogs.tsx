import { Icon } from "../widgets/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { ipc, joinPath, type MapListing } from "../../core/ipc";
import { getVersion } from "@tauri-apps/api/app";
import { defaultProjectsDir, forgetRecent, importMap, keepMapChanges, lastSession, newUntitled, openProject, projectForMap, recentProjects, recoverLastSession, untitledDir } from "../../map/project";
import { useEditor } from "../../map/store";
import { plainText, RichText } from "../widgets/RichText";
import { PopupMenu, type MenuItem } from "../widgets/widgets";

export { defaultProjectsDir };

export async function pickAndOpenProject() {
  if ( !( await keepMapChanges() ) ) return;
  const dir = await open( { directory: true, title: "Open a .jbrproj folder", defaultPath: await defaultProjectsDir() } );
  if ( typeof dir === "string" ) await openProject( dir ).catch( ( e ) => useEditor.getState().toast( String( e ), "error" ) );
}

export async function pickAndImportMap( path?: string, name?: string ) {
  const file =
    path ??
    ( await open( { title: "Import a Jibbers map", filters: [{ name: "Jibbers map", extensions: ["jbrmap"] }] } ) );
  if ( typeof file !== "string" ) return;
  const label = name || file.split( /[\\/]/ ).pop()!.replace( /\.jbrmap$/, "" );
  if ( !( await keepMapChanges() ) ) return;
  const dir = await untitledDir( label );
  await importMap( file, dir ).catch( ( e ) => useEditor.getState().toast( `Import failed: ${e}`, "error" ) );
}

/**
 * The start window, as Blender's splash: its picture on top ( the skier leaping out of it ), then what to start ( a map,
 * an asset ) beside the recent projects, and under a line opening one, the session before, and the game's own maps.
 * Over the Design workspace's empty map; a click outside closes it.
**/
export function Splash( { onClose }: { onClose: () => void } ) {
  const [recent,     setRecent    ] = useState( recentProjects() );
  const [canRecover, setCanRecover] = useState( false );
  const [version,    setVersion   ] = useState( "" );
  const [gameMenu,   setGameMenu  ] = useState<{ rect: DOMRect; items: MenuItem[] } | null>( null );
  const gameBtn                     = useRef<HTMLButtonElement>( null );
  useEffect( () => {
    lastSession().then( ( d ) => setCanRecover( !!d ) );
    getVersion().then( setVersion ).catch( () => {} );
    // projects that were deleted or moved drop off the list
    Promise.all( recentProjects().map( async ( r ) => [r, await ipc.pathExists( joinPath( r.dir, "project.json" ) ).catch( () => true )] as const ) ).then( ( rs ) => {
      const gone = rs.filter( ( [, ok] ) => !ok ).map( ( [r] ) => r.dir );
      if ( gone.length ) {
        gone.forEach( forgetRecent );
        setRecent( recentProjects() );
      }
    } );
  }, [] );
  // ( each choice closes the window first )
  const go = ( f: () => unknown ) => () => {
    onClose();
    void Promise.resolve( f() ).catch( ( e ) => useEditor.getState().toast( String( e ), "error" ) );
  };
  const newAssetHere = async () => {
    const { newAsset } = await import( "../../pieces/assetFiles" );
    useEditor.getState().setTool( "model" );
    await newAsset();
  };
  // the game's maps: a project made from one opens that, else it's brought in
  const openGameMap = async ( m: MapListing ) => {
    const dir = await projectForMap( m.id );
    if ( dir ) return ( await keepMapChanges() ) && openProject( dir );
    return pickAndImportMap( m.path, m.name );
  };
  const showGameMaps = async () => {
    const maps              = await ipc.listGameMaps().catch( () => [] as MapListing[] );
    const items: MenuItem[] = maps.length
      ? maps.map( ( m ) => ( { label: plainText( m.name ) || m.id, keys: `${( m.bytes / 1e6 ).toFixed( 0 )} MB`, icon: "game", run: go( () => openGameMap( m ) ) } ) )
      : [{ label: "None found", disabled: true }];
    setGameMenu( { rect: gameBtn.current!.getBoundingClientRect(), items } );
  };
  const item = ( icon: Parameters<typeof Icon>[0]["name"], label: string, run: () => void, keys?: string, disabled?: boolean ) => (
    <button className="bsplash-item" disabled={disabled} onClick={run}>
      <Icon name={icon} size={14} />
      <span className="name">{label}</span>
      {keys && <small>{keys}</small>}
    </button>
  );
  return (
    <div className="splash-back" onMouseDown={( e ) => e.target === e.currentTarget && onClose()}>
      <div className="bsplash">
        <div className="bsplash-art">
          <img src="/splash.png" alt="" draggable={false} />
          <span className="ver">{version && `${version} Beta`}</span>
          <span className="credit">This application is still in beta. Please report any issues.</span>
        </div>
        <div className="bsplash-cols">
          <div>
            <h3>New</h3>
            {item( "mountain", "New Map",        go( newUntitled ), "Ctrl N" )}
            {item( "cube",     "New Asset",      go( newAssetHere ) )}
            {item( "import",   "Real Mountain…", go( () => useEditor.setState( { mountainImport: true } ) ) )}
          </div>
          <div>
            <h3>Recent</h3>
            {recent.length === 0 && <div className="empty">None yet</div>}
            { recent.slice( 0, 5 ).map( ( r ) => (
              <button key={r.dir} className="bsplash-item" title={r.dir} onClick={go( async () => ( await keepMapChanges() ) && openProject( r.dir ) )}>
                <Icon name="folder" size={14} />
                <span className="name"><RichText text={r.name} /></span>
              </button>
            ) ) }
            {item( "search", "More…", go( pickAndOpenProject ) )}
          </div>
        </div>
        <div className="bsplash-cols foot">
          <div>
            {item( "folderOpen", "Open…",                go( pickAndOpenProject ), "Ctrl O"               )}
            {item( "undo",       "Recover Last Session", go( recoverLastSession ), undefined, !canRecover )}
          </div>
          <div>
            <button ref={gameBtn} className="bsplash-item" onClick={() => void showGameMaps()}>
              <Icon name="game" size={14} />
              <span className="name">From the Game…</span>
            </button>
          </div>
        </div>
        <div className="bsplash-note">Not affiliated with or endorsed by the makers of Jibbers.</div>
      </div>
      {gameMenu && <PopupMenu anchor={gameMenu.rect} title="From the Game" items={gameMenu.items} minWidth={300} onClose={() => setGameMenu( null )} />}
    </div>
  );
}
