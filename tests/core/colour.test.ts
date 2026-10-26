import { describe, expect, it } from "vitest";
import { hexOf, hsvOf, rgbOfHex, rgbOfHsv } from "../../src/core/colour";

describe( "colours", () => {
  it( "go between hex, RGB and HSV", () => {
    expect( hexOf( [1, 0.5, 0] )                                         ).toBe( "#ff8000" );
    expect( rgbOfHex( "#ff8000" )!.map( ( v ) => Math.round( v * 255 ) ) ).toEqual( [255, 128, 0] );
    expect( rgbOfHex( "f80" )!.map( ( v ) => Math.round( v * 255 ) )     ).toEqual( [255, 136, 0] );
    expect( rgbOfHex( "nope" ) ).toBeNull();
    for ( const c of [[0.2, 0.4, 0.9], [1, 0, 0], [0.5, 0.5, 0.5]] as [number, number, number][] ) {
      const back = rgbOfHsv( ...hsvOf( c ) );
      back.forEach( ( v, k ) => expect( v ).toBeCloseTo( c[k], 6 ) );
    }
  } );
} );
