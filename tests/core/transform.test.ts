import { describe, expect, it } from "vitest";
import { deltaBetween, transformCustom } from "../../src/core/transform";
import type { CustomObjectEntry } from "../../src/core/types";

const P = ( x: number, y: number, z: number ) => ( { x, y, z } );

function obj(): CustomObjectEntry {
  return {
    uid:                      "a",   surface_type:     "Jib", can_stabilize:     true, can_rotate:         true, can_magnetize: true, intended_up_method: 0,
    disable_distance_culling: false, timed_visibility: false, visible_from_hour: 19,   visible_until_hour: 6,
    position:   P( 10, 0, 0 ), rotation: P( 0, 0, 0 ), scale: P( 1, 1, 1 ),
    parts:      [{ mesh: "m", local_position: P( 12, 1, 0 ), local_rotation: P( 0, 0, 0 ), local_scale: P( -1, 1, 1 ), materials: [], lod_group_index: -1, lod_index: 0 }],
    colliders:  [{ shape: "Box", surface_type: "Jib", local_position: P( 12, 1, 0 ), local_rotation: P( 0, 0, 0 ), local_scale: P( 1, 1, 1 ), center: P( 0, 0, 0 ), size: P( 1, 1, 1 ), radius: 0.5, height: 1, direction: 1, mesh_ref: "" }],
    lod_groups: [],
    lights:     [],
  };
}

const close = ( a: { x: number; y: number; z: number }, b: [number, number, number] ) => {
  expect( a.x ).toBeCloseTo( b[0], 4 );
  expect( a.y ).toBeCloseTo( b[1], 4 );
  expect( a.z ).toBeCloseTo( b[2], 4 );
};

describe( "transformCustom", () => {
  it( "moves parts and colliders with the root", () => {
    const o = obj();
    const d = deltaBetween( { pos: [10, 0, 0], rot: [0, 0, 0], scl: [1, 1, 1] }, { pos: [10, 5, 3], rot: [0, 0, 0], scl: [1, 1, 1] } );
    const r = transformCustom( o, d );
    close( r.position,                    [10, 5, 3] );
    close( r.parts[0].local_position,     [12, 6, 3] );
    close( r.colliders[0].local_position, [12, 6, 3] );
  } );

  it( "rotates parts around the root (Unity Y rotation, left-handed)", () => {
    const o = obj();
    const d = deltaBetween( { pos: [10, 0, 0], rot: [0, 0, 0], scl: [1, 1, 1] }, { pos: [10, 0, 0], rot: [0, 90, 0], scl: [1, 1, 1] } );
    const r = transformCustom( o, d );
    // in Unity, +90° about Y turns +X into -Z
    close( r.parts[0].local_position, [10, 1, -2] );
    expect( r.rotation.y ).toBeCloseTo( 90, 3 );
  } );

  it( "keeps a mirrored part mirrored but colliders positive", () => {
    const o = obj();
    const d = deltaBetween( { pos: [10, 0, 0], rot: [0, 0, 0], scl: [1, 1, 1] }, { pos: [10, 0, 0], rot: [0, 0, 0], scl: [2, 2, 2] } );
    const r = transformCustom( o, d );
    const s = r.parts[0].local_scale;
    expect( s.x * s.y * s.z ).toBeLessThan( 0 ); // still mirrored
    expect( Math.abs( s.x ) ).toBeCloseTo( 2, 4 );
    close( r.colliders[0].local_scale, [2, 2, 2] );
    close( r.parts[0].local_position, [14, 2, 0] );
  } );
} );
