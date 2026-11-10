// The land around a map, as scenery: what the game calls decorative mountains — meshes without colliders that are
// never hidden by distance. Rings of it round the play area, out to `radius`: each a band a whole number of kilometres
// wide, its vertices as far apart as the detail curve has it there ( 1 m close in at the most, 200 m at the least ), and a
// texture of its own as sharp as that ( close in, the game's own rock texture on its rock, its hollows shaded ), its
// heights from the best data there is where it's fine ( lidar where it's been flown ). Each has a hole where what's
// inside it is ( the play area's chunks, whatever their shape; the ring inside ) and its inner edge follows that ground,
// tucked just under it; the outermost drops away at its far edge like a horizon. The land is the real one round a real
// mountain, or one made up to match the map ( geo/land.ts ).

import { encodePng } from "../../core/png";
import { ipc, joinPath } from "../../core/ipc";
import { evalCurve, type Curve } from "../../core/curve";
import { SCENERY_ROCK_ANGLE } from "../../core/types";
import { decodePng } from "../elevation/dem";
import type { Heights, MapBox } from "../land";

export interface SceneryOptions {
  dir:         string;
  // the play area: its chunks' squares ( west, south, east, north, metres )
  cells:       MapBox[];
  // how far the scenery reaches beyond the play area
  radius:      number;
  // how far its far edge drops away, like a horizon ( metres; 300 by default )
  drop?:       number;
  // the ground's own heights ( the map's y ), for the scenery's inner edge
  edge:        Heights;
  // the land round it ( the map's y ) over a box, at least `step` metres apart ( geo/land.ts )
  far:         ( box: MapBox, step: number, signal?: AbortSignal ) => Promise<Heights>;
  // the most detail there is of it over a box, `step` metres apart at least ( the near ring's; `far`'s without )
  near?:       ( box: MapBox, step: number, signal?: AbortSignal ) => Promise<Heights>;
  // rock painted from this slope up ( degrees; SCENERY_ROCK_ANGLE by default )
  rockAngle?:  number;
  // what its land's download is called ( "Downloading USGS 3DEP 1 m lidar…" )
  downloading?: string;
  // how fine it is from the play area's edge ( t 0 ) out to its far edge ( t 1 ): 1 the finest, 0 the coarsest
  // ( SCENERY_DETAIL by default; surroundingsPlan )
  detail?:     Curve;
  onProgress?: ( stage: string, f: number ) => void;
  signal?:     AbortSignal;
}

/**
 * Metres between scenery vertices: finer close in, coarser for the big ones ( a divisor of 1000, so the grid meets
 * the play area's edges exactly ).
**/
export const sceneryStep = ( radius: number ) => ( radius <= 6000 ? 40 : radius <= 10000 ? 50 : 100 );

const tick = () => new Promise( ( r ) => setTimeout( r, 0 ) );

// The most vertices the scenery's grid may have, whatever its detail ( the game draws all of it, always ).
const MAX_VERTICES = 2_500_000;

// The scenery's snow and rock ( sRGB ), as the game's terrain shows them: painted in as they come out, so the studio
// shows it before the export's tint ( geo/scenery/inner.ts SNOW_TARGET: which is this snow ) as the game will.
const SNOW = 216, ROCK = [160, 158, 155];

// The detail curve's ends: metres between vertices at its top and bottom ( on a log scale between ), and every spacing
// a ring may have ( divisors of 1000: the play area's chunks' edges fall on its lines whatever they are )
const FINEST = 1, COARSEST = 200;
const RING_STEPS = [1, 2, 4, 5, 8, 10, 20, 25, 40, 50, 100, 200];
// The detail curve when none's been set: straight down from ~10 m at the map's edge to ~100 m at the far edge
export const SCENERY_DETAIL: Curve = [{ t: 0, v: 0.57 }, { t: 1 / 3, v: 0.4233 }, { t: 2 / 3, v: 0.2767 }, { t: 1, v: 0.13 }];

// How far a ring's inner edge sits under what's inside it: the play area's own edge ( hides it where they meet ), the
// near ring's ( only just: the two are cut from the same land there )
const TUCK = 0.4, TUCK_NEAR = 0.05;
// Metres between the collar's vertices along the play area's edge ( it follows the fine terrain there ).
const COLLAR_STEP = 2;

