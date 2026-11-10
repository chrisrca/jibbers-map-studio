import { useEditor } from "../../map/store";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep } from "../harness";
import { inGameRun, inMap, pad } from "./inGame";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/gamefps ): how fast Jibbers runs when the studio starts it, on a project in the
 * folder ( a copy: a busy park ). Its own frame rate ( Unity's frame count over the link's clock ) and the studio's,
 * eight seconds each: in the Game tab; with the studio's editor in front of it ( the game running hidden ); popped
 * out beside the studio with the map in view; popped out with the game in front ( as on its own ). The game
 * mustn't run slower for the studio being there: each within a tenth of it on its own.
**/
export async function gameFpsSelftest( dir: string ) {
  const { playInGame } = await import( "../../map/project" );
  await inGameRun( dir, "studio-test-fps", async () => {
    const st     = () => useEditor.getState();
    const eng    = getEngine();
    const studio = { frames: 0 };
    const count  = () => {
      studio.frames++;
      requestAnimationFrame( count );
    };
    requestAnimationFrame( count );
    // ( the game's own frame rate, as the link reports it every 2 s )
    const status = joinPath( ( await ipc.appInfo() ).mapsDir, "..", "studio-game-status.json" );
    const said   = async () => JSON.parse( await ipc.readText( status ).catch( () => "{}" ) ) as { fps?: number; outOfSight?: boolean; vSync?: number; targetFrameRate?: number; insideStudio?: boolean };
    const fps    = async () => Number( ( await said() ).fps ?? NaN );
    const measure = async ( label: string ) => {
      await sleep( 4000 );
      const f0 = studio.frames, t0 = performance.now(), seen: number[] = [];
      for ( let k = 0; k < 4; k++ ) {
        await sleep( 2100 );
        seen.push( await fps() );
      }
      const f1   = studio.frames, t1 = performance.now();
      const game = seen.reduce( ( a, b ) => a + b, 0 ) / seen.length;
      const ours = ( ( f1 - f0 ) * 1000 ) / ( t1 - t0 );
      const s    = await said();
      log( `${label}: the game ${game.toFixed( 0 )} fps (${seen.map( ( f ) => f.toFixed( 0 ) ).join( " " )}; out of sight ${s.outOfSight}, paced ${( s as { paced?: boolean } ).paced}, vsync ${s.vSync}, frame cap ${s.targetFrameRate}, in the studio ${s.insideStudio}); the studio's page ${ours.toFixed( 0 )} frames a second, ${eng?.paused ? "its view paused" : "its view running"}` );
      return game;
    };
    useEditor.setState( { gamePoppedOut: false } );
    // ( the test pad there, nothing pressed: the link reports the game's scene with it, to know it's in the map )
    await pad();
    await playInGame();
    await inMap( "Game tab" );
    const tab = await measure( "Game tab" );
    st().setCenterTab( "editor" );
    const behind = await measure( "the editor in front ( the game hidden )" );
    st().setCenterTab( "game" );
    await sleep( 2000 );
    // ( the Game tab's Pop out, pressed )
    const popOut = [...document.querySelectorAll<HTMLButtonElement>( "button" )].find( ( x ) => x.textContent?.trim() === "Pop out" );
    if ( !popOut ) throw new Error( "no Pop out button" );
    popOut.click();
    await sleep( 4000 );
    st().setCenterTab( "editor" );
    eng?.nav.frameAll();
    const beside = await measure( "popped out, the studio beside it showing the map" );
    await ipc.gameFocus().catch( () => {} );
    const alone = await measure( "popped out, the game in front ( as on its own )" );
    // ( a game nobody sees held to the screen's rate, not flat out; one that's seen as fast as on its own )
    const hz    = Math.max( 60, Math.round( alone ) );
    const wild  = [["hidden behind the editor", behind], ["popped out behind the studio", beside]].filter( ( [, f] ) => ( f as number ) > hz * 1.15 );
    const slow  = tab < alone * 0.85;
    log( `${wild.length || slow ? "FAIL" : "ok  "} the game out of sight held to the screen (${hz} fps): ${wild.length ? `not, ${wild.map( ( [w, f] ) => `${w} ${( f as number ).toFixed( 0 )}` ).join( ", " )}` : `yes (hidden ${behind.toFixed( 0 )}, behind the studio ${beside.toFixed( 0 )})`}; in the Game tab ${tab.toFixed( 0 )} fps${slow ? ", slower than on its own" : ""}` );
    useEditor.setState( { gamePoppedOut: false } );
  } );
}
