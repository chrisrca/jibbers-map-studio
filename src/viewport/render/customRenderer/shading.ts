// The Assets workspace's shading ( Blender's ): Solid's studio light as a matcap, Wireframe's lines, X-ray, and the
// faces' orientation, as materials over a piece's own.

import { frontFacing, select, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { Shading } from "../../../map/store";

// The studio light of Blender's Solid shading, as a matcap: soft grey, lit from the top left, a little fill.
let studio: THREE.DataTexture | null = null;

function studioMatcap() {
  if ( studio ) return studio;
  const n  = 128, px = new Uint8Array( n * n * 4 );
  const L1 = new THREE.Vector3( -0.45, 0.6, 0.66 ).normalize(), L2 = new THREE.Vector3( 0.6, -0.25, 0.76 ).normalize(), v = new THREE.Vector3();
  for ( let y = 0; y < n; y++ )
    for ( let x = 0; x < n; x++ ) {
      const nx = ( x + 0.5 ) / n * 2 - 1, ny = ( y + 0.5 ) / n * 2 - 1, r2 = nx * nx + ny * ny;
      const nz = Math.sqrt( Math.max( 0, 1 - r2 ) );
      v.set( nx, ny, nz );
      const spec = Math.pow( Math.max( 0, v.dot( new THREE.Vector3().addVectors( L1, new THREE.Vector3( 0, 0, 1 ) ).normalize() ) ), 40 ) * 0.12;
      const c    = Math.min( 1, 0.3 + 0.62 * Math.max( 0, v.dot( L1 ) ) + 0.18 * Math.max( 0, v.dot( L2 ) ) + spec );
      px.set( [c * 255, c * 255, c * 255, 255].map( Math.round ), ( y * n + x ) * 4 );
    }
  studio             = new THREE.DataTexture( px, n, n );
  studio.colorSpace  = THREE.SRGBColorSpace;
  studio.needsUpdate = true;
  return studio;
}

const looks = new Map<string, THREE.Material>();

let hiddenMat: THREE.Material | null = null, wireMat: THREE.Material | null = null;

/**
 * ( a mesh that's only there to be picked: Wireframe draws its edges instead )
**/
export const hidden = () => ( hiddenMat ??= new THREE.MeshBasicNodeMaterial( { colorWrite: false, depthWrite: false, side: THREE.DoubleSide } ) );

/**
 * Blender's wire colour ( its theme's, for objects not selected )
**/
export const wireLines = () => ( wireMat ??= new THREE.LineBasicNodeMaterial( { color: 0x000000 } ) );

/**
 * A shading's material ( Blender's ): Solid ( both sides, see-through in X-ray ), Wireframe, or Face Orientation.
**/
export function lookMaterial( shading: Shading, xray: boolean, faces: boolean ) {
  const key = `${shading}|${xray}|${faces}`;
  let m     = looks.get( key );
  if ( m ) return m;
  const see = xray ? { transparent: true, opacity: 0.4, depthWrite: false } : {};
  if ( faces ) {
    const f     = new THREE.MeshMatcapNodeMaterial( { matcap: studioMatcap(), side: THREE.DoubleSide, ...see } );
    // ( the matcap's light on top of the colour, as for Solid )
    f.colorNode = select( frontFacing, vec3( 0.25, 0.4, 0.95 ), vec3( 0.95, 0.22, 0.22 ) );
    m           = f;
  } else if ( shading === "wire" ) m = new THREE.MeshBasicNodeMaterial( { color: 0x0c0c0c, wireframe: true } );
  else m = new THREE.MeshMatcapNodeMaterial( { matcap: studioMatcap(), color: 0xd0d0d0, side: THREE.DoubleSide, ...see } );
  looks.set( key, m );
  return m;
}
