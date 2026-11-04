import { describe, expect, it } from "vitest";
import { composeUnity, transformCustom } from "../../src/core/transform";
import { arr3 } from "../../src/core/types";
import { primitive } from "../../src/model/mesh";
import { applyScale } from "../../src/model/objectOps";
import { newModelObject } from "../../src/model/objects";
import { autoRail, surfacePoints } from "../../src/pieces/rail";

// a cube stretched into a box 4 m along its own Z, half a metre high
const box = () => {
  const o = newModelObject( "b", primitive( "cube", { size: 1 } ), [0, 0, 0] );
  return transformCustom( o, composeUnity( [0, 0, 0], [0, 0, 0], [1, 0.5, 4] ) ) as typeof o;
};

describe( "Apply Scale", () => {
  it( "puts the scale into the mesh: scale 1, the same size to look at", () => {
    const o = applyScale( box() as Parameters<typeof applyScale>[0] );
    expect( arr3( o.scale ) ).toEqual( [1, 1, 1] );
    const zs = o.model.mesh.v.map( ( p ) => p[2] ), ys = o.model.mesh.v.map( ( p ) => p[1] );
    expect( Math.max( ...zs ) - Math.min( ...zs ) ).toBeCloseTo( 4, 5 );
    expect( Math.max( ...ys ) - Math.min( ...ys ) ).toBeCloseTo( 0.5, 5 );
    expect( o.parts[0].local_scale ).toEqual( { x: 1, y: 1, z: 1 } );
  } );

  it( "after it, a box's rail runs along it ( not across, as it did found on the unscaled cube )", () => {
    const o   = applyScale( box() as Parameters<typeof applyScale>[0] );
    const tri: number[] = [];
    for ( const f of o.model.mesh.f ) for ( let k = 1; k + 1 < f.length; k++ ) tri.push( f[0], f[k], f[k + 1] );
    const pts  = surfacePoints( new Float32Array( o.model.mesh.v.flat() ), new Uint32Array( tri ), 3000 );
    const rail = autoRail( new Float32Array( pts ) ).rail!;
    const a = rail.points[0], b = rail.points[rail.points.length - 1];
    expect( Math.abs( b[2] - a[2] ) ).toBeGreaterThan( 3.5 );
    expect( Math.abs( b[0] - a[0] ) ).toBeLessThan( 0.01 );
  } );
} );
