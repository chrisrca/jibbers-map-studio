// The piece's own coordinates ( a rail's points are in them ) <-> the 3D view's.

import * as THREE from "three/webgpu";
import { toThree, unityEulerToQuat } from "../../core/coords";
import { type CustomObjectEntry, arr3 } from "../../core/types";
import type { P3 } from "./common";

function frame( o: CustomObjectEntry ) {
  return {
    pos: toThree( arr3( o.position ) ),
    q:   unityEulerToQuat( arr3( o.rotation ) ),
    s:   new THREE.Vector3( Math.abs( o.scale.x ) || 1, Math.abs( o.scale.y ) || 1, Math.abs( o.scale.z ) || 1 ),
  };
}

/**
 * A point in the piece's own coordinates → the 3D view ( three's coordinates ).
**/
export function toView( o: CustomObjectEntry, p: P3 ): THREE.Vector3 {
  const f = frame( o );
  return new THREE.Vector3( p[0] * f.s.x, p[1] * f.s.y, -p[2] * f.s.z ).applyQuaternion( f.q ).add( f.pos );
}

/**
 * A point in the 3D view → the piece's own coordinates.
**/
export function toPiece( o: CustomObjectEntry, w: THREE.Vector3 ): P3 {
  const f = frame( o );
  const l = w.clone().sub( f.pos ).applyQuaternion( f.q.clone().invert() );
  return [l.x / f.s.x, l.y / f.s.y, -l.z / f.s.z];
}

/**
 * A direction in the piece's own coordinates → the 3D view ( turned with the piece ).
**/
export function dirToView( o: CustomObjectEntry, d: P3 ): THREE.Vector3 {
  return new THREE.Vector3( d[0], d[1], -d[2] ).applyQuaternion( frame( o ).q ).normalize();
}

/**
 * A direction in the 3D view → the piece's own coordinates.
**/
export function dirToPiece( o: CustomObjectEntry, v: THREE.Vector3 ): P3 {
  const l = v.clone().applyQuaternion( frame( o ).q.invert() ).normalize();
  return [l.x, l.y, -l.z];
}
