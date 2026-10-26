// Spawns drawn: a rider-sized marker, its direction and speed, and ( selected ) the path a rider takes from it.

import * as THREE from "three/webgpu";
import { toThree, unityEulerToQuat } from "../../../core/coords";
import type { SpawnEntry } from "../../../core/types";
import { RIDER_HEIGHT, type ObjectsRenderer } from "./index";

// The spawns.
export class SpawnsDrawn {
  constructor( private objects: ObjectsRenderer ) {}

  drawn                       = new Map<string, THREE.Group>();
  ridePath: THREE.Line | null = null;

  make( uid: string ) {
    const g          = new THREE.Group();
    const body       = new THREE.Mesh( new THREE.CapsuleGeometry( 0.3, RIDER_HEIGHT - 0.6, 4, 12 ), this.objects.mat( 0x38bdf8 ) );
    body.position.y  = RIDER_HEIGHT / 2;
    body.userData    = { kind: "spawn", uid };
    const arrow      = new THREE.Group();
    arrow.name       = "arrow";
    const shaft      = new THREE.Mesh( new THREE.CylinderGeometry( 0.08, 0.08, 1, 8 ), this.objects.mat( 0x38bdf8 ) );
    shaft.position.y = 0.5;
    shaft.userData   = { kind: "spawn", uid };
    const head       = new THREE.Mesh( new THREE.ConeGeometry( 0.25, 0.6, 12 ), this.objects.mat( 0x38bdf8 ) );
    head.position.y  = 1.2;
    head.userData    = { kind: "spawn", uid };
    arrow.add( shaft, head );
    g.add( body, arrow );
    return g;
  }

  update( g: THREE.Group, s: SpawnEntry, selected: boolean ) {
    g.position.copy( toThree( s.position ) );
    const m = selected ? this.objects.selectMat : this.objects.mat( 0x38bdf8 );
    g.traverse( ( o ) => {
      if ( ( o as THREE.Mesh ).isMesh ) ( o as THREE.Mesh ).material = m;
    } );
    const arrow = g.getObjectByName( "arrow" )!;
    const v     = toThree( s.velocity );
    const len   = Math.max( 0.5, v.length() * 0.25 );
    arrow.position.set( 0, RIDER_HEIGHT * 0.6, 0 );
    arrow.scale.set( 1, len, 1 );
    if ( v.lengthSq() > 1e-6 ) arrow.quaternion.setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), v.normalize() );
    else arrow.quaternion.copy( unityEulerToQuat( s.rotation ) ).multiply( new THREE.Quaternion().setFromEuler( new THREE.Euler( -Math.PI / 2, 0, 0 ) ) );
  }
}
