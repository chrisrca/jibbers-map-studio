// The Collider tool's strokes: the colliders a stroke along a piece makes, and erasing them ( pieces/brushColliders.ts ).

import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { arr3, type CustomCollider } from "../../src/core/types";
import { BRUSH_MARK, eraseNear, isBrushCollider, strokeColliders, type StrokePoint } from "../../src/pieces/brushColliders";
import { RAIL_MARK } from "../../src/pieces/rail";

// A collider's own axis `a` in the map ( Unity's Euler: Y, then X, then Z, in Unity's own frame ).
function axisOf( c: CustomCollider, a: THREE.Vector3 ) {
  const e  = arr3( c.local_rotation ).map( ( d ) => ( d * Math.PI ) / 180 );
  const qx = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), e[0] );
  const qy = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), e[1] );
  const qz = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 0, 1 ), e[2] );
  return a.clone().applyQuaternion( qy.multiply( qx ).multiply( qz ) );
}
const flat = ( xs: number[], y = 1 ): StrokePoint[] => xs.map( ( x ) => ( { p: [x, y, 0], n: [0, 1, 0] } ) );

describe( "the Collider tool's strokes", () => {
  it( "a stroke along a flat top: a box from each point to the next, its top on the surface, its length along the stroke", () => {
    const cs = strokeColliders( flat( [0, 0.5, 1] ), 0.1, "Box", "Generic" );
    expect( cs ).toHaveLength( 2 );
    for ( const c of cs ) {
      expect( c.shape ).toBe( "Box" );
      expect( c.mesh_ref ).toBe( BRUSH_MARK );
      expect( c.local_position.y ).toBeCloseTo( 0.9, 5 );
      expect( c.size.x ).toBeCloseTo( 0.2, 5 );
      expect( c.size.z ).toBeCloseTo( 0.2, 5 );
      expect( c.size.y ).toBeGreaterThanOrEqual( 0.5 );
      // its Y along the stroke ( x ), its Z up
      expect( Math.abs( axisOf( c, new THREE.Vector3( 0, 1, 0 ) ).x ) ).toBeCloseTo( 1, 4 );
      expect( axisOf( c, new THREE.Vector3( 0, 0, 1 ) ).y ).toBeCloseTo( 1, 4 );
    }
    expect( cs[0].local_position.x ).toBeCloseTo( 0.25, 5 );
  } );

  it( "up a wall: sunk into the wall, standing up it", () => {
    const pts: StrokePoint[] = [{ p: [2, 0, 0], n: [-1, 0, 0] }, { p: [2, 1, 0], n: [-1, 0, 0] }];
    const [c] = strokeColliders( pts, 0.2, "Capsule", "Jib" );
    expect( c.shape ).toBe( "Capsule" );
    expect( c.surface_type ).toBe( "Jib" );
    expect( c.radius ).toBeCloseTo( 0.2, 5 );
    expect( c.local_position.x ).toBeCloseTo( 2.2, 5 );
    expect( Math.abs( axisOf( c, new THREE.Vector3( 0, 1, 0 ) ).y ) ).toBeCloseTo( 1, 4 );
  } );

  it( "a click: one collider there, as wide as long", () => {
    const [c] = strokeColliders( flat( [3] ), 0.25, "Box", "Generic" );
    expect( c.size.y ).toBeCloseTo( 0.5, 5 );
    expect( c.local_position.x ).toBeCloseTo( 3, 5 );
  } );

  it( "erasing takes only drawn colliders near the brush", () => {
    const drawn = strokeColliders( flat( [0, 0.5, 1, 1.5, 2] ), 0.1, "Box", "Generic" );
    const rail  = { ...drawn[0], mesh_ref: RAIL_MARK };
    const left  = eraseNear( [rail, ...drawn], [0.25, 1, 0], 0.2 );
    expect( left ).toContain( rail );
    expect( left.filter( isBrushCollider ).length ).toBeLessThan( drawn.length );
    expect( left.filter( isBrushCollider ).every( ( c ) => c.local_position.x > 0.4 ) ).toBe( true );
  } );
} );
