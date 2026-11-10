import { describe, expect, it } from "vitest";

const { terrain }                                     = await import( "../../src/terrain/terrain" );
const { newCircle, newCurve, newSkiLine, previewShape, resetShapes } = await import( "../../src/terrain/shapes/shapes" );
const { fillUnder, unbakeShapes }                     = await import( "../../src/terrain/shapes/unbake" );

// one 200 m chunk, 1 m apart, a plain slope ( 0.2 m a metre along x ) with a gentle swell across it
const slope = ( x: number, z: number ) => 40 + 0.2 * x + 2 * Math.sin( z * 0.03 );
function ground() {
  const res = 201, h = new Float32Array( res * res );
  for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = slope( -100 + i, -100 + j );
  terrain.setChunks( [{ key: "a", position: [-100, 0, -100], size: [200, 200, 200], res, heights: h }] );
  resetShapes();
}

// the shapes worked into the ground and forgotten, as a Unity scene's inserts come in
function bakedIn( ...shapes: ReturnType<typeof newCurve | typeof newCircle | typeof newSkiLine>[] ) {
  ground();
  for ( const s of shapes ) previewShape( s );
  resetShapes();
}

describe( "shapes that came worked into the ground", () => {
  it( "the ground under them worked out again: a slope runs on under as it was", () => {
    const w = 40, h = 30, H = new Float32Array( w * h ), mask = new Uint8Array( w * h );
    for ( let j = 0; j < h; j++ ) for ( let i = 0; i < w; i++ ) H[j * w + i] = 10 + 0.5 * i - 0.25 * j;
    for ( let j = 5; j < 25; j++ ) for ( let i = 8; i < 32; i++ ) { mask[j * w + i] = 1; H[j * w + i] = 99; }
    fillUnder( H, mask, w, h );
    let most = 0;
    for ( let j = 0; j < h; j++ ) for ( let i = 0; i < w; i++ ) most = Math.max( most, Math.abs( H[j * w + i] - ( 10 + 0.5 * i - 0.25 * j ) ) );
    expect( most ).toBeLessThan( 1e-2 );
  } );

  it( "a jump that came in moved: where it was, the slope again; where it's gone, the jump", async () => {
    const jump = { ...newCurve( [-60, 0], [-20, 0] ), width: 14, bump: 4, heightMode: "bump" as const };
    bakedIn( jump );
    const H0 = terrain.chunks[0].heights.slice();
    await unbakeShapes( [jump] );
    // ( taken as made: the heights left as they came )
    expect( terrain.chunks[0].heights ).toEqual( H0 );
    const was = terrain.heightAt( -40, 0 );
    expect( was - slope( -40, 0 ) ).toBeGreaterThan( 1 );
    previewShape( { ...jump, start: [20, 40], end: [60, 40] } );
    expect( Math.abs( terrain.heightAt( -40, 0 ) - slope( -40, 0 ) ) ).toBeLessThan( 0.25 );
    expect( terrain.heightAt( 40, 40 ) - slope( 40, 40 ) ).toBeGreaterThan( 1 );
    // ( a jump made in the studio and moved the same way, for comparison: the same ground where it's gone )
    const unbaked = terrain.heightAt( 40, 40 );
    ground();
    previewShape( jump );
    previewShape( { ...jump, start: [20, 40], end: [60, 40] } );
    expect( Math.abs( terrain.heightAt( 40, 40 ) - unbaked ) ).toBeLessThan( 0.05 );
  } );

  it( "a jump inside a knuckle ( as Main.unity's ): the jump moved, the knuckle stays as the studio lays it", async () => {
    const knuckle = { ...newCurve( [-60, 20], [0, 20] ), width: 18, bump: 2, heightMode: "bump" as const };
    const jump    = { ...newCurve( [-60, 20], [0, 20] ), width: 5, bump: 5, heightMode: "bump" as const };
    bakedIn( knuckle, jump );
    await unbakeShapes( [knuckle, jump] );
    previewShape( { ...jump, start: [-60, 80], end: [0, 80] } );
    const left = terrain.heightAt( -30, 20 );
    // ( the knuckle alone, made in the studio, for comparison )
    ground();
    previewShape( knuckle );
    expect( Math.abs( left - terrain.heightAt( -30, 20 ) ) ).toBeLessThan( 0.25 );
    expect( left - slope( -30, 20 ) ).toBeGreaterThan( 0.5 );
  } );

  it( "a ski line carved in: moved, its ground the slope again where it was", async () => {
    const at   = ( x: number, z: number ) => ( { p: [x, slope( x, z ) - 2, z] as [number, number, number], width: null, roll: 0 } );
    const line = newSkiLine( [at( -60, -40 ), at( -40, 0 ), at( -50, 40 )] );
    bakedIn( line );
    expect( terrain.heightAt( -40, 0 ) - slope( -40, 0 ) ).toBeLessThan( -1.5 );
    await unbakeShapes( [line] );
    previewShape( { ...line, nodes: line.nodes.map( ( n ) => ( { ...n, p: [n.p[0] + 100, n.p[1] + 20, n.p[2]] as [number, number, number] } ) ) } );
    expect( Math.abs( terrain.heightAt( -40, 0 ) - slope( -40, 0 ) ) ).toBeLessThan( 0.25 );
  } );

  it( "two that overlap: each moved on its own takes only its own change with it", async () => {
    const ramp   = { ...newCurve( [-50, -10], [10, -10] ), width: 16, bump: 3, heightMode: "bump" as const };
    const circle = { ...newCircle( [10, -10], 15 ), height: null, depth: 4 };
    bakedIn( ramp, circle );
    await unbakeShapes( [ramp, circle] );
    previewShape( { ...circle, center: [60, 60] } );
    // ( the ramp still there, the circle's ground where the ramp isn't back to the slope )
    expect( terrain.heightAt( -30, -10 ) - slope( -30, -10 ) ).toBeGreaterThan( 0.5 );
    expect( Math.abs( terrain.heightAt( 18, -10 ) - slope( 18, -10 ) ) ).toBeLessThan( 0.5 );
    previewShape( { ...ramp, start: [-50, 70], end: [10, 70] } );
    expect( Math.abs( terrain.heightAt( -30, -10 ) - slope( -30, -10 ) ) ).toBeLessThan( 0.25 );
  } );
} );
