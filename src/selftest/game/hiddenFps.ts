import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/hiddenfps ): how fast the game runs inside the studio, showing and hidden ( its
 * own figures, through a lag report ). No input is driven.
**/
export async function hiddenFpsSelftest( dir: string ) {
  try {
    const { playInGame    } = await import( "../../map/project"  );
    const { saveLagReport } = await import( "../../app/lagWatch" );
    await openProject( joinPath( dir, "..", "inputlag", "map.jbrproj" ) );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await playInGame();
    const t0 = performance.now();
    while ( performance.now() - t0 < 180000 && ( await ipc.gameStatus() ) !== "embedded" ) await sleep( 1000 );
    await sleep( 40000 );
    const game = async ( label: string ) => {
      await sleep( 6000 ); // the game link writes its status every 2 s
      const path = await saveLagReport( `hiddenfps: ${label}` );
      const text = path ? await ipc.readText( path ).catch( () => "" ) : "";
      log( `${label}: ${text.split( /\r?\n/ ).filter( ( l ) => /game says|^ *[\d.]+ +Jibbers/.test( l ) ).join( " | " )}` );
    };
    useEditor.getState().setCenterTab( "game" );
    await game( "Game tab" );
    useEditor.getState().setCenterTab( "editor" );
    await game( "in Layout" );
    useEditor.getState().setCenterTab( "game" );
    await game( "back on the Game tab" );
    await ipc.gameClose().catch( () => {} );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