/**
 * One mesh in the format project/scenery.rs reads; normals from the faces when none are given.
**/
export function packMesh( pos: number[], uvs: number[], idx: number[], nrm?: number[] ) {
  const n = pos.length / 3, m = idx.length;
  if ( !nrm ) {
    const acc = new Float64Array( n * 3 );
    for ( let t = 0; t < m; t += 3 ) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      const e1        = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]];
      const e2        = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]];
      const f         = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      for ( const v of [a, b, c] ) for ( let k = 0; k < 3; k++ ) acc[v * 3 + k] += f[k];
    }
    nrm = [];
    for ( let v = 0; v < n; v++ ) {
      const l = Math.hypot( acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2] ) || 1;
      nrm.push( acc[v * 3] / l, acc[v * 3 + 1] / l, acc[v * 3 + 2] / l );
    }
  }
  const buf = new ArrayBuffer( 8 + n * 32 + m * 4 );
  new Uint32Array( buf, 0, 2 ).set( [n, m] );
  new Float32Array( buf, 8,          n * 3 ).set( pos );
  new Float32Array( buf, 8 + n * 12, n * 3 ).set( nrm );
  new Float32Array( buf, 8 + n * 24, n * 2 ).set( uvs );
  new Uint32Array( buf, 8 + n * 32, m ).set( idx );
  return new Uint8Array( buf );
}

/**
 * Smooth value noise in [-1, 1] ( a hashed lattice, cosine-blended ).
**/
function valueNoise( x: number, z: number ) {
  const hash = ( i: number, j: number ) => {
    let h = ( i * 374761393 + j * 668265263 ) | 0;
    h     = Math.imul( h ^ ( h >>> 13 ), 1274126177 );
    return ( ( h ^ ( h >>> 16 ) ) >>> 0 ) / 4294967295;
  };
  const i = Math.floor( x ), j = Math.floor( z ), fx = x - i, fz = z - j;
  const u = fx * fx * ( 3 - 2 * fx ), v = fz * fz * ( 3 - 2 * fz );
  const a = hash( i, j ), b = hash( i + 1, j ), c = hash( i, j + 1 ), d = hash( i + 1, j + 1 );
  return ( ( a * ( 1 - u ) + b * u ) * ( 1 - v ) + ( c * ( 1 - u ) + d * u ) * v ) * 2 - 1;
}

// One ring of the scenery, as it's built.
interface RingOptions {
  dir:       string;
  // what's inside it ( its hole ), and how far it reaches round that
  cells:     MapBox[];
  radius:    number;
  // metres between its vertices ( a divisor of 1000 every cell's edge falls on )
  step:      number;
  // how far its far edge drops away, and its inner edge sits under what's inside
  drop:      number;
  tuck:      number;
  // its meshes' file names ( "<name>-<n>.bin" ) and its texture's size ( pixels, square )
  name:      string;
  texture:   number;
  rockAngle: number;
  // painted close up: the game's rock texture on its rock, its hollows shaded ( the near ring )
  sharp:     boolean;
  // the ground inside it, and the land ( read already, over its box )
  edge:      Heights;
  land:      Heights;
  say:       ( stage: string, f: number ) => void;
  signal?:   AbortSignal;
}

