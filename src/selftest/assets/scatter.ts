import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/scatter ): a project in the folder ( a copy ): two pieces Ctrl+clicked in the asset
 * browser, the object brush dragged across the ground ( pieces dropped, apart, turned, leaning ), then dragged again
 * with Ctrl ( taken away ), and undone; a view of them left in the folder.
**/
export async function scatterSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st    = () => useEditor.getState();
    const cards = await waitFor( () => {
      const c = [...document.querySelectorAll<HTMLElement>( ".assets-main .grid .card" )].filter( ( x ) => !x.classList.contains( "material" ) );
      return c.length >= 3 ? c : null;
    }, "cards", 20000 );
    const click = ( el: HTMLElement, ctrl: boolean ) => {
      const r = el.getBoundingClientRect();
      el.dispatchEvent( new PointerEvent( "pointerdown", { clientX: r.left + 20, clientY: r.top + 20, button: 0, buttons: 1, ctrlKey: ctrl, pointerId: 61, bubbles: true } ) );
      window.dispatchEvent( new PointerEvent( "pointerup", { clientX: r.left + 20, clientY: r.top + 20, button: 0, buttons: 0, ctrlKey: ctrl, pointerId: 61, bubbles: true } ) );
    };
    click( cards[0], true );
    click( cards[2], true );
    await sleep( 300 );
    log( `picked ${st().scatter.picks.length}, tool ${st().tool}; cards outlined ${document.querySelectorAll( ".card.picked" ).length}; row: "${document.querySelector( ".tool-settings .pick-list" )?.textContent}"` );
    useEditor.setState( { scatter: { ...st().scatter, radius: 10, spacing: 4 } } );
    const canvas = eng.renderer.domElement, r = canvas.getBoundingClientRect();
    const n0     = st().customObjects.length, h0 = history.canUndo ? history.nextUndo : "";
    const stroke = async ( ctrl: boolean ) => {
      const y = r.height * 0.6;
      canvas.dispatchEvent( new PointerEvent( "pointerenter", { bubbles: true } ) );
      canvas.dispatchEvent( new PointerEvent( "pointerdown",  { clientX: r.left + r.width * 0.3, clientY: r.top + y, button: 0, buttons: 1, ctrlKey: ctrl, pointerId: 62, bubbles: true } ) );
      await sleep( 1500 );
      for ( let k = 0; k <= 40; k++ ) {
        canvas.dispatchEvent( new PointerEvent( "pointermove", { clientX: r.left + r.width * ( 0.3 + ( 0.4 * k ) / 40 ), clientY: r.top + y, buttons: 1, ctrlKey: ctrl, pointerId: 62, bubbles: true } ) );
        await sleep( 25 );
      }
      window.dispatchEvent( new PointerEvent( "pointerup", { clientX: r.left + r.width * 0.7, clientY: r.top + y, button: 0, buttons: 0, ctrlKey: ctrl, pointerId: 62, bubbles: true } ) );
      await sleep( 500 );
    };
    await stroke( false );
    const made  = st().customObjects.slice( n0 );
    const kinds = new Set( made.map( ( o ) => o.source?.id ) );
    let closest = Infinity;
    for ( const a of made ) for ( const b of made ) if ( a !== b ) closest = Math.min( closest, Math.hypot( a.position.x - b.position.x, a.position.z - b.position.z ) );
    const yaws = made.map( ( o ) => Math.round( o.rotation.y ) );
    log( `stroke: ${made.length} pieces of ${kinds.size} kinds, closest ${closest.toFixed( 1 )} m apart, turns ${yaws.slice( 0, 6 ).join( " " )}…, sizes ${made.slice( 0, 4 ).map( ( o ) => o.scale.x.toFixed( 2 ) ).join( " " )}; named ${made.slice( 0, 3 ).map( ( o ) => st().labels[o.uid] ).join( ", " )}; undo step "${history.nextUndo}" (before "${h0}")` );
    await eng.customR.settled;
    await sleep( 800 );
    log( `drawn: ${made.filter( ( o ) => ( eng.customR.objectGroup( o.uid )?.children.length ?? 0 ) > 0 ).length} of ${made.length}` );
    const c = made.reduce( ( acc, o ) => [acc[0] + o.position.x / made.length, acc[1] + o.position.y / made.length, acc[2] + o.position.z / made.length], [0, 0, 0] );
    eng.nav.lookAtUnity( [c[0], c[1] + 45, c[2] - 55], [c[0], c[1], c[2]] );
    await sleep( 1500 );
    await ipc.writeBinary( joinPath( dir, "scatter.png" ), await eng.pictures.capture() );
    await stroke( true );
    log( `Ctrl stroke: ${st().customObjects.length - n0} left (of ${made.length})` );
    history.undo();
    log( `undo: ${st().customObjects.length - n0} back` );
    history.undo();
    log( `undo again: ${st().customObjects.length - n0} (the first stroke gone)` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
