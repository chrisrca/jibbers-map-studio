// Smooth Vertices and Shrink/Fatten ( Alt+S ).

import { type Mesh, type V3, add, cloneMesh, edgesOf, faceNormal, len, lerp3, mul, norm } from "../mesh";
import { type OpResult, selFromVerts } from "./selection";

/**
 * Smooth Vertices: each selected corner moved `factor` of the way to the middle of its neighbours, `repeat` times.
**/
export function smoothVerts( g0: Mesh, verts: Set<number>, factor: number, repeat = 1 ): OpResult {
  const g = cloneMesh( g0 ), near = new Map<number, Set<number>>();
  for ( const e of edgesOf( g0 ).values() ) {
    ( near.get( e.a ) ?? near.set( e.a, new Set() ).get( e.a )! ).add( e.b );
    ( near.get( e.b ) ?? near.set( e.b, new Set() ).get( e.b )! ).add( e.a );
  }
  for ( let r = 0; r < repeat; r++ ) {
    const next = g.v.map( ( p ) => [...p] as V3 );
    for ( const v of verts ) {
      const ns = [...( near.get( v ) ?? [] )];
      if ( !ns.length ) continue;
      const c = mul( ns.reduce( ( a, n ) => add( a, g.v[n] ), [0, 0, 0] as V3 ), 1 / ns.length );
      next[v] = lerp3( g.v[v], c, factor );
    }
    g.v = next;
  }
  return { mesh: g, sel: selFromVerts( g, [...verts] ) };
}

/**
 * Shrink/Fatten: the selected corners moved `d` along their normals ( the faces' round each ).
**/
export function shrinkFatten( g0: Mesh, verts: Set<number>, d: number ): OpResult {
  const g = cloneMesh( g0 ), n = new Map<number, V3>();
  g0.f.forEach( ( f, fi ) => {
    const fn = faceNormal( g0, fi );
    for ( const v of f ) if ( verts.has( v ) ) n.set( v, add( n.get( v ) ?? [0, 0, 0], fn ) );
  } );
  for ( const v of verts ) {
    const nv = n.get( v );
    if ( nv && len( nv ) > 1e-9 ) g.v[v] = add( g0.v[v], mul( norm( nv ), d ) );
  }
  return { mesh: g, sel: selFromVerts( g, [...verts] ) };
}