/**
 * A ring built: its meshes' files, its heights ( its own grid's, between its vertices ), and its painting ( its
 * texture's file, once painted: every ring's built first, then every one painted ).
**/
async function ring( o: RingOptions ): Promise<{ files: string[]; heights: Heights; paint: ( say: ( stage: string, f: number ) => void ) => Promise<string> }> {
  const say = o.say;
  const cx0 = Math.min( ...o.cells.map( ( c ) => c[0] ) ), cz0 = Math.min( ...o.cells.map( ( c ) => c[1] ) );
  const cx1 = Math.max( ...o.cells.map( ( c ) => c[2] ) ), cz1 = Math.max( ...o.cells.map( ( c ) => c[3] ) );
  const s   = o.step;
  const R   = Math.ceil( o.radius / s ) * s;
  // the grid: over the play area and R round it ( every chunk's edge on one of its lines )
  const ex0 = cx0 - R, ez0 = cz0 - R, ex1 = cx1 + R, ez1 = cz1 + R;
  const nx  = Math.round( ( ex1 - ex0 ) / s ) + 1, nz = Math.round( ( ez1 - ez0 ) / s ) + 1;
  const qx  = nx - 1, qz = nz - 1;
  const xOf = ( i: number ) => ex0 + i * s, zOf = ( j: number ) => ez0 + j * s;

  // which of its squares are ground ( the chunks' ): no scenery there
  const ground = new Uint8Array( qx * qz );
  for ( const c of o.cells )
    for ( let j = Math.round( ( c[1] - ez0 ) / s ); j < Math.round( ( c[3] - ez0 ) / s ); j++ )
      for ( let i = Math.round( ( c[0] - ex0 ) / s ); i < Math.round( ( c[2] - ex0 ) / s ); i++ ) ground[j * qx + i] = 1;
  const isGround = ( i: number, j: number ) => i >= 0 && j >= 0 && i < qx && j < qz && ground[j * qx + i] === 1;
  // a vertex on the ground's edge ( squares of both round it ), or under it ( all ground )
  const around = ( i: number, j: number ) => +isGround( i - 1, j - 1 ) + +isGround( i, j - 1 ) + +isGround( i - 1, j ) + +isGround( i, j );
  const edgeV  = new Uint8Array( nx * nz ), underV = new Uint8Array( nx * nz );
  for ( let j = 0; j < nz; j++ )
    for ( let i = 0; i < nx; i++ ) {
      const n = around( i, j );
      if ( n === 4 ) underV[j * nx + i] = 1;
      else if ( n > 0 ) edgeV[j * nx + i] = 1;
    }

  const far = o.land;
  say( "Building terrain…", 0 );
  // the ground's own height there ( nudged in off a corner it only just touches ), else the land's
  const fineAt = ( x: number, z: number ) => {
    for ( const [dx, dz] of [[0, 0], [-0.05, -0.05], [0.05, -0.05], [-0.05, 0.05], [0.05, 0.05]] ) {
      const h = o.edge( x + dx, z + dz );
      if ( !Number.isNaN( h ) ) return h;
    }
    const h = far( x, z );
    return Number.isNaN( h ) ? 0 : h;
  };
  const H   = new Float32Array( nx * nz );
  // along the edge: how far the ground's ( finer ) heights are from the land's, to blend that difference out over the
  // first BLEND metres so the two meet without a step
  const off = new Float32Array( nx * nz );
  for ( let j = 0; j < nz; j++ ) {
    for ( let i = 0; i < nx; i++ ) {
      const k = j * nx + i, x = xOf( i ), z = zOf( j );
      // under the ground: never drawn, but the texture's slopes ( and the normals next to it ) read it
      if ( underV[k] ) { H[k] = fineAt( x, z ); continue; }
      let coarse = far( x, z );
      if ( Number.isNaN( coarse ) ) coarse = 0;
      if ( edgeV[k] ) {
        const fine = fineAt( x, z );
        off[k]     = fine - coarse;
        // the edge tucks just under the ground
        H[k]       = fine - o.tuck;
      } else H[k] = coarse;
    }
    if ( ( j & 63 ) === 0 ) {
      say( "Building terrain…", j / nz );
      await tick();
      if ( o.signal?.aborted ) throw new DOMException( "Cancelled", "AbortError" );
    }
  }
  // the nearest edge vertex to every other ( a two-pass chamfer over the grid ), to blend its difference out
  const BLEND = 400;
  const dist  = new Float32Array( nx * nz ).fill( Infinity ), near = new Int32Array( nx * nz ).fill( -1 );
  for ( let k = 0; k < nx * nz; k++ ) if ( edgeV[k] ) { dist[k] = 0; near[k] = k; }
  const relax = ( k: number, from: number, w: number ) => {
    if ( near[from] < 0 || dist[from] + w >= dist[k] ) return;
    dist[k] = dist[from] + w;
    near[k] = near[from];
  };
  for ( let j = 0; j < nz; j++ )
    for ( let i = 0; i < nx; i++ ) {
      const k = j * nx + i;
      if ( i > 0 ) relax( k, k - 1, 1 );
      if ( j > 0 ) { relax( k, k - nx, 1 ); if ( i > 0 ) relax( k, k - nx - 1, Math.SQRT2 ); if ( i < nx - 1 ) relax( k, k - nx + 1, Math.SQRT2 ); }
    }
  for ( let j = nz - 1; j >= 0; j-- )
    for ( let i = nx - 1; i >= 0; i-- ) {
      const k = j * nx + i;
      if ( i < nx - 1 ) relax( k, k + 1, 1 );
      if ( j < nz - 1 ) { relax( k, k + nx, 1 ); if ( i < nx - 1 ) relax( k, k + nx + 1, Math.SQRT2 ); if ( i > 0 ) relax( k, k + nx - 1, Math.SQRT2 ); }
    }
  for ( let k = 0; k < nx * nz; k++ ) {
    if ( edgeV[k] || underV[k] || near[k] < 0 ) continue;
    const d = dist[k] * s;
    if ( d >= BLEND ) continue;
    const t = 1 - d / BLEND;
    H[k]   += off[near[k]] * t * t * ( 3 - 2 * t );
  }
  // the far edge drops away like a horizon
  const drop = o.drop;
  for ( let i = 0; i < nx; i++ ) {
    H[i]                   -= drop;
    H[( nz - 1 ) * nx + i] -= drop;
  }
  for ( let j = 1; j < nz - 1; j++ ) {
    H[j * nx]          -= drop;
    H[j * nx + nx - 1] -= drop;
  }
  const at   = ( i: number, j: number ) => H[Math.min( nz - 1, Math.max( 0, j ) ) * nx + Math.min( nx - 1, Math.max( 0, i ) )];
  const W    = ex1 - ex0, D = ez1 - ez0;
  const uvOf = ( x: number, z: number ) => [( x - ex0 ) / W, ( z - ez0 ) / D];
  const hAt  = ( x: number, z: number ) => {
    const fi = ( x - ex0 ) / s, fj = ( z - ez0 ) / s;
    const i  = Math.min( nx - 2, Math.max( 0, Math.floor( fi ) ) ), j = Math.min( nz - 2, Math.max( 0, Math.floor( fj ) ) );
    const a  = fi - i, b = fj - j;
    return ( at( i, j ) * ( 1 - a ) + at( i + 1, j ) * a ) * ( 1 - b ) + ( at( i, j + 1 ) * ( 1 - a ) + at( i + 1, j + 1 ) * a ) * b;
  };
  const normal  = ( gx: number, gz: number ): [number, number, number] => {
    const l = Math.hypot( gx, 1, gz );
    return [-gx / l, 1 / l, -gz / l];
  };
  const gridN   = ( i: number, j: number ) => {
    const l = Math.max( 0, i - 1 ), r = Math.min( nx - 1, i + 1 ), d = Math.max( 0, j - 1 ), u = Math.min( nz - 1, j + 1 );
    return normal( ( at( r, j ) - at( l, j ) ) / Math.max( 1, ( r - l ) * s ), ( at( i, u ) - at( i, d ) ) / Math.max( 1, ( u - d ) * s ) );
  };
  const tucked  = ( x: number, z: number ) => fineAt( x, z ) - o.tuck;
  // the ground's slope there, smoothed over ~25 m ( finer would streak across the collar's long triangles )
  const fineN   = ( x: number, z: number ) => normal( ( tucked( x + 12, z ) - tucked( x - 12, z ) ) / 24, ( tucked( x, z + 12 ) - tucked( x, z - 12 ) ) / 24 );

  // a mesh being made: its vertices and triangles, written out once it's as big as one should be ( Unity's 16-bit
  // indices: under 65 536 vertices each )
  const files: string[] = [];
  let pos: number[] = [], uvs: number[] = [], nrm: number[] = [], idx: number[] = [];
  const flush = async () => {
    if ( !idx.length ) return;
    const rel = `scenery/${o.name}-${files.length}.bin`;
    await ipc.writeBinary( joinPath( o.dir, rel ), packMesh( pos, uvs, idx, nrm ) );
    files.push( rel );
    pos = []; uvs = []; nrm = []; idx = [];
  };
  const add = ( x: number, y: number, z: number, n: [number, number, number] ) => {
    pos.push( x, y, z );
    uvs.push( ...uvOf( x, z ) );
    nrm.push( ...n );
    return pos.length / 3 - 1;
  };
  // a triangle, wound so it faces up ( Unity's front faces: clockwise seen from above in its axes )
  const tri = ( a: number, b: number, c: number ) => {
    const ax = pos[a * 3], az = pos[a * 3 + 2], cross = ( pos[b * 3] - ax ) * ( pos[c * 3 + 2] - az ) - ( pos[b * 3 + 2] - az ) * ( pos[c * 3] - ax );
    if ( cross > 0 ) idx.push( a, c, b );
    else idx.push( a, b, c );
  };

  // the plain squares, a band of rows at a time ( a band's vertices shared between its squares )
  const rows = Math.max( 1, Math.floor( 60000 / nx ) - 1 );
  const collar: [number, number][] = [];
  for ( let j0 = 0; j0 < qz; j0 += rows ) {
    const j1  = Math.min( qz, j0 + rows );
    const ids = new Int32Array( ( j1 - j0 + 1 ) * nx ).fill( -1 );
    const v   = ( i: number, j: number ) => {
      const k = ( j - j0 ) * nx + i;
      if ( ids[k] < 0 ) ids[k] = add( xOf( i ), at( i, j ), zOf( j ), gridN( i, j ) );
      return ids[k];
    };
    for ( let j = j0; j < j1; j++ )
      for ( let i = 0; i < qx; i++ ) {
        if ( isGround( i, j ) ) continue;
        // ( a square beside the ground is the collar's: it follows the ground's edge finely )
        if ( isGround( i, j - 1 ) || isGround( i, j + 1 ) || isGround( i - 1, j ) || isGround( i + 1, j ) ) { collar.push( [i, j] ); continue; }
        const a = v( i, j ), b = v( i, j + 1 ), c = v( i + 1, j + 1 ), d = v( i + 1, j );
        tri( a, b, c );
        tri( a, c, d );
      }
    await flush();
    await tick();
  }

  // the collar: each square beside the ground, its side ( or two ) along the ground following the ground's own heights
  // every COLLAR_STEP metres, its other corners on the coarse grid's ( so neither side has a step )
  {
    const n     = Math.max( 1, Math.round( s / COLLAR_STEP ) );
    // points along a side from grid vertex ( ia, ja ) to ( ib, jb ): on the ground's edge its heights, else straight
    // between the corners' as the coarse grid draws it
    const along = ( ia: number, ja: number, ib: number, jb: number, fine: boolean ) => {
      const out: number[] = [];
      for ( let k = 0; k <= n; k++ ) {
        const t = k / n, x = xOf( ia ) + ( xOf( ib ) - xOf( ia ) ) * t, z = zOf( ja ) + ( zOf( jb ) - zOf( ja ) ) * t;
        out.push( fine ? add( x, tucked( x, z ), z, fineN( x, z ) ) : add( x, at( ia, ja ) + ( at( ib, jb ) - at( ia, ja ) ) * t, z, gridN( t < 0.5 ? ia : ib, t < 0.5 ? ja : jb ) ) );
      }
      return out;
    };
    for ( const [i, j] of collar ) {
      if ( pos.length / 3 > 60000 ) await flush();
      // its sides by the ground: south ( j ), north ( j + 1 ), west ( i ), east ( i + 1 )
      const S = isGround( i, j - 1 ), N = isGround( i, j + 1 ), Wg = isGround( i - 1, j ), E = isGround( i + 1, j );
      const sides = [S, N, Wg, E].filter( Boolean ).length;
      if ( sides === 1 ) {
        // a strip from that side to the one across from it
        const [inner, outer] = S ? [along( i, j, i + 1, j, true ), along( i, j + 1, i + 1, j + 1, false )]
          : N ? [along( i, j + 1, i + 1, j + 1, true ), along( i, j, i + 1, j, false )]
          : Wg ? [along( i, j, i, j + 1, true ), along( i + 1, j, i + 1, j + 1, false )]
          : [along( i + 1, j, i + 1, j + 1, true ), along( i, j, i, j + 1, false )];
        for ( let k = 0; k < n; k++ ) {
          tri( inner[k], inner[k + 1], outer[k + 1] );
          tri( inner[k], outer[k + 1], outer[k] );
        }
        continue;
      }
      // two sides by it ( the ground's inside corner ): a fan from the corner away from it round both
      const ci = Wg ? i : i + 1, cj = S ? j : j + 1;
      const fi = Wg ? i + 1 : i, fj = S ? j + 1 : j;
      const one = along( fi, cj, ci, cj, true ), two = along( ci, cj, ci, fj, true ).slice( 1 );
      const rim = [...one, ...two];
      const f   = add( xOf( fi ), at( fi, fj ), zOf( fj ), gridN( fi, fj ) );
      for ( let k = 0; k + 1 < rim.length; k++ ) tri( f, rim[k], rim[k + 1] );
    }
    await flush();
  }

  // texture: snow, rock on the steep ( row 0 = the north edge, as Unity reads images )
  // ( `say`: its own progress, painting )
  const paint = async ( say: ( stage: string, f: number ) => void ) => {
    say( "Painting…", 0 );
    const T      = o.texture;
    const px     = new Uint8Array( T * T * 4 );
    const texel  = W / T, texelZ = D / T;
    const rock   = o.sharp ? await gameRock() : null;
    // close up, the land's own heights ( finer than the ring's vertices ); further out, the ring's
    const hTex   = o.sharp ? ( x: number, z: number ) => { const h = far( x, z ); return Number.isNaN( h ) ? hAt( x, z ) : h; } : hAt;
    const d      = o.sharp ? Math.max( 1, texel ) : Math.max( s * 0.5, texel );
    for ( let ty = 0; ty < T; ty++ ) {
      const z = ez1 - ( ty + 0.5 ) * texelZ;
      for ( let tx = 0; tx < T; tx++ ) {
        const x     = ex0 + ( tx + 0.5 ) * texel;
        const h     = hTex( x, z );
        const gx    = ( hTex( x + d, z ) - hTex( x - d, z ) ) / ( 2 * d ), gz = ( hTex( x, z + d ) - hTex( x, z - d ) ) / ( 2 * d );
        const slope = ( Math.atan( Math.hypot( gx, gz ) ) * 180 ) / Math.PI;
        const r     = Math.min( 1, Math.max( 0, ( slope - o.rockAngle ) / 14 ) );
        const k2    = r * r * ( 3 - 2 * r );
        // a little variation so big slopes aren't flat colour
        const grain = ( valueNoise( x / 420, z / 420 ) * 0.6 + valueNoise( x / 90, z / 90 ) * 0.4 ) * ( 3 + 9 * k2 ) - 2;
        // close up: hollows a little darker, ridges a touch lighter ( against the land 6 m round )
        let shade   = 1;
        if ( o.sharp ) {
          const hollow = ( hTex( x + 6, z ) + hTex( x - 6, z ) + hTex( x, z + 6 ) + hTex( x, z - 6 ) ) / 4 - h;
          shade        = hollow > 0 ? 1 - Math.min( 1, hollow / 4 ) * 0.22 : 1 + Math.min( 1, -hollow / 4 ) * 0.04;
        }
        // the game's own terrain colours, as they come out in its lighting ( SNOW, ROCK: neutral, not the bluish off-white
        // this once had ). Close up its rock is the game's rock texture, as its terrain draws rock ( formations ), tiled
        // as it tiles it.
        const rc    = rock ? rock.at( x, z ) : null;
        const o4    = ( ty * T + tx ) * 4;
        for ( let c = 0; c < 3; c++ ) {
          // ( the grain on the snow only, where the rock is the game's texture )
          const rk       = rc ? rc[c] : ROCK[c];
          px[o4 + c]     = Math.max( 0, Math.min( 255, Math.round( ( SNOW + ( rk - SNOW ) * k2 + grain * ( rc ? 1 - k2 : 1 ) ) * shade ) ) );
        }
        px[o4 + 3]  = 255;
      }
      if ( ( ty & 127 ) === 0 ) {
        say( "Painting…", ty / T );
        await tick();
        if ( o.signal?.aborted ) throw new DOMException( "Cancelled", "AbortError" );
      }
    }
    const texRel = `scenery/${o.name}-albedo.png`;
    await ipc.writeBinary( joinPath( o.dir, texRel ), await encodePng( T, T, px ) );
    return texRel;
  };
  return { files, heights: hAt, paint };
}

