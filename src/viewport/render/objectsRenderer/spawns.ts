// Spawns drawn: a rider-sized marker, its direction and speed, and ( selected ) the path a rider takes from it.

import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toThree, unityEulerToQuat } from "../../../core/coords";
import type { SpawnEntry } from "../../../core/types";
import { RIDER_HEIGHT, type ObjectsRenderer } from "./index";

// The marker's parts, shared by every spawn: a rider-sized body, an arrow's shaft and head ( 1 m long, along +Y ).
// ( made the first time they're needed: index.ts, where the rider's height is, isn't ready when this file is )
let parts: { body: THREE.BufferGeometry; shaft: THREE.BufferGeometry; head: THREE.BufferGeometry } | null = null;
const partsOf = () => ( parts ??= {
  body:  new THREE.CapsuleGeometry( 0.3, RIDER_HEIGHT - 0.6, 4, 12 ).translate( 0, RIDER_HEIGHT / 2, 0 ),
  shaft: new THREE.CylinderGeometry( 0.08, 0.08, 1, 8 ).translate( 0, 0.5, 0 ),
  head:  new THREE.ConeGeometry( 0.25, 0.6, 12 ).translate( 0, 1.2, 0 ),
} );

// The spawns.
export class SpawnsDrawn {
  constructor( private objects: ObjectsRenderer ) {}

  drawn                       = new Map<string, THREE.Group>();
  ridePath: THREE.Line | null = null;
  // ( each marker's arrow as its mesh was made: made again only when that changes )
  private made = new WeakMap<THREE.Mesh, string>();

  /**
   * A spawn's marker: one mesh, body and arrow together ( three draws a spawn were a third of a busy park's game
   * objects' ).
  **/
  make( uid: string ) {
    const g       = new THREE.Group();
    const m       = new THREE.Mesh( partsOf().body, this.objects.mat( 0x38bdf8 ) );
    m.name        = "marker";
    m.userData    = { kind: "spawn", uid };
    g.add( m );
    return g;
  }

  update( g: THREE.Group, s: SpawnEntry, selected: boolean ) {
    g.position.copy( toThree( s.position ) );
    const m       = g.getObjectByName( "marker" ) as THREE.Mesh;
    m.material    = selected ? this.objects.selectMat : this.objects.mat( 0x38bdf8 );
    // the arrow: the way it sets off, as long as it's fast ( or the way it faces, standing )
    const v       = toThree( s.velocity );
    const len     = Math.max( 0.5, v.length() * 0.25 );
    const q       = v.lengthSq() > 1e-6 ? new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), v.normalize() )
      : unityEulerToQuat( s.rotation ).multiply( new THREE.Quaternion().setFromEuler( new THREE.Euler( -Math.PI / 2, 0, 0 ) ) );
    const key     = `${len.toFixed( 4 )}|${q.toArray().map( ( x ) => x.toFixed( 4 ) ).join( "," )}`;
    if ( this.made.get( m ) === key ) return;
    this.made.set( m, key );
    const arrow   = new THREE.Matrix4().compose( new THREE.Vector3( 0, RIDER_HEIGHT * 0.6, 0 ), q, new THREE.Vector3( 1, len, 1 ) );
    const p       = partsOf();
    const merged  = mergeGeometries( [p.body.clone(), p.shaft.clone().applyMatrix4( arrow ), p.head.clone().applyMatrix4( arrow )] );
    if ( m.geometry !== p.body ) m.geometry.dispose();
    m.geometry    = merged ?? p.body;
  }
}
