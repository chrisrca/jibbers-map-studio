// The Collider tool's strokes: the colliders a stroke along a piece makes, and erasing them ( pieces/brushColliders.ts ).

import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { arr3, type CustomCollider } from "../../src/core/types";
import { BRUSH_MARK, collidersAsRail, eraseNear, isBrushCollider, railAsColliders, strokeColliders, type StrokePoint } from "../../src/pieces/brushColliders";
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

describe( "a colliders-only jib made solid and back", () => {
  const xyz = ( x: number, y: number, z: number ) => ( { x, y, z } );
  for ( const [name, at] of [
    ["where it was made", { position: xyz( 10, 2, -4 ), rotation: xyz( 0, 0, 0 ), scale: xyz( 1, 1, 1 ) }],
    ["moved, turned and sized since", { position: xyz( -3, 7, 12 ), rotation: xyz( 0, 35, 0 ), scale: xyz( 2, 2, 2 ) }],
  ] as const ) {
    it( `its rail laid as colliders along its line, and the same rail back from them ( ${name} )`, () => {
      const rail = { points: [[0, 0, 0], [0, 0.4, 2], [0.5, 0.6, 4]] as [number, number, number][], radius: 0.1 };
      const laid = railAsColliders( rail, at, "Generic" );
      expect( laid.length ).toBe( 2 );
      expect( laid.every( ( c ) => isBrushCollider( c ) && c.surface_type === "Generic" && c.shape === "Capsule" ) ).toBe( true );
      const back = collidersAsRail( laid, at )!;
      expect( back.points.length ).toBe( 3 );
      back.points.forEach( ( p, i ) => p.forEach( ( v, k ) => expect( v ).toBeCloseTo( rail.points[i][k], 4 ) ) );
      expect( back.radius ).toBeCloseTo( 0.1, 6 );
      expect( back.box ).toBeUndefined();
    } );
  }
  it( "a box rail as boxes, and a box rail back", () => {
    const at   = { position: xyz( 0, 0, 0 ), rotation: xyz( 0, 0, 0 ), scale: xyz( 1, 1, 1 ) };
    const laid = railAsColliders( { points: [[0, 0, 0], [0, 0, 2]], radius: 0.2, box: [0.2, 0.2] }, at, "Snow" );
    expect( laid.map( ( c ) => c.shape ) ).toEqual( ["Box"] );
    expect( collidersAsRail( laid, at )!.box ).toEqual( [0.2, 0.2] );
  } );
} );
