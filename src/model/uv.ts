// A modelled piece's texture layout for painting ( Blender's Smart UV Project ): faces grouped into islands that face
// within an angle of each other, each island laid flat on its own plane at true size, and the islands packed into
// the square with a gap round each, so every face gets its own part of the texture at the same density.

import { add, cross, dot, edgesOf, ek, faceNormal, len, norm, type Mesh, type V3 } from "./mesh";

export interface Atlas {
  // u, v of each face corner, face after face ( in the faces' corner order )
  uv:    Float32Array;
  // where each face's corners start in `uv` ( ×2 )
  start: Int32Array;
  // what it was made from ( vertex and face counts, corners and positions to the millimetre )
  sig:   string;
}

/**
 * What the layout depends on: the faces and where their corners are.
**/
export function meshSig( g: Mesh ) {
  let h     = 2166136261;
  const mix = ( x: number ) => ( h = Math.imul( h ^ x, 16777619 ) );
  for ( const f of g.f ) {
    mix( f.length );
    for ( const v of f ) mix( v );
  }
  for ( const p of g.v ) for ( const x of p ) mix( Math.round( x * 1000 ) );
  return `${g.v.length}/${g.f.length}/${h >>> 0}`;
}

/**
 * Smart UV Project: islands of faces within `angle` degrees, packed with `margin` ( a fraction of the texture ).
**/
export function smartProject( g: Mesh, angle = 66, margin = 0.004 ): Atlas {
  const cos    = Math.cos( ( angle * Math.PI ) / 180 );
  const fn     = g.f.map( ( _, fi ) => faceNormal( g, fi ) );
  const edges  = edgesOf( g );
  const island = new Int32Array( g.f.length ).fill( -1 );
  const islands: { faces: number[]; n: V3 }[] = [];
  for ( let s = 0; s < g.f.length; s++ ) {
    if ( island[s] >= 0 ) continue;
    const id  = islands.length, faces = [s], seed = fn[s];
    island[s] = id;
    for ( let i = 0; i < faces.length; i++ ) {
      const f = g.f[faces[i]];
      for ( let k = 0; k < f.length; k++ )
        for ( const o of edges.get( ek( f[k], f[( k + 1 ) % f.length] ) )?.faces ?? [] )
          if ( island[o] < 0 && dot( fn[o], seed ) >= cos ) {
            island[o] = id;
            faces.push( o );
          }
    }
    let n: V3 = [0, 0, 0];
    for ( const fi of faces ) n = add( n, fn[fi] );
    islands.push( { faces, n: len( n ) > 1e-9 ? norm( n ) : seed } );
  }
  // each island flat on its plane, in metres
  const start = new Int32Array( g.f.length );
  let corners = 0;
  g.f.forEach( ( f, fi ) => {
    start[fi] = corners;
    corners  += f.length;
  } );
  const flat  = new Float32Array( corners * 2 );
  const boxes = islands.map( ( isl ) => {
    const n = isl.n, u = norm( Math.abs( n[1] ) < 0.9 ? cross( [0, 1, 0], n ) : cross( [1, 0, 0], n ) ), w = cross( n, u );
    let x0  = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for ( const fi of isl.faces )
      g.f[fi].forEach( ( v, k ) => {
        const p = g.v[v], x = dot( p, u ), y = dot( p, w );
        flat[( start[fi] + k ) * 2]     = x;
        flat[( start[fi] + k ) * 2 + 1] = y;
        x0 = Math.min( x0, x );
        y0 = Math.min( y0, y );
        x1 = Math.max( x1, x );
        y1 = Math.max( y1, y );
      } );
    return { isl, x0, y0, w: Math.max( 1e-4, x1 - x0 ), h: Math.max( 1e-4, y1 - y0 ), px: 0, py: 0 };
  } );
  // shelf packing into a square, grown until everything fits
  const area  = boxes.reduce( ( a, b ) => a + b.w * b.h, 0 );
  const order = [...boxes].sort( ( a, b ) => b.h - a.h );
  let side    = Math.sqrt( area ) * 1.05;
  for ( let tries = 0; tries < 200; tries++ ) {
    const gap = side * margin * 2;
    let x     = gap, y = gap, row = 0, ok = true;
    for ( const b of order ) {
      if ( x + b.w + gap > side ) {
        x   = gap;
        y  += row + gap;
        row = 0;
      }
      if ( b.w + 2 * gap > side || y + b.h + gap > side ) {
        ok = false;
        break;
      }
      b.px = x;
      b.py = y;
      x   += b.w + gap;
      row  = Math.max( row, b.h );
    }
    if ( ok ) break;
    side *= 1.05;
  }
  const uv = new Float32Array( corners * 2 );
  for ( const b of boxes )
    for ( const fi of b.isl.faces )
      for ( let k = 0; k < g.f[fi].length; k++ ) {
        const c   = ( start[fi] + k ) * 2;
        uv[c]     = ( flat[c] - b.x0 + b.px ) / side;
        uv[c + 1] = ( flat[c + 1] - b.y0 + b.py ) / side;
      }
  return { uv, start, sig: meshSig( g ) };
}

