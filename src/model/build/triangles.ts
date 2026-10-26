// A model's mesh as the view and the game draw it: faces into triangles, smooth or flat by its angle.

import { type Mesh, type V3, add, cross, dot, faceNormal, len, norm, sub, vertexFaces } from "../mesh";
import type { Atlas } from "../uv";
import type { ModelData } from "./index";
import { evaluate } from "./modifiers";

/**
 * A face cut into triangles ( ear clipping in its plane; a fan if that fails ).
**/
export function triangulateFace( g: Mesh, f: number[], n: V3 ): number[][] {
  if ( f.length === 3 ) return [f];
  if ( f.length === 4 ) {
    // the shorter diagonal
    const d1 = len( sub( g.v[f[0]], g.v[f[2]] ) ), d2 = len( sub( g.v[f[1]], g.v[f[3]] ) );
    return d1 <= d2 ? [[f[0], f[1], f[2]], [f[0], f[2], f[3]]] : [[f[1], f[2], f[3]], [f[1], f[3], f[0]]];
  }
  const u      = norm( Math.abs( n[0] ) < 0.9 ? cross( n, [1, 0, 0] ) : cross( n, [0, 1, 0] ) ), w = cross( n, u );
  const p      = f.map( ( v ) => [dot( g.v[v], u ), dot( g.v[v], w )] as [number, number] );
  const idx    = f.map( ( _, i ) => i ), out: number[][] = [];
  const area2  = ( a: number, b: number, c: number ) => ( p[b][0] - p[a][0] ) * ( p[c][1] - p[a][1] ) - ( p[c][0] - p[a][0] ) * ( p[b][1] - p[a][1] );
  const inside = ( q: [number, number], a: number, b: number, c: number ) => {
    const s = ( x: number, y: number ) => ( p[y][0] - p[x][0] ) * ( q[1] - p[x][1] ) - ( q[0] - p[x][0] ) * ( p[y][1] - p[x][1] );
    return s( a, b ) > 0 && s( b, c ) > 0 && s( c, a ) > 0;
  };
  // ( the face runs counter-clockwise round n, so ears turn left )
  for ( let guard = 0; idx.length > 3 && guard < 10000; guard++ ) {
    let cut = false;
    for ( let i = 0; i < idx.length; i++ ) {
      const a = idx[( i - 1 + idx.length ) % idx.length], b = idx[i], c = idx[( i + 1 ) % idx.length];
      if ( area2( a, b, c ) <= 1e-12 ) continue;
      if ( idx.some( ( k ) => k !== a && k !== b && k !== c && inside( p[k], a, b, c ) ) ) continue;
      out.push( [f[a], f[b], f[c]] );
      idx.splice( i, 1 );
      cut = true;
      break;
    }
    if ( !cut ) break;
  }
  if ( idx.length === 3 ) out.push( idx.map( ( i ) => f[i] ) );
  else if ( idx.length > 3 ) for ( let i = 1; i + 1 < idx.length; i++ ) out.push( [f[idx[0]], f[idx[i]], f[idx[i + 1]]] );
  return out;
}

export interface Built {
  // Unity coordinates, metres
  pos:       Float32Array;
  nrm:       Float32Array;
  uv:        Float32Array;
  // triangles, slot by slot
  idx:       Uint32Array;
  // triangle-corner counts per material slot ( 0 .. the highest used )
  submeshes: number[];
}

/**
 * The evaluated mesh as triangles with normals and UVs, one submesh per material slot ( UVs from the paint layout
 * `atlasOf` gives for it, if it gives one, else a box projection ).
**/
export function buildMesh( model: ModelData, atlasOf?: ( g: Mesh ) => Atlas | null ): Built {
  const g                = evaluate( model );
  const atlas            = atlasOf?.( g ) ?? null;
  const fn               = g.f.map( ( _, fi ) => faceNormal( g, fi ) );
  const vf               = vertexFaces( g );
  const cos              = Math.cos( ( model.smoothAngle * Math.PI ) / 180 );
  const pos: number[]    = [], nrm: number[] = [], uv: number[] = [];
  const ids              = new Map<string, number>();
  const slots            = Math.max( 1, ...g.m.map( ( m ) => m + 1 ) );
  const tris: number[][] = Array.from( { length: slots }, () => [] );
  g.f.forEach( ( f, fi ) => {
    const n = fn[fi];
    if ( len( n ) < 0.5 ) return;
    // the box projection's axis: the face's most upright
    const ax     = Math.abs( n[0] ) > Math.abs( n[1] ) && Math.abs( n[0] ) > Math.abs( n[2] ) ? 0 : Math.abs( n[1] ) > Math.abs( n[2] ) ? 1 : 2;
    const f0     = g.f[fi];
    const corner = ( v: number ) => {
      let vn = n;
      if ( g.s[fi] ) {
        let s: V3 = [0, 0, 0];
        for ( const o of vf[v] ) if ( g.s[o] && dot( fn[o], n ) >= cos ) s = add( s, fn[o] );
        vn = len( s ) > 1e-9 ? norm( s ) : n;
      }
      const p        = g.v[v];
      const c        = atlas ? ( atlas.start[fi] + f0.indexOf( v ) ) * 2 : 0;
      const [u0, v0] = atlas ? [atlas.uv[c], atlas.uv[c + 1]]
        : ax === 0 ? [p[2] * Math.sign( n[0] || 1 ), p[1]] : ax === 1 ? [p[0], p[2] * Math.sign( n[1] || 1 )] : [-p[0] * Math.sign( n[2] || 1 ), p[1]];
      const key      = `${v}|${vn.map( ( x ) => Math.round( x * 1000 ) ).join( "," )}|${Math.round( u0 * 100000 )},${Math.round( v0 * 100000 )}`;
      let id         = ids.get( key );
      if ( id === undefined ) {
        ids.set( key, ( id = pos.length / 3 ) );
        pos.push( ...p );
        nrm.push( ...vn );
        uv.push( u0, v0 );
      }
      return id;
    };
    for ( const t of triangulateFace( g, f, n ) ) tris[g.m[fi] ?? 0].push( ...t.map( corner ) );
  } );
  return {
    pos: new Float32Array( pos ), nrm: new Float32Array( nrm ), uv: new Float32Array( uv ),
    idx: new Uint32Array( tris.flat() ), submeshes: tris.map( ( t ) => t.length ),
  };
}

/**
 * The built mesh as one buffer ( positions, normals, UVs, indices: what the viewport's asset cache holds ).
**/
export function packBuilt( b: Built ): ArrayBuffer {
  const n   = b.pos.length / 3;
  const buf = new ArrayBuffer( n * 32 + b.idx.length * 4 );
  new Float32Array( buf, 0,      n * 3 ).set( b.pos );
  new Float32Array( buf, n * 12, n * 3 ).set( b.nrm );
  new Float32Array( buf, n * 24, n * 2 ).set( b.uv  );
  new Uint32Array( buf, n * 32, b.idx.length ).set( b.idx );
  return buf;
}
