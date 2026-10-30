// What the in-game self-tests share: a project played in the game with the test pad in ( src-tauri/gamelink/src/pad.rs ),
// what the link sees of the game ( probe.rs ), and the pad and keys pressed as a person presses them.

import { ipc, joinPath, type GamePad, type GameProbe } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { useEditor } from "../../map/store";

type Pose = GameProbe["cameras"][number];

export const probe = () => ipc.gameProbe().catch( () => null );

/**
 * waitFor's, for a check that has to ask the studio.
**/
export async function until<T>( f: () => Promise<T | null | false>, label: string, ms: number ): Promise<T> {
  const t0 = performance.now();
  for ( ;; ) {
    const v = await f();
    if ( v ) return v;
    if ( performance.now() - t0 > ms ) throw new Error( `timeout waiting for ${label}` );
    await sleep( 250 );
  }
}

export const pad = ( p: Omit<GamePad, "connected"> = {} ) => ipc.gamePad( { connected: true, ...p } );

/**
 * A key pressed and let go ( or a pad button ), a moment held.
**/
export async function tap( p: Omit<GamePad, "connected"> ) {
  await pad( p );
  await sleep( 150 );
  await pad();
  await sleep( 600 );
}

/**
 * How far poses have turned ( degrees ) and moved ( metres ) between two looks: the one that changed most.
**/
export function change( a: Pose[] = [], b: Pose[] = [] ) {
  const pairs = a.slice( 0, b.length ).map( ( p, i ) => [p, b[i]] as const );
  const turn  = pairs.map( ( [p, q] ) => ( 2 * Math.acos( Math.min( 1, Math.abs( p[3] * q[3] + p[4] * q[4] + p[5] * q[5] + p[6] * q[6] ) ) ) * 180 ) / Math.PI );
  const move  = pairs.map( ( [p, q] ) => Math.hypot( p[0] - q[0], p[1] - q[1], p[2] - q[2] ) );
  return { turn: pairs.length ? Math.max( ...turn ) : NaN, move: pairs.length ? Math.max( ...move ) : NaN };
}

// ( the camera's or the drone's, whichever turned more; no drone out, the camera's )
export const turned = ( a: GameProbe | null, b: GameProbe | null ) => Math.max( ...[change( a?.cameras, b?.cameras ).turn, change( a?.dronePoses, b?.dronePoses ).turn].filter( ( t ) => !isNaN( t ) ), 0 );

export const focusText = ( q: GameProbe | null ) => q?.focused ? "focused" : "not focused";

/**
 * The rider in the map: the map's scene, a camera, a few seconds for the rider to spawn and settle.
**/
export async function inMap( what: string ) {
  let told = 0;
  const p  = await until( async () => {
    const q = await probe();
    // ( what it sees meanwhile, every 15 s )
    if ( performance.now() - told > 15000 ) {
      told = performance.now();
      log( `  ${what}, waiting: ${JSON.stringify( q )}` );
    }
    return q?.scene === "Main" && q.cameras.length ? q : null;
  }, `the map (${what})`, 150000 );
  await sleep( 8000 );
  const q = await probe();
  log( `${what}: in the map, the game ${focusText( q )}; Rewired source ${p.source}, XInput ${p.xinput}, joysticks ${JSON.stringify( q?.joysticks )}, the game has read the test pad ${q?.padReads} times; ${q?.cameras.length} cameras` );
  return q;
}

/**
 * Out of the map ( a Play reloading it ) and back in.
**/
export async function backInMap( what: string ) {
  await until( async () => ( await probe() )?.scene !== "Main", "leaving the map", 60000 ).catch( () => log( "  (never seen leaving the map)" ) );
  return inMap( what );
}

/**
 * Each stick held in turn: what it turns and moves ( the camera, the drone ), and the most any of them turned.
**/
export async function sticks( what: string ) {
  let most = 0;
  for ( const [name, held] of [["left stick right", { lx: 1 }], ["left stick up", { ly: 1 }], ["right stick right", { rx: 1 }], ["right stick up", { ry: 1 }]] as const ) {
    const was = await probe();
    await pad( held );
    await sleep( 1500 );
    await pad();
    await sleep( 300 );
    const now = await probe(), cam = change( was?.cameras, now?.cameras ), dr = change( was?.dronePoses, now?.dronePoses );
    log( `${what}: ${name} 1.5 s: camera turned ${cam.turn.toFixed( 1 )}° moved ${cam.move.toFixed( 2 )} m; drone turned ${dr.turn.toFixed( 1 )}° moved ${dr.move.toFixed( 2 )} m` );
    most = Math.max( most, turned( was, now ) );
  }
  log( `${what}: the most a stick turned the camera or drone: ${most.toFixed( 1 )}°` );
  return most;
}

/**
 * A click on the studio, as when pressing its Play: the studio in front, the focus taken from the game.
**/
export async function clickStudio() {
  const { getCurrentWindow } = await import( "@tauri-apps/api/window" );
  await getCurrentWindow().setFocus();
  await sleep( 1000 );
  log( `the studio clicked: the game ${focusText( await probe() )}` );
}

/**
 * The project in `dir` opened under a test id of its own ( the player's own copy of the map in the game is left
 * alone ), `body` run, and everything put back after: the pad out, the game closed, the test map gone.
**/
export async function inGameRun( dir: string, id: string, body: () => Promise<void> ) {
  const { openProject } = await import( "../../map/project" );
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    await waitFor( () => useEditor.getState().map, "the map" );
    await sleep( 3000 );
    useEditor.getState().setMap( "Test id", { id, name: `Studio test (${id})` } );
    // ( what an earlier run left cleared away first: a stale probe would look like the map )
    await ipc.gamePad( null );
    await body();
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  } finally {
    await ipc.gamePad( null ).catch( () => {} );
    await ipc.gameClose().catch( () => {} );
    const maps = ( await ipc.appInfo() ).mapsDir;
    await ipc.recycle( joinPath( maps, `${id}.jbrmap` ) ).catch( () => {} );
  }
}
