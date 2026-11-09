import { ipc, joinPath } from "../../core/ipc";
import { newEmptyProject } from "../../map/project/sessions";
import { newUid, useEditor } from "../../map/store";
import { primitive } from "../../model/mesh";
import { newModelObject } from "../../model/objects";
import { assetObjects } from "../../pieces/assetScene";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/assetflow ): the Assets workspace as Blender's, as a person uses it on a new map:
 * into Assets by its tab; the asset bar there, a card clicked ( added to the scene ); a model file let go on the view
 * ( imported into the scene, not the library ); a cylinder made; the whole scene saved as one asset ( File › Save
 * As ); a new asset, then the saved one opened again ( its objects one by one, as they were ); exported as a .glb;
 * back in Design, the asset placed on the map as one piece.
**/
export async function assetFlowSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const F = await import( "../../pieces/assetFiles" );
    await newEmptyProject( joinPath( dir, `flow-${Date.now()}.jbrproj` ), "Asset flow" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the ground", 60000 );
    const st = () => useEditor.getState();
    // ---- into Assets by its tab
    [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === "Assets" )?.click();
    await sleep( 800 );
    check( st().tool === "model", `the Assets tab: tool ${st().tool}` );
    const fileMenu = () => {
      [...document.querySelectorAll<HTMLButtonElement>( ".topbar .bpull" )].find( ( b ) => b.textContent === "File" )?.dispatchEvent( new MouseEvent( "mousedown", { button: 0, bubbles: true } ) );
    };
    fileMenu();
    await sleep( 300 );
    const items = [...document.querySelectorAll( ".bmenu .lbl" )].map( ( x ) => x.textContent?.trim() ).filter( Boolean );
    log( `File menu in Assets: ${items.join( ", " )}` );
    check( ["New Asset", "Open…", "Import…", "Export glTF…", "Save", "Save As…"].every( ( l ) => items.includes( l ) ), "the File menu is the asset's" );
    window.dispatchEvent( new KeyboardEvent( "keydown", { key: "Escape", bubbles: true } ) );
    document.body.dispatchEvent( new MouseEvent( "mousedown", { bubbles: true } ) );
    await sleep( 300 );
    // ---- the asset bar there; a card clicked
    const card = await waitFor( () => [...document.querySelectorAll<HTMLElement>( ".area.assets .card" )].find( ( c ) => c.querySelector( ".name" )?.textContent === "Flat Box" ) ?? null, "the asset bar's Flat Box", 20000 ).catch( () => null );
    check( !!card, "the asset bar in Assets" );
    if ( card ) {
      const r = card.getBoundingClientRect();
      card.dispatchEvent( new PointerEvent( "pointerdown", { clientX: r.left + 20, clientY: r.top + 20, button: 0, buttons: 1, pointerId: 91, bubbles: true } ) );
      window.dispatchEvent( new PointerEvent( "pointerup", { clientX: r.left + 20, clientY: r.top + 20, button: 0, buttons: 0, pointerId: 91, bubbles: true } ) );
      await waitFor( () => ( assetObjects().length >= 1 ? true : null ), "the card's piece", 20000 ).catch( () => null );
    }
    check( st().tool === "model" && assetObjects().length === 1, `a card clicked: added to the scene ( ${assetObjects().length} objects, tool ${st().tool} )` );
    // ---- a model let go on the view
    const { emitTo }            = await import( "@tauri-apps/api/event" );
    const { getCurrentWebview } = await import( "@tauri-apps/api/webview" );
    const label                 = getCurrentWebview().label;
    const glb                   = joinPath( st().libraryDir, "placeholders", "ball.glb" );
    const before                = ( await ipc.listUserAssets() ).length;
    const vr                    = document.querySelector<HTMLElement>( ".viewport" )!.getBoundingClientRect();
    const at                    = { x: ( vr.left + vr.width / 2 ) * devicePixelRatio, y: ( vr.top + vr.height / 2 ) * devicePixelRatio };
    await emitTo( { kind: "Webview", label }, "tauri://drag-enter", { paths: [glb], position: at } );
    await sleep( 300 );
    const said = [...document.querySelectorAll( ".drop-zone.view .drop-what span" )].map( ( x ) => x.textContent ).join( " · " );
    await emitTo( { kind: "Webview", label }, "tauri://drag-drop", { paths: [glb], position: at } );
    await waitFor( () => ( assetObjects().length >= 2 ? true : null ), "the dropped model", 30000 ).catch( () => null );
    const after = ( await ipc.listUserAssets() ).length;
    check( assetObjects().length === 2 && after === before && said.includes( "Import" ), `a model let go on the view ( "${said}" ): ${assetObjects().length} objects; your library ${before} -> ${after}` );
    // ---- a cylinder made
    const cyl = newModelObject( newUid(), primitive( "cylinder", { size: 0.2, depth: 3 } ), [0, 1, 2] );
    st().addCustom( cyl, "Bar" );
    await sleep( 1500 );
    const objs  = assetObjects();
    const parts = objs.reduce( ( n, o ) => n + o.parts.length, 0 ), colliders = objs.reduce( ( n, o ) => n + o.colliders.length, 0 );
    // ---- the whole scene saved as one asset ( Save As, named )
    st().setSelection( [] );
    const name = `Flow Test ${Date.now() % 100000}`;
    check( await F.saveAsset( name ), "saved with nothing selected" );
    const ref = F.useAssetFile.getState().ref!;
    const got = await ipc.addAssetToProject( st().projectDir!, ref.path );
    const one = got.object as { parts: unknown[]; colliders: unknown[] };
    check( one.parts.length === parts && one.colliders.length === colliders, `saved as one piece: ${one.parts.length} parts of ${parts}, ${one.colliders.length} colliders of ${colliders}` );
    // ---- a new asset; the saved one opened again
    await F.newAsset();
    check( assetObjects().length === 0, "File › New: an empty scene" );
    await F.openAsset( ref.id, ref.name );
    await sleep( 1500 );
    const back = assetObjects();
    check( back.length === 3 && back.some( ( o ) => o.model ) && back.map( ( o ) => st().labels[o.uid] ).includes( "Bar" ), `opened again as its objects: ${back.length} ( ${back.map( ( o ) => st().labels[o.uid] ).join( ", " )} )` );
    log( "SNAP assetflow-opened" );
    await sleep( 1500 );
    // ---- exported as a .glb
    const out = joinPath( dir, "flow.glb" );
    const n   = await ipc.exportGlb( st().projectDir!, st().library ?? "assets/library.jbrmap", back.map( ( { uid: _u, model: _m, ...o } ) => o ), name, out );
    const bin = new Uint8Array( await ipc.readBinary( out ) );
    check( n === parts && new TextDecoder().decode( bin.subarray( 0, 4 ) ) === "glTF", `exported: ${n} meshes, ${bin.length} bytes` );
    // ---- in Design, placed as one piece
    [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === "Design" )?.click();
    await sleep( 800 );
    const n0 = st().customObjects.length;
    const { placeEntry } = await import( "../../pieces/library" );
    await placeEntry( ref.id, [0, terrain.heightAt( 0, 0 ), 0] );
    const placed = st().customObjects.slice( n0 );
    check( placed.length === 1 && placed[0].parts.length === parts, `placed on the map: ${placed.length} piece of ${placed[0]?.parts.length} parts` );
    await ipc.deleteUserAsset( ref.path ).catch( () => {} );
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
