import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * The ground as it is now, looked over: samples that aren't numbers, its lowest and highest, the sharpest spike or pit
 * ( a sample's height against the mean of its four neighbours: a slope, however steep, comes out near 0 ), and the
 * biggest step where two tiles meet ( their shared edge should be one line ).
**/
export function groundCheck() {
  let nan     = 0, lo = Infinity, hi = -Infinity, spike = 0, spikeAt = [0, 0], seam = 0, seamAt = [0, 0];
  const byKey = new Map( terrain.chunks.map( ( c ) => [`${c.position[0].toFixed( 1 )},${c.position[2].toFixed( 1 )}`, c] ) );
  for ( const c of terrain.chunks ) {
    const n = c.res, at = ( i: number, j: number ) => c.heights[j * n + i] + c.position[1];
    for ( let j = 0; j < n; j++ )
      for ( let i = 0; i < n; i++ ) {
        const y = at( i, j );
        if ( !Number.isFinite( y ) ) { nan++; continue; }
        if ( y < lo ) lo = y;
        if ( y > hi ) hi = y;
        if ( i === 0 || j === 0 || i === n - 1 || j === n - 1 ) continue;
        const d = Math.abs( y - ( at( i - 1, j ) + at( i + 1, j ) + at( i, j - 1 ) + at( i, j + 1 ) ) / 4 );
        if ( d > spike ) { spike = d; spikeAt = [c.position[0] + i * c.spacing, c.position[2] + j * c.spacing]; }
      }
    // ( the tile to the east and the one to the north: their first column / row is this one's last )
    const size = ( n - 1 ) * c.spacing;
    const east = byKey.get( `${( c.position[0] + size ).toFixed( 1 )},${c.position[2].toFixed( 1 )}` );
    const nrth = byKey.get( `${c.position[0].toFixed( 1 )},${( c.position[2] + size ).toFixed( 1 )}` );
    for ( let k = 0; k < n; k++ ) {
      if ( east && east.res === n ) {
        const d = Math.abs( at( n - 1, k ) - ( east.heights[k * n] + east.position[1] ) );
        if ( d > seam ) { seam = d; seamAt = [c.position[0] + size, c.position[2] + k * c.spacing]; }
      }
      if ( nrth && nrth.res === n ) {
        const d = Math.abs( at( k, n - 1 ) - ( nrth.heights[k] + nrth.position[1] ) );
        if ( d > seam ) { seam = d; seamAt = [c.position[0] + k * c.spacing, c.position[2] + size]; }
      }
    }
  }
  return { nan, lo, hi, spike, spikeAt, seam, seamAt };
}

export const xz = ( p: number[] ) => `(${p.map( ( v ) => v.toFixed( 0 ) ).join( ", " )})`;

/**
 * Errors the app threw meanwhile ( uncaught, or a promise nobody caught ), counted from `watchErrors` on.
**/
export function watchErrors() {
  const seen: string[] = [];
  const onError        = ( e: ErrorEvent ) => seen.push( String( e.message ) );
  const onReject       = ( e: PromiseRejectionEvent ) => seen.push( String( e.reason?.message ?? e.reason ) );
  window.addEventListener( "error",              onError  );
  window.addEventListener( "unhandledrejection", onReject );
  return {
    seen,
    stop: () => {
      window.removeEventListener( "error",              onError  );
      window.removeEventListener( "unhandledrejection", onReject );
    },
  };
}

/**
 * Focused run ( STUDIO_SELFTEST=<...>/mtnstress ): real mountains of every kind imported one after another, as the
 * Real Mountain dialog does it ( the best elevation data there, runs and lifts, the land round them ): big and small
 * areas, long thin ones, the Alps' cliffs, flat prairie, a coast with sea in it, the far north, the southern
 * hemisphere, the equator. Each opened and looked over ( the ground, where the spawn is, the scenery ) and exported;
 * anything odd said with FAIL, and the run going on to the next.
**/
export async function mountainStressSelftest( dir: string ) {
  const { bestLevels }                  = await import( "../../geo/elevation/sources" );
  const { chunkShapes, importMountain } = await import( "../../geo/importMountain"    );
  const { groundRes }                   = await import( "../../terrain/generate"      );
  // name, longitude, latitude, chunks across ( east-west ) and along ( north-south ), metres of land round it
  const places: [string, number, number, number, number, number][] = [
    ["Crotched (USA)",           -71.8788, 43.0074,  2, 2, 8000],
    ["Zermatt (Switzerland)",    7.7491,   46.0207,  2, 2, 4000],
    ["Whistler (Canada)",        -122.93,  50.08,    3, 1, 0   ],
    ["Niseko (Japan)",           140.6873, 42.8048,  1, 1, 2000],
    ["Portillo (Chile)",         -70.1305, -32.8352, 1, 2, 0   ],
    ["Hemsedal (Norway)",        8.40,     60.86,    1, 1, 0   ],
    ["Kansas prairie (USA)",     -98.5,    38.5,     1, 1, 0   ],
    ["Cadillac Mtn coast (USA)", -68.2253, 44.3526,  2, 1, 2000],
    ["Longyearbyen (Svalbard)",  15.63,    78.22,    1, 1, 0   ],
    ["Kilimanjaro (Tanzania)",   37.3556,  -3.0674,  1, 1, 0   ],
  ];
  const fails: string[] = [];
  const fail            = ( what: string ) => { fails.push( what ); log( `  FAIL: ${what}` ); };
  for ( const [name, lon, lat, cx, cz, around] of places ) {
    const errors = watchErrors();
    try {
      const area   = { center: { lon, lat }, chunksX: cx, chunksZ: cz };
      const levels = await bestLevels( chunkShapes( area ).map( ( c ) => c.tests ) );
      const lv     = levels.reduce( ( a, b ) => ( !a || ( b && b.res > a.res ) ? b : a ), null );
      if ( !lv ) {
        log( `${name}: no elevation data anywhere there` );
        continue;
      }
      const proj = joinPath( dir, `${name.replace( /[^a-z]+/gi, "-" ).replace( /^-|-$/g, "" ).toLowerCase()}.jbrproj` );
      const t0   = performance.now();
      const r    = await importMountain( { dir: proj, name, area, level: lv, res: groundRes( 1000 ), trails: true, surroundings: around } );
      const t1   = performance.now();
      await openProject( proj );
      const eng = await waitFor( () => getEngine(), "engine", 60000 );
      await eng.ready;
      await sleep( 2500 );
      const g     = groundCheck();
      const st    = useEditor.getState();
      const spawn = st.spawns[0]?.position;
      const under = spawn ? terrain.heightAt( spawn[0], spawn[2] ) : NaN;
      log( `${name}: ${lv.source.name} ${lv.label}, imported in ${( ( t1 - t0 ) / 1000 ).toFixed( 1 )} s; ${terrain.chunks.length} tiles, ground ${g.lo.toFixed( 0 )} .. ${g.hi.toFixed( 0 )} m, sharpest spike ${g.spike.toFixed( 1 )} m at ${xz( g.spikeAt )}, biggest seam ${g.seam.toFixed( 2 )} m at ${xz( g.seamAt )}; runs and lifts ${r.trails}${r.trailsError ? ` (${r.trailsError})` : ""}, holes filled ${r.filled}; spawn ${spawn ? `${( spawn[1] - under ).toFixed( 1 )} m above the ground` : "none"}; scenery ${st.customObjects.length}` );
      if ( terrain.chunks.length !== cx * cz ) fail( `${name}: ${terrain.chunks.length} tiles for ${cx} x ${cz}` );
      if ( g.nan ) fail( `${name}: ${g.nan} heights aren't numbers` );
      if ( g.spike > 25 ) fail( `${name}: a ${g.spike.toFixed( 1 )} m spike or pit at ${xz( g.spikeAt )}` );
      if ( g.seam > 0.05 ) fail( `${name}: tiles step ${g.seam.toFixed( 2 )} m where they meet at ${xz( g.seamAt )}` );
      if ( !spawn ) fail( `${name}: no spawn` );
      else if ( !( spawn[1] - under > -0.5 && spawn[1] - under < 10 ) ) fail( `${name}: the spawn is ${( spawn[1] - under ).toFixed( 1 )} m off the ground` );
      const t2 = performance.now();
      // ( into the test's folder, not the game's maps )
      const ex = await ipc.exportProject( proj, joinPath( dir, `${area.center.lon},${area.center.lat}.jbrmap` ) ).catch( ( e ) => fail( `${name}: export failed: ${e}` ) );
      if ( ex ) log( `  exported in ${( ( performance.now() - t2 ) / 1000 ).toFixed( 1 )} s` );
    } catch ( e ) {
      fail( `${name}: ${e instanceof Error ? e.stack ?? e.message : e}` );
    } finally {
      errors.stop();
      if ( errors.seen.length ) fail( `${name}: the app threw ${errors.seen.length} times: ${[...new Set( errors.seen )].slice( 0, 3 ).join( " | " )}` );
    }
  }
  log( fails.length ? `${fails.length} problems:\n${fails.join( "\n" )}` : "every mountain imported, opened and exported cleanly" );
  log( "SELFTEST OK" );
}
