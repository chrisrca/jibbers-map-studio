import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { useEditor, workspaceOf } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/assetcopy ): a project in the folder ( a copy ): in the Assets workspace, a cube
 * duplicated with Shift+D ( and moved, then clicked down ), copied with Ctrl+C and pasted with Ctrl+V, by keys as a
 * person presses them with the mouse over the view; what's in the scene after each logged.
**/
export async function assetCopySelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st = () => useEditor.getState();
    [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === "Assets" )?.click();
    await sleep( 1000 );
    eng.menus.addMenu( new DOMRect( 10, 10, 1, 1 ) );
    await sleep( 300 );
    [...document.querySelectorAll<HTMLElement>( ".bmenu-item" )].find( ( x ) => x.textContent?.trim() === "Cube" )?.click();
    await sleep( 600 );
    const canvas = eng.renderer.domElement, r = canvas.getBoundingClientRect();
    const mouse  = ( x: number, y: number ) => {
      canvas.dispatchEvent( new PointerEvent( "pointerenter", { bubbles: true } ) );
      canvas.dispatchEvent( new PointerEvent( "pointermove",  { clientX: r.left + x, clientY: r.top + y, buttons: 0, pointerId: 41, bubbles: true } ) );
    };
    const key = ( k: string, mods: { shift?: boolean; ctrl?: boolean } = {} ) => {
      const init = { key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, shiftKey: !!mods.shift, ctrlKey: !!mods.ctrl, bubbles: true, cancelable: true };
      window.dispatchEvent( new KeyboardEvent( "keydown", init ) );
      window.dispatchEvent( new KeyboardEvent( "keyup",   init ) );
    };
    const scene = () => st().customObjects.map( ( o ) => `${st().labels[o.uid] ?? "?"}@${o.position.x.toFixed( 2 )},${o.position.y.toFixed( 2 )},${o.position.z.toFixed( 2 )}` ).join( "  " );
    mouse( r.width / 2, r.height / 2 );
    await sleep( 200 );
    log( `start: ${scene()}; selected ${st().selection.length}` );
    key( "D", { shift: true } );
    await sleep( 200 );
    log( `Shift+D: ${st().customObjects.length} pieces; moving with the mouse: ${eng.blGizmo.dragging}` );
    mouse( r.width / 2 + 80, r.height / 2 );
    await sleep( 100 );
    canvas.dispatchEvent( new PointerEvent( "pointerdown", { clientX: r.left + r.width / 2 + 80, clientY: r.top + r.height / 2, button: 0, buttons: 1, pointerId: 41, bubbles: true } ) );
    window.dispatchEvent( new PointerEvent( "pointerup",   { clientX: r.left + r.width / 2 + 80, clientY: r.top + r.height / 2, button: 0, buttons: 0, pointerId: 41, bubbles: true } ) );
    await sleep( 200 );
    log( `after clicking it down: ${scene()}` );
    key( "c", { ctrl: true } );
    await sleep( 100 );
    mouse( r.width / 2 - 120, r.height / 2 + 40 );
    key( "v", { ctrl: true } );
    await sleep( 600 );
    log( `Ctrl+C, Ctrl+V: ${st().customObjects.length} pieces: ${scene()}` );
    // the header's Object › Duplicate: the copy moves with the mouse too
    const objMenu = [...document.querySelectorAll<HTMLButtonElement>( ".vp-header .bpull" )].find( ( b ) => b.textContent === "Object" );
    objMenu?.dispatchEvent( new MouseEvent( "mousedown", { button: 0, bubbles: true } ) );
    await sleep( 300 );
    [...document.querySelectorAll<HTMLElement>( ".bmenu-item" )].find( ( x ) => x.querySelector( ".lbl" )?.textContent === "Duplicate" )?.click();
    await sleep( 200 );
    log( `Object › Duplicate: ${st().customObjects.length} pieces; moving with the mouse: ${eng.blGizmo.dragging}` );
    key( "Escape" );
    await sleep( 200 );
    log( `Esc: ${st().customObjects.length} pieces (the copy stays, back where the original is: ${scene()})` );
    // each one drawn: its meshes built, with corners, shown ( a copy keeping the original's mesh names drew nothing )
    await eng.customR.settled;
    await sleep( 500 );
    const drawn = st().customObjects.map( ( o ) => {
      const g   = eng.customR.objectGroup( o.uid );
      let verts = 0, shown = !!g?.visible;
      g?.traverse( ( x ) => {
        const m = x as THREE.Mesh;
        if ( m.isMesh ) verts += m.geometry.getAttribute( "position" )?.count ?? 0;
      } );
      for ( let p: THREE.Object3D | null | undefined = g; p; p = p.parent ) shown &&= p.visible;
      return `${st().labels[o.uid]}: ${verts} corners${shown ? "" : " (hidden)"}; mesh ${o.parts[0]?.mesh}`;
    } );
    log( `drawn: ${drawn.join( "; " )}` );
    // Design's tool keys don't take you out of Assets ( T was Design's Paint Mode )
    for ( const k of ["t", "b", "v", "p"] ) key( k );
    await sleep( 300 );
    log( `after T, B, V, P: workspace ${workspaceOf( st().tool )}` );
    eng.nav.frameAll();
    await sleep( 800 );
    await ipc.writeBinary( joinPath( dir, "copies.png" ), await eng.pictures.capture() );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
