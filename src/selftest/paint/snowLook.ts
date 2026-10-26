import { LAYOUTS } from "../../terrain/generate";
import type { V3 } from "../../core/coords";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { newProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/snowshots ): the ground as the game draws it: a mountain map with a band of rock and
 * one of powder painted, looked at close ( a rider's eye, a few metres off ) and from further, once the game's snow
 * has been read. Shots of each, and how much detail ( contrast ) the rock shows.
**/
export async function snowLookSelftest( dir: string ) {
  try {
    const P            = await import( "../../paint/ground"                    );
    const { snowLook } = await import( "../../viewport/render/terrainRenderer" );
    const proj         = joinPath( dir, `snow-${Date.now()}.jbrproj` );
    await newProject( proj, "Snow", { layout: LAYOUTS[0], base: "mountain", slopeDeg: 14, heightRange: 1200, seed: 7 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await sleep( 2000 );
    // ( a build from before the game's snow: none to wait for )
    const gs  = ( snowLook as { gameSnow?: { value: number } } ).gameSnow;
    const got = gs ? await waitFor( () => ( gs.value === 1 ? true : null ), "the game's snow", 240000 ).catch( () => false ) : false;
    log( `the game's snow: ${got ? "in" : "not read"}` );
    const stroke = async ( p: Partial<import( "../../paint/ground" ).PaintSettings>, pts: [number, number][], invert = false ) => {
      const s = new P.PaintStroke( { ...useEditor.getState().paint, ...p }, invert );
      for ( const [x, z] of pts ) void s.move( x, z );
      await s.end();
    };
    const line = ( x0: number, z0: number, x1: number, z1: number, n = 40 ) => Array.from( { length: n + 1 }, ( _, k ) => [x0 + ( ( x1 - x0 ) * k ) / n, z0 + ( ( z1 - z0 ) * k ) / n] as [number, number] );
    useEditor.getState().setTool( "paint" );
    await stroke( { tool: "snow",   radius: 8, strength: 1 },              line( -40, 0, 40, 0 ),   true );
    await stroke( { tool: "powder", radius: 8, strength: 1, powder: 0.8 }, line( -40, 40, 40, 40 )       );
    useEditor.getState().setTool( "select" );
    await sleep( 1500 );
    const shot = async ( name: string, from: V3, to: V3 ) => {
      eng.nav.lookAtUnity( from, to );
      await sleep( 1500 );
      const png = await eng.pictures.capture();
      await ipc.writeBinary( joinPath( dir, `${name}.png` ), png );
      const bmp = await createImageBitmap( new Blob( [png as BlobPart], { type: "image/png" } ) );
      const c   = document.createElement( "canvas" );
      c.width   = 320;
      c.height  = 180;
      const gg  = c.getContext( "2d" )!;
      gg.drawImage( bmp, 0, 0, 320, 180 );
      const d = gg.getImageData( 100, 60, 120, 60 ).data;
      let sum = 0, sum2 = 0, n = 0;
      for ( let i = 0; i < d.length; i += 4 ) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        sum    += l;
        sum2   += l * l;
        n++;
      }
      const mean = sum / n, sd = Math.sqrt( Math.max( 0, sum2 / n - mean * mean ) );
      log( `${name}: brightness ${mean.toFixed( 0 )}, contrast ${sd.toFixed( 1 )}; SHOT ${name}.png` );
    };
    const g = ( x: number, z: number ) => terrain.heightAt( x, z );
    // the rock band's edge from a rider's eye, then the rock itself close, then from further off
    await shot( "rock-edge",   [0, g( 0, -12 ) + 1.75, -12], [0, g( 0, 0  ), 0 ] );
    await shot( "rock-close",  [0, g( 0, -4  ) + 2.5,  -4 ], [0, g( 0, 0  ), 0 ] );
    await shot( "rock-far",    [0, g( 0, -60 ) + 20,   -60], [0, g( 0, 0  ), 0 ] );
    await shot( "powder-edge", [0, g( 0, 28  ) + 1.75, 28 ], [0, g( 0, 40 ), 40] );
    await shot( "powder-far",  [0, g( 0, 0   ) + 20,   -20], [0, g( 0, 40 ), 40] );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
