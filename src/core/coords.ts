// Unity ( the game, .jbrmap, project.json ) is left-handed: +X right, +Y up, +Z forward.
// The studio viewport ( three.js ) is right-handed. We mirror Z: unity ( x, y, z ) <-> three ( x, y, -z ).
//
// Rotations: Unity euler angles ( degrees ) apply Z, then X, then Y ( q = qY * qX * qZ ). Mirroring the
// Z axis maps a Unity quaternion ( x, y, z, w ) to three ( -x, -y, z, w ).

import * as THREE from "three";

export type V3 = [number, number, number];

export const toThree = ( u: V3 ): THREE.Vector3 => new THREE.Vector3( u[0], u[1], -u[2] );
export const toUnity = ( t: THREE.Vector3 ): V3 => [t.x, t.y, -t.z];

const DEG = Math.PI / 180;

export function unityEulerToQuat( e: V3 ): THREE.Quaternion {
  const qx = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), e[0] * DEG );
  const qy = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), e[1] * DEG );
  const qz = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 0, 1 ), e[2] * DEG );
  // These axis-angle quats are in Unity's ( left-handed ) frame; composition is frame-agnostic.
  const u  = qy.multiply( qx ).multiply( qz );
  return new THREE.Quaternion( -u.x, -u.y, u.z, u.w );
}

/**
 * Inverse of {@link unityEulerToQuat}; returns Unity euler degrees in [0, 360).
**/
export function quatToUnityEuler( q: THREE.Quaternion ): V3 {
  const u  = new THREE.Quaternion( -q.x, -q.y, q.z, q.w );
  // Unity decomposition for ZXY order ( q = qY * qX * qZ ), as in Quaternion.eulerAngles.
  const m  = new THREE.Matrix4().makeRotationFromQuaternion( u ).elements;
  // column-major: m[col*4+row]
  const r  = ( row: number, col: number ) => m[col * 4 + row];
  const sx = -r( 1, 2 );
  let x: number, y: number, z: number;
  if ( Math.abs( sx ) < 0.99999 ) {
    x = Math.asin( THREE.MathUtils.clamp( sx, -1, 1 ) );
    y = Math.atan2( r( 0, 2 ), r( 2, 2 ) );
    z = Math.atan2( r( 1, 0 ), r( 1, 1 ) );
  } else {
    x = ( sx > 0 ? 1 : -1 ) * Math.PI / 2;
    y = Math.atan2( -r( 2, 0 ), r( 0, 0 ) );
    z = 0;
  }
  const wrap = ( a: number ) => {
    const d = ( a / DEG ) % 360;
    const v = d < 0 ? d + 360 : d;
    return Math.abs( v - 360 ) < 1e-4 ? 0 : Math.round( v * 1e4 ) / 1e4;
  };
  return [wrap( x ), wrap( y ), wrap( z )];
}

export const clamp = ( v: number, lo: number, hi: number ) => ( v < lo ? lo : v > hi ? hi : v );
