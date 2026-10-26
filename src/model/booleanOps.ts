// Booleans on modelled pieces ( Blender's Bool Tool ): the mesh's faces as convex polygons, combined with a cutter's
// ( model/csg.ts ), and made back into faces ( model/importMesh.ts trisToMesh: flat regions one face again ).

import * as THREE from "three";
import { triangulateFace } from "./build";
import { boolean, poly, type BoolOp, type P3, type Poly } from "./csg";
import { faceNormal, type Mesh } from "./mesh";
import { trisToMesh, type SourceTris } from "./importMesh";

/**
 * A mesh's faces as convex polygons ( its triangles ), moved by `M` ( Unity space ) when given; slots kept below `slots`.
**/
export function meshPolys( g: Mesh, M?: THREE.Matrix4, slots = Infinity ): Poly[] {
  const v = g.v.map( ( p ): P3 => {
    if ( !M ) return [p[0], p[1], p[2]];
    const q = new THREE.Vector3( p[0], p[1], p[2] ).applyMatrix4( M );
    return [q.x, q.y, q.z];
  } );
  // ( a mirroring matrix turns faces inside out: they're turned back )
  const flip        = !!M && M.determinant() < 0;
  const out: Poly[] = [];
  g.f.forEach( ( f, fi ) => {
    for ( const t of triangulateFace( g, f, faceNormal( g, fi ) ) ) {
      const c = t.map( ( i ) => [...v[i]] as P3 );
      const p = poly( flip ? c.reverse() : c, Math.min( g.m[fi] ?? 0, slots - 1 ), !!g.s[fi] );
      if ( p ) out.push( p );
    }
  } );
  return out;
}

/**
 * Triangles ( as a piece's mesh stores them, already in place ) as polygons.
**/
export function trisPolys( src: SourceTris, slots = Infinity ): Poly[] {
  const out: Poly[] = [];
  for ( let t = 0; t < src.slot.length; t++ ) {
    const c = [0, 1, 2].map( ( k ) => [src.pos[t * 9 + k * 3], src.pos[t * 9 + k * 3 + 1], src.pos[t * 9 + k * 3 + 2]] as P3 );
    const p = poly( c, Math.min( src.slot[t], slots - 1 ), false );
    if ( p ) out.push( p );
  }
  return out;
}

/**
 * Polygons back into an editable mesh.
**/
export function polysToMesh( polys: Poly[] ): Mesh {
  let n = 0;
  for ( const p of polys ) n += p.v.length - 2;
  const src: SourceTris = { pos: new Float32Array( n * 9 ), nrm: new Float32Array( n * 9 ), uv: new Float32Array( n * 6 ), slot: new Int32Array( n ), smooth: new Uint8Array( n ) };
  let t                 = 0;
  for ( const p of polys )
    for ( let i = 1; i + 1 < p.v.length; i++, t++ ) {
      [p.v[0], p.v[i], p.v[i + 1]].forEach( ( c, k ) => {
        src.pos.set( c, t * 9 + k * 3 );
        src.nrm.set( p.n, t * 9 + k * 3 );
      } );
      src.slot[t] = p.slot;
      src.smooth![t] = p.smooth ? 1 : 0;
    }
  return trisToMesh( src );
}

/**
 * The mesh combined with the cutters' polygons ( in its space ).
**/
export function booleanMesh( g: Mesh, cutters: Poly[], op: BoolOp ): Mesh {
  return polysToMesh( boolean( meshPolys( g ), cutters, op ) );
}
