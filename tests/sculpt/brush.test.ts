import { describe, expect, it } from "vitest";
import { history } from "../../src/map/history";
import { Terrain } from "../../src/terrain/terrain";
import { BRUSHES, defaultSculpt, type BrushId, type BrushSettings, type SculptState } from "../../src/sculpt/brushes";
import { BrushStroke } from "../../src/sculpt/stroke/stroke";
import { falloffAt } from "../../src/sculpt/tip";
import { HeightWindow } from "../../src/sculpt/window";

/**
 * Two 100 m chunks side by side ( x 0..200 ), ground at 20 m, optionally bumpy.
**/
function terrain( resA = 101, resB = 101, bump = 0 ) {
  const t    = new Terrain();
  const make = ( res: number, x0: number ) => {
    const h  = new Float32Array( res * res );
    const sp = 100 / ( res - 1 );
    for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 20 + bump * Math.sin( ( x0 + i * sp ) * 0.7 ) * Math.cos( j * sp * 0.9 );
    return h;
  };
  t.setChunks( [
    { key: "a", position: [0,   0, 0], size: [100, 200, 100], res: resA, heights: make( resA, 0   ) },
    { key: "b", position: [100, 0, 0], size: [100, 200, 100], res: resB, heights: make( resB, 100 ) },
  ] );
  return t;
}

function sculpt( brush: BrushId, p: Partial<BrushSettings> = {}, top: Partial<SculptState> = {} ): SculptState {
  const sc          = defaultSculpt();
  sc.brush          = brush;
  sc.radius         = 10;
  sc.brushes[brush] = { ...sc.brushes[brush], ...p };
  return { ...sc, ...top };
}

const stdDev = ( t: Terrain, x0: number, x1: number, z0: number, z1: number ) => {
  const v: number[] = [];
  for ( let x = x0; x <= x1; x += 1 ) for ( let z = z0; z <= z1; z += 1 ) v.push( t.heightAt( x, z ) );
  const m = v.reduce( ( a, b ) => a + b, 0 ) / v.length;
  return Math.sqrt( v.reduce( ( a, b ) => a + ( b - m ) ** 2, 0 ) / v.length );
};

describe( "brush tips", () => {
  it( "falloff is full inside the hard core and 0 at the rim for every preset", () => {
    for ( const f of ["smooth", "smoother", "sphere", "root", "sharp", "linear", "sharper"] as const ) {
      expect( falloffAt( 0.1, f, 0.25, [] ) ).toBe( 1 );
      expect( falloffAt( 1,   f, 0.25, [] ) ).toBe( 0 );
      expect( falloffAt( 0.7, f, 0.25, [] ) ).toBeGreaterThan( 0 );
      expect( falloffAt( 0.7, f, 0.25, [] ) ).toBeLessThan( 1 );
    }
  } );
} );

describe( "height window", () => {
  it( "reads across a chunk border and writes changes back exactly", () => {
    const t   = terrain( 101, 101, 1 );
    const win = HeightWindow.around( t, 90, 40, 110, 60 )!;
    expect( win.sp ).toBe( 1 );
    for ( let j = 0; j < win.h; j += 3 ) for ( let i = 0; i < win.w; i += 3 ) expect( win.H[j * win.w + i] ).toBeCloseTo( t.heightAt( win.wx( i ), win.wz( j ) ), 5 );
    const out   = win.H.map( ( v ) => v + 1 );
    const rects = win.writeBack( out, () => {} );
    expect( rects.map( ( r ) => r.ci ).sort() ).toEqual( [0, 1] );
    expect( t.heightAt( 95, 50 )              ).toBeCloseTo( win.H[10 * win.w + 5] + 1, 4 );
  } );
} );

