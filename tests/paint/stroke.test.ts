import { beforeEach, describe, expect, it } from "vitest";
import { terrain } from "../../src/terrain/terrain";
import { DEFAULT_PAINT, ensureLayer, PaintStroke, resetPaint, type PaintSettings } from "../../src/paint/ground";

// one flat 64 m chunk, 0.5 m apart, all snow
beforeEach( () => {
  resetPaint();
  const res = 129;
  terrain.setChunks( [{ key: "a", position: [0, 0, 0], size: [64, 100, 64], res, heights: new Float32Array( res * res ).fill( 10 ) }] );
} );

// rock painted where the ground brush went, as Ctrl paints it
const rock = async ( s: Partial<PaintSettings>, path: [number, number][] ) => {
  const st = new PaintStroke( { ...DEFAULT_PAINT, tool: "snow", radius: 1.5, strength: 1, hardness: 1, ...s }, true );
  for ( const [x, z] of path ) await st.move( x, z );
};
const snowAt = async ( x: number, z: number ) => {
  const L = await ensureLayer( terrain.chunks[0] ), px = 64 / L.m;
  return L.rgba[( Math.floor( z / px ) * L.m + Math.floor( x / px ) ) * 4];
};

describe( "the ground brush's stroke", () => {
  it( "mirrored left ↔ right about the map's middle", async () => {
    await rock( { symmetry: { x: true, z: false, radial: 1, pivot: null } }, [[10, 20], [10, 30]] );
    expect( await snowAt( 10, 25 ) ).toBe( 0 );
    expect( await snowAt( 54, 25 ) ).toBe( 0 );
    expect( await snowAt( 32, 25 ) ).toBe( 255 );
  } );

  it( "radial copies round a centre of its own", async () => {
    await rock( { symmetry: { x: false, z: false, radial: 4, pivot: [32, 32] } }, [[32, 12], [33, 12]] );
    for ( const [x, z] of [[32, 12], [52, 32], [32, 52], [12, 32]] ) expect( await snowAt( x, z ) ).toBe( 0 );
  } );

  it( "stripes: copies side by side across the stroke, spacing apart", async () => {
    await rock( { stripes: { count: 3, spacing: 8 } }, [[32, 10], [32, 40]] );
    for ( const x of [24, 32, 40] ) expect( await snowAt( x, 30 ) ).toBe( 0 );
    expect( await snowAt( 28, 30 ) ).toBe( 255 );
    expect( await snowAt( 46, 30 ) ).toBe( 255 );
  } );

  it( "stabilized: the brush waits until the cursor pulls it ( a twitch paints nothing new )", async () => {
    await rock( { stabilize: 3 }, [[20, 20], [20, 23], [23, 20]] );
    expect( await snowAt( 20, 20 ) ).toBe( 0 );
    expect( await snowAt( 20, 23 ) ).toBe( 255 );
    await rock( { stabilize: 0 }, [[40, 20], [40, 23]] );
    expect( await snowAt( 40, 23 ) ).toBe( 0 );
  } );
} );
