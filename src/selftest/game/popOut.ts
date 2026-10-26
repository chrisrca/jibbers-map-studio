import { getEngine } from "../../ui/Viewport";
import { invoke } from "@tauri-apps/api/core";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/popout ): the game popped out into its own window stays a normal, full-speed
 * window whatever tab the studio shows, and comes back in ( and out of the way again ) when asked. No input is driven.
**/
export async function popOutSelftest( dir: string ) {
  try {
    const { playInGame    } = await import( "../../map/project"  );
    const { saveLagReport } = await import( "../../app/lagWatch" );
    await openProject( joinPath( dir, "..", "inputlag", "map.jbrproj" ) );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await playInGame();
    const t0 = performance.now();
    while ( performance.now() - t0 < 180000 && ( await ipc.gameStatus() ) !== "embedded" ) await sleep( 1000 );
    await sleep( 35000 );
    const state = async ( label: string ) => {
      await sleep( 6000 ); // the game link writes its status every 2 s
      const path   = await saveLagReport( `popout: ${label}` );
      const report = path ? await ipc.readText( path ).catch( () => "" ) : "";
      const f      = joinPath( dir, "diag.txt" );
      await invoke( "save_game_diagnostics", { path: f, frontend: "" } ).catch( () => {} );
      const diag = await ipc.readText( f ).catch( () => "" );
      const pick = ( text: string, re: RegExp ) => text.split( /\r?\n/ ).filter( ( l ) => re.test( l ) ).join( " | " );
      log( `${label}: ${pick( report, /game says/ )} | ${pick( diag, /^embedded:|^now:|^game window found:/ ).slice( 0, 300 )} | status ${await ipc.gameStatus()}` );
    };
    useEditor.getState().setCenterTab( "game" );
    await state( "in the Game tab" );
    // what the "Pop out" button does
    ipc.gamePopOut();
    useEditor.setState( { gamePoppedOut: true } );
    await state( "popped out, Game tab" );
    useEditor.getState().setCenterTab( "editor" );
    await state( "popped out, Layout" );
    // "Bring it back in here"
    useEditor.setState( { gamePoppedOut: false } );
    useEditor.getState().setCenterTab( "game" );
    await state( "brought back in" );
    useEditor.getState().setCenterTab( "editor" );
    await state( "back in, Layout" );
    await ipc.gameClose().catch( () => {} );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
