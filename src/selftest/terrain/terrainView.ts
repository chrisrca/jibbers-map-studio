import { domShot, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/terrainview ): a project in the folder ( a copy ): the map drawn plain, with slope
 * colours, banded with hillshade, and with contour lines; the header's popover opened and drawn ( domShot ).
**/
export async function terrainViewSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st = () => useEditor.getState();
    eng.nav.frameAll();
    await sleep( 1500 );
    const set = async ( p: Partial<ReturnType<typeof st>["terrainView"]>, name: string ) => {
      useEditor.setState( { terrainView: { ...st().terrainView, ...p } } );
      await sleep( 600 );
      await ipc.writeBinary( joinPath( dir, `tv-${name}.png` ), await eng.pictures.capture() );
    };
    await set( {}, "plain" );
    await set( { slope: true }, "slope" );
    await set( { slopeStep: 5, hillshade: 0.8, exaggeration: 3 }, "bands-hillshade" );
    await set( { slope: false, slopeStep: 0, hillshade: 0.6, contours: 5 }, "contours" );
    const btn = document.querySelector<HTMLElement>( ".vp-header .pop-btn" );
    btn?.dispatchEvent( new MouseEvent( "mousedown", { button: 0, bubbles: true } ) );
    await sleep( 400 );
    log( `popover: ${document.querySelector( ".popover" ) ? "open" : "missing (FAIL)"}; sliders ${document.querySelectorAll( ".popover .num, .popover .nslider, .popover [class*=slider]" ).length}` );
    await domShot( document.querySelector( ".popover" ), joinPath( dir, "tv-popover.png" ) );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
