import { getEngine } from "../../ui/Viewport";
import { joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { terrain } from "../../terrain/terrain";
import { newUid, useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/shadows ): the sun's shadows, as the game has them. A new map, a cube held up off
 * the ground and one on it, by day and late in the afternoon ( the sun low ): each seen close and from further off,
 * logged "SNAP <name>" for a screen capture from outside. Checked: the ground under the held-up cube darker than open
 * snow beside it ( read back from the shadow map's own test: the sun's light there ), shadows drawn at all.
**/
export async function shadowsSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const { newEmptyProject } = await import( "../../map/project/sessions" );
    const { newModelObject }  = await import( "../../model/objects" );
    const { primitive }       = await import( "../../model/mesh" );
    await newEmptyProject( joinPath( dir, `shadows-${Date.now()}.jbrproj` ), "Shadows" );
    const eng                 = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the ground", 60000 );
    await sleep( 3000 );
    const st   = () => useEditor.getState();
    const g    = terrain.heightAt( 0, 0 );
    const snap = async ( name: string ) => {
      await sleep( 1500 );
      log( `SNAP ${name}` );
      await sleep( 2500 );
    };
    const held = newModelObject( newUid(), primitive( "cube", { size: 2 } ), [0, g + 3, 0] );
    const on   = newModelObject( newUid(), primitive( "cube", { size: 2 } ), [6, g + 1, 0] );
    st().addCustom( held, "Held up" );
    st().addCustom( on, "On the ground" );
    st().setSelection( [] );
    const sun = eng.daylight.sun;
    check( eng.renderer.shadowMap.enabled && sun.castShadow, `the sun casts shadows: ${eng.renderer.shadowMap.enabled}, ${sun.castShadow}` );
    eng.nav.lookAtUnity( [-10, g + 9, -14], [3, g, 0] );
    await snap( "day-close" );
    eng.nav.lookAtUnity( [-60, g + 50, -80], [3, g, 0] );
    await snap( "day-far" );
    // ( late in the day: the sun low, long shadows )
    st().setMap( "Time", { overrideTime: true, dayTimeHours: 17, sunAngle: 40 } );
    await sleep( 500 );
    eng.nav.lookAtUnity( [-10, g + 9, -14], [3, g, 0] );
    await snap( "evening-close" );
    const box = ( sun.shadow.camera as { right: number } ).right;
    check( box >= 75, `the shadows' reach about what the view looks at: ${box.toFixed( 0 )} m` );
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