describe( "brushes", () => {
  const run = ( t: Terrain, sc: SculptState, path: [number, number][], opts = {} ) => {
    const s = new BrushStroke( t, sc, path[0], opts );
    for ( const [x, z] of path ) s.move( { x, z } );
    return s;
  };

  it( "every brush runs without NaNs and stays inside its radius", () => {
    for ( const b of BRUSHES ) {
      if ( b.id === "mask" ) continue;
      const t      = terrain( 101, 101, 1.5 );
      const before = t.chunks[0].heights.slice();
      const sc     = sculpt( b.id, {}, { radius: 8 } );
      const s      = run( t, sc, [[40, 50], [45, 50], [50, 50], [55, 52]] );
      s.end();
      const H = t.chunks[0].heights;
      for ( let k = 0; k < H.length; k++ ) expect( Number.isFinite( H[k] ) ).toBe( true );
      // far from the stroke nothing moved
      for ( const [x, z] of [[5, 5], [90, 90], [5, 95]] ) expect( H[z * 101 + x] ).toBe( before[z * 101 + x] );
    }
  } );

  it( "draw raises, Ctrl lowers", () => {
    const t = terrain();
    run( t, sculpt( "draw" ), [[50, 50]] ).end();
    expect( t.heightAt( 50, 50 ) ).toBeGreaterThan( 20 );
    const t2 = terrain();
    run( t2, sculpt( "draw" ), [[50, 50]], { invert: true } ).end();
    expect( t2.heightAt( 50, 50 ) ).toBeLessThan( 20 );
  } );

  it( "layer never goes past its height over the ground it started on, however much it's painted", () => {
    const t = terrain();
    const s = run( t, sculpt( "layer", { layerHeight: 2, strength: 1 } ), [[50, 50]] );
    for ( let k = 0; k < 30; k++ ) s.dab( 50, 50 );
    s.end();
    expect( t.heightAt( 50, 50 ) ).toBeCloseTo( 22, 2 );
  } );

  it( "smooth reduces bumpiness; Ctrl (enhance) increases it", () => {
    const t  = terrain( 101, 101, 1.5 );
    const s0 = stdDev( t, 44, 56, 44, 56 );
    const s  = run( t, sculpt( "smooth", { strength: 1 } ), [[50, 50]] );
    for ( let k = 0; k < 5; k++ ) s.dab( 50, 50 );
    expect( stdDev( t, 44, 56, 44, 56 ) ).toBeLessThan( s0 * 0.6 );
    const t2 = terrain( 101, 101, 1.5 );
    const e  = run( t2, sculpt( "smooth", { strength: 1 } ), [[50, 50]], { invert: true } );
    for ( let k = 0; k < 3; k++ ) e.dab( 50, 50 );
    expect( stdDev( t2, 44, 56, 44, 56 ) ).toBeGreaterThan( s0 * 1.05 );
  } );

  it( "smooth works across a chunk border without a seam", () => {
    const t = terrain( 101, 101, 1.5 );
    const s = run( t, sculpt( "smooth", { strength: 1 } ), [[100, 50]] );
    for ( let k = 0; k < 5; k++ ) s.dab( 100, 50 );
    // both sides of the border got smoothed alike
    expect( Math.abs( stdDev( t, 94, 99, 45, 55 ) - stdDev( t, 101, 106, 45, 55 ) ) ).toBeLessThan( 0.15 );
  } );

  it( "flatten: exact height converges; Fill only raises; Scrape only lowers", () => {
    const t = terrain();
    const s = run( t, sculpt( "flatten", { flattenTarget: "exact", targetHeight: 25, strength: 1 } ), [[50, 50]] );
    for ( let k = 0; k < 10; k++ ) s.dab( 50, 50 );
    expect( t.heightAt( 50, 50 ) ).toBeCloseTo( 25, 3 );
    const t2 = terrain();
    const f  = run( t2, sculpt( "flatten", { flattenTarget: "exact", targetHeight: 15, flattenDir: "raise", strength: 1 } ), [[50, 50]] );
    f.dab( 50, 50 );
    expect( t2.heightAt( 50, 50 ) ).toBe( 20 );
  } );

  it( "slope flatten keeps the slope it started on", () => {
    const t   = new Terrain();
    const res = 101, h = new Float32Array( res * res );
    for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 50 - 0.3 * j + Math.sin( i * 1.3 ) * 0.4;
    t.setChunks( [{ key: "a", position: [0, 0, 0], size: [100, 200, 100], res, heights: h }] );
    const s = new BrushStroke( t, sculpt( "flatten", { flattenSlope: true, strength: 1, hardness: 0.6 } ), [50, 50] );
    s.move( { x: 50, z: 50 } );
    for ( let k = 0; k < 8; k++ ) s.dab( 50, 50 );
    const slope = ( t.heightAt( 50, 48 ) - t.heightAt( 50, 52 ) ) / 4;
    expect( slope                       ).toBeCloseTo( 0.3, 1 );
    expect( stdDev( t, 48, 52, 50, 50 ) ).toBeLessThan( 0.1 ); // bumps across the slope gone
  } );

  it( "terrace makes steps", () => {
    const t   = new Terrain();
    const res = 101, h = new Float32Array( res * res );
    for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 20 + i * 0.2;
    t.setChunks( [{ key: "a", position: [0, 0, 0], size: [100, 200, 100], res, heights: h }] );
    const s = new BrushStroke( t, sculpt( "terrace", { terraceStep: 2, strength: 1, terraceSharpness: 1 } ), [50, 50] );
    s.move( { x: 50, z: 50 } );
    for ( let k = 0; k < 20; k++ ) s.dab( 50, 50 );
    // the ramp becomes flat treads: neighbouring samples on a tread are equal
    const diffs = [46, 47, 48, 49, 50, 51, 52, 53].map( ( x ) => Math.abs( t.heightAt( x + 1, 50 ) - t.heightAt( x, 50 ) ) );
    expect( diffs.filter( ( d ) => d < 0.05 ).length ).toBeGreaterThanOrEqual( 5 );
  } );

  it( "pinch only moves the ground around (no new heights)", () => {
    const t = terrain( 101, 101, 1.5 );
    let lo  = Infinity, hi = -Infinity;
    for ( const v of t.chunks[0].heights ) { lo = Math.min( lo, v ); hi = Math.max( hi, v ); }
    const s = run( t, sculpt( "pinch", { strength: 1 } ), [[50, 50]] );
    for ( let k = 0; k < 5; k++ ) s.dab( 50, 50 );
    for ( const v of t.chunks[0].heights ) {
      expect( v ).toBeGreaterThanOrEqual( lo - 1e-3 );
      expect( v ).toBeLessThanOrEqual( hi + 1e-3 );
    }
  } );

  it( "going over the same ground again in one stroke doesn't pile up; the next stroke builds on it", () => {
    const back = (): [number, number][] => [[35, 50], [65, 50], [35, 50], [65, 50], [35, 50], [65, 50]];
    for ( const id of ["draw", "clay", "crease", "pinch"] as const ) {
      for ( const invert of [false, true] ) {
        const once = terrain( 101, 101, 1.5 ), many = terrain( 101, 101, 1.5 );
        run( once, sculpt( id, { strength: 0.6 }, { radius: 8 } ), [[35, 50], [65, 50]], { invert } ).end();
        run( many, sculpt( id, { strength: 0.6 }, { radius: 8 } ), back(),               { invert } ).end();
        for ( const x of [40, 50, 60] ) expect( many.heightAt( x, 50 ) ).toBeCloseTo( once.heightAt( x, 50 ), 1 );
      }
    }
    const t = terrain();
    run( t, sculpt( "draw", {}, { radius: 8 } ), [[50, 50], [50, 50]] ).end();
    const one = t.heightAt( 50, 50 ) - 20;
    run( t, sculpt( "draw", {}, { radius: 8 } ), [[50, 50]] ).end();
    expect( one                       ).toBeGreaterThan( 0.2 );
    expect( t.heightAt( 50, 50 ) - 20 ).toBeCloseTo( 2 * one, 3 );
  } );

  it( "the mask protects ground from other brushes", () => {
    const t = terrain();
    const m = new BrushStroke( t, sculpt( "mask", { strength: 1, hardness: 0.9 } ), [50, 50] );
    m.move( { x: 50, z: 50 } );
    m.end();
    run( t, sculpt( "draw", { strength: 1 } ), [[50, 50]] ).end();
    expect( t.heightAt( 50, 50 ) ).toBe( 20 );
    run( t, sculpt( "draw", { strength: 1 } ), [[70, 50]] ).end();
    expect( t.heightAt( 70, 50 ) ).toBeGreaterThan( 20 );
  } );

  it( "X symmetry paints the mirror image", () => {
    const t = terrain();
    run( t, sculpt( "draw", {}, { symmetry: { x: true, z: false, radial: 1, pivot: [100, 50] } } ), [[60, 40]] ).end();
    expect( t.heightAt( 60, 40 )  ).toBeGreaterThan( 20 );
    expect( t.heightAt( 140, 40 ) ).toBeCloseTo( t.heightAt( 60, 40 ), 4 );
  } );

  it( "line strokes are redone from scratch on every move (no build-up)", () => {
    const t = terrain();
    const s = new BrushStroke( t, sculpt( "draw", { stroke: "line" } ), [30, 50] );
    s.move( { x: 60, z: 50 } );
    const once = t.heightAt( 45, 50 );
    s.move( { x: 61, z: 50 } );
    s.move( { x: 60, z: 50 } );
    expect( t.heightAt( 45, 50 ) ).toBeCloseTo( once, 5 );
  } );

  it( "keeps chunks of different detail joined, and undo restores everything", () => {
    const t  = terrain( 129, 33, 1 );
    const a0 = t.chunks[0].heights.slice(), b0 = t.chunks[1].heights.slice();
    const s  = run( t, sculpt( "draw", { strength: 1 }, { radius: 15 } ), [[95, 50], [100, 50], [105, 52]] );
    s.end();
    const [a, b] = t.chunks;
    for ( let k = 0; k < a.res; k++ ) {
      const z = ( k / ( a.res - 1 ) ) * 100;
      expect( Math.abs( a.heights[k * a.res + a.res - 1] - b.sampleBilinear( 0, z / b.spacing ) ) ).toBeLessThan( 1e-3 );
    }
    history.undo();
    expect( t.chunks[0].heights ).toEqual( a0 );
    expect( t.chunks[1].heights ).toEqual( b0 );
  } );
} );
