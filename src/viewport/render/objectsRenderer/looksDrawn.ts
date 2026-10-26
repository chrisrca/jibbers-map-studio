// The game's look on its objects: each object's look asked for, and the objects sharing one drawn instanced.

import * as THREE from "three/webgpu";
import type { ObjectEntry } from "../../../core/types";
import { redraw } from "../../redraw";
import type { ObjectsRenderer } from "./index";
import { LOOK_TO_PLACEHOLDER, lookFor, settingsOf } from "./looks";

// The game's look on its objects.
export class LooksDrawn {
  constructor( private objects: ObjectsRenderer ) {}

  // each object's game look ( by feature and settings )
  lookOf = new Map<string, string>();
  // each look's meshes, once built, drawn as instances: every object wearing it in one draw a mesh ( a map's 23
  // floodlights are one floodlight's draws, not 23 of them ); its objects' placeholders hidden then, still picked
  private lookSets = new Map<string, { template: THREE.Object3D[] | null; meshes: THREE.InstancedMesh[]; capacity: number }>();

  /**
   * The object's game look, asked for ( built once for every object wearing it ).
  **/
  ask( o: ObjectEntry ) {
    const { key, look } = lookFor( o.id, settingsOf( o ) );
    this.lookOf.set( o.uid, key );
    if ( this.lookSets.has( key ) ) return;
    const set: { template: THREE.Object3D[] | null; meshes: THREE.InstancedMesh[]; capacity: number } = { template: null, meshes: [], capacity: 0 };
    this.lookSets.set( key, set );
    const built = look.then( async ( lk ) => {
      if ( !lk ) return;
      const g = await lk.r.buildGroup( lk.object );
      g.updateMatrixWorld( true );
      const meshes: THREE.Object3D[] = [];
      g.traverse( ( x ) => ( x as THREE.Mesh ).isMesh && meshes.push( x ) );
      if ( !meshes.length ) return;
      set.template = meshes;
      this.layout();
    } );
    this.objects.settled = Promise.all( [this.objects.settled, built] );
  }

  /**
   * Every look's instances where its objects are ( a piece is the prefab at half size: twice the object's scale ).
  **/
  layout() {
    redraw();
    const by = new Map<string, THREE.Mesh[]>();
    for ( const o of this.objects.lastObjects ) {
      const key = this.lookOf.get( o.uid ), m = this.objects.objects.get( o.uid );
      if ( !key || !m ) continue;
      const list = by.get( key ) ?? [];
      list.push( m );
      by.set( key, list );
    }
    const at = new THREE.Matrix4(), part = new THREE.Matrix4(), scale = new THREE.Vector3();
    for ( const [key, set] of this.lookSets ) {
      const list = set.template ? by.get( key ) ?? [] : [];
      for ( const m of by.get( key ) ?? [] ) m.visible = !set.template;
      if ( !set.template ) continue;
      if ( list.length > set.capacity ) {
        for ( const im of set.meshes ) {
          this.objects.group.remove( im );
          im.dispose();
        }
        set.capacity = Math.max( 4, 2 ** Math.ceil( Math.log2( list.length ) ) );
        set.meshes   = set.template.map( ( t ) => {
          const src        = t as THREE.Mesh;
          const im         = new THREE.InstancedMesh( src.geometry, src.material, set.capacity );
          im.castShadow    = src.castShadow;
          im.receiveShadow = src.receiveShadow;
          this.objects.group.add( im );
          return im;
        } );
      }
      set.template.forEach( ( t, k ) => {
        const im = set.meshes[k];
        im.count = list.length;
        list.forEach( ( m, i ) => {
          at.compose( m.position, m.quaternion, scale.copy( m.scale ).multiplyScalar( LOOK_TO_PLACEHOLDER ) );
          im.setMatrixAt( i, part.multiplyMatrices( at, t.matrixWorld ) );
        } );
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.visible = list.length > 0;
      } );
    }
  }
}
