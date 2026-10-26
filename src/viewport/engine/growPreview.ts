// New ground previewed before it's added ( Map Size ): plain meshes, so adjusting it never rebuilds the terrain.

import * as THREE from "three/webgpu";
import { type GrowPreview } from "../../terrain/mapSize";

export class GrowPreviewMeshes {
  readonly group   = new THREE.Group();
  private material = new THREE.MeshStandardNodeMaterial( { color: 0xcfe0f0, roughness: 0.95 } );

  show( p: GrowPreview | null ) {
    for ( const m of this.group.children as THREE.Mesh[] ) m.geometry.dispose();
    this.group.clear();
    if ( !p ) return;
    for ( const c of p.chunks ) {
      const r   = c.res, step = c.size[0] / ( r - 1 );
      const pos = new Float32Array( r * r * 3 );
      for ( let j = 0; j < r; j++ )
        for ( let i = 0; i < r; i++ ) {
          const k    = ( j * r + i ) * 3;
          pos[k]     = c.position[0] + i * step;
          pos[k + 1] = c.position[1] + c.heights[j * r + i];
          pos[k + 2] = -( c.position[2] + j * step ); // Unity z -> three -z
        }
      const idx = new Uint32Array( ( r - 1 ) * ( r - 1 ) * 6 );
      let n     = 0;
      for ( let j = 0; j < r - 1; j++ )
        for ( let i = 0; i < r - 1; i++ ) {
          const a = j * r + i, b = a + 1, d = a + r, e = d + 1;
          idx.set( [a, b, d, b, e, d], n );
          n += 6;
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute( "position", new THREE.BufferAttribute( pos, 3 ) );
      g.setIndex( new THREE.BufferAttribute( idx, 1 ) );
      g.computeVertexNormals();
      const mesh         = new THREE.Mesh( g, this.material );
      mesh.material.side = THREE.DoubleSide;
      this.group.add( mesh );
    }
  }
}
