import { clickStudio, focusText, inGameRun, inMap, pad, probe, sticks, tap } from "./inGame";
import { ipc } from "../../core/ipc";
import { log, sleep } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/gamechat ), in the game: the chat opened with T and closed with Escape, then the
 * sticks still turning the camera ( "stuck out of the game": the chat opened, but with the game thinking it was in the
 * background it never took the keys that close it ). Once in the Game tab as Play leaves it, once after a click on the
 * studio and one back into the game.
**/
export async function gameChatSelftest( dir: string ) {
  const { playInGame } = await import( "../../map/project" );
  // T, then Escape: whether the chat opened and closed again, and whether the sticks turn the camera after
  const chat = async ( what: string ) => {
    const was = await probe();
    await tap( { keys: ["t"] } );
    const typing = await probe();
    await tap( { keys: ["escape"] } );
    const after = await probe();
    log( `${what}: the game ${focusText( was )}; chat open / camera input blocked: before ${was?.chatOpen} / ${was?.lookBlocked}, after T ${typing?.chatOpen} / ${typing?.lookBlocked}, after Escape ${after?.chatOpen} / ${after?.lookBlocked}` );
    const turn = await sticks( what );
    if ( typing?.chatOpen !== true ) throw new Error( `${what}: T didn't open the chat` );
    if ( after?.chatOpen !== false ) throw new Error( `${what}: Escape didn't close the chat (stuck out of the game)` );
    if ( turn < 10 ) throw new Error( `${what}: the sticks didn't turn the camera after the chat` );
  };
  await inGameRun( dir, "studio-test-chat", async () => {
    await pad();
    await playInGame();
    await inMap( "Play" );
    await chat( "as Play leaves it" );
    await clickStudio();
    // a click back into the game
    await ipc.gameFocus();
    await sleep( 1000 );
    await chat( "clicked away and back" );
  } );
}
