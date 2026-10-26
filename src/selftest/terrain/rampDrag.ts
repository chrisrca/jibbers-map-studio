import { getEngine } from "../../ui/Viewport";
import { ipc } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { toThree } from "../../core/coords";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/rampdrag ): a project in the folder ( a copy ) opened; a kicker drawn by dragging up
 * the view, then its end handle dragged back down, with pointer events a frame apart as a mouse gives them. Logged:
 * what each move took ( and the outline redraws, terrain uploads and rendering in it ), the frame rate meanwhile, and how
 * often the end jumped back against the drag.
**/
export async function rampDragSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st                   = () => useEditor.getState();
    // beside the map's first shape, seen from 30 m back and 15 m up
    const s0                   = st().shapes[0];
    const at: [number, number] = s0?.kind === "curve" ? [s0.start[0] + 25, s0.start[1] - 20] : [0, 0];
    const g                    = ( x: number, z: number ) => terrain.heightAt( x, z );
    eng.nav.lookAtUnity( [at[0] - 30, g( at[0], at[1] ) + 15, at[1]], [at[0], g( at[0], at[1] ), at[1]] );
    st().setTool( "shape" );
    useEditor.setState( { shapeKind: "curve" } );
    await sleep( 2000 );
    // what the moves cost, by part
    const parts: Record<string, number[]> = { outlines: [], uploads: [], render: [] };
    const time                            = ( obj: object, name: string, into: number[] ) => {
      const o = obj as Record<string, ( ...a: unknown[] ) => unknown>;
      const f = o[name].bind( obj );
      o[name] = ( ...a: unknown[] ) => {
        const t0 = performance.now();
        try {
          return f( ...a );
        } finally {
          into.push( performance.now() - t0 );
        }
      };
    };
    time( eng.shapeTool, "sync",   parts.outlines );
    time( terrain,       "flush",  parts.uploads  );
    time( eng.renderer,  "render", parts.render   );
    const canvas = eng.renderer.domElement, r = canvas.getBoundingClientRect();
    const frame  = () => new Promise<number>( ( res ) => requestAnimationFrame( res ) );
    const ev     = ( type: string, fx: number, fy: number ) => {
      const init = { clientX: r.left + fx * r.width, clientY: r.top + fy * r.height, button: 0, buttons: 1, pointerId: 11, bubbles: true };
      if ( type === "pointerup" ) window.dispatchEvent( new PointerEvent( type, init ) );
      else canvas.dispatchEvent( new PointerEvent( type, init ) );
    };
    const q      = ( a: number[], p: number ) => ( a.length ? [...a].sort( ( x, y ) => x - y )[Math.min( a.length - 1, Math.floor( a.length * p ) )] : NaN );
    const gapsOf = ( from: number ) => {
      const s = eng.frameStamps.slice( from );
      return s.slice( 1 ).map( ( v, i ) => v - s[i] );
    };
    const idleFrom = eng.frameStamps.length;
    for ( let k = 0; k < 60; k++ ) await frame();
    const idle = gapsOf( idleFrom );
    Object.values( parts ).forEach( ( a ) => ( a.length = 0 ) );
    log( `idle: median frame ${q( idle, 0.5 ).toFixed( 1 )} ms, p95 ${q( idle, 0.95 ).toFixed( 1 )}; ${st().shapes.length} shapes on the map; render ${q( parts.render, 0.5 ).toFixed( 1 )} ms` );
    // a drag from ( x0, y0 ) to ( x1, y1 ) ( fractions of the view ) in `n` moves a frame apart
    const drag = async ( label: string, x0: number, y0: number, x1: number, y1: number, uid: string | null = null, n = 90 ) => {
      Object.values( parts ).forEach( ( a ) => ( a.length = 0 ) );
      const handler: number[] = [], ends: [number, number][] = [];
      const had               = new Set( st().shapes.map( ( s ) => s.uid ) );
      const from              = eng.frameStamps.length;
      ev( "pointerdown", x0, y0 );
      await frame();
      for ( let k = 1; k <= n; k++ ) {
        const t  = k / n;
        const t0 = performance.now();
        ev( "pointermove", x0 + ( x1 - x0 ) * t, y0 + ( y1 - y0 ) * t );
        handler.push( performance.now() - t0 );
        const live = st().shapes.find( ( s ) => ( uid ? s.uid === uid : !had.has( s.uid ) ) );
        if ( live?.kind === "curve" ) ends.push( [...live.end] );
        await frame();
      }
      ev( "pointerup", x1, y1 );
      const gaps  = gapsOf( from );
      // jitter: moves where the end went back against the way it was dragged
      const d     = ends.length > 1 ? [ends[ends.length - 1][0] - ends[0][0], ends[ends.length - 1][1] - ends[0][1]] : [1, 0];
      const len   = Math.hypot( d[0], d[1] ) || 1;
      const along = ends.map( ( e ) => ( e[0] * d[0] + e[1] * d[1] ) / len );
      const back  = along.slice( 1 ).map( ( v, i ) => along[i] - v ).filter( ( x ) => x > 0.01 );
      const ms    = ( a: number[] ) => `${q( a, 0.5 ).toFixed( 1 )}/${q( a, 0.95 ).toFixed( 1 )}`;
      log( `${label}: move ${ms( handler )} ms (median/p95, max ${Math.max( ...handler ).toFixed( 1 )}); in frames: outlines ${ms( parts.outlines )}, uploads ${ms( parts.uploads )}, render ${ms( parts.render )}; frame ${ms( gaps )} ms (max ${Math.max( ...gaps ).toFixed( 0 )}) = ${( 1000 / q( gaps, 0.5 ) ).toFixed( 0 )} fps; the end went back on ${back.length} of ${Math.max( 0, along.length - 1 )} moves (up to ${( Math.max( 0, ...back ) * 100 ).toFixed( 0 )} cm), ${( along[along.length - 1] - along[0] ).toFixed( 1 )} m in all` );
    };
    await drag( "drawing a kicker", 0.5, 0.7, 0.5, 0.35 );
    await sleep( 500 );
    const made = st().shapes.find( ( s ) => s.uid === st().selection[0]?.uid );
    if ( made?.kind !== "curve" ) throw new Error( "no kicker drawn" );
    log( `drawn: ${made.name} ${Math.hypot( made.end[0] - made.start[0], made.end[1] - made.start[1] ).toFixed( 1 )} m long, selected ${st().selection.some( ( x ) => x.uid === made.uid )}` );
    // its end handle, where it's drawn on screen
    const size = Math.max( 0.35, made.width * 0.06 );
    const p    = toThree( [made.end[0], g( made.end[0], made.end[1] ) + size, made.end[1]] ).project( eng.camera );
    await drag( "dragging its end", ( p.x + 1 ) / 2, ( 1 - p.y ) / 2, 0.5, 0.55, made.uid );
    await sleep( 500 );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
