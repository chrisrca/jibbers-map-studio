import { getEngine } from "../../ui/Viewport";
import { invoke } from "@tauri-apps/api/core";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/replay ): Play while the game is already running ( from Layout, then from the Game
 * tab ) starts it afresh inside the studio, not popped out on its own; then Pop out and back. No input is driven.
**/
export async function replaySelftest( dir: string ) {
  try {
    const { playInGame    } = await import( "../../map/project"  );
    const { saveLagReport } = await import( "../../app/lagWatch" );
    await openProject( joinPath( dir, "..", "inputlag", "map.jbrproj" ) );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    const embedded = async () => {
      const t0 = performance.now();
      while ( performance.now() - t0 < 180000 && ( await ipc.gameStatus() ) !== "embedded" ) await sleep( 500 );
      return ( ( performance.now() - t0 ) / 1000 ).toFixed( 0 );
    };
    const state = async ( label: string ) => {
      await sleep( 6000 ); // the game link writes its status every 2 s
      const path   = await saveLagReport( `replay: ${label}` );
      const report = path ? await ipc.readText( path ).catch( () => "" ) : "";
      const f      = joinPath( dir, "diag.txt" );
      await invoke( "save_game_diagnostics", { path: f, frontend: "" } ).catch( () => {} );
      const diag = await ipc.readText( f ).catch( () => "" );
      const pick = ( text: string, re: RegExp ) => text.split( /\r?\n/ ).filter( ( l ) => re.test( l ) ).join( " | " );
      log( `${label}: popped out ${useEditor.getState().gamePoppedOut}, status ${await ipc.gameStatus()} | ${pick( report, /game says/ )} | ${pick( diag, /^now:|^game window found:/ ).slice( 0, 260 )}` );
    };
    await playInGame();
    log( `first Play: embedded after ${await embedded()} s` );
    await sleep( 30000 );
    useEditor.getState().setCenterTab( "editor" );
    await sleep( 3000 );
    await playInGame(); // the Play button, from Layout
    log( `Play from Layout: embedded after ${await embedded()} s` );
    await sleep( 25000 );
    await state( "after Play from Layout" );
    await playInGame(); // again, from the Game tab ( F5 )
    log( `Play from the Game tab: embedded after ${await embedded()} s` );
    await sleep( 25000 );
    await state( "after Play from the Game tab" );
    // what the "Pop out" button does, then "Bring it back in here"
    ipc.gamePopOut();
    useEditor.setState( { gamePoppedOut: true } );
    await state( "popped out" );
    useEditor.setState( { gamePoppedOut: false } );
    await state( "brought back in" );
    await ipc.gameClose().catch( () => {} );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
