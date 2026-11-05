import { describe, expect, it } from "vitest";

const { terrain }                                                           = await import( "../../src/terrain/terrain" );
const { newFormation, packShape, previewShape, resetShapes, unpackShape } = await import( "../../src/terrain/shapes/shapes" );

// one flat 200 m chunk, 1 m apart
function ground() {
  const res = 201;
  terrain.setChunks( [{ key: "a", position: [-100, 0, -100], size: [200, 200, 200], res, heights: new Float32Array( res * res ).fill( 20 ) }] );
  resetShapes();
}

const ring = ( r: number ) => Array.from( { length: 10 }, ( _, k ) => [Math.cos( ( k / 10 ) * Math.PI * 2 ) * r, Math.sin( ( k / 10 ) * Math.PI * 2 ) * r] as [number, number] );

describe( "a shape's change kept with the project", () => {
  it( "edited after the project's opened again: its old change taken out, not built on", () => {
    const s = { ...newFormation( ring( 40 ) ), height: 30, peakWidth: 30 };
    ground();
    previewShape( { ...s, height: 12 } );
    const fresh = terrain.chunks[0].heights.slice();
    ground();
    previewShape( s );
    // ( saved, and the project opened again: the heights as they were, the shape's change read back )
    const bytes  = packShape( s.uid )!;
    const before = terrain.chunks[0].heights.slice();
    resetShapes();
    terrain.chunks[0].heights.set( before );
    unpackShape( s.uid, bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ) as ArrayBuffer );
    previewShape( { ...s, height: 12 } );
    const H = terrain.chunks[0].heights;
    let most = 0;
    for ( let k = 0; k < H.length; k++ ) most = Math.max( most, Math.abs( H[k] - fresh[k] ) );
    expect( most ).toBeLessThan( 1e-3 );
  } );
} );
