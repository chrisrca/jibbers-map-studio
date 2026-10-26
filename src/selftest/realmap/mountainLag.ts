import { getEngine } from "../../ui/Viewport";
import { joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/mtnlag ): how smoothly the "Import a real mountain" map moves, over a real map
 * ( map.jbrproj in the folder ): frames while it pans and turns in 2D, then in 3D, and while a big area is dragged out.
 * SHOTs of the dialog.
**/
export async function mountainLagSelftest( dir: string ) {
  try {
    const { mountainMap } = await import( "../../ui/dialogs/mountainImport/MountainImport" );
    await openProject( joinPath( dir, "map.jbrproj" ) );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await sleep( 3000 );
    useEditor.setState( { mountainImport: true } );
    const m       = await waitFor( () => mountainMap(), "the dialog's map" );
    const settled = () => new Promise<void>( ( r ) => ( !m.isMoving() && m.areTilesLoaded() ? r() : m.once( "idle", () => r() ) ) );
    await new Promise<void>( ( r ) => ( m.loaded() ? r() : m.once( "idle", () => r() ) ) );
    m.jumpTo( { center: [-71.8788, 43.0074], zoom: 13.2 } );
    await new Promise<void>( ( r ) => m.once( "idle", () => r() ) );
    await sleep( 1500 );
    log( "SHOT mtn_start" );
    await sleep( 2500 );
    // long tasks ( the page busy > 50 ms at a time )
    let longTasks = 0, longMs = 0;
    try {
      new PerformanceObserver( ( l ) => l.getEntries().forEach( ( e ) => { longTasks++; longMs += e.duration; } ) ).observe( { type: "longtask", buffered: false } );
    } catch {
      // not supported
    }
    /**
     * frames the page and the map draw while `run` goes, and the worst gap between page frames
    **/
    const measure = async ( label: string, run: () => Promise<void> ) => {
      let pageFrames = 0, mapFrames = 0, worst = 0, last = performance.now(), going = true;
      const tick     = () => {
        const t = performance.now();
        worst   = Math.max( worst, t - last );
        last    = t;
        pageFrames++;
        if ( going ) requestAnimationFrame( tick );
      };
      requestAnimationFrame( tick );
      const onRender = () => mapFrames++;
      m.on( "render", onRender );
      const lt0 = longTasks, lm0 = longMs, engFrames0 = eng.frameStamps.length;
      const t0  = performance.now();
      await run();
      const secs = ( performance.now() - t0 ) / 1000;
      going      = false;
      m.off( "render", onRender );
      log( `${label}: page ${( pageFrames / secs ).toFixed( 0 )} fps, map ${( mapFrames / secs ).toFixed( 0 )} fps, worst frame ${worst.toFixed( 0 )} ms, ${longTasks - lt0} long tasks (${( longMs - lm0 ).toFixed( 0 )} ms), studio viewport drew ${eng.frameStamps.length - engFrames0} frames meanwhile` );
    };
    const tour = () => new Promise<void>( ( r ) => {
      m.easeTo( { center: [-71.86, 43.02], bearing: 40, zoom: 13.6, duration: 2500, easing: ( t ) => t } );
      m.once( "moveend", () => {
        m.easeTo( { center: [-71.8788, 43.0074], bearing: 0, zoom: 13.2, duration: 2500, easing: ( t ) => t } );
        m.once( "moveend", () => r() );
      } );
    } );
    await measure( "3D pan and turn", tour );
    // turning with the right button: degrees per pixel dragged, the same anywhere on the map
    {
      const canvas = m.getCanvas(), r = canvas.getBoundingClientRect();
      const b0     = m.getBearing();
      const at     = ( x: number ) => ( { clientX: r.left + x, clientY: r.top + r.height / 2, button: 2, buttons: 2, bubbles: true } );
      canvas.dispatchEvent( new MouseEvent( "mousedown", at( r.width / 2 ) ) );
      for ( let k = 1; k <= 10; k++ ) {
        canvas.dispatchEvent( new MouseEvent( "mousemove", at( r.width / 2 + k * 10 ) ) );
        await sleep( 20 );
      }
      canvas.dispatchEvent( new MouseEvent( "mouseup", at( r.width / 2 + 100 ) ) );
      await sleep( 400 );
      log( `right-drag 100 px across: turned ${( m.getBearing() - b0 ).toFixed( 1 )}°` );
      m.jumpTo( { bearing: 0 } );
      await settled();
    }
    // a big area dragged out with the mouse ( Draw area, then a drag across the map )
    const draw = [...document.querySelectorAll<HTMLButtonElement>( ".mtnw .tool-column .tool" )].find( ( b ) => b.title.startsWith( "Draw area" ) );
    draw?.click();
    await sleep( 300 );
    const canvas = m.getCanvas(), r = canvas.getBoundingClientRect();
    const at     = ( fx: number, fy: number ) => ( { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, button: 0, buttons: 1, bubbles: true } );
    await measure( "dragging out a 10x10 km area", async () => {
      canvas.dispatchEvent( new MouseEvent( "mousedown", at( 0.2, 0.2 ) ) );
      for ( let k = 1; k <= 120; k++ ) {
        const f = k / 120;
        canvas.dispatchEvent( new MouseEvent( "mousemove", at( 0.2 + 0.7 * f, 0.2 + 0.7 * f ) ) );
        await new Promise( ( res ) => setTimeout( res, 16 ) );
      }
      canvas.dispatchEvent( new MouseEvent( "mouseup", at( 0.9, 0.9 ) ) );
      await sleep( 300 );
    } );
    await measure( "checking the big area's data", () => waitFor( () => document.querySelector( ".mtnw-legend" ), "coverage", 60000 ).then( () => sleep( 500 ) ).then( () => undefined ) );
    log( `area: ${document.querySelector( ".mtnw-side .ctx" )?.textContent}; ${document.querySelector( ".mtnw-side .props" )?.textContent?.slice( 0, 300 )}` );
    await sleep( 1000 );
    log( "SHOT mtn_area" );
    await sleep( 2500 );
    // the search: type, Enter, pick the first hit ( a 3 x 3 km area round it )
    const input = document.querySelector<HTMLInputElement>( ".mtnw-search input" )!;
    Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, "value" )!.set!.call( input, "Crotched Mountain" );
    input.dispatchEvent( new Event( "input", { bubbles: true } ) );
    await sleep( 200 );
    input.dispatchEvent( new KeyboardEvent( "keydown", { key: "Enter", bubbles: true } ) );
    const hit = await waitFor( () => document.querySelector<HTMLElement>( ".mtnw-hits .bmenu-item" ), "search results" );
    await sleep( 500 );
    log( "SHOT mtn_search" );
    await sleep( 2500 );
    const tPick = performance.now();
    hit.click();
    await waitFor( () => document.querySelector( ".mtnw-side .ctx" )?.textContent?.includes( "chunk" ), "the area round its runs" );
    await settled();
    await sleep( 1500 );
    log( `picked "${hit.textContent}": ${document.querySelector( ".mtnw-side .ctx" )?.textContent}, name "${document.querySelector<HTMLInputElement>( ".mtnw-name" )?.value}"` );
    // the runs and lifts on Crotched
    const runs = await waitFor( () => {
      const n = m.querySourceFeatures( "trails" ).length;
      return n > 0 ? n : null;
    }, "runs and lifts", 120000 ).catch( () => 0 );
    await settled();
    await sleep( 1000 );
    log( `runs and lifts drawn: ${runs} pieces, ${( ( performance.now() - tPick ) / 1000 ).toFixed( 1 )} s after picking the search result` );
    log( "SHOT mtn_picked" );
    await sleep( 2500 );
    // the + to the east: a column more that way
    const grow = await waitFor( () => [...document.querySelectorAll<HTMLButtonElement>( ".mtnw-grow button" )].find( ( g ) => g.title.includes( "more to the east" ) ), "the east +" );
    const c0   = document.querySelector( ".mtnw-side .props" )?.textContent;
    grow.click();
    await sleep( 500 );
    log( `east +: ${document.querySelector( ".mtnw-side .ctx" )?.textContent}, ${document.querySelectorAll( ".mtnw-grow" ).length} + buttons (was ${c0?.match( /Centre(.*)/ )?.[1]}, now ${document.querySelector( ".mtnw-side .props" )?.textContent?.match( /Centre(.*?)(Elevation|$)/ )?.[1]})` );
    await settled();
    await sleep( 1500 );
    log( "SHOT mtn_area3d" );
    await sleep( 2500 );
    await measure( "3D pan and turn, with the area", tour );
    // panning toward the horizon ( new ground coming in at the far end all the way )
    const c = m.getCenter();
    await measure( "3D pan toward the horizon, 6 km", () => new Promise<void>( ( r ) => {
      m.easeTo( { center: [c.lng, c.lat + 0.054], duration: 3000, easing: ( t ) => t } );
      m.once( "moveend", () => r() );
    } ) );
    await settled();
    await sleep( 1000 );
    log( "SHOT mtn_horizon" );
    await sleep( 2500 );
    // closed and opened again: Crotched's runs come from the saved cache
    useEditor.setState( { mountainImport: false } );
    await sleep( 500 );
    useEditor.setState( { mountainImport: true } );
    const m2 = await waitFor( () => mountainMap(), "the dialog's map again" );
    await new Promise<void>( ( r ) => ( m2.loaded() ? r() : m2.once( "idle", () => r() ) ) );
    const tAgain = performance.now();
    m2.jumpTo( { center: [-71.8739, 42.9983], zoom: 13.2 } );
    const again = await waitFor( () => {
      const n = m2.querySourceFeatures( "trails" ).length;
      return n > 0 ? n : null;
    }, "runs from the cache", 60000 ).catch( () => 0 );
    log( `opened again: ${again} runs and lifts drawn ${( ( performance.now() - tAgain ) / 1000 ).toFixed( 1 )} s after looking there` );
    // Stowe, never looked at in this session
    const tStowe = performance.now();
    m2.jumpTo( { center: [-72.7815, 44.5303], zoom: 13.6, pitch: 55, bearing: 200 } );
    const stowe = await waitFor( () => {
      const f = m2.querySourceFeatures( "trails" ).filter( ( x ) => Math.abs( ( x.geometry as { coordinates: number[][] } ).coordinates?.[0]?.[0] + 72.78 ) < 0.1 );
      return f.length > 0 ? f.length : null;
    }, "Stowe's runs", 30000 ).catch( () => 0 );
    log( `Stowe: ${stowe} runs and lifts drawn ${( ( performance.now() - tStowe ) / 1000 ).toFixed( 1 )} s after looking there` );
    await new Promise<void>( ( r ) => ( !m2.isMoving() && m2.areTilesLoaded() ? r() : m2.once( "idle", () => r() ) ) );
    await sleep( 1000 );
    log( "SHOT mtn_stowe" );
    await sleep( 2500 );
    // the pins, zoomed out over New England; then Stowe's pin clicked
    m2.jumpTo( { center: [-72.2, 43.9], zoom: 7.2, pitch: 40, bearing: 0 } );
    await new Promise<void>( ( r ) => ( !m2.isMoving() && m2.areTilesLoaded() ? r() : m2.once( "idle", () => r() ) ) );
    await sleep( 1500 );
    log( `pins drawn: ${m2.queryRenderedFeatures( { layers: ["skiarea-pins"] } ).length}` );
    log( "SHOT mtn_pins" );
    await sleep( 2500 );
    m2.jumpTo( { center: [-72.79, 44.53], zoom: 9.5, pitch: 40 } );
    await new Promise<void>( ( r ) => ( !m2.isMoving() && m2.areTilesLoaded() ? r() : m2.once( "idle", () => r() ) ) );
    await sleep( 800 );
    const pin = m2.queryRenderedFeatures( { layers: ["skiarea-pins"] } ).find( ( f ) => f.properties?.name === "Stowe Mountain Resort" );
    if ( pin ) {
      const at     = m2.project( ( pin.geometry as unknown as { coordinates: [number, number] } ).coordinates );
      const canvas = m2.getCanvas(), r = canvas.getBoundingClientRect();
      const ev     = { clientX: r.left + at.x, clientY: r.top + at.y - 14, button: 0, bubbles: true };
      canvas.dispatchEvent( new MouseEvent( "mousedown", ev ) );
      canvas.dispatchEvent( new MouseEvent( "mouseup",   ev ) );
      canvas.dispatchEvent( new MouseEvent( "click",     ev ) );
      await sleep( 2500 );
      log( `clicked Stowe's pin: ${document.querySelector( ".mtnw-side .ctx" )?.textContent}, name "${document.querySelector<HTMLInputElement>( ".mtnw-name" )?.value}"` );
      log( "SHOT mtn_stowe_area" );
      await sleep( 2500 );
    } else log( "Stowe's pin not drawn" );
    // Whistler from the search: an area round all its runs; a chunk clicked out; a column taken off with a -
    const box2 = document.querySelector<HTMLInputElement>( ".mtnw-search input" )!;
    Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, "value" )!.set!.call( box2, "whistler" );
    box2.dispatchEvent( new Event( "input", { bubbles: true } ) );
    await sleep( 300 );
    box2.dispatchEvent( new KeyboardEvent( "keydown", { key: "Enter", bubbles: true } ) );
    await sleep( 2500 );
    await new Promise<void>( ( r ) => ( !m2.isMoving() && m2.areTilesLoaded() ? r() : m2.once( "idle", () => r() ) ) );
    const side = () => `${document.querySelector( ".mtnw-side .ctx" )?.textContent}`;
    log( `Whistler: ${side()}, name "${document.querySelector<HTMLInputElement>( ".mtnw-name" )?.value}"` );
    await waitFor( () => document.querySelector( ".mtnw-legend" ), "Whistler's data", 60000 ).catch( () => null );
    {
      const canvas = m2.getCanvas(), r = canvas.getBoundingClientRect();
      const ev     = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1, bubbles: true };
      canvas.dispatchEvent( new MouseEvent( "mousedown", ev ) );
      window.dispatchEvent( new MouseEvent( "mouseup",   ev ) );
      await sleep( 800 );
    }
    log( `a chunk clicked out: ${side()}; data: ${[...document.querySelectorAll( ".mtnw-legend" )].map( ( e ) => e.textContent ).join( " | " )}; detail ${document.querySelector( ".mtnw-side .props" )?.textContent?.match( /Detail(.*?)Surroundings/ )?.[1]}` );
    const minus = [...document.querySelectorAll<HTMLButtonElement>( ".mtnw-grow button" )].find( ( b ) => b.title.includes( "less on the west" ) );
    minus?.click();
    await sleep( 600 );
    log( `west -: ${side()}` );
    await sleep( 800 );
    log( "SHOT mtn_whistler" );
    await sleep( 2500 );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
