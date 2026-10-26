// Faces' settings ( flip, shade smooth ) and Duplicate ( Shift+D ).

import { type Mesh, type V3, cloneMesh, ek, ekv } from "../mesh";
import { type OpResult, type Sel, selFromFaces } from "./selection";

/**
 * Flip ( Alt+N › Flip ): the faces turned to face the other way.
**/
export function flip( g0: Mesh, faces: Set<number> ): Mesh {
  const g = cloneMesh( g0 );
  for ( const fi of faces ) g.f[fi].reverse();
  return g;
}

/**
 * Duplicate ( Shift+D ): a copy of the selected faces, edges and vertices, selected ( not moved yet ).
**/
export function duplicate( g0: Mesh, sel: Sel ): OpResult {
  const g    = cloneMesh( g0 );
  const copy = new Map<number, number>();
  const dup  = ( v: number ) => {
    let c = copy.get( v );
    if ( c === undefined ) copy.set( v, ( c = g.v.push( [...g0.v[v]] as V3 ) - 1 ) );
    return c;
  };
  const faces: number[] = [];
  for ( const fi of sel.f ) {
    faces.push( g.f.length );
    g.f.push( g0.f[fi].map( dup ) );
    g.m.push( g0.m[fi] );
    g.s.push( g0.s[fi] );
  }
  // selected edges not on a copied face come along as loose edges, lone vertices as they are
  const onFaces = new Set<string>();
  for ( const fi of sel.f ) {
    const f = g0.f[fi];
    for ( let i = 0; i < f.length; i++ ) onFaces.add( ek( f[i], f[( i + 1 ) % f.length] ) );
  }
  for ( const k of sel.e ) if ( !onFaces.has( k ) ) {
    const [a, b] = ekv( k );
    g.w.push( [dup( a ), dup( b )] );
  }
  for ( const v of sel.v ) dup( v );
  const s = selFromFaces( g, faces, [...copy.values()] );
  for ( const k of sel.e ) {
    const [a, b] = ekv( k );
    s.e.add( ek( copy.get( a )!, copy.get( b )! ) );
  }
  return { mesh: g, sel: s };
}

/**
 * Shade Smooth / Flat on the faces.
**/
export function setSmooth( g0: Mesh, faces: Iterable<number>, smooth: boolean ): Mesh {
  const g = cloneMesh( g0 );
  for ( const fi of faces ) g.s[fi] = smooth;
  return g;
}
