import { getEngine } from "../../ui/Viewport";
import { ipc } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/loadveil ): a big project in the folder opened; the loading veil over the view is
 * logged as it changes ( pieces built of how many ) until the view is handed over, with the frame rate meanwhile, and a
 * SHOT while it's up.
**/
export async function loadVeilSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    const t0 = performance.now();
    const at = () => `${( ( performance.now() - t0 ) / 1000 ).toFixed( 1 )} s`;
    void openProject( proj );
    // ( the 3D view exists once a project is open )
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    log( `view up at ${at()}` );
    let last = "", shot = false, shownAt = -1;
    for ( ;; ) {
      const l   = eng.veil.loading;
      const now = l ? `${l.done} / ${l.total}` : "none";
      if ( now !== last ) {
        log( `veil at ${at()}: ${now}` );
        last = now;
      }
      if ( l && shownAt < 0 ) shownAt = performance.now();
      if ( l && !shot && l.total > 0 && l.done > l.total / 4 ) {
        shot = true;
        log( "SHOT veil" );
      }
      if ( !l && shownAt >= 0 ) break;
      if ( performance.now() - t0 > 240000 ) throw new Error( "the veil never lifted" );
      await sleep( 100 );
    }
    log( `veil up for ${( ( performance.now() - shownAt ) / 1000 ).toFixed( 1 )} s; pieces ${useEditor.getState().customObjects.length}, shown ${eng.customR.partCount} parts` );
    // how the view runs afterwards, second by second, with the asset bar's previews still being drawn
    const { previewsPending } = await import( "../../ui/previews" );
    const fps: string[]       = [];
    for ( let k = 0; k < 10; k++ ) {
      await sleep( 1000 );
      fps.push( `${eng.frameStamps.filter( ( s ) => s > performance.now() - 1000 ).length}fps/${previewsPending()}p` );
      if ( k === 1 ) log( "SHOT after" );
    }
    log( `after the veil (frames per second / previews pending): ${fps.join( " " )}` );
    // where a preview's time goes ( pieces from the library, timed one by one )
    const { entryObject } = await import( "../../ui/previews"    );
    const { userPath    } = await import( "../../pieces/library" );
    for ( const e of useEditor.getState().assetLibrary.filter( ( x ) => x.kind === "mesh" ).slice( 40, 45 ) ) {
      const a = performance.now();
      await ipc.libraryEntryPreview( userPath( e ) );
      const b   = performance.now();
      const obj = await entryObject( e );
      const c   = performance.now();
      await eng.pictures.renderPreview( obj );
      const d = performance.now();
      log( `preview "${e.name}": files ${( b - a ).toFixed( 0 )} ms, model ${( c - b ).toFixed( 0 )} ms, render ${( d - c ).toFixed( 0 )} ms` );
    }
    await sleep( 2000 );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
