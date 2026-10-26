import { LAYOUTS } from "../../terrain/generate";
import { feature, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { loadLibrary, placeEntry } from "../../pieces/library";
import { newProject, saveProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/gamelook ): official features in a row, drawn with the game's own look.
**/
export async function gameLookSelftest( dir: string ) {
  try {
    const proj = joinPath( dir, `gamelook-${Date.now()}.jbrproj` );
    await newProject( proj, "Game look", { layout: LAYOUTS[0], base: "flat", slopeDeg: 0, heightRange: 100, seed: 1 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await loadLibrary();
    const g   = ( x: number, z: number ) => terrain.heightAt( x, z );
    const row = ["flat_box", "flat_box", "rail_long", "tube_long", "rainbow_box", "c_rail", "half_spine", "tree_spruce", "floodlight", "sign_billboard"];
    for ( const [k, id] of row.entries() ) {
      const x = ( k - row.length / 2 ) * 4;
      await placeEntry( feature( id ), [x, g( x, 0 ), 0], [0, 0, 0] );
    }
    // an old-style one ( the placeholder's look, as maps made before have them ), then given the game's
    const info = await ipc.appInfo();
    await placeEntry( `app:${joinPath( info.libraryDir, "Library", "Features", "Rails", "Rail Long.jbrasset" )}`, [0, g( 0, 8 ), 8], [0, 0, 0] );
    const old               = useEditor.getState().customObjects[useEditor.getState().customObjects.length - 1];
    const { applyGameLook } = await import( "../../pieces/library" );
    const before            = JSON.stringify( old.rail?.points ), changed = await applyGameLook( [old.uid] );
    const now               = useEditor.getState().customObjects.find( ( o ) => o.uid === old.uid )!;
    log( `old-style rail given the game's look: ${changed}; parts ${old.parts.map( ( p ) => p.mesh ).join( "," )} -> ${now.parts.map( ( p ) => p.mesh ).join( "," )}; rail kept ${JSON.stringify( now.rail?.points ) === before}, colliders kept ${JSON.stringify( now.colliders ) === JSON.stringify( old.colliders )}` );
    const first = useEditor.getState().customObjects[0];
    log( `placed pieces: ${first.parts.map( ( p ) => `${p.mesh} [${p.materials.map( ( m ) => m.base_tex ).join( "," )}]` ).join( " " )}` );
    await sleep( 6000 );
    let looks = 0;
    eng.scene.traverse( ( o ) => {
      if ( o.userData?.look ) looks++;
    } );
    log( `${row.length} features placed; drawn with the game's look: ${looks}` );
    log( `pieces at: ${useEditor.getState().customObjects.map( ( o ) => `${o.position.x.toFixed( 1 )},${o.position.y.toFixed( 1 )},${o.position.z.toFixed( 1 )}` ).join( " " )}` );
    eng.nav.lookAtUnity( [0, g( 0, -26 ) + 9, -26], [0, g( 0, 0 ) + 1, 0] );
    await sleep( 2500 );
    log( "SHOT gamelook" );
    await sleep( 5000 );
    eng.nav.lookAtUnity( [-14, g( -14, -9 ) + 3.5, -9], [-18, g( -18, 0 ) + 0.5, 0] );
    await sleep( 2500 );
    log( "SHOT gamelook_close" );
    await sleep( 2500 );
    await saveProject();
    const r = await ipc.exportProject( useEditor.getState().projectDir!, joinPath( dir, "gamelook.jbrmap" ) );
    log( `exported ${( r.bytes / 1e6 ).toFixed( 1 )} MB (${r.objects} objects)` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
