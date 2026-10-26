import { type V3, toThree } from "../../core/coords";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/realtrails, with a copy of Crotched in the folder ): a real mountain's runs laid
 * as trails from the Terrain menu. The map's place on the earth ( lost by older saves ) is put back from the ski area
 * list first. How much of the mountain moved, the time and the frames, a run widened, undo, and views.
**/
export async function realTrailsSelftest( dir: string ) {
  try {
    const projDir                      = joinPath( dir, "Crotched Mountain Ski & Ride.jbrproj" );
    const { skiAreas, searchSkiAreas } = await import( "../../geo/skimap/skiareas" );
    const area                         = searchSkiAreas( await skiAreas(), "Crotched Mountain", 1 )[0];
    const [w, sth, e, n]               = area.box;
    const file                         = joinPath( projDir, "project.json" );
    const pj                           = JSON.parse( await ipc.readText( file ) );
    pj.editor                          = { ...pj.editor, realTerrain: { center: { lon: ( w + e ) / 2, lat: ( sth + n ) / 2 }, seaLevelOffset: 0 } };
    await ipc.writeText( file, JSON.stringify( pj ) );
    await openProject( projDir );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 3000 );
    const st                = () => useEditor.getState();
    const { realTerrainOf } = await import( "../../map/project" );
    log( `map: ${terrain.chunks.length} tiles; place ${JSON.stringify( realTerrainOf()?.center )} (${area.name})` );
    const before = terrain.chunks.map( ( c ) => c.heights.map( ( v ) => v + c.position[1] ) );
    st().setTool( "sculpt" );
    await sleep( 2000 );
    const menu = [...document.querySelectorAll<HTMLButtonElement>( ".bpull" )].find( ( b ) => b.textContent?.trim() === "Terrain" )!;
    menu.dispatchEvent( new MouseEvent( "mousedown", { button: 0, bubbles: true } ) );
    await sleep( 200 );
    const item = [...document.querySelectorAll<HTMLElement>( ".bmenu-item" )].find( ( b ) => b.textContent?.includes( "Trails from Runs" ) );
    log( `menu: "Trails from Runs" ${item ? ( item.classList.contains( "disabled" ) || item.hasAttribute( "disabled" ) ? "greyed out (FAIL)" : "there" ) : "missing (FAIL)"}` );
    const frames = ( ms: number ) =>
      new Promise<string>( ( done ) => {
        let last   = performance.now();
        const end  = last + ms, gaps: number[] = [];
        const tick = () => {
          const t = performance.now();
          gaps.push( t - last );
          last = t;
          if ( t < end ) requestAnimationFrame( tick );
          else done( `${Math.max( ...gaps ).toFixed( 0 )} ms; ${gaps.filter( ( g ) => g > 34 ).length} of ${gaps.length} over 34 ms` );
        };
        requestAnimationFrame( tick );
      } );
    const t0 = performance.now();
    item!.click();
    await waitFor( () => st().trails.runs.length > 0 && !st().busy, "the trails", 120000 );
    const laidMs                      = performance.now() - t0;
    const watch                       = frames( 4000 );
    const { trailTimes, flushTrails } = await import( "../../trails/ground" );
    log( `laid: ${st().trails.runs.length} runs, ${st().trails.nodes.length} points in ${laidMs.toFixed( 0 )} ms (bend ${trailTimes.solve.toFixed( 0 )} ms); tool ${st().tool}; frames after: ${await watch}` );
    flushTrails();
    // how much the mountain moved
    let n0 = 0, sum = 0, worst = 0, over = 0;
    terrain.chunks.forEach( ( c, ci ) => {
      const b = before[ci];
      if ( !b || b.length !== c.heights.length ) return;
      for ( let k = 0; k < c.heights.length; k += 7 ) {
        const d = Math.abs( c.heights[k] + c.position[1] - b[k] );
        n0++;
        sum += d;
        if ( d > worst ) worst = d;
        if ( d > 0.5   ) over++;
      }
    } );
    log( `moved: mean ${( sum / n0 ).toFixed( 3 )} m, at most ${worst.toFixed( 2 )} m, ${( ( 100 * over ) / n0 ).toFixed( 2 )}% of the ground by more than 0.5 m` );
    const b = terrain.bounds();
    eng.nav.lookAtUnity( [( b.x0 + b.x1 ) / 2 - 300, b.y1 + 600, b.z0 - 300], [( b.x0 + b.x1 ) / 2, 0, ( b.z0 + b.z1 ) / 2] );
    await sleep( 2500 );
    await ipc.writeBinary( joinPath( dir, "realtrails-laid.png" ), await eng.pictures.capture() );
    // a point dragged with the mouse, as a person would: each move's cost and the frames meanwhile
    {
      const canvas = eng.renderer.domElement, rc = canvas.getBoundingClientRect();
      const n      = st().trails.nodes[Math.floor( st().trails.nodes.length / 2 )];
      eng.nav.lookAtUnity( [n.p[0] - 200, n.p[1] + 220, n.p[2] - 200], [n.p[0], n.p[1], n.p[2]] );
      await sleep( 1500 );
      const scr = ( u: V3 ) => {
        const q = toThree( u ).project( eng.camera );
        return [( q.x * 0.5 + 0.5 ) * rc.width, ( -q.y * 0.5 + 0.5 ) * rc.height] as const;
      };
      const ev = ( type: string, x: number, y: number, buttons: number ) =>
        ( type === "pointerup" ? window : canvas ).dispatchEvent( new PointerEvent( type, { clientX: rc.left + x, clientY: rc.top + y, button: 0, buttons, pointerId: 97, bubbles: true } ) );
      log( `  (idle with the Trails tool: ${await frames( 1000 )})` );
      const [px, py] = scr( n.p );
      canvas.dispatchEvent( new PointerEvent( "pointerenter", { bubbles: true } ) );
      ev( "pointermove", px, py, 0 );
      await sleep( 50 );
      ev( "pointerdown", px, py, 1 );
      ev( "pointerup",   px, py, 0 );
      await sleep( 300 );
      const costs: number[] = [];
      const watch           = frames( 2500 );
      ev( "pointerdown", px, py, 1 );
      for ( let k = 1; k <= 40; k++ ) {
        const t = performance.now();
        ev( "pointermove", px + k * 3, py + k, 1 );
        costs.push( performance.now() - t );
        await new Promise( ( r ) => requestAnimationFrame( r ) );
      }
      const t0 = performance.now();
      ev( "pointerup", px + 120, py + 40, 0 );
      const release = performance.now() - t0;
      costs.sort( ( x, y ) => x - y );
      const scrollers = [...document.querySelectorAll<HTMLElement>( ".props-body *" )].filter( ( e ) => ["auto", "scroll"].includes( getComputedStyle( e ).overflowY ) );
      log( `  (Properties: ${document.querySelectorAll( ".props-body .panel" ).length} panels, scrolling in ${scrollers.length} place${scrollers.length === 1 ? "" : "s (FAIL)"})` );
      log( `drag a point: each move ${costs[20].toFixed( 1 )} ms typical, ${costs[39].toFixed( 1 )} ms worst; letting go ${release.toFixed( 0 )} ms; frames ${await watch}`        );
    }
    // the longest run widened ( as its Width fields do )
    const { runLength } = await import( "../../trails/trails" );
    const net           = st().trails;
    const longest       = [...net.runs].sort( ( x, y ) => runLength( net, y ) - runLength( net, x ) )[0];
    const wide          = structuredClone( net );
    Object.assign( wide.runs.find( ( r ) => r.id === longest.id )!, { wa: 50, wb: 50 } );
    const { commitTrails } = await import( "../../trails/edits" );
    const t1               = performance.now();
    commitTrails( wide, "Change run" );
    log( `widened a ${runLength( net, longest ).toFixed( 0 )} m run: ${( performance.now() - t1 ).toFixed( 0 )} ms (bend ${trailTimes.solve.toFixed( 0 )}); frames after: ${await frames( 2000 )}` );
    // undo all of it: the mountain exactly as it was
    while ( st().trails.runs.length && history.canUndo ) history.undo();
    flushTrails();
    let back = 0;
    terrain.chunks.forEach( ( c, ci ) => {
      const bb = before[ci];
      if ( !bb || bb.length !== c.heights.length ) return;
      for ( let k = 0; k < c.heights.length; k += 3 ) back = Math.max( back, Math.abs( c.heights[k] + c.position[1] - bb[k] ) );
    } );
    log( `undone: ${st().trails.runs.length} runs; the ground off by at most ${back.toFixed( 4 )} m` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
