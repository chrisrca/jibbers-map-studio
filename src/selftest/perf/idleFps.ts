import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { ipc } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/idlefps ): a project in the folder ( a copy ) opened and framed whole, then left
 * alone: how evenly frames come, what drawing each costs ( the page's side ), and whether what's drawn changes while
 * nothing moves.
**/
export async function idleFpsSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    eng.nav.frameAll();
    await sleep( 6000 );
    const render: number[] = [], frameCost: number[] = [], draws: number[] = [], tris: number[] = [], tiles: number[] = [];
    const o                = eng.renderer as unknown as Record<string, ( ...a: unknown[] ) => unknown>;
    const f                = o.render.bind( eng.renderer );
    o.render               = ( ...a: unknown[] ) => {
      const t0 = performance.now();
      try {
        return f( ...a );
      } finally {
        render.push( performance.now() - t0 );
        const info = ( eng.renderer as unknown as { info: { render: { drawCalls: number; triangles: number } } } ).info.render;
        draws.push( info.drawCalls );
        tris.push( info.triangles );
        tiles.push( eng.terrainR.stats.visible );
      }
    };
    const E  = eng as unknown as Record<string, () => void>;
    const fr = E.frame.bind( eng );
    E.frame  = () => {
      const t0 = performance.now();
      fr();
      frameCost.push( performance.now() - t0 );
    };
    const t0 = performance.now();
    await sleep( 8000 );
    o.render   = f;
    E.frame    = fr;
    const s0   = eng.frameStamps.filter( ( t ) => t >= t0 );
    const gaps = s0.slice( 1 ).map( ( v, i ) => v - s0[i] );
    const q    = ( a: number[], p: number ) => ( a.length ? [...a].sort( ( x, y ) => x - y )[Math.min( a.length - 1, Math.floor( a.length * p ) )] : NaN );
    const span = ( a: number[] ) => `${q( a, 0.05 ).toFixed( 1 )}/${q( a, 0.5 ).toFixed( 1 )}/${q( a, 0.95 ).toFixed( 1 )}/${Math.max( ...a ).toFixed( 1 )}`;
    const uniq = ( a: number[] ) => [...new Set( a )].slice( 0, 8 ).join( "," );
    log( `idle 8 s: ${gaps.length} frames; gaps ms p5/p50/p95/max ${span( gaps )}; fps ${( 1000 / q( gaps, 0.5 ) ).toFixed( 0 )}; gaps over 20 ms ${gaps.filter( ( g ) => g > 20 ).length}` );
    log( `frame() ms ${span( frameCost )}; render() ms ${span( render )}` );
    log( `draw calls ${uniq( draws )}; triangles ${uniq( tris )}; terrain tiles drawn ${uniq( tiles )}` );
    // what the draws are: meshes by top-level group, and how many cast shadows
    const groups: string[] = [];
    for ( const g of eng.scene.children ) {
      let meshes = 0, casters = 0, instanced = 0;
      g.traverseVisible( ( x ) => {
        const m = x as THREE.Mesh;
        if ( !m.isMesh ) return;
        const n = Array.isArray( m.material ) ? m.material.length : 1;
        meshes += n;
        if ( m.castShadow ) casters += n;
        if ( ( m as unknown as THREE.InstancedMesh ).isInstancedMesh ) instanced++;
      } );
      if ( meshes ) groups.push( `${g.name || g.type}: ${meshes} (${casters} cast shadows, ${instanced} instanced)` );
    }
    const sm = eng.renderer.shadowMap;
    log( `groups: ${groups.join( "; " )}; shadows ${sm.enabled}` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
