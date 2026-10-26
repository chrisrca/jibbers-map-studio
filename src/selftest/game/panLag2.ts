import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/panlag2 ): the user's steps, driven from outside through Windows — the game is
 * played in the Game tab ( clicked into, keys held ), then the Layout tab is clicked and the 3D view panned with the
 * middle button. This side only reports where to click ( screen pixels ) and measures frame times.
**/
export async function panLag2Selftest( dir: string ) {
  try {
    const { playInGame } = await import( "../../map/project" );
    await openProject( joinPath( dir, "map.jbrproj" ) );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await sleep( 3000 );
    const frames = async ( ms: number ) => {
      const ts: number[] = [];
      const t0           = performance.now();
      await new Promise<void>( ( done ) => {
        const tick = ( now: number ) => {
          ts.push( now );
          if ( now - t0 < ms ) requestAnimationFrame( tick );
          else done();
        };
        requestAnimationFrame( tick );
      } );
      const gaps = ts.slice( 1 ).map( ( t, i ) => t - ts[i] ).sort( ( a, b ) => a - b );
      return `${gaps.length} frames, median ${( gaps[Math.floor( gaps.length / 2 )] ?? 0 ).toFixed( 1 )} ms, worst ${( gaps[gaps.length - 1] ?? 0 ).toFixed( 0 )} ms`;
    };
    // screen pixels of an element's centre ( the window's client area starts at screenX/Y + its frame )
    const at = ( el: Element | null ) => {
      const r  = el!.getBoundingClientRect();
      const fx = ( window.outerWidth - window.innerWidth ) / 2, fy = window.outerHeight - window.innerHeight - fx;
      return `${Math.round( window.screenX + fx + r.left + r.width / 2 )},${Math.round( window.screenY + fy + r.top + r.height / 2 )}`;
    };
    await playInGame();
    const t0 = performance.now();
    while ( performance.now() - t0 < 180000 && ( await ipc.gameStatus() ) !== "embedded" ) await sleep( 1000 );
    await sleep( 45000 );
    const tabs = document.querySelectorAll( ".workspaces button" );
    log( `CLICKS game=${at( document.querySelector( ".stage" ) )} layout=${at( tabs[0] )} view=${at( document.querySelector( ".stage" ) )}` );
    log( "DRIVE play" );
    await waitFor( () => useEditor.getState().centerTab === "editor", "the Layout tab clicked", 60000 );
    await sleep( 1500 );
    log( "DRIVE pan" );
    await sleep( 300 );
    log( `after playing, Layout clicked, real middle-drag: ${await frames( 3500 )}` );
    await sleep( 800 );
    log( `after that, still: ${await frames( 2000 )}` );
    await ipc.gameClose().catch( () => {} );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
