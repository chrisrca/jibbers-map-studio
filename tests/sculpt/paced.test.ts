import { describe, expect, it } from "vitest";
import { Terrain } from "../../src/terrain/terrain";
import { BRUSHES, defaultSculpt, type BrushId } from "../../src/sculpt/brushes";
import { BrushStroke } from "../../src/sculpt/stroke/stroke";

// two bumpy 100 m chunks side by side ( x 0..200 ), 0.5 m apart
function ground() {
  const t    = new Terrain(), res = 201;
  const make = ( x0: number ) => {
    const h = new Float32Array( res * res );
    for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 20 + 3 * Math.sin( ( x0 + i * 0.5 ) * 0.21 ) * Math.cos( j * 0.5 * 0.17 ) + ( ( i * 7 + j * 13 ) % 5 ) * 0.1;
    return h;
  };
  t.setChunks( [
    { key: "a", position: [0,   0, 0], size: [100, 200, 100], res, heights: make( 0   ) },
    { key: "b", position: [100, 0, 0], size: [100, 200, 100], res, heights: make( 100 ) },
  ] );
  return t;
}

// a stroke across the chunks' seam: at once, or paced and paused at every chance ( no time to spare: a few rows at a
// time ), each move's dabs done before the next move, as a frame does them
function stroke( brush: BrushId, paced: boolean, radius = 14 ) {
  const t  = ground(), sc = defaultSculpt();
  sc.brush = brush;
  sc.radius = radius;
  const s  = new BrushStroke( t, sc, [80, 50] );
  s.paced  = paced;
  let pauses = 0;
  for ( let x = 80; x <= 120; x += 3 ) {
    s.move( { x, z: 50 + ( x - 80 ) * 0.3 } );
    while ( paced && s.work( 0 ) ) pauses++;
  }
  s.end();
  return { heights: t.chunks.map( ( c ) => c.heights ), pauses };
}

describe( "a paced sculpt stroke ( a frame's share at a time )", () => {
  for ( const b of BRUSHES.filter( ( x ) => x.id !== "mask" ) )
    it( `${b.id}: the same ground as all at once, however often it's paused`, () => {
      const once = stroke( b.id, false ), paced = stroke( b.id, true );
      expect( paced.pauses ).toBeGreaterThan( 5 );
      for ( let c = 0; c < once.heights.length; c++ ) expect( paced.heights[c] ).toEqual( once.heights[c] );
    } );
} );
