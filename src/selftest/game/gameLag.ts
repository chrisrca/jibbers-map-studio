import { LAYOUTS } from "../../terrain/generate";
import { getEngine } from "../../ui/Viewport";
import { invoke } from "@tauri-apps/api/core";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { newProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/gamelag ): the editor's frame rate with the game running inside the studio, on
 * the Game tab and back in the editor ( the game is launched for real, then closed ).
**/
export async function gameLagSelftest( dir: string ) {
  try {
    const { playInGame } = await import( "../../map/project" );
    const proj           = joinPath( dir, `lag-${Date.now()}.jbrproj` );
    await newProject( proj, "Lag Test", { layout: LAYOUTS[0], base: "mountain", slopeDeg: 14, heightRange: 1200, seed: 7 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    let fps     = 0;
    const prev  = eng.onStats;
    eng.onStats = ( st ) => {
      fps = st.fps;
      prev?.( st );
    };
    const sample = async ( label: string, seconds: number ) => {
      const xs: number[] = [];
      for ( let k = 0; k < seconds; k++ ) {
        await sleep( 1000 );
        xs.push( Math.round( fps ) );
      }
      log( `fps ${label}: ${xs.join( " " )}` );
    };
    await sleep( 3000 );
    await sample( "editor, no game", 6 );
    log( "PHASE launching" );
    await playInGame();
    const t0 = performance.now();
    while ( performance.now() - t0 < 180000 ) {
      if ( ( await ipc.gameStatus() ) === "embedded" ) break;
      await sleep( 1000 );
    }
    log( `game status after ${( ( performance.now() - t0 ) / 1000 ).toFixed( 0 )} s: ${await ipc.gameStatus()}` );
    await sleep( 40000 ); // the map loads
    log( "PHASE game-tab" );
    await sleep( 8000 );
    useEditor.getState().setCenterTab( "editor" );
    log( "PHASE editor-with-game" );
    await sample( "editor, game hidden", 15 );
    const windowState = async ( label: string ) => {
      const f = joinPath( dir, "diag.txt" );
      await invoke( "save_game_diagnostics", { path: f, frontend: "" } ).catch( () => {} );
      const text  = await ipc.readText( f ).catch( () => "" );
      const lines = text.split( /\r?\n/ ).filter( ( l ) => /embedded:|now:/.test( l ) );
      log( `window ${label}: ${lines.join( " | " ).slice( 0, 400 )}` );
    };
    await windowState( "in the editor" );
    useEditor.getState().setCenterTab( "game" );
    await sleep( 5000 );
    await windowState( "back on the Game tab" );
    useEditor.getState().setCenterTab( "editor" );
    log( "PHASE editor-again" );
    await sample( "editor, game hidden again", 10 );
    log( "PHASE closing" );
    await ipc.gameClose().catch( ( e ) => log( `close: ${e}` ) );
    await sleep( 8000 );
    await sample( "editor, game closed", 6 );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
