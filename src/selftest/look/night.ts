import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, realInput, sleep, waitFor } from "../harness";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/night ): the map's time of day in the view, set as a person sets it ( the Map tab:
 * Fixed time, the hour typed ) on Joyosa Park ( the game's map: floodlights and snow cannons ): by day as before, at
 * dusk, at night ( the sky dark, the lights on: the floodlights' own from the game, each its settings ), and back.
 * Frame times by night while the view moves.
**/
export async function nightSelftest( dir: string ) {
  try {
    const P   = await import( "../../map/project" );
    const src = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Jibbers Playtest\\Jibbers_Data\\StreamingAssets\\Maps\\joyosa-park.jbrmap";
    await P.importMap( src, joinPath( dir, "joyosa-night.jbrproj" ) );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 2000 );
    await waitFor( () => ( eng.veil.loading ? null : true ), "the map's pieces", 300000 );
    const st  = () => useEditor.getState();
    let phase = "day";
    const io  = realInput( eng, () => phase );
    st().setTool( "select" );
    st().setSelection( [] );
    await sleep( 300 );
    const $$ = <T extends Element = HTMLElement>( q: string ) => [...document.querySelectorAll<T & HTMLElement>( q )];
    $$<HTMLButtonElement>( ".props-tabs button" ).find( ( b ) => b.title === "Map" )?.click();
    await sleep( 400 );
    const floods       = st().objects.filter( ( o ) => o.id === "floodlight" );
    const L            = eng.sceneLights as unknown as { count: number };
    const { lampsLit } = await import( "../../viewport/render/lamps" );
    log( `Joyosa: ${floods.length} floodlights, ${st().objects.filter( ( o ) => o.id === "snowcannon" ).length} snow cannons; lights known ${L.count}` );
    // looking at a floodlight from a little way off
    const f    = floods[0];
    const look = async () => {
      if ( f ) {
        // ( above the ground wherever that is: the mountain's steep )
        const ex = f.position[0] + 30, ez = f.position[2] - 30, g = terrain.heightAt( ex, ez );
        eng.nav.lookAtUnity( [ex, Math.max( f.position[1] + 16, ( Number.isNaN( g ) ? f.position[1] : g ) + 12 ), ez], [f.position[0], f.position[1] + 2, f.position[2]] );
      }
      await sleep( 1200 );
    };
    await look();
    /**
     * how bright a shot is, on average ( 0..255 )
    **/
    const bright = async ( png: Uint8Array ) => {
      const bmp = await createImageBitmap( new Blob( [png as BlobPart], { type: "image/png" } ) );
      const c   = document.createElement( "canvas" );
      c.width   = 64;
      c.height  = 36;
      const g   = c.getContext( "2d" )!;
      g.drawImage( bmp, 0, 0, 64, 36 );
      const d = g.getImageData( 0, 0, 64, 36 ).data;
      let sum = 0;
      for ( let k = 0; k < d.length; k += 4 ) sum += 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
      return sum / ( d.length / 4 );
    };
    const shot = async ( name: string ) => {
      const png = await eng.pictures.capture();
      await ipc.writeBinary( joinPath( dir, name ), png );
      return bright( png );
    };
    log( `Joyosa's own time (fixed): brightness ${( await shot( "day-own.png" ) ).toFixed( 0 )}` );
    {
      const keep = st().map!.overrideTime;
      useEditor.setState( { map: { ...st().map!, overrideTime: false } } );
      await sleep( 900 );
      log( `the view's day look (not fixed): brightness ${( await shot( "day-plain-first.png" ) ).toFixed( 0 )}; sun from ${eng.daylight.sun.position.clone().normalize().toArray().map( ( v ) => v.toFixed( 2 ) )}` );
      useEditor.setState( { map: { ...st().map!, overrideTime: keep } } );
      await sleep( 900 );
    }
    await ipc.writeBinary( joinPath( dir, "day.png" ), await eng.pictures.capture() );
    log( `by day: lamps lit ${lampsLit()}${lampsLit() === 0 ? "" : " (FAIL)"}; SHOT day.png` );
    // ---- the Map tab: Fixed time, and the hour
    const row   = ( label: string ) => ( $$( ".props label" ).find( ( l ) => l.textContent?.trim() === label )?.nextElementSibling as HTMLElement | null ) ?? null;
    const fixed = $$<HTMLInputElement>( ".props input[type=checkbox]" ).find( ( i ) => i.parentElement?.textContent?.includes( "Fixed time" ) );
    if ( !fixed ) log( "  (no Fixed time box: FAIL)" );
    log( `the map's own time: ${st().map?.overrideTime ? `fixed (day-time ${st().map?.dayTime}, hours ${st().map?.dayTimeHours}, sun angle ${st().map?.sunAngle})` : "the game's day"}; night shown ${eng.daylight.night.toFixed( 2 )}` );
    const was = st().map?.overrideTime;
    if ( !fixed?.checked ) fixed?.click();
    await sleep( 300 );
    const setHour = async ( h: number ) => {
      // ( the hour typed in, as the field takes it )
      st().setMap( "Time of day", { dayTimeHours: h } );
      await sleep( 900 );
    };
    phase = "dusk";
    await setHour( 18.5 );
    await ipc.writeBinary( joinPath( dir, "dusk.png" ), await eng.pictures.capture() );
    log( `18:30: night ${eng.daylight.night.toFixed( 2 )}, lamps lit ${lampsLit()}; SHOT dusk.png` );
    phase = "night";
    await setHour( 22 );
    await look();
    const lit = lampsLit();
    await ipc.writeBinary( joinPath( dir, "night.png" ), await eng.pictures.capture() );
    log( `22:00: night ${eng.daylight.night.toFixed( 2 )}${eng.daylight.night > 0.9 ? "" : " (FAIL)"}, lamps lit ${lit}${lit > 0 ? "" : " (FAIL)"}; hour field ${row( "Hour" ) ? "shown" : "missing"}; SHOT night.png` );
    // ---- a floodlight's own settings: red, brighter
    if ( f ) {
      st().setSelection( [{ kind: "object", uid: f.uid }] );
      st().updateObjects( "Light colour", [f.uid], ( x ) => ( { ...x, params: { ...x.params, "light-color": { type: "String", value: "#ff3020" } as never, "light-intensity": { type: "Float", value: 2 } as never } } ) );
      await sleep( 900 );
      await ipc.writeBinary( joinPath( dir, "night-red.png" ), await eng.pictures.capture() );
      const src = ( eng.sceneLights as unknown as { sources: { color: THREE.Color; intensity: number }[] } ).sources;
      const red = src.filter( ( x ) => x.color.r > 0.9 && x.color.g < 0.3 );
      log( `a floodlight set red, twice as bright: ${red.length ? `${red.length} of its lamps red at ${red[0].intensity}` : "not red (FAIL)"}; SHOT night-red.png` );
      st().setSelection( [] );
    }
    // the view moved by night
    await io.drag( io.rc.width * 0.6, io.rc.height * 0.5, io.rc.width * 0.4, io.rc.height * 0.45, 900, 1 );
    await io.wheel( -100, 4 );
    // ---- by day again
    phase = "day again";
    await setHour( 12 );
    log( `12:00: night ${eng.daylight.night.toFixed( 2 )}, lamps lit ${lampsLit()}${lampsLit() === 0 ? "" : " (FAIL)"}` );
    {
      const sun = eng.daylight.sun, hemi = eng.daylight.hemi;
      log( `at 12:00 fixed: sun ${sun.intensity.toFixed( 2 )} #${sun.color.getHexString()} from ${sun.position.clone().normalize().toArray().map( ( v ) => v.toFixed( 2 ) )}, hemi ${hemi.intensity.toFixed( 2 )}, env ${eng.scene.environmentIntensity}` );
      await look();
      await ipc.writeBinary( joinPath( dir, "noon-fixed.png" ), await eng.pictures.capture() );
    }
    // ( the Map tab again, and its box found afresh: picking the floodlight showed its own tab )
    $$<HTMLButtonElement>( ".props-tabs button" ).find( ( b ) => b.title === "Map" )?.click();
    await sleep( 400 );
    const fixed2 = $$<HTMLInputElement>( ".props input[type=checkbox]" ).find( ( i ) => i.parentElement?.textContent?.includes( "Fixed time" ) );
    if ( fixed2?.checked ) fixed2.click();
    await sleep( 600 );
    log( `Fixed time off: ${st().map?.overrideTime ? "still fixed (FAIL)" : "the game's day"}, the view by day (${eng.daylight.night === 0 ? "yes" : "no (FAIL)"})` );
    {
      const sun = eng.daylight.sun, hemi = eng.daylight.hemi;
      log( `by day as ever: sun ${sun.intensity.toFixed( 2 )} #${sun.color.getHexString()} from ${sun.position.clone().normalize().toArray().map( ( v ) => v.toFixed( 2 ) )}, hemi ${hemi.intensity.toFixed( 2 )}, env ${eng.scene.environmentIntensity}` );
      await look();
      await ipc.writeBinary( joinPath( dir, "day-plain.png" ), await eng.pictures.capture() );
    }
    if ( was && !fixed2?.checked ) fixed2?.click();
    io.stop();
    for ( const line of io.report() ) log( line );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
