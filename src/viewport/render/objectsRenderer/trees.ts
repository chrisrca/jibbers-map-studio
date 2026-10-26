// The game's own trees in a map ( by their placeholder ), each kind drawn instanced.

import * as THREE from "three/webgpu";
import { toThree, unityEulerToQuat } from "../../../core/coords";
import { withLamps } from "../lamps";
import type { ObjectsRenderer, TreeGroup } from "./index";
import { LOOK_TO_PLACEHOLDER, PLACEHOLDER_TO_GAME, plainLook } from "./looks";

// The game's trees.
export class TreesDrawn {
  constructor( private objects: ObjectsRenderer ) {}

  private group    = new THREE.Group();
  private material = withLamps( new THREE.MeshStandardNodeMaterial( { color: 0x3d6b45, roughness: 0.9 } ) );
  private key      = "";

  /**
   * The game's trees in the map's chunks, drawn in the game's look ( the placeholder's model until that's come, or
   * where there's none ): one instanced mesh a group and mesh; not pickable, they come with the map.
  **/
  sync( groups: TreeGroup[] ) {
    const key = groups.map( ( g ) => `${g.id}:${g.position}:${g.instances.length}` ).join( "|" );
    if ( key === this.key ) return;
    this.key = key;
    this.group.clear();
    if ( !this.group.parent ) this.objects.group.add( this.group );
    for ( const g of groups ) {
      const b = Uint8Array.from( g.instances as ArrayLike<number> );
      const n = Math.floor( b.length / 28 );
      if ( !n ) continue;
      const dv                     = new DataView( b.buffer );
      // each tree's place, turn and size ( the placeholder's model: twice the game's )
      const where: THREE.Matrix4[] = [];
      const q                      = new THREE.Quaternion(), s = new THREE.Vector3();
      for ( let k = 0; k < n; k++ ) {
        const f  = ( i: number ) => dv.getFloat32( k * 28 + i * 4, true );
        const at = toThree( [g.position[0] + f( 0 ) * g.size[0], g.position[1] + f( 1 ) * g.size[1], g.position[2] + f( 2 ) * g.size[2]] );
        q.copy( unityEulerToQuat( [0, ( f( 5 ) * 180 ) / Math.PI, 0] ) );
        s.set( f( 3 ), f( 4 ), f( 3 ) ).multiplyScalar( PLACEHOLDER_TO_GAME );
        where.push( new THREE.Matrix4().compose( at, q, s ) );
      }
      const put = ( geo: THREE.BufferGeometry, mat: THREE.Material, inPiece: THREE.Matrix4 | null ) => {
        const mesh = new THREE.InstancedMesh( geo, mat, n ), m = new THREE.Matrix4();
        where.forEach( ( w, k ) => mesh.setMatrixAt( k, inPiece ? m.multiplyMatrices( w, inPiece ) : w ) );
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = true;
        this.group.add( mesh );
        return mesh;
      };
      let placeholder: THREE.InstancedMesh | null = null, dressed = false;
      this.objects.lib.geometry( g.id ).then( ( geo ) => {
        if ( geo && this.key === key && !dressed ) placeholder = put( geo, this.material, null );
      } );
      // ( a look piece is the game's prefab at half size, the placeholder's model at full: twice as big again )
      const twice = new THREE.Matrix4().makeScale( LOOK_TO_PLACEHOLDER, LOOK_TO_PLACEHOLDER, LOOK_TO_PLACEHOLDER );
      plainLook( g.id ).then( ( tpl ) => {
        if ( !tpl || this.key !== key ) return;
        dressed = true;
        for ( const t of tpl ) put( t.geometry, t.material as THREE.Material, new THREE.Matrix4().multiplyMatrices( twice, t.matrixWorld ) );
        if ( placeholder ) {
          this.group.remove( placeholder );
          placeholder.dispose();
        }
      } );
    }
  }
}
