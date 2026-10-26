import { describe, expect, it } from "vitest";
import { indexPolygon } from "../../src/geo/proj";

// The plain even-odd test ( rings of [lon, lat] ), every edge tried: what the indexed one must agree with.
function inPolygon( lon: number, lat: number, rings: number[][][] ) {
  let inside = false;
  for ( const ring of rings )
    for ( let i = 0, j = ring.length - 1; i < ring.length; j = i++ ) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ( yi > lat !== yj > lat && lon < ( ( xj - xi ) * ( lat - yi ) ) / ( yj - yi ) + xi ) inside = !inside;
    }
  return inside;
}

describe( "an indexed polygon", () => {
  it( "says what the plain test says, for a ragged outline with a hole", () => {
    // a star-ish outline with 4000 corners ( a footprint's jagged edge ) and a square hole
    let seed                = 7;
    const rnd               = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
    const outer: number[][] = [];
    for ( let i = 0; i < 4000; i++ ) {
      const a = ( i / 4000 ) * Math.PI * 2, r = 0.05 + 0.02 * Math.sin( a * 9 ) + 0.004 * rnd();
      outer.push( [-71.9 + r * Math.cos( a ), 43 + r * Math.sin( a )] );
    }
    outer.push( outer[0] );
    const hole  = [[-71.91, 42.99], [-71.89, 42.99], [-71.89, 43.01], [-71.91, 43.01], [-71.91, 42.99]];
    const rings = [outer, hole];
    const f     = indexPolygon( rings );
    let inside  = 0;
    for ( let k = 0; k < 5000; k++ ) {
      const lon  = -71.98 + 0.16 * rnd(), lat = 42.92 + 0.16 * rnd();
      const want = inPolygon( lon, lat, rings );
      expect( f.contains( lon, lat ) ).toBe( want );
      if ( want ) inside++;
    }
    expect( inside ).toBeGreaterThan( 500 );
  } );
} );
