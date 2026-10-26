import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { log, realInput, sleep, waitFor } from "../harness";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/repeats ): a chunk repeated as a person does it — the map's properties ( nothing
 * picked ), its chunk clicked on the Map Size map, +Z, a step down in its offset, more copies — its copies shown in
 * the view ( Preview Repeats, on and off ), its seam fixed ( the step where copies meet gone, undone and done again ),
 * and the map exported with them. Frame times while the copies show.
**/
export async function repeatsSelftest( dir: string ) {
  try {
    const P    = await import( "../../map/project"     );
    const R    = await import( "../../terrain/repeats" );
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await P.openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 1000 );
    await waitFor( () => ( eng.veil.loading ? null : true ), "the map's pieces", 300000 );
    const st  = () => useEditor.getState();
    let phase = "start";
    const io  = realInput( eng, () => phase );
    st().setTool( "select" );
    st().setSelection( [] );
    await sleep( 600 );
    const $$ = <T extends Element = HTMLElement>( q: string ) => [...document.querySelectorAll<T & HTMLElement>( q )];
    // ( the Properties editor's Map tab )
    $$<HTMLButtonElement>( ".props-tabs button" ).find( ( b ) => b.title === "Map" )?.click();
    await sleep( 500 );
    // ---- a chunk at the map's edge, picked on the Map Size map
    phase      = "pick a chunk";
    const edge = [...terrain.chunks].sort( ( a, b ) => b.position[2] - a.position[2] )[0];
    const rect = $$<SVGRectElement>( ".mapsize-map rect.chunk" ).find( ( r ) => r.querySelector( "title" )?.textContent?.startsWith( edge.key ) ) ?? null;
    if ( !rect ) throw new Error( "no chunk on the Map Size map" );
    rect.dispatchEvent( new MouseEvent( "click", { bubbles: true } ) );
    await sleep( 300 );
    log( `picked chunk ${edge.key} (${edge.size[0]} m, ${edge.res}²): Chunk rows ${$$( ".chunk-repeat" ).length ? "shown" : "missing (FAIL)"}` );
    const btn = ( t: string ) => $$<HTMLButtonElement>( ".chunk-repeat button" ).find( ( b ) => b.textContent === t ) ?? null;
    btn( "+Z" )?.click();
    await sleep( 300 );
    // a step down, and five copies ( as the store's set by the fields )
    R.setRepeat( edge.key, { repeats: 5, offset: [0, -edge.size[0] * 0.15, edge.size[2]] } );
    await sleep( 500 );
    const tr = eng.terrainR as unknown as { ghosts: Map<unknown, THREE.Mesh[]>; repeats: Map<string, unknown[]> };
    log( `+Z: ${JSON.stringify( R.repeatOf( edge.key ) )}; copies to show ${tr.repeats.get( edge.key )?.length ?? 0}; undo step "${history.nextUndo}"` );
    // ---- the copies in the view
    phase      = "copies in view";
    // ( from the side and above: the chunk and its copies going on and down from it )
    const S    = edge.size[0], cx = edge.position[0] + S / 2, top = terrain.heightAt( cx, edge.position[2] + S / 2 );
    const look = async () => {
      eng.nav.lookAtUnity( [cx - S * 0.9, top + S * 0.45, edge.position[2] + S * 0.8], [cx, top - S * 0.2, edge.position[2] + S * 1.5] );
      await sleep( 1500 );
    };
    await look();
    const shown = [...tr.ghosts.values()].flat().filter( ( m ) => m.visible ).length;
    log( `ghost tiles in view: ${shown}${shown > 0 ? "" : " (FAIL)"}` );
    await ipc.writeBinary( joinPath( dir, "repeats.png" ), await eng.pictures.capture() );
    log( "SHOT repeats.png" );
    await io.drag( io.rc.width * 0.6, io.rc.height * 0.5, io.rc.width * 0.4, io.rc.height * 0.45, 900, 1 );
    // Preview Repeats off and on
    const check = $$<HTMLInputElement>( ".chunk-repeat input[type=checkbox]" )[0];
    check?.click();
    await sleep( 400 );
    const off = [...tr.ghosts.values()].flat().length;
    check?.click();
    await sleep( 800 );
    log( `Preview Repeats off: ${off} ghosts${off === 0 ? "" : " (FAIL)"}; on again: ${[...tr.ghosts.values()].flat().length}` );
    // ---- the seam
    phase      = "fix seam";
    const gap0 = R.seamGap( edge.key )!;
    const fix  = btn( "Fix Seam" );
    log( `seam before: ${gap0.toFixed( 2 )} m step; Fix Seam ${fix ? "shown" : "missing (FAIL)"}` );
    const t0 = performance.now();
    fix?.click();
    await waitFor( () => ( history.nextUndo === "Fix seam" ? true : null ), "the seam fixed", 30000 );
    const gap1 = R.seamGap( edge.key )!;
    // ( the corners shared with chunks beside it can't close all the way: the step along the rest of the seam )
    const n    = edge.res, inside = ( () => {
      let w = 0;
      for ( let k = 2; k < n - 2; k++ ) w = Math.max( w, Math.abs( edge.heights[k] + R.repeatOf( edge.key ).offset[1] - edge.heights[( n - 1 ) * n + k] ) );
      return w;
    } )();
    log( `Fix Seam: ${inside.toFixed( 4 )} m step along the seam${inside < 0.01 ? "" : " (FAIL)"}, ${gap1.toFixed( 2 )} m at its corners; in ${( performance.now() - t0 ).toFixed( 0 )} ms` );
    history.undo();
    await sleep( 300 );
    log( `undone: ${R.seamGap( edge.key )!.toFixed( 2 )} m step${Math.abs( R.seamGap( edge.key )! - gap0 ) < 1e-3 ? "" : " (FAIL)"}` );
    history.redo();
    await sleep( 300 );
    await look();
    await ipc.writeBinary( joinPath( dir, "seam-fixed.png" ), await eng.pictures.capture() );
    log( "SHOT seam-fixed.png" );
    io.stop();
    for ( const line of io.report() ) log( line );
    // ---- the map: the chunk's repeats in it
    phase = "export";
    await P.saveProject();
    const out = joinPath( dir, "repeats.jbrmap" );
    await ipc.exportProject( st().projectDir!, out );
    const text = await ipc.readText( out );
    const m    = text.match( /"repeats":\s*5/ );
    log( `exported: a chunk with "repeats": 5 ${m ? "there" : "missing (FAIL)"}` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
