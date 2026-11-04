import { describe, expect, it } from "vitest";
import { formationGrid, insideBy, newFormation, type FormationShape } from "../../src/terrain/shapes/shapes";
import { shapeHeightAt } from "../../src/terrain/shapes/shapes";
import { formationAt } from "../../src/terrain/shapes/shapes/formation";

// a 200 m square outline round the origin, over flat ground at 10 m
const square: [number, number][] = [[-100, -100], [100, -100], [100, 100], [-100, 100]];
const flat                       = () => 10;
const plain                      = ( p: Partial<FormationShape> = {} ): FormationShape => ( { ...newFormation( square ), roughness: 0, ...p } );

describe( "a formation", () => {
  it( "knows inside from outside its outline", () => {
    expect( insideBy( square, 0, 0 )    ).toBeCloseTo( 100, 5 );
    expect( insideBy( square, 150, 0 )  ).toBeCloseTo( -50, 5 );
  } );

  it( "added on top: its height at the peak, nothing outside, blended in from its edge", () => {
    const s = plain( { height: 30 } );
    expect( formationAt( s, 0, 0, flat )!.h ).toBeCloseTo( 40, 1 );
    expect( formationAt( s, 0, 0, flat )!.blend ).toBe( 1 );
    expect( formationAt( s, 150, 0, flat ) ).toBeNull();
    const edge = formationAt( s, 95, 0, flat )!;
    expect( edge.blend ).toBeGreaterThan( 0 );
    expect( edge.blend ).toBeLessThan( 1 );
  } );

  it( "raise never lowers the ground, carve never raises it, set builds from the ground round the outline", () => {
    const hill = ( x: number ) => 10 + x * 0.3;
    for ( const x of [-80, -20, 0, 40, 80] ) {
      expect( formationAt( plain( { mode: "raise", height: 5 } ), x, 0, hill )!.h ).toBeGreaterThanOrEqual( hill( x ) - 1e-4 );
      expect( formationAt( plain( { mode: "carve", height: 5 } ), x, 0, hill )!.h ).toBeLessThanOrEqual( hill( x ) + 1e-4 );
    }
    // ( the rim's mean: 10; the peak 20 over it )
    expect( formationAt( plain( { mode: "set", height: 20 } ), 0, 0, hill )!.h ).toBeCloseTo( 30, 0 );
  } );

  it( "its noise makes it rough, and its seed makes a different roughness", () => {
    const a = formationAt( plain( { roughness: 8, seed: 1 } ), 30, 30, flat )!.h, b = formationAt( plain( { roughness: 8, seed: 2 } ), 30, 30, flat )!.h;
    expect( a ).not.toBeCloseTo( b, 2 );
  } );

  it( "thermal erosion slumps its steep sides towards their angle", () => {
    const steepest = ( s: FormationShape ) => {
      const g  = formationGrid( s, flat );
      let most = 0;
      for ( let j = 1; j < g.h - 1; j++ ) for ( let i = 1; i < g.w - 1; i++ ) most = Math.max( most, Math.abs( g.y[j * g.w + i + 1] - g.y[j * g.w + i] ) / g.sp );
      return most;
    };
    const sharp = plain( { height: 80, peakWidth: 10, edgeBlend: 0 } );
    expect( steepest( { ...sharp, thermal: { on: true, amount: 1, iterations: 200, repose: 30 } } ) ).toBeLessThan( steepest( sharp ) );
  } );

  it( "hydraulic erosion changes the ground, keeping it whole ( nothing that isn't a number, nothing far off )", () => {
    const rough = plain( { height: 40, roughness: 10 } );
    const g     = formationGrid( { ...rough, hydraulic: { ...rough.hydraulic, on: true } }, flat ), g0 = formationGrid( rough, flat );
    let diff    = 0;
    for ( let q = 0; q < g.y.length; q++ ) {
      expect( Number.isFinite( g.y[q] ) ).toBe( true );
      diff = Math.max( diff, Math.abs( g.y[q] - g0.y[q] ) );
    }
    expect( diff ).toBeGreaterThan( 0.01 );
    expect( diff ).toBeLessThan( 40 );
  } );

  it( "is a terrain shape: its height looked up like the others'", () => {
    expect( shapeHeightAt( plain( { height: 30 } ), 0, 0 ) ).not.toBeNull();
  } );
} );
