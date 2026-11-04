// A modelled mesh's own UVs ( the UV Editor's ): unwrapped ( Blender's U menu: Smart UV Project, Cube Projection,
// Project from View, Reset ), and moved corner by corner. A face without its own shows the box projection it's
// textured with, and gets it as its own the first time one of its corners is moved.

import { boxUv } from "./build/triangles";
import { cloneMesh, compact, dot, faceNormal, faceUvs, type Mesh, type V3 } from "./mesh";
import { smartProject } from "./uv";

export type Unwrap = "smart" | "cube" | "view" | "reset";

// A face's corner: the face, and which of its corners.
export type Corner = [number, number];

/**
 * A corner's UV: the face's own, else its box projection.
**/
export function uvAt( g: Mesh, fi: number, k: number ): [number, number] {
  const own = faceUvs( g, fi );
  return own ? [own[k * 2], own[k * 2 + 1]] : boxUv( g.v[g.f[fi][k]], faceNormal( g, fi ) );
}

/**
 * The faces' UVs worked out afresh, as Blender's U menu does: Smart UV Project ( islands laid flat and packed into the
 * square ), Cube Projection ( each face along its most upright axis, a 2 m cube to the square ), Project from View
 * ( as the view sees them, `view`'s right and up, fitted into the square ), Reset ( each face the whole square ).
**/
export function unwrap( g0: Mesh, faces: Iterable<number>, kind: Unwrap, view?: { right: V3; up: V3 } ): Mesh {
  const g    = cloneMesh( g0 );
  const list = [...faces].filter( ( fi ) => g.f[fi] );
  g.u        = g.f.map( ( _, fi ) => [...( faceUvs( g0, fi ) ?? [] )] );
  if ( kind === "smart" ) {
    // the faces by themselves, packed together
    const part = compact( { v: g.v, f: list.map( ( fi ) => g.f[fi] ), m: list.map( () => 0 ), s: list.map( () => false ), w: [] } ).mesh;
    const a    = smartProject( part );
    list.forEach( ( fi, i ) => ( g.u![fi] = Array.from( a.uv.subarray( a.start[i] * 2, ( a.start[i] + g.f[fi].length ) * 2 ) ) ) );
    return g;
  }
  if ( kind === "reset" ) {
    for ( const fi of list ) {
      const n = g.f[fi].length;
      // a quad's corners on the square's, any other face's round its middle
      g.u[fi] = n === 4 ? [0, 0, 1, 0, 1, 1, 0, 1] : g.f[fi].flatMap( ( _, k ) => [0.5 + 0.5 * Math.cos( ( k / n ) * Math.PI * 2 ), 0.5 + 0.5 * Math.sin( ( k / n ) * Math.PI * 2 )] );
    }
    return g;
  }
  if ( kind === "cube" ) {
    for ( const fi of list ) {
      const n = faceNormal( g, fi );
      g.u[fi] = g.f[fi].flatMap( ( v ) => boxUv( g.v[v], n ).map( ( x ) => x / 2 + 0.5 ) );
    }
    return g;
  }
  // from the view: flat as it's seen, the whole fitted into the square ( its shape kept )
  const r  = view?.right ?? [1, 0, 0], up = view?.up ?? [0, 1, 0];
  const at = list.map( ( fi ) => g.f[fi].map( ( v ) => [dot( g.v[v], r ), dot( g.v[v], up )] ) );
  const xs = at.flat().map( ( p ) => p[0] ), ys = at.flat().map( ( p ) => p[1] );
  const x0 = Math.min( ...xs ), y0 = Math.min( ...ys ), s = Math.max( Math.max( ...xs ) - x0, Math.max( ...ys ) - y0, 1e-6 );
  list.forEach( ( fi, i ) => ( g.u![fi] = at[i].flatMap( ( [x, y] ) => [( x - x0 ) / s, ( y - y0 ) / s] ) ) );
  return g;
}

/**
 * The corners among `faces` joined to one in the UV Editor: the same vertex, at the same place in UV ( so moving one
 * moves it where the faces meet there, not where a seam lets them part ).
**/
export function joined( g: Mesh, faces: Iterable<number>, fi: number, k: number ): Corner[] {
  const v             = g.f[fi][k], [u0, v0] = uvAt( g, fi, k );
  const out: Corner[] = [];
  for ( const f of faces )
    g.f[f].forEach( ( x, j ) => {
      if ( x !== v ) return;
      const [u, w] = uvAt( g, f, j );
      if ( Math.abs( u - u0 ) < 1e-6 && Math.abs( w - v0 ) < 1e-6 ) out.push( [f, j] );
    } );
  return out;
}

/**
 * The mesh with the corners' UVs moved by `to` ( from where they are ); a face that had none of its own takes its box
 * projection first.
**/
export function moveUvs( g0: Mesh, corners: Corner[], to: ( u: number, v: number ) => [number, number] ): Mesh {
  const g = cloneMesh( g0 );
  g.u     = g.f.map( ( _, fi ) => [...( faceUvs( g0, fi ) ?? [] )] );
  for ( const [fi, k] of corners ) {
    if ( !faceUvs( g, fi ) ) g.u[fi] = g.f[fi].flatMap( ( _, j ) => uvAt( g0, fi, j ) );
    const [u, v]       = uvAt( g0, fi, k );
    const [nu, nv]     = to( u, v );
    g.u[fi][k * 2]     = nu;
    g.u[fi][k * 2 + 1] = nv;
  }
  return g;
}
