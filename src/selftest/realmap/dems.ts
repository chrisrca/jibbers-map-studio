import { log } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/dems ): for a resort in each country with its own elevation data, the finest
 * level that covers a 1 km chunk there, and that chunk fetched at it: heights, holes, and how long it took.
**/
export async function demsSelftest() {
  try {
    const { bestLevels }                              = await import( "../../geo/elevation/sources" );
    const { chunkShapes, areaBox }                    = await import( "../../geo/importMountain"    );
    const places: [string, number, number, number?][] = [
      ["Crotched (USA)",          -71.879,  43.0077],
      ["Crotched 3 x 3 km (USA)", -71.879,  43.0077, 3],
      ["Stowe (USA)",             -72.7815, 44.5303],
      ["Zermatt (Switzerland)",   7.7491,   46.0207],
      ["St. Anton (Austria)",     10.2683,  47.1293],
      ["Chamonix (France)",       6.8694,   45.9237],
      ["Hemsedal (Norway)",       8.40,     60.86],
      ["Niseko (Japan)",          140.6873, 42.8048],
      ["Mont Tremblant (Canada)", -74.5852, 46.2097],
      ["Whistler (Canada, BC)",   -122.93,  50.08],
      ["Portillo (Chile)",        -70.1305, -32.8352],
    ];
    for ( const [name, lon, lat, size = 1] of places ) {
      const area = { center: { lon, lat }, chunksX: size, chunksZ: size };
      const t0   = performance.now();
      const all  = await bestLevels( chunkShapes( area ).map( ( c ) => c.tests ) );
      const lv   = all.reduce( ( a, b ) => ( !a || !b ? null : b.res > a.res ? b : a ), all[0] );
      if ( all.length > 1 ) log( `  ${name} per chunk: ${all.map( ( l ) => l?.res ?? "none" ).join( ", " )}` );
      const t1 = performance.now();
      if ( !lv ) {
        log( `${name}: no data (${( ( t1 - t0 ) / 1000 ).toFixed( 1 )} s)` );
        continue;
      }
      const box     = areaBox( area );
      const spacing = Math.max( lv.res, 1000 / 256 );
      const s       = await lv.source.fetch( lv.index, box, undefined, undefined, spacing );
      let lo        = Infinity, hi = -Infinity, holes = 0;
      for ( let j = 0; j <= 32; j++ )
        for ( let i = 0; i <= 32; i++ ) {
          const v = s( { lon: box[0] + ( ( box[2] - box[0] ) * i ) / 32, lat: box[1] + ( ( box[3] - box[1] ) * j ) / 32 } );
          if ( Number.isNaN( v ) ) holes++;
          else { lo = Math.min( lo, v ); hi = Math.max( hi, v ); }
        }
      log( `${name}: ${lv.source.name} ${lv.label} (chosen in ${( ( t1 - t0 ) / 1000 ).toFixed( 1 )} s), chunk at ${spacing.toFixed( 1 )} m in ${( ( performance.now() - t1 ) / 1000 ).toFixed( 1 )} s: ${lo.toFixed( 0 )}..${hi.toFixed( 0 )} m, ${holes} of 1089 empty` );
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
