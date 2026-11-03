import { beforeEach, describe, expect, it } from "vitest";
import { history } from "../../src/map/history";
import { terrain } from "../../src/terrain/terrain";
import { ensureLayer, paintRunStripes, resetPaint } from "../../src/paint/ground";
import { commitNet, resetTrailGround, REAL_GROUND } from "../../src/trails/ground";
import { newRun, trailId, type TrailFeature, type TrailNet } from "../../src/trails/trails";

// a flat 128 m chunk at 50 m, 1 m apart; a run 16 m wide along Z at x = 64, from z = 14 to 114 ( 100 m )
beforeEach( () => {
  history.clear();
  resetTrailGround();
  resetPaint();
  const res = 129;
  terrain.setChunks( [{ key: "a", position: [0, -50, 0], size: [128, 200, 128], res, heights: new Float32Array( res * res ).fill( 100 ) }] );
} );

const run = ( features: TrailFeature[] = [] ): TrailNet => {
  const a             = { id: trailId( "n" ), p: [64, 50, 14] as [number, number, number] }, b = { id: trailId( "n" ), p: [64, 50, 114] as [number, number, number] };
  const net: TrailNet = { nodes: [a, b], runs: [] };
  net.runs.push( { ...newRun( net, a.id, b.id, 16 ), features } );
  return net;
};

describe( "features on a run", () => {
  it( "a kicker lifts the run where it is, and only there", () => {
    commitNet( run( [{ kind: "kicker", at: 40, length: 10, height: 2, offset: 0, width: 0, blend: 0.2 }] ), REAL_GROUND, "Add run", () => {} );
    // ( 40..50 m along: z 54..64, highest near its lip )
    expect( terrain.heightAt( 64, 62 ) ).toBeGreaterThan( 50.8 );
    expect( terrain.heightAt( 64, 30 ) ).toBeCloseTo( 50, 1 );
    expect( terrain.heightAt( 64, 90 ) ).toBeCloseTo( 50, 1 );
  } );

  it( "a narrow one covers just its width, off to one side", () => {
    commitNet( run( [{ kind: "table", at: 40, length: 20, height: 2, offset: 4, width: 4, blend: 0.1 }] ), REAL_GROUND, "Add run", () => {} );
    // ( right of the way it runs, +Z, is +X: as its roll has it )
    expect( terrain.heightAt( 68, 70 ) ).toBeGreaterThan( 51 );
    expect( terrain.heightAt( 60, 70 ) ).toBeCloseTo( 50, 1 );
  } );
} );

describe( "stripes on a run", () => {
  const markedAt = async ( x: number, z: number ) => {
    const L = await ensureLayer( terrain.chunks[0] ), px = 128 / L.m;
    return L.rgba[( Math.floor( z / px ) * L.m + Math.floor( x / px ) ) * 4 + 2];
  };

  it( "along it, at its place across; across it, at its place along; one undo step", async () => {
    const net = run();
    net.runs[0].stripes = [
      { along: true,  pos: 1,   width: 1, colour: 0, softness: 0, opacity: 1 },
      { along: false, pos: 0.5, width: 1, colour: 3, softness: 0, opacity: 1 },
    ];
    commitNet( net, REAL_GROUND, "Add run", () => {} );
    await paintRunStripes( net, [net.runs[0].id] );
    // ( its right edge, +X of its middle )
    expect( await markedAt( 72, 40 ) ).toBe( 255 );
    expect( await markedAt( 56, 40 ) ).toBe( 0 );
    expect( await markedAt( 64, 40 ) ).toBe( 0 );
    // ( across, half way along: z 64 )
    expect( await markedAt( 64, 64 ) ).toBe( 255 );
    history.undo();
    expect( await markedAt( 72, 40 ) ).toBe( 0 );
  } );
} );
