import { describe, expect, it } from "vitest";
import { curveMesh, newCurve, samplePath } from "../../src/model/curve";
import type { CustomObjectEntry } from "../../src/core/types";
import type { ModelData } from "../../src/model/build";
import { cross, dot, edgesOf, runs, type Mesh } from "../../src/model/mesh";

const volume = ( g: Mesh ) => {
  let v = 0;
  for ( const f of g.f ) for ( let i = 1; i + 1 < f.length; i++ ) v += dot( g.v[f[0]], cross( g.v[f[i]], g.v[f[i + 1]] ) );
  return v / 6;
};
const closed = ( g: Mesh ) => [...edgesOf( g ).values()].every( ( e ) => e.faces.length === 2 && runs( g.f[e.faces[0]], e.a, e.b ) !== runs( g.f[e.faces[1]], e.a, e.b ) );

describe( "curve pieces", () => {
  it( "a straight round rail: a closed tube facing out, the volume of a cylinder", () => {
    const c = { ...newCurve( [[0, 1, 0], [3, 1, 0]] ), radius: 0.05, sides: 32 };
    const g = curveMesh( c );
    expect( closed( g ) ).toBe( true );
    expect( volume( g ) ).toBeGreaterThan( 0 );
    expect( volume( g ) ).toBeCloseTo( Math.PI * 0.05 * 0.05 * 3, 3 );
  } );

  it( "a kinked rail keeps its corner (sharp point) and its size round it", () => {
    const c = newCurve( [[0, 0, 0], [2, 0, 0], [4, -1, 0]] );
    c.splines[0].points[1].sharp = true;
    const path = samplePath( c.splines[0], 12 );
    // the corner point is on the path exactly
    expect( path.some( ( q ) => Math.abs( q.p[0] - 2 ) < 1e-9 && Math.abs( q.p[1] ) < 1e-9 ) ).toBe( true );
    const g = curveMesh( c );
    expect( closed( g ) ).toBe( true );
    // every ring the same size across ( no pinching at the kink )
    const ys = g.v.filter( ( p ) => Math.abs( p[0] ) < 0.05 ).map( ( p ) => p[1] );
    expect( Math.max( ...ys ) - Math.min( ...ys ) ).toBeCloseTo( 0.05, 2 );
  } );

  it( "a smooth curve flows through its points; square and flat profiles close too", () => {
    const c    = newCurve( [[0, 0, 0], [2, 1, 0], [4, 0, 0]] );
    const path = samplePath( c.splines[0], 12 );
    expect( path.length ).toBeGreaterThan( 20 );
    expect( path.some( ( q ) => Math.abs( q.p[0] - 2 ) < 1e-6 && Math.abs( q.p[1] - 1 ) < 1e-6 ) ).toBe( true );
    for ( const profile of ["square", "flat"] as const ) {
      const g = curveMesh( { ...c, profile } );
      expect( closed( g ), profile ).toBe( true );
      expect( volume( g ), profile ).toBeGreaterThan( 0 );
    }
  } );
} );

