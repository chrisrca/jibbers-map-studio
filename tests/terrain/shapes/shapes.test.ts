import { beforeEach, describe, expect, it } from "vitest";
import { PROFILES } from "../../../src/core/curve";
import { history } from "../../../src/map/history";
import { beginShapeEdit, captureStamp, commitShapeEdit, imprintOf, kickerArc, kickerHeight, lipAngleFor, newCircle, newCurve, newStamp, previewShape, resetShapes } from "../../../src/terrain/shapes/shapes";
import { terrain } from "../../../src/terrain/terrain";

// one flat 100 m chunk at 20 m, 1 m spacing
beforeEach( () => {
  resetShapes();
  const res = 101;
  terrain.setChunks( [{ key: "a", position: [0, 0, 0], size: [100, 200, 100], res, heights: new Float32Array( res * res ).fill( 20 ) }] );
} );

const noop = { undo: () => {}, redo: () => {} };

describe( "terrain shapes", () => {
  it( "a kicker set by lip angle leaves the slope parallel to it and ends at the lip angle", () => {
    for ( const [slopeDeg, len, lip] of [[-17, 6, 25], [-31, 8, 15], [0, 5, 30]] ) {
      const drop    = Math.tan( ( slopeDeg * Math.PI ) / 180 ) * len;
      const k       = kickerArc( len, 100, 100 + drop, lip );
      const surface = ( t: number ) => 100 + drop * t + k( t ); // absolute height along the run
      const angle   = ( t: number ) => ( Math.atan2( surface( t + 1e-4 ) - surface( t - 1e-4 ), 2e-4 * len ) * 180 ) / Math.PI;
      expect( k( 0 )            ).toBeCloseTo( 0,        6 );
      expect( angle( 1e-3 )     ).toBeCloseTo( slopeDeg, 0 );
      expect( angle( 1 - 1e-3 ) ).toBeCloseTo( lip,      0 );
      expect( k( 1 )            ).toBeGreaterThan( 0 );
    }
  } );

  it( "a kicker's height gives back the lip angle that makes it", () => {
    for ( const [drop, lip] of [[-3, 25], [-6, 40], [0, 15], [1, 30]] ) {
      const s = { ...newCurve( [50, 10], [50, 22] ), startHeight: 100, endHeight: 100 + drop, lipAngle: lip };
      const h = kickerHeight( s, () => 0 );
      expect( lipAngleFor( s, h, () => 0 ) ).toBeCloseTo( lip, 6 );
      expect( kickerHeight( { ...s, lipAngle: lipAngleFor( s, h + 0.5, () => 0 ) }, () => 0 ) ).toBeCloseTo( h + 0.5, 6 );
    }
  } );

  it( "an object pressed in: its top exactly under it, the ground sloping up to it around it", () => {
    // a 10 × 6 m box top at 23 m ( two triangles ), turned 30° so its outline crosses the samples
    const a    = Math.PI / 6, c = Math.cos( a ), s = Math.sin( a );
    const at   = ( x: number, z: number ) => [50 + x * c - z * s, 23, 50 + x * s + z * c];
    const tris = [...at( -5, -3 ), ...at( 5, -3 ), ...at( 5, 3 ), ...at( -5, -3 ), ...at( 5, 3 ), ...at( -5, 3 )];
    const imp  = imprintOf( tris, 1, 4 )!;
    expect( imp.grid.spacing ).toBe( 1 );
    const shape = { ...newStamp( imp.center, imp.grid, false, "Imprint" ), blend: 2 };
    previewShape( shape );
    expect( terrain.heightAt( 50, 50 ) ).toBeCloseTo( 23, 3 );
    const out = ( d: number ) => terrain.heightAt( 50 + ( 5 + d ) * c, 50 + ( 5 + d ) * s ); // straight out from one end
    expect( out( -0.5 ) ).toBeCloseTo( 23, 2 );
    expect( out( 1    ) ).toBeGreaterThan( 20.5 );
    expect( out( 1    ) ).toBeLessThan( 23 );
    expect( out( 3    ) ).toBeCloseTo( 20, 5 ); // beyond the blend: untouched
  } );

  it( "a ramp curve goes from the start height to the end height", () => {
    const s = { ...newCurve( [50, 10], [50, 90] ), startHeight: 20, endHeight: 30, edgeBlend: 0, width: 10 };
    previewShape( s );
    expect( terrain.heightAt( 50, 10 ) ).toBeCloseTo( 20,     3 );
    expect( terrain.heightAt( 50, 50 ) ).toBeCloseTo( 25,     3 );
    expect( terrain.heightAt( 50, 89 ) ).toBeCloseTo( 29.875, 2 );
    expect( terrain.heightAt( 30, 50 ) ).toBeCloseTo( 20,     5 ); // outside the width: untouched
  } );

  it( "editing replaces the shape's own change, and undo restores it exactly", () => {
    const s  = { ...newCurve( [50, 10], [50, 90] ), startHeight: 20, endHeight: 30, edgeBlend: 0 };
    const e1 = beginShapeEdit( s.uid );
    previewShape( s );
    commitShapeEdit( e1, "create", noop );
    const at = terrain.heightAt( 50, 50 );

    const e2 = beginShapeEdit( s.uid );
    previewShape( { ...s, profile: PROFILES.kicker.curve, endHeight: 40 } );
    commitShapeEdit( e2, "edit", noop );
    expect( terrain.heightAt( 50, 50 ) ).not.toBeCloseTo( at, 2 );

    history.undo();
    expect( terrain.heightAt( 50, 50 ) ).toBeCloseTo( at, 5 );
    history.undo();
    expect( terrain.heightAt( 50, 50 ) ).toBeCloseTo( 20, 5 );
    history.redo();
    history.redo();
    expect( terrain.heightAt( 50, 89 ) ).toBeGreaterThan( 35 );
  } );

  it( "sculpting done over a shape survives editing the shape", () => {
    const s = { ...newCurve( [50, 10], [50, 90] ), startHeight: 20, endHeight: 30, edgeBlend: 0 };
    previewShape( s );
    const c                     = terrain.chunks[0];
    c.heights[50 * c.res + 50] += 2;         // a bump sculpted on top
    previewShape( { ...s, endHeight: 40 } ); // ramp now steeper
    expect( terrain.heightAt( 50, 50 ) ).toBeCloseTo( 30 + 2, 3 );
  } );

  it( "a circle mound rises by its depth in the middle and blends out", () => {
    const s = { ...newCircle( [50, 50], 20 ), depth: 5, edgeBlend: 0.3 };
    previewShape( s );
    expect( terrain.heightAt( 50, 50 )   ).toBeCloseTo( 25, 3 );
    expect( terrain.heightAt( 50, 69.5 ) ).toBeCloseTo( 20, 1 );
  } );
} );

