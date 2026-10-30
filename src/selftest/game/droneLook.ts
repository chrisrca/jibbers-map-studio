import { backInMap, clickStudio, focusText, inGameRun, inMap, pad, probe, sticks, tap } from "./inGame";
import { ipc } from "../../core/ipc";
import { log, sleep } from "../harness";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/dronelook, /dronepopped popped out of the studio ), in the game: a project in
 * the folder played with the test pad in, as a person plays it: in the map with the rider loaded, the drone out ( up on
 * the D-pad ), each stick held in turn; then a click on the studio and Play again, and the same. How far the camera
 * turned each time ( the drone bug: after the second Play it didn't. Pressing Play took the focus from the game, and
 * the game's camera takes no look input without it ).
**/
export async function droneLookSelftest( dir: string, poppedOut = false ) {
  const { playInGame } = await import( "../../map/project" );
  // the drone out, then each stick held in turn
  const look = async ( what: string ) => {
    await tap( { buttons: ["dpad_up"] } );
    await sleep( 1500 );
    const q = await probe();
    log( `${what}: drone out ${( q?.drones ?? 0 ) > 0 ? "yes" : "no"} (${q?.drones} drones), the game ${focusText( q )}` );
    return sticks( what );
  };
  await inGameRun( dir, "studio-test-drone", async () => {
    useEditor.setState( { gamePoppedOut: poppedOut } );
    await pad();
    await playInGame();
    await inMap( "first Play" );
    const first = await look( "first Play" );
    // Play pressed again as a person does: a click on the studio, which takes the focus from the game
    await clickStudio();
    await playInGame();
    await sleep( 1000 );
    log( `Play pressed again: the game ${focusText( await probe() )}` );
    await backInMap( "second Play" );
    const second = await look( "second Play" );
    const works  = ( d: number ) => d > 10;
    log( `drone look${poppedOut ? " (popped out)" : ""}: first Play ${works( first ) ? "works" : "doesn't"}, second Play ${works( second ) ? "works" : "doesn't (the drone bug)"}` );
    if ( !works( first ) || !works( second ) ) throw new Error( "the sticks didn't turn the camera" );
  } );
  useEditor.setState( { gamePoppedOut: false } );
}

/**
 * Focused run ( STUDIO_SELFTEST=<...>/droneraw ): the game as players have it ( Rewired on its own source, a real
 * controller, no test pad ), played twice: what it registers for input each time.
**/
export async function droneRawSelftest( dir: string ) {
  const { playInGame } = await import( "../../map/project" );
  await inGameRun( dir, "studio-test-drone", async () => {
    await ipc.gamePad( { connected: false, keepSource: true } );
    for ( const what of ["first Play", "second Play"] ) {
      await playInGame();
      const q = await ( what === "first Play" ? inMap( what ) : backInMap( what ) );
      log( `${what}: Raw Input registrations ${JSON.stringify( q?.rawInput )}; players ${JSON.stringify( q?.players )}` );
    }
  } );
}
