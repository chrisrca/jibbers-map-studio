import { ipc, joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/mapsizeview ): the Map tab's little map, dragged and zoomed as a person does. A
 * map ( in/map.txt, a .jbrmap ) opened; the little map seen still, mid-drag, just after the wheel, and after a moment;
 * then dragged far each way and zoomed all the way out: what it shows kept on the land that's there ( the
 * surroundings' outer edge, or the map's when it has none, never inside the picture ).
**/
export async function mapSizeViewSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const P    = await import( "../../map/project" );
    const src  = ( await ipc.readText( joinPath( dir, "in", "map.txt" ) ) ).trim();
    const proj = joinPath( dir, `ms-${Date.now()}.jbrproj` );
    await ipc.importJbrmap( src, proj );
    await P.openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the ground", 60000 );
    await waitFor( () => ( eng.veil.loading ? null : true ), "the map", 300000 );
    useEditor.setState( { tool: "select" } );
    useEditor.getState().setSelection( [] );
    await sleep( 500 );
    [...document.querySelectorAll<HTMLButtonElement>( ".props-tabs button" )].find( ( b ) => b.title === "Map" )?.click();
    const svg = await waitFor( () => document.querySelector<SVGSVGElement>( ".mapsize-map" ), "the little map", 20000 );
    svg.scrollIntoView( { block: "center" } );
    await sleep( 4000 );
    const r   = () => svg.getBoundingClientRect();
    const ev  = ( type: string, x: number, y: number, target: EventTarget = svg ) => target.dispatchEvent( new PointerEvent( type, { clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true } ) );
    const frame = () => new Promise<void>( ( res ) => requestAnimationFrame( () => res() ) );
    log( `surroundings: ${svg.querySelectorAll( "rect.surround" ).length} rings` );
    log( "SNAP still" );
    await sleep( 1500 );
    // ---- mid-drag
    const c0 = r();
    let x = c0.left + c0.width / 2, y = c0.top + c0.height / 2;
    ev( "pointerdown", x, y );
    for ( let k = 0; k < 15; k++ ) {
      x += 3;
      y += 2;
      ev( "pointermove", x, y, window );
      await frame();
    }
    log( "SNAP dragging" );
    await sleep( 1200 );
    ev( "pointerup", x, y, window );
    // ---- the wheel, just after and a moment on
    for ( let k = 0; k < 3; k++ ) {
      svg.dispatchEvent( new WheelEvent( "wheel", { deltaY: -120, clientX: c0.left + c0.width * 0.4, clientY: c0.top + c0.height * 0.4, bubbles: true } ) );
      await frame();
    }
    log( "SNAP wheeled" );
    await sleep( 2500 );
    log( "SNAP wheeled-later" );
    await sleep( 1500 );
    // ---- the land's outer edge ( the surroundings' last ring, or the map's ground ): never inside the picture
    const edgeInside = () => {
      const last = svg.querySelector<SVGRectElement>( "rect.surround.last" ) ?? svg.querySelector<SVGImageElement>( "image:last-of-type" );
      if ( !last ) return "none";
      const b = last.getBBox(), w = svg.viewBox.baseVal.width;
      const gaps = [b.x > 0.5 ? `left ${b.x.toFixed( 0 )}` : "", b.y > 0.5 ? `top ${b.y.toFixed( 0 )}` : "", b.x + b.width < w - 0.5 ? `right ${( w - b.x - b.width ).toFixed( 0 )}` : "", b.y + b.height < w - 0.5 ? `bottom ${( w - b.y - b.height ).toFixed( 0 )}` : ""].filter( Boolean );
      return gaps.join( ", " );
    };
    for ( const [name, dx, dy] of [["left", -1, 0], ["right", 1, 0], ["up", 0, -1], ["down", 0, 1]] as const ) {
      // ( a long drag that way, in steps: far more than there is )
      for ( let n = 0; n < 4; n++ ) {
        const c = r();
        let px = c.left + c.width / 2, py = c.top + c.height / 2;
        ev( "pointerdown", px, py );
        for ( let k = 0; k < 10; k++ ) {
          px -= dx * 20;
          py -= dy * 20;
          ev( "pointermove", px, py, window );
          await frame();
        }
        ev( "pointerup", px, py, window );
        await frame();
      }
      await sleep( 300 );
      const gap = edgeInside();
      check( gap === "", `dragged far ${name}: the land's edge ${gap ? `inside the picture ( ${gap} px )` : "kept out of it"}` );
      if ( name === "left" ) {
        log( "SNAP far-left" );
        await sleep( 1500 );
      }
      svg.dispatchEvent( new MouseEvent( "dblclick", { bubbles: true } ) );
      await sleep( 300 );
    }
    // ---- zoomed all the way out
    for ( let k = 0; k < 30; k++ ) {
      svg.dispatchEvent( new WheelEvent( "wheel", { deltaY: 120, clientX: r().left + 10, clientY: r().top + 10, bubbles: true } ) );
      await frame();
    }
    await sleep( 2500 );
    log( `zoomed out: the land's edge ${edgeInside() || "kept out of it"}` );
    log( "SNAP zoomed-out" );
    await sleep( 1500 );
    // ---- without surroundings: kept on the map and the squares round it
    const { removeSurroundings } = await import( "../../geo/landGround" );
    await removeSurroundings();
    await sleep( 1500 );
    svg.dispatchEvent( new MouseEvent( "dblclick", { bubbles: true } ) );
    for ( let n = 0; n < 4; n++ ) {
      const c = r();
      let px = c.left + c.width / 2;
      ev( "pointerdown", px, c.top + c.height / 2 );
      for ( let k = 0; k < 10; k++ ) {
        px += 20;
        ev( "pointermove", px, c.top + c.height / 2, window );
        await frame();
      }
      ev( "pointerup", px, c.top + c.height / 2, window );
      await frame();
    }
    await sleep( 300 );
    const g0 = svg.querySelectorAll( "rect.surround" ).length;
    check( g0 === 0 && edgeInside() === "", `without surroundings ( ${g0} rings ), dragged far left: the map's edge ${edgeInside() || "kept out of it"}` );
    log( "SNAP no-surroundings" );
    await sleep( 1500 );
    log( fails.length ? `SELFTEST FAILED: ${fails.length} checks — ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
