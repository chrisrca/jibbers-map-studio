// Importing a real area as a new map: heights from the best elevation source every chunk has, laid flat in metres
// around the area's centre, plus OpenStreetMap runs and lifts painted as snow-mask markings.

import { encodePng } from "../core/png";
import { ipc, joinPath } from "../core/ipc";
import type { V3 } from "../core/coords";
import type { ChunkEntry, Project } from "../core/types";
import type { DemLevel, Sampler } from "./elevation/dem";
import { fillSampler } from "./elevation/sources";
import { fetchTrails, TRAIL_HUES, TRAIL_WIDTH, type Trail, type TrailKind } from "./skimap/osm";
import { skiMap } from "./skimap/skimap";
import { LocalProjection, type LonLat } from "./proj";
import { mapIdFrom } from "../map/mapId";
import { spreadHue } from "../paint/ground";
import { buildScenery } from "./scenery/scenery";

export const CHUNK = 1000; // metres per chunk side

// A rectangle of chunks centred on a point, in true ground metres.
export interface ImportArea {
  center:  LonLat;
  chunksX: number;
  chunksZ: number;
  // chunks left out ( "i,j": e.g. ones with poorer elevation data ), so the rest can import at better detail
  skip?:   string[];
}

/**
 * Whether chunk ( i, j ) is part of the import.
**/
export const inImport = ( a: ImportArea, i: number, j: number ) => !a.skip?.includes( `${i},${j}` );

/**
 * Chunk ( i, j )'s south-west corner in local metres ( x east, z north ).
**/
export function chunkOrigin( a: ImportArea, i: number, j: number ): [number, number] {
  return [( -a.chunksX / 2 + i ) * CHUNK, ( -a.chunksZ / 2 + j ) * CHUNK];
}

/**
 * Each chunk's outline ( lon/lat, closed ) and test points for coverage ( a 5x5 grid over it ), in order j-major.
**/
export function chunkShapes( a: ImportArea ) {
  const proj = new LocalProjection( a.center );
  const out: { i: number; j: number; outline: LonLat[]; tests: LonLat[] }[] = [];
  for ( let j = 0; j < a.chunksZ; j++ )
    for ( let i = 0; i < a.chunksX; i++ ) {
      const [x0, z0]        = chunkOrigin( a, i, j );
      const outline         = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]].map( ( [u, v] ) => proj.inverse( x0 + u * CHUNK, z0 + v * CHUNK ) );
      const tests: LonLat[] = [];
      for ( let v = 0; v <= 4; v++ ) for ( let u = 0; u <= 4; u++ ) tests.push( proj.inverse( x0 + ( u / 4 ) * CHUNK, z0 + ( v / 4 ) * CHUNK ) );
      out.push( { i, j, outline, tests } );
    }
  return out;
}

/**
 * lon/lat box ( west, south, east, north ) around the area, with `margin` metres to spare.
**/
export function areaBox( a: ImportArea, margin = 60 ): [number, number, number, number] {
  const proj = new LocalProjection( a.center );
  const hx   = ( a.chunksX * CHUNK ) / 2 + margin, hz = ( a.chunksZ * CHUNK ) / 2 + margin;
  const pts  = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [0, -hz], [0, hz]].map( ( [x, z] ) => proj.inverse( x, z ) );
  return [Math.min( ...pts.map( ( p ) => p.lon ) ), Math.min( ...pts.map( ( p ) => p.lat ) ), Math.max( ...pts.map( ( p ) => p.lon ) ), Math.max( ...pts.map( ( p ) => p.lat ) )];
}

export interface ImportOptions {
  dir:           string;
  name:          string;
  area:          ImportArea;
  level:         DemLevel;
  // heightmap resolution of every chunk
  res:           number;
  trails:        boolean;
  // metres of the land around the area to bring in as scenery ( 0 = none )
  surroundings?: number;
  onProgress?:   ( stage: string, f: number ) => void;
  signal?:       AbortSignal;
}

export interface ImportResult {
  trails:       number;
  filled:       number;
  // why runs and lifts were left out, if they were
  trailsError?: string;
}

