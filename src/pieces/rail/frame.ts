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
 * A rail's point, made to stay on the piece however it's scaled: its top kept where it is on the piece ( the piece's
 * scale carries it ), the rail as thick as it is in metres, not stretched with it. On a piece at its own size, just
 * its point. In the piece's own axes, scaled, not yet turned or moved ( `s`: the piece's scale ).
**/
export function railScaled( s: THREE.Vector3, rail: { radius: number; up?: P3 }, p: P3 ): THREE.Vector3 {
  const u   = new THREE.Vector3( ...( rail.up ?? [0, 1, 0] ) ).normalize(), r = rail.radius;
  const top = new THREE.Vector3( ( p[0] + u.x * r ) * s.x, ( p[1] + u.y * r ) * s.y, ( p[2] + u.z * r ) * s.z );
  return top.sub( new THREE.Vector3( u.x * s.x, u.y * s.y, u.z * s.z ).normalize().multiplyScalar( r ) );
}

/**
 * The piece's scale ( always positive ), as its frame takes it.
**/
export const scaleOf = ( o: CustomObjectEntry ) => frame( o ).s;

/**
 * Where a rail's point is in the 3D view ( see railScaled ).
**/
export function railToView( o: CustomObjectEntry, rail: { radius: number; up?: P3 }, p: P3 ): THREE.Vector3 {
  const f = frame( o ), q = railScaled( f.s, rail, p );
  return new THREE.Vector3( q.x, q.y, -q.z ).applyQuaternion( f.q ).add( f.pos );
}

/**
 * A point in the 3D view → a rail's point there ( railToView's other way ).
**/
export function railFromView( o: CustomObjectEntry, rail: { radius: number; up?: P3 }, w: THREE.Vector3 ): P3 {
  const f   = frame( o ), u = new THREE.Vector3( ...( rail.up ?? [0, 1, 0] ) ).normalize(), r = rail.radius;
  const upW = new THREE.Vector3( u.x * f.s.x, u.y * f.s.y, -u.z * f.s.z ).normalize().applyQuaternion( f.q );
  const top = toPiece( o, w.clone().addScaledVector( upW, r ) );
  return [top[0] - u.x * r, top[1] - u.y * r, top[2] - u.z * r];
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