describe( "copied terrain", () => {
  it( "a copied bump keeps its shape where it's placed, and mirrors", () => {
    const c = terrain.chunks[0];
    // a 3 m block on the +x side inside a 10 m box around ( 25, 25 ) ( the box's edge stays on the ground )
    for ( let j = 22; j <= 28; j++ ) for ( let i = 26; i <= 28; i++ ) c.heights[j * c.res + i] = 23;
    const grid = captureStamp( 20, 20, 30, 30 );
    const copy = { ...newStamp( [70, 70], grid, true ), blend: 0 };
    previewShape( copy );
    expect( terrain.heightAt( 72, 70 ) ).toBeCloseTo( 23, 3 ); // the block came along
    expect( terrain.heightAt( 67, 70 ) ).toBeCloseTo( 20, 3 );
    previewShape( { ...copy, mirrorX: true } );
    expect( terrain.heightAt( 68, 70 ) ).toBeCloseTo( 23, 3 );
    expect( terrain.heightAt( 73, 70 ) ).toBeCloseTo( 20, 3 );
  } );

  it( "is an exact copy that stands on the ground where it's put, or keeps its original heights", () => {
    const c = terrain.chunks[0];
    for ( let j = 22; j <= 28; j++ ) for ( let i = 22; i <= 28; i++ ) c.heights[j * c.res + i] = 22; // 2 m block
    const grid = captureStamp( 20, 20, 30, 30 ); // the ground around the block is at 20
    // the destination is 5 m lower
    for ( let j = 55; j <= 85; j++ ) for ( let i = 55; i <= 85; i++ ) c.heights[j * c.res + i] = 15;
    previewShape( { ...newStamp( [70, 70], grid, true ), blend: 0 } );
    expect( terrain.heightAt( 70, 70 ) ).toBeCloseTo( 17, 3 ); // the 2 m block stands on the ground there
    expect( terrain.heightAt( 66, 70 ) ).toBeCloseTo( 15, 3 );
    previewShape( { ...newStamp( [70, 70], grid, false ), blend: 0 } );
    expect( terrain.heightAt( 70, 70 ) ).toBeCloseTo( 22, 3 ); // original heights
  } );
} );

