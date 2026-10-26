// Pieces' meshes as the view draws them ( from the library's packed buffers ), and a piece's surface in the world.

import * as THREE from "three/webgpu";
import { surfacePoints } from "../../../pieces/rail";

/**
 * Points over a piece's surfaces ( about `budget` of them ) in map ( three ) coordinates, as placed.
**/
export function worldSurface( group: THREE.Group, budget: number ): Float32Array {
  group.updateMatrixWorld( true );
  const meshes = group.children.filter( ( c ): c is THREE.Mesh => c instanceof THREE.Mesh );
  // spread over the area as drawn ( the parts' scales included )
  const area   = meshes.reduce( ( sum, m ) => {
    const pos = m.geometry.getAttribute( "position" ), idx = m.geometry.getIndex();
    const s   = new THREE.Vector3().setFromMatrixScale( m.matrix );
    const k   = Math.max( s.x * s.y, s.y * s.z, s.x * s.z );
    const tri = new THREE.Triangle(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const n   = idx ? idx.count / 3 : pos.count / 3;
    let t     = 0;
    for ( let i = 0; i < n; i++ ) {
      const [ia, ib, ic] = idx ? [idx.getX( i * 3 ), idx.getX( i * 3 + 1 ), idx.getX( i * 3 + 2 )] : [i * 3, i * 3 + 1, i * 3 + 2];
      t                 += tri.set( a.fromBufferAttribute( pos, ia ), b.fromBufferAttribute( pos, ib ), c.fromBufferAttribute( pos, ic ) ).getArea();
    }
    return sum + t * k;
  }, 0 );
  const out: number[] = [];
  const v             = new THREE.Vector3();
  for ( const m of meshes ) {
    const s     = new THREE.Vector3().setFromMatrixScale( m.matrix );
    const k     = Math.max( s.x * s.y, s.y * s.z, s.x * s.z );
    const pos   = m.geometry.getAttribute( "position" ), idx = m.geometry.getIndex();
    const local = surfacePoints( pos.array as Float32Array, idx ? ( idx.array as Uint32Array ) : null, ( budget / Math.max( area, 1e-6 ) ) * k );
    for ( let i = 0; i < local.length; i += 3 ) {
      v.set( local[i], local[i + 1], local[i + 2] ).applyMatrix4( m.matrix );
      out.push( v.x, v.y, v.z );
    }
  }
  return new Float32Array( out );
}

/**
 * Cache layout: positions f32x3, normals f32x3, uvs f32x2 per vertex, then u32 indices per submesh.
**/
export function buildGeometry( buf: ArrayBuffer, n: number, hasNormals: boolean, submeshes: number[] ) {
  const pos = new Float32Array( buf, 0,      n * 3 ).slice();
  const nrm = new Float32Array( buf, n * 12, n * 3 ).slice();
  const uv  = new Float32Array( buf, n * 24, n * 2 ).slice();
  // Unity is left-handed: mirror Z, and reverse the winding so faces still point outwards.
  for ( let i = 2; i < n * 3; i += 3 ) {
    pos[i] = -pos[i];
    nrm[i] = -nrm[i];
  }
  const total = submeshes.reduce( ( a, b ) => a + b, 0 );
  const idx   = new Uint32Array( buf, n * 32, total ).slice();
  for ( let i = 0; i + 2 < total; i += 3 ) {
    const t    = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute( "position", new THREE.BufferAttribute( pos, 3 ) );
  geo.setAttribute( "normal",   new THREE.BufferAttribute( nrm, 3 ) );
  geo.setAttribute( "uv",       new THREE.BufferAttribute( uv,  2 ) );
  geo.setIndex( new THREE.BufferAttribute( idx, 1 ) );
  let start = 0;
  submeshes.forEach( ( count, i ) => {
    geo.addGroup( start, count, i );
    start += count;
  } );
  if ( !hasNormals ) geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
