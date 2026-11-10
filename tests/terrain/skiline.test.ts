import { describe, expect, it } from "vitest";

const { terrain }                                                                          = await import( "../../src/terrain/terrain" );
const { newCurve, newSkiLine, previewShape, resetShapes }                                  = await import( "../../src/terrain/shapes/shapes" );
const { SKI_LINE_PRESETS, newSkiLineFeature, rampStripes, skiLineAt, skiLineBake, skiLineStripes, splinePoint, withPreset } = await import( "../../src/terrain/shapes/shapes/skiline" );

type Node = { p: [number, number, number]; width: number | null; roll: number };
const node = ( x: number, y: number, z: number, roll = 0 ): Node => ( { p: [x, y, z], width: null, roll } );

// a straight line 200 m north along x = 0, at 50 m
const straight = () => newSkiLine( [node( 0, 50, 0 ), node( 0, 50, 100 ), node( 0, 50, 200 )] );

describe( "a ski line, as Map-Tools lays it", () => {
  it( "its spline goes through its points; sampled evenly, as long as it runs", () => {
    const s = newSkiLine( [node( 0, 50, 0 ), node( 40, 52, 60 ), node( 100, 48, 90 )] );
    expect( splinePoint( s.nodes, 1, 0 ) ).toEqual( [40, 52, 60] );
    const b = skiLineBake( straight() )!;
    expect( b.pos.length ).toBe( 1024 );
    expect( b.total ).toBeCloseTo( 200, 3 );
    expect( b.cum[512] - b.cum[511] ).toBeCloseTo( 200 / 1023, 4 );
  } );

  it( "the ground set to its height along the middle, blended in at its edges and ends", () => {
    const s = straight();
    const mid = skiLineAt( s, 0, 100 )!;
    expect( mid.h ).toBeCloseTo( 50, 4 );
    expect( mid.blend ).toBeCloseTo( 1, 6 );
    // ( 14 m wide: half 7; a quarter of each side blended, smoothly )
    expect( skiLineAt( s, 6.9, 100 )!.blend ).toBeLessThan( 0.1 );
    expect( skiLineAt( s, 7.1, 100 ) ).toBeNull();
    // ( 10 m faded in at each end: halfway in, smoothstep( 0.5 ) )
    expect( skiLineAt( s, 0, 5 )!.blend ).toBeCloseTo( 0.5, 3 );
  } );

  it( "rolled: the side Map-Tools calls its right ( −x, heading +z ) raised", () => {
    const s = newSkiLine( [node( 0, 50, 0, 10 ), node( 0, 50, 100, 10 ), node( 0, 50, 200, 10 )] );
    const r = skiLineAt( s, -3, 100 )!.h - 50, l = skiLineAt( s, 3, 100 )!.h - 50;
    expect( r ).toBeCloseTo( Math.tan( ( 10 * Math.PI ) / 180 ) * 3, 2 );
    expect( l ).toBeCloseTo( -r, 4 );
  } );

  it( "a kicker: its profile × its height, along it", () => {
    const s = { ...straight(), features: [withPreset( newSkiLineFeature( 80 ), SKI_LINE_PRESETS[0] )] };
    expect( skiLineAt( s, 0, 80 + 6 )!.h - 50 ).toBeCloseTo( 0.9, 1 );
    // ( near its lip; at the lip itself softened over a sample, the bumps being looked up between the samples' )
    expect( skiLineAt( s, 0, 80 + 11.5 )!.h - 50 ).toBeGreaterThan( 2.6 );
    expect( skiLineAt( s, 0, 80 - 1 )!.h ).toBeCloseTo( 50, 4 );
  } );

  it( "a kicker's stripes: along both edges, and across at its lip", () => {
    const s   = { ...straight(), features: [withPreset( newSkiLineFeature( 80 ), SKI_LINE_PRESETS[0] )] };
    // ( a mask of 0.25 m pixels over the square from ( −32, 64 ) )
    const px  = skiLineStripes( s, -32, 64, 64, 256 );
    const at  = ( x: number, z: number ) => px.get( Math.floor( ( z - 64 ) / 0.25 ) * 256 + Math.floor( ( x + 32 ) / 0.25 ) );
    // ( along stripes 0.06 and 0.94 across: 0.88 × 7 m off the middle )
    expect( at( 6.16, 86 )?.colour ).toBe( 11 );
    expect( at( -6.16, 86 )?.cov ).toBeCloseTo( 0.7, 1 );
    expect( at( 0, 86 ) ).toBeUndefined();
    // ( across, at its end, red )
    expect( at( 0, 92 )?.colour ).toBe( 0 );
  } );

  it( "a ramp's stripes, as a ski line feature's over the whole ramp", () => {
    // ( a ramp 20 m north from ( 0, 70 ), 14 m wide, with the Kicker preset's stripes )
    const s  = { ...newCurve( [0, 70], [0, 90] ), width: 14, stripes: SKI_LINE_PRESETS[0].stripes() };
    const px = rampStripes( s, -32, 64, 64, 256 );
    const at = ( x: number, z: number ) => px.get( Math.floor( ( z - 64 ) / 0.25 ) * 256 + Math.floor( ( x + 32 ) / 0.25 ) );
    expect( at( 6.16, 80 )?.colour ).toBe( 11 );
    expect( at( -6.16, 80 )?.cov ).toBeCloseTo( 0.7, 1 );
    expect( at( 0, 80 ) ).toBeUndefined();
    // ( across at its end, red, pulled in from the edges )
    expect( at( 0, 89.9 )?.colour ).toBe( 0 );
    expect( at( 6.9, 89.9 )?.colour ).not.toBe( 0 );
    expect( rampStripes( { ...s, stripes: [] }, -32, 64, 64, 256 ).size ).toBe( 0 );
  } );

  it( "carved into the ground: a flat run 2 m under a slope, its edges met", () => {
    const res = 201, h = new Float32Array( res * res );
    for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 52;
    terrain.setChunks( [{ key: "a", position: [-100, 0, -100], size: [200, 200, 200], res, heights: h }] );
    resetShapes();
    previewShape( newSkiLine( [node( 0, 50, -60 ), node( 0, 50, 0 ), node( 0, 50, 60 )] ) );
    expect( terrain.heightAt( 0, 0 ) ).toBeCloseTo( 50, 3 );
    expect( terrain.heightAt( 9, 0 ) ).toBeCloseTo( 52, 3 );
    expect( terrain.heightAt( 6, 0 ) ).toBeGreaterThan( 50 );
  } );
} );
