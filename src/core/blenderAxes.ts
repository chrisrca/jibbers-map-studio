// Blender's axes for what the editor shows ( right-handed, Z up ), the game's ( Unity's: left-handed, Y up ) for what's
// stored and exported. Blender's X is Unity's X, its Y is Unity's Z ( into the scene ), its Z is Unity's Y ( up ) — as
// a model brought across between them. In three's space ( the viewport's ) Blender's axes are ( 1,0,0 ), ( 0,0,-1 ) and
// ( 0,1,0 ).

import * as THREE from "three";
import { quatToUnityEuler, unityEulerToQuat, type V3 } from "./coords";

// Blender's X, Y and Z in three's space.
export const BL_AXES = [new THREE.Vector3( 1, 0, 0 ), new THREE.Vector3( 0, 0, -1 ), new THREE.Vector3( 0, 1, 0 )] as const;

/**
 * A position, direction or scale: Unity's ( x, y, z ) as Blender's, and back ( the same swap ).
**/
export const toBlender   = ( v: V3 ): V3 => [v[0], v[2], v[1]];
export const fromBlender = ( v: V3 ): V3 => [v[0], v[2], v[1]];

// three's space to Blender's: a quarter turn about X ( three's -Z becomes Blender's Y, three's Y its Z ).
const TO_BL   = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), Math.PI / 2 );
const FROM_BL = TO_BL.clone().invert();
const DEG     = 180 / Math.PI;

/**
 * Unity's rotation ( degrees, Z then X then Y ) as Blender's XYZ Euler ( degrees ).
**/
export function rotToBlender( e: V3 ): V3 {
  const q = TO_BL.clone().multiply( unityEulerToQuat( e ) ).multiply( FROM_BL );
  // ( Blender's XYZ turns about X first, then Y, then Z: three's "ZYX" )
  const r = new THREE.Euler().setFromQuaternion( q, "ZYX" );
  return [r.x * DEG, r.y * DEG, r.z * DEG].map( ( v ) => ( Math.abs( v ) < 5e-5 ? 0 : v ) ) as V3;
}

/**
 * Blender's XYZ Euler ( degrees ) as Unity's rotation.
**/
export function rotFromBlender( b: V3 ): V3 {
  const q = new THREE.Quaternion().setFromEuler( new THREE.Euler( b[0] / DEG, b[1] / DEG, b[2] / DEG, "ZYX" ) );
  return quatToUnityEuler( FROM_BL.clone().multiply( q ).multiply( TO_BL ) );
}
