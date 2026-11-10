import { describe, expect, it } from "vitest";
import { newCurve, shapeBounds } from "../../../src/terrain/shapes/shapes";
import { shapeAt } from "../../../src/terrain/shapes/shapes/height";
import { rampLength, rampPath } from "../../../src/terrain/shapes/shapes/rampPath";
import { rampStripes, SKI_LINE_PRESETS } from "../../../src/terrain/shapes/shapes/skiline";

const flat = () => 20;
// ( a 3 m bump the whole way, so where the ramp is shows )
const ramp = () => ( { ...newCurve( [50, 10], [50, 90] ), width: 6, heightMode: "bump" as const, bump: 3, profile: [{ t: 0, v: 1, ti: 0, to: 0 }, { t: 1, v: 1, ti: 0, to: 0 }], edgeBlend: 0 } );

describe( "a ramp bent by its arms", () => {
  it( "straight without them, as before", () => {
    const s = ramp();
    expect( shapeAt( s, 50, 50, flat )?.h ).toBeCloseTo( 23, 5 );
    expect( shapeAt( s, 60, 50, flat ) ).toBeNull();
    expect( rampLength( s ) ).toBeCloseTo( 80, 6 );
  } );

  it( "with them, along the curve they make: its middle moved over, its length longer", () => {
    // both arms 30 m east: the middle of the run 22.5 m east ( a cubic's middle: ¾ of the arms )
    const s = { ...ramp(), startArm: [30, 20] as [number, number], endArm: [30, -20] as [number, number] };
    expect( shapeAt( s, 72.5, 50, flat )?.h ).toBeCloseTo( 23, 5 );
    expect( shapeAt( s, 50, 50, flat ) ).toBeNull();
    expect( rampLength( s ) ).toBeGreaterThan( 90 );
    const b = shapeBounds( s );
    expect( b[2] ).toBeGreaterThan( 72.5 + 2.9 );
    // ( past its ends: nothing )
    expect( shapeAt( s, 50, 5, flat ) ).toBeNull();
    expect( shapeAt( s, 50, 95, flat ) ).toBeNull();
  } );

  it( "its cross-section and stripes follow it: left is left round the bend", () => {
    const s = { ...ramp(), startArm: [30, 20] as [number, number], endArm: [30, -20] as [number, number], crossDepth: 1, cross: [{ t: 0, v: 1, ti: 0, to: 0 }, { t: 1, v: 0, ti: 0, to: 0 }] };
    // ( going north and bending east, its left is the north-west side: at the middle, north of the curve's top )
    const p = rampPath( s )!, mid = p.x.length >> 1;
    expect( p.x[mid] ).toBeCloseTo( 72.5, 1 );
    const westSide = shapeAt( s, p.x[mid] - 2.5, p.z[mid], flat )!.h, eastSide = shapeAt( s, p.x[mid] + 2.5, p.z[mid], flat )!.h;
    expect( westSide ).toBeGreaterThan( eastSide );
    // ( the Kicker's stripes: its edges, at the middle, 0.88 × 3 m off the curve )
    const st = { ...s, stripes: SKI_LINE_PRESETS[0].stripes() };
    const px = rampStripes( st, 0, 0, 100, 400 );
    const at = ( x: number, z: number ) => px.get( Math.floor( z / 0.25 ) * 400 + Math.floor( x / 0.25 ) );
    expect( at( p.x[mid] + 2.64, p.z[mid] )?.colour ).toBe( 11 );
    expect( at( p.x[mid] - 2.64, p.z[mid] )?.colour ).toBe( 11 );
    expect( at( p.x[mid], p.z[mid] ) ).toBeUndefined();
    expect( at( 50, 50 ) ).toBeUndefined();
  } );

  it( "a stripe's position 0 is the cross-section's left", () => {
    const s  = { ...ramp(), stripes: [{ across: false, position: 0, width: 0.5, softness: 0, opacity: 1, inset: 0, colour: 3 }] };
    const px = rampStripes( s, 0, 0, 100, 400 );
    const at = ( x: number, z: number ) => px.get( Math.floor( z / 0.25 ) * 400 + Math.floor( x / 0.25 ) );
    // ( running north, the cross-section's left ( its t = 0, lx 0 ) is west: x 47 )
    const crossLeft = shapeAt( { ...s, crossDepth: 1, cross: [{ t: 0, v: 1, ti: 0, to: 0 }, { t: 1, v: 0, ti: 0, to: 0 }] }, 47.2, 50, flat )!.h;
    expect( crossLeft ).toBeGreaterThan( 23.5 );
    expect( at( 47.1, 50 )?.colour ).toBe( 3 );
    expect( at( 52.9, 50 ) ).toBeUndefined();
  } );
} );
