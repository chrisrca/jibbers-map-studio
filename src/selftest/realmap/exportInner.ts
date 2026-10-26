import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, waitFor } from "../harness";
import { openProject, saveProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/exportinner ): a copy of a real-world map with scenery ( map.jbrproj in the folder )
 * exported as Export does it ( the scenery's stand-in for the play area built, the map saved, then written; here into
 * the folder, not the game's ): whether the stand-in is in the saved map and the exported one.
**/
export async function exportInnerSelftest( dir: string ) {
  try {
    const proj = joinPath( dir, "map.jbrproj" );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await waitFor( () => ( eng.veil.loading ? null : true ), "the map", 600000 );
    const st = () => useEditor.getState();
    log( `opened: ${terrain.chunks.length} chunks, scenery ${st().customObjects.some( ( o ) => o.parts.some( ( p ) => /^Scenery\/[^/]+\/strip-/.test( p.mesh ) ) ) ? "there" : "missing"}` );
    const t0    = performance.now();
    const built = await ( await import( "../../geo/scenery/inner" ) ).updateSceneryInner().catch( ( e ) => `failed: ${e}` );
    log( `stand-in: ${built} in ${( ( performance.now() - t0 ) / 1000 ).toFixed( 1 )} s; scenery parts ${st().customObjects.flatMap( ( o ) => o.parts.map( ( p ) => p.mesh ) ).filter( ( m ) => m.startsWith( "Scenery/" ) ).map( ( m ) => m.split( "/" ).pop() ).join( ", " )}` );
    await saveProject();
    const saved = await ipc.readText( joinPath( proj, "project.json" ) );
    log( `saved: inner part ${saved.includes( "/inner" ) ? "in project.json" : "NOT in project.json (FAIL)"}` );
    const t1 = performance.now();
    const r  = await ipc.exportProject( proj, joinPath( dir, "out.jbrmap" ) );
    log( `exported in ${( ( performance.now() - t1 ) / 1000 ).toFixed( 1 )} s: ${JSON.stringify( r ).slice( 0, 200 )}` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
