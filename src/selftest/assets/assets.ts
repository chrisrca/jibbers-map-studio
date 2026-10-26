import type { CustomObjectEntry } from "../../core/types";
import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { placeEntry } from "../../pieces/library";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/assets ): a project in the folder ( a copy ): the Assets tab clicked, a cube added
 * there, each shading looked at, then Layout and back: the map never gets the cube, the asset scene keeps it; views
 * left in the folder.
**/
export async function assetsSelftest( dir: string ) {
  try {
    const { mapState } = await import( "../../pieces/assetScene" );
    const proj         = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st        = () => useEditor.getState();
    const tab       = ( name: string ) => [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === name )?.click();
    const mapPieces = st().customObjects.length;
    log( `tabs: ${[...document.querySelectorAll( ".workspaces button" )].map( ( b ) => b.textContent ).join( " · " )}` );
    tab( "Assets" );
    await sleep( 1200 );
    log( `in Assets: pieces shown ${st().customObjects.length} (map's ${mapState().customObjects.length} kept aside, was ${mapPieces}), terrain ${eng.terrainR.group.visible ? "showing (FAIL)" : "hidden"}, asset bar ${document.querySelector( ".area.assets" ) ? "there (FAIL)" : "gone"}` );
    const r = eng.renderer.domElement.getBoundingClientRect();
    eng.menus.addMenu( new DOMRect( r.left + 40, r.top + 40, 30, 20 ) );
    await sleep( 300 );
    [...document.querySelectorAll<HTMLElement>( ".bmenu-item" )].find( ( x ) => x.textContent?.trim() === "Cube" )?.click();
    await sleep( 1000 );
    log( `cube added: ${st().customObjects.length} piece(s) in the asset scene, at ${JSON.stringify( st().customObjects[0]?.position )}; map ${mapState().customObjects.length}` );
    const texts = ( sel: string ) => [...document.querySelectorAll<HTMLElement>( sel )].map( ( b ) => ( b.getAttribute( "title" ) || b.textContent || "" ).trim() );
    log( `header: ${texts( ".view3d .vp-header > button, .view3d .vp-header .bpull, .view3d .vp-header .hb" ).join( " | " )}` );
    log( `toolbar (object): ${texts( ".tool-column .tool" ).join( ", " )}` );
    // the Move tool: its gizmo's X arrow dragged right with the mouse
    const cube = st().customObjects[0];
    st().setSelection( [{ kind: "custom", uid: cube.uid }] );
    useEditor.setState( { modelTool: "move" } );
    await sleep( 400 );
    const canvas   = eng.renderer.domElement, cr = canvas.getBoundingClientRect();
    const piv      = new THREE.Vector3( cube.position.x, cube.position.y, -cube.position.z );
    const [px, py] = eng.screenOf( piv ), [ax, ay] = eng.screenOf( piv.clone().add( new THREE.Vector3( 0.6, 0, 0 ) ) );
    const len      = Math.hypot( ax - px, ay - py ), ux = ( ax - px ) / len, uy = ( ay - py ) / len;
    const hx       = px + ux * 78 * 0.6, hy = py + uy * 78 * 0.6;
    const ptr      = ( type: string, x: number, y: number, buttons: number ) => {
      const ev = new PointerEvent( type, { clientX: cr.left + x, clientY: cr.top + y, button: 0, buttons, pointerId: 21, bubbles: true } );
      if ( type === "pointerup" ) window.dispatchEvent( ev );
      else canvas.dispatchEvent( ev );
    };
    canvas.dispatchEvent( new PointerEvent( "pointerenter", { bubbles: true } ) );
    ptr( "pointermove", hx, hy, 0 );
    log( `move gizmo: ${eng.blGizmo.attached ? "shown" : "missing (FAIL)"}, hovering the X arrow: ${eng.blGizmo.hoverAt( hx, hy )}` );
    const x0 = cube.position.x;
    ptr( "pointerdown", hx, hy, 1 );
    for ( let k = 1; k <= 10; k++ ) ptr( "pointermove", hx + ux * 6 * k, hy + uy * 6 * k, 1 );
    ptr( "pointerup", hx + ux * 60, hy + uy * 60, 0 );
    await sleep( 200 );
    const c1 = st().customObjects[0];
    log( `dragged the X arrow: x ${x0.toFixed( 2 )} -> ${c1.position.x.toFixed( 2 )}, y ${cube.position.y.toFixed( 2 )} -> ${c1.position.y.toFixed( 2 )}, z ${cube.position.z.toFixed( 2 )} -> ${c1.position.z.toFixed( 2 )}` );
    await ipc.writeBinary( joinPath( dir, "assets-gizmo.png" ), await eng.pictures.capture() );
    // Edit Mode from the mode menu, the Extrude tool on the top face
    const { setAssetMode } = await import( "../../ui/blender/AssetsUI" );
    setAssetMode( "edit" );
    await sleep( 500 );
    log( `edit mode: ${eng.modelEd.uid ? "on" : "off (FAIL)"}; toolbar (edit): ${texts( ".tool-column .tool" ).join( ", " )}` );
    eng.modelEd.picking.setMode( "face" );
    const m0        = st().customObjects[0].model!.mesh;
    const top       = m0.f.findIndex( ( f ) => f.every( ( v ) => m0.v[v][1] > 0.9 ) );
    eng.modelEd.sel = ( await import( "../../model/ops" ) ).selFromFaces( m0, [top] );
    useEditor.setState( { modelTool: "extrude" } );
    await sleep( 200 );
    const c2       = st().customObjects[0];
    const [tx, ty] = eng.screenOf( new THREE.Vector3( c2.position.x, c2.position.y + 1, -c2.position.z ) );
    ptr( "pointermove", tx, ty, 0 );
    ptr( "pointerdown", tx, ty, 1 );
    for ( let k = 1; k <= 8; k++ ) ptr( "pointermove", tx, ty - 6 * k, 1 );
    ptr( "pointerup", tx, ty - 48, 0 );
    await sleep( 300 );
    const m1 = st().customObjects[0].model!.mesh;
    log( `extrude tool: ${m0.f.length} -> ${m1.f.length} faces, top ${Math.max( ...m0.v.map( ( v ) => v[1] ) ).toFixed( 2 )} -> ${Math.max( ...m1.v.map( ( v ) => v[1] ) ).toFixed( 2 )}` );
    await ipc.writeBinary( joinPath( dir, "assets-extruded.png" ), await eng.pictures.capture() );
    setAssetMode( "object" );
    useEditor.setState( { modelTool: "select" } );
    await sleep( 300 );
    for ( const [name, v] of [
      ["solid",    { shading: "solid"    }],
      ["wire",     { shading: "wire"     }],
      ["xray",     { shading: "solid",    xray:     true }],
      ["faces",    { shading: "solid",    xray:     false, overlays: { ...st().view3d.overlays, faceOrientation: true } }],
      ["material", { shading: "material", overlays: { ...st().view3d.overlays, faceOrientation: false } }],
      ["rendered", { shading: "rendered" }],
    ] as const ) {
      useEditor.setState( { view3d: { ...st().view3d, ...( v as object ) } } );
      await sleep( 700 );
      await ipc.writeBinary( joinPath( dir, `assets-${name}.png` ), await eng.pictures.capture() );
    }
    useEditor.setState( { view3d: { ...st().view3d, shading: "solid" } } );
    await sleep( 500 );
    {
      // the corner of the view: as the screen has it ( the canvas itself ) and as the capture has it
      eng.renderer.render( eng.scene, eng.camera );
      const bmp = await createImageBitmap( canvas );
      const oc  = new OffscreenCanvas( bmp.width, bmp.height ).getContext( "2d" )!;
      oc.drawImage( bmp, 0, 0 );
      const live = [...oc.getImageData( 4, 4, 1, 1 ).data].slice( 0, 3 );
      const shot = new OffscreenCanvas( 1280, 720 ).getContext( "2d" )!;
      shot.drawImage( await createImageBitmap( new Blob( [( await eng.pictures.capture() ) as Uint8Array<ArrayBuffer>] ) ), 0, 0 );
      log( `background: screen ${live.join( "," )}, capture ${[...shot.getImageData( 4, 4, 1, 1 ).data].slice( 0, 3 ).join( "," )} (Blender's 61,61,61)` );
    }
    tab( "Design" );
    await sleep( 1000 );
    log( `back in Layout: map pieces ${st().customObjects.length} (was ${mapPieces}), terrain ${eng.terrainR.group.visible ? "back" : "hidden (FAIL)"}` );
    tab( "Assets" );
    await sleep( 1000 );
    log( `Assets again: ${st().customObjects.length} piece(s) (the cube kept: ${st().customObjects.some( ( o ) => o.model ) ? "yes" : "no (FAIL)"})` );
    // saved as an asset, placed on the map, saved over: the placed one follows; opened again from the library
    const files         = await import( "../../pieces/assetFiles" );
    const { withModel } = await import( "../../model/objects"     );
    const name          = `Selftest asset ${Date.now() % 100000}`;
    st().setSelection( [{ kind: "custom", uid: st().customObjects[0].uid }] );
    log( `save as new: ${( await files.saveAsset( name ) ) ? "saved" : "FAILED"}; header text "${document.querySelector( ".view-text" )?.textContent?.slice( 0, 60 )}"` );
    const ref   = files.useAssetFile.getState().ref;
    const entry = st().assetLibrary.find( ( e ) => e.id === ref?.id );
    log( `in the library: ${entry ? entry.name : "missing (FAIL)"}` );
    tab( "Design" );
    await sleep( 800 );
    const at: [number, number, number] = [mapState().customObjects[0]?.position.x ?? 0, ( mapState().customObjects[0]?.position.y ?? 0 ) + 5, mapState().customObjects[0]?.position.z ?? 0];
    await placeEntry( ref!.id, at );
    const placed = st().customObjects.find( ( o ) => o.source?.id === ref!.id );
    log( `placed on the map: ${placed ? `at ${JSON.stringify( placed.position )}, source ${placed.source!.id.slice( 0, 12 )}…` : "missing (FAIL)"}` );
    tab( "Assets" );
    await sleep( 800 );
    const a0   = st().customObjects[0];
    const tall = { ...a0.model!, mesh: { ...a0.model!.mesh, v: a0.model!.mesh.v.map( ( [x, y, z] ) => [x, y * 2, z] as [number, number, number] ) } };
    useEditor.setState( { customObjects: [withModel( a0, tall )] } );
    const height = async ( o?: CustomObjectEntry ) => {
      const v = o && ( await eng.customR.localVertices( o ) );
      let hi  = -Infinity;
      if ( v ) for ( let k = 1; k < v.length; k += 3 ) hi = Math.max( hi, v[k] );
      return hi;
    };
    const before = await height( mapState().customObjects.find( ( o ) => o.uid === placed?.uid ) );
    log( `save over: ${( await files.saveAsset() ) ? "saved" : "FAILED"}` );
    const after = mapState().customObjects.find( ( o ) => o.uid === placed?.uid );
    const h1    = await height( after );
    log( `placed copy: ${after ? `${h1 - before > 0.5 ? "updated" : "unchanged (FAIL)"} (top ${before.toFixed( 2 )} -> ${h1.toFixed( 2 )})` : "gone (FAIL)"}, where it was: ${after && Math.abs( after.position.x - placed!.position.x ) < 1e-4 && Math.abs( after.position.y - placed!.position.y ) < 1e-4 ? "yes" : "no (FAIL)"}` );
    tab( "Design" );
    await sleep( 800 );
    const r2   = files.useAssetFile.getState().ref!;
    const side = await ipc.readText( joinPath( await files.sideDir( r2.path ), "model.json" ) ).then( ( t ) => JSON.parse( t ).stamp as number ).catch( ( e ) => `unread (${e})` );
    log( `asset ${r2.id === ref!.id ? "kept its id" : `id changed (FAIL): ${r2.id}`}; kept model stamped ${side}, file ${( await ipc.fileStamp( r2.path ) )?.[1]}` );
    await files.openAsset( r2.id, r2.name );
    await sleep( 800 );
    const re = st().customObjects;
    log( `opened from the library: tab ${st().tool}, ${re.length} piece(s), model ${re[0]?.model ? `kept (top ${Math.max( ...re[0].model.mesh.v.map( ( v ) => v[1] ) ).toFixed( 2 )})` : "lost (FAIL)"}` );
    // ( tidied away )
    await ipc.deleteUserAsset( ref!.path );
    tab( "Design" );
    await sleep( 500 );
    useEditor.setState( { customObjects: st().customObjects.filter( ( o ) => o.uid !== placed?.uid ) } );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
