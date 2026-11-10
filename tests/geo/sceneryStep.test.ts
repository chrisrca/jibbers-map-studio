// The surroundings' detail: the vertex spacing a Detail setting comes to ( geo/scenery/scenery.ts stepFor ).

import { describe, expect, it } from "vitest";
import { sceneryStep, stepFor } from "../../src/geo/scenery/scenery";

describe( "surroundings detail", () => {
  // a 2 x 2 km play area, its chunks a kilometre square
  const cells: [number, number, number, number][] = [[0, 0, 1000, 1000], [1000, 0, 2000, 1000], [0, 1000, 1000, 2000], [1000, 1000, 2000, 2000]];
  const step  = ( radius: number, detail: number ) => stepFor( radius, cells, 0, 0, detail, 2000, 2000 );

  it( "Medium is the usual spacing; Low coarser, High and Ultra finer", () => {
    expect( step( 8000, 1 ) ).toBe( sceneryStep( 8000 ) );
    expect( step( 8000, 2 ) ).toBe( 100 );
    expect( step( 8000, 0.5 ) ).toBe( 25 );
    expect( step( 4000, 0.25 ) ).toBe( 10 );
  } );

  it( "never more vertices than the game can draw: Ultra at 20 km stays coarser", () => {
    const s = step( 20000, 0.25 );
    const n = ( 2000 + 2 * 20000 ) / s + 1;
    expect( n * n ).toBeLessThanOrEqual( 2_500_000 );
    expect( s ).toBeLessThan( sceneryStep( 20000 ) );
  } );

  it( "every chunk's edge falls on a grid line", () => {
    const odd = [[0, 0, 1000, 1000], [1000, 0, 1500, 1000]] as [number, number, number, number][];
    const s   = stepFor( 8000, odd, 0, 0, 2, 1500, 1000 );
    expect( 500 % s ).toBe( 0 );
  } );
} );
