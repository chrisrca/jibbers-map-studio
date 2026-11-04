import { getEngine } from "../../ui/Viewport";
import { joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { terrain } from "../../terrain/terrain";
import { newUid, useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/newmaplook ): a new map's flat tile seen from far off, over each corner, with
 * nothing selected and with a piece selected. Each view is logged "SNAP <name>" and held two seconds for a screen
 * capture from outside ( the page's own, as the screen shows it, post-processing and all ): the ground drawn before the
 * game's snow came in showed brown, the rock where the snow goes, until something was selected.
**/
export async function newMapLookSelftest( dir: string ) {
  try {
    const { newEmptyProject } = await import( "../../map/project/sessions" );
    const { newModelObject }  = await import( "../../model/objects" );
    const { primitive }       = await import( "../../model/mesh" );
    await newEmptyProject( joinPath( dir, `look-${Date.now()}.jbrproj` ), "Untitled" );
    const eng                 = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await sleep( 3000 );
    const st   = () => useEditor.getState();
    const c    = terrain.chunks[0];
    log( `map: ${terrain.chunks.length} chunks; the first at ${c?.position.join( "," )}, ${c?.size.join( "x" )}, ${c?.res} a side` );
    const snap = async ( name: string ) => {
      await sleep( 1500 );
      log( `SNAP ${name}` );
      await sleep( 2500 );
    };
    const corners: [string, number, number][] = [["sw", -1, -1], ["se", 1, -1], ["ne", 1, 1], ["nw", -1, 1]];
    for ( const [name, sx, sz] of corners ) {
      eng.nav.lookAtUnity( [sx * 700, 260, sz * 700], [-sx * 100, 0, -sz * 100] );
      await snap( `${name}-none` );
    }
    // ( every tile of ground made with the game's snow in, none showing a stand-in swapped for it )
    const tiles = ( eng.terrainR as unknown as { tiles: { gameLook: boolean }[][] } ).tiles.flat();
    log( `${tiles.length && tiles.every( ( t ) => t.gameLook ) ? "ok  " : "FAIL"} ground: ${tiles.filter( ( t ) => t.gameLook ).length} of ${tiles.length} tiles made with the game's snow` );
    const cube = newModelObject( newUid(), primitive( "cube", { size: 1 } ), [0, 0.5, 0] );
    st().addCustom( cube, "Cube" );
    st().setSelection( [{ kind: "custom", uid: cube.uid }] );
    eng.nav.lookAtUnity( [-700, 260, -700], [100, 0, 100] );
    await snap( "sw-selected" );
    st().setSelection( [] );
    await snap( "sw-deselected" );
    // ( the cube made a repeat: its panel as it shows )
    st().setSelection( [{ kind: "custom", uid: cube.uid }] );
    await eng.menus.makeFence();
    eng.nav.lookAtUnity( [-6, 4, -6], [0, 0, 0] );
    await snap( "repeat" );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
