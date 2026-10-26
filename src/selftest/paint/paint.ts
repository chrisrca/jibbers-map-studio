import { LAYOUTS } from "../../terrain/generate";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { newProject, openProject, saveProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/paint ): every paint tool and fill on a new map, saved and read back.
**/
export async function paintSelftest( dir: string ) {
  try {
    const P    = await import( "../../paint/ground" );
    const proj = joinPath( dir, `paint-${Date.now()}.jbrproj` );
    await newProject( proj, "Paint", { layout: LAYOUTS[0], base: "mountain", slopeDeg: 14, heightRange: 1200, seed: 7 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await sleep( 2000 );
    const g    = ( x: number, z: number ) => terrain.heightAt( x, z );
    const shot = async ( name: string ) => {
      await sleep( 900 );
      await ipc.writeBinary( joinPath( dir, `${name}.png` ), await eng.pictures.capture() );
      log( `screenshot ${name}.png` );
    };
    const st = useEditor.getState();
    st.setTool( "paint" );
    const stroke = async ( p: Partial<import( "../../paint/ground" ).PaintSettings>, pts: [number, number][], invert = false ) => {
      const s  = new P.PaintStroke( { ...useEditor.getState().paint, ...p }, invert );
      const t0 = performance.now();
      for ( const [x, z] of pts ) void s.move( x, z );
      const ok = await s.end();
      log( `stroke ${p.tool}${invert ? " (inverted)" : ""}: ${pts.length} points, ${( performance.now() - t0 ).toFixed( 0 )} ms, undo step ${ok}` );
    };
    const line = ( x0: number, z0: number, x1: number, z1: number, n = 40 ) => Array.from( { length: n + 1 }, ( _, k ) => [x0 + ( ( x1 - x0 ) * k ) / n, z0 + ( ( z1 - z0 ) * k ) / n] as [number, number] );
    const key  = terrain.chunks[0].key;
    await stroke( { tool: "snow", radius: 8, strength: 1 }, line( -40, 0, 40, 0 ), true );
    const L  = P.layerOf( key )!;
    const at = ( x: number, z: number ) => {
      const c = terrain.chunks[0], m = L.m, i = Math.floor( ( ( x - c.position[0] ) / c.size[0] ) * m ), j = Math.floor( ( ( z - c.position[2] ) / c.size[2] ) * m );
      const o = ( j * m + i ) * 4;
      return [L.rgba[o], L.rgba[o + 1], L.rgba[o + 2], L.rgba[o + 3], L.flow?.[j * m + i] ?? -1];
    };
    log( `layer ${key}: ${L.m}px, rock stroke centre = ${at( 0, 0 ).join( "," )}` );
    await stroke( { tool: "powder", radius: 15, strength: 1, powder: 0.8 }, line( -30, 70, 30, 70 ) );
    log( `powder centre = ${at( 0, 70 ).join( "," )}` );
    // a marking line ( Blue: hue 0.6 ), 0.6 m wide
    await stroke( { tool: "marking", radius: 0.3, strength: 1, colour: 11 }, line( -30, 40, 30, 40 ) );
    log( `marking centre = ${at( 0, 40 ).join( "," )} (want G ${Math.round( 0.6 * 255 )}, B high); 1 m off it = ${at( 0, 41 ).join( "," )}` );
    await stroke( { tool: "flow", radius: 10, strength: 1 }, line( -40, 110, 40, 110 ) );
    log( `flow centre = ${at( 0, 110 ).join( "," )} (expect ${P.encodeAngle( 1, 0 )} for +X)` );
    history.undo();
    log( `after undo flow = ${at( 0, 110 )[4]}` );
    history.redo();
    eng.nav.lookAtUnity( [0, g( 0, -60 ) + 45, -60], [0, g( 0, 60 ), 60] );
    await shot( "p1-strokes" );
    useEditor.getState().setPaint( { tool: "flow" } );
    await shot( "p2-flow-view" );
    useEditor.getState().setPaint( { tool: "snow" } );

    for ( const [name, f] of [["rockOnSteep", () => P.rockOnSteep( 30 )]] as const ) {
      const t0 = performance.now();
      await f();
      log( `${name}: ${( performance.now() - t0 ).toFixed( 0 )} ms` );
    }
    let rock = 0;
    for ( let k = 0; k < L.m * L.m; k++ ) if ( L.rgba[k * 4] < 128 ) rock++;
    log( `rock pixels: ${( ( rock / ( L.m * L.m ) ) * 100 ).toFixed( 1 )}%` );
    eng.nav.lookAtUnity( [0, g( 0, -400 ) + 160, -400], [0, g( 0, 0 ), 0] );
    await shot( "p3-fills" );

    await saveProject();
    const ex = useEditor.getState().chunkExtras[key] as { snowMask4Channel?: boolean; snowMask2?: string };
    log( `saved: snowMask=${terrain.chunks[0].snowMask} 4ch=${ex?.snowMask4Channel} flow=${ex?.snowMask2}` );
    const before = at( 0, 30 );
    await openProject( proj );
    await sleep( 1500 );
    const L2 = await P.ensureLayer( terrain.chunks[0] );
    const c  = terrain.chunks[0], m = L2.m, i = Math.floor( ( ( 0 - c.position[0] ) / c.size[0] ) * m ), j = Math.floor( ( ( 30 - c.position[2] ) / c.size[2] ) * m );
    log( `reopened marking = ${[...L2.rgba.subarray( ( j * m + i ) * 4, ( j * m + i ) * 4 + 4 )].join( "," )} (was ${before.slice( 0, 4 ).join( "," )}), flow ${L2.flow ? "loaded" : "missing"}` );
    const r = await ipc.exportProject( proj, joinPath( dir, "paint.jbrmap" ) );
    log( `export: ${JSON.stringify( r )}` );
    eng.nav.lookAtUnity( [0, g( 0, -60 ) + 45, -60], [0, g( 0, 60 ), 60] );
    await shot( "p4-reopened" );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
