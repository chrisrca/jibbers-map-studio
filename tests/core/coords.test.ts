import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { quatToUnityEuler, toThree, toUnity, unityEulerToQuat } from "../../src/core/coords";

describe( "unity <-> three coordinates", () => {
  it( "mirrors Z for positions", () => {
    expect( toUnity( toThree( [1, 2, 3] ) ) ).toEqual( [1, 2, 3] );
    expect( toThree( [1, 2, 3] ).z          ).toBe( -3 );
  } );

  it( "round-trips euler angles", () => {
    for ( const e of [[0, 0, 0], [10, 20, 30], [347.88, 0, 0], [0, 90, 0], [30, 200, 15]] as [number, number, number][] ) {
      const back = quatToUnityEuler( unityEulerToQuat( e ) );
      const q1   = unityEulerToQuat( e ), q2 = unityEulerToQuat( back );
      expect( Math.abs( q1.dot( q2 ) ) ).toBeCloseTo( 1, 6 );
    }
  } );

  it( "unity yaw 90 turns +Z (forward) to +X", () => {
    // In Unity, rotating forward ( 0,0,1 ) by yaw 90 gives ( 1,0,0 ). In three space forward is ( 0,0,-1 ).
    const v = new THREE.Vector3( 0, 0, -1 ).applyQuaternion( unityEulerToQuat( [0, 90, 0] ) );
    expect( v.x ).toBeCloseTo( 1, 6 );
    expect( v.z ).toBeCloseTo( 0, 6 );
  } );

  it( "unity pitch +10 tilts forward downward", () => {
    // Unity: positive X rotation pitches the forward vector down.
    const v = new THREE.Vector3( 0, 0, -1 ).applyQuaternion( unityEulerToQuat( [10, 0, 0] ) );
    expect( v.y ).toBeLessThan( 0 );
  } );
} );
