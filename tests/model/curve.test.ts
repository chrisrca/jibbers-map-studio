import { describe, expect, it } from "vitest";
import { curveMesh, newCurve, samplePath } from "../../src/model/curve";
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

  it( "converts to a mesh piece that edits like any other", async () => {
    const c = newCurve( [[0, 0, 0], [2, 0, 0]] );
    const g = curveMesh( c );
    expect( closed( g ) ).toBe( true   );
    expect( g.f.length  ).toBe( 16 + 2 );
  } );
} );
