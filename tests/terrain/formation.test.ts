import { describe, expect, it } from "vitest";
import { applyPreset, fitFormation, formationGrid, insideBy, migrateFormation, newFormation, type FormationShape } from "../../src/terrain/shapes/shapes";
import { shapeHeightAt } from "../../src/terrain/shapes/shapes";
import { effectiveOctaves, formationAt, formationFrame, peakPoint, type FormationGrid } from "../../src/terrain/shapes/shapes/formation";

// a 200 m square outline round the origin, over flat ground at 10 m ( worked out 2 m apart: quick here )
const square: [number, number][] = [[-100, -100], [100, -100], [100, 100], [-100, 100]];
const flat                       = () => 10;
const plain                      = ( p: Partial<FormationShape> = {} ): FormationShape => ( { ...newFormation( square ), roughness: 0, smooth: 0, ...p } );
const grid                       = ( s: FormationShape, ground: ( x: number, z: number ) => number = flat, full = true ): FormationGrid => formationGrid( s, ground, full, formationFrame( s, 2 ) );
const at                         = ( s: FormationShape, x: number, z: number, ground: ( x: number, z: number ) => number = flat ) => {
  grid( s, ground, false );
  return formationAt( s, x, z, ground );
};
const sample = ( g: FormationGrid, A: Float32Array, x: number, z: number ) => A[Math.round( ( z - g.z0 ) / g.sp ) * g.w + Math.round( ( x - g.x0 ) / g.sp )];

describe( "a formation", () => {
  it( "knows inside from outside its outline, and its deepest point", () => {
    expect( insideBy( square, 0, 0 )   ).toBeCloseTo( 100, 5 );
    expect( insideBy( square, 150, 0 ) ).toBeCloseTo( -50, 5 );
    expect( peakPoint( square ).reach ).toBeCloseTo( 100, 5 );
  } );

  it( "added on top: its height at the peak, nothing outside, blended in from its edge", () => {
    const s = plain( { height: 30 } );
    expect( at( s, 0, 0 )!.h ).toBeCloseTo( 40, 1 );
    expect( at( s, 0, 0 )!.blend ).toBe( 1 );
    expect( at( s, 150, 0 ) ).toBeNull();
    const edge = at( s, 96, 0 )!;
    expect( edge.blend ).toBeGreaterThan( 0 );
    expect( edge.blend ).toBeLessThan( 1 );
  } );

  it( "rises along its profile: ease-in-out by default, a straight one half way up half way in", () => {
    const linear = plain( { height: 40, profile: [{ t: 0, v: 0 }, { t: 1, v: 1 }] } );
    expect( at( linear, 50, 0 )!.h ).toBeCloseTo( 30, 0 );
    // ( Unity's EaseInOut: level at its ends, a quarter of the way in a sixth of the height or so )
    expect( at( plain( { height: 40 } ), 75, 0 )!.h ).toBeCloseTo( 10 + 40 * 0.15625, 0 );
  } );

  it( "raise never lowers the ground, carve never raises it, set builds from the ground at the outline's points", () => {
    const hill = ( x: number ) => 10 + x * 0.3;
    for ( const x of [-80, -20, 0, 40, 80] ) {
      expect( at( plain( { mode: "raise", height: 5 } ), x, 0, hill )!.h ).toBeGreaterThanOrEqual( hill( x ) - 1e-3 );
      expect( at( plain( { mode: "carve", height: -5 } ), x, 0, hill )!.h ).toBeLessThanOrEqual( hill( x ) + 1e-3 );
    }
    // ( the rim's mean: 10; the peak 20 over it )
    expect( at( plain( { mode: "set", height: 20 } ), 0, 0, hill )!.h ).toBeCloseTo( 30, 0 );
  } );

  it( "its noise makes it rough, and its seed makes a different roughness", () => {
    const a = at( plain( { roughness: 8, seed: 1 } ), 30, 30 )!.h, b = at( plain( { roughness: 8, seed: 2 } ), 30, 30 )!.h;
    expect( a ).not.toBeCloseTo( b, 2 );
  } );

  it( "keeps its noise to the octaves the samples can show", () => {
    expect( effectiveOctaves( plain( { featureSize: 60, detail: 9 } ), 0.25 ) ).toBe( 7 );
    expect( effectiveOctaves( plain( { featureSize: 60, detail: 4 } ), 0.25 ) ).toBe( 4 );
    expect( effectiveOctaves( plain( { featureSize: 0.5 } ), 0.25 ) ).toBe( 1 );
  } );

  it( "thermal erosion slumps its steep sides towards their angle", () => {
    const steepest = ( s: FormationShape ) => {
      const g  = grid( s );
      let most = 0;
      for ( let j = 1; j < g.h - 1; j++ ) for ( let i = 1; i < g.w - 1; i++ ) most = Math.max( most, Math.abs( g.y[j * g.w + i + 1] - g.y[j * g.w + i] ) / g.sp );
      return most;
    };
    const sharp = plain( { height: 80, peakWidth: 10, edgeBlend: 0 } );
    expect( steepest( { ...sharp, thermal: { on: true, amount: 1, iterations: 200, repose: 30 } } ) ).toBeLessThan( steepest( sharp ) );
  } );

  it( "hydraulic erosion changes the ground, keeping it whole ( nothing that isn't a number, nothing far off )", () => {
    const rough = plain( { height: 40, roughness: 10, peakWidth: 100 } );
    const g     = grid( { ...rough, hydraulic: { ...rough.hydraulic, on: true } } ), g0 = grid( rough );
    let diff    = 0;
    for ( let q = 0; q < g.y.length; q++ ) {
      expect( Number.isFinite( g.y[q] ) ).toBe( true );
      diff = Math.max( diff, Math.abs( g.y[q] - g0.y[q] ) );
    }
    expect( diff ).toBeGreaterThan( 0.01 );
    expect( diff ).toBeLessThan( 40 );
  } );

  it( "snowfall shows rock on its steep sides, none on its level top or outside it", () => {
    const s = plain( { height: 60, peakWidth: 40, snow: { ...newFormation( square ).snow, on: true } } );
    const g = grid( s );
    expect( sample( g, g.rock, 0, 0 ) ).toBeLessThan( 0.05 );
    expect( sample( g, g.rock, 110, 0 ) ).toBe( 0 );
    expect( Math.max( ...g.rock ) ).toBeGreaterThan( 0.5 );
    // ( and the snow adds its depth where it lies )
    expect( sample( g, g.y, 0, 0 ) ).toBeGreaterThan( 70 + 0.4 * 1.2 - 0.05 );
  } );

  it( "under its snow line it holds no snow: rock all over", () => {
    const s = plain( { height: 20, snow: { ...newFormation( square ).snow, on: true, lineLow: 500, lineHigh: 600 } } );
    const g = grid( s );
    expect( sample( g, g.rock, 0, 0 ) ).toBeCloseTo( 1, 3 );
  } );

  it( "is a terrain shape: picked inside its outline", () => {
    expect( shapeHeightAt( plain( { height: 30 } ), 0, 0 ) ).not.toBeNull();
    expect( shapeHeightAt( plain( { height: 30 } ), 150, 0 ) ).toBeNull();
  } );
} );

