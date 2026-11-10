import { toThree, type V3 } from "../../core/coords";
import { joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/blenderselect ): Edit Mode's selecting as Blender has it, with the mouse and
 * keys: a box takes only what can be seen ( all of it with X-ray, Alt+Z ), Shift and Ctrl boxes add and take away;
 * Shift+click makes a selected one active before it lets it go; Ctrl+click the shortest path; Alt+click a loop,
 * Ctrl+Alt+click a ring; L and Shift+L under the mouse, Ctrl+L; Ctrl+Numpad + / - more and less; Ctrl+I in edge
 * select; H, Shift+H and Alt+H ( what was selected stays so ); the header's Select menu.
**/
export async function blenderSelectSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const P = await import( "../../map/project" );
    await P.newEmptyProject( joinPath( dir, `select-${Date.now()}.jbrproj` ), "Blender Select" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await sleep( 1000 );
    const st = () => useEditor.getState();
    [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === "Assets" )?.click();
    await sleep( 1200 );
    const io    = realInput( eng, () => "select" );
    const frame = () => new Promise<void>( ( r ) => requestAnimationFrame( () => r() ) );
    const key   = async ( k: string, m: { ctrl?: boolean; shift?: boolean; alt?: boolean; code?: string } = {} ) => {
      const init = { key: k, code: m.code ?? ( k.length === 1 ? ( /[0-9]/.test( k ) ? `Digit${k}` : `Key${k.toUpperCase()}` ) : k ), ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: !!m.alt, bubbles: true, cancelable: true };
      window.dispatchEvent( new KeyboardEvent( "keydown", init ) );
      window.dispatchEvent( new KeyboardEvent( "keyup", init ) );
      await frame();
      await sleep( 60 );
    };
    const W = io.rc.width, H = io.rc.height;
    await io.glide( W / 2, H / 2, 200 );
    const menu = async ( label: string ) => {
      await sleep( 200 );
      const it = [...document.querySelectorAll<HTMLElement>( ".bmenu .bmenu-item" )].find( ( x ) => x.textContent?.trim().startsWith( label ) );
      it?.click();
      await sleep( 300 );
      return !!it;
    };
    const me  = () => st().modelEdit;
    // ( where a point is on the screen: x and y only )
    const scr = ( p: V3 ) => eng.screenOf( toThree( p ) ).slice( 0, 2 ) as [number, number];

    // ---------------------------------------------------------------- a cube: boxes, X-ray, clicks
    await key( "A", { shift: true } );
    await menu( "Cube" );
    await sleep( 500 );
    eng.nav.lookAtUnity( [3.2, 3.4, -4.2], [0, 0, 0] );
    await sleep( 700 );
    await key( "Tab" );
    await key( "1" );
    await key( "a", { alt: true } );
    // a box round the whole cube: the seven corners in view, not the one behind ( as Blender's, X-ray off )
    const corners = [-1, 1].flatMap( ( x ) => [-1, 1].flatMap( ( y ) => [-1, 1].map( ( z ) => scr( [x, y, z] ) ) ) );
    const x0 = Math.min( ...corners.map( ( c ) => c[0] ) ) - 30, x1 = Math.max( ...corners.map( ( c ) => c[0] ) ) + 30;
    const y0 = Math.min( ...corners.map( ( c ) => c[1] ) ) - 30, y1 = Math.max( ...corners.map( ( c ) => c[1] ) ) + 30;
    await io.drag( x0, y0, x1, y1, 300 );
    await sleep( 200 );
    const seen = me()?.verts;
    await key( "z", { alt: true } );
    await io.drag( x0, y0, x1, y1, 300 );
    await sleep( 200 );
    const xray = me()?.verts;
    await key( "z", { alt: true } );
    check( seen === 7 && xray === 8, `a box round the cube: ${seen} corners ( the one behind left ); with X-ray ( Alt+Z ): ${xray}` );
    // a Ctrl box takes the right half away; a Shift box puts it back ( from the seven in view, X-ray off )
    await io.drag( x0, y0, x1, y1, 300 );
    await sleep( 200 );
    const mid = scr( [0, 0, 0] );
    await io.drag( mid[0], y0, x1, y1, 300, 0, { ctrlKey: true } );
    await sleep( 200 );
    const less = me()?.verts;
    await io.drag( mid[0], y0, x1, y1, 300, 0, { shiftKey: true } );
    await sleep( 200 );
    check( ( less ?? 7 ) < 7 && me()!.verts === 7, `a Ctrl box took ${7 - ( less ?? 7 )} away; a Shift box: ${me()?.verts} again` );
    // Shift+click: a selected one not active becomes active ( still selected ); again, it's let go
    const a = scr( [1, 1, -1] ), b = scr( [1, 1, 1] );
    await io.click( ...a ); await sleep( 120 );
    await io.click( ...b, 300, { shiftKey: true } ); await sleep( 120 );
    await io.click( ...a, 300, { shiftKey: true } ); await sleep( 120 );
    const still = me()?.verts, active = eng.modelEd.active;
    await io.click( ...a, 300, { shiftKey: true } ); await sleep( 120 );
    check( still === 2 && active !== null && me()!.verts === 1, `Shift+click on a selected one: ${still} still selected, it active; again: ${me()?.verts} left` );
    await key( "Tab" );

    // ---------------------------------------------------------------- a grid: paths, loops, rings, more, less
    await key( "A", { shift: true } );
    await menu( "Grid" );
    await sleep( 500 );
    eng.nav.lookAtUnity( [0, 2.6, -1.6], [0, 0, 0] );
    await sleep( 700 );
    await key( "Tab" );
    await key( "1" );
    await key( "a", { alt: true } );
    const gv = ( i: number, j: number ): V3 => [-1 + 0.2 * i, 0, -1 + 0.2 * j];
    await io.click( ...scr( gv( 1, 4 ) ) ); await sleep( 120 );
    await io.click( ...scr( gv( 9, 4 ) ), 300, { ctrlKey: true } ); await sleep( 150 );
    check( me()?.verts === 9, `Ctrl+click along a row: the shortest path, ${me()?.verts} vertices ( Blender: 9 )` );
    // Alt+click an edge: its loop across the grid; Ctrl+Alt+click: its ring
    await key( "2" );
    const e0 = gv( 5, 5 ), e1 = gv( 6, 5 ), em = scr( [( e0[0] + e1[0] ) / 2, 0, e0[2]] );
    await io.click( ...em, 300, { altKey: true } ); await sleep( 150 );
    const loop = me()?.edges;
    await io.click( ...em, 300, { altKey: true, ctrlKey: true } ); await sleep( 150 );
    check( loop === 10 && me()!.edges === 11, `Alt+click: a loop of ${loop} edges ( Blender: 10 ); Ctrl+Alt+click: a ring of ${me()?.edges} ( Blender: 11 )` );
    // Ctrl+I in edge select: the other edges
    await key( "i", { ctrl: true } );
    check( me()?.edges === 220 - 11, `Ctrl+I: the other ${me()?.edges} edges ( Blender: ${220 - 11} )` );
    // Ctrl+Numpad + and - from the middle vertex
    await key( "1" );
    await key( "a", { alt: true } );
    await io.click( ...scr( gv( 5, 5 ) ) ); await sleep( 120 );
    await key( "+", { ctrl: true, code: "NumpadAdd" } );
    const nine = me()?.verts;
    await key( "+", { ctrl: true, code: "NumpadAdd" } );
    const many = me()?.verts;
    await key( "-", { ctrl: true, code: "NumpadSubtract" } );
    check( nine === 9 && many === 25 && me()!.verts === 9, `Ctrl+Numpad +: ${nine}, again ${many} ( Blender: 9, 25 ); Ctrl+Numpad -: ${me()?.verts}` );
    // the header's Select menu: More
    const pull = [...document.querySelectorAll<HTMLElement>( ".vp-header .bpull, .vp-header button" )].find( ( x ) => x.textContent?.trim() === "Select" );
    pull?.dispatchEvent( new MouseEvent( "mousedown", { button: 0, bubbles: true, cancelable: true } ) );
    pull?.click();
    const more = await menu( "More" );
    check( more && me()?.verts === 25, `Select › More from the header: ${me()?.verts}` );
    // H hides; Shift+H the rest; Alt+H back, what was selected kept and the hidden added
    await key( "a", { alt: true } );
    await io.click( ...scr( gv( 2, 2 ) ) ); await sleep( 120 );
    await key( "h" );
    const hidden = eng.modelEd.hidden.size;
    await io.click( ...scr( gv( 8, 8 ) ) ); await sleep( 120 );
    await key( "h", { alt: true } );
    check( hidden === 4 && eng.modelEd.hidden.size === 0 && me()!.verts === 1 + 9, `H hid the ${hidden} faces round a vertex; Alt+H showed them, selected with the one picked since ( ${me()?.verts} vertices: Blender 10 )` );
    await key( "Tab" );

    // ---------------------------------------------------------------- two islands: L, Shift+L, Ctrl+L
    await key( "A", { shift: true } );
    await menu( "Cube" );
    await sleep( 500 );
    const uid2   = st().selection[0]?.uid;
    const piece2 = () => st().customObjects.find( ( o ) => o.uid === uid2 )!;
    eng.nav.lookAtUnity( [4.5, 4.5, -6], [1.5, 0, 0] );
    await sleep( 700 );
    await key( "Tab" );
    await key( "1" );
    await key( "a" );
    await key( "D", { shift: true } ); await key( "x" ); await key( "3" ); await key( "Enter" );
    await sleep( 200 );
    const xs = piece2().model!.mesh.v.map( ( p ) => p[0] );
    log( `Shift+D X 3: ${xs.length} vertices, X from ${Math.min( ...xs )} to ${Math.max( ...xs )}` );
    await key( "a", { alt: true } );
    await io.glide( ...scr( [1, 1, -1] ), 200 );
    await key( "l" );
    const island = me()?.verts;
    await key( "L", { shift: true } );
    const off = me()?.verts;
    await io.click( ...scr( [4, 1, -1] ) ); await sleep( 120 );
    await key( "l", { ctrl: true } );
    check( island === 8 && off === 0 && me()!.verts === 8, `L over one cube: its ${island} corners; Shift+L: ${off}; Ctrl+L from a corner of the other: ${me()?.verts}` );
    await key( "Tab" );
    log( "SNAP done" );
    await sleep( 800 );
    io.stop();
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