// One ring of the plan: what's inside it ( its inner box; the play area's chunks for the first ), how wide it is, its
// vertices' spacing, its texture's size, whether it's painted close up ( sharp: its land read every `grid` metres, the
// best data there is ) — and its outer box.
export interface PlannedRing { width: number; step: number; texture: number; sharp: boolean; grid: number; outer: MapBox; vertices: number }

/**
 * The surroundings' rings for `detail` round the play area `cells` out to `radius`: a band a kilometre wide at a time,
 * each its spacing from the curve at its middle ( snapped to RING_STEPS ), bands alike made one ring; and what they come
 * to ( vertices, and roughly the bytes of their textures ).
**/
export function surroundingsPlan( cells: MapBox[], radius: number, detail: Curve = SCENERY_DETAIL ) {
  const bx0   = Math.min( ...cells.map( ( c ) => c[0] ) ), bz0 = Math.min( ...cells.map( ( c ) => c[1] ) );
  const bx1   = Math.max( ...cells.map( ( c ) => c[2] ) ), bz1 = Math.max( ...cells.map( ( c ) => c[3] ) );
  const bands = Math.max( 1, Math.round( radius / 1000 ) );
  const stepAt = ( t: number ) => {
    const want = COARSEST * ( FINEST / COARSEST ) ** Math.min( 1, Math.max( 0, evalCurve( detail, t ) ) );
    return RING_STEPS.reduce( ( a, s ) => ( Math.abs( Math.log( s / want ) ) < Math.abs( Math.log( a / want ) ) ? s : a ), RING_STEPS[0] );
  };
  const rings: PlannedRing[] = [];
  let inner: MapBox          = [bx0, bz0, bx1, bz1];
  for ( let k = 0; k < bands; ) {
    const step = stepAt( ( k + 0.5 ) / bands );
    let n      = 1;
    while ( k + n < bands && stepAt( ( k + n + 0.5 ) / bands ) === step ) n++;
    const width       = n * 1000;
    const outer: MapBox = [inner[0] - width, inner[1] - width, inner[2] + width, inner[3] + width];
    const ext         = Math.max( outer[2] - outer[0], outer[3] - outer[1] );
    // its texture: a texel an eighth of its spacing or so, the nearest power of two ( at most 4096 a side, at least 512 )
    const texture     = Math.max( 512, Math.min( 4096, 2 ** Math.round( Math.log2( ext / Math.max( 0.5, step / 8 ) ) ) ) );
    const texel       = ext / texture;
    const area        = ( outer[2] - outer[0] ) * ( outer[3] - outer[1] ) - ( inner[2] - inner[0] ) * ( inner[3] - inner[1] );
    // ( painted close up, from the best data, where it's fine enough to show: lidar downloaded for coarser rings would
    // be kilometres of it for nothing much )
    rings.push( { width, step, texture, sharp: step <= 25 && texel <= 3, grid: Math.max( 1, texel, ext / 2048 ), outer, vertices: Math.round( area / ( step * step ) ) } );
    inner = outer;
    k    += n;
  }
  const vertices = rings.reduce( ( a, r ) => a + r.vertices, 0 );
  // ( a sharp texture's PNG ~1.4 bytes a pixel, a smooth one's ~0.6 )
  const bytes    = rings.reduce( ( a, r ) => a + r.texture * r.texture * ( r.sharp ? 1.4 : 0.6 ), 0 ) + vertices * 36;
  return { rings, vertices, bytes };
}

