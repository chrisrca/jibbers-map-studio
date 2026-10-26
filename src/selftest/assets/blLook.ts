import * as THREE from "three/webgpu";
import { domShot, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/bllook ): a project in the folder ( a copy ): the Assets workspace with a cube, its
 * panels drawn to PNGs ( domShot: the app's own page, not the screen ) to compare with Blender's — header, toolbar,
 * Outliner, Properties, the navigator, the right-click menu — and a turn by the Rotate ring caught mid-drag.
**/
export async function blLookSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st = () => useEditor.getState();
    [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === "Assets" )?.click();
    await sleep( 1200 );
    eng.menus.addMenu( new DOMRect( 10, 10, 1, 1 ) );
    await sleep( 300 );
    [...document.querySelectorAll<HTMLElement>( ".bmenu-item" )].find( ( x ) => x.textContent?.trim() === "Cube" )?.click();
    await sleep( 300 );
    eng.menus.addMenu( new DOMRect( 10, 10, 1, 1 ) );
    await sleep( 300 );
    [...document.querySelectorAll<HTMLElement>( ".bmenu-item" )].find( ( x ) => x.textContent?.trim() === "Cube" )?.click();
    await sleep( 800 );
    log( `names: ${st().customObjects.map( ( o ) => st().labels[o.uid] ?? "(none)" ).join( ", " )}` );
    const cube = st().customObjects[0];
    st().setSelection( [{ kind: "custom", uid: cube.uid }] );
    useEditor.setState( { modelTool: "rotate" } );
    await sleep( 600 );
    const at = ( n: string ) => joinPath( dir, `look-${n}.png` );
    await domShot( document.querySelector( ".area.view3d .vp-header"     ),               at( "header"       ) );
    await domShot( document.querySelector( ".area.view3d .tool-settings" ),               at( "toolsettings" ) );
    await domShot( document.querySelector( ".tool-column"                ),               at( "toolbar"      ) );
    await domShot( document.querySelector( ".area.outliner"              ),               at( "outliner"     ) );
    await domShot( document.querySelector( ".nav-gizmo"                  ),               at( "navgizmo"     ) );
    await domShot( document.querySelector( ".props-editor" )?.closest( ".area" ) ?? null, at( "properties"   ) );
    // a corner of the navigator clicked: the view looks along it
    const nav   = document.querySelector<SVGSVGElement>( ".nav-gizmo svg" )!;
    const nr    = nav.getBoundingClientRect();
    const q0    = eng.camera.quaternion.clone();
    const zBall = [...nav.querySelectorAll( "g.nav-axis" )].map( ( g ) => g.querySelector( "circle" )! ).find( ( c ) => c.getAttribute( "fill" ) === "#2890ff" );
    const zx    = nr.left + +( zBall?.getAttribute( "cx" ) ?? 0 ), zy = nr.top + +( zBall?.getAttribute( "cy" ) ?? 0 );
    nav.dispatchEvent( new PointerEvent( "pointerdown", { clientX: zx, clientY: zy, button: 0, buttons: 1, pointerId: 31, bubbles: true } ) );
    nav.dispatchEvent( new PointerEvent( "pointerup",   { clientX: zx, clientY: zy, button: 0, buttons: 0, pointerId: 31, bubbles: true } ) );
    await sleep( 500 );
    const down = new THREE.Vector3( 0, 0, -1 ).applyQuaternion( eng.camera.quaternion );
    log( `navigator Z clicked: looking ${down.y < -0.99 ? "straight down (top view)" : `along ${down.toArray().map( ( v ) => v.toFixed( 2 ) )} (FAIL)`}; view changed ${q0.angleTo( eng.camera.quaternion ) > 0.01}` );
    eng.nav.viewAlong( "front" );
    await sleep( 400 );
    eng.controls.glideTo( { yaw: 0.5, pitch: -0.45 }, 1 );
    await sleep( 200 );
    // the Rotate gizmo's Z ring dragged a quarter turn ( caught mid-drag: the sector shown )
    const canvas   = eng.renderer.domElement, cr = canvas.getBoundingClientRect();
    const piv      = new THREE.Vector3( cube.position.x, cube.position.y, -cube.position.z );
    const [px, py] = eng.screenOf( piv );
    const ptr      = ( type: string, x: number, y: number, buttons: number ) => {
      const ev = new PointerEvent( type, { clientX: cr.left + x, clientY: cr.top + y, button: 0, buttons, pointerId: 32, bubbles: true } );
      if ( type === "pointerup" ) window.dispatchEvent( ev );
      else canvas.dispatchEvent( ev );
    };
    // a point on the Z ring ( the ring's near half ): searched for along a circle round the pivot
    let ring: [number, number] | null = null;
    for ( let k = 0; k < 360 && !ring; k += 3 ) {
      for ( let r = 50; r <= 110 && !ring; r += 2 ) {
        const x = px + Math.cos( ( k * Math.PI ) / 180 ) * r, y = py + Math.sin( ( k * Math.PI ) / 180 ) * r;
        eng.blGizmo.hoverAt( x, y );
        if ( ( eng.blGizmo as unknown as { hover: { kind: string; axis: number } | null } ).hover?.kind === "ring" && ( eng.blGizmo as unknown as { hover: { axis: number } } ).hover.axis === 2 ) ring = [x, y];
      }
    }
    log( `Z ring found on screen: ${ring ? "yes" : "no (FAIL)"}` );
    if ( ring ) {
      const a0 = Math.atan2( ring[1] - py, ring[0] - px ), rr = Math.hypot( ring[0] - px, ring[1] - py );
      ptr( "pointermove", ring[0], ring[1], 0 );
      ptr( "pointerdown", ring[0], ring[1], 1 );
      for ( let k = 1; k <= 12; k++ ) ptr( "pointermove", px + Math.cos( a0 + ( k / 12 ) * 1.3 ) * rr, py + Math.sin( a0 + ( k / 12 ) * 1.3 ) * rr, 1 );
      await sleep( 300 );
      log( `mid-turn readout: "${document.querySelector( ".vp-header.readout" )?.textContent ?? "(none) FAIL"}"` );
      await ipc.writeBinary( at( "rotating" ), await eng.pictures.capture() );
      await domShot( document.querySelector( ".area.view3d .vp-header" ), at( "header-rotating" ) );
      ptr( "pointerup", px + Math.cos( a0 + 1.3 ) * rr, py + Math.sin( a0 + 1.3 ) * rr, 0 );
      await sleep( 300 );
      const r1 = st().customObjects.find( ( o ) => o.uid === cube.uid )!.rotation;
      log( `after the turn: rotation (Blender's XYZ) ${( await import( "../../core/blenderAxes" ) ).rotToBlender( [r1.x, r1.y, r1.z] ).map( ( v ) => v.toFixed( 1 ) ).join( ", " )}` );
    }
    // the right-click menu, and its Set Origin submenu
    useEditor.setState( { modelTool: "select" } );
    await sleep( 300 );
    eng.menus.objectMenu();
    await sleep( 400 );
    const origin = [...document.querySelectorAll<HTMLElement>( ".bmenu-item" )].find( ( x ) => x.textContent?.includes( "Set Origin" ) );
    origin?.dispatchEvent( new MouseEvent( "mouseenter", { bubbles: false } ) );
    origin?.dispatchEvent( new MouseEvent( "mouseover",  { bubbles: true  } ) );
    await sleep( 400 );
    const menus = [...document.querySelectorAll( ".bmenu" )];
    log( `object menu: ${menus.length} menu(s) open; items ${[...menus[0]?.querySelectorAll( ".bmenu-item .lbl" ) ?? []].map( ( x ) => x.textContent ).join( " | " )}` );
    for ( const [i, m] of menus.entries() ) await domShot( m, at( `menu${i}` ) );
    document.dispatchEvent( new KeyboardEvent( "keydown", { key: "Escape", bubbles: true } ) );
    window.dispatchEvent( new MouseEvent( "mousedown", { bubbles: true } ) );
    await sleep( 200 );
    // Properties: the Transform numbers ( Blender's axes )
    useEditor.setState( { customObjects: st().customObjects.map( ( o ) => ( o.uid === cube.uid ? { ...o, position: { x: 1, y: 2, z: 3 } } : o ) ) } );
    await sleep( 400 );
    const vals = [...document.querySelectorAll( ".props .vec-cell .val" )].slice( 0, 3 ).map( ( x ) => x.textContent );
    log( `Properties Location (piece at the game's 1, 2, 3): ${vals.join( " / " )} (want 1 m / 3 m / 2 m)` );
    await domShot( document.querySelector( ".props-editor" )?.closest( ".area" ) ?? null, at( "properties2" ) );
    // the Design workspace: its tabs, header and toolbar; Blender's gizmo on a map piece, dragged along X
    log( `tabs: ${[...document.querySelectorAll( ".workspaces button" )].map( ( b ) => b.textContent ).join( " · " )}` );
    [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === "Design" )?.click();
    await sleep( 1200 );
    log( `Design: tool ${st().tool}, terrain ${eng.terrainR.group.visible ? "shown" : "hidden (FAIL)"}, map pieces ${st().customObjects.length}` );
    const piece = st().customObjects.find( ( o ) => !st().locked[o.uid] && !o.parts.some( ( x ) => x.mesh.startsWith( "Scenery/" ) ) );
    if ( piece ) {
      st().setSelection( [{ kind: "custom", uid: piece.uid }] );
      useEditor.setState( { tool: "select", gizmoMode: "translate" } );
      const P = new THREE.Vector3( piece.position.x, piece.position.y, -piece.position.z );
      eng.nav.lookAtUnity( [piece.position.x + 6, piece.position.y + 4, piece.position.z - 6], [piece.position.x, piece.position.y, piece.position.z] );
      await sleep( 900 );
      await domShot( document.querySelector( ".area.view3d .vp-header"     ),               at( "design-header"       ) );
      await domShot( document.querySelector( ".area.view3d .tool-settings" ),               at( "design-toolsettings" ) );
      await domShot( document.querySelector( ".tool-column"                ),               at( "design-toolbar"      ) );
      await domShot( document.querySelector( ".props-editor" )?.closest( ".area" ) ?? null, at( "design-properties"   ) );
      await ipc.writeBinary( at( "design-gizmo" ), await eng.pictures.capture() );
      // the canvas as drawn ( the outline pass included: the capture leaves it out )
      {
        await new Promise( ( r ) => requestAnimationFrame( () => requestAnimationFrame( r ) ) );
        const bmp = await createImageBitmap( eng.renderer.domElement );
        const oc  = new OffscreenCanvas( bmp.width, bmp.height );
        oc.getContext( "2d" )!.drawImage( bmp, 0, 0 );
        await ipc.writeBinary( at( "design-canvas" ), new Uint8Array( await ( await oc.convertToBlob( { type: "image/png" } ) ).arrayBuffer() ) );
      }
      const cr2      = eng.renderer.domElement.getBoundingClientRect();
      const [qx, qy] = eng.screenOf( P ), [ex, ey] = eng.screenOf( P.clone().add( new THREE.Vector3( 1, 0, 0 ) ) );
      const l        = Math.hypot( ex - qx, ey - qy ), ux = ( ex - qx ) / l, uy = ( ey - qy ) / l;
      const hx       = qx + ux * 78 * 0.6, hy = qy + uy * 78 * 0.6;
      const pe       = ( type: string, x: number, y: number, buttons: number ) => {
        const ev = new PointerEvent( type, { clientX: cr2.left + x, clientY: cr2.top + y, button: 0, buttons, pointerId: 33, bubbles: true } );
        if ( type === "pointerup" ) window.dispatchEvent( ev );
        else eng.renderer.domElement.dispatchEvent( ev );
      };
      pe( "pointermove", hx, hy, 0 );
      log( `Design gizmo: ${eng.blGizmo.attached ? "shown" : "missing (FAIL)"}, over the X arrow: ${eng.blGizmo.hoverAt( hx, hy )}` );
      pe( "pointerdown", hx, hy, 1 );
      for ( let k = 1; k <= 10; k++ ) pe( "pointermove", hx + ux * 6 * k, hy + uy * 6 * k, 1 );
      pe( "pointerup", hx + ux * 60, hy + uy * 60, 0 );
      await sleep( 300 );
      const p1 = st().customObjects.find( ( o ) => o.uid === piece.uid )!.position;
      log( `dragged the X arrow: x ${piece.position.x.toFixed( 2 )} -> ${p1.x.toFixed( 2 )}, y ${piece.position.y.toFixed( 2 )} -> ${p1.y.toFixed( 2 )}, z ${piece.position.z.toFixed( 2 )} -> ${p1.z.toFixed( 2 )}` );
      history.undo();
      await sleep( 200 );
      const p2 = st().customObjects.find( ( o ) => o.uid === piece.uid )!.position;
      log( `undo: ${Math.abs( p2.x - piece.position.x ) < 1e-6 ? "back" : "not back (FAIL)"}` );
    }
    // the navigator in Design too: its Z clicked looks straight down on the map
    {
      const nav2 = document.querySelector<SVGSVGElement>( ".nav-gizmo svg" );
      const z2   = nav2 && [...nav2.querySelectorAll( "g.nav-axis circle" )].find( ( c ) => c.getAttribute( "fill" ) === "#2890ff" );
      if ( !nav2 || !z2 ) log( "Design navigator: missing (FAIL)" );
      else {
        const r2 = nav2.getBoundingClientRect(), x = r2.left + +z2.getAttribute( "cx" )!, y = r2.top + +z2.getAttribute( "cy" )!;
        nav2.dispatchEvent( new PointerEvent( "pointerdown", { clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 34, bubbles: true } ) );
        nav2.dispatchEvent( new PointerEvent( "pointerup",   { clientX: x, clientY: y, button: 0, buttons: 0, pointerId: 34, bubbles: true } ) );
        await sleep( 500 );
        const look = new THREE.Vector3( 0, 0, -1 ).applyQuaternion( eng.camera.quaternion );
        log( `Design navigator: shown; Z clicked: ${look.y < -0.99 ? "top view" : "not top (FAIL)"}` );
        await domShot( document.querySelector( ".nav-gizmo" ), at( "design-navgizmo" ) );
      }
    }
    st().setTool( "sculpt" );
    await sleep( 600 );
    await domShot( document.querySelector( ".area.view3d .vp-header" ), at( "design-sculpt-header"  ) );
    await domShot( document.querySelector( ".tool-column"            ), at( "design-sculpt-toolbar" ) );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
