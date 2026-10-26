// The land around a real-world map, as scenery: what the game calls decorative mountains — meshes without colliders
// that are never hidden by distance. A grid over the area and `radius` metres around it, with a hole where the play
// area's terrain is ( its edge follows that terrain, tucked just under it ), the far edge dropped away like a horizon,
// and a snow / rock texture baked from the slopes.

import { encodePng } from "../../core/png";
import { ipc, joinPath } from "../../core/ipc";
import type { Sampler } from "../elevation/dem";
import { fillSampler } from "../elevation/sources";
import type { LocalProjection } from "../proj";

export interface SceneryOptions {
  dir:         string;
  proj:        LocalProjection;
  // half the play area's size ( metres, centred on the origin )
  halfX:       number;
  halfZ:       number;
  // how far the scenery reaches beyond the play area
  radius:      number;
  // elevation ( m above sea level ) of the map's y = 0
  seaLevel:    number;
  // the play area's own heights ( m above sea level ), for the scenery's inner edge
  edge:        Sampler;
  onProgress?: ( stage: string, f: number ) => void;
  signal?:     AbortSignal;
}

/**
 * Metres between scenery vertices: finer close in, coarser for the big ones ( a divisor of 1000, so the grid meets
 * the play area's edges exactly ).
**/
export const sceneryStep = ( radius: number ) => ( radius <= 6000 ? 40 : radius <= 10000 ? 50 : 100 );

const tick = () => new Promise( ( r ) => setTimeout( r, 0 ) );

// The scenery's snow and rock ( sRGB ), matched to the game's terrain: see where the texture is painted.
const SNOW = 250, ROCK = [178, 176, 172];

// How far the scenery's inner edge sits under the play area's own edge ( hides it where they meet ).
const TUCK        = 0.4;
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

