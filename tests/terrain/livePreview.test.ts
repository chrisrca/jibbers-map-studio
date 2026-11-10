import { describe, expect, it, vi } from "vitest";

// ( frames, as a page has them: the live edits are paced by them )
vi.stubGlobal( "requestAnimationFrame", ( f: ( t: number ) => void ) => setTimeout( () => f( performance.now() ), 0 ) );

const { terrain }                                                  = await import( "../../src/terrain/terrain" );
const { newFormation, previewShape, previewShapeSoon, whenShapesSettled, resetShapes } = await import( "../../src/terrain/shapes/shapes" );

// one bumpy 200 m chunk, 1 m apart
function ground() {
  const res = 201, h = new Float32Array( res * res );
  for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 30 + 4 * Math.sin( i * 0.07 ) * Math.cos( j * 0.05 );
  terrain.setChunks( [{ key: "a", position: [-100, 0, -100], size: [200, 200, 200], res, heights: h }] );
  resetShapes();
}

const ring = ( dx: number ) => Array.from( { length: 9 }, ( _, k ) => [dx + Math.cos( ( k / 9 ) * Math.PI * 2 ) * 40, Math.sin( ( k / 9 ) * Math.PI * 2 ) * 35] as [number, number] );

describe( "a live shape edit worked out a frame's share at a time", () => {
  it( "leaves the ground as the edits made at once do, however many come while one is worked out", async () => {
    const base  = { ...newFormation( ring( 0 ) ), peakWidth: 30, thermal: { on: true, amount: 0.5, iterations: 12, repose: 30 } };
    const edits = [base, { ...base, points: ring( 6 ) }, { ...base, points: ring( 12 ), height: 40 }, { ...base, points: ring( -5 ), roughness: 2 }];
    ground();
    for ( const s of edits ) previewShape( s );
    const once = terrain.chunks[0].heights.slice();
    ground();
    // ( a new edit each frame or so: most arrive while the one before is still being worked out )
    for ( const s of edits ) {
      previewShapeSoon( s );
      await new Promise( ( r ) => setTimeout( r, 2 ) );
    }
    await new Promise<void>( ( r ) => whenShapesSettled( r ) );
    // ( the same to a float's last bit or so: at once, each edit's ground is stored on the way, rounded )
    const H  = terrain.chunks[0].heights;
    let most = 0;
    for ( let k = 0; k < H.length; k++ ) most = Math.max( most, Math.abs( H[k] - once[k] ) );
    expect( most ).toBeLessThan( 1e-4 );
    // ( and the formation is in it )
    expect( Math.max( ...H ) ).toBeGreaterThan( 50 );
  } );
} );
