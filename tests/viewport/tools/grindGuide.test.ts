import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { grindGuide } from "../../../src/viewport/tools/grindGuide";
import { withRail } from "../../../src/pieces/rail";
import type { CustomObjectEntry } from "../../../src/core/types";

const piece = (): CustomObjectEntry => ( {
  uid:                      "p",   surface_type:     "Jib", can_stabilize:     true, can_rotate:         true, can_magnetize: true, intended_up_method: 0,
  disable_distance_culling: false, timed_visibility: false, visible_from_hour: 19,   visible_until_hour: 6,
  position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  parts:    [], lights: [], lod_groups: [], colliders: [],
} );

describe( "the grind line's arrow", () => {
  it( "sits halfway along the whole line, all its segments together", () => {
    // 2 m one way, then 1 m round the corner: halfway is 1.5 m along, on the longer stretch
    const o = withRail( piece(), { points: [[0, 0, 0], [2, 0, 0], [2, 0, 1]], radius: 0.05 } );
    const g = grindGuide( o, new Float32Array( 0 ) )!;
    expect( g.ok                ).toBe( true );
    expect( g.lines.length      ).toBeGreaterThan( 2   );
    expect( g.mid.x             ).toBeGreaterThan( 1.3 );
    expect( g.mid.x             ).toBeLessThan( 1.7  );
    expect( Math.abs( g.mid.z ) ).toBeLessThan( 0.15 );
    expect( g.up.y              ).toBeGreaterThan( 0.9 );
  } );

  it( "is in the middle of a straight rail", () => {
    const g = grindGuide( withRail( piece(), { points: [[-3, 0, 0], [5, 0, 0]], radius: 0.05 } ), new Float32Array( 0 ) )!;
    expect( g.mid.x ).toBeCloseTo( 1, 1 );
  } );
} );

describe( "a rail's way up", () => {
  it( "is straight up unless it's turned", () => {
    const g = grindGuide( withRail( piece(), { points: [[-2, 0, 0], [2, 0, 0]], radius: 0.05 } ), new Float32Array( 0 ) )!;
    expect( g.up.y ).toBeCloseTo( 1, 3 );
  } );

  it( "is turned with the rail's up, all along it", () => {
    // turned onto its side ( Unity's +Z, three's -Z )
    const side = grindGuide( withRail( piece(), { points: [[-2, 0, 0], [0, 0.2, 0], [2, 0, 0]], radius: 0.05, up: [0, 0, 1] } ), new Float32Array( 0 ) )!;
    expect( side.up.z ).toBeCloseTo( -1, 2 );
    for ( const s of side.shells ) expect( new THREE.Vector3( 0, 0, -1 ).applyQuaternion( s.q ).z ).toBeLessThan( -0.95 );
  } );

  it( "is drawn as the rail's capsules, as thick as the rail", () => {
    const g = grindGuide( withRail( piece(), { points: [[-2, 0, 0], [2, 0, 0]], radius: 0.05 } ), new Float32Array( 0 ) )!;
    expect( g.shells.length ).toBeGreaterThan( 0 );
    for ( const s of g.shells ) expect( s.radius ).toBeCloseTo( 0.05 + 0.012, 4 );
    const ends = g.shells.flatMap( ( s ) => [-1, 1].map( ( k ) => s.centre.x + k * ( s.length / 2 + s.radius ) ) );
    expect( Math.min( ...ends ) ).toBeCloseTo( -2, 2 );
    expect( Math.max( ...ends ) ).toBeCloseTo( 2,  2 );
  } );
} );

describe( "the grind line's colour", () => {
  it( "stays green on an arch, steep ends and all", () => {
    // a rainbow: half a circle, 2 m across, its ends running straight up
    const points: [number, number, number][] = [];
    for ( let i = 0; i <= 12; i++ ) points.push( [-Math.cos( ( i / 12 ) * Math.PI ), Math.sin( ( i / 12 ) * Math.PI ), 0] );
    const g = grindGuide( withRail( piece(), { points, radius: 0.05 } ), new Float32Array( 0 ) )!;
    expect( g.problem ).toBe( null );
  } );
} );

describe( "Map-Tools 0.5's per-collider methods", () => {
  // a jib built from one box, 4 m along its X
  const box = ( method: number ): CustomObjectEntry => ( {
    ...piece(),
    intended_up_method: method,
    colliders: [{
      shape:  "Box", surface_type: "Jib", local_position: { x: 0, y: 0, z: 0 }, local_rotation: { x: 0, y: 0, z: 0 }, local_scale: { x: 1, y: 1, z: 1 },
      center: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 0.3, z: 0.3 }, radius: 0, height: 0, direction: 1, mesh_ref: "",
    }],
  } );

  it( "runs along the piece's X with Y up (5, and 10 working the top out) or Z up (6), as the game takes them", () => {
    for ( const m of [5, 10] ) {
      const g = grindGuide( box( m ), new Float32Array( 0 ) )!;
      expect( g.ok ).toBe( true );
      const [a, b] = g.lines[0];
      expect( Math.abs( b.x - a.x ) ).toBeCloseTo( 4, 3 );
      expect( g.up.y                ).toBeCloseTo( 1, 3 );
    }
    const z = grindGuide( box( 6 ), new Float32Array( 0 ) )!;
    expect( Math.abs( z.lines[0][1].x - z.lines[0][0].x ) ).toBeCloseTo( 4, 3 );
    expect( Math.abs( z.up.z )                            ).toBeCloseTo( 1, 3 );
  } );

  it( "says when the way set runs across the piece", () => {
    expect( grindGuide( box( 3 ), new Float32Array( 0 ) )!.problem ).toBe( "across" );
    expect( grindGuide( box( 4 ), new Float32Array( 0 ) )!.problem ).toBe( "across" );
  } );
} );
