import { describe, expect, it } from "vitest";
import { history } from "../../src/map/history";
import { fixSeam, repeatedChunks, repeatOf, seamAxis, seamGap, setRepeat } from "../../src/terrain/repeats";
import { useEditor } from "../../src/map/store";
import { terrain } from "../../src/terrain/terrain";

/**
 * A 100 m chunk sloping down along +Z ( 10 m over its length ), with a bump across its near edge.
**/
function slope() {
  const res = 65, h = new Float32Array( res * res );
  for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 10 - ( 10 * j ) / ( res - 1 ) + ( j === 0 ? Math.sin( i / 6 ) : 0 );
  terrain.setChunks( [{ key: "c0", position: [0, 0, 0], size: [100, 100, 100], res, heights: h }] );
  useEditor.setState( { chunkExtras: {} } );
  return terrain.chunks[0];
}

describe( "repeated chunks", () => {
  it( "are kept per chunk and listed with their copies' offsets, one undo step each", () => {
    slope();
    setRepeat( "c0", { repeats: 3, offset: [0, -10, 100] } );
    expect( repeatOf( "c0" ) ).toEqual( { repeats: 3, offset: [0, -10, 100] }                    );
    expect( repeatedChunks() ).toEqual( [{ key: "c0", offsets: [[0, -10, 100], [0, -20, 200]] }] );
    history.undo();
    expect( repeatOf( "c0" ).repeats ).toBe( 1 );
  } );

  it( "know which edge their copies go on from", () => {
    const c = slope();
    expect( seamAxis( c, [0,    -10, 100] ) ).toEqual( { axis: 2, dir: 1  } );
    expect( seamAxis( c, [-100, 0,   0  ] ) ).toEqual( { axis: 0, dir: -1 } );
    expect( seamAxis( c, [37, 0, 0] )       ).toBeNull();
  } );

  it( "have their seam fixed: the step where one copy meets the next gone, the rest as it was, undone whole", async () => {
    const c      = slope();
    const before = c.heights.slice();
    // ( its far edge is 10 m below its near edge; a copy 100 m on and 10 m down meets it but for the bump )
    setRepeat( "c0", { repeats: 2, offset: [0, -10, 100] } );
    const gap0 = seamGap( "c0" )!;
    expect( gap0                      ).toBeGreaterThan( 0.5 );
    expect( await fixSeam( "c0", 20 ) ).toBe( true );
    expect( seamGap( "c0" )!          ).toBeLessThan( 1e-4 );
    // the middle, well away from both edges, untouched
    const mid = 32 * 65 + 10;
    expect( c.heights[mid]   ).toBe( before[mid] );
    expect( history.nextUndo ).toBe( "Fix seam"  );
    history.undo();
    expect( Array.from( terrain.chunks[0].heights ) ).toEqual( Array.from( before ) );
  } );

  it( "leave an edge shared with the chunk behind as it is: only the far side moves", async () => {
    const res = 65, h = ( z0: number ) => {
      const a = new Float32Array( res * res );
      for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) a[j * res + i] = 20 - ( 10 * ( z0 + ( 100 * j ) / ( res - 1 ) ) ) / 100;
      return a;
    };
    terrain.setChunks( [
      { key: "behind", position: [0, 0, -100], size: [100, 100, 100], res, heights: h( -100 ) },
      { key: "c0",     position: [0, 0, 0   ], size: [100, 100, 100], res, heights: h( 0    ) },
    ] );
    useEditor.setState( { chunkExtras: {} } );
    setRepeat( "c0", { repeats: 3, offset: [0, -14, 100] } );
    const c = terrain.chunks[1], near = c.heights.slice( 0, res );
    expect( await fixSeam( "c0", 20 )               ).toBe( true );
    expect( seamGap( "c0" )!                        ).toBeLessThan( 1e-4 );
    expect( Array.from( c.heights.slice( 0, res ) ) ).toEqual( Array.from( near ) );
  } );
} );
