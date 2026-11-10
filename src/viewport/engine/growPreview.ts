// New ground previewed before it's added ( Map Size ): plain meshes, so adjusting it never rebuilds the terrain.

import { color, positionWorld, texture } from "three/tsl";
import * as THREE from "three/webgpu";
import { type GrowPreview } from "../../terrain/mapSize";
import { withLamps } from "../render/lamps";
import { gameTex, snowLook, snowStandIn } from "../render/terrainRenderer/look";

export class GrowPreviewMeshes {
  readonly group   = new THREE.Group();
  // ( the ground's own snow, a shade darker and cooler than the map's, so it reads as ground yet stands out from it;
  // made again once the game's snow has come in )
  private material: THREE.MeshStandardNodeMaterial | null = null;
  private madeWith: THREE.Texture | null                   = null;

  private look() {
    const snow = gameTex.snow ?? snowStandIn;
    if ( this.material && this.madeWith === snow ) return this.material;
    this.material?.dispose();
    const m     = withLamps( new THREE.MeshStandardNodeMaterial( { roughness: 0.92, side: THREE.DoubleSide } ) );
    m.colorNode = texture( snow, positionWorld.xz.div( 33 ) ).rgb.mul( snowLook.baseColor ).mul( color( 0.7, 0.75, 0.84 ) );
    this.material = m;
    this.madeWith = snow;
    return m;
  }

  show( p: GrowPreview | null ) {
    for ( const m of this.group.children as THREE.Mesh[] ) m.geometry.dispose();
    this.group.clear();
    if ( !p ) return;
    const material = this.look();
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
      const mesh         = new THREE.Mesh( g, material );
      mesh.castShadow    = true;
      mesh.receiveShadow = true;
      this.group.add( mesh );
    }
  }
}
