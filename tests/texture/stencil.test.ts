import { describe, expect, it } from "vitest";
import { stencilAt, type StencilState } from "../../src/texture/stencil";

// a 4 × 2 image: red on the left half, see-through blue on the right
const data = new Uint8Array( 4 * 2 * 4 );
for ( let y = 0; y < 2; y++ )
  for ( let x = 0; x < 4; x++ ) data.set( x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 0], ( y * 4 + x ) * 4 );
const base: StencilState = { img: { w: 4, h: 2, data, url: "", name: "t" }, x: 100, y: 50, scale: 10, angle: 0, opacity: 1, adjust: false };

describe( "stencil", () => {
  it( "samples the image where it lies on the view", () => {
    expect( stencilAt( base, 85,  50 ) ).toEqual( [1, 0, 0, 1] );
    // see-through: nothing
    expect( stencilAt( base, 115, 50 ) ).toBeNull();
    // off it
    expect( stencilAt( base, 70,  50 ) ).toBeNull();
    expect( stencilAt( base, 85,  80 ) ).toBeNull();
  } );
  it( "turns with it", () => {
    // a quarter turn clockwise: the left half is now on top
    const s = { ...base, angle: Math.PI / 2 };
    expect( stencilAt( s, 100, 35 ) ).toEqual( [1, 0, 0, 1] );
    expect( stencilAt( s, 100, 65 ) ).toBeNull();
  } );
} );
