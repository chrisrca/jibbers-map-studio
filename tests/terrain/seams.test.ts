import { describe, expect, it } from "vitest";
import { history } from "../../src/map/history";
import { terrain } from "../../src/terrain/terrain";
import { smoothSeam } from "../../src/terrain/seams";

// two 64 m chunks side by side ( x 0..128 ), 1 m apart: the first rising 0.3 m a metre to the seam, the second falling
// away from it as steeply ( a ridge along the seam: the same height there, a kink )
function kinked() {
  const res  = 65;
  const make = ( up: boolean ) => {
    const h = new Float32Array( res * res );
    for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 40 + ( up ? i : 64 - i ) * 0.3;
    return h;
  };
  terrain.setChunks( [
    { key: "a", position: [0,  0, 0], size: [64, 100, 64], res, heights: make( true  ) },
    { key: "b", position: [64, 0, 0], size: [64, 100, 64], res, heights: make( false ) },
  ] );
}

// the change of slope at x ( metres up per metre, from one side to the other )
const bend = ( x: number, z = 32 ) => Math.abs( ( terrain.heightAt( x + 1, z ) - terrain.heightAt( x, z ) ) - ( terrain.heightAt( x, z ) - terrain.heightAt( x - 1, z ) ) );

describe( "smoothing a seam", () => {
  it( "the kink at the seam rounded off over the distance; the ground beyond it untouched; one undo step", () => {
    kinked();
    history.clear();
    expect( bend( 64 ) ).toBeCloseTo( 0.6, 5 );
    const far = [terrain.heightAt( 40, 32 ), terrain.heightAt( 90, 32 )];
    expect( smoothSeam( "a", 1, 12 ) ).toBe( true );
    expect( bend( 64 ) ).toBeLessThan( 0.1 );
    for ( let x = 52; x <= 76; x++ ) expect( bend( x ) ).toBeLessThan( 0.1 );
    expect( [terrain.heightAt( 40, 32 ), terrain.heightAt( 90, 32 )] ).toEqual( far );
    // ( the two chunks still meet: their shared edge one height )
    const a = terrain.chunks[0], b = terrain.chunks[1];
    for ( let j = 0; j < 65; j += 8 ) expect( a.heights[j * 65 + 64] ).toBeCloseTo( b.heights[j * 65], 4 );
    history.undo();
    expect( bend( 64 ) ).toBeCloseTo( 0.6, 5 );
  } );

  it( "no chunk on that side: nothing done", () => {
    kinked();
    expect( smoothSeam( "a", 0, 12 ) ).toBe( false );
  } );
} );
