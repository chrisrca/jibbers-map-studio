// Watches for the editor getting slow — the 3D view drawing few frames, or mouse moves reaching it late — and then
// saves a report with what was going on: frame times, mouse moves per second, the game's window state and its own
// frame rate, GPU and process figures. Slowdowns that only happen on one machine can be read from it afterwards.
//
// Mouse moves arriving late look like this: while a button is held, a move comes long after the last one and far
// from it ( the hand kept moving; the moves were held up on their way in ). The view itself keeps drawing at full
// rate then, so frame times alone don't show it — that's how the game-in-the-window lag looked.

import { invoke } from "@tauri-apps/api/core";
import { useEditor } from "../map/store";
import { terrain } from "../terrain/terrain";
import { getEngine } from "../ui/Viewport";

let started       = false;
let lastReport    = 0;
let pointerEvents = 0;
let lateJumps     = 0;
let lastMove: { t: number; x: number; y: number } | null = null;
const perSecond: { fps: number; worstMs: number; moves: number; late: number }[] = [];

/**
 * Frame times of the last `ms` ( from the engine's own frame stamps ).
**/
function frameStats( ms: number ) {
  const ts     = getEngine()?.frameStamps ?? [];
  const now    = performance.now();
  const recent = ts.filter( ( t ) => now - t <= ms );
  const gaps   = recent.slice( 1 ).map( ( t, i ) => t - recent[i] ).sort( ( a, b ) => a - b );
  return {
    frames: recent.length,
    median: gaps[Math.floor( gaps.length / 2 )] ?? Infinity,
    worst:  gaps[gaps.length - 1] ?? Infinity,
  };
}

function onMove( e: PointerEvent ) {
  pointerEvents++;
  const now = performance.now();
  if ( !e.buttons ) {
    lastMove = null;
    return;
  }
  const locked = !!document.pointerLockElement;
  const x      = locked ? ( lastMove?.x ?? 0 ) + e.movementX : e.screenX;
  const y      = locked ? ( lastMove?.y ?? 0 ) + e.movementY : e.screenY;
  if ( lastMove && now - lastMove.t > 120 && Math.hypot( x - lastMove.x, y - lastMove.y ) > 40 ) lateJumps++;
  lastMove = { t: now, x, y };
}

/**
 * Writes a report now ( from the watcher, or Help › Save a lag report ). Returns where it went.
**/
export async function saveLagReport( reason: string ): Promise<string | null> {
  const st    = useEditor.getState();
  const eng   = getEngine();
  const f3    = frameStats( 3000 );
  const lines = [
    `Jibbers Map Studio lag report — ${new Date().toString()}`,
    `why: ${reason}`,
    "",
    "== the editor",
    `3D view, last 3 s: ${f3.frames} frames, median ${f3.median.toFixed( 1 )} ms, worst ${f3.worst.toFixed( 0 )} ms`,
    "per second, newest last (frames drawn / longest frame / mouse moves received / moves that arrived late):",
    `  ${perSecond.slice( -12 ).map( ( s ) => `${s.fps}/${s.worstMs}ms/${s.moves}/${s.late}` ).join( "  " )}`,
    `tab ${st.centerTab}, tool ${st.tool}, camera ${st.cameraMode}, game popped out ${st.gamePoppedOut}, page ${document.visibilityState}, focused ${document.hasFocus()}`,
    `window ${window.innerWidth}x${window.innerHeight} at ${window.devicePixelRatio}x, canvas ${eng?.renderer.domElement.width}x${eng?.renderer.domElement.height}`,
    `map: ${terrain.chunks.length} chunks, ${st.objects.length} features, ${st.customObjects.length} pieces, ${st.shapes.length} shapes`,
    `memory: ${( ( performance as unknown as { memory?: { usedJSHeapSize: number } } ).memory?.usedJSHeapSize ?? 0 ) / 1e6 | 0} MB of JS heap`,
    "",
  ];
  try {
    return await invoke<string>( "save_lag_report", { text: lines.join( "\n" ) } );
  } catch ( e ) {
    console.warn( "lag report failed", e );
    return null;
  }
}

/**
 * Starts watching ( once ).
**/
export function startLagWatch() {
  if ( started ) return;
  started = true;
  window.addEventListener( "pointermove", onMove, { capture: true, passive: true } );
  let slowSeconds = 0;
  let lateSeconds = 0;
  setInterval( () => {
    const st = useEditor.getState();
    const f  = frameStats( 1000 );
    perSecond.push( { fps: f.frames, worstMs: Number.isFinite( f.worst ) ? Math.round( f.worst ) : -1, moves: pointerEvents, late: lateJumps } );
    if ( perSecond.length > 60 ) perSecond.shift();
    const late     = lateJumps;
    pointerEvents  = 0;
    lateJumps      = 0;
    // the 3D view only counts while it's showing and someone is using it ( moving the mouse over the window ): a map
    // loading or a long operation isn't the lag this is for
    const watching = st.projectDir && st.centerTab === "editor" && document.visibilityState === "visible" && perSecond[perSecond.length - 1].moves > 0;
    slowSeconds    = watching && f.frames < 15 ? slowSeconds + 1 : 0;
    lateSeconds    = late >= 3 ? lateSeconds + 1 : 0;
    if ( ( slowSeconds >= 2 || lateSeconds >= 2 ) && Date.now() - lastReport > 120_000 ) {
      lastReport = Date.now();
      const why  = slowSeconds >= 2 ? `the 3D view drew ${f.frames} frames a second for ${slowSeconds} s` : `mouse moves arrived late (${late} jumps a second, ${lateSeconds} s running)`;
      saveLagReport( why ).then( ( path ) => {
        if ( path ) useEditor.getState().toast( `The editor was lagging — saved a report for fixing it (${path.split( /[\\/]/ ).pop()})`, "info" );
      } );
    }
  }, 1000 );
}