/**
 * Builds the scenery into the project's library; returns its custom object ( as project.json stores it ).
**/
export async function buildScenery( o: SceneryOptions ): Promise<unknown> {
  const say   = o.onProgress ?? ( () => {} );
  const angle = o.rockAngle ?? SCENERY_ROCK_ANGLE;
  const drop  = o.drop ?? 300;
  const plan  = surroundingsPlan( o.cells, o.radius, o.detail );
  const base  = { dir: o.dir, rockAngle: angle, signal: o.signal };
  const count = plan.rings.length;
  // ( each stage's progress over every ring )
  const part  = ( stage: string, n: number ) => ( _: string, f: number ) => say( stage, ( n + f ) / count );
  // the land for every ring, first: close in the best there is, sampled finely; further out the coarse
  const fetching = o.downloading ?? "Downloading elevation data…";
  const lands: Heights[] = [];
  for ( const [n, r] of plan.rings.entries() ) {
    say( fetching, n / count );
    lands.push( r.sharp ? await grid( await ( o.near ?? o.far )( r.outer, r.grid, o.signal ), r.outer, r.grid, angle, part( fetching, n ), o.signal ) : await o.far( r.outer, r.step, o.signal ) );
  }
  // each ring round the one inside it, its inner edge on that one's; the outermost the "strip" ( what the play area's
  // stand-in is textured from: inner.ts, project/scenery.rs ), the others "ring<n>"
  let inner: MapBox[] = o.cells, edge = o.edge;
  const built: { name: string; files: string[]; paint: ( say: ( stage: string, f: number ) => void ) => Promise<string> }[] = [];
  for ( const [n, r] of plan.rings.entries() ) {
    const last = n === count - 1;
    const name = last ? "strip" : `ring${n}`;
    const made = await ring( {
      ...base, cells: inner, radius: r.width, step: r.step, drop: last ? drop : 0, tuck: n ? TUCK_NEAR : TUCK, name, texture: r.texture, sharp: r.sharp, edge,
      land: lands[n], say: part( "Building terrain…", n ),
    } );
    built.push( { name, files: made.files, paint: made.paint } );
    inner = [r.outer];
    edge  = made.heights;
  }
  const textures: string[] = [];
  for ( const [n, b] of built.entries() ) textures.push( await b.paint( part( "Painting…", n ) ) );
  say( "Saving…", 1 );
  const strip = built[count - 1];
  return ipc.addScenery( o.dir, "Surroundings", strip.files, textures[count - 1], built.slice( 0, -1 ).map( ( b, n ) => ( { name: b.name, strips: b.files, texture: textures[n] } ) ) );
}

