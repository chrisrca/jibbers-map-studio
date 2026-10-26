import type { BrushId } from "../../sculpt/brushes";
import { getEngine } from "../../ui/Viewport";
import { joinPath } from "../../core/ipc";
import { log, realInput, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/brushstress ): every sculpt brush as a person uses it, on a real mountain's rough
 * ground ( a copy of Crotched ): the brush picked, then strokes dragged across the view with a gliding mouse at a small,
 * a middling and a big size, quick and slow, each frame timed ( what you'd feel as stutter ) and the input's own time.
**/
export async function brushStressSelftest( dir: string ) {
  try {
    const projDir = joinPath( dir, "Crotched Mountain Ski & Ride.jbrproj" );
    await openProject( projDir );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 3000 );
    const st = () => useEditor.getState();
    const b  = terrain.bounds(), cx = ( b.x0 + b.x1 ) / 2, cz = ( b.z0 + b.z1 ) / 2;
    const sp = Math.min( ...terrain.chunks.map( ( c ) => c.spacing ) );
    log( `map: ${terrain.chunks.length} tiles, ${sp.toFixed( 2 )} m between samples; ${( b.x1 - b.x0 ).toFixed( 0 )} x ${( b.z1 - b.z0 ).toFixed( 0 )} m` );
    eng.nav.lookAtUnity( [cx, terrain.heightAt( cx, cz ) + 260, cz - 300], [cx, terrain.heightAt( cx, cz ), cz] );
    await sleep( 1500 );
    st().setTool( "sculpt" );
    await sleep( 1500 );
    let phase              = "start";
    // ( where a dab's time goes, and the terrain's upload each frame: by phase )
    const { BrushStroke  } = await import( "../../sculpt/stroke/stroke" );
    const { HeightWindow } = await import( "../../sculpt/window"        );
    const parts            = new Map<string, Record<string, number>>();
    const add              = ( k: string, ms: number ) => {
      const e = parts.get( phase ) ?? parts.set( phase, {} ).get( phase )!;
      e[k]    = ( e[k] ?? 0 ) + ms;
    };
    const wrap = ( obj: Record<string, unknown>, name: string, key = name ) => {
      const f   = obj[name] as ( ...a: unknown[] ) => unknown;
      obj[name] = function ( this: unknown, ...a: unknown[] ) {
        const t = performance.now();
        try {
          return f.apply( this, a );
        } finally {
          add( key, performance.now() - t );
        }
      };
    };
    const BP = BrushStroke.prototype as unknown as Record<string, unknown>;
    for ( const m of ["dab", "weights", "op", "original", "coverage", "fine"] ) wrap( BP, m );
    wrap( HeightWindow as unknown as Record<string, unknown>,           "around"    );
    wrap( HeightWindow.prototype as unknown as Record<string, unknown>, "writeBack" );
    wrap( terrain as unknown as Record<string, unknown>,                "flush"     );
    const BPd = BP.dab as ( ...a: unknown[] ) => unknown;
    BP.dab    = function ( this: unknown, ...a: unknown[] ) {
      add( "dabs", 1 );
      return BPd.apply( this, a );
    };
    const io              = realInput( eng, () => phase );
    const { drag, glide } = io;
    const W               = io.rc.width, H = io.rc.height;
    const only            = ( new URLSearchParams( location.search ).get( "brushes" ) ?? "" ).split( "," ).filter( Boolean );
    const brushes         = ( only.length ? only : ["draw", "layer", "clay", "smooth", "flatten", "terrace", "noise", "crease", "pinch", "smudge", "mask"] ) as BrushId[];
    let row               = 0;
    for ( const brush of brushes )
      for ( const radius of [8, 30, 90] ) {
        st().setSculpt( { brush, radius } );
        await sleep( 150 );
        // a fresh strip of ground each time, quick then slow
        const y = H * ( 0.3 + 0.05 * ( row++ % 9 ) );
        phase   = `${brush} r${radius} quick`;
        await drag( W * 0.25, y, W * 0.75, y + 20, 700 );
        phase = `${brush} r${radius} slow`;
        await drag( W * 0.75, y + 40, W * 0.3, y + 50, 2200 );
        phase = `${brush} r${radius} after`;
        await glide( W * 0.5, H * 0.85, 500 );
      }
    io.stop();
    for ( const line of io.report() ) log( line );
    for ( const [ph, e] of parts ) {
      const n = e.dabs ?? 0;
      if ( !n ) continue;
      const per = ( k: string ) => ( ( e[k] ?? 0 ) / n ).toFixed( 1 );
      log( `  ${ph}: ${n} dabs, ${per( "dab" )} ms a dab (window ${per( "around" )}, weights ${per( "weights" )}, fine ${per( "fine" )}, original ${per( "original" )}, coverage ${per( "coverage" )}, brush ${per( "op" )}, write ${per( "writeBack" )}); upload ${( e.flush ?? 0 ).toFixed( 0 )} ms in all` );
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
