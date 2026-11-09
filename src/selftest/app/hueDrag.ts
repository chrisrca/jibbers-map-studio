import { ipc } from "../../core/ipc";
import { isScenery } from "../../core/types";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";
import { getEngine } from "../../ui/Viewport";
import { log, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/huedrag ): a textured piece of a park ( a copy in the folder ) picked and its Hue
 * slider dragged across, as a person does: the frames meanwhile ( the longest, how many missed ), and how soon the view
 * shows where it's let go.
**/
export async function hueDragSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    useEditor.setState( { splash: false } );
    const st = () => useEditor.getState();
    const o  = st().customObjects.find( ( c ) => !isScenery( c ) && !c.tree && !st().locked[c.uid] && c.parts.some( ( p ) => p.materials.some( ( m ) => m.base_tex ) ) );
    if ( !o ) throw new Error( "no textured piece" );
    eng.nav.lookAtUnity( [o.position.x - 6, o.position.y + 4, o.position.z - 6], [o.position.x, o.position.y, o.position.z] );
    st().setSelection( [{ kind: "custom", uid: o.uid }] );
    await sleep( 3000 );
    // the Hue slider: in the piece's Colour picker ( the chip by "Colour" clicked open ), under Adjust
    const colourRow = [...document.querySelectorAll<HTMLLabelElement>( ".props > label" )].find( ( l ) => l.textContent === "Colour" );
    colourRow?.nextElementSibling?.querySelector<HTMLButtonElement>( ".colour-chip" )?.click();
    const adjustSlider = ( name: string ) => [...document.querySelectorAll<HTMLElement>( ".cpick-adjust .bslider" )].find( ( s ) => s.textContent?.startsWith( name ) ) ?? null;
    const slider       = await waitFor( () => adjustSlider( "Hue" ), "the Hue slider in the Colour picker", 3000 ).catch( () => null );
    if ( !slider ) throw new Error( "no Hue slider" );
    const r = slider.getBoundingClientRect(), y = r.top + r.height / 2;
    // the frames while it's dragged
    const gaps: number[] = [];
    let last             = performance.now(), on = true;
    const tick           = ( t: number ) => {
      gaps.push( t - last );
      last = t;
      if ( on ) requestAnimationFrame( tick );
    };
    requestAnimationFrame( tick );
    slider.dispatchEvent( new PointerEvent( "pointerdown", { clientX: r.left + 2, clientY: y, button: 0, buttons: 1, pointerId: 83, bubbles: true } ) );
    const steps = 90;
    for ( let k = 1; k <= steps; k++ ) {
      window.dispatchEvent( new PointerEvent( "pointermove", { clientX: r.left + 2 + ( ( r.width - 4 ) * k ) / steps, clientY: y, buttons: 1, pointerId: 83, bubbles: true } ) );
      await new Promise( ( ok ) => requestAnimationFrame( ok ) );
    }
    window.dispatchEvent( new PointerEvent( "pointerup", { clientX: r.right - 2, clientY: y, button: 0, buttons: 0, pointerId: 83, bubbles: true } ) );
    const t0  = performance.now();
    const hue = st().customObjects.find( ( c ) => c.uid === o.uid )?.hue ?? 0;
    // ( shown: its meshes drawn turned to where it was let go )
    await waitFor( () => ( eng.customR.pickables( ( u ) => u === o.uid ).length && st().customObjects.find( ( c ) => c.uid === o.uid ) === eng.customR.shown.get( o.uid )?.built ? true : null ), "the piece drawn", 5000 ).catch( () => null );
    const shown = performance.now() - t0;
    await sleep( 500 );
    on = false;
    const worst = Math.max( ...gaps ), missed = gaps.filter( ( g ) => g > 34 ).length;
    log( `dragged over ${steps} moves: hue ${Math.round( hue * 360 )}°; frames worst ${worst.toFixed( 0 )} ms, ${missed} of ${gaps.length} over 34 ms; shown ${shown.toFixed( 0 )} ms after letting go` );
    check( Math.round( hue * 360 ) === 180, `the slider dragged to the end: ${Math.round( hue * 360 )}°` );
    // ( one long frame allowed: the first Hue's shader made, once )
    const second = [...gaps].sort( ( a, b ) => b - a )[1] ?? 0;
    check( second < 100 && missed <= gaps.length * 0.1, `dragging it is smooth: worst ${worst.toFixed( 0 )} ms ( once ), then ${second.toFixed( 0 )} ms; ${missed} of ${gaps.length} frames over 34 ms` );
    log( "SNAP huedrag" );
    await sleep( 1200 );
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
