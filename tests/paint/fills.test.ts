import { beforeEach, describe, expect, it } from "vitest";
import { history } from "../../src/map/history";
import { terrain } from "../../src/terrain/terrain";
import { allPowder, ensureLayer, resetPaint, snowfall } from "../../src/paint/ground";
import { commitNet, resetTrailGround, REAL_GROUND } from "../../src/trails/ground";
import { newRun, trailId, type TrailNet } from "../../src/trails/trails";

// one flat 128 m chunk, 1 m apart; its mask a pixel per sample
beforeEach( () => {
  history.clear();
  resetTrailGround();
  resetPaint();
  const res = 129;
  terrain.setChunks( [{ key: "a", position: [0, -50, 0], size: [128, 200, 128], res, heights: new Float32Array( res * res ).fill( 50 ) }] );
} );

// the powder at ( x, z ), 0..255
const powderAt = async ( x: number, z: number ) => {
  const L = await ensureLayer( terrain.chunks[0] ), px = 128 / L.m;
  return L.rgba[( Math.floor( z / px ) * L.m + Math.floor( x / px ) ) * 4 + 3];
};

describe( "powder fills", () => {
  it( "all powder: everywhere, the depth asked for, one undo step", async () => {
    await allPowder( 0.6 );
    expect( await powderAt( 10, 10 )   ).toBe( 153 );
    expect( await powderAt( 100, 120 ) ).toBe( 153 );
    expect( ( await ensureLayer( terrain.chunks[0] ) ).four ).toBe( true );
    history.undo();
    expect( await powderAt( 10, 10 ) ).toBe( 0 );
  } );

  it( "off piste: none on a trail's run or a marked piste, all of it away from them", async () => {
    // a run 16 m wide along Z at x = 64
    const a             = { id: trailId( "n" ), p: [64, 0, 10] as [number, number, number] }, b = { id: trailId( "n" ), p: [64, 0, 118] as [number, number, number] };
    const net: TrailNet = { nodes: [a, b], runs: [] };
    net.runs.push( newRun( net, a.id, b.id, 16 ) );
    commitNet( net, REAL_GROUND, "Add run", () => {} );
    // a marked piste ( an imported mountain's ) round ( 20, 100 )
    const L = await ensureLayer( terrain.chunks[0] ), px = 128 / L.m;
    L.four  = true;
    for ( let j = 0; j < L.m; j++ )
      for ( let i = 0; i < L.m; i++ ) if ( Math.hypot( ( i + 0.5 ) * px - 20, ( j + 0.5 ) * px - 100 ) < 6 ) L.rgba[( j * L.m + i ) * 4 + 2] = 255;
    await allPowder( 1, true );
    expect( await powderAt( 64, 64 )  ).toBe( 0   ); // on the run
    expect( await powderAt( 20, 100 ) ).toBe( 0   ); // on the marked piste
    expect( await powderAt( 20, 30 )  ).toBe( 255 ); // off piste
    expect( await powderAt( 120, 64 ) ).toBe( 255 );
    // ( the marking itself left as it was )
    expect( L.rgba[( Math.floor( 100 / px ) * L.m + Math.floor( 20 / px ) ) * 4 + 2] ).toBe( 255 );
  } );
} );

describe( "snowfall", () => {
  // the snow at ( x, z ), 0..255
  const snowAt = async ( x: number, z: number ) => {
    const L = await ensureLayer( terrain.chunks[0] ), px = 128 / L.m;
    return L.rgba[( Math.floor( z / px ) * L.m + Math.floor( x / px ) ) * 4];
  };
  // a chunk flat for x < 40, a 60° face for 40..60, flat again on top; a 30° slope along z beyond x 80 with a gully
  // ( z ≈ 40 ) and a ridge ( z ≈ 90 ) across it
  const ground = () => {
    const res = 129, h = new Float32Array( res * res );
    for ( let j = 0; j < res; j++ )
      for ( let i = 0; i < res; i++ ) {
        const face = Math.min( 20, Math.max( 0, i - 40 ) ) * Math.tan( Math.PI / 3 );
        const fall = i > 80 ? j * Math.tan( Math.PI / 6 ) - 6 * Math.exp( -( ( j - 40 ) ** 2 ) / 30 ) + 6 * Math.exp( -( ( j - 90 ) ** 2 ) / 30 ) : 0;
        h[j * res + i] = 40 + face + fall;
      }
    terrain.setChunks( [{ key: "a", position: [0, -50, 0], size: [128, 300, 128], res, heights: h }] );
  };

  it( "rock on the steep, snow on the flat, rock painted before kept", async () => {
    ground();
    const L = await ensureLayer( terrain.chunks[0] ), px = 128 / L.m;
    L.rgba[( Math.floor( 64 / px ) * L.m + Math.floor( 10 / px ) ) * 4] = 0;
    await snowfall( { rockFrom: 35, rockFull: 50, crevices: 0, lineLow: null, lineHigh: null } );
    expect( await snowAt( 50, 64 ) ).toBe( 0 );
    expect( await snowAt( 20, 64 ) ).toBe( 255 );
    expect( await snowAt( 10, 64 ) ).toBe( 0 );
  } );

  it( "crevices: a gully holds more snow than a ridge on the same slope", async () => {
    ground();
    await snowfall( { rockFrom: 25, rockFull: 40, crevices: 1, lineLow: null, lineHigh: null } );
    expect( await snowAt( 100, 40 ) ).toBeGreaterThan( await snowAt( 100, 90 ) );
  } );

  it( "below the snow line no snow", async () => {
    ground();
    await snowfall( { rockFrom: 80, rockFull: 89, crevices: 0, lineLow: 5, lineHigh: 15 } );
    // ( the flat at y = −10 is below it, the top of the face at y ≈ 25 above )
    expect( await snowAt( 20, 64 ) ).toBe( 0 );
    expect( await snowAt( 70, 64 ) ).toBe( 255 );
  } );
} );