/**
 * Builds the scenery into the project's library; returns its custom object ( as project.json stores it ).
**/
export async function buildScenery( o: SceneryOptions ): Promise<unknown> {
  const say = o.onProgress ?? ( () => {} );
  const s   = sceneryStep( o.radius );
  const R   = Math.ceil( o.radius / s ) * s;
  const X   = o.halfX + R, Z = o.halfZ + R;
  const nx  = Math.round( ( 2 * X ) / s ) + 1, nz = Math.round( ( 2 * Z ) / s ) + 1;
  const ia  = R / s, ib = ia + Math.round( ( 2 * o.halfX ) / s ), ja = R / s, jb = ja + Math.round( ( 2 * o.halfZ ) / s );

  // heights: the play area's own along its edge, the coarse elevation source elsewhere
  const corners = [[-X, -Z], [X, -Z], [X, Z], [-X, Z], [0, -Z], [0, Z], [-X, 0], [X, 0]].map( ( [x, z] ) => o.proj.inverse( x, z ) );
  const pad     = 0.01;
  const box: [number, number, number, number] = [
    Math.min( ...corners.map( ( p ) => p.lon ) ) - pad, Math.min( ...corners.map( ( p ) => p.lat ) ) - pad,
    Math.max( ...corners.map( ( p ) => p.lon ) ) + pad, Math.max( ...corners.map( ( p ) => p.lat ) ) + pad,
  ];
  say( "Downloading the surroundings…", 0 );
  // Copernicus ( the terrain tiles where it has none ), as fine as the scenery's grid
  const dem = await fillSampler( box, s, o.signal );
  say( "Building the surroundings…", 0 );
  const H   = new Float32Array( nx * nz );
  // along the edge: how far the play area's ( finer ) heights are from the coarse source's, to blend that difference
  // out over the first BLEND metres so the two meet without a step
  const off = new Float32Array( nx * nz );
  for ( let j = 0; j < nz; j++ ) {
    for ( let i = 0; i < nx; i++ ) {
      const inside = i >= ia && i <= ib && j >= ja && j <= jb;
      const onEdge = inside && ( i === ia || i === ib || j === ja || j === jb );
      const p      = o.proj.inverse( -X + i * s, -Z + j * s );
      if ( inside && !onEdge ) {
        // under the play area: never drawn, but the texture's slopes ( and the normals next to it ) read it
        const fine    = o.edge( p );
        H[j * nx + i] = ( Number.isNaN( fine ) ? o.seaLevel : fine ) - o.seaLevel;
        continue;
      }
      let coarse = dem( p );
      if ( Number.isNaN( coarse ) ) coarse = o.seaLevel;
      let h = coarse;
      if ( onEdge ) {
        const fine = o.edge( p );
        if ( !Number.isNaN( fine ) ) {
          off[j * nx + i] = fine - coarse;
          h               = fine;
        }
      }
      // the edge tucks just under the play area's terrain
      H[j * nx + i] = h - o.seaLevel - ( onEdge ? TUCK : 0 );
    }
    if ( ( j & 63 ) === 0 ) {
      say( "Building the surroundings…", j / nz );
      await tick();
      if ( o.signal?.aborted ) throw new DOMException( "Cancelled", "AbortError" );
    }
  }
  const BLEND = 400;
  const reach = Math.ceil( BLEND / s );
  for ( let j = Math.max( 0, ja - reach ); j <= Math.min( nz - 1, jb + reach ); j++ )
    for ( let i = Math.max( 0, ia - reach ); i <= Math.min( nx - 1, ib + reach ); i++ ) {
      if ( i >= ia && i <= ib && j >= ja && j <= jb ) continue;
      // the nearest point of the edge is the vertex clamped onto the hole's rectangle
      const ci = Math.min( ib, Math.max( ia, i ) ), cj = Math.min( jb, Math.max( ja, j ) );
      const d  = Math.hypot( i - ci, j - cj ) * s;
      if ( d >= BLEND ) continue;
      const t        = 1 - d / BLEND;
      H[j * nx + i] += off[cj * nx + ci] * t * t * ( 3 - 2 * t );
    }
  // the far edge drops away like a horizon
  for ( let i = 0; i < nx; i++ ) {
    H[i]                   -= 300;
    H[( nz - 1 ) * nx + i] -= 300;
  }
  for ( let j = 1; j < nz - 1; j++ ) {
    H[j * nx]          -= 300;
    H[j * nx + nx - 1] -= 300;
  }
  const at   = ( i: number, j: number ) => H[Math.min( nz - 1, Math.max( 0, j ) ) * nx + Math.min( nx - 1, Math.max( 0, i ) )];
  const uvOf = ( x: number, z: number ) => [( x + X ) / ( 2 * X ), ( z + Z ) / ( 2 * Z )];
  const hAt  = ( x: number, z: number ) => {
    const fi = ( x + X ) / s, fj = ( z + Z ) / s;
    const i  = Math.min( nx - 2, Math.max( 0, Math.floor( fi ) ) ), j = Math.min( nz - 2, Math.max( 0, Math.floor( fj ) ) );
    const a  = fi - i, b = fj - j;
    return ( at( i, j ) * ( 1 - a ) + at( i + 1, j ) * a ) * ( 1 - b ) + ( at( i, j + 1 ) * ( 1 - a ) + at( i + 1, j + 1 ) * a ) * b;
  };

  // the coarse grid, in four strips around the hole and the ring of cells next to it ( the collar fills those )
  const strips: [number, number, number, number][] = [
    [0, nx - 1, 0, ja - 1],
    [0, nx - 1, jb + 1, nz - 1],
    [0, ia - 1, ja - 1, jb + 1],
    [ib + 1, nx - 1, ja - 1, jb + 1],
  ];
  const files: string[] = [];
  for ( const [k, [i0, i1, j0, j1]] of strips.entries() ) {
    if ( i1 <= i0 || j1 <= j0 ) continue;
    const w             = i1 - i0 + 1;
    const pos: number[] = [], nrm: number[] = [], uvs: number[] = [], idx: number[] = [];
    for ( let j = j0; j <= j1; j++ )
      for ( let i = i0; i <= i1; i++ ) {
        const x = -X + i * s, z = -Z + j * s;
        pos.push( x, at( i, j ), z );
        const l   = Math.max( 0, i - 1 ), r = Math.min( nx - 1, i + 1 ), d = Math.max( 0, j - 1 ), u = Math.min( nz - 1, j + 1 );
        const gx  = ( at( r, j ) - at( l, j ) ) / Math.max( 1, ( r - l ) * s ), gz = ( at( i, u ) - at( i, d ) ) / Math.max( 1, ( u - d ) * s );
        const len = Math.hypot( gx, 1, gz );
        nrm.push( -gx / len, 1 / len, -gz / len );
        uvs.push( ...uvOf( x, z ) );
      }
    for ( let j = 0; j < j1 - j0; j++ )
      for ( let i = 0; i < i1 - i0; i++ ) {
        const a = j * w + i, b = ( j + 1 ) * w + i, c = ( j + 1 ) * w + i + 1, d2 = j * w + i + 1;
        // Unity's front faces: these wind so the ground faces up
        idx.push( a, b, c, a, c, d2 );
      }
    const rel = `scenery/strip-${k}.bin`;
    await ipc.writeBinary( joinPath( o.dir, rel ), packMesh( pos, uvs, idx, nrm ) );
    files.push( rel );
  }

  // the collar: one coarse cell wide all round the hole, its inner edge following the play area's own heights every
  // COLLAR_STEP metres, its outer edge on the coarse grid's ( so neither side has a step )
  {
    const pos: number[] = [], uvs: number[] = [], nrm: number[] = [], idx: number[] = [];
    const add           = ( x: number, y: number, z: number, n: [number, number, number] ) => {
      pos.push( x, y, z );
      uvs.push( ...uvOf( x, z ) );
      nrm.push( ...n );
      return pos.length / 3 - 1;
    };
    const normal = ( gx: number, gz: number ): [number, number, number] => {
      const l = Math.hypot( gx, 1, gz );
      return [-gx / l, 1 / l, -gz / l];
    };
    const coarseN = ( x: number, z: number ) => normal( ( hAt( x + s, z ) - hAt( x - s, z ) ) / ( 2 * s ), ( hAt( x, z + s ) - hAt( x, z - s ) ) / ( 2 * s ) );
    const fineAt  = ( x: number, z: number ) => {
      const p = o.proj.inverse( x, z );
      let h   = o.edge( p );
      if ( Number.isNaN( h ) ) h = dem( p );
      return ( Number.isNaN( h ) ? o.seaLevel : h ) - o.seaLevel - TUCK;
    };
    // the fine terrain's slope there, smoothed over ~25 m ( finer would streak across the collar's long triangles )
    const fineN = ( x: number, z: number ) => normal( ( fineAt( x + 12, z ) - fineAt( x - 12, z ) ) / 24, ( fineAt( x, z + 12 ) - fineAt( x, z - 12 ) ) / 24 );
    // the coarse grid's height anywhere along one of its lines ( straight between its vertices, as drawn )
    const lineX = ( j: number, x: number ) => {
      const fi = ( x + X ) / s, i = Math.min( nx - 2, Math.floor( fi ) ), a = fi - i;
      return at( i, j ) * ( 1 - a ) + at( i + 1, j ) * a;
    };
    const lineZ = ( i: number, z: number ) => {
      const fj = ( z + Z ) / s, j = Math.min( nz - 2, Math.floor( fj ) ), a = fj - j;
      return at( i, j ) * ( 1 - a ) + at( i, j + 1 ) * a;
    };
    const hx      = o.halfX, hz = o.halfZ;
    const nAlongX = Math.round( ( 2 * hx ) / COLLAR_STEP ), nAlongZ = Math.round( ( 2 * hz ) / COLLAR_STEP );
    // south ( outer z = -hz - s ) and north ( outer z = hz + s ): quads wound to face up
    for ( const side of ["s", "n"] as const ) {
      const zIn             = side === "s" ? -hz : hz, zOut = side === "s" ? -hz - s : hz + s, jOut = side === "s" ? ja - 1 : jb + 1;
      const inner: number[] = [], outer: number[] = [];
      for ( let k = 0; k <= nAlongX; k++ ) {
        const x = -hx + ( k * 2 * hx ) / nAlongX;
        inner.push( add( x, fineAt( x, zIn ), zIn,  fineN( x, zIn )    ) );
        outer.push( add( x, lineX( jOut, x ), zOut, coarseN( x, zOut ) ) );
      }
      for ( let k = 0; k < nAlongX; k++ ) {
        const [lo0, lo1, hi0, hi1] = side === "s" ? [outer[k], outer[k + 1], inner[k], inner[k + 1]] : [inner[k], inner[k + 1], outer[k], outer[k + 1]];
        idx.push( lo0, hi0, hi1, lo0, hi1, lo1 );
      }
    }
    // west ( outer x = -hx - s ) and east ( outer x = hx + s )
    for ( const side of ["w", "e"] as const ) {
      const xIn             = side === "w" ? -hx : hx, xOut = side === "w" ? -hx - s : hx + s, iOut = side === "w" ? ia - 1 : ib + 1;
      const inner: number[] = [], outer: number[] = [];
      for ( let k = 0; k <= nAlongZ; k++ ) {
        const z = -hz + ( k * 2 * hz ) / nAlongZ;
        inner.push( add( xIn,  fineAt( xIn, z ), z, fineN( xIn, z )    ) );
        outer.push( add( xOut, lineZ( iOut, z ), z, coarseN( xOut, z ) ) );
      }
      for ( let k = 0; k < nAlongZ; k++ ) {
        // left = lower x, right = higher x; rows k ( lower z ) and k + 1
        const [l0, l1, r0, r1] = side === "w" ? [outer[k], outer[k + 1], inner[k], inner[k + 1]] : [inner[k], inner[k + 1], outer[k], outer[k + 1]];
        idx.push( l0, l1, r1, l0, r1, r0 );
      }
    }
    // the four corner cells
    for ( const [ci, cj, di, dj] of [[ia, ja, -1, -1], [ib, ja, 1, -1], [ia, jb, -1, 1], [ib, jb, 1, 1]] ) {
      const i0 = Math.min( ci, ci + di ), j0 = Math.min( cj, cj + dj );
      const v  = ( i: number, j: number ) => {
        const x = -X + i * s, z = -Z + j * s;
        return i === ci && j === cj ? add( x, fineAt( x, z ), z, fineN( x, z ) ) : add( x, at( i, j ), z, coarseN( x, z ) );
      };
      const a = v( i0, j0 ), b = v( i0, j0 + 1 ), c = v( i0 + 1, j0 + 1 ), d = v( i0 + 1, j0 );
      idx.push( a, b, c, a, c, d );
    }
    const rel = "scenery/collar.bin";
    await ipc.writeBinary( joinPath( o.dir, rel ), packMesh( pos, uvs, idx, nrm ) );
    files.push( rel );
  }

  // texture: snow, rock on the steep ( row 0 = the north edge, as Unity reads images )
  say( "Painting the surroundings…", 0 );
  const T     = 2048;
  const px    = new Uint8Array( T * T * 4 );
  const texel = ( 2 * X ) / T, texelZ = ( 2 * Z ) / T;
  for ( let ty = 0; ty < T; ty++ ) {
    const z = Z - ( ty + 0.5 ) * texelZ;
    for ( let tx = 0; tx < T; tx++ ) {
      const x     = -X + ( tx + 0.5 ) * texel;
      const d     = Math.max( s * 0.5, texel );
      const gx    = ( hAt( x + d, z ) - hAt( x - d, z ) ) / ( 2 * d ), gz = ( hAt( x, z + d ) - hAt( x, z - d ) ) / ( 2 * d );
      const slope = ( Math.atan( Math.hypot( gx, gz ) ) * 180 ) / Math.PI;
      const rock  = Math.min( 1, Math.max( 0, ( slope - 30 ) / 14 ) );
      const k2    = rock * rock * ( 3 - 2 * rock );
      // a little variation so big slopes aren't flat colour
      const grain = ( valueNoise( x / 420, z / 420 ) * 0.6 + valueNoise( x / 90, z / 90 ) * 0.4 ) * ( 3 + 9 * k2 ) - 2;
      const o4    = ( ty * T + tx ) * 4;
      // the game's own terrain colours, as they come out in its lighting: its terrain shader lights snow as
      // colour x ( sun x angle + 0.3 ) with a near-white snow ( 0.972 ) and a grey rock ( 0.698 ); the scenery is a lit object
      // ( Unity's PBR: albedo x ~0.96 x ( sun x angle + sky ) ), so neutral near-white snow and the same grey rock match it
      // ( not the bluish off-white this had, which came out ~14% darker )
      px[o4]      = Math.round( SNOW + ( ROCK[0] - SNOW ) * k2 + grain );
      px[o4 + 1]  = Math.round( SNOW + ( ROCK[1] - SNOW ) * k2 + grain );
      px[o4 + 2]  = Math.round( SNOW + ( ROCK[2] - SNOW ) * k2 + grain );
      px[o4 + 3]  = 255;
    }
    if ( ( ty & 127 ) === 0 ) {
      say( "Painting the surroundings…", ty / T );
      await tick();
    }
  }
  const texRel = "scenery/albedo.png";
  await ipc.writeBinary( joinPath( o.dir, texRel ), await encodePng( T, T, px ) );
  say( "Saving the surroundings…", 1 );
  return ipc.addScenery( o.dir, "Surroundings", files, texRel );
}
