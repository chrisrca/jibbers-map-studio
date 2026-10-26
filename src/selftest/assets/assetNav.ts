import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/assetnav, the map to import named in the folder's map.txt ): the Assets tab
 * clicked: the map's own trees hidden with the rest of it; the view flown as in Design ( right-drag with W held ), and a
 * plain right-click on a selected cube opening its menu without moving the view.
**/
export async function assetNavSelftest( dir: string ) {
  try {
    const { importMap } = await import( "../../map/project" );
    const mapPath       = ( await ipc.readText( joinPath( dir, "map.txt" ) ) ).trim();
    await importMap( mapPath, joinPath( dir, `nav-${Date.now()}.jbrproj` ) );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const trees = eng.trees.builtTrees;
    await waitFor( () => trees.children.length > 0, "the map's trees", 60000 );
    log( `Design: map trees ${trees.children.length} groups, shown ${trees.visible}` );
    [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === "Assets" )?.click();
    await sleep( 1200 );
    log( `Assets: map trees shown ${trees.visible}` );
    eng.menus.addMenu( new DOMRect( 10, 10, 1, 1 ) );
    await sleep( 300 );
    [...document.querySelectorAll<HTMLElement>( ".bmenu-item" )].find( ( x ) => x.textContent?.trim() === "Cube" )?.click();
    await sleep( 600 );
    const canvas = eng.renderer.domElement, r = canvas.getBoundingClientRect();
    const c      = eng.controls, cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const ev     = ( type: string, x: number, y: number, buttons: number ) => {
      const init = { clientX: x, clientY: y, button: 2, buttons, pointerId: 81, bubbles: true };
      ( type === "pointerup" ? window : canvas ).dispatchEvent( new PointerEvent( type, init ) );
    };
    canvas.dispatchEvent( new PointerEvent( "pointerenter", { bubbles: true } ) );
    const at     = () => `${c.target.x.toFixed( 2 )},${c.target.y.toFixed( 2 )},${c.target.z.toFixed( 2 )} yaw ${c.yaw.toFixed( 2 )}`;
    // a plain right-click: the menu, the view where it was
    const before = at();
    ev( "pointerdown", cx, cy, 2 );
    await sleep( 80 );
    ev( "pointerup", cx, cy, 0 );
    await sleep( 400 );
    log( `right-click: menu "${document.querySelector( ".bmenu .bmenu-title, .bmenu" )?.textContent?.slice( 0, 40 )}"; view ${before === at() ? "unchanged" : `moved ${before} -> ${at()}`}` );
    document.dispatchEvent( new KeyboardEvent( "keydown", { key: "Escape", code: "Escape", bubbles: true } ) );
    window.dispatchEvent( new KeyboardEvent( "keydown", { key: "Escape", code: "Escape", bubbles: true } ) );
    await sleep( 300 );
    // flying: right-drag to look, W to go forward
    const b2 = at(), eye0 = eng.camera.position.clone();
    ev( "pointerdown", cx, cy, 2 );
    for ( let k = 1; k <= 10; k++ ) {
      ev( "pointermove", cx + k * 6, cy, 2 );
      await sleep( 16 );
    }
    window.dispatchEvent( new KeyboardEvent( "keydown", { key: "w", code: "KeyW", bubbles: true } ) );
    await sleep( 500 );
    window.dispatchEvent( new KeyboardEvent( "keyup", { key: "w", code: "KeyW", bubbles: true } ) );
    ev( "pointerup", cx + 60, cy, 0 );
    await sleep( 300 );
    log( `right-drag + W: ${b2} -> ${at()}; the eye moved ${eng.camera.position.distanceTo( eye0 ).toFixed( 2 )} m; no menu ${!document.querySelector( ".bmenu" )}` );
    // W while over the view, without the right button ( as in Design )
    const eye1 = eng.camera.position.clone();
    window.dispatchEvent( new KeyboardEvent( "keydown", { key: "w", code: "KeyW", bubbles: true } ) );
    await sleep( 400 );
    window.dispatchEvent( new KeyboardEvent( "keyup", { key: "w", code: "KeyW", bubbles: true } ) );
    await sleep( 100 );
    log( `W over the view: the eye moved ${eng.camera.position.distanceTo( eye1 ).toFixed( 2 )} m` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
