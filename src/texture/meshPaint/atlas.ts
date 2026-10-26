// A modelled piece's paint layout: its atlas ( each face's place on the texture ), and the texel map that finds the
// texels near a point on the piece.

import { type ModelData, evaluate, triangulateFace } from "../../model/build";
import { type Mesh, type V3, faceNormal } from "../../model/mesh";
import { type Atlas, meshSig, smartProject } from "../../model/uv";

// The paint layout of a shape ( made once per shape ).
const atlases = new Map<string, Atlas>();

/**
 * What a kept layout depends on: which corners make which faces ( not where they are ).
**/
export function topoSig( g: Mesh ) {
  let h     = 2166136261;
  const mix = ( x: number ) => ( h = Math.imul( h ^ x, 16777619 ) );
  for ( const f of g.f ) {
    mix( f.length );
    for ( const v of f ) mix( v );
  }
  return `${g.v.length}/${g.f.length}/${h >>> 0}`;
}

// Layouts made for faces the piece hasn't kept one for yet, by those faces ( made once, from where they first were ).
const byTopo = new Map<string, Atlas>();

// Kept layouts as atlases.
const kept = new WeakMap<number[], Atlas>();

/**
 * A model's paint layout: the one it keeps while its faces are the same ones, else one for its faces now.
**/
export function paintAtlas( model: ModelData, g: Mesh = evaluate( model ) ): Atlas {
  const topo = topoSig( g ), p = model.paint;
  if ( p?.uv && p.topo === topo ) {
    let a = kept.get( p.uv );
    if ( !a ) {
      const start = new Int32Array( g.f.length );
      let c       = 0;
      g.f.forEach( ( f, i ) => ( ( start[i] = c ), ( c += f.length ) ) );
      if ( c * 2 === p.uv.length ) kept.set( p.uv, ( a = { uv: Float32Array.from( p.uv ), start, sig: p.sig } ) );
    }
    if ( a ) return a;
  }
  let a = byTopo.get( topo );
  if ( !a ) {
    a = atlasFor( g );
    byTopo.set( topo, a );
    if ( byTopo.size > 64 ) byTopo.delete( byTopo.keys().next().value! );
  }
  return a;
}

// The latest texel map of each layout ( at each size ): what the paint is carried from when the layout changes.
export const lastMaps = new Map<string, TexelMap>();

export function atlasFor( g: Mesh ): Atlas {
  const sig = meshSig( g );
  let a     = atlases.get( sig );
  if ( !a ) {
    a = smartProject( g );
    atlases.set( sig, a );
    if ( atlases.size > 64 ) atlases.delete( atlases.keys().next().value! );
  }
  return a;
}

// Where each texel of a layout lies on the piece ( its own coordinates ) and which way it faces: the texels inside the
// faces, and a two-texel border round each island ( filled from the nearest inside, so filtering never shows the
// gaps ). Plus a grid of them by position, to find those near a point.
export interface TexelMap {
  n:    number;
  pos:  Float32Array;
  nrm:  Float32Array;
  // 1 inside a face, 2 on an island's border, 0 unused
  used: Uint8Array;
  cell: number;
  grid: Map<number, number[]>;
}

/**
 * A grid cell's key ( cells are a fiftieth of the piece across, so within ±1024 of its origin ).
**/
const cellKey = ( x: number, y: number, z: number ) => ( ( x + 1024 ) * 2048 + ( y + 1024 ) ) * 2048 + ( z + 1024 );

const maps = new Map<string, TexelMap>();

