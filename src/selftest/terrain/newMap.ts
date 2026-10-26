import { getEngine } from "../../ui/Viewport";
import { ipc } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/newmap ): as the studio starts ( an untitled map, the start window over it ), New Map
 * clicked; every frame meanwhile, whether a veil showed ( the busy one, the view's loading one ), the editor was taken
 * down or made again, and how long the frames took. Then the same from the project in the folder.
**/
export async function newMapSelftest( dir: string ) {
  try {
    const P = await import( "../../map/project" );
    await P.newUntitled();
    const eng0 = await waitFor( () => getEngine(), "engine", 60000 );
    await eng0.ready;
    await sleep( 1500 );
    const watchNewMap = async ( what: string ) => {
      useEditor.setState( { splash: true } );
      await sleep( 600 );
      const canvas0 = getEngine()?.renderer.domElement, app0 = document.querySelector( ".app" );
      const opacity = ( q: string ) => {
        const el = document.querySelector( q );
        return el ? Number( getComputedStyle( el ).opacity ) : 0;
      };
      let busy   = 0, veil = 0, gone = 0, frames = 0, worst = 0, last = performance.now(), on = true;
      const tick = () => {
        const t = performance.now();
        worst   = Math.max( worst, t - last );
        last    = t;
        frames++;
        if ( opacity( ".busy"       ) > 0.02 ) busy++;
        if ( opacity( ".vp-loading" ) > 0.02 ) veil++;
        if ( !document.querySelector( ".app" ) ) gone++;
        if ( on ) requestAnimationFrame( tick );
      };
      requestAnimationFrame( tick );
      const btn = [...document.querySelectorAll<HTMLButtonElement>( ".bsplash-item" )].find( ( b ) => b.textContent?.includes( "New Map" ) );
      if ( !btn ) log( "  (no New Map button: FAIL)" );
      btn?.click();
      await sleep( 2500 );
      on        = false;
      const bad = busy + veil + gone > 0 || getEngine()?.renderer.domElement !== canvas0 || document.querySelector( ".app" ) !== app0;
      log( `New Map ${what}: ${frames} frames, worst ${worst.toFixed( 0 )} ms; busy veil shown ${busy} frames, view's loading veil ${veil}, editor gone ${gone}; view ${getEngine()?.renderer.domElement === canvas0 ? "kept" : "made again"}, editor ${document.querySelector( ".app" ) === app0 ? "kept" : "made again"}; start window ${useEditor.getState().splash ? "still up (FAIL)" : "closed"}${bad ? " (FAIL: flickers)" : ""}` );
    };
    {
      const marks = [...document.querySelectorAll<HTMLImageElement>( ".card .thumb img.official" )];
      await sleep( 500 );
      log( `the game's mark: on ${marks.length} cards, ${marks.filter( ( m ) => m.complete && m.naturalWidth > 0 ).length} loaded (${marks[0]?.naturalWidth ?? 0} px)${marks.length && marks.every( ( m ) => m.naturalWidth > 0 ) ? "" : " (FAIL)"}` );
    }
    await watchNewMap( "on an empty map" );
    // from a saved map with things on it ( the one in the folder )
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( proj ) {
      await P.openProject( proj );
      await sleep( 1000 );
      await waitFor( () => ( getEngine()?.veil.loading ? null : true ), "the map's pieces", 300000 );
      await sleep( 1500 );
      await watchNewMap( "from a big saved map" );
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