const tick = () => new Promise( ( r ) => setTimeout( r, 0 ) );

export async function importMountain( o: ImportOptions ): Promise<ImportResult> {
  const { area, res } = o;
  const proj          = new LocalProjection( area.center );
  const box           = areaBox( area );
  const say           = o.onProgress ?? ( () => {} );

  // heights, with the global source behind it for any holes
  say( `Downloading ${o.level.source.name} ${o.level.label}…`, 0 );
  const sp                     = CHUNK / ( res - 1 );
  // ( no finer than the heightmaps will hold: a big area at 1 m would be gigabytes )
  const main                   = await o.level.source.fetch( o.level.index, box, ( f ) => say( `Downloading ${o.level.source.name} ${o.level.label}…`, f * 0.9 ), o.signal, sp );
  let fallback: Sampler | null = null;
  // holes in the main data ( open sea, a gap in the lidar ): Copernicus, then the terrain tiles
  const fillFrom               = async () => ( fallback ??= await fillSampler( box, Math.max( 30, sp ), o.signal ) );

  say( "Building terrain…", 0 );
  const n                         = res;
  const parts: [number, number][] = [];
  for ( let j = 0; j < area.chunksZ; j++ ) for ( let i = 0; i < area.chunksX; i++ ) if ( inImport( area, i, j ) ) parts.push( [i, j] );
  if ( !parts.length ) throw new Error( "Every chunk is left out" );
  let filled               = 0;
  // where the main data has holes, the global data ( fetched the first time one turns up )
  let fill: Sampler | null = null;
  const height             = ( p: LonLat ) => {
    const v = main( p );
    if ( !Number.isNaN( v ) || !fill ) return v;
    filled++;
    return fill( p );
  };
  const needFill = async ( p: LonLat ) => Number.isNaN( main( p ) ) && !fill && ( fill = await fillFrom() );
  // the lowest point goes at y = 0: found first on a coarse grid ( exact enough: it only moves everything up or
  // down ), so each chunk can then be built, written and let go ( a big area's heights all at once ran out of memory )
  let lo         = Infinity;
  for ( const [i, j] of parts ) {
    const [x0, z0] = chunkOrigin( area, i, j );
    for ( let r = 0; r <= 32; r++ )
      for ( let c = 0; c <= 32; c++ ) {
        const p = proj.inverse( x0 + ( c / 32 ) * CHUNK, z0 + ( r / 32 ) * CHUNK );
        await needFill( p );
        const v = height( p );
        if ( v < lo ) lo = v; // ( a hole with nothing to fill it, NaN, is skipped )
      }
  }
  if ( !Number.isFinite( lo ) ) throw new Error( "No elevation data for this area" );

  // each chunk's vertical range fitted to it with room to sculpt
  const chunks: ChunkEntry[] = [];
  // the highest point ( above y = 0 ): the spawn's place when the area has no runs
  let top                    = { x: 0, y: -Infinity, z: 0 };
  for ( const [done, [i, j]] of parts.entries() ) {
    const [x0, z0] = chunkOrigin( area, i, j );
    const h        = new Float32Array( n * n );
    let cmin       = Infinity, cmax = -Infinity;
    for ( let r = 0; r < n; r++ ) {
      for ( let c = 0; c < n; c++ ) {
        const p = proj.inverse( x0 + c * sp, z0 + r * sp );
        if ( !fill && Number.isNaN( main( p ) ) ) await needFill( p );
        let v = height( p ) - lo;
        if ( Number.isNaN( v ) ) v = 0;
        h[r * n + c] = v;
        if ( v < cmin ) cmin = v;
        if ( v > cmax ) cmax = v;
      }
      if ( ( r & 31 ) === 0 ) {
        say( "Building terrain…", ( done + r / n ) / parts.length );
        await tick();
        if ( o.signal?.aborted ) throw new DOMException( "Cancelled", "AbortError" );
      }
    }
    const base = Math.floor( cmin ) - 20, size = Math.max( 400, Math.ceil( cmax - base + 150 ) );
    // highest point, for the spawn
    for ( let k = 0; k < h.length; k++ )
      if ( h[k] > top.y ) {
        const c = k % n, r = Math.floor( k / n );
        top     = { x: x0 + c * sp, y: h[k], z: z0 + r * sp };
      }
    for ( let k = 0; k < h.length; k++ ) h[k] -= base;
    const key = `c_${i}_${j}`;
    await ipc.writeBinary( joinPath( o.dir, "heights", `${key}.f32` ), new Uint8Array( h.buffer ) );
    chunks.push( { key, position: [x0, base, z0], size: [CHUNK, size, CHUNK], resolution: n, heights: `heights/${key}.f32`, snowMask: null, snowMask4Channel: false } );
  }

  // runs and lifts
  let trailCount = 0;
  let trailsError: string | undefined;
  // the runs and lifts here, from the world's shipped with the studio ( geo/skimap/skimap.ts ): painted on below if asked, and
  // where the spawn goes either way
  const shipped = await skiMap()
    .then( ( ski ) => ski.trails( box ) )
    .catch( () => null );
  if ( o.trails ) {
    say( "Adding runs and lifts…", 0 );
    // ( OpenStreetMap's servers only if the shipped ones are missing. Runs are a bonus: if neither works, the terrain is
    // imported without them )
    const trails = await ( shipped ? Promise.resolve( shipped ) : fetchTrails( box, o.signal ) )
      .catch( ( e ) => {
        if ( o.signal?.aborted ) throw e;
        trailsError = String( ( e as Error ).message ?? e );
        return [];
      } );
    trailCount = trails.length;
    if ( trails.length ) {
      const m = Math.min( 4096, n - 1 ); // mask pixels per chunk side: a pixel per ground sample
      for ( const [k, c] of chunks.entries() ) {
        say( "Painting runs…", k / chunks.length );
        const rgba = paintMarkings( trails, proj, c.position[0], c.position[2], m );
        await ipc.writeBinary( joinPath( o.dir, "masks", `${c.key}.png` ), await encodePng( m, m, rgba ) );
        c.snowMask         = `masks/${c.key}.png`;
        c.snowMask4Channel = true;
        await tick();
      }
    }
  }

  // the land around it, as scenery the rider can't reach ( replaces the game's own background mountains )
  let scenery: unknown = null;
  if ( o.surroundings ) {
    scenery = await buildScenery( {
      dir:        o.dir,
      proj,
      halfX:      ( area.chunksX * CHUNK ) / 2,
      halfZ:      ( area.chunksZ * CHUNK ) / 2,
      radius:     o.surroundings,
      seaLevel:   lo,
      edge:       main,
      onProgress: say,
      signal:     o.signal,
    } );
  }

  // the spawn: at the top of the highest run in the area, facing down it ( where a ski area's runs start, not the
  // summit, which may be off them ); with no runs, the highest point, facing downhill
  const ground = ( x: number, z: number ) => {
    const v = height( proj.inverse( x, z ) ) - lo;
    return Number.isNaN( v ) ? top.y : v;
  };
  const inArea = ( x: number, z: number ) => {
    const i = Math.floor( x / CHUNK + area.chunksX / 2 ), j = Math.floor( z / CHUNK + area.chunksZ / 2 );
    return i >= 0 && j >= 0 && i < area.chunksX && j < area.chunksZ && inImport( area, i, j );
  };
  let start = { x: top.x, z: top.z, y: top.y }, fwd: [number, number] | null = null, spawnName = "Summit";
  for ( const t of shipped ?? [] ) {
    if ( t.kind === "lift" || t.area ) continue;
    const pts = t.points.map( ( p ) => proj.forward( p ) );
    for ( let k = 0; k < pts.length; k++ ) {
      const [x, z] = pts[k];
      if ( !inArea( x, z ) ) continue;
      const y = ground( x, z );
      if ( spawnName !== "Summit" && y <= start.y ) continue;
      // down the run: towards whichever end is lower, from a point ~30 m along it
      const along = ( dir: 1 | -1 ) => {
        let d = 0, q = k;
        while ( q + dir >= 0 && q + dir < pts.length && d < 30 ) { d += Math.hypot( pts[q + dir][0] - pts[q][0], pts[q + dir][1] - pts[q][1] ); q += dir; }
        return q === k ? null : pts[q];
      };
      const ends = [along( 1 ), along( -1 )].filter( ( p ): p is [number, number] => !!p ).sort( ( a, b ) => ground( a[0], a[1] ) - ground( b[0], b[1] ) );
      if ( !ends.length ) continue;
      const len = Math.hypot( ends[0][0] - x, ends[0][1] - z ) || 1;
      start     = { x, z, y };
      fwd       = [( ends[0][0] - x ) / len, ( ends[0][1] - z ) / len];
      spawnName = t.name || "Top";
    }
  }
  if ( !fwd ) {
    // no runs: downhill from the highest point
    const d  = 15;
    const gx = ground( top.x + d, top.z ) - ground( top.x - d, top.z ), gz = ground( top.x, top.z + d ) - ground( top.x, top.z - d );
    const l  = Math.hypot( gx, gz ) || 1;
    fwd      = [-gx / l, -gz / l];
  }
  const yaw                    = ( Math.atan2( fwd[0], fwd[1] ) * 180 ) / Math.PI; // Unity yaw 0 = +Z
  // as working maps have them: ~1.2 m above the ground, a few metres on, tipped forward to the slope, moving down it
  const pos0: [number, number] = [start.x + fwd[0] * 5, start.z + fwd[1] * 5];
  const slope                  = ( ground( pos0[0], pos0[1] ) - ground( pos0[0] + fwd[0] * 15, pos0[1] + fwd[1] * 15 ) ) / 15;
  const pitch                  = Math.max( 0, Math.atan( slope ) );
  const spawnPos: V3           = [pos0[0], ground( pos0[0], pos0[1] ) + 1.2, pos0[1]];
  const spawnRot: V3           = [( pitch * 180 ) / Math.PI, ( yaw + 360 ) % 360, 0];
  const spawnVel: V3           = [fwd[0] * Math.cos( pitch ) * 8, -Math.sin( pitch ) * 8, fwd[1] * Math.cos( pitch ) * 8];

  const project: Project = {
    format:  "jibbers-studio-project",
    version: 1,
    map: {
      // ( its file name in the game, from its name: "Ruka" -> "ruka" )
      id:                       mapIdFrom( o.name ) || crypto.randomUUID(),
      name:                     o.name,
      camStart:                 [start.x - fwd[0] * 40, start.y + 30, start.z - fwd[1] * 40],
      // the game's background mountains sit at fixed places that have nothing to do with a real map
      allowBackgroundMountains: false,
      overrideTime:             false,
      dayTime:                  1,
      dayTimeHours:             -1,
      sunAngle:                 0,
    },
    chunks,
    objects:       [],
    spawns:        [{ uid: "spawn1", name: spawnName, position: spawnPos, rotation: spawnRot, velocity: spawnVel }],
    customObjects: scenery ? [scenery] : [],
    library:       scenery ? "assets/library.jbrmap" : null,
    editor: {
      realTerrain: {
        center:         area.center,
        source:         `${o.level.source.name} ${o.level.label}`,
        attribution:    [o.level.source.attribution, ...( trailCount ? ["Runs and lifts: OpenSkiMap, © OpenStreetMap contributors (ODbL)"] : [] )],
        seaLevelOffset: lo,
      },
    },
  };
  await ipc.saveProject( o.dir, project );
  return { trails: trailCount, filled, trailsError };
}