export function texelMap( g: Mesh, atlas: Atlas, n: number ): TexelMap {
  // ( by layout and where the corners are: a kept layout on moved corners lies elsewhere )
  const key = `${atlas.sig}|${meshSig( g )}@${n}`;
  const had = maps.get( key );
  if ( had ) return had;
  const pos = new Float32Array( n * n * 3 ), nrm = new Float32Array( n * n * 3 ), used = new Uint8Array( n * n );
  g.f.forEach( ( f, fi ) => {
    const fnrm = faceNormal( g, fi );
    for ( const t of triangulateFace( g, f, fnrm ) ) {
      const c    = t.map( ( v ) => ( atlas.start[fi] + f.indexOf( v ) ) * 2 );
      const uv   = c.map( ( k ) => [atlas.uv[k] * n, atlas.uv[k + 1] * n] );
      const P    = t.map( ( v ) => g.v[v] );
      const x0   = Math.max( 0, Math.floor( Math.min( ...uv.map( ( p ) => p[0] ) ) ) ), x1 = Math.min( n - 1, Math.ceil( Math.max( ...uv.map( ( p ) => p[0] ) ) ) );
      const y0   = Math.max( 0, Math.floor( Math.min( ...uv.map( ( p ) => p[1] ) ) ) ), y1 = Math.min( n - 1, Math.ceil( Math.max( ...uv.map( ( p ) => p[1] ) ) ) );
      const area = ( uv[1][0] - uv[0][0] ) * ( uv[2][1] - uv[0][1] ) - ( uv[2][0] - uv[0][0] ) * ( uv[1][1] - uv[0][1] );
      if ( Math.abs( area ) < 1e-9 ) continue;
      for ( let y = y0; y <= y1; y++ )
        for ( let x = x0; x <= x1; x++ ) {
          const px = x + 0.5, py = y + 0.5;
          const w1 = ( ( px - uv[0][0] ) * ( uv[2][1] - uv[0][1] ) - ( uv[2][0] - uv[0][0] ) * ( py - uv[0][1] ) ) / area;
          const w2 = ( ( uv[1][0] - uv[0][0] ) * ( py - uv[0][1] ) - ( px - uv[0][0] ) * ( uv[1][1] - uv[0][1] ) ) / area;
          const w0 = 1 - w1 - w2;
          if ( w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4 ) continue;
          const k = y * n + x;
          for ( let a = 0; a < 3; a++ ) {
            pos[k * 3 + a] = P[0][a] * w0 + P[1][a] * w1 + P[2][a] * w2;
            nrm[k * 3 + a] = fnrm[a];
          }
          used[k] = 1;
        }
    }
  } );
  // the border: texels next to an island take their neighbour's place ( twice round )
  for ( let pass = 0; pass < 2; pass++ ) {
    const add2: [number, number][] = [];
    for ( let y = 0; y < n; y++ )
      for ( let x = 0; x < n; x++ ) {
        const k = y * n + x;
        if ( used[k] ) continue;
        for ( const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] ) {
          const xx = x + dx, yy = y + dy;
          if ( xx < 0 || yy < 0 || xx >= n || yy >= n || !used[yy * n + xx] ) continue;
          add2.push( [k, yy * n + xx] );
          break;
        }
      }
    for ( const [k, from] of add2 ) {
      pos.set( pos.subarray( from * 3, from * 3 + 3 ), k * 3 );
      nrm.set( nrm.subarray( from * 3, from * 3 + 3 ), k * 3 );
      used[k] = 2;
    }
  }
  // a grid by position: cells about a fiftieth of the piece across
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for ( const p of g.v ) for ( let a = 0; a < 3; a++ ) { lo[a] = Math.min( lo[a], p[a] ); hi[a] = Math.max( hi[a], p[a] ); }
  const cell = Math.max( 0.01, Math.max( hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2] ) / 50 );
  const grid = new Map<number, number[]>();
  for ( let k = 0; k < n * n; k++ ) {
    if ( !used[k] ) continue;
    const key2 = cellKey( Math.floor( pos[k * 3] / cell ), Math.floor( pos[k * 3 + 1] / cell ), Math.floor( pos[k * 3 + 2] / cell ) );
    ( grid.get( key2 ) ?? grid.set( key2, [] ).get( key2 )! ).push( k );
  }
  const m: TexelMap = { n, pos, nrm, used, cell, grid };
  maps.set( key, m );
  if ( maps.size > 8 ) maps.delete( maps.keys().next().value! );
  lastMaps.delete( `${atlas.sig}@${n}` );
  lastMaps.set( `${atlas.sig}@${n}`, m );
  if ( lastMaps.size > 16 ) lastMaps.delete( lastMaps.keys().next().value! );
  return m;
}

/**
 * The texels within `r` of a point ( piece coordinates ).
**/
export function texelsNear( m: TexelMap, p: V3, r: number, f: ( k: number, d2: number ) => void ) {
  const c  = m.cell, reach = Math.ceil( r / c );
  const cx = Math.floor( p[0] / c ), cy = Math.floor( p[1] / c ), cz = Math.floor( p[2] / c );
  for ( let x = cx - reach; x <= cx + reach; x++ )
    for ( let y = cy - reach; y <= cy + reach; y++ )
      for ( let z = cz - reach; z <= cz + reach; z++ )
        for ( const k of m.grid.get( cellKey( x, y, z ) ) ?? [] ) {
          const dx = m.pos[k * 3] - p[0], dy = m.pos[k * 3 + 1] - p[1], dz = m.pos[k * 3 + 2] - p[2], d2 = dx * dx + dy * dy + dz * dz;
          if ( d2 <= r * r ) f( k, d2 );
        }
}
