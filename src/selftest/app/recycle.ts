import { ipc, joinPath } from "../../core/ipc";
import { log } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/recycle ): a throwaway project ( ~150 MB in 120 files, like a real import ) sent to
 * the Recycle Bin, counting the window's frames meanwhile: it must keep drawing ( deleting once froze the app ).
**/
export async function recycleSelftest( dir: string ) {
  try {
    const proj = joinPath( dir, "Jibbers Studio delete test.jbrproj" );
    await ipc.writeText( joinPath( proj, "project.json" ), "{}" );
    const chunk = new Uint8Array( 1_250_000 ).map( ( _, i ) => ( i * 2654435761 ) >>> 24 );
    for ( let k = 0; k < 120; k++ ) await ipc.writeBinary( joinPath( proj, "heights", `c_${k}.f32` ), chunk );
    log( `made ${proj}` );
    let frames = 0, worst = 0, last = performance.now(), going = true;
    const tick = () => {
      const t = performance.now();
      worst   = Math.max( worst, t - last );
      last    = t;
      frames++;
      if ( going ) requestAnimationFrame( tick );
    };
    requestAnimationFrame( tick );
    const t0 = performance.now();
    await ipc.recycle( proj );
    const secs = ( performance.now() - t0 ) / 1000;
    going      = false;
    log( `deleted in ${secs.toFixed( 1 )} s; the window drew ${frames} frames meanwhile (${( frames / Math.max( secs, 0.001 ) ).toFixed( 0 )} fps), longest wait ${worst.toFixed( 0 )} ms; still there: ${await ipc.pathExists( proj )}` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
