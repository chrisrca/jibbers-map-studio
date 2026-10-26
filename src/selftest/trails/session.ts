import * as THREE from "three/webgpu";
import type { TrailNet as TrailNetT, TrailRun as TrailRunT } from "../../trails/trails";
import { type V3, toUnity } from "../../core/coords";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { log, realInput, sleep, waitFor } from "../harness";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/session ): the Trails tool used as a person uses it, on a new map. The mouse
 * glides ( a move a frame, never jumping ), clicks are a press and a release, drags move every frame, and the camera
 * is orbited ( middle drag ) and zoomed ( wheel ) between edits and while the ground is still settling. Every frame's
 * time is kept, by phase: typical, 95th percentile, worst, how many over 50 ms; and the time the input itself took.
**/
export async function sessionSelftest( dir: string ) {
  try {
    const P = await import( "../../map/project" );
    await P.newEmptyProject( joinPath( dir, `session-${Date.now()}.jbrproj` ), "Session" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 1000 );
    const st     = () => useEditor.getState();
    const canvas = eng.renderer.domElement, rc = canvas.getBoundingClientRect();
    let phase    = "start";
    const io     = realInput( eng, () => phase );
    const { glide, press, release, click, drag, wheel, key, scr } = io;
    // ---- the session
    eng.nav.lookAtUnity( [0, 260, -380], [0, 0, 40] );
    await sleep( 500 );
    phase = "pick the tool";
    // Terrain Mode ( B ) starts on the trails
    window.dispatchEvent( new KeyboardEvent( "keydown", { key: "b", bubbles: true } ) );
    await sleep( 800 );
    log( `Terrain Mode opens on: ${st().tool}${st().tool === "trail" ? "" : " (FAIL: not the trails)"}` );
    const tb = [...document.querySelectorAll<HTMLButtonElement>( ".tool-column .tool" )].find( ( b ) => b.title.startsWith( "Trails" ) )!;
    const tr = tb.getBoundingClientRect();
    await glide( tr.left - rc.left + tr.width / 2, Math.max( 5, tr.top - rc.top + tr.height / 2 ), 300 );
    tb.click();
    await sleep( 300 );
    phase             = "lay a trail";
    const spots: V3[] = [[-60, 0, -160], [-20, 0, -80], [10, 0, 0], [0, 0, 70], [-40, 0, 140], [-90, 0, 200]];
    {
      const { trailTimes }  = await import( "../../trails/ground" );
      const parts: string[] = [];
      for ( const p of spots ) {
        await click( ...scr( p ) );
        parts.push( `${trailTimes.tiles.toFixed( 0 )}/${trailTimes.solve.toFixed( 0 )}/${trailTimes.apply.toFixed( 0 )}` );
      }
      log( `  (each point: tiles/bend/ground ms ${parts.join( ", " )})` );
    }
    phase = "orbit";
    await drag( rc.width * 0.6, rc.height * 0.5, rc.width * 0.35, rc.height * 0.45, 1200, 1 );
    phase = "zoom";
    await wheel( -120, 8 );
    await wheel( 120,  4 );
    phase      = "drag a point";
    const net0 = st().trails;
    const mid  = net0.nodes[2];
    {
      const [x, y] = scr( mid.p );
      await click( x, y, 300 );
      await drag( x, y, x + 70, y - 30, 800 );
    }
    phase = "orbit while the ground settles";
    await drag( rc.width * 0.4, rc.height * 0.5, rc.width * 0.55, rc.height * 0.55, 900, 1 );
    phase = "raise a point (G Z)";
    {
      const n      = st().trails.nodes[3];
      const [x, y] = scr( n.p );
      await click( x, y, 300 );
      await glide( x, y, 100 );
      await key( "g" );
      await key( "z" );
      await glide( x, y - 60, 500 );
      await press( 0 );
      await release( 0 );
    }
    phase = "join a point onto a run";
    {
      // a short spur laid off the trail's end, its end then dragged onto the run between the first two points
      const net      = st().trails;
      const end      = net.nodes[net.nodes.length - 1];
      const [ex, ey] = scr( end.p );
      await key( "Escape" );
      await click( ex, ey, 300 );
      const spur: V3 = [end.p[0] + 120, 0, end.p[2] - 40];
      await click( ...scr( [spur[0], terrain.heightAt( spur[0], spur[2] ), spur[2]] ) );
      const a          = net.nodes[0].p, b = net.nodes[1].p;
      const target: V3 = [( a[0] + b[0] ) / 2, ( a[1] + b[1] ) / 2, ( a[2] + b[2] ) / 2];
      const now        = st().trails, sp = now.nodes[now.nodes.length - 1];
      await key( "Escape" );
      const [sx, sy] = scr( sp.p ), [tx, ty] = scr( target );
      await click( sx, sy, 300 );
      await drag( sx, sy, tx, ty, 1100 );
      const after = st().trails;
      const three = after.nodes.filter( ( n ) => after.runs.filter( ( r ) => r.a === n.id || r.b === n.id ).length >= 3 ).length;
      log( `join: ${now.nodes.length} points / ${now.runs.length} runs -> ${after.nodes.length} / ${after.runs.length}; points where three runs meet: ${three}; undo step "${history.nextUndo}"` );
    }
    phase = "add points along runs";
    {
      // hovering a run's centre line shows the point a click puts there; Ctrl+click with a point picked joins it on
      const { pointOnRun } = await import( "../../trails/trails" );
      const ghost          = ( eng.trailTool as unknown as { ghostMark: THREE.Mesh } ).ghostMark;
      await key( "Escape" );
      const net      = st().trails, r = net.runs[2];
      const [gx, gy] = scr( pointOnRun( net, r, 0.5 ) );
      await glide( gx + 40, gy + 30, 300 );
      const away = ghost.visible;
      await glide( gx, gy, 300 );
      const shown = ghost.visible;
      await click( gx, gy, 100 );
      const n1 = st().trails, made = st().selection[0]?.uid;
      log( `point along a run: shown ${shown ? "on the centre line" : "not (FAIL)"}${away ? ", and off it (FAIL)" : ""}; ${net.nodes.length} points / ${net.runs.length} runs -> ${n1.nodes.length} / ${n1.runs.length}; picked ${made && n1.nodes.some( ( n ) => n.id === made ) ? "the new point" : "something else (FAIL)"}` );
      const far      = n1.runs[n1.runs.length - 1];
      const [fx, fy] = scr( pointOnRun( n1, far, 0.5 ) );
      await click( fx, fy, 400, { ctrlKey: true } );
      const n2   = st().trails, joined = st().selection[0]?.uid;
      const link = n2.runs.some( ( q ) => ( q.a === made && q.b === joined ) || ( q.b === made && q.a === joined ) );
      log( `Ctrl+click along another run: ${n1.nodes.length} / ${n1.runs.length} -> ${n2.nodes.length} / ${n2.runs.length}; ${link ? "joined from the picked point" : "not joined (FAIL)"}; undo step "${history.nextUndo}"` );
      await sleep( 600 );
      const shapeTiles = ( eng.trailTool as unknown as { shape: THREE.Group } ).shape.children.length;
      log( `the runs' shape: ${shapeTiles} tiles drawn` );
      const all = n2.nodes.map( ( n ) => n.p ), cx = all.reduce( ( v, q ) => v + q[0], 0 ) / all.length, cz = all.reduce( ( v, q ) => v + q[2], 0 ) / all.length;
      eng.nav.lookAtUnity( [cx, terrain.heightAt( cx, cz ) + 380, cz - 260], [cx, terrain.heightAt( cx, cz ), cz] );
      await sleep( 700 );
      const png = await eng.pictures.capture();
      await ipc.writeBinary( joinPath( dir, "shape.png" ), png );
      log( "SHOT shape.png" );
    }
    phase = "widen a run";
    {
      await key( "Escape" );
      const net = st().trails, r = net.runs[1];
      const a   = net.nodes.find( ( n ) => n.id === r.a )!.p, b = net.nodes.find( ( n ) => n.id === r.b )!.p;
      // ( well off its centre line: on the line, a click puts a point in it )
      const dx  = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot( dx, dz ) || 1, off = r.wa * 0.3;
      await click( ...scr( [( a[0] + b[0] ) / 2 + ( dz / l ) * off, ( a[1] + b[1] ) / 2 + 0.5, ( a[2] + b[2] ) / 2 - ( dx / l ) * off] ) );
      const tool   = eng.trailTool as unknown as { widthHandle( n: TrailNetT, r: TrailRunT, end: "a" | "b" ): { at: THREE.Vector3 } };
      const picked = st().trails.runs.find( ( x ) => x.id === st().selection[0]?.uid );
      if ( picked ) {
        const w        = tool.widthHandle( st().trails, picked, "b" ).at, u = toUnity( w );
        const [hx, hy] = scr( u );
        await drag( hx, hy, hx + 40, hy + 10, 600 );
        log( `widen: run picked, its end ${picked.wb} -> ${st().trails.runs.find( ( x ) => x.id === picked.id )!.wb} m` );
      } else log( "widen: the run wasn't picked (FAIL)" );
    }
    phase = "undo, orbit, redo";
    await key( "z", { ctrl: true } );
    await drag( rc.width * 0.5, rc.height * 0.5, rc.width * 0.42, rc.height * 0.5, 600, 1 );
    await key( "z", { ctrl: true, shift: true } );
    phase = "idle";
    await sleep( 1500 );
    io.stop();
    // closing the studio with changes not saved: asked first; Cancel keeps it open
    {
      useEditor.setState( { dirty: true } );
      const { getCurrentWindow } = await import( "@tauri-apps/api/window" );
      getCurrentWindow().close().catch( ( e ) => log( `  (close: ${e})` ) );
      const dialog = await waitFor( () => document.querySelector( ".modal" ), "the question", 5000 ).catch( () => null );
      const text   = dialog?.textContent ?? "";
      log( `close: ${dialog ? `asked "${text.slice( 0, 60 )}"` : "not asked (FAIL)"}` );
      [...document.querySelectorAll<HTMLButtonElement>( ".modal .btn" )].find( ( b ) => b.textContent === "Cancel" )?.click();
      await sleep( 800 );
      log( `close cancelled: the studio ${document.querySelector( ".app" ) ? "still open" : "gone (FAIL)"}` );
      useEditor.setState( { dirty: false } );
    }
    // ---- the numbers
    for ( const line of io.report() ) log( line );
    log( `trails: ${st().trails.nodes.length} points, ${st().trails.runs.length} runs; tiles ${terrain.chunks.length}` );
    await ipc.writeBinary( joinPath( dir, "session-end.png" ), await eng.pictures.capture() );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
