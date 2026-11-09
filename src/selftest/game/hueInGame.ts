import * as THREE from "three/webgpu";
import { ipc, joinPath } from "../../core/ipc";
import type { ObjectEntry } from "../../core/types";
import { newEmptyProject } from "../../map/project/sessions";
import { newUid, useEditor } from "../../map/store";
import { placeEntry } from "../../pieces/library";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { feature, log, sleep, waitFor } from "../harness";
import { inMap, pad, probe, until } from "./inGame";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/hueingame ): a piece's Hue in the game against the studio. A new map with the
 * asset browser's Rail Long twice ( as it comes, and with a Hue of 207° ) beside the game's own long rail in blue and
 * in green; the studio's view of them, then the game's from the same place ( the link holds its camera there and saves
 * the screen ), both kept in the folder.
**/
export async function hueInGameSelftest( dir: string ) {
  const { playInGame } = await import( "../../map/project" );
  try {
    await newEmptyProject( joinPath( dir, `hue-${Date.now()}.jbrproj` ), "Studio test hue" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the ground", 60000 );
    const st = () => useEditor.getState();
    st().setMap( "Test id", { id: "studio-test-hue", name: "Studio test hue" } );
    const g  = ( x: number, z: number ) => terrain.heightAt( x, z );
    // the pieces along X, 4 m apart: Rail Long as it comes, with a Hue; the game's own in blue and green
    const n0 = st().customObjects.length;
    await placeEntry( feature( "rail_long" ), [-6, g( -6, 0 ), 0], [0, 0, 0] );
    await placeEntry( feature( "rail_long" ), [-2, g( -2, 0 ), 0], [0, 0, 0] );
    await waitFor( () => ( st().customObjects.length >= n0 + 2 ? true : null ), "the pieces placed", 30000 );
    const hued = st().customObjects[st().customObjects.length - 1];
    useEditor.setState( { customObjects: st().customObjects.map( ( o ) => ( o.uid === hued.uid ? { ...o, hue: 207 / 360 } : o ) ) } );
    const own = ( x: number, colour: string ): ObjectEntry => ( { uid: newUid(), id: "rail_long", position: [x, g( x, 0 ), 0], rotation: [0, 0, 0], scale: [1, 1, 1], params: { color: { type: "String", value: colour } } } );
    useEditor.setState( { objects: [own( 2, "blue" ), own( 6, "green" )], gamePoppedOut: false } );
    // from in front of them, a little above, looking along +Z at their middle
    const eye: [number, number, number] = [0, g( 0, -9 ) + 2.5, -9];
    eng.nav.lookAtUnity( eye, [0, g( 0, 0 ) + 0.6, 0] );
    st().setSelection( [] );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading && !st().busy, "the view loaded", 60000 );
    await sleep( 6000 );
    log( "SNAP studio-view" );
    await sleep( 1500 );
    // the game's view of them
    const shot  = joinPath( dir, "game-view.png" );
    const req   = joinPath( ( await ipc.appInfo() ).mapsDir, "..", "studio-shot.json" );
    await pad();
    await playInGame();
    await inMap( "the hue map" );
    // ( its camera up: the map loaded, not its loading screen )
    await until( async () => ( ( await probe() )?.lookBlocked != null ? true : null ), "the game's camera", 120000 );
    await sleep( 4000 );
    // ( a few, some seconds apart: the first may still be the game's loading screen )
    let ok = false;
    for ( let n = 0; n < 4; n++ ) {
      const file = n ? joinPath( dir, `game-view-${n}.png` ) : shot;
      // ( the game's own view: its camera as it is, kept in the report, the studio's put there after )
      await ipc.writeText( req, JSON.stringify( { path: file } ) );
      let got = false;
      for ( let k = 0; k < 60 && !got; k++ ) {
        await sleep( 500 );
        got = await ipc.readBinary( file ).then( ( b ) => b.byteLength > 1000, () => false );
      }
      ok ||= got;
      log( `game shot ${n}: ${got ? "kept" : "none"}` );
      await sleep( 8000 );
    }
    log( ok ? "the game's view kept: game-view.png" : "SELFTEST FAILED: the game saved no screenshot" );
    // ( the studio from the game's camera exactly: where it is, which way it looks, its field of view )
    // ( the studio from where the game's last screenshot was taken: its camera then, as the link saw it )
    st().setCenterTab( "editor" );
    const look  = JSON.parse( await ipc.readText( `${joinPath( dir, "game-view-3.png" )}.look.json` ).catch( () => "{}" ) ) as { cameras?: { enabled?: boolean; fov?: number; pose?: number[] }[] };
    const gc    = look.cameras?.find( ( c ) => c.enabled && c.pose );
    const c     = eng.camera as THREE.PerspectiveCamera;
    if ( gc?.pose ) {
      const [x, y, z, qx, qy, qz, qw] = gc.pose;
      const fwd = new THREE.Vector3( 0, 0, 1 ).applyQuaternion( new THREE.Quaternion( qx, qy, qz, qw ) );
      eng.nav.lookAtUnity( [x, y, z], [x + fwd.x * 10, y + fwd.y * 10, z + fwd.z * 10] );
      log( `the game's camera at the shot: ${gc.pose.map( ( v ) => v.toFixed( 3 ) ).join( ", " )}, field of view ${gc.fov}` );
    } else eng.nav.lookAtUnity( eye, [0, g( 0, 0 ) + 0.6, 0] );
    c.fov = gc?.fov ?? 70;
    c.updateProjectionMatrix();
    log( `the game's camera: ${JSON.stringify( look.cameras?.find( ( x ) => x.enabled ) )}` );
    await sleep( 3000 );
    log( "SNAP studio-matched" );
    await sleep( 1500 );
    // ( the studio's light then, beside the game's )
    const d = eng.daylight, from = d.sun.position.clone().normalize();
    log( `studio light ( three's axes: z the other way ): sun from ${[from.x, from.y, from.z].map( ( v ) => v.toFixed( 3 ) )} intensity ${d.sun.intensity.toFixed( 3 )} colour ${d.sun.color.getHexString()}; hemi ${d.hemi.color.getHexString()} / ${d.hemi.groundColor.getHexString()} × ${d.hemi.intensity.toFixed( 3 )}; reflections × ${eng.scene.environmentIntensity}` );
    log( `game lights: ${await ipc.readText( `${shot}.lights.json` ).catch( () => "none" )}` );
    if ( ok ) log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  } finally {
    await ipc.gamePad( null ).catch( () => {} );
    await ipc.gameClose().catch( () => {} );
    const map = joinPath( ( await ipc.appInfo() ).mapsDir, "studio-test-hue.jbrmap" );
    for ( let k = 0; k < 20; k++ ) {
      await sleep( 1000 );
      if ( await ipc.recycle( map ).then( () => true, () => false ) ) break;
    }
  }
}
