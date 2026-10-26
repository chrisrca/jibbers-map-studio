import type { BrushId, BrushSettings } from "../../sculpt/brushes";
import { BrushStroke } from "../../sculpt/stroke/stroke";
import { LAYOUTS } from "../../terrain/generate";
import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { newProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { toThree } from "../../core/coords";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/brush ): each brush used on a generated mountain, with screenshots.
**/
export async function brushSelftest( dir: string ) {
  try {
    const proj = joinPath( dir, `brush-${Date.now()}.jbrproj` );
    await newProject( proj, "Brush", { layout: LAYOUTS[1], base: "mountain", slopeDeg: 18, heightRange: 1200, seed: 3 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await sleep( 2500 );
    const g    = ( x: number, z: number ) => terrain.heightAt( x, z );
    const shot = async ( name: string ) => {
      await sleep( 700 );
      const png = await eng.pictures.capture();
      await ipc.writeBinary( joinPath( dir, `${name}.png` ), png );
      log( `screenshot ${name}.png` );
    };
    const with_ = ( brush: BrushId, radius: number, p: Partial<BrushSettings> = {} ) => {
      const sc          = structuredClone( useEditor.getState().sculpt );
      sc.brush          = brush;
      sc.radius         = radius;
      sc.brushes[brush] = { ...sc.brushes[brush], ...p };
      return sc;
    };
    const stroke = ( brush: BrushId, radius: number, path: [number, number][], p: Partial<BrushSettings> = {}, opts = {}, repeat = 1 ) => {
      const t0 = performance.now();
      for ( let r = 0; r < repeat; r++ ) {
        const s = new BrushStroke( terrain, with_( brush, radius, p ), path[0], opts );
        for ( const [x, z] of path ) s.move( { x, z } );
        s.end();
      }
      terrain.flush();
      log( `${brush}: ${( performance.now() - t0 ).toFixed( 0 )} ms` );
    };
    const line = ( x0: number, z0: number, x1: number, z1: number, n = 30 ): [number, number][] =>
      Array.from( { length: n + 1 }, ( _, k ) => [x0 + ( ( x1 - x0 ) * k ) / n, z0 + ( ( z1 - z0 ) * k ) / n] );
    const look = async ( name: string, x: number, z: number, dist = 70 ) => {
      eng.nav.lookAtUnity( [x - dist * 0.55, g( x, z ) + dist * 0.6, z - dist * 0.75], [x, g( x, z ), z] );
      await shot( name );
    };
    // a row of test spots across the centre chunk's run
    stroke( "crease", 6,  line( -60, -200, -60, -140 ), { strength: 0.8 },                                   {}, 3 );
    stroke( "layer",  8,  line( -20, -200, -20, -150 ), { layerHeight: 2.5, strength: 1 }                          );
    stroke( "clay",   6,  line( 20,  -200, 20,  -150 ), { roundness: 0, strength: 0.6 },                     {}, 3 );
    stroke( "pinch",  12, [[60,  -175]],                { strength: 1 }                                            );
    stroke( "draw",   14, [[100, -175]],                { alpha: "crater", stroke: "dragdot", strength: 1 }, {}, 4 );
    await look( "b1-crease-layer-clay", -20, -175, 110 );
    await look( "b2-pinch-crater",      80,  -175, 80  );
    stroke( "terrace", 30, [[-80, 120]],            { terraceStep: 3, strength: 1 },                        {}, 6 );
    stroke( "noise",   25, line( 0, 100, 60, 130 ), { noiseType: "ridged", noiseHeight: 4, strength: 0.8 }, {}, 3 );
    await look( "b3-terrace-noise", -20, 115, 140 );
    // mask + symmetry rings
    stroke( "mask", 15, line( -60, 0, 60, 0 ), { strength: 1 } );
    useEditor.getState().setTool( "sculpt" );
    useEditor.getState().setSculpt( { brush: "draw", radius: 18, symmetry: { x: true, z: false, radial: 1, pivot: [0, 30] } } );
    const e       = eng as unknown as { mouseInside: boolean; cursorWorld: THREE.Vector3 | null };
    e.mouseInside = true;
    e.cursorWorld = toThree( [40, g( 40, 40 ), 40] );
    eng.nav.lookAtUnity( [0, g( 0, -60 ) + 90, -60], [0, g( 0, 20 ), 20] );
    await shot( "b5-mask-symmetry" );
    useEditor.getState().setSculpt( { symmetry: { x: false, z: false, radial: 1, pivot: null }, brush: "flatten" } );
    log( "UI READY" );
    await sleep( 12000 );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
