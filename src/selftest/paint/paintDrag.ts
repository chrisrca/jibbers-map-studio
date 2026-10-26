import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/paintdrag ): a project in the folder ( a copy ) opened, and paint strokes dragged
 * across the viewport as the mouse does: frames per second while painting and after, and the mask's size.
**/
export async function paintDragSelftest( dir: string ) {
  try {
    const P    = await import( "../../paint/ground" );
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st                   = () => useEditor.getState();
    const g                    = ( x: number, z: number ) => terrain.heightAt( x, z );
    const at: [number, number] = [20, 20];
    eng.nav.lookAtUnity( [at[0] - 40, g( at[0], at[1] ) + 22, at[1]], [at[0], g( at[0], at[1] ), at[1]] );
    st().setTool( "paint" );
    await sleep( 2000 );
    const render: number[] = [];
    {
      const o  = eng.renderer as unknown as Record<string, ( ...a: unknown[] ) => unknown>;
      const f  = o.render.bind( eng.renderer );
      o.render = ( ...a: unknown[] ) => {
        const t0 = performance.now();
        try {
          return f( ...a );
        } finally {
          render.push( performance.now() - t0 );
        }
      };
    }
    const canvas = eng.renderer.domElement, r = canvas.getBoundingClientRect();
    const frame  = () => new Promise<number>( ( res ) => requestAnimationFrame( res ) );
    const ev     = ( type: string, fx: number, fy: number ) => {
      const init = { clientX: r.left + fx * r.width, clientY: r.top + fy * r.height, button: 0, buttons: 1, pointerId: 13, bubbles: true };
      if ( type === "pointerup" ) window.dispatchEvent( new PointerEvent( type, init ) );
      else canvas.dispatchEvent( new PointerEvent( type, init ) );
    };
    const q      = ( a: number[], p: number ) => ( a.length ? [...a].sort( ( x, y ) => x - y )[Math.min( a.length - 1, Math.floor( a.length * p ) )] : NaN );
    const gapsOf = ( from: number, to = Infinity ) => {
      const s = eng.frameStamps.filter( ( t ) => t >= from && t <= to );
      return s.slice( 1 ).map( ( v, i ) => v - s[i] );
    };
    const idle0 = performance.now();
    await sleep( 1500 );
    log( `idle: ${( 1000 / q( gapsOf( idle0 ), 0.5 ) ).toFixed( 0 )} fps` );
    for ( const radius of [1.5, 6] )
      for ( const tool of ["snow", "marking"] as const ) {
        st().setPaint( { tool, radius, strength: 0.8 } );
        await sleep( 300 );
        render.length = 0;
        const from    = performance.now();
        const n       = 90;
        ev( "pointerdown", 0.3, 0.6 );
        await frame();
        for ( let k = 1; k <= n; k++ ) {
          ev( "pointermove", 0.3 + ( 0.4 * k ) / n, 0.6 + 0.1 * Math.sin( k / 9 ) );
          await frame();
        }
        const up = performance.now();
        ev( "pointerup", 0.7, 0.6 );
        const stroking = gapsOf( from, up );
        const rs       = render.slice();
        const after0   = performance.now();
        await sleep( 1500 );
        const after = gapsOf( after0 );
        const sizes = terrain.chunks.map( ( c ) => P.layerOf( c.key )?.m ?? 0 ).join( "/" );
        if ( radius === 6 ) await ipc.writeBinary( joinPath( dir, `${tool}.png` ), await eng.pictures.capture() );
        log( `${tool} r${radius}: stroking ${( 1000 / q( stroking, 0.5 ) ).toFixed( 0 )} fps (worst frame ${Math.max( ...stroking ).toFixed( 0 )} ms, render ${q( rs, 0.5 ).toFixed( 1 )}/${q( rs, 0.95 ).toFixed( 1 )} ms); after ${( 1000 / q( after, 0.5 ) ).toFixed( 0 )} fps; masks ${sizes}` );
        history.undo();
        await sleep( 300 );
      }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
