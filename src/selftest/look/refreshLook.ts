import type { CustomObjectEntry } from "../../core/types";
import { history } from "../../map/history";
import { ipc } from "../../core/ipc";
import { loadLibrary } from "../../pieces/library";
import { log, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/refreshlook ): a project in the folder whose game pieces were placed with an older
 * build of the game's look is opened; its pieces get the current build ( meshes and paint ).
**/
export async function refreshLookSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await loadLibrary();
    const key    = "Features/street_rainbow_rail/g0";
    const before = ( await ipc.prepareAssets( proj, "assets/library.jbrmap" ) ).meshes[key]?.submeshes;
    await openProject( proj );
    const pieces = useEditor.getState().customObjects.length;
    const t0     = performance.now();
    await waitFor( () => history.list().labels.some( ( l ) => l.includes( "updated" ) ), "the refresh", 300000 );
    const after          = ( await ipc.prepareAssets( proj, "assets/library.jbrmap" ) ).meshes[key]?.submeshes;
    const painted        = ( o: CustomObjectEntry ) => o.parts.some( ( p ) => p.materials.some( ( m ) => /-x\d+$/.test( ( m.metallic_tex as string ) || ( m.roughness_tex as string ) || "" ) ) );
    const newPaint       = useEditor.getState().customObjects.filter( painted ).length;
    const { officialOf } = await import( "../../pieces/library" );
    log( `without the new paint: ${useEditor.getState().customObjects.filter( ( o ) => !painted( o ) ).map( ( o ) => officialOf( o ) ?? o.uid ).join( ", " )}` );
    log( `${key}: ${JSON.stringify( before )} -> ${JSON.stringify( after )} after ${( ( performance.now() - t0 ) / 1000 ).toFixed( 0 )} s; ${newPaint} of ${pieces} pieces with the new paint; history: ${history.list().labels.slice( -2 ).join( " | " )}` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
