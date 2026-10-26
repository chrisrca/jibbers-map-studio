import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/sky ): the game's own sky through the day, at the times of the user's in-game
 * shots ( the map fixed at each hour, the sun turned 0 ): the sky above the horizon shot at each, and how bright the
 * sky, the horizon and the ground are.
**/
export async function skySelftest( dir: string ) {
  try {
    const P    = await import( "../../map/project" );
    const proj = ( await ipc.findProjects( dir ) )[0].dir;
    await P.openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await waitFor( () => ( eng.veil.loading ? null : true ),     "the map's pieces", 300000 );
    await waitFor( () => ( eng.daylight.gameSky ? true : null ), "the game's sky",   30000  );
    const band = async ( png: Uint8Array, y0: number, y1: number ) => {
      const bmp = await createImageBitmap( new Blob( [png as BlobPart], { type: "image/png" } ) );
      const c   = document.createElement( "canvas" );
      c.width   = 160;
      c.height  = 90;
      const g   = c.getContext( "2d" )!;
      g.drawImage( bmp, 0, 0, 160, 90 );
      const d = g.getImageData( 0, Math.round( y0 * 90 ), 160, Math.max( 1, Math.round( ( y1 - y0 ) * 90 ) ) ).data;
      let r   = 0, gg = 0, b = 0;
      for ( let i = 0; i < d.length; i += 4 ) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      return `${( r / n ).toFixed( 0 )},${( gg / n ).toFixed( 0 )},${( b / n ).toFixed( 0 )}`;
    };
    const c = terrain.heightAt( 0, 0 );
    for ( const [label, h] of [["0429", 4.483], ["0707", 7.117], ["0826", 8.433], ["1134", 11.567], ["1405", 14.083], ["1741", 17.683], ["1950", 19.833], ["2102", 21.033], ["2326", 23.433], ["0205", 2.083], ["0414", 4.233]] as const ) {
      const st = useEditor.getState();
      useEditor.setState( { map: { ...st.map!, overrideTime: true, dayTimeHours: h, sunAngle: 0 } } );
      await sleep( 300 );
      // ( facing −z, as the user's shots do: away from the sun at dusk, the moon ahead )
      eng.nav.lookAtUnity( [0, ( Number.isNaN( c ) ? 0 : c ) + 30, 0], [0, ( Number.isNaN( c ) ? 0 : c ) + 130, -300] );
      await sleep( 900 );
      const png = await eng.pictures.capture();
      await ipc.writeBinary( joinPath( dir, `sky-${label}.png` ), png );
      log( `${label}: night ${eng.daylight.night.toFixed( 2 )}; top ${await band( png, 0, 0.15 )}, middle ${await band( png, 0.4, 0.5 )}, bottom ${await band( png, 0.85, 1 )}; SHOT sky-${label}.png` );
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