/**
 * Land read into a grid `g` metres apart over `box` ( looked up quickly after: the near ring's texture reads it a few
 * times a texel ), its rock roughened a little as the game's formations are ( a few metres of ridged noise where it's
 * steep ), and holes filled with the nearest height read.
**/
async function grid( land: Heights, box: MapBox, g: number, angle: number, say: ( stage: string, f: number ) => void, signal?: AbortSignal ): Promise<Heights> {
  const nx = Math.ceil( ( box[2] - box[0] ) / g ) + 1, nz = Math.ceil( ( box[3] - box[1] ) / g ) + 1;
  const H  = new Float32Array( nx * nz );
  let last = 0;
  for ( let j = 0; j < nz; j++ ) {
    for ( let i = 0; i < nx; i++ ) {
      const h          = land( box[0] + i * g, box[1] + j * g );
      H[j * nx + i]    = Number.isNaN( h ) ? last : ( last = h );
    }
    if ( ( j & 63 ) === 0 ) {
      say( "Downloading the land close by…", j / nz );
      await tick();
      if ( signal?.aborted ) throw new DOMException( "Cancelled", "AbortError" );
    }
  }
  // ( the roughening: on rock only, ridged, ~3 m at most, 12-40 m across )
  const R = new Float32Array( H );
  for ( let j = 1; j < nz - 1; j++ )
    for ( let i = 1; i < nx - 1; i++ ) {
      const k     = j * nx + i;
      const gx    = ( H[k + 1] - H[k - 1] ) / ( 2 * g ), gz = ( H[k + nx] - H[k - nx] ) / ( 2 * g );
      const slope = ( Math.atan( Math.hypot( gx, gz ) ) * 180 ) / Math.PI;
      const r     = Math.min( 1, Math.max( 0, ( slope - angle ) / 14 ) );
      if ( r <= 0 ) continue;
      const x     = box[0] + i * g, z = box[1] + j * g;
      const ridge = ( 1 - Math.abs( valueNoise( x / 40, z / 40 ) ) ) * 0.65 + ( 1 - Math.abs( valueNoise( x / 12, z / 12 ) ) ) * 0.35;
      R[k]       += ( ridge - 0.6 ) * 3 * r * r * ( 3 - 2 * r );
    }
  return ( x, z ) => {
    const fi = ( x - box[0] ) / g, fj = ( z - box[1] ) / g;
    const i  = Math.min( nx - 2, Math.max( 0, Math.floor( fi ) ) ), j = Math.min( nz - 2, Math.max( 0, Math.floor( fj ) ) );
    const a  = Math.min( 1, Math.max( 0, fi - i ) ), b = Math.min( 1, Math.max( 0, fj - j ) ), k = j * nx + i;
    return ( R[k] * ( 1 - a ) + R[k + 1] * a ) * ( 1 - b ) + ( R[k + nx] * ( 1 - a ) + R[k + nx + 1] * a ) * b;
  };
}

