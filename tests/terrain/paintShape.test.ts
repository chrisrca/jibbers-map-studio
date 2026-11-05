import { describe, expect, it } from "vitest";

const { terrain }                                                                         = await import( "../../src/terrain/terrain" );
const { packShape, previewShape, removeShape, resetShapes, setRockLayers, unpackShape } = await import( "../../src/terrain/shapes/shapes" );
import type { PaintShape } from "../../src/terrain/shapes/shapes";

// one flat 200 m chunk, its mask 200 pixels a side: all snow, nothing marked
const m     = 200;
const layer = { m, rgba: new Uint8Array( m * m * 4 ) };
let fours   = 0;
setRockLayers( { layerOf: () => layer, four: () => void fours++, ensure: async () => layer, changed: () => {} } );

function ground() {
  const res = 201;
  terrain.setChunks( [{ key: "a", position: [-100, 0, -100], size: [200, 200, 200], res, heights: new Float32Array( res * res ).fill( 20 ) }] );
  resetShapes();
  for ( let k = 0; k < m * m; k++ ) layer.rgba.set( [255, 0, 0, 0], k * 4 );
}

const stroke = ( p: Partial<PaintShape> = {} ): PaintShape => ( {
  uid: "p1", kind: "paint", name: "Stripe", start: [0, -50], end: [0, 50], width: 10,
  along: [{ t: 0, v: 1 }, { t: 1, v: 1 }], repeats: 1, repeatScaling: 1, cross: [{ t: 0, v: 1 }, { t: 1, v: 1 }],
  target: "marking", colour: 11, depth: 1, erase: false, coverage: 1, ...p,
} );
// ( the pixel at a point: chunk −100..100, a metre a pixel, row 0 at −Z )
const at = ( x: number, z: number ) => layer.rgba.subarray( ( ( z + 100 ) * m + x + 100 ) * 4, ( ( z + 100 ) * m + x + 100 ) * 4 + 4 );

describe( "a paint stroke ( Map-Tools' paint insert )", () => {
  it( "marks its colour inside it, nothing outside, and comes out again", () => {
    ground();
    previewShape( stroke() );
    expect( [...at( 1, 0 )] ).toEqual( [255, Math.round( 0.6 * 255 ), 255, 0] );
    expect( [...at( 20, 0 )] ).toEqual( [255, 0, 0, 0] );
    expect( fours ).toBeGreaterThan( 0 );
    removeShape( "p1" );
    expect( [...at( 1, 0 )] ).toEqual( [255, 0, 0, 0] );
  } );

  it( "paints rock ( snow erased ) and powder by how much it covers", () => {
    ground();
    previewShape( stroke( { target: "snow", erase: true, coverage: 0.5 } ) );
    expect( at( 0, 10 )[0] ).toBe( 128 );
    ground();
    previewShape( stroke( { target: "powder", depth: 0.4 } ) );
    expect( at( 0, 10 )[3] ).toBe( 102 );
  } );

  it( "kept with the project: taken out again after it's opened", () => {
    ground();
    previewShape( stroke() );
    const bytes = packShape( "p1" )!;
    const kept  = layer.rgba.slice();
    resetShapes();
    layer.rgba.set( kept );
    unpackShape( "p1", bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ) as ArrayBuffer );
    removeShape( "p1" );
    expect( [...at( 1, 0 )] ).toEqual( [255, 0, 0, 0] );
  } );
} );
