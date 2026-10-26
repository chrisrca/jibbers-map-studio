// World-space transform edits shared by the gizmo and the Properties panel. Everything here takes Unity-space
// TRS values and a delta matrix in three.js space ( see coords.ts for the Z mirror between the two ).

import * as THREE from "three/webgpu";
import { quatToUnityEuler, toThree, toUnity, unityEulerToQuat, type V3 } from "./coords";
import { arr3, safeScale, xyz, type CustomObjectEntry } from "./types";

export const composeUnity = ( pos: V3, rot: V3, scl: V3 ) =>
  new THREE.Matrix4().compose( toThree( pos ), unityEulerToQuat( rot ), new THREE.Vector3( ...scl ) );

/**
 * `delta` applied to a Unity-space TRS. `clamp` keeps scale positive ( the game's physics needs that ).
**/
export function applyToTRS( delta: THREE.Matrix4, pos: V3, rot: V3, scl: V3, clamp = true ) {
  const r = delta.clone().multiply( composeUnity( pos, rot, scl ) );
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  r.decompose( p, q, s );
  const scale: V3 = clamp ? safeScale( [s.x, s.y, s.z] ) : [s.x, s.y, s.z];
  return { position: toUnity( p ), rotation: quatToUnityEuler( q ), scale };
}

/**
 * Moves a custom object: its root and every world-space part, collider and light ( LOD groups are root-relative ).
**/
export function transformCustom( o: CustomObjectEntry, delta: THREE.Matrix4 ): CustomObjectEntry {
  const root  = applyToTRS( delta, arr3( o.position ), arr3( o.rotation ), arr3( o.scale ) );
  const local = <T extends { local_position: { x: number; y: number; z: number }; local_rotation: { x: number; y: number; z: number } }>(
    x: T, scl: V3 | null, clamp: boolean,
  ) => {
    const r = applyToTRS( delta, arr3( x.local_position ), arr3( x.local_rotation ), scl ?? [1, 1, 1], clamp );
    return { ...x, local_position: xyz( r.position ), local_rotation: xyz( r.rotation ), ...( scl ? { local_scale: xyz( r.scale ) } : {} ) };
  };
  return {
    ...o,
    position:  xyz( root.position ),
    rotation:  xyz( root.rotation ),
    scale:     xyz( root.scale    ),
    // parts may legitimately be mirrored in imported maps; colliders must stay positive for the game's physics
    parts:     o.parts.map( ( p ) => local( p, arr3( p.local_scale ), false ) ),
    colliders: o.colliders.map( ( c ) => local( c, arr3( c.local_scale ), true ) ),
    lights:    o.lights.map( ( l ) => local( l, null, false ) ),
    ...( o.rail?.body ? { rail: { ...o.rail, body: o.rail.body.map( ( c ) => local( c, arr3( c.local_scale ), true ) ) } } : {} ),
  };
}

/**
 * The delta that takes a root TRS `from` to `to` ( for typed edits in the Properties panel ).
**/
export function deltaBetween( from: { pos: V3; rot: V3; scl: V3 }, to: { pos: V3; rot: V3; scl: V3 } ) {
  return composeUnity( to.pos, to.rot, to.scl ).multiply( composeUnity( from.pos, from.rot, from.scl ).invert() );
}

/**
 * A piece's own space to the view's ( its placement as a matrix, three.js space ).
**/
export const pieceMatrix = ( o: CustomObjectEntry ) => composeUnity( arr3( o.position ), arr3( o.rotation ), arr3( o.scale ) );