// The game's rock texture ( its terrain's: what it draws rock and formations with ), read once
let rockTex: Promise<{ at: ( x: number, z: number ) => [number, number, number] } | null> | null = null;

/**
 * The game's rock texture as its terrain lays it ( tiled by world metres, times its rock colour ), in sRGB levels; null
 * without the game.
**/
function gameRock() {
  rockTex ??= ( async () => {
    const t = await ipc.gameTerrain().catch( () => null );
    if ( !t?.textures.rock ) return null;
    const px   = await decodePng( new Blob( [await ipc.readBinary( joinPath( t.dir, t.textures.rock ) )], { type: "image/png" } ) );
    const n    = Math.round( Math.sqrt( px.length / 4 ) );
    const per  = ( t.worldScale ?? 0.001 ) * ( t.rockTexTiling ?? 150 );
    // ( its colour times the game's rock colour )
    const tint = t.rockColor?.[0] ?? 0.849;
    return {
      at: ( x: number, z: number ): [number, number, number] => {
        const u = ( ( ( x * per ) % 1 ) + 1 ) % 1, v = ( ( ( -z * per ) % 1 ) + 1 ) % 1;
        const k = ( Math.min( n - 1, Math.floor( v * n ) ) * n + Math.min( n - 1, Math.floor( u * n ) ) ) * 4;
        return [px[k] * tint, px[k + 1] * tint, px[k + 2] * tint];
      },
    };
  } )().catch( () => null );
  return rockTex;
}

