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
      // ( pieces: not materials, nor the game's lifts at the front, which are placed as lifts )
      const c = [...document.querySelectorAll<HTMLElement>( ".assets-main .grid .card" )].filter( ( x ) => !x.classList.contains( "material" ) && !["Chairlift", "T-Bar", "Rope Tow"].includes( x.querySelector( ".name" )?.textContent ?? "" ) );
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
    if ( st().scatter.picks.length !== 2 || st().tool !== "scatter" ) throw new Error( `Ctrl+click on two pieces' cards: ${st().scatter.picks.length} picked, tool ${st().tool}` );
    log( `picked ${st().scatter.picks.length}, tool ${st().tool}; cards outlined ${document.querySelectorAll( ".card.picked" ).length}; row: "${document.querySelector( ".tool-settings .pick-list" )?.textContent}"` );
    useEditor.setState( { scatter: { ...st().scatter, radius: 10, spacing: 4 } } );
    // ( the map in view, as a person has it before painting: its middle from above )
    const { terrain } = await import( "../../terrain/terrain" );
    const mid = terrain.chunks[0], cx = mid.position[0] + mid.size[0] / 2, cz = mid.position[2] + mid.size[2] / 2;
    eng.nav.lookAtUnity( [cx - 60, terrain.heightAt( cx, cz ) + 60, cz - 60], [cx, terrain.heightAt( cx, cz ), cz] );
    await sleep( 800 );
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
    const t0 = performance.now();
    await stroke( false );
    // ( the picked pieces brought into the map first: the stroke laid down once they're here )
    await waitFor( () => ( st().customObjects.length > n0 ? true : null ), "the stroke's pieces", 15000 ).catch( () => null );
    log( `the stroke's pieces in ${( ( performance.now() - t0 ) / 1000 ).toFixed( 1 )} s from pressing` );
    const made  = st().customObjects.slice( n0 );
    const kinds = new Set( made.map( ( o ) => o.source?.id ) );
    let closest = Infinity;
    for ( const a of made ) for ( const b of made ) if ( a !== b ) closest = Math.min( closest, Math.hypot( a.position.x - b.position.x, a.position.z - b.position.z ) );
    const yaws = made.map( ( o ) => Math.round( o.rotation.y ) );
    if ( !made.length ) throw new Error( "the stroke dropped nothing" );
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
    // the brush's size from the keys, as the terrain brushes': [ ] smaller and bigger, F with the mouse ( Esc puts it
    // back ); and Paint's F its own brush, not Sculpt's
    const fails: string[] = [];
    // ( pressed as a key reaches the page: at the page's body, up to the window )
    const key = ( k: string, extra: Record<string, unknown> = {} ) => {
      document.body.dispatchEvent( new KeyboardEvent( "keydown", { key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, bubbles: true, cancelable: true, ...extra } ) );
      document.body.dispatchEvent( new KeyboardEvent( "keyup",   { key: k, bubbles: true } ) );
    };
    const move = ( x: number ) => canvas.dispatchEvent( new PointerEvent( "pointermove", { clientX: r.left + x, clientY: r.top + r.height * 0.6, buttons: 0, pointerId: 62, bubbles: true } ) );
    st().setTool( "scatter" );
    useEditor.setState( { scatter: { ...st().scatter, radius: 10 } } );
    canvas.dispatchEvent( new PointerEvent( "pointerenter", { bubbles: true } ) );
    await sleep( 200 );
    key( "]" );
    const up = st().scatter.radius;
    key( "[" );
    key( "[" );
    const down = st().scatter.radius;
    if ( !( up > 10.5 && down < 10 ) ) fails.push( "scatter [ ]" );
    move( r.width * 0.5 );
    key( "f" );
    move( r.width * 0.5 + 120 );
    const dragged = st().scatter.radius;
    key( "Escape" );
    const back = st().scatter.radius;
    if ( !( dragged > down + 1 && Math.abs( back - down ) < 1e-6 && st().tool === "scatter" ) ) fails.push( "scatter F" );
    log( `${fails.length ? "FAIL" : "ok  "} Scatter's size from the keys: ] ${up.toFixed( 2 )}, [ [ ${down.toFixed( 2 )}; F and the mouse moved ${dragged.toFixed( 2 )}, Esc ${back.toFixed( 2 )} m (still ${st().tool})` );
    st().setTool( "paint" );
    await sleep( 200 );
    const sculpt0 = st().sculpt.radius, paint0 = st().paint.radius;
    move( r.width * 0.5 );
    key( "f" );
    move( r.width * 0.5 + 120 );
    key( "Enter" );
    const paintOk = st().paint.radius > paint0 && st().sculpt.radius === sculpt0;
    if ( !paintOk ) fails.push( "paint F" );
    log( `${paintOk ? "ok  " : "FAIL"} Paint's F its own brush: ${paint0.toFixed( 2 )} -> ${st().paint.radius.toFixed( 2 )} m, Sculpt's ${sculpt0.toFixed( 2 )} -> ${st().sculpt.radius.toFixed( 2 )}` );
    // ( Paint mode opened again from another: on its first tool, as the other modes open on theirs )
    st().setPaint( { tool: "powder" } );
    st().setTool( "select" );
    st().setTool( "paint" );
    const first = st().paint.tool === "snow";
    if ( !first ) fails.push( "paint first tool" );
    log( `${first ? "ok  " : "FAIL"} Paint mode opened from Object Mode on its first tool: ${st().paint.tool}` );
    st().setTool( "select" );
    if ( fails.length ) throw new Error( fails.join( "; " ) );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
