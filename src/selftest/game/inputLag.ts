import { getEngine } from "../../ui/Viewport";
import { invoke } from "@tauri-apps/api/core";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/inputlag ): what panning feels like with the game open. Frame times alone can't
 * show it — the view keeps drawing at full rate even when the mouse moves reach it late — so this also counts the
 * mouse moves that arrive and the frames in which the camera actually moved, while a driver outside moves the real
 * mouse ( at an office-mouse and a gaming-mouse rate ). Driver steps are "DRIVE ..." lines.
**/
export async function inputLagSelftest( dir: string ) {
  try {
    const { playInGame } = await import( "../../map/project" );
    await openProject( joinPath( dir, "map.jbrproj" ) );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await sleep( 3000 );
    const at = ( el: Element | null ) => {
      const r  = el!.getBoundingClientRect();
      const fx = ( window.outerWidth - window.innerWidth ) / 2, fy = window.outerHeight - window.innerHeight - fx;
      return `${Math.round( window.screenX + fx + r.left + r.width / 2 )},${Math.round( window.screenY + fy + r.top + r.height / 2 )}`;
    };
    const measure = async ( label: string, ms: number ) => {
      let moves           = 0, coalesced = 0, lastMove = 0, longest = 0;
      const age: number[] = [];
      const onMove        = ( e: PointerEvent ) => {
        const now = performance.now();
        moves++;
        coalesced += e.getCoalescedEvents?.().length || 1;
        if ( lastMove ) longest = Math.max( longest, now - lastMove );
        lastMove = now;
        age.push( now - e.timeStamp );
      };
      window.addEventListener( "pointermove", onMove, { capture: true } );
      const ts: number[] = [];
      let moved          = 0;
      const lastP        = eng.camera.position.clone(), lastQ = eng.camera.quaternion.clone();
      const t0           = performance.now();
      await new Promise<void>( ( done ) => {
        const tick = ( now: number ) => {
          ts.push( now );
          if ( eng.camera.position.distanceToSquared( lastP ) > 1e-10 || eng.camera.quaternion.angleTo( lastQ ) > 1e-7 ) moved++;
          lastP.copy( eng.camera.position   );
          lastQ.copy( eng.camera.quaternion );
          if ( now - t0 < ms ) requestAnimationFrame( tick );
          else done();
        };
        requestAnimationFrame( tick );
      } );
      window.removeEventListener( "pointermove", onMove, { capture: true } );
      const gaps = ts.slice( 1 ).map( ( t, i ) => t - ts[i] ).sort( ( a, b ) => a - b );
      age.sort( ( a, b ) => a - b );
      log( `${label}: ${gaps.length} frames (median ${( gaps[gaps.length >> 1] ?? 0 ).toFixed( 1 )} ms), camera moved in ${moved}, ` +
        `mouse moves ${moves} (${coalesced} with coalesced), longest gap ${longest.toFixed( 0 )} ms, ` +
        `event age median ${( age[age.length >> 1] ?? 0 ).toFixed( 0 )} ms, max ${( age[age.length - 1] ?? 0 ).toFixed( 0 )} ms` );
    };
    const pan = async ( label: string ) => {
      for ( const hz of [125, 1000] ) {
        log( `DRIVE pan ${hz} ${at( document.querySelector( ".stage" ) )}` );
        await measure( `${label}, ${hz} Hz mouse`, 6000 );
        await sleep( 1000 );
      }
    };
    await pan( "no game" );
    await playInGame();
    const t0 = performance.now();
    while ( performance.now() - t0 < 180000 && ( await ipc.gameStatus() ) !== "embedded" ) await sleep( 1000 );
    log( `game embedded after ${( ( performance.now() - t0 ) / 1000 ).toFixed( 0 )} s` );
    await sleep( 45000 );
    const tabs = document.querySelectorAll( ".workspaces button" );
    log( `DRIVE play ${at( document.querySelector( ".stage" ) )} ${at( tabs[0] )}` );
    await waitFor( () => useEditor.getState().centerTab === "editor", "the Layout tab clicked", 60000 );
    await sleep( 2000 );
    await pan( "game open, in Layout" );
    const { saveLagReport } = await import( "../../app/lagWatch" );
    log( `report: ${await saveLagReport( "inputlag selftest, game open in Layout" )}` );
    // back to the game and out again: it comes back inside, then goes out of the window again
    const windowState = async ( label: string ) => {
      const f = joinPath( dir, "diag.txt" );
      await invoke( "save_game_diagnostics", { path: f, frontend: "" } ).catch( () => {} );
      const text  = await ipc.readText( f ).catch( () => "" );
      const lines = text.split( /\r?\n/ ).filter( ( l ) => /embedded:|now:/.test( l ) );
      log( `window ${label}: ${lines.join( " | " ).slice( 0, 400 )}` );
    };
    await windowState( "in Layout" );
    useEditor.getState().setCenterTab( "game" );
    await sleep( 4000 );
    await windowState( "back on the Game tab" );
    useEditor.getState().setCenterTab( "editor" );
    await sleep( 2000 );
    await windowState( "in Layout again" );
    await ipc.gameClose().catch( () => {} );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