// Every spacing the scenery's vertices may have ( divisors of 1000 ), coarsest first.
const STEPS = [200, 100, 50, 40, 25, 20, 10];

/**
 * Metres between the scenery's vertices: sceneryStep's times `detail`, or the nearest finer one every chunk's edge
 * falls on, and no finer than MAX_VERTICES lets it be over the whole grid ( w x d the play area ).
**/
export function stepFor( radius: number, cells: MapBox[], x0: number, z0: number, detail = 1, w = 0, d = 0 ) {
  const fits   = ( s: number ) => cells.every( ( c ) => c.every( ( v, k ) => Math.abs( ( ( v - ( k % 2 ? z0 : x0 ) ) / s ) - Math.round( ( v - ( k % 2 ? z0 : x0 ) ) / s ) ) < 1e-6 ) );
  const verts  = ( s: number ) => ( ( w + 2 * Math.ceil( radius / s ) * s ) / s + 1 ) * ( ( d + 2 * Math.ceil( radius / s ) * s ) / s + 1 );
  const want   = sceneryStep( radius ) * detail;
  const fitted = STEPS.filter( ( s ) => fits( s ) && verts( s ) <= MAX_VERTICES );
  // the nearest to what's wanted, the finer of two as near
  return fitted.reduce( ( a, s ) => ( Math.abs( Math.log( s / want ) ) <= Math.abs( Math.log( a / want ) ) + 1e-9 ? s : a ), fitted[0] ?? 10 );
}
