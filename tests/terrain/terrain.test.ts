import { describe, expect, it } from "vitest";
import { terrain } from "../../src/terrain/terrain";

type Rect = [number, number, number, number];

/**
 * What the next flush sends to the renderers for chunk `ci` ( each tile's changed rectangle ).
**/
function sentFor( ci: number, run: () => void ): Rect[] {
  const sent: Rect[] = [];
  const off          = terrain.subscribe( ( d ) => {
    for ( const [c, tiles] of d ) if ( c === ci ) for ( const r of tiles.values() ) sent.push( r as Rect );
  } );
  run();
  terrain.flush();
  off();
  return sent;
}

describe( "chunk borders", () => {
  it( "send only what changed along them, and still meet", () => {
    const res = 129;
    // two 128 m chunks side by side on different bases ( float32 heights over each one's own )
    terrain.setChunks( [
      { key: "a", position: [0,   100.3, 0], size: [128, 50, 128], res, heights: new Float32Array( res * res ).fill( 7.1 ) },
      { key: "b", position: [128, 101.7, 0], size: [128, 50, 128], res, heights: new Float32Array( res * res ).fill( 5.7 ) },
    ] );
    // meeting already ( to a rounding ): nothing to send
    expect( sentFor( 1, () => terrain.syncEdges( [0, 1] ) ) ).toEqual( [] );
    // a few samples raised on a's border: b's side of it goes along, just there
    const [a, b] = terrain.chunks;
    for ( let j = 60; j <= 64; j++ ) a.heights[j * res + res - 1] += 2;
    const sent = sentFor( 1, () => terrain.syncEdges( [0] ) );
    expect( sent.length ).toBeGreaterThan( 0 );
    for ( const r of sent ) {
      expect( r[1] ).toBeGreaterThanOrEqual( 58 );
      expect( r[3] ).toBeLessThanOrEqual( 66 );
    }
    for ( let j = 0; j < res; j++ ) expect( a.heights[j * res + res - 1] + 100.3 ).toBeCloseTo( b.heights[j * res] + 101.7, 3 );
    expect( sentFor( 1, () => terrain.syncEdges( [0] ) ) ).toEqual( [] );
  } );

  it( "make a finer chunk's border follow a coarser neighbour's, sending only what moved", () => {
    terrain.setChunks( [
      { key: "fine",   position: [0,  0, 0], size: [64, 50, 64], res: 129, heights: new Float32Array( 129 * 129 ).fill( 10 ) },
      { key: "coarse", position: [64, 0, 0], size: [64, 50, 64], res: 65,  heights: new Float32Array( 65  * 65  ).fill( 10 ) },
    ] );
    expect( sentFor( 0, () => terrain.syncEdges( [1] ) ) ).toEqual( [] );
    const coarse            = terrain.chunks[1];
    coarse.heights[32 * 65] = 12;
    const sent              = sentFor( 0, () => terrain.syncEdges( [1] ) );
    expect( sent.length ).toBeGreaterThan( 0 );
    for ( const r of sent ) {
      expect( r[1] ).toBeGreaterThanOrEqual( 61 );
      expect( r[3] ).toBeLessThanOrEqual( 67 );
    }
    expect( terrain.heightAt( 64 - 1e-6, 32   ) ).toBeCloseTo( 12, 3 );
    expect( terrain.heightAt( 64 - 1e-6, 32.5 ) ).toBeCloseTo( 11, 3 );
  } );
} );

describe( "chunk corners", () => {
  // four 64 m chunks meeting at ( 64, 64 ), each on its own base
  const four = () => {
    const res = 65;
    terrain.setChunks( [[0, 0], [64, 0], [0, 64], [64, 64]].map( ( [x, z], k ) => ( {
      key:      `c${k}`,
      position: [x, 10 + k * 0.7, z] as [number, number, number],
      size:     [64, 50, 64] as [number, number, number],
      res,
      heights:  new Float32Array( res * res ).fill( 20 - k * 0.7 ),
    } ) ) );
  };
  // each chunk's height at the corner they share
  const corner = () => terrain.chunks.map( ( c ) => {
    const i = Math.round( ( 64 - c.position[0] ) / c.spacing ), j = Math.round( ( 64 - c.position[2] ) / c.spacing );
    return c.heights[j * c.res + i] + c.position[1];
  } );
  // a change at the corner, different in each chunk ( as each works out its own )
  const change = ( by: number[] ) => terrain.chunks.forEach( ( c, k ) => {
    const i = Math.round( ( 64 - c.position[0] ) / c.spacing ), j = Math.round( ( 64 - c.position[2] ) / c.spacing );
    c.heights[j * c.res + i] += by[k];
  } );

  it( "where four chunks meet, all get the same height, and the change taken back comes back exactly", () => {
    four();
    const was = corner();
    const by  = [0.4, 0.1, -0.2, 0.3];
    change( by );
    terrain.syncEdges( [0, 1, 2, 3] );
    const laid = corner();
    for ( const v of laid ) expect( v ).toBeCloseTo( laid[0], 4 );
    expect( laid[0] ).toBeCloseTo( was[0] + ( 0.4 + 0.1 - 0.2 + 0.3 ) / 4, 4 );
    // ( undone: each chunk's own change taken off what's there now )
    change( by.map( ( d ) => -d ) );
    terrain.syncEdges( [0, 1, 2, 3] );
    for ( const [k, v] of corner().entries() ) expect( v ).toBeCloseTo( was[k], 4 );
  } );

  it( "only one of them changed: the others meet it there too", () => {
    four();
    change( [0.8, 0, 0, 0] );
    terrain.syncEdges( [0] );
    const laid = corner();
    for ( const v of laid ) expect( v ).toBeCloseTo( laid[0], 4 );
  } );
} );
