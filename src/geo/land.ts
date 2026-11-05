// The land around a map, wherever it isn't ground yet: on a map made from a real mountain, the real land ( its
// elevation, the same data its chunks came from ); on a made-up one, mountains made up to match it, rising from its
// own ground level away from it ( seeded, so it's the same land every time ). Map Size shows it and turns any of it
// into ground, at full detail; the surroundings ( geo/scenery ) are made of it.

import { meta, realTerrainOf, type MadeLandData } from "../map/project/state";
import { useEditor } from "../map/store";
import { terrain } from "../terrain/terrain";
import type { Sampler } from "./elevation/dem";
import { bestLevels, fillSampler } from "./elevation/sources";
import { LocalProjection, type LonLat } from "./proj";

// Heights ( the map's y ) at a point of it ( x east, z north, metres ); NaN where there are none.
export type Heights = ( x: number, z: number ) => number;

// A box of the map: west, south, east, north ( metres ).
export type MapBox = [number, number, number, number];

// How a new chunk of made-up land comes out ( Map Size's settings for it ): its hills and bumps scaled, and another
// variation of it ( a different seed ). The real land is as it is.
export interface MadeOptions {
  hills:     number;
  bumps:     number;
  variation: number;
}

export interface Land {
  // "real": the earth's; "made": made up to match the map
  kind:   "real" | "made";
  // where its heights come from, for the user ( "Copernicus GLO-30", "made to match" )
  source: string;
  // coarse heights over `box`, `step` metres apart at least ( for a preview, the surroundings )
  coarse( box: MapBox, step: number, signal?: AbortSignal, made?: MadeOptions ): Promise<Heights>;
  // the most detail there is over `box` ( a new chunk's ground ), and what it is
  fine( box: MapBox, spacing: number, onProgress?: ( f: number ) => void, signal?: AbortSignal, made?: MadeOptions ): Promise<{ heights: Heights; source: string }>;
  // what the most detail over `box` would be, without fetching it
  best( box: MapBox, signal?: AbortSignal ): Promise<string>;
  // something's been made of it ( ground, the surroundings ): kept with the map, the same land from now on
  keep(): void;
}

/**
 * The land around the open map ( none without ground to go by ).
**/
export function landOf(): Land | null {
  const real = realTerrainOf();
  if ( real ) return realLand( new LocalProjection( real.center ), real.seaLevelOffset );
  if ( !terrain.chunks.length ) return null;
  return madeLand( meta.madeLand ?? madeFor() );
}

// ---------------------------------------------------------------- the real land

/**
 * A lon/lat box round a box of the map, a little to spare.
**/
function lonLatBox( proj: LocalProjection, b: MapBox, margin = 60 ): [number, number, number, number] {
  const pts = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [( b[0] + b[2] ) / 2, b[1]], [( b[0] + b[2] ) / 2, b[3]]]
    .map( ( [x, z] ) => [proj.inverse( x - margin, z - margin ), proj.inverse( x + margin, z + margin )] ).flat();
  return [Math.min( ...pts.map( ( p ) => p.lon ) ), Math.min( ...pts.map( ( p ) => p.lat ) ), Math.max( ...pts.map( ( p ) => p.lon ) ), Math.max( ...pts.map( ( p ) => p.lat ) )];
}

export function realLand( proj: LocalProjection, sea: number ): Land {
  const onMap   = ( s: Sampler ): Heights => ( x, z ) => s( proj.inverse( x, z ) ) - sea;
  // ( a 5 x 5 grid of points over a box: what the data's coverage is asked about )
  const testsOf = ( box: MapBox ) => {
    const tests: LonLat[] = [];
    for ( let v = 0; v <= 4; v++ ) for ( let u = 0; u <= 4; u++ ) tests.push( proj.inverse( box[0] + ( u / 4 ) * ( box[2] - box[0] ), box[1] + ( v / 4 ) * ( box[3] - box[1] ) ) );
    return tests;
  };
  return {
    kind:   "real",
    source: "real elevation",
    keep:   () => {},
    async coarse( box, step, signal ) {
      return onMap( await fillSampler( lonLatBox( proj, box ), Math.max( 30, step ), signal ) );
    },
    async best( box, signal ) {
      const [level] = await bestLevels( [testsOf( box )], signal );
      return level ? `${level.source.name} ${level.label}` : "Copernicus GLO-30";
    },
    async fine( box, spacing, onProgress, signal ) {
      // the best data that covers all of it ( as the import picks it ), the global data behind it for any holes
      const [level] = await bestLevels( [testsOf( box )], signal );
      const ll      = lonLatBox( proj, box );
      const fill    = await fillSampler( ll, Math.max( 30, spacing ), signal );
      if ( !level ) return { heights: onMap( fill ), source: "Copernicus GLO-30" };
      const main = await level.source.fetch( level.index, ll, onProgress, signal, spacing );
      return { heights: onMap( ( p ) => { const v = main( p ); return Number.isNaN( v ) ? fill( p ) : v; } ), source: `${level.source.name} ${level.label}` };
    },
  };
}

