import { getEngine } from "../../ui/Viewport";
import { ipc } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/vram ): a big project in the folder opened, its previews drawn, then the Game tab
 * shown — with MEASURE lines at each step so the graphics memory the studio holds can be read from outside.
**/
export async function vramSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    log( "MEASURE start" );
    await sleep( 3000 );
    void openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 240000 );
    log( "MEASURE loaded" );
    await sleep( 3000 );
    const { previewsPending } = await import( "../../ui/previews" );
    await sleep( 1000 );
    await waitFor( () => previewsPending() === 0, "previews", 240000 );
    await sleep( 3000 );
    log( "MEASURE editor" );
    await sleep( 4000 );
    useEditor.setState( { centerTab: "game" } );
    await sleep( 4000 );
    log( "MEASURE gametab" );
    await sleep( 4000 );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
