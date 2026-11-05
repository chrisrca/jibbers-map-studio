import { describe, expect, it } from "vitest";

const { terrain }                                                    = await import( "../../src/terrain/terrain" );
const { bakeShapeIn, newFormation, previewShape, removeShape, resetShapes, setRockLayers } = await import( "../../src/terrain/shapes/shapes" );

// one flat 200 m chunk, 1 m apart, and its snow mask ( 200 pixels a side, all snow )
const m     = 200;
const layer = { m, rgba: new Uint8Array( m * m * 4 ).fill( 255 ) };
let told    = 0;
setRockLayers( { layerOf: () => layer, four: () => {}, ensure: async () => layer, changed: () => void told++ } );

function ground() {
  const res = 201;
  terrain.setChunks( [{ key: "a", position: [-100, 0, -100], size: [200, 200, 200], res, heights: new Float32Array( res * res ).fill( 20 ) }] );
  resetShapes();
  layer.rgba.fill( 255 );
}

const ring  = ( r: number ) => Array.from( { length: 12 }, ( _, k ) => [Math.cos( ( k / 12 ) * Math.PI * 2 ) * r, Math.sin( ( k / 12 ) * Math.PI * 2 ) * r] as [number, number] );
const snow  = ( r: number ) => { const s = newFormation( ring( r ) ); return { ...s, height: 50, peakWidth: 20, snow: { ...s.snow, on: true } }; };
const rocky = () => { let n = 0; for ( let k = 0; k < m * m; k++ ) if ( layer.rgba[k * 4] < 128 ) n++; return n; };

describe( "a formation's rock", () => {
  it( "is painted into the snow mask on its steep sides, and taken out again with it", () => {
    ground();
    const s = snow( 50 );
    previewShape( s );
    const n = rocky();
    expect( n ).toBeGreaterThan( 500 );
    expect( told ).toBeGreaterThan( 0 );
    // ( its level top keeps its snow )
    expect( layer.rgba[( 100 * m + 100 ) * 4] ).toBe( 255 );
    // changed: the old rock out, the new in ( a smaller one has less )
    previewShape( { ...snow( 30 ), uid: s.uid } );
    expect( rocky() ).toBeLessThan( n );
    removeShape( s.uid );
    expect( rocky() ).toBe( 0 );
    expect( layer.rgba.every( ( v ) => v === 255 ) ).toBe( true );
  } );

  it( "leaves what's painted over it afterwards", () => {
    ground();
    const s = snow( 50 );
    previewShape( s );
    // ( a rock pixel painted back to snow by hand )
    let k = 0;
    while ( layer.rgba[k * 4] >= 128 ) k++;
    layer.rgba[k * 4] = 200;
    removeShape( s.uid );
    expect( layer.rgba[k * 4] ).toBe( 200 );
  } );
} );

describe( "a formation switched off, and one baked in", () => {
  it( "off, it's not on the ground; on again, it is", () => {
    ground();
    const s = snow( 50 );
    previewShape( s );
    const up = terrain.heightAt( 0, 0 );
    previewShape( { ...s, enabled: false } );
    expect( terrain.heightAt( 0, 0 ) ).toBeCloseTo( 20, 3 );
    expect( rocky() ).toBe( 0 );
    previewShape( s );
    expect( terrain.heightAt( 0, 0 ) ).toBeCloseTo( up, 3 );
  } );

  it( "baked in, its ground stays though the formation's gone; undone, it's the formation's again", () => {
    ground();
    const s = snow( 50 );
    previewShape( s );
    const up = terrain.heightAt( 0, 0 ), n = rocky();
    const b  = bakeShapeIn( s.uid );
    removeShape( s.uid );
    expect( terrain.heightAt( 0, 0 ) ).toBeCloseTo( up, 3 );
    expect( rocky() ).toBe( n );
    b.undo();
    removeShape( s.uid );
    expect( terrain.heightAt( 0, 0 ) ).toBeCloseTo( 20, 3 );
  } );
} );
