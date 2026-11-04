import { beforeEach, describe, expect, it } from "vitest";
import { history } from "../../src/map/history";
import { terrain } from "../../src/terrain/terrain";
import { DEFAULT_PAINT, decodeAngle, ensureLayer, flowAlongTrails, flowDownhill, PaintStroke, resetPaint, type PaintSettings } from "../../src/paint/ground";
import { commitNet, resetTrailGround, REAL_GROUND } from "../../src/trails/ground";
import { newRun, trailId, type TrailNet } from "../../src/trails/trails";

// one 64 m chunk, 0.5 m apart, sloping down towards +Z ( 0.3 m a metre )
beforeEach( () => {
  history.clear();
  resetTrailGround();
  resetPaint();
  const res = 129, h = new Float32Array( res * res );
  for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 60 - j * 0.5 * 0.3;
  terrain.setChunks( [{ key: "a", position: [0, -20, 0], size: [64, 200, 64], res, heights: h }] );
} );

// the corduroy's direction at ( x, z ) as a unit x, z
const dirAt = async ( x: number, z: number ) => {
  const L = await ensureLayer( terrain.chunks[0] ), px = 64 / L.m;
  return decodeAngle( L.flow![Math.floor( z / px ) * L.m + Math.floor( x / px )] );
};
const near = ( [x, z]: [number, number], [ex, ez]: [number, number], tol = 0.05 ) => {
  expect( x ).toBeCloseTo( ex, 0 );
  expect( Math.hypot( x - ex, z - ez ) ).toBeLessThan( tol );
};

describe( "corduroy fills", () => {
  it( "downhill: straight down the slope everywhere", async () => {
    await flowDownhill();
    near( await dirAt( 10, 10 ), [0, 1] );
    near( await dirAt( 50, 40 ), [0, 1] );
  } );

  it( "along the trails: the way each run goes down it, across the slope too", async () => {
    // a run across the slope, its first point a little higher: down it is +X
    const a             = { id: trailId( "n" ), p: [8, 1, 32] as [number, number, number] }, b = { id: trailId( "n" ), p: [56, 0, 32] as [number, number, number] };
    const net: TrailNet = { nodes: [a, b], runs: [] };
    net.runs.push( newRun( net, a.id, b.id, 10 ) );
    commitNet( net, REAL_GROUND, "Add run", () => {} );
    await flowDownhill();
    await flowAlongTrails();
    near( await dirAt( 32, 32 ), [1, 0] );
    // off the run: the downhill it had
    near( await dirAt( 32, 4 ), [0, 1] );
  } );
} );

describe( "the corduroy brush", () => {
  const stroke = async ( s: Partial<PaintSettings>, path: [number, number][] ) => {
    const st = new PaintStroke( { ...DEFAULT_PAINT, tool: "flow", radius: 3, strength: 1, hardness: 1, ...s } );
    for ( const [x, z] of path ) await st.move( x, z );
  };

  it( "a set angle paints that way whichever way it's dragged", async () => {
    await stroke( { flowDir: "fixed", flowAngle: 90 }, [[20, 20], [20, 40]] );
    near( await dirAt( 20, 30 ), [1, 0] );
  } );

  it( "held: the stroke's first way kept as it turns; along the drag: it turns with it", async () => {
    await stroke( { flowDir: "lock" }, [[10, 10], [10, 20], [30, 20]] );
    near( await dirAt( 25, 20 ), [0, 1] );
    await stroke( { flowDir: "drag" }, [[10, 50], [10, 56], [30, 56]] );
    near( await dirAt( 25, 56 ), [1, 0] );
  } );

  it( "smooth: a hard edge between two directions evened out", async () => {
    await stroke( { flowDir: "fixed", flowAngle: 90, radius: 8 }, [[20, 32], [32, 32]] );
    await stroke( { flowDir: "fixed", flowAngle: 0, radius: 8 }, [[44, 32], [56, 32]] );
    const before = await dirAt( 38.2, 32 );
    await stroke( { flowDir: "smooth", radius: 6 }, [[38, 26], [38, 38]] );
    const after = await dirAt( 38.2, 32 );
    // ( between the two now: neither straight east nor straight north )
    expect( Math.min( Math.abs( after[0] ), Math.abs( after[1] ) ) ).toBeGreaterThan( 0.2 );
    expect( after ).not.toEqual( before );
  } );
} );