// Draw order: later kinds win where runs overlap; lifts on top.
const ORDER: TrailKind[] = ["unknown", "easy", "intermediate", "advanced", "freeride", "lift"];

/**
 * Snow mask for one chunk ( m x m pixels, row 0 = the chunk's south edge ): R = snow everywhere, G = marking hue,
 * B = marking coverage ( antialiased ), A = powder ( none ).
**/
export function paintMarkings( trails: Trail[], proj: LocalProjection, x0: number, z0: number, m: number ): Uint8Array {
  const px     = CHUNK / m;
  const hue    = new Float32Array( m * m ), cov = new Float32Array( m * m );
  const sorted = [...trails].sort( ( a, b ) => ORDER.indexOf( a.kind ) - ORDER.indexOf( b.kind ) );
  for ( const t of sorted ) {
    const pts  = t.points.map( ( p ) => proj.forward( p ) ).map( ( [x, z] ) => [( x - x0 ) / px - 0.5, ( z - z0 ) / px - 0.5] ); // pixel units
    const half = TRAIL_WIDTH[t.kind] / 2 / px;
    const xs   = pts.map( ( p ) => p[0] ), zs = pts.map( ( p ) => p[1] );
    if ( Math.max( ...xs ) < -half || Math.min( ...xs ) > m + half || Math.max( ...zs ) < -half || Math.min( ...zs ) > m + half ) continue;
    const put = ( i: number, j: number, c: number ) => {
      const k = j * m + i;
      if ( c <= 0 ) return;
      if ( c >= cov[k] || hue[k] === 0 ) hue[k] = TRAIL_HUES[t.kind];
      cov[k] = Math.max( cov[k], c );
    };
    if ( t.area ) {
      // fill ( even-odd ) the area's pixels
      const i0 = Math.max( 0, Math.floor( Math.min( ...xs ) ) ), i1 = Math.min( m - 1, Math.ceil( Math.max( ...xs ) ) );
      const j0 = Math.max( 0, Math.floor( Math.min( ...zs ) ) ), j1 = Math.min( m - 1, Math.ceil( Math.max( ...zs ) ) );
      for ( let j = j0; j <= j1; j++ )
        for ( let i = i0; i <= i1; i++ ) {
          let inside = false;
          for ( let a = 0, b = pts.length - 1; a < pts.length; b = a++ ) {
            const [xa, za] = pts[a], [xb, zb] = pts[b];
            if ( za > j !== zb > j && i < ( ( xb - xa ) * ( j - za ) ) / ( zb - za ) + xa ) inside = !inside;
          }
          if ( inside ) put( i, j, 0.85 );
        }
      continue;
    }
    // lines: antialiased distance to each segment; glades dashed ( 20 m on, 12 m off along the line )
    let along = 0;
    for ( let s = 0; s + 1 < pts.length; s++ ) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const dx       = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz, len = Math.sqrt( len2 );
      const i0       = Math.max( 0, Math.floor( Math.min( ax, bx ) - half - 1 ) ), i1 = Math.min( m - 1, Math.ceil( Math.max( ax, bx ) + half + 1 ) );
      const j0       = Math.max( 0, Math.floor( Math.min( az, bz ) - half - 1 ) ), j1 = Math.min( m - 1, Math.ceil( Math.max( az, bz ) + half + 1 ) );
      for ( let j = j0; j <= j1; j++ )
        for ( let i = i0; i <= i1; i++ ) {
          const u = len2 > 0 ? Math.max( 0, Math.min( 1, ( ( i - ax ) * dx + ( j - az ) * dz ) / len2 ) ) : 0;
          const d = Math.hypot( i - ( ax + u * dx ), j - ( az + u * dz ) );
          let c   = Math.max( 0, Math.min( 1, half + 0.5 - d ) );
          if ( t.glade && ( ( along + u * len ) * px ) % 32 > 20 ) c = 0;
          put( i, j, c * ( t.kind === "lift" ? 1 : 0.85 ) );
        }
      along += len;
    }
  }
  const out = new Uint8Array( m * m * 4 );
  for ( let k = 0; k < m * m; k++ ) {
    out[k * 4]     = 255;
    out[k * 4 + 1] = cov[k] > 0 ? Math.round( hue[k] * 255 ) : 0;
    out[k * 4 + 2] = Math.round( cov[k] * 255 );
    out[k * 4 + 3] = 0;
  }
  spreadHue( out, m );
  return out;
}
