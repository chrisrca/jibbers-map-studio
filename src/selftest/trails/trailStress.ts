import { getEngine } from "../../ui/Viewport";
import { groundCheck, watchErrors, xz } from "../realmap/mountainStress";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { log, realInput, sleep, waitFor } from "../harness";
import { terrain } from "../../terrain/terrain";
import { toThree } from "../../core/coords";
import { useEditor } from "../../map/store";

/**
 * Every height of the ground now, by tile.
**/
const snapshot = () => new Map( terrain.chunks.map( ( c ) => [c.key, { heights: Float32Array.from( c.heights ), y: c.position[1] }] ) );

/**
 * How far the ground has moved since `was`, at most, and where ( tiles grown since: their whole height counted from 0 ).
**/
function moved( was: ReturnType<typeof snapshot> ) {
  let most = 0, at = [0, 0];
  for ( const c of terrain.chunks ) {
    const w = was.get( c.key );
    for ( let k = 0; k < c.heights.length; k++ ) {
      const d = Math.abs( c.heights[k] + c.position[1] - ( w ? w.heights[k] + w.y : 0 ) );
      if ( d > most ) { most = d; at = [c.position[0] + ( k % c.res ) * c.spacing, c.position[2] + Math.floor( k / c.res ) * c.spacing]; }
    }
  }
  return { most, at, grown: terrain.chunks.filter( ( c ) => !was.has( c.key ) ).length };
}

