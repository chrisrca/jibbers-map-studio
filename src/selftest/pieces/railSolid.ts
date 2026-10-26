import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject, saveProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/railsolid ): a project in the folder ( a copy, its rail pieces "Mesh collidable"
 * with parts fitted before ) opened — the parts fitted again — and exported ( opened.jbrmap ); then each switched on
 * again as the checkbox does, and exported ( refit.jbrmap ), for a look at the colliders.
**/
export async function railSolidSelftest( dir: string ) {
  try {
    const { keepClear, withRail } = await import( "../../pieces/rail"    );
    const { partsFor }            = await import( "../../pieces/library" );
    const proj                    = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const parts = () => useEditor.getState().customObjects.filter( ( o ) => o.rail ).map( ( o ) => `${o.parts[0].mesh.split( "/" )[1]} ${o.rail!.parts?.length ?? 0}${o.rail!.whole ? " whole" : ""}, ${o.colliders.filter( ( c ) => c.mesh_ref === "studio-part" ).length} colliders` ).join( "; " );
    log( `opened: ${parts()}` );
    const t0 = performance.now();
    await waitFor( () => useEditor.getState().customObjects.every( ( o ) => !o.rail?.parts || keepClear( o.rail.parts, o.rail ) === o.rail.parts ) || null, "parts fitted again", 120000 );
    log( `fitted again in ${( ( performance.now() - t0 ) / 1000 ).toFixed( 1 )} s: ${parts()}` );
    await saveProject();
    let r = await ipc.exportProject( proj, joinPath( dir, "opened.jbrmap" ) );
    log( `exported opened: ${r.objects} objects` );
    const refit = [];
    for ( const o of useEditor.getState().customObjects ) {
      if ( !o.rail ) {
        refit.push( o );
        continue;
      }
      const body = await partsFor( o, o.rail );
      refit.push( withRail( o, { ...o.rail, ...body, solid: true } ) );
    }
    useEditor.setState( { customObjects: refit } );
    await saveProject();
    r = await ipc.exportProject( proj, joinPath( dir, "refit.jbrmap" ) );
    log( `refitted: ${parts()}` );
    log( "SELFTEST OK"          );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
