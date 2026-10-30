import { describe, expect, it } from "vitest";
import { windowsAt, type Window } from "../../../src/geo/elevation/remote";

// A tile of `W` x `H` pixels `d` apart, its first pixel centre at ( x0, y0 ), north up ( y falling down the rows ),
// each pixel's height from where it is.
function tile( x0: number, y0: number, W: number, H: number, d: number, h: ( x: number, y: number ) => number ): Window {
  const data = new Float32Array( W * H );
  for ( let j = 0; j < H; j++ ) for ( let i = 0; i < W; i++ ) data[j * W + i] = h( x0 + i * d, y0 - j * d );
  return { data, W, H, x0, y0, dx: d, dy: -d };
}

describe( "heights over several tiles", () => {
  // two 10 m tiles of 2 m pixels side by side, as swissALTI3D's are: pixel centres 1 m in from each edge
  const slope = ( x: number, y: number ) => 3 * x + 0.5 * y;
  const west  = tile( 1, 9, 5, 5, 2, slope );
  const east  = tile( 11, 9, 5, 5, 2, slope );

  it( "reads each tile inside its own pixel centres", () => {
    expect( windowsAt( [west, east], 4, 5 ) ).toBeCloseTo( slope( 4, 5 ), 4 );
    expect( windowsAt( [west, east], 13.5, 2 ) ).toBeCloseTo( slope( 13.5, 2 ), 4 );
  } );

  it( "has heights in the strip between two tiles, blended across both", () => {
    // ( 9 .. 11 m: past the west tile's last pixel centre, short of the east tile's first )
    for ( const x of [9.1, 9.5, 10, 10.7, 10.99] )
      for ( const y of [1, 4.3, 9] ) expect( windowsAt( [west, east], x, y ) ).toBeCloseTo( slope( x, y ), 4 );
  } );

  it( "has heights where four tiles meet", () => {
    const sw = tile( 1, -1, 5, 5, 2, slope ), se = tile( 11, -1, 5, 5, 2, slope );
    expect( windowsAt( [west, east, sw, se], 10, 0 ) ).toBeCloseTo( slope( 10, 0 ), 4 );
  } );

  it( "has none well away from every tile, or from tiles on another grid", () => {
    expect( windowsAt( [west, east], 50, 5 ) ).toBeNaN();
    expect( windowsAt( [], 5, 5 ) ).toBeNaN();
    const coarse = tile( 11.3, 9, 5, 5, 3, slope );
    expect( windowsAt( [west, coarse], 10.5, 5 ) ).toBeCloseTo( slope( 9, 5 ), 4 );
  } );
} );
