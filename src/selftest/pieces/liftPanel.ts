import { domShot, log, pressCard, realInput, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { joinPath } from "../../core/ipc";
import { toUnity } from "../../core/coords";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/liftpanel ): a lift's Transform is the piece picked: a chairlift put down from the
 * Lifts catalog, then its base station, a mast and its top station clicked in the view in turn — the panel names the
 * piece, shows where it stands and nothing to turn or size; a new X typed for the mast moves the mast alone ( the
 * gizmo with it ), one undo step.
**/
export async function liftPanelSelftest( dir: string ) {
  try {
    const P              = await import( "../../map/project" );
    const { liftPieces } = await import( "../../pieces/lift" );
    await P.newUntitled();
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 1500 );
    const st  = () => useEditor.getState();
    let phase = "start";
    const io  = realInput( eng, () => phase );
    eng.nav.lookAtUnity( [40, 45, -70], [0, 0, 0] );
    await sleep( 600 );
    // ---- a chairlift put down
    phase = "put down";
    [...document.querySelectorAll<HTMLElement>( ".catalog" )].find( ( c ) => c.textContent?.includes( "Lifts" ) )?.click();
    await sleep( 300 );
    pressCard( [...document.querySelectorAll<HTMLElement>( ".card" )].find( ( c ) => c.textContent?.trim() === "Chairlift" )! );
    await sleep( 200 );
    const n0 = st().objects.length;
    await io.click( ...io.scr( [0, 0, 0] ), 250 );
    const lift = await waitFor( () => st().objects.find( ( o, i ) => i >= n0 && o.id === "chairlift" ) ?? null, "the chairlift", 5000 );
    await io.key( "Escape" );
    st().setTool( "select" );
    await sleep( 1500 );
    const cur      = () => st().objects.find( ( o ) => o.uid === lift.uid )!;
    const labels   = () => [...document.querySelectorAll<HTMLElement>( ".props label" )].map( ( l ) => l.textContent?.trim() ?? "" );
    const sections = () => [...document.querySelectorAll<HTMLElement>( ".props .section" )].map( ( l ) => l.textContent?.trim() ?? "" );
    const row      = ( label: string ) => {
      const l = [...document.querySelectorAll<HTMLElement>( ".props label" )].find( ( x ) => x.textContent?.trim() === label );
      return ( l?.nextElementSibling as HTMLElement | null ) ?? null;
    };
    const shownX = () => parseFloat( row( "Location X" )?.textContent?.replace( /[^\d.-]/g, "" ) ?? "NaN" );
    const footOf = ( which: "base" | "top" | number ) => {
      const p = liftPieces( cur() )!;
      return which === "base" ? p.base.at : which === "top" ? p.top.at : p.masts[which].at;
    };
    const check = ( what: string, which: "base" | "top" | number, name: string ) => {
      const ls = labels(), secs = sections(), x = shownX(), want = footOf( which )[0];
      const ok = secs.includes( name ) && !secs.includes( "Transform" ) && ls.includes( "Location X" ) && !ls.some( ( l ) => l.startsWith( "Rotation" ) || l.startsWith( "Scale" ) ) && Math.abs( x - want ) < 0.01;
      log( `${what}: section "${secs.find( ( x2 ) => /Station|Mast/.test( x2 ) ) ?? "none"}"; Location X ${x} (the piece's ${want.toFixed( 4 )}); rotation ${ls.some( ( l ) => l.startsWith( "Rotation" ) ) ? "shown" : "hidden"}, scale ${ls.some( ( l ) => l.startsWith( "Scale" ) ) ? "shown" : "hidden"}${ok ? "" : " (FAIL)"}` );
    };
    await io.click( ...io.scr( [footOf( "base" )[0], footOf( "base" )[1] + 1, footOf( "base" )[2]] ), 250 );
    await sleep( 500 );
    check( "base station clicked", "base", "Base Station" );
    // ---- a mast clicked, then a new X typed for it
    phase    = "a mast";
    const m0 = footOf( 0 );
    await io.click( ...io.scr( [m0[0], m0[1] + 4, m0[2]] ), 250 );
    await sleep( 500 );
    check( "mast 1 clicked", 0, "Mast 1" );
    const before = { base: footOf( "base" ), top: footOf( "top" ), masts: liftPieces( cur() )!.masts.length };
    const field  = row( "Location X" )?.querySelector<HTMLElement>( ".num, .field, div" ) ?? row( "Location X" );
    field!.dispatchEvent( new PointerEvent( "pointerdown", { bubbles: true, button: 0, buttons: 1, clientX: 5, clientY: 5 } ) );
    window.dispatchEvent( new PointerEvent( "pointerup", { bubbles: true, button: 0, clientX: 5, clientY: 5 } ) );
    field!.dispatchEvent( new MouseEvent( "click", { bubbles: true } ) );
    await sleep( 200 );
    const inp = document.activeElement as HTMLInputElement | null;
    if ( !inp || inp.tagName !== "INPUT" ) log( `  (Location X didn't open for typing: FAIL)` );
    else {
      Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, "value" )!.set!.call( inp, String( m0[0] + 5 ) );
      inp.dispatchEvent( new Event( "input", { bubbles: true } )         );
      inp.dispatchEvent( new FocusEvent( "focusout", { bubbles: true } ) );
      inp.blur();
    }
    await sleep( 500 );
    const m1     = footOf( 0 ), g = eng.liftTool.gizmoAt();
    const others = Math.hypot( ...[0, 1, 2].map( ( i ) => footOf( "base" )[i] - before.base[i] ) ) + Math.hypot( ...[0, 1, 2].map( ( i ) => footOf( "top" )[i] - before.top[i] ) );
    log( `mast 1 X typed ${( m0[0] + 5 ).toFixed( 2 )}: mast at ${m1[0].toFixed( 2 )}${Math.abs( m1[0] - m0[0] - 5 ) < 0.01 ? "" : " (FAIL)"}; stations moved ${others.toFixed( 3 )} m${others < 1e-6 ? "" : " (FAIL)"}; masts ${liftPieces( cur() )!.masts.length} (was ${before.masts}); gizmo at ${g ? toUnity( g )[0].toFixed( 2 ) : "none"}${g && Math.abs( toUnity( g )[0] - m1[0] ) < 0.01 ? "" : " (FAIL)"}; undo "${history.nextUndo}"` );
    history.undo();
    await sleep( 300 );
    log( `undone: mast back at ${footOf( 0 )[0].toFixed( 2 )}${Math.abs( footOf( 0 )[0] - m0[0] ) < 0.01 ? "" : " (FAIL)"}` );
    // ---- the top station
    phase   = "top";
    const t = footOf( "top" );
    eng.nav.lookAtUnity( [t[0] + 20, t[1] + 20, t[2] - 30], t );
    await sleep( 600 );
    await io.click( ...io.scr( [t[0], t[1] + 1, t[2]] ), 250 );
    await sleep( 500 );
    check( "top station clicked", "top", "Top Station" );
    await domShot( document.querySelector<HTMLElement>( ".props" ), joinPath( dir, "panel.png" ) );
    io.stop();
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
