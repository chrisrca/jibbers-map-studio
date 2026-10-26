import type { V3 } from "../../core/coords";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { terrain } from "../../terrain/terrain";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/terrainlines ): the terrain's lighting on ground with nothing to show: a flat
 * plane and a tilted one, from above and at an angle: how much the brightness wanders across them ( lines or dots from
 * the renderer show as spread ), and pictures.
**/
export async function terrainLinesSelftest( dir: string ) {
  try {
    const P = await import( "../../map/project" );
    await P.newEmptyProject( joinPath( dir, `lines-${Date.now()}.jbrproj` ), "Lines" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 1500 );
    for ( const [name, slope] of [["flat", 0], ["tilted", 0.15]] as const ) {
      const res = 1025, h = new Float32Array( res * res );
      for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 300 + slope * ( i - j ) * 1;
      terrain.setChunks( [{ key: "a", position: [0, 0, 0], size: [1024, 1000, 1024], res, heights: h }, { key: "b", position: [1024, 0, 0], size: [1024, 1000, 1024], res, heights: h.map( ( v ) => v + slope * 1024 ) }] );
      await sleep( 2500 );
      for ( const [view, eye] of [["above", [1024, 1400, 512]], ["angle", [600, 700, -300]]] as const ) {
        eng.nav.lookAtUnity( eye as unknown as V3, [1024, 300, 512] );
        await sleep( 1200 );
        const png = await eng.pictures.capture();
        await ipc.writeBinary( joinPath( dir, `${name}-${view}.png` ), png );
        log( `SHOT ${name}-${view}.png` );
      }
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
