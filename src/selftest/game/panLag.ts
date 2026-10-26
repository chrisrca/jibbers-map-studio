import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/panlag ): the user's case — a real map open, the game running in the Game tab,
 * the camera moving in the editor. Frame times are measured while the camera moves from code ( no input ) and while a
 * real middle-button drag comes through Windows ( driven from outside on the "PAN" lines ).
**/
export async function panLagSelftest( dir: string ) {
  try {
    const { playInGame } = await import( "../../map/project" );
    const proj           = joinPath( dir, "map.jbrproj" );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await sleep( 4000 );
    const centre = useEditor.getState().spawns[0]?.position ?? [0, 0, 0];
    const g      = ( x: number, z: number ) => terrain.heightAt( x, z );
    eng.nav.lookAtUnity( [centre[0] - 60, centre[1] + 40, centre[2] - 60], centre );
    await sleep( 1500 );
    // frame intervals over `ms`, as the page sees them
    const frames = async ( ms: number, during?: ( t: number ) => void ) => {
      const ts: number[] = [];
      const t0           = performance.now();
      await new Promise<void>( ( done ) => {
        const tick = ( now: number ) => {
          ts.push( now );
          during?.( ( now - t0 ) / 1000 );
          if ( now - t0 < ms ) requestAnimationFrame( tick );
          else done();
        };
        requestAnimationFrame( tick );
      } );
      const gaps = ts.slice( 1 ).map( ( t, i ) => t - ts[i] ).sort( ( a, b ) => a - b );
      const med  = gaps[Math.floor( gaps.length / 2 )] ?? 0, worst = gaps[gaps.length - 1] ?? 0;
      return `${gaps.length} frames, median ${med.toFixed( 1 )} ms, worst ${worst.toFixed( 0 )} ms`;
    };
    const orbit = ( t: number ) => {
      const a = t * 1.2;
      eng.nav.lookAtUnity( [centre[0] + Math.cos( a ) * 80, centre[1] + 45, centre[2] + Math.sin( a ) * 80], [centre[0], g( centre[0], centre[2] ), centre[2]] );
    };
    log( `no game, still: ${await frames( 2000 )}`                          );
    log( `no game, camera moving from code: ${await frames( 3000, orbit )}` );
    log( "PAN no-game" );
    await sleep( 400 );
    log( `no game, real middle-drag: ${await frames( 3500 )}` );
    await sleep( 1500 );

    log( "PHASE launching" );
    await playInGame();
    const t0 = performance.now();
    while ( performance.now() - t0 < 180000 && ( await ipc.gameStatus() ) !== "embedded" ) await sleep( 1000 );
    log( `game embedded after ${( ( performance.now() - t0 ) / 1000 ).toFixed( 0 )} s` );
    await sleep( 50000 );
    useEditor.getState().setCenterTab( "editor" );
    await sleep( 3000 );
    log( `game hidden, still: ${await frames( 2000 )}`                          );
    log( `game hidden, camera moving from code: ${await frames( 3000, orbit )}` );
    log( "PAN with-game" );
    await sleep( 400 );
    log( `game hidden, real middle-drag: ${await frames( 3500 )}` );
    await sleep( 1000 );
    log( "PHASE closing" );
    await ipc.gameClose().catch( () => {} );
    await sleep( 6000 );
    log( `game closed, real middle-drag next:` );
    log( "PAN closed"                          );
    await sleep( 400 );
    log( `game closed, real middle-drag: ${await frames( 3500 )}` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
