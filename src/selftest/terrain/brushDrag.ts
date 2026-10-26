import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/brushdrag ): a project in the folder ( a copy ) opened; each brush dragged across
 * the view and back with pointer events a frame apart, at its default size. Logged per brush: what the moves took ( the
 * brush work in them, and the uploads and rendering in the frames ), the frame rate while stroking and for the two
 * seconds after letting go, and what ending the stroke took.
**/
export async function brushDragSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st                   = () => useEditor.getState();
    const s0                   = st().shapes[0];
    const at: [number, number] = s0?.kind === "curve" ? [s0.start[0] + 25, s0.start[1] - 20] : [0, 0];
    const g                    = ( x: number, z: number ) => terrain.heightAt( x, z );
    eng.nav.lookAtUnity( [at[0] - 45, g( at[0], at[1] ) + 25, at[1]], [at[0], g( at[0], at[1] ), at[1]] );
    st().setTool( "sculpt" );
    await sleep( 2000 );
    const parts: Record<string, number[]> = { uploads: [], render: [], end: [] };
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
    time( terrain,      "flush",  parts.uploads );
    time( eng.renderer, "render", parts.render  );
    time( history,      "push",   parts.end     );
    const canvas = eng.renderer.domElement, r = canvas.getBoundingClientRect();
    const frame  = () => new Promise<number>( ( res ) => requestAnimationFrame( res ) );
    const ev     = ( type: string, fx: number, fy: number ) => {
      const init = { clientX: r.left + fx * r.width, clientY: r.top + fy * r.height, button: 0, buttons: 1, pointerId: 12, bubbles: true };
      if ( type === "pointerup" ) window.dispatchEvent( new PointerEvent( type, init ) );
      else canvas.dispatchEvent( new PointerEvent( type, init ) );
    };
    const q      = ( a: number[], p: number ) => ( a.length ? [...a].sort( ( x, y ) => x - y )[Math.min( a.length - 1, Math.floor( a.length * p ) )] : NaN );
    const ms     = ( a: number[] ) => `${q( a, 0.5 ).toFixed( 1 )}/${q( a, 0.95 ).toFixed( 1 )}`;
    // ( by time: the engine trims its list of frame times )
    const gapsOf = ( from: number, to = Infinity ) => {
      const s = eng.frameStamps.filter( ( t ) => t >= from && t <= to );
      return s.slice( 1 ).map( ( v, i ) => v - s[i] );
    };
    const { BRUSHES } = await import( "../../sculpt/brushes" );
    for ( const radius of [12, 30] )
      for ( const b of BRUSHES ) {
        if ( b.id === "mask" ) continue;
        st().setSculpt( { brush: b.id, radius } );
        await sleep( 300 );
        Object.values( parts ).forEach( ( a ) => ( a.length = 0 ) );
        const handler: number[] = [];
        const from              = performance.now();
        const n                 = 90;
        ev( "pointerdown", 0.3, 0.55 );
        await frame();
        for ( let k = 1; k <= n; k++ ) {
          // across and back again: the same ground twice in one stroke
          const t  = k <= n / 2 ? ( 2 * k ) / n : 2 - ( 2 * k ) / n;
          const t0 = performance.now();
          ev( "pointermove", 0.3 + 0.4 * t, 0.55 );
          handler.push( performance.now() - t0 );
          await frame();
        }
        const up = performance.now();
        ev( "pointerup", 0.3, 0.55 );
        const upTook   = performance.now() - up;
        const stroking = gapsOf( from, up );
        const uploads  = parts.uploads.slice(), render = parts.render.slice();
        const after0   = performance.now();
        await sleep( 2000 );
        const after = gapsOf( after0 );
        log( `${b.id} r${radius}: move ${ms( handler )} ms (max ${Math.max( ...handler ).toFixed( 0 )}); uploads ${ms( uploads )}, render ${ms( render )}; stroking ${( 1000 / q( stroking, 0.5 ) ).toFixed( 0 )} fps (worst frame ${Math.max( ...stroking ).toFixed( 0 )} ms); letting go ${upTook.toFixed( 0 )} ms (history ${parts.end.map( ( x ) => x.toFixed( 0 ) ).join( "+" ) || "-"}); after: ${( 1000 / q( after, 0.5 ) ).toFixed( 0 )} fps, worst frame ${Math.max( ...after ).toFixed( 0 )} ms` );
        history.undo();
        await sleep( 300 );
      }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
