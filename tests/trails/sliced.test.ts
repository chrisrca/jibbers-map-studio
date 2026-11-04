import { afterAll, describe, expect, it, vi } from "vitest";

// The trails' ground as the app makes it: the far part a slice per frame ( src/trails/ground/apply.ts ), here a block a
// slice, the frames run by hand. Over four tiles meeting at a corner.

const frames: FrameRequestCallback[] = [];
vi.stubGlobal( "requestAnimationFrame", ( f: FrameRequestCallback ) => frames.push( f ) );
// ( each look at the clock a few ms on: a slice's 4 ms budget has room for one block )
let clock = 0;
const now = vi.spyOn( performance, "now" ).mockImplementation( () => ( clock += 3 ) );
afterAll( () => {
  now.mockRestore();
  vi.unstubAllGlobals();
} );

const { history }                                 = await import( "../../src/map/history" );
const { terrain }                                 = await import( "../../src/terrain/terrain" );
const { commitNet, resetTrailGround, REAL_GROUND } = await import( "../../src/trails/ground" );
const { newRun, trailId }                         = await import( "../../src/trails/trails" );
type TrailNet                                     = import( "../../src/trails/trails" ).TrailNet;

// four 200 m tiles meeting at ( 200, 200 ), 1 m apart, sloping 0.1 down along Z
function tiles() {
  const res = 201;
  terrain.setChunks( [[0, 0], [200, 0], [0, 200], [200, 200]].map( ( [x, z], k ) => {
    const h = new Float32Array( res * res );
    for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 100 + 40 - ( z + j ) * 0.1;
    return { key: `t${k}`, position: [x, -100, z] as [number, number, number], size: [200, 400, 200] as [number, number, number], res, heights: h };
  } ) );
}

// every frame's slice, till the ground's done
function runFrames() {
  for ( let k = 0; k < 10000 && frames.length; k++ ) frames.shift()!( 0 );
}

// every sample two tiles share, as each has it: the biggest difference
function seam() {
  let most = 0;
  const by = new Map<string, number>();
  for ( const c of terrain.chunks )
    for ( let j = 0; j < c.res; j++ )
      for ( let i = 0; i < c.res; i++ ) {
        if ( i > 0 && j > 0 && i < c.res - 1 && j < c.res - 1 ) continue;
        const k = `${c.position[0] + i},${c.position[2] + j}`, y = c.heights[j * c.res + i] + c.position[1], was = by.get( k );
        if ( was === undefined ) by.set( k, y );
        else most = Math.max( most, Math.abs( y - was ) );
      }
  return most;
}

const all = () => terrain.chunks.map( ( c ) => Float32Array.from( c.heights ) );

describe( "trails over tiles, made a slice a frame", () => {
  it( "a run near where four tiles meet changes their shared edges alike, and undoes exactly", () => {
    // ( runs at many distances from the corner, as a person puts them down )
    for ( let off = 0; off < 30; off += 1.37 ) {
      tiles();
      history.clear();
      resetTrailGround();
      const was           = all();
      const a             = { id: trailId( "n" ), p: [150 + off, 15, 120] as [number, number, number] }, b = { id: trailId( "n" ), p: [170 + off, 9, 185 + off] as [number, number, number] };
      const net: TrailNet = { nodes: [a, b], runs: [] };
      net.runs.push( newRun( net, a.id, b.id, 12 ) );
      commitNet( net, REAL_GROUND, "Add run", () => {} );
      runFrames();
      expect( seam(), `laid, ${off}` ).toBeLessThan( 1e-3 );
      history.undo();
      runFrames();
      expect( seam(), `undone, ${off}` ).toBeLessThan( 1e-3 );
      let back = 0;
      for ( const [k, h] of all().entries() ) for ( let q = 0; q < h.length; q++ ) back = Math.max( back, Math.abs( h[q] - was[k][q] ) );
      expect( back, `back, ${off}` ).toBeLessThan( 1e-3 );
    }
  } );
} );