// ---------------------------------------------------------------- made-up land

/**
 * A made-up map's land, the first time: the ground level its edge is at, and where it is now.
**/
function madeFor(): MadeLandData {
  const b = terrain.bounds();
  // ( its edge's height, round it )
  const edge: number[] = [];
  for ( let k = 0; k < 64; k++ ) {
    const t = k / 64;
    for ( const [x, z] of [[b.x0 + ( b.x1 - b.x0 ) * t, b.z0], [b.x0 + ( b.x1 - b.x0 ) * t, b.z1], [b.x0, b.z0 + ( b.z1 - b.z0 ) * t], [b.x1, b.z0 + ( b.z1 - b.z0 ) * t]] ) {
      const h = terrain.heightAt( Math.min( b.x1 - 0.01, x ), Math.min( b.z1 - 0.01, z ) );
      if ( !Number.isNaN( h ) ) edge.push( h );
    }
  }
  edge.sort( ( a, c ) => a - c );
  // ( seeded by the map's id: looked at again before anything's kept, it's the same land )
  let seed = 7;
  for ( const ch of useEditor.getState().map?.id ?? "" ) seed = ( Math.imul( seed, 31 ) + ch.charCodeAt( 0 ) ) | 0;
  return { seed: seed & 0x3fffffff, level: edge.length ? edge[edge.length >> 1] : 0, x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 };
}

/**
 * Smooth value noise in [-1, 1] ( a hashed lattice, smoothstep-blended ), seeded.
**/
function noise( seed: number, x: number, z: number ) {
  const hash = ( i: number, j: number ) => {
    let h = ( i * 374761393 + j * 668265263 + seed * 1442695041 ) | 0;
    h     = Math.imul( h ^ ( h >>> 13 ), 1274126177 );
    return ( ( h ^ ( h >>> 16 ) ) >>> 0 ) / 4294967295;
  };
  const i = Math.floor( x ), j = Math.floor( z ), fx = x - i, fz = z - j;
  const u = fx * fx * ( 3 - 2 * fx ), v = fz * fz * ( 3 - 2 * fz );
  const a = hash( i, j ), b = hash( i + 1, j ), c = hash( i, j + 1 ), d = hash( i + 1, j + 1 );
  return ( ( a * ( 1 - u ) + b * u ) * ( 1 - v ) + ( c * ( 1 - u ) + d * u ) * v ) * 2 - 1;
}

/**
 * Ridged fractal noise in [0, 1]: sharp crests, wide valleys ( mountains ).
**/
function ridges( seed: number, x: number, z: number, octaves: number ) {
  let sum = 0, amp = 1, f = 1, norm = 0;
  for ( let k = 0; k < octaves; k++ ) {
    const r = 1 - Math.abs( noise( seed + k * 7919, x * f, z * f ) );
    sum    += r * r * amp;
    norm   += amp;
    amp    *= 0.5;
    f      *= 2.03;
  }
  return sum / norm;
}

/**
 * The made-up land's height at ( x, z ): its ground level near the map, mountains rising out of it further off ( a
 * kilometre or two of foothills, then ranges up to ~900 m ), all seeded.
**/
export function madeHeight( m: MadeLandData, x: number, z: number, detail = false, o: MadeOptions = { hills: 1, bumps: 1, variation: 0 } ) {
  // how far from the map as it was when the land was first made
  const dx = Math.max( m.x0 - x, 0, x - m.x1 ), dz = Math.max( m.z0 - z, 0, z - m.z1 ), d = Math.hypot( dx, dz );
  const rise = ( w: number ) => { const t = Math.min( 1, d / w ); return t * t * ( 3 - 2 * t ); };
  const seed = m.seed + o.variation * 101;
  let h      = m.level;
  // rolling ground everywhere, foothills from a kilometre out, ranges from a few
  h         += noise( seed, x / 700, z / 700 ) * 25 * o.hills;
  h         += ridges( seed + 1, x / 1800, z / 1800, 4 ) * 260 * rise( 1500 ) * o.hills;
  h         += ridges( seed + 2, x / 5200, z / 5200, 5 ) * 900 * rise( 4500 ) * o.hills;
  // ( a new chunk's ground: bumps a skier would feel, too small for the surroundings )
  if ( detail ) h += ( noise( seed + 3, x / 40, z / 40 ) * 1.2 + noise( seed + 4, x / 9, z / 9 ) * 0.25 ) * o.bumps;
  return h;
}

function madeLand( m: MadeLandData ): Land {
  return {
    kind:   "made",
    source: "made to match the map",
    coarse: async ( _b, _s, _sig, o ) => ( x, z ) => madeHeight( m, x, z, false, o ),
    fine:   async ( _b, _s, _p, _sig, o ) => ( { heights: ( x, z ) => madeHeight( m, x, z, true, o ), source: "made to match the map" } ),
    best:   async () => "made to match the map",
    keep:   () => {
      meta.madeLand ??= m;
    },
  };
}