/**
 * Focused run ( STUDIO_SELFTEST=<...>/trailstress ): the Trails tool driven as a person does, the awkward ways too, on
 * a new empty map and on a real mountain: points in a tight cluster, clicks on one spot, U-turns, a long line out
 * past the ground's edge, a line across another, one straight down the fall line. After each: the ground looked over
 * ( spikes, pits, seams, anything that isn't a number ), how far it moved and where ( a "tower" stands far off the
 * points ), the ground under each point; then all of it undone, and the ground back as it was.
**/
export async function trailStressSelftest( dir: string ) {
  const P               = await import( "../../map/project" );
  const { flushTrails } = await import( "../../trails/ground" );
  const fails: string[] = [];
  const fail            = ( what: string ) => { fails.push( what ); log( `  FAIL: ${what}` ); };
  const st              = () => useEditor.getState();
  const errors          = watchErrors();
  // the patterns, in metres about a centre: each a list of lines ( each line's points clicked one after another ), and
  // how far off the view is ( close for points a few metres apart, as a person zooms in to put them down )
  const patterns: [string, [number, number][][], number][] = [
    ["tight cluster",  [[[0, 0], [3, 2], [5, -1], [2, -4], [-2, -3], [-3, 1]]],                   12],
    ["one spot",       [[[20, 20], [20, 20], [20, 20.5]]],                                        12],
    ["U-turns",        [[[-60, 0], [-45, 15], [-60, 30], [-45, 45], [-60, 60], [-45, 75]]],      150],
    ["past the edge",  [[[0, 100], [0, 180], [0, 260], [0, 340], [0, 420], [0, 500], [0, 580]]], 150],
    ["across another", [[[-150, 0], [150, 0]], [[0, -150], [0, 150]]],                           150],
    ["down the slope", [[[200, -300], [200, -150], [200, 0], [200, 150], [200, 300]]],           150],
  ];
  const run = async ( where: string ) => {
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 1500 );
    useEditor.setState( { splash: false } );
    st().setTool( "trail" );
    await sleep( 500 );
    const io = realInput( eng, () => "laying" );
    const w  = io.rc.width, h = io.rc.height;
    // a click on the ground at ( x, z ), the view brought round to it first as a person would, `far` metres off
    const clickAt = async ( x: number, z: number, far: number ) => {
      const g = terrain.heightAt( x, z ), y = Number.isNaN( g ) ? 0 : g, k = far / 150;
      eng.nav.lookAtUnity( [x - 90 * k, y + 120 * k, z - 120 * k], [x, y, z] );
      await sleep( 300 );
      const q = toThree( [x, y, z] ).project( eng.camera );
      await io.click( ( q.x * 0.5 + 0.5 ) * w, ( -q.y * 0.5 + 0.5 ) * h, 250 );
      await sleep( 700 );
    };
    for ( const [name, lines, far] of patterns ) {
      const before = snapshot(), nodes0 = st().trails.nodes.length, clicks = lines.reduce( ( n, l ) => n + l.length, 0 );
      const t0     = performance.now();
      for ( const line of lines ) {
        st().setSelection( [] );
        for ( const [x, z] of line ) await clickAt( x, z, far );
      }
      await sleep( 1000 );
      // ( the ground away from what changed is made a slice per frame: all of it, before it's looked at )
      flushTrails();
      const net  = st().trails;
      const g    = groundCheck();
      const m    = moved( before );
      const off  = net.nodes.map( ( n ) => Math.abs( terrain.heightAt( n.p[0], n.p[2] ) - n.p[1] ) ).filter( ( d ) => !Number.isNaN( d ) );
      const top  = Math.max( ...net.nodes.map( ( n ) => n.p[1] ) ), bottom = Math.min( ...net.nodes.map( ( n ) => n.p[1] ) );
      log( `${where}, ${name}: ${net.nodes.length - nodes0} points, ${net.runs.length} runs in all, ${( ( performance.now() - t0 ) / 1000 ).toFixed( 1 )} s; ground moved up to ${m.most.toFixed( 1 )} m at ${xz( m.at )} ( ${m.grown} tiles grown ), ground ${g.lo.toFixed( 0 )} .. ${g.hi.toFixed( 0 )} m with the points ${bottom.toFixed( 0 )} .. ${top.toFixed( 0 )} m; sharpest spike ${g.spike.toFixed( 1 )} m at ${xz( g.spikeAt )}, seam ${g.seam.toFixed( 2 )} m; ground under the points off by up to ${Math.max( 0, ...off ).toFixed( 2 )} m` );
      if ( net.nodes.length - nodes0 < 1 || net.nodes.length - nodes0 > clicks ) fail( `${where}, ${name}: ${net.nodes.length - nodes0} points from ${clicks} clicks` );
      if ( g.nan ) fail( `${where}, ${name}: ${g.nan} heights aren't numbers` );
      if ( g.spike > 25 ) fail( `${where}, ${name}: a ${g.spike.toFixed( 1 )} m spike or pit at ${xz( g.spikeAt )}` );
      if ( g.seam > 0.05 ) fail( `${where}, ${name}: tiles step ${g.seam.toFixed( 2 )} m at ${xz( g.seamAt )}` );
      if ( m.grown === 0 && m.most > 60 ) fail( `${where}, ${name}: the ground moved ${m.most.toFixed( 1 )} m at ${xz( m.at )} (a tower or a pit)` );
      if ( Math.max( 0, ...off ) > 3 ) fail( `${where}, ${name}: the ground is ${Math.max( ...off ).toFixed( 1 )} m off a point` );
      // all of it undone: the points gone and the ground back
      for ( let k = 0; k < 4 * clicks && st().trails.nodes.length > nodes0; k++ ) {
        history.undo();
        await sleep( 120 );
      }
      flushTrails();
      const back = moved( before );
      log( `  undone: ${st().trails.nodes.length - nodes0} points left, the ground ${back.most.toFixed( 3 )} m off what it was at most ( ${back.grown} tiles grown )` );
      if ( st().trails.nodes.length !== nodes0 ) fail( `${where}, ${name}: undo left ${st().trails.nodes.length - nodes0} points` );
      if ( back.grown === 0 && back.most > 0.01 ) fail( `${where}, ${name}: after undo the ground is ${back.most.toFixed( 2 )} m off at ${xz( back.at )}` );
    }
    io.stop();
    await ipc.writeBinary( joinPath( dir, `${where.replace( /\W+/g, "-" )}.png` ), await eng.pictures.capture() ).catch( () => {} );
  };
  try {
    await P.newEmptyProject( joinPath( dir, `empty-${Date.now()}.jbrproj` ), "Trail stress" );
    await run( "empty map" );
    // a real mountain, 2 x 2 km of Crotched
    const { bestLevels }                  = await import( "../../geo/elevation/sources" );
    const { chunkShapes, importMountain } = await import( "../../geo/importMountain"    );
    const { groundRes }                   = await import( "../../terrain/generate"      );
    const area                            = { center: { lon: -71.8788, lat: 43.0074 }, chunksX: 2, chunksZ: 2 };
    const levels                          = await bestLevels( chunkShapes( area ).map( ( c ) => c.tests ) );
    const lv                              = levels.reduce( ( a, b ) => ( !a || ( b && b.res > a.res ) ? b : a ), null );
    if ( !lv ) throw new Error( "no elevation data for Crotched" );
    const proj = joinPath( dir, `crotched-${Date.now()}.jbrproj` );
    await importMountain( { dir: proj, name: "Crotched", area, level: lv, res: groundRes( 1000 ), trails: false } );
    await P.openProject( proj );
    await run( "real mountain" );
  } catch ( e ) {
    fail( `${e instanceof Error ? e.stack ?? e.message : e}` );
  } finally {
    errors.stop();
    if ( errors.seen.length ) fail( `the app threw ${errors.seen.length} times: ${[...new Set( errors.seen )].slice( 0, 3 ).join( " | " )}` );
  }
  log( fails.length ? `${fails.length} problems:\n${fails.join( "\n" )}` : "every pattern laid, looked over and undone cleanly" );
  log( "SELFTEST OK" );
}
