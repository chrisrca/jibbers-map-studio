import { LAYOUTS } from "../../terrain/generate";
import { getEngine } from "../../ui/Viewport";
import { joinPath } from "../../core/ipc";
import { loadLibrary, placeEntry } from "../../pieces/library";
import { log, sleep, waitFor } from "../harness";
import { newProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/ui ): the main screens one after another, each held for a few seconds after a
 * "SHOT <name>" line so the whole window can be captured from outside ( the canvas capture can't see the UI ).
**/
export async function uiSelftest( dir: string ) {
  const hold = async ( name: string, ms = 5200 ) => {
    await sleep( 700 );
    log( `SHOT ${name}` );
    await sleep( ms );
  };
  try {
    await sleep( 1500 );
    await hold( "welcome" );
    const proj = joinPath( dir, `ui-${Date.now()}.jbrproj` );
    await newProject( proj, "Powder Ridge", { layout: LAYOUTS[0], base: "mountain", slopeDeg: 14, heightRange: 1200, seed: 7 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await sleep( 2500 );
    const g = ( x: number, z: number ) => terrain.heightAt( x, z );
    await loadLibrary();
    const meshes = useEditor.getState().assetLibrary.filter( ( e ) => e.kind === "mesh" );
    const picks  = [meshes.find( ( e ) => e.id.includes( "flat_box" ) ), meshes.find( ( e ) => e.id.includes( "rail" ) ), meshes.find( ( e ) => e.name.startsWith( "Person" ) )].filter( Boolean );
    for ( const [k, e] of picks.entries() ) await placeEntry( e!.id, [k * 6 - 6, g( k * 6 - 6, 20 ), 20], [0, 0, 0] );
    const last = useEditor.getState().customObjects.at( -1 );
    if ( last ) useEditor.getState().setSelection( [{ kind: "custom", uid: last.uid }] );
    eng.nav.lookAtUnity( [4, g( 4, -10 ) + 9, -10], [0, g( 0, 20 ) + 1, 20] );
    await hold( "object" );
    useEditor.getState().setTool( "sculpt" );
    await hold( "sculpt" );
    useEditor.getState().setTool( "paint" );
    useEditor.getState().setPaint( { tool: "marking" } );
    await hold( "paint" );
    useEditor.getState().setTool( "select" );
    // the File menu open
    const file = document.querySelector<HTMLElement>( '.topbar [data-menu="File"]' );
    file?.dispatchEvent( new MouseEvent( "mousedown", { bubbles: true, button: 0 } ) );
    await hold( "menu-file" );
    document.body.dispatchEvent( new MouseEvent( "mousedown", { bubbles: true, button: 0 } ) );
    // the mode dropdown open
    document.querySelector<HTMLElement>( ".mode-drop" )?.dispatchEvent( new MouseEvent( "mousedown", { bubbles: true, button: 0 } ) );
    await hold( "menu-mode" );
    document.body.dispatchEvent( new MouseEvent( "mousedown", { bubbles: true, button: 0 } ) );
    // map tab of the properties
    document.querySelectorAll<HTMLElement>( ".props-tabs button" )[2]?.click();
    await hold( "map-tab" );
    // the new map dialog
    window.dispatchEvent( new KeyboardEvent( "keydown", { key: "n", ctrlKey: true } ) );
    await hold( "dialog" );
    window.dispatchEvent( new KeyboardEvent( "keydown", { key: "Escape" } ) );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
