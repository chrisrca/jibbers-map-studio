import { LAYOUTS } from "../../terrain/generate";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { newProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/resort ): a new 3×3 km map, its chunks, how long it took, and its export's size.
**/
export async function resortSelftest( dir: string ) {
  try {
    const proj = joinPath( dir, `resort-${Date.now()}.jbrproj` );
    const t0   = performance.now();
    await newProject( proj, "Resort", { layout: LAYOUTS[1], base: "mountain", slopeDeg: 14, heightRange: 1200, seed: 7 } );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    log( `made in ${( ( performance.now() - t0 ) / 1000 ).toFixed( 1 )} s: ${terrain.chunks.length} chunks, ${[...new Set( terrain.chunks.map( ( c ) => `${c.size[0]} m @ ${c.res} (${c.spacing.toFixed( 3 )} m)` ) )].join( ", " )}` );
    log( "MEASURE resort" );
    await sleep( 3000 );
    const t1 = performance.now();
    const r  = await ipc.exportProject( proj, joinPath( dir, "resort.jbrmap" ) );
    log( `exported in ${( ( performance.now() - t1 ) / 1000 ).toFixed( 1 )} s: ${( r.bytes / 1e6 ).toFixed( 0 )} MB` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
