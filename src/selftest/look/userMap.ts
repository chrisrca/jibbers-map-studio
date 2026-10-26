import * as THREE from "three/webgpu";
import { customName } from "../../core/types";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/usermap ): a copy of a map as the user had it ( user/map.jbrproj in the folder )
 * opened: its time of day, what's lit and how ( lights in the map, lamps lit ), the sky and ground's brightness, and
 * shots — the view as it opens, the sky at the horizon, each piece with lights from close.
**/
export async function userMapSelftest( dir: string ) {
  try {
    const P            = await import( "../../map/project"               );
    const { lampsLit } = await import( "../../viewport/render/lamps"     );
    const { mapHour  } = await import( "../../viewport/render/timeOfDay" );
    const proj         = ( await ipc.findProjects( joinPath( dir, "user" ) ) )[0]?.dir;
    if ( !proj ) throw new Error( "no user/map.jbrproj" );
    await P.openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 1000 );
    await waitFor( () => ( eng.veil.loading ? null : true ), "the map's pieces", 300000 );
    await sleep( 3000 );
    const st = useEditor.getState();
    const bg = eng.scene.background;
    log( `map: ${terrain.chunks.length} chunks, ${st.objects.length} objects (${st.objects.map( ( o ) => o.id ).join( ", " )}), ${st.customObjects.length} pieces; hour ${mapHour( st.map )}; night ${eng.daylight.night.toFixed( 2 )}; background ${bg instanceof THREE.Color ? `a colour #${bg.getHexString()}` : bg ? "the sky" : "none"}; lights in the map ${eng.sceneLights.count}, lamps lit ${lampsLit()}` );
    for ( const o of st.customObjects ) log( `  piece ${customName( o )}: ${o.lights.length} lights${o.lights.length ? ` (${( o.lights as unknown as { intensity: number; range: number; local_position: { y: number } }[] ).map( ( l ) => `${l.intensity} at ${l.local_position.y.toFixed( 1 )} m, ${l.range} m` ).join( "; " )})` : ""}` );
    // brightness of a band of a shot ( 0 top … 1 bottom )
    const band = async ( png: Uint8Array, y0: number, y1: number ) => {
      const bmp = await createImageBitmap( new Blob( [png as BlobPart], { type: "image/png" } ) );
      const c   = document.createElement( "canvas" );
      c.width   = 160;
      c.height  = 90;
      const g   = c.getContext( "2d" )!;
      g.drawImage( bmp, 0, 0, 160, 90 );
      const d = g.getImageData( 0, Math.round( y0 * 90 ), 160, Math.max( 1, Math.round( ( y1 - y0 ) * 90 ) ) ).data;
      let sum = 0;
      for ( let i = 0; i < d.length; i += 4 ) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      return sum / ( d.length / 4 );
    };
    const shot = async ( name: string ) => {
      await sleep( 800 );
      const png = await eng.pictures.capture();
      await ipc.writeBinary( joinPath( dir, `${name}.png` ), png );
      log( `SHOT ${name}.png: top ${( await band( png, 0, 0.2 ) ).toFixed( 0 )}, middle ${( await band( png, 0.4, 0.6 ) ).toFixed( 0 )}, bottom ${( await band( png, 0.8, 1 ) ).toFixed( 0 )}` );
    };
    await shot( "as-opened" );
    // the sky: level, at the horizon
    const c = st.customObjects[0]?.position ?? { x: 0, y: 0, z: 0 };
    eng.nav.lookAtUnity( [c.x, c.y + 6, c.z - 40], [c.x, c.y + 6, c.z + 200] );
    await shot( "horizon" );
    // moonlit snow, well away from any lamp: looking down at the ground 150 m off
    eng.nav.lookAtUnity( [c.x + 150, terrain.heightAt( c.x + 150, c.z ) + 25, c.z - 30], [c.x + 150, terrain.heightAt( c.x + 150, c.z ), c.z + 10] );
    await shot( "moonlit" );
    for ( const o of st.customObjects.filter( ( x ) => x.lights.length ) ) {
      eng.nav.lookAtUnity( [o.position.x + 14, o.position.y + 9, o.position.z - 18], [o.position.x, o.position.y, o.position.z] );
      await shot( `lit-${customName( o ).replace( /[^a-z0-9]+/gi, "_" )}` );
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
