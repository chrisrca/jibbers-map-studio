import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/spawn ): Crotched's ski area imported small and quick ( coarse, no surroundings ):
 * where the spawn goes — the top of its highest run, facing down it — against the area's highest point.
**/
export async function spawnSelftest( dir: string ) {
  try {
    const { skiAreas   }                         = await import( "../../geo/skimap/skiareas"   );
    const { bestLevels }                         = await import( "../../geo/elevation/sources" );
    const { chunkShapes, importMountain, CHUNK } = await import( "../../geo/importMountain"    );
    const { LocalProjection }                    = await import( "../../geo/proj"              );
    const a                                      = ( await skiAreas() ).find( ( x ) => /Crotched/.test( x.name ) )!;
    const [w, s, e, n]                           = a.box, center = { lon: ( w + e ) / 2, lat: ( s + n ) / 2 };
    const proj                                   = new LocalProjection( center );
    const [x0, z0]                               = proj.forward( { lon: w, lat: s } ), [x1, z1] = proj.forward( { lon: e, lat: n } );
    const area                                   = { center, chunksX: Math.ceil( ( x1 - x0 + 400 ) / CHUNK ), chunksZ: Math.ceil( ( z1 - z0 + 400 ) / CHUNK ) };
    const levels                                 = await bestLevels( chunkShapes( area ).map( ( c ) => c.tests ) );
    const level                                  = levels.reduce( ( p, q ) => ( q!.res > p!.res ? q : p ) )!;
    const out                                    = joinPath( dir, `spawn-${Date.now()}.jbrproj` );
    await importMountain( { dir: out, name: "Spawn test", area, level, res: 257, trails: true, surroundings: 0 } );
    const proj2 = JSON.parse( await ipc.readText( joinPath( out, "project.json" ) ) );
    const sp    = proj2.spawns[0];
    log( `${a.name}: ${area.chunksX} x ${area.chunksZ} km at ${level.source.name} ${level.label}; spawn "${sp.name}" at ${sp.position.map( ( v: number ) => v.toFixed( 0 ) )}, facing ${sp.rotation[1].toFixed( 0 )}°, tipped ${sp.rotation[0].toFixed( 0 )}°, moving ${Math.hypot( ...( sp.velocity as number[] ) ).toFixed( 1 )} m/s` );
    await openProject( out );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    let hi = -Infinity, at = [0, 0];
    for ( let z = -area.chunksZ * 500; z <= area.chunksZ * 500; z += 10 )
      for ( let x = -area.chunksX * 500; x <= area.chunksX * 500; x += 10 ) {
        const h = terrain.heightAt( x, z );
        if ( h > hi ) { hi = h; at = [x, z]; }
      }
    log( `the area's highest point: ${hi.toFixed( 0 )} m at ${at.join( ", " )}; the spawn's ground ${terrain.heightAt( sp.position[0], sp.position[2] ).toFixed( 0 )} m` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