describe( "curve pieces in the map", () => {
  it( "a rail piece is a jib grinding along its curve on capsules; a leg's are plain", async () => {
    const { newCurveObject } = await import( "../../src/model/objects" );
    const rail               = newCurveObject( "r1", newCurve( [[-2, 0, 0], [0, 0, 1], [2, 0, 0]] ), [10, 1, 10] );
    expect( rail.surface_type        ).toBe( "Jib" );
    expect( rail.rail?.points.length ).toBeGreaterThan( 5 );
    expect( rail.colliders.length    ).toBeGreaterThan( 1 );
    expect( rail.colliders.every( ( c ) => c.shape === "Capsule" && c.surface_type === "Jib" ) ).toBe( true );
    // the capsules sit where the curve is, in the map
    expect( Math.abs( rail.colliders[0].local_position.y - 1 ) ).toBeLessThan( 0.1 );
    const leg = newCurveObject( "l1", newCurve( [[0, 0, 0], [0, 0.6, 0]] ), [0, 0, 0], false );
    expect( leg.rail ).toBeUndefined();
    expect( leg.colliders.every( ( c ) => c.surface_type === "Generic" ) ).toBe( true );
  } );

  it( "a box rail or a flat bar rides on boxes its own size, not capsules", async () => {
    const { newCurveObject } = await import( "../../src/model/objects" );
    const box                = newCurveObject( "b1", { ...newCurve( [[-2, 0, 0], [2, 0, 0]] ), profile: "square", radius: 0.08 }, [0, 1, 0] );
    expect( box.rail?.box                                     ).toEqual( [0.08, 0.08] );
    expect( box.colliders.every( ( c ) => c.shape === "Box" ) ).toBe( true );
    expect( box.colliders[0].size.x                           ).toBeCloseTo( 2 * ( 0.08 + 0.012 ), 5 );
    const bar = newCurveObject( "f1", { ...newCurve( [[-2, 0, 0], [2, 0, 0]] ), profile: "flat", radius: 0.04, thickness: 0.004 }, [0, 1, 0] );
    expect( bar.rail?.box                                     ).toEqual( [0.04, 0.004] );
    expect( bar.colliders.every( ( c ) => c.shape === "Box" ) ).toBe( true );
    expect( bar.colliders[0].size.z                           ).toBeCloseTo( 2 * ( 0.004 + 0.012 ), 5 );
  } );

  it( "edits a rail's own points in Design ( moved, added, taken away ), its curve and colliders following", async () => {
    const { newCurveObject, railOfCurve, withCurvePoints } = await import( "../../src/model/objects" );
    const { CURVE_PRESETS, presetCurve }                   = await import( "../../src/model/curve" );
    const kinked                                           = CURVE_PRESETS.find( ( p ) => p.label === "Kinked Rail" )!;
    const o                                                = newCurveObject( "k1", presetCurve( kinked ), [0, 1, 0] ) as CustomObjectEntry & { model: ModelData };
    // Edit Points shows its three points, not the curve sampled along them
    const shown = railOfCurve( o ).rail!.points;
    expect( shown ).toEqual( kinked.points );
    // the end lifted a metre: the curve's point moves, the kink stays sharp, the rail ends a metre up
    const moved = withCurvePoints( o, [shown[0], shown[1], [3, 0.4, 0]], [0, 1, 0] ) as CustomObjectEntry & { model: ModelData };
    expect( moved.model.curve!.splines[0].points.map( ( q ) => q.p ) ).toEqual( [shown[0], shown[1], [3, 0.4, 0]] );
    expect( moved.model.curve!.splines[0].points[1].sharp           ).toBe( true );
    expect( moved.rail!.points[moved.rail!.points.length - 1]       ).toEqual( [3, 0.4, 0] );
    expect( moved.rail!.up                                          ).toEqual( [0, 1, 0] );
    expect( moved.colliders.length                                  ).toBeGreaterThan( 0 );
    // a point put in, then one taken away: the others keep what they were
    const more = withCurvePoints( moved, [shown[0], [-2, 0.6, 0.5], shown[1], [3, 0.4, 0]] ) as CustomObjectEntry & { model: ModelData };
    expect( more.model.curve!.splines[0].points.map( ( q ) => q.sharp ) ).toEqual( [false, false, true, false] );
    const less = withCurvePoints( more, [shown[0], shown[1], [3, 0.4, 0]] ) as CustomObjectEntry & { model: ModelData };
    expect( less.model.curve!.splines[0].points.map( ( q ) => q.sharp ) ).toEqual( [false, true, false] );
  } );

  it( "converts to a mesh piece that edits like any other", async () => {
    const c = newCurve( [[0, 0, 0], [2, 0, 0]] );
    const g = curveMesh( c );
    expect( closed( g ) ).toBe( true   );
    expect( g.f.length  ).toBe( 16 + 2 );
  } );
} );