describe( "a formation's presets", () => {
  it( "are Map-Tools' own, fitted to the outline", () => {
    // ( a 100 m deep outline: Map-Tools' presets are made for one that deep, nothing scaled )
    const m = applyPreset( newFormation( square ), "Mountain" );
    expect( [m.name, m.mode, m.style, m.height, m.roughness, m.featureSize, m.detail, m.peakWidth] ).toEqual( ["Mountain", "add", "ridged", 70, 26, 55, 6, 100] );
    expect( [m.thermal.on, m.thermal.iterations, m.hydraulic.on, m.hydraulic.lifetime, m.hydraulic.droplets, m.snow.on, m.snow.crevices] ).toEqual( [true, 50, true, 350, 0.7, true, 0.6] );
    const c = applyPreset( newFormation( square ), "Crater" );
    expect( [c.mode, c.height, c.hydraulic.on, c.seed] ).toEqual( ["carve", -30, false, 0] );
  } );

  it( "fitting scales the shape with the outline, the height kept under the ground's range", () => {
    const half: [number, number][] = square.map( ( [x, z] ) => [x / 2, z / 2] );
    const f                        = fitFormation( { ...newFormation( half ), height: 40, featureSize: 60, edgeBlend: 20, peakWidth: 100 } );
    expect( [f.peakWidth, f.height, f.featureSize, f.edgeBlend, f.hydraulic.lifetime, f.fitted] ).toEqual( [50, 20, 30, 10, 125, true] );
    const big = fitFormation( { ...newFormation( square.map( ( [x, z] ) => [x * 4, z * 4] ) ), height: 70 } );
    expect( big.height ).toBe( 90 );
  } );

  it( "a formation from before gets Map-Tools' settings, as near as they go", () => {
    const old = { uid: "a", kind: "formation", name: "Old", points: square, mode: "raise", style: "ridged", height: 25, baseY: 0, featureSize: 60, roughness: 6, detail: 5, lacunarity: 2, gain: 0.5, onPeak: 0.5, warp: 0.3, seed: 3, edgeBlend: 20, peakWidth: 0, smooth: 2, smoothSteps: 1, thermal: { on: true, amount: 0.5, iterations: 30, repose: 35 }, hydraulic: { on: false, droplets: 0.5, lifetime: 60, inertia: 0.3, capacity: 4, erode: 0.3, deposit: 0.3, evaporate: 0.02, radius: 2 } } as unknown as FormationShape;
    const m   = migrateFormation( old );
    expect( [m.v, m.mode, m.style, m.seed, m.peakWidth, m.smooth, m.snow.on, m.thermal.iterations, m.profile.length] ).toEqual( [2, "raise", "ridged", 3, 100, 0.5, false, 30, 2] );
    expect( migrateFormation( m ) ).toBe( m );
  } );
} );
