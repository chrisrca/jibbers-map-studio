import * as THREE from "three/webgpu";
import type { TrailNet as TrailNetT, TrailRun as TrailRunT } from "../../trails/trails";
import { type V3, toThree } from "../../core/coords";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { saveProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/trails ): trails laid out as a person does on a new empty map: Terrain Mode, the
 * Trails tool, three clicks on the floor ( two runs ), the middle point picked and raised ( G Z and the mouse ), a run's
 * roll set in Properties; the ground on the runs, beside them, each edit's time, undo, saved and opened again, and
 * the export. Views left in the folder.
**/
export async function trailsSelftest( dir: string ) {
  try {
    const P    = await import( "../../map/project" );
    const proj = joinPath( dir, `trails-${Date.now()}.jbrproj` );
    await P.newEmptyProject( proj, "Trails" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 800 );
    const st     = () => useEditor.getState();
    const canvas = eng.renderer.domElement, r = canvas.getBoundingClientRect();
    const ptr    = ( type: string, x: number, y: number, buttons: number, mods: { ctrl?: boolean } = {} ) => {
      const init = { clientX: r.left + x, clientY: r.top + y, button: 0, buttons, pointerId: 97, bubbles: true, ctrlKey: !!mods.ctrl };
      ( type === "pointerup" ? window : canvas ).dispatchEvent( new PointerEvent( type, init ) );
    };
    const key = ( k: string ) => {
      const code = k.length === 1 ? ( /\d/.test( k ) ? `Digit${k}` : `Key${k.toUpperCase()}` ) : k;
      const init = { key: k, code, bubbles: true, cancelable: true };
      window.dispatchEvent( new KeyboardEvent( "keydown", init ) );
      window.dispatchEvent( new KeyboardEvent( "keyup",   init ) );
    };
    const hover = async ( x: number, y: number ) => {
      canvas.dispatchEvent( new PointerEvent( "pointerenter", { bubbles: true } ) );
      ptr( "pointermove", x, y, 0 );
      await sleep( 40 );
    };
    const click = async ( x: number, y: number, mods: { ctrl?: boolean } = {} ) => {
      await hover( x, y );
      const t0 = performance.now();
      ptr( "pointerdown", x, y, 1, mods );
      const took = performance.now() - t0;
      ptr( "pointerup", x, y, 0, mods );
      await sleep( 250 );
      return took;
    };
    const screenOf = ( u: V3 ) => {
      const q = toThree( u ).project( eng.camera );
      return [( q.x * 0.5 + 0.5 ) * r.width, ( -q.y * 0.5 + 0.5 ) * r.height] as const;
    };
    // looking down the slope-to-be from above
    eng.nav.lookAtUnity( [0, 420, -520], [0, 0, 20] );
    await sleep( 500 );
    st().setTool( "sculpt" );
    await sleep( 200 );
    [...document.querySelectorAll<HTMLButtonElement>( ".tool-column .tool" )].find( ( b ) => b.title.startsWith( "Trails" ) )!.click();
    await sleep( 300 );
    log( `tool: ${st().tool}; header ${document.querySelector( ".tool-settings" )?.textContent?.trim().slice( 0, 40 )}` );
    // three clicks: a point, then two runs on from it
    const pts:   V3[]        = [[0, 0, -220], [50, 0, 0], [-40, 0, 230]];
    const took:  number[]    = [];
    const parts: string[]    = [];
    const { trailTimes: tt } = await import( "../../trails/ground" );
    for ( const p of pts ) {
      took.push( await click( ...screenOf( p ) ) );
      parts.push( `tiles ${tt.tiles.toFixed( 0 )} bend ${tt.solve.toFixed( 0 )} ground ${tt.apply.toFixed( 0 )}` );
    }
    log( `  (clicks: ${parts.join( " / " )})` );
    const net = st().trails;
    log( `laid: ${net.nodes.length} points, ${net.runs.length} runs; tiles ${terrain.chunks.length}; clicks took ${took.map( ( t ) => t.toFixed( 0 ) ).join( " / " )} ms; picked ${st().selection.map( ( s ) => s.kind ).join( "," )}` );
    await sleep( 1500 );
    await ipc.writeBinary( joinPath( dir, "trails-laid.png" ), await eng.pictures.capture() );
    // the middle point: picked, then G Z and the mouse up the screen, a click to keep it
    const mid = net.nodes[1];
    await click( ...screenOf( mid.p ) );
    log( `picked: ${st().selection.map( ( s ) => `${s.kind}` ).join( "," )} (${st().selection[0]?.uid === mid.id ? "the middle point" : "something else (FAIL)"}); Properties: ${document.querySelector( ".props-body" )?.textContent?.slice( 0, 30 )}` );
    const [mx, my] = screenOf( mid.p );
    await hover( mx, my );
    key( "g" );
    await sleep( 50 );
    key( "z" );
    for ( let k = 1; k <= 10; k++ ) await hover( mx, my - k * 12 );
    // ( the longest frame from the click to a second and a half after: what dragging would feel like )
    const frames = ( ms: number ) =>
      new Promise<string>( ( done ) => {
        let last   = performance.now();
        const end  = last + ms, gaps: number[] = [];
        const tick = () => {
          const t = performance.now();
          gaps.push( t - last );
          last = t;
          if ( t < end ) requestAnimationFrame( tick );
          else done( `${Math.max( ...gaps ).toFixed( 0 )} ms; ${gaps.filter( ( g ) => g > 34 ).length} over 34 ms: ${gaps.filter( ( g ) => g > 34 ).map( ( g ) => g.toFixed( 0 ) ).join( " " )}` );
        };
        requestAnimationFrame( tick );
      } );
    {
      // the same view drawn every frame with nothing changing: what a frame costs here anyway
      const { redraw } = await import( "../../viewport/redraw" );
      let on           = true;
      const keep       = () => {
        redraw();
        if ( on ) requestAnimationFrame( keep );
      };
      requestAnimationFrame( keep );
      log( `  (frames drawn with nothing changing: ${await frames( 1000 )})` );
      on = false;
      await sleep( 100 );
    }
    const t1    = performance.now();
    const watch = frames( 1500 );
    ptr( "pointerdown", mx, my - 120, 1 );
    ptr( "pointerup",   mx, my - 120, 0 );
    const raiseMs = performance.now() - t1;
    log( `  (longest frame round the keep: ${await watch})` );
    const raised         = st().trails.nodes.find( ( n ) => n.id === mid.id )!;
    const { trailTimes } = await import( "../../trails/ground" );
    log( `  (tiles ${trailTimes.tiles.toFixed( 0 )}, bend ${trailTimes.solve.toFixed( 0 )}, ground ${trailTimes.apply.toFixed( 0 )} ms)` );
    log( `raised: the point at ${raised.p.map( ( v ) => v.toFixed( 1 ) ).join( ", " )} (was ${mid.p.map( ( v ) => v.toFixed( 1 ) ).join( ", " )}); keep took ${raiseMs.toFixed( 0 )} ms; ground there ${terrain.heightAt( raised.p[0], raised.p[2] ).toFixed( 2 )} m; undo step "${history.nextUndo}"` );
    // the ground: on the runs, just beside, far off
    const { runStrip } = await import( "../../trails/trails" );
    let worst          = 0;
    for ( const run of st().trails.runs ) {
      // ( the middle of each run: its ends round off where it meets the next )
      const s = runStrip( st().trails, run, 4 ), span = s.last - s.first;
      for ( let k = s.first + Math.ceil( span * 0.25 ); k <= s.first + Math.floor( span * 0.75 ); k++ )
        for ( let q = 2; q < s.cols - 2; q++ ) {
          const o = ( k * s.cols + q ) * 4;
          worst   = Math.max( worst, Math.abs( terrain.heightAt( s.pts[o], s.pts[o + 2] ) - s.pts[o + 1] ) );
        }
    }
    const side = terrain.heightAt( raised.p[0] + 60, raised.p[2] ), far = terrain.heightAt( raised.p[0] + 450, raised.p[2] );
    log( `ground: on the runs off by at most ${worst.toFixed( 2 )} m; 60 m beside the point ${side.toFixed( 1 )} m; 450 m off ${far.toFixed( 1 )} m` );
    // a run picked ( its ribbon ), its roll set in Properties
    const run0 = st().trails.runs[0];
    const a    = st().trails.nodes.find( ( n ) => n.id === run0.a )!.p, b = st().trails.nodes.find( ( n ) => n.id === run0.b )!.p;
    key( "Escape" );
    await sleep( 100 );
    // ( off its centre line, across it, a quarter of its width: on the line, a click puts a point in it )
    const { pointOnRun } = await import( "../../trails/trails" );
    const dx             = b[0] - a[0], dz = b[2] - a[2], dl = Math.hypot( dx, dz ) || 1, half = pointOnRun( st().trails, run0, 0.5 );
    const off            = ( run0.wa + run0.wb ) / 8;
    const onRun          = screenOf( [half[0] + ( dz / dl ) * off, half[1], half[2] - ( dx / dl ) * off] );
    await click( ...onRun );
    log( `run picked: ${st().selection.map( ( s ) => s.kind ).join( "," )}; panel "${document.querySelector( ".props-body .panel-title, .props-body" )?.textContent?.slice( 0, 20 )}"` );
    // the picked run's end corner ( its left ) dragged up the screen
    {
      const { handlePoints } = await import( "../../trails/trails" );
      const runNow           = st().trails.runs.find( ( r ) => r.id === st().selection[0]?.uid )!;
      const corner           = handlePoints( st().trails, runNow ).find( ( q ) => q.which === "corner" && q.index === 2 )!;
      const [hx, hy]         = screenOf( corner.p );
      await hover( hx, hy );
      ptr( "pointerdown", hx, hy, 1 );
      for ( let k = 1; k <= 8; k++ ) await hover( hx, hy - k * 8 );
      ptr( "pointerup", hx, hy - 64, 0 );
      await sleep( 400 );
      const after           = st().trails.runs.find( ( r ) => r.id === runNow.id )!;
      const { flushTrails } = await import( "../../trails/ground" );
      flushTrails();
      log( `corner dragged: end-left corner ${after.corners[2].toFixed( 1 )} m (others ${after.corners[0]}, ${after.corners[1]}, ${after.corners[3]}); ground there ${terrain.heightAt( corner.p[0], corner.p[2] ).toFixed( 1 )} m (was ${corner.p[1].toFixed( 1 )}); undo step "${history.nextUndo}"` );
    }
    // its width at the end: the width handle ( out past the right edge ) dragged further out
    {
      const id    = st().selection[0]?.uid;
      const r0    = st().trails.runs.find( ( r ) => r.id === id )!;
      const tool  = eng.trailTool as unknown as { widthHandle( n: TrailNetT, r: TrailRunT, end: "a" | "b" ): { at: THREE.Vector3; centre: THREE.Vector3 } };
      const wh    = tool.widthHandle( st().trails, r0, "b" );
      const out   = wh.at.clone().add( wh.at.clone().sub( wh.centre ).setY( 0 ).normalize().multiplyScalar( 10 ) );
      const toScr = ( v: THREE.Vector3 ) => {
        const q = v.clone().project( eng.camera );
        return [( q.x * 0.5 + 0.5 ) * r.width, ( -q.y * 0.5 + 0.5 ) * r.height] as const;
      };
      const [ax, ay] = toScr( wh.at ), [bx, by] = toScr( out );
      await hover( ax, ay );
      ptr( "pointerdown", ax, ay, 1 );
      for ( let k = 1; k <= 6; k++ ) await hover( ax + ( ( bx - ax ) * k ) / 6, ay + ( ( by - ay ) * k ) / 6 );
      ptr( "pointerup", bx, by, 0 );
      await sleep( 400 );
      const r1 = st().trails.runs.find( ( r ) => r.id === id )!;
      log( `width dragged: end width ${r0.wb} -> ${r1.wb} m (start ${r1.wa} m kept); undo step "${history.nextUndo}"` );
    }
    // the middle point's handle ( its run towards the end ) dragged sideways: the runs through it curve, both ways
    {
      const midId = st().trails.nodes[1].id;
      key( "Escape" );
      const mp = st().trails.nodes[1].p;
      await click( ...screenOf( mp ) );
      const run      = st().trails.runs.find( ( r ) => r.a === midId )!;
      const tip: V3  = [mp[0] + run.ha[0], mp[1] + run.ha[1], mp[2] + run.ha[2]];
      const [tx, ty] = screenOf( tip );
      await hover( tx, ty );
      ptr( "pointerdown", tx, ty, 1 );
      for ( let k = 1; k <= 8; k++ ) await hover( tx + k * 10, ty );
      ptr( "pointerup", tx + 80, ty, 0 );
      await sleep( 400 );
      const n2  = st().trails;
      const r1  = n2.runs.find( ( r ) => r.a === midId )!, r0 = n2.runs.find( ( r ) => r.b === midId )!;
      const ang = ( v: number[] ) => ( Math.atan2( v[0], v[2] ) * 180 ) / Math.PI;
      log( `handle turned: out ${ang( r1.ha ).toFixed( 0 )}° (was ${ang( run.ha ).toFixed( 0 )}°), in ${ang( r0.hb ).toFixed( 0 )}° (straight through: ${Math.abs( ( ( ang( r1.ha ) - ang( r0.hb ) + 360 ) % 360 ) - 180 ).toFixed( 1 )}° off a straight line)` );
      // that handle now has the gizmo: G Z and the mouse up the screen tilt the run's end up
      const picked   = st().trailHandle;
      const r1b      = st().trails.runs.find( ( r ) => r.a === midId )!;
      const tip2: V3 = [mp[0] + r1b.ha[0], mp[1] + r1b.ha[1], mp[2] + r1b.ha[2]];
      const [gx, gy] = screenOf( tip2 );
      await hover( gx, gy );
      key( "g" );
      await sleep( 50 );
      key( "z" );
      for ( let k = 1; k <= 6; k++ ) await hover( gx, gy - k * 10 );
      ptr( "pointerdown", gx, gy - 60, 1 );
      ptr( "pointerup",   gx, gy - 60, 0 );
      await sleep( 400 );
      const r1c = st().trails.runs.find( ( r ) => r.a === midId )!;
      log( `handle gizmo: picked ${picked ? `${picked.end} end` : "none (FAIL)"}; its height ${r1b.ha[1].toFixed( 1 )} -> ${r1c.ha[1].toFixed( 1 )} m, across unchanged ${Math.hypot( r1c.ha[0] - r1b.ha[0], r1c.ha[2] - r1b.ha[2] ).toFixed( 2 )} m; undo step "${history.nextUndo}"` );
    }
    // nothing picked: the Trails panel on the right; Fit to Ground from it
    key( "Escape" );
    await sleep( 200 );
    const body = () => document.querySelector( ".props-body" )?.textContent ?? "";
    log( `panel: ${["New Runs", "Follow Ground"].map( ( t ) => `${t} ${body().includes( t ) ? "there" : "missing (FAIL)"}` ).join( ", " )}; ground settings ${body().includes( "Blend" ) ? "still there (FAIL)" : "gone"}; Fit to Ground ${body().includes( "Fit to Ground" ) ? "offered on a new map (FAIL)" : "not offered on a new map"}; Runs section ${body().includes( "Runs" ) && !body().includes( "New Runs" ) ? "shown empty (FAIL)" : "not shown"}` );
    const { commitTrails, previewNet } = await import( "../../trails/edits" );
    // ( as the Roll field does: shown while it changes, the ground on letting go )
    const rolled                       = structuredClone( st().trails );
    rolled.runs[0].roll = 8;
    previewNet( rolled );
    const t2 = performance.now();
    commitTrails( st().trails, "Change run" );
    log( `roll: ${( performance.now() - t2 ).toFixed( 0 )} ms (tiles ${trailTimes.tiles.toFixed( 0 )}, bend ${trailTimes.solve.toFixed( 0 )})` );
    await sleep( 1500 );
    eng.nav.lookAtUnity( [-480, 380, -380], [0, 40, 40] );
    await sleep( 1500 );
    await ipc.writeBinary( joinPath( dir, "trails-ground.png" ), await eng.pictures.capture() );
    // close beside the middle point: the ground round the runs, up close
    {
      const m = st().trails.nodes[1].p;
      eng.nav.lookAtUnity( [m[0] + 90, m[1] + 25, m[2] - 70], [m[0], m[1] - 15, m[2]] );
      await sleep( 1500 );
      await ipc.writeBinary( joinPath( dir, "trails-close.png" ), await eng.pictures.capture() );
    }
    // sculpt on top, then the point moved again: the sculpt stays
    const c          = terrain.chunks[terrain.chunkAt( raised.p[0] + 100, raised.p[2] )];
    const [fi, fj]   = c.toSample( raised.p[0] + 100, raised.p[2] );
    const idx        = Math.round( fj ) * c.res + Math.round( fi );
    const before     = c.heights[idx];
    c.heights[idx]  += 3;
    const moved      = structuredClone( st().trails );
    moved.nodes[1].p = [raised.p[0] + 20, raised.p[1], raised.p[2]];
    commitTrails( moved, "Move point" );
    const { flushTrails } = await import( "../../trails/ground" );
    flushTrails();
    const moveBy = terrain.chunks[terrain.chunkAt( raised.p[0] + 100, raised.p[2] )].heights[idx] - before - 3;
    history.undo();
    flushTrails();
    const c2 = terrain.chunks[terrain.chunkAt( raised.p[0] + 100, raised.p[2] )];
    log( `sculpt kept: the ground there moved ${moveBy.toFixed( 2 )} m with the point; the move undone, the 3 m bump is ${( c2.heights[idx] - before ).toFixed( 3 )} m` );
    history.redo();
    // undo all of it: back to nothing
    while ( history.canUndo ) history.undo();
    log( `undone: ${st().trails.nodes.length} points; ground at the middle ${terrain.heightAt( 50, 0 ).toFixed( 2 )} m` );
    while ( history.canRedo ) history.redo();
    // saved, opened again: trails and what they need to change
    await saveProject();
    await P.openProject( proj );
    await sleep( 1500 );
    const back = st().trails;
    log( `reopened: ${back.nodes.length} points, ${back.runs.length} runs; ground at the middle point ${terrain.heightAt( back.nodes[1].p[0], back.nodes[1].p[2] ).toFixed( 2 )} (point ${back.nodes[1].p[1].toFixed( 2 )})` );
    const again      = structuredClone( back );
    again.nodes[1].p = [again.nodes[1].p[0], again.nodes[1].p[1] - 10, again.nodes[1].p[2]];
    st().setTool( "trail" );
    commitTrails( again, "Move point" );
    flushTrails();
    log( `edited after reopening: ground at the point ${terrain.heightAt( again.nodes[1].p[0], again.nodes[1].p[2] ).toFixed( 2 )} (point ${again.nodes[1].p[1].toFixed( 2 )})` );
    await saveProject();
    const out = joinPath( dir, "trails.jbrmap" );
    const ex  = await ipc.exportProject( proj, out );
    log( `exported: ${ex.chunks} chunks, ${( ex.bytes / 1e6 ).toFixed( 0 )} MB` );
    // a point laid on from the end of the trail, then dragged onto its start: the trail closes into a loop
    {
      eng.nav.lookAtUnity( [0, 420, -520], [0, 0, 20] );
      await sleep( 600 );
      const ends = st().trails;
      const last = ends.nodes.find( ( n ) => ends.runs.filter( ( r ) => r.a === n.id || r.b === n.id ).length === 1 && n.id !== ends.nodes[0].id )!;
      key( "Escape" );
      await click( ...screenOf( last.p ) );
      log( `  (join: picked ${st().selection.map( ( x ) => x.kind ).join( "," )})` );
      await click( ...screenOf( [last.p[0] - 150, terrain.heightAt( last.p[0] - 150, last.p[2] + 40 ), last.p[2] + 40] ) );
      log( `  (join: ${st().trails.nodes.length} points after the ground click; picked ${st().selection.map( ( x ) => x.kind ).join( "," )}; tool ${st().tool})` );
      const q        = st().trails.nodes[st().trails.nodes.length - 1];
      const before   = { n: st().trails.nodes.length, r: st().trails.runs.length };
      const [qx, qy] = screenOf( q.p ), [tx, ty] = screenOf( st().trails.nodes[0].p );
      await hover( qx, qy );
      ptr( "pointerdown", qx, qy, 1 );
      for ( let k = 1; k <= 10; k++ ) await hover( qx + ( ( tx - qx ) * k ) / 10, qy + ( ( ty - qy ) * k ) / 10 );
      ptr( "pointerup", tx, ty, 0 );
      await sleep( 400 );
      const after = st().trails;
      log( `joined by dragging: ${before.n} points / ${before.r} runs -> ${after.nodes.length} / ${after.runs.length}; the start point now has ${after.runs.filter( ( r ) => r.a === after.nodes[0].id || r.b === after.nodes[0].id ).length} runs; undo step "${history.nextUndo}"` );
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