describe( "mirror terrain", () => {
  it( "flips left/right and back again", async () => {
    const { mirrorTerrain }    = await import( "../../../src/terrain/ops" );
    const c                    = terrain.chunks[0];
    c.heights[50 * c.res + 10] = 30; // a spike near the left edge
    mirrorTerrain( "x" );
    expect( terrain.heightAt( 90, 50 ) ).toBeCloseTo( 30, 4 );
    expect( terrain.heightAt( 10, 50 ) ).toBeCloseTo( 20, 4 );
    history.undo();
    expect( terrain.heightAt( 10, 50 ) ).toBeCloseTo( 30, 4 );
  } );
} );

describe( "copy rotation", () => {
  it( "turns the same way as its outline", () => {
    const c = terrain.chunks[0];
    for ( let j = 24; j <= 26; j++ ) for ( let i = 27; i <= 28; i++ ) c.heights[j * c.res + i] = 23; // block 2-3 m along +x
    const grid = captureStamp( 20, 20, 30, 30 );
    // rotated 90°, local +x maps to world -z ( see stampCorners: x·( cos, −sin ) )
    previewShape( { ...newStamp( [70, 70], grid, true ), rotation: 90, blend: 0 } );
    expect( terrain.heightAt( 70, 67.5 ) ).toBeCloseTo( 23, 2 );
    expect( terrain.heightAt( 72.5, 70 ) ).toBeCloseTo( 20, 2 );
  } );
} );

describe( "map size", () => {
  it( "grows a strip that continues the edge, shrinks it back, and undoes", async () => {
    const { growMap, shrinkMap, DEFAULT_GROW } = await import( "../../../src/terrain/mapSize" );
    const c = terrain.chunks[0];
    // bumpy ground: a gentle rise along z plus 1 m bumps
    for ( let j = 0; j < c.res; j++ ) for ( let i = 0; i < c.res; i++ ) c.heights[j * c.res + i] = 20 + j * 0.05 + Math.sin( i * 0.7 ) * Math.cos( j * 0.9 );
    const edge  = ( z: number ) => terrain.heightAt( 100, z );
    const edges = [10, 40, 80].map( edge );
    growMap( "east", 101, { ...DEFAULT_GROW, roughness: 1 } ); // small bumps on ( off by default )
    expect( terrain.chunks.length ).toBe( 2 );
    // no seam: just past the edge matches the edge
    [10, 40, 80].forEach( ( z, k ) => expect( Math.abs( terrain.heightAt( 100.2, z ) - edges[k] ) ).toBeLessThan( 0.4 ) );
    // the new ground has the old ground's character: bumpy ( not flat ), around the same heights
    const vals = Array.from( { length: 50 }, ( _, k ) => terrain.heightAt( 150 + ( k % 10 ) * 4, 20 + Math.floor( k / 10 ) * 15 ) );
    const mean = vals.reduce( ( x, y ) => x + y, 0 ) / vals.length;
    const sd   = Math.sqrt( vals.reduce( ( x, y ) => x + ( y - mean ) ** 2, 0 ) / vals.length );
    expect( mean ).toBeGreaterThan( 19 );
    expect( mean ).toBeLessThan( 27 );
    expect( sd   ).toBeGreaterThan( 0.2 );
    history.undo();
    expect( terrain.chunks.length ).toBe( 1 );
    history.redo();
    expect( terrain.chunks.length         ).toBe( 2     );
    expect( shrinkMap( "west" )           ).toBe( true  );
    expect( terrain.chunks.length         ).toBe( 1     );
    expect( terrain.chunks[0].position[0] ).toBe( 100   );
    expect( shrinkMap( "east" )           ).toBe( false ); // never the last strip
  } );
} );
