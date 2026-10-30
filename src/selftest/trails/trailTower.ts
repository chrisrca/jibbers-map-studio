import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, realInput, sleep, waitFor } from "../harness";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/trailtower ): a new empty map seen as it opens, the Trails tool, a few points put
 * down close together in front of the camera ( a short winding line, as a person tries it out ): the ground made round
 * them, its highest and lowest, and whether anything stands up far above the points; views left in the folder.
**/
export async function trailTowerSelftest( dir: string ) {
  try {
    const P    = await import( "../../map/project" );
    const proj = joinPath( dir, `tower-${Date.now()}.jbrproj` );
    await P.newEmptyProject( proj, "Tower" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 1000 );
    useEditor.setState( { splash: false } );
    const st = () => useEditor.getState();
    st().setTool( "trail" );
    useEditor.setState( ( s ) => ( { terrainView: { ...s.terrainView, slope: true } } ) );
    await sleep( 500 );
    const io = realInput( eng, () => "laying" );
    const w  = io.rc.width, h = io.rc.height;
    // a short winding line low in the view, the way the screenshot's points lie
    const at = [[0.40, 0.72], [0.45, 0.66], [0.50, 0.63], [0.56, 0.65], [0.60, 0.70], [0.55, 0.76]];
    for ( const [fx, fy] of at ) {
      await io.click( fx * w, fy * h, 300 );
      await sleep( 400 );
    }
    io.stop();
    await sleep( 3000 );
    const net = st().trails;
    const ys  = net.nodes.map( ( n ) => n.p[1] );
    let lo    = Infinity, hi = -Infinity, hiAt = [0, 0];
    for ( const c of terrain.chunks )
      for ( let j = 0; j < c.res; j++ )
        for ( let i = 0; i < c.res; i++ ) {
          const y = c.heights[j * c.res + i] + c.position[1];
          if ( y < lo ) lo = y;
          if ( y > hi ) { hi = y; hiAt = [c.position[0] + i * c.spacing, c.position[2] + j * c.spacing]; }
        }
    log( `points ${net.nodes.length}, runs ${net.runs.length}; points at heights ${ys.map( ( y ) => y.toFixed( 1 ) ).join( ", " )}; points ${net.nodes.map( ( n ) => `(${n.p[0].toFixed( 0 )},${n.p[2].toFixed( 0 )})` ).join( " " )}` );
    log( `ground: ${terrain.chunks.length} tiles, lowest ${lo.toFixed( 1 )} m, highest ${hi.toFixed( 1 )} m at (${hiAt.map( ( v ) => v.toFixed( 0 ) ).join( ", " )})${hi > Math.max( ...ys ) + 30 ? " (FAIL: stands far above the points)" : ""}` );
    await ipc.writeBinary( joinPath( dir, "tower-1-view.png" ), await eng.pictures.capture() );
    eng.nav.frameAll();
    await sleep( 1500 );
    await ipc.writeBinary( joinPath( dir, "tower-2-all.png" ), await eng.pictures.capture() );
    // then a longer line on from the last point, out past the ground's edge ( where more is grown ), seen from above
    const { toThree } = await import( "../../core/coords" );
    const far: [number, number][] = [[60, 40], [140, 90], [210, 170], [300, 200], [380, 290]];
    for ( const [x, z] of far ) {
      eng.nav.lookAtUnity( [x - 120, 160, z - 160], [x, 0, z] );
      await sleep( 400 );
      const g = terrain.heightAt( x, z );
      const q = toThree( [x, Number.isNaN( g ) ? 0 : g, z] ).project( eng.camera );
      await io.click( ( q.x * 0.5 + 0.5 ) * w, ( -q.y * 0.5 + 0.5 ) * h, 300 );
      await sleep( 1200 );
    }
    await sleep( 3000 );
    const net2 = st().trails;
    let lo2    = Infinity, hi2 = -Infinity, at2 = [0, 0];
    for ( const c of terrain.chunks )
      for ( let j = 0; j < c.res; j += 2 )
        for ( let i = 0; i < c.res; i += 2 ) {
          const y = c.heights[j * c.res + i] + c.position[1];
          if ( y < lo2 ) lo2 = y;
          if ( y > hi2 ) { hi2 = y; at2 = [c.position[0] + i * c.spacing, c.position[2] + j * c.spacing]; }
        }
    const top = Math.max( ...net2.nodes.map( ( n ) => n.p[1] ) );
    log( `longer: points ${net2.nodes.length} at heights ${net2.nodes.map( ( n ) => n.p[1].toFixed( 1 ) ).join( ", " )}; ${terrain.chunks.length} tiles ( ${terrain.chunks.map( ( c ) => `${c.key}@${c.position.map( ( v ) => v.toFixed( 0 ) ).join( "," )}` ).join( " " )} ); ground ${lo2.toFixed( 1 )} .. ${hi2.toFixed( 1 )} m, highest at (${at2.map( ( v ) => v.toFixed( 0 ) ).join( ", " )})${hi2 > top + 30 ? " (FAIL: stands far above the points)" : ""}` );
    eng.nav.frameAll();
    await sleep( 1500 );
    await ipc.writeBinary( joinPath( dir, "tower-3-longer.png" ), await eng.pictures.capture() );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
