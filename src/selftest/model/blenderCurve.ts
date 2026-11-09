import { toThree, type V3 } from "../../core/coords";
import { joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";
import { CURVE_PRESETS } from "../../model/curve";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/blendercurve ): a curve's Edit Mode as Blender has it, keys and mouse: A and
 * Alt+A; a click on the end; E, then X 1 ( a point on past the end, along X ); G Z 0.5 ( up, Blender's Z ); G and Esc,
 * G and a right click ( put back ); Alt+S 2 ( its size doubled ); V › Sharp and Smooth; Alt+C ( closed, open );
 * Ctrl+click ( a point added ); X ( the picked point gone ); Ctrl+Z.
**/
export async function blenderCurveSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const P = await import( "../../map/project" );
    await P.newEmptyProject( joinPath( dir, `curve-${Date.now()}.jbrproj` ), "Blender Curve" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await sleep( 1000 );
    const st = () => useEditor.getState();
    [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === "Assets" )?.click();
    await sleep( 1200 );
    const io    = realInput( eng, () => "curve" );
    const frame = () => new Promise<void>( ( r ) => requestAnimationFrame( () => r() ) );
    const key   = async ( k: string, m: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {} ) => {
      const init = { key: k, code: k.length === 1 ? ( /[0-9]/.test( k ) ? `Digit${k}` : `Key${k.toUpperCase()}` ) : k, ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: !!m.alt, bubbles: true, cancelable: true };
      window.dispatchEvent( new KeyboardEvent( "keydown", init ) );
      window.dispatchEvent( new KeyboardEvent( "keyup", init ) );
      await frame();
      await sleep( 60 );
    };
    const type = async ( s: string ) => { for ( const ch of s ) await key( ch ); };
    const menu = async ( label: string ) => {
      await sleep( 200 );
      const it = [...document.querySelectorAll<HTMLElement>( ".bmenu .bmenu-item" )].find( ( x ) => x.textContent?.trim().startsWith( label ) );
      it?.click();
      await sleep( 300 );
      return !!it;
    };
    const W = io.rc.width, H = io.rc.height;
    await io.glide( W / 2, H / 2, 200 );
    eng.menus.addCurveInView( CURVE_PRESETS.find( ( p ) => p.label === "Rail" )! );
    await sleep( 500 );
    const uid = st().customObjects.find( ( o ) => o.model?.curve )!.uid;
    st().setSelection( [{ kind: "custom", uid }] );
    const o   = () => st().customObjects.find( ( x ) => x.uid === uid )!;
    const pts = () => o().model!.curve!.splines[0].points;
    const scr = ( p: V3 ) => {
      const w = toThree( [p[0] + o().position.x, p[1] + o().position.y, p[2] + o().position.z] );
      return eng.screenOf( w ).slice( 0, 2 ) as [number, number];
    };
    const at = o().position;
    eng.nav.lookAtUnity( [at.x + 1, at.y + 4, at.z - 6], [at.x, at.y, at.z] );
    await sleep( 600 );
    await key( "Tab" );
    await sleep( 200 );
    const ed = eng.curveEd;
    check( eng.editing === ed, "Tab: the curve's Edit Mode" );
    await key( "a" );
    const all = ed.sel.size;
    await key( "a", { alt: true } );
    check( all === pts().length && ed.sel.size === 0, `A: all ${all} points; Alt+A: none` );
    // a click on its end; E, X 1: a point on past it
    const end = pts()[pts().length - 1].p;
    await io.click( ...scr( end ) ); await sleep( 150 );
    const picked = ed.sel.size;
    await key( "e" ); await key( "x" ); await type( "1" ); await key( "Enter" );
    const n1 = pts().length, last = pts()[n1 - 1].p;
    check( picked === 1 && n1 === 3 && Math.abs( last[0] - end[0] - 1 ) < 1e-6 && Math.abs( last[1] - end[1] ) < 1e-6, `a click on the end, E, X 1: ${n1} points, the new one 1 m on along X` );
    // G Z 0.5: up ( Blender's Z )
    await key( "g" ); await key( "z" ); await type( "0.5" ); await key( "Enter" );
    const up = pts()[n1 - 1].p;
    check( Math.abs( up[1] - last[1] - 0.5 ) < 1e-6, `G Z 0.5: up half a metre ( ${( up[1] - last[1] ).toFixed( 3 )} )` );
    // G and Esc, G and a right click: put back
    const was = JSON.stringify( pts() );
    await key( "g" ); await io.glide( W / 2 + 90, H / 2 - 40, 200 ); await key( "Escape" );
    const esc = JSON.stringify( pts() ) === was;
    await key( "g" ); await io.glide( W / 2 - 70, H / 2 + 30, 200 ); await io.press( 2 ); await io.release( 2 );
    check( esc && JSON.stringify( pts() ) === was && !ed.modal, `G, Esc: back ( ${esc} ); G, a right click: back ( ${JSON.stringify( pts() ) === was} )` );
    // Alt+S 2: its size doubled
    const r0 = pts()[n1 - 1].r;
    await key( "s", { alt: true } ); await type( "2" ); await key( "Enter" );
    check( Math.abs( pts()[n1 - 1].r - r0 * 2 ) < 1e-6, `Alt+S 2: its size ${r0} → ${pts()[n1 - 1].r}` );
    // V: Sharp, then Smooth
    await key( "v" ); await menu( "Sharp" );
    const sharp = pts()[n1 - 1].sharp;
    await key( "v" ); await menu( "Smooth" );
    check( sharp && !pts()[n1 - 1].sharp, `V › Sharp: a kink ( ${sharp} ); V › Smooth: smooth again` );
    // Alt+C: closed, then open
    await key( "c", { alt: true } );
    const closed = o().model!.curve!.splines[0].closed;
    await key( "c", { alt: true } );
    check( !!closed && !o().model!.curve!.splines[0].closed, `Alt+C: closed ( ${closed} ); again: open` );
    // Ctrl+click: a point added past the end
    const tip = scr( [up[0] + 1.5, up[1], up[2]] );
    await io.click( tip[0], tip[1], 300, { ctrlKey: true } ); await sleep( 200 );
    const n2 = pts().length;
    check( n2 === n1 + 1, `Ctrl+click past the end: a point added ( ${n2} )` );
    // X: the picked point gone; Ctrl+Z: back
    await key( "x" );
    const n3 = pts().length;
    await key( "z", { ctrl: true } );
    check( n3 === n2 - 1 && pts().length === n2, `X: the picked point gone ( ${n3} ); Ctrl+Z: back ( ${pts().length} )` );
    await key( "Tab" );
    check( !eng.editing, "Tab: back to Object Mode" );
    io.stop();
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
