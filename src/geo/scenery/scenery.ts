// The land around a map, as scenery: what the game calls decorative mountains — meshes without colliders that are
// never hidden by distance. A grid over the area and `radius` metres around it, with a hole where the play area's
// chunks are ( whatever their shape: its edge follows their ground, tucked just under it ), the far edge dropped away
// like a horizon, and a snow / rock texture baked from the slopes. The land is the real one round a real mountain, or
// one made up to match the map ( geo/land.ts ).

import { encodePng } from "../../core/png";
import { ipc, joinPath } from "../../core/ipc";
import type { Heights, MapBox } from "../land";

export interface SceneryOptions {
  dir:         string;
  // the play area: its chunks' squares ( west, south, east, north, metres )
  cells:       MapBox[];
  // how far the scenery reaches beyond the play area
  radius:      number;
  // the ground's own heights ( the map's y ), for the scenery's inner edge
  edge:        Heights;
  // the land round it ( the map's y ) over a box, at least `step` metres apart ( geo/land.ts )
  far:         ( box: MapBox, step: number, signal?: AbortSignal ) => Promise<Heights>;
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
  const cx0 = Math.min( ...o.cells.map( ( c ) => c[0] ) ), cz0 = Math.min( ...o.cells.map( ( c ) => c[1] ) );
  const cx1 = Math.max( ...o.cells.map( ( c ) => c[2] ) ), cz1 = Math.max( ...o.cells.map( ( c ) => c[3] ) );
  const s   = stepFor( o.radius, o.cells, cx0, cz0 );
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

  say( "Downloading the surroundings…", 0 );
  const far = await o.far( [ex0, ez0, ex1, ez1], s, o.signal );
  say( "Building the surroundings…", 0 );
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
        H[k]       = fine - TUCK;
      } else H[k] = coarse;
    }
    if ( ( j & 63 ) === 0 ) {
      say( "Building the surroundings…", j / nz );
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
  for ( let i = 0; i < nx; i++ ) {
    H[i]                   -= 300;
    H[( nz - 1 ) * nx + i] -= 300;
  }
  for ( let j = 1; j < nz - 1; j++ ) {
    H[j * nx]          -= 300;
    H[j * nx + nx - 1] -= 300;
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
  const tucked  = ( x: number, z: number ) => fineAt( x, z ) - TUCK;
  // the ground's slope there, smoothed over ~25 m ( finer would streak across the collar's long triangles )
  const fineN   = ( x: number, z: number ) => normal( ( tucked( x + 12, z ) - tucked( x - 12, z ) ) / 24, ( tucked( x, z + 12 ) - tucked( x, z - 12 ) ) / 24 );

  // a mesh being made: its vertices and triangles, written out once it's as big as one should be ( Unity's 16-bit
  // indices: under 65 536 vertices each )
  const files: string[] = [];
  let pos: number[] = [], uvs: number[] = [], nrm: number[] = [], idx: number[] = [];
  const flush = async () => {
    if ( !idx.length ) return;
    const rel = `scenery/strip-${files.length}.bin`;
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
  say( "Painting the surroundings…", 0 );
  const T     = 2048;
  const px    = new Uint8Array( T * T * 4 );
  const texel = W / T, texelZ = D / T;
  for ( let ty = 0; ty < T; ty++ ) {
    const z = ez1 - ( ty + 0.5 ) * texelZ;
    for ( let tx = 0; tx < T; tx++ ) {
      const x     = ex0 + ( tx + 0.5 ) * texel;
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

/**
 * Metres between the scenery's vertices: sceneryStep's, or the nearest finer one every chunk's edge falls on.
**/
function stepFor( radius: number, cells: MapBox[], x0: number, z0: number ) {
  const fits = ( s: number ) => cells.every( ( c ) => c.every( ( v, k ) => Math.abs( ( ( v - ( k % 2 ? z0 : x0 ) ) / s ) - Math.round( ( v - ( k % 2 ? z0 : x0 ) ) / s ) ) < 1e-6 ) );
  for ( const s of [sceneryStep( radius ), 50, 40, 25, 20, 10] ) if ( fits( s ) ) return s;
  return 10;
}
