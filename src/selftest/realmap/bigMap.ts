import { getEngine } from "../../ui/Viewport";
import { joinPath } from "../../core/ipc";
import { log, realInput, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/bigmap ): a big map ( map.jbrproj in the folder ) opened, then left alone, then
 * looked round as a person does ( the camera turned and moved over it ): frame times for each, and the memory it holds.
 * "PHASE <name>" lines mark each part ( an outside profiler times its recordings by them ).
**/
export async function bigMapSelftest( dir: string ) {
  try {
    const t0 = performance.now();
    await openProject( joinPath( dir, "map.jbrproj" ) );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await waitFor( () => ( eng.veil.loading ? null : true ), "the map", 600000 );
    log( `opened: ${terrain.chunks.length} chunks in ${( ( performance.now() - t0 ) / 1000 ).toFixed( 1 )} s` );
    let phase = "open";
    const io  = realInput( eng, () => phase );
    const mem = () => {
      const m = ( performance as unknown as { memory?: { usedJSHeapSize: number } } ).memory;
      return m ? `${( m.usedJSHeapSize / 1e6 ).toFixed( 0 )} MB of JS heap` : "?";
    };
    const b = terrain.bounds(), cx = ( b.x0 + b.x1 ) / 2, cz = ( b.z0 + b.z1 ) / 2, gy = ( x: number, z: number ) => terrain.heightAt( x, z ) || 0;
    // from a rider's height over the middle, looking along the slope
    eng.nav.lookAtUnity( [cx, gy( cx, cz ) + 40, cz - 300], [cx, gy( cx, cz ), cz] );
    await sleep( 3000 );
    phase = "idle";
    log( `PHASE idle (${mem()})` );
    await sleep( 15000 );
    phase = "orbit";
    log( `PHASE orbit (${mem()})` );
    const tEnd = performance.now() + 15000;
    while ( performance.now() < tEnd ) {
      const t  = ( performance.now() - tEnd + 15000 ) / 15000, a = t * Math.PI * 2;
      const px = cx + Math.sin( a ) * 600, pz = cz - Math.cos( a ) * 600;
      eng.nav.lookAtUnity( [px, gy( px, pz ) + 80, pz], [cx, gy( cx, cz ), cz] );
      await new Promise( ( r ) => requestAnimationFrame( r ) );
    }
    phase = "high";
    log( `PHASE high (${mem()})` );
    // the whole map from high up
    eng.nav.lookAtUnity( [cx, gy( cx, cz ) + 3000, cz - 3500], [cx, gy( cx, cz ), cz] );
    await sleep( 8000 );
    io.stop();
    for ( const line of io.report() ) log( line );
    log( `PHASE done (${mem()})` );
    log( "SELFTEST OK"           );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
