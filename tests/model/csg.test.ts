import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { booleanMesh, meshPolys } from "../../src/model/booleanOps";
import { triangulateFace } from "../../src/model/build";
import { faceNormal, primitive, type Mesh } from "../../src/model/mesh";

/**
 * A closed mesh's volume ( the divergence theorem over its triangles ).
**/
function volume( g: Mesh ) {
  let v = 0;
  g.f.forEach( ( f, fi ) => {
    for ( const [a, b, c] of triangulateFace( g, f, faceNormal( g, fi ) ) ) {
      const [p, q, r] = [g.v[a], g.v[b], g.v[c]];
      v              += ( p[0] * ( q[1] * r[2] - q[2] * r[1] ) - p[1] * ( q[0] * r[2] - q[2] * r[0] ) + p[2] * ( q[0] * r[1] - q[1] * r[0] ) ) / 6;
    }
  } );
  return v;
}

describe( "booleans", () => {
  const cube   = primitive( "cube" );
  // a half-size cube over the big one's corner: [0.5, 1.5]³ overlaps [0.5, 1]³ = 1/8 m³
  const corner = meshPolys( primitive( "cube" ), new THREE.Matrix4().makeTranslation( 1, 1, 1 ).multiply( new THREE.Matrix4().makeScale( 0.5, 0.5, 0.5 ) ) );

  it( "measures the cube right", () => expect( volume( cube ) ).toBeCloseTo( 8, 5 ) );

  it( "cuts a corner out", () => expect( volume( booleanMesh( cube, corner, "difference" ) ) ).toBeCloseTo( 8 - 0.125,     4 ) );
  it( "adds a corner on",  () => expect( volume( booleanMesh( cube, corner, "union"      ) ) ).toBeCloseTo( 8 + 1 - 0.125, 4 ) );
  it( "keeps the overlap", () => expect( volume( booleanMesh( cube, corner, "intersect"  ) ) ).toBeCloseTo( 0.125,         4 ) );

  it( "makes flat sides single faces again", () => {
    const g = booleanMesh( cube, corner, "difference" );
    // the cut leaves 3 untouched sides whole, 3 notched ( each one face ), and the notch's 3 inner faces
    expect( g.f.length ).toBeLessThanOrEqual( 12 );
  } );
} );
