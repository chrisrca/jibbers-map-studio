import { beforeEach, describe, expect, it } from "vitest";
import { history } from "../../src/map/history";
import { terrain } from "../../src/terrain/terrain";
import { commitNet, resetTrailGround, REAL_GROUND, solveField, type GroundSettings } from "../../src/trails/ground";
import { emptyNet, NET_VERSION, newRun, runStrip, trailId, type TrailNet, type TrailRun } from "../../src/trails/trails";
import { addRunsAsTrails } from "../../src/trails/fromRuns";

const S: GroundSettings = { ...REAL_GROUND, blend: 40, amount: 0 };

beforeEach( () => {
  history.clear();
  resetTrailGround();
  // a 400 m tile sloping 0.1 down along Z ( from 40 m at z = 0 ), 1 m apart
  const res = 401;
  const h   = new Float32Array( res * res );
  for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 100 + 40 - j * 0.1;
  terrain.setChunks( [{ key: "a", position: [0, -100, 0], size: [400, 400, 400], res, heights: h }] );
} );

/**
 * Two points 200 m apart along Z at x = 200, at the given heights, joined by a run 20 m wide.
**/
function straight( ya: number, yb: number, width = 20 ): TrailNet {
  const a             = { id: trailId( "n" ), p: [200, ya, 100] as [number, number, number] }, b = { id: trailId( "n" ), p: [200, yb, 300] as [number, number, number] };
  const net: TrailNet = { nodes: [a, b], runs: [] };
  net.runs.push( newRun( net, a.id, b.id, width ) );
  return net;
}

const at = ( x: number, z: number ) => terrain.heightAt( x, z );

describe( "trails", () => {
  it( "a straight run is a straight surface with its width and skirt", () => {
    const net = straight( 10, 30 );
    const s   = runStrip( net, net.runs[0], 1 );
    expect( s.cols ).toBe( 13 );
    // centre of the middle row: half way up; edges 10 m either side
    const mid = Math.floor( ( s.rows - 1 ) / 2 ), o = ( mid * s.cols + 6 ) * 4;
    expect( s.pts[o + 1]                     ).toBeCloseTo( 20,  0 );
    expect( s.pts[( mid * s.cols + 1 ) * 4]  ).toBeCloseTo( 190, 1 );
    expect( s.pts[( mid * s.cols + 11 ) * 4] ).toBeCloseTo( 210, 1 );
  } );

  it( "raising a corner lifts that corner and eases into the rest", () => {
    const net = straight( 10, 10 );
    net.runs[0].corners = [0, 0, 6, 0]; // b end, left
    const s    = runStrip( net, net.runs[0], 1 );
    const y    = ( row: number, col: number ) => s.pts[( row * s.cols + col ) * 4 + 1];
    const last = s.rows - 2;                      // ( open end: the last row is skirt )
    expect( y( last, 1  ) ).toBeCloseTo( 16, 1 ); // the corner
    expect( y( last, 11 ) ).toBeCloseTo( 10, 1 ); // the other corner
    expect( y( last, 6  ) ).toBeCloseTo( 10, 1 ); // the middle of that end
    const half = y( Math.round( last * 0.75 ), 1 );
    expect( half ).toBeGreaterThan( 10.1 );
    expect( half ).toBeLessThan( 15.9 );
  } );

  it( "the ground is the run on it, bends to meet it, and is untouched beyond the blend", () => {
    const net = straight( 30, 30 ); // flat run, above the slope ( ground 30 at z = 100, 10 at z = 300 )
    commitNet( net, S, "Add run", () => {} );
    expect( at( 200, 150 ) ).toBeCloseTo( 30, 1 );
    expect( at( 205, 250 ) ).toBeCloseTo( 30, 1 );
    // 25 m off the run's side ( inside the blend ): between the run and the slope
    const g = 40 - 250 * 0.1, side = at( 235, 250 );
    expect( side ).toBeGreaterThan( g  + 0.5 );
    expect( side ).toBeLessThan( 30 );
    // well beyond: the slope as it was
    expect( at( 330, 250 ) ).toBeCloseTo( g, 3 );
  } );

  it( "moving a point moves the ground, keeps sculpting, and undoes exactly", () => {
    const before = terrain.chunks[0].heights.slice();
    const net    = straight( 30, 30 );
    commitNet( net, S, "Add run", () => {} );
    // sculpt: 2 m on the run, and 1 m off it
    const c                     = terrain.chunks[0], res = c.res;
    c.heights[200 * res + 200] += 2;
    c.heights[200 * res + 260] += 1;
    const moved: TrailNet       = structuredClone( net );
    moved.nodes[1].p = [200, 50, 300];
    commitNet( moved, S, "Move point", () => {} );
    // the run's middle is now 40 up, and the sculpt rides on it
    expect( c.position[1] + c.heights[200 * res + 200] ).toBeCloseTo( 42, 1 );
    expect( c.position[1] + c.heights[200 * res + 201] ).toBeCloseTo( 40, 1 );
    // undo both edits: the sculpt is all that's left
    history.undo();
    history.undo();
    const now = terrain.chunks[0].heights;
    let worst = 0;
    for ( let k = 0; k < now.length; k++ ) {
      const extra = k === 200 * res + 200 ? 2 : k === 200 * res + 260 ? 1 : 0;
      worst       = Math.max( worst, Math.abs( now[k] - before[k] - extra ) );
    }
    expect( worst ).toBeLessThan( 1e-3 );
  } );

  it( "two runs meeting at a point join without a step", () => {
    const net = straight( 30, 20 );
    const c   = { id: trailId( "n" ), p: [300, 25, 380] as [number, number, number] };
    net.nodes.push( c );
    const r2 = newRun( net, net.nodes[1].id, c.id, 20 );
    r2.roll  = 10;
    net.runs.push( r2 );
    commitNet( net, S, "Add runs", () => {} );
    // across the meeting point, the ground changes smoothly ( no jump over a metre )
    let jump = 0;
    for ( let z = 280; z < 320; z += 1 ) jump = Math.max( jump, Math.abs( at( 205, z + 1 ) - at( 205, z ) ) );
    expect( jump ).toBeLessThan( 1 );
  } );

  it( "adds ground where there's none (flat at the lowest point)", () => {
    terrain.setChunks( [] );
    const net = straight( 10, 30 );
    commitNet( net, { ...S, blend: 20 }, "Add run", () => {} );
    expect( terrain.chunks.length ).toBeGreaterThan( 0 );
    expect( at( 200, 200 )        ).toBeCloseTo( 20, 0 );
  } );

  it( "lays runs as trails on the ground they're on, joined where they meet", () => {
    // the tile tilted sideways too ( 0.15 across X )
    const c = terrain.chunks[0], res = c.res;
    for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) c.heights[j * res + i] = 100 + 40 - j * 0.1 + i * 0.15;
    const ground                      = ( x: number, z: number ) => terrain.heightAt( x, z );
    const before                      = c.heights.slice();
    // a run down the middle, and one joining it from the side half way ( a T )
    const lines: [number, number][][] = [
      [[200, 50 ], [205, 200], [200, 350]],
      [[60,  210], [195, 200]],
    ];
    const net      = addRunsAsTrails( emptyNet(), lines, ground );
    const junction = net.nodes.filter( ( n ) => net.runs.filter( ( r ) => r.a === n.id || r.b === n.id ).length >= 3 );
    expect( junction.length ).toBe( 1 );
    commitNet( net, { ...S, blend: 40 }, "Trails from runs", () => {} );
    // the mountain barely changed: the runs fitted to it
    let worst = 0, n = 0, sum = 0;
    for ( let j = 60; j < 340; j += 7 )
      for ( let i = 60; i < 340; i += 7 ) {
        const d = Math.abs( c.heights[j * res + i] - before[j * res + i] );
        worst   = Math.max( worst, d );
        sum    += d;
        n++;
      }
    expect( sum   / n ).toBeLessThan( 0.1 );
    expect( worst     ).toBeLessThan( 0.5 );
  } );

  it( "works the bend out again only round what changed, close to working it all out", () => {
    // two runs far apart; the second one's end moved
    const a   = straight( 30, 30 );
    const far = { id: trailId( "n" ), p: [60, 25, 80] as [number, number, number] }, far2 = { id: trailId( "n" ), p: [60, 25, 140] as [number, number, number] };
    a.nodes.push( far, far2 );
    a.runs.push( newRun( a, far.id, far2.id, 16 ) );
    commitNet( a, S, "Add runs", () => {} );
    const moved: TrailNet = structuredClone( a );
    moved.nodes[3].p = [70, 32, 150];
    commitNet( moved, S, "Move point", () => {} );
    const local = terrain.chunks[0].heights.slice();
    // the same net made in one go on the ground as it first was
    history.clear();
    resetTrailGround();
    const res = 401, h = new Float32Array( res * res );
    for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 100 + 40 - j * 0.1;
    terrain.setChunks( [{ key: "a", position: [0, -100, 0], size: [400, 400, 400], res, heights: h }] );
    commitNet( moved, S, "All at once", () => {} );
    const whole = terrain.chunks[0].heights;
    let worst   = 0;
    for ( let k = 0; k < whole.length; k++ ) worst = Math.max( worst, Math.abs( whole[k] - local[k] ) );
    expect( worst ).toBeLessThan( 0.25 );
  } );

  it( "a run laid over a hill follows it (and cuts in without Follow ground)", async () => {
    const { addPoint  } = await import( "../../src/trails/edits" );
    const { useEditor } = await import( "../../src/map/store"    );
    const lay           = ( follow: boolean ) => {
      history.clear();
      resetTrailGround();
      const res = 401, h = new Float32Array( res * res );
      // a dome 40 m high in the middle of the tile
      for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 100 + 40 - ( ( i - 200 ) ** 2 + ( j - 200 ) ** 2 ) / 2000;
      terrain.setChunks( [{ key: "a", position: [0, -100, 0], size: [400, 400, 400], res, heights: h }] );
      useEditor.setState( { trails: emptyNet(), trailTool: { width: 30, follow }, trailGround: { ...S, blend: 40 } } );
      const before = terrain.chunks[0].heights.slice();
      const g      = ( x: number, z: number ) => terrain.heightAt( x, z );
      const a      = addPoint( [200, g( 200, 60 ), 60] );
      addPoint( [200, g( 200, 340 ), 340], a.node );
      const after = terrain.chunks[0].heights;
      let worst   = 0;
      for ( let k = 0; k < after.length; k++ ) worst = Math.max( worst, Math.abs( after[k] - before[k] ) );
      return worst;
    };
    expect( lay( true  ) ).toBeLessThan( 0.5 );
    expect( lay( false ) ).toBeGreaterThan( 5 );
  } );

  it( "a fitted run fits the ground again when its point moves (and not once shaped by hand)", async () => {
    const { addPoint, commitMoved } = await import( "../../src/trails/edits" );
    const { useEditor }             = await import( "../../src/map/store" );
    history.clear();
    resetTrailGround();
    const res = 401, h = new Float32Array( res * res );
    for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 100 + 40 - ( ( i - 200 ) ** 2 + ( j - 200 ) ** 2 ) / 2000;
    terrain.setChunks( [{ key: "a", position: [0, -100, 0], size: [400, 400, 400], res, heights: h }] );
    useEditor.setState( { trails: emptyNet(), trailTool: { width: 30, follow: true } } );
    const before = terrain.chunks[0].heights.slice();
    const g      = ( x: number, z: number ) => terrain.heightAt( x, z );
    const a      = addPoint( [200, g( 200, 60 ), 60]           );
    const b      = addPoint( [200, g( 200, 340 ), 340], a.node );
    // the far end moved round the dome ( onto the ground there, as a dragged point is )
    const moved  = structuredClone( useEditor.getState().trails );
    const x      = 330, z = 260, base = 100 + 40 - ( ( x - 200 ) ** 2 + ( z - 200 ) ** 2 ) / 2000 - 100;
    moved.nodes.find( ( n ) => n.id === b.node )!.p = [x, base, z];
    commitMoved( moved, [b.node], "Move point" );
    const after = terrain.chunks[0].heights;
    let worst   = 0;
    for ( let k = 0; k < after.length; k++ ) worst = Math.max( worst, Math.abs( after[k] - before[k] ) );
    expect( worst                                   ).toBeLessThan( 1 );
    expect( useEditor.getState().trails.runs[0].fit ).toBe( true );
  } );

  it( "a run down a slope that flattens out past its end doesn't dig into the snow there", async () => {
    const { addPoint  } = await import( "../../src/trails/edits" );
    const { useEditor } = await import( "../../src/map/store"    );
    history.clear();
    resetTrailGround();
    const res = 401, h = new Float32Array( res * res );
    // steep ( 0.3 ) down to z = 260, level after
    for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 100 + Math.max( 0, 260 - j ) * 0.3;
    terrain.setChunks( [{ key: "a", position: [0, -100, 0], size: [400, 400, 400], res, heights: h }] );
    useEditor.setState( { trails: emptyNet(), trailTool: { width: 30, follow: true } } );
    const before = terrain.chunks[0].heights.slice();
    const g      = ( x: number, z: number ) => terrain.heightAt( x, z );
    const a      = addPoint( [200, g( 200, 80 ), 80] );
    addPoint( [200, g( 200, 255 ), 255], a.node );
    const c = terrain.chunks[0];
    // past the bottom end, on the level
    let dug = 0;
    for ( let j = 262; j < 300; j++ ) for ( let i = 180; i < 220; i++ ) dug = Math.max( dug, before[j * res + i] - c.heights[j * res + i] );
    expect( dug ).toBeLessThan( 0.5 );
  } );

  it( "a run keeping the ground's detail leaves a bumpy mountain as it was, and its relief rides on edits", async () => {
    const { addPoint, commitTrails } = await import( "../../src/trails/edits" );
    const { useEditor }              = await import( "../../src/map/store" );
    // a run's settings changed, as the Trails panel commits them
    const updateRun                  = ( id: string, patch: Partial<TrailRun> ) => {
      const net = structuredClone( useEditor.getState().trails );
      Object.assign( net.runs.find( ( r ) => r.id === id )!, patch );
      commitTrails( net, "Change run" );
    };
    // a slope with bumps half a metre high, 6 m apart ( a lidar mountain's texture )
    const lay = ( detail: number ) => {
      history.clear();
      resetTrailGround();
      const res = 401, h = new Float32Array( res * res );
      for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 140 - j * 0.15 + 0.5 * Math.sin( i / 1 ) * Math.sin( j / 1.1 );
      terrain.setChunks( [{ key: "a", position: [0, -100, 0], size: [400, 400, 400], res, heights: h }] );
      useEditor.setState( { trails: emptyNet(), trailTool: { width: 30, follow: true } } );
      const before = terrain.chunks[0].heights.slice();
      const g      = ( x: number, z: number ) => terrain.heightAt( x, z );
      const a      = addPoint( [200, g( 200, 80 ), 80] );
      addPoint( [200, g( 200, 320 ), 320], a.node );
      // ( new runs keep it all: a groomed one is a run told to keep none )
      if ( detail !== 1 ) updateRun( useEditor.getState().trails.runs[0].id, { detail } );
      const after = terrain.chunks[0].heights;
      let worst   = 0;
      for ( let j = 120; j < 280; j++ ) for ( let i = 190; i < 210; i++ ) worst = Math.max( worst, Math.abs( after[j * res + i] - before[j * res + i] ) );
      return { worst, before, res };
    };
    const smooth = lay( 0 );
    expect( smooth.worst ).toBeGreaterThan( 0.4 ); // groomed: the bumps gone from the run
    console.log( `(detail: groomed run moves the ground ${smooth.worst.toFixed( 2 )} m at most)` );
    const kept = lay( 1 );
    console.log( `(detail: run keeping it moves it ${kept.worst.toFixed( 2 )} m at most)` );
    expect( kept.worst ).toBeLessThan( Math.min( 0.25, smooth.worst / 2 ) ); // kept: the mountain much as it was
    // the run raised 2 m in the middle: the bumps still there on it
    const run = useEditor.getState().trails.runs[0];
    updateRun( run.id, { bump: run.bump + 2, profile: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }, { t: 1, v: 0 }], fit: false } );
    const c = terrain.chunks[0], res = kept.res;
    const d = ( i: number, j: number ) => c.heights[j * res + i] - kept.before[j * res + i];
    // at the middle the change is ~2 m everywhere across the run ( the bumps under it kept: no ±0.5 m left over )
    let lo  = Infinity, hi = -Infinity;
    for ( let i = 192; i < 208; i++ ) { lo = Math.min( lo, d( i, 200 ) ); hi = Math.max( hi, d( i, 200 ) ); }
    expect( lo      ).toBeGreaterThan( 1.5 );
    expect( hi - lo ).toBeLessThan( 0.4 );
  } );

  it( "two points 30 m apart, the second raised 3 m: the run rises evenly, level across, not set into the ground", async () => {
    const { addPoint, commitMoved } = await import( "../../src/trails/edits" );
    const { useEditor }             = await import( "../../src/map/store" );
    history.clear();
    resetTrailGround();
    const res = 401, h = new Float32Array( res * res );
    for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 140 - j * 0.1;
    terrain.setChunks( [{ key: "a", position: [0, -100, 0], size: [400, 400, 400], res, heights: h }] );
    useEditor.setState( { trails: emptyNet(), trailTool: { width: 30, follow: true } } );
    const g      = ( x: number, z: number ) => terrain.heightAt( x, z );
    const before = ( z: number ) => 40 - z * 0.1;
    const a      = addPoint( [200, g( 200, 180 ), 180]         );
    const b      = addPoint( [200, g( 200, 210 ), 210], a.node );
    const net    = structuredClone( useEditor.getState().trails );
    const nb     = net.nodes.find( ( n ) => n.id === b.node )!;
    nb.p         = [nb.p[0], nb.p[1] + 3, nb.p[2]];
    commitMoved( net, [b.node], "Move point" );
    for ( const z of [185, 195, 205, 210] ) {
      const mid = g( 200, z ) - before( z );
      // level across the run
      for ( const dx of [-12, -6,  6,  12] ) expect( Math.abs( g( 200 + dx, z ) - before( z ) - mid ) ).toBeLessThan( 0.05 );
      // nothing beside it standing over it
      for ( const dx of [-40, -25, 25, 40] ) expect( g( 200 + dx, z ) - before( z ) ).toBeLessThan( mid + 0.3 );
    }
    expect( g( 200, 210 ) - before( 210 ) ).toBeCloseTo( 3, 1 );
  } );

  it( "wide runs meeting at a point meet smoothly (round pad, overlaps graded), not with hard lines", () => {
    const crease = ( v: number ) => {
      history.clear();
      resetTrailGround();
      const res = 401, h = new Float32Array( res * res );
      for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 140 - j * 0.1;
      terrain.setChunks( [{ key: "a", position: [0, -100, 0], size: [400, 400, 400], res, heights: h }] );
      const g             = ( x: number, z: number ) => terrain.heightAt( x, z );
      const mid           = { id: trailId( "n" ), p: [200, g( 200, 200 ) + 2, 200] as [number, number, number] };
      const net: TrailNet = { nodes: [mid], runs: [], v };
      // four runs out from it, 60 m wide, their ends at different heights
      for ( const [k, [x, z]] of ( [[120, 150], [280, 130], [290, 260], [130, 280]] as [number, number][] ).entries() ) {
        const n = { id: trailId( "n" ), p: [x, g( x, z ) + k * 1.5, z] as [number, number, number] };
        net.nodes.push( n );
        net.runs.push( newRun( net, mid.id, n.id, 60 ) );
      }
      commitNet( net, { ...S, blend: 60 }, "Add runs", () => {} );
      // the sharpest bend in the ground round the junction ( second differences, 1 m apart, both ways )
      const c   = terrain.chunks[0];
      const at  = ( i: number, j: number ) => c.heights[j * res + i];
      let worst = 0;
      for ( let j = 140; j < 260; j++ )
        for ( let i = 140; i < 260; i++ ) {
          worst = Math.max( worst, Math.abs( at( i + 1, j ) + at( i - 1, j ) - 2 * at( i, j ) ), Math.abs( at( i, j + 1 ) + at( i, j - 1 ) - 2 * at( i, j ) ) );
        }
      return worst;
    };
    const before = crease( 3 ), now = crease( NET_VERSION );
    console.log( `(junction: sharpest bend ${before.toFixed( 3 )} m before, ${now.toFixed( 3 )} m with round pads and graded overlaps)` );
    expect( now ).toBeLessThan( Math.min( 0.3, before * 0.25 ) );
  } );

  it( "two runs meeting at a raised point make a rounded peak, nothing sticking up past it", () => {
    const net = straight( 30, 30 );
    const top = { id: trailId( "n" ), p: [200, 50, 200] as [number, number, number] };
    net.nodes.splice( 1, 0, top );
    net.v    = 4;
    net.runs = [newRun( net, net.nodes[0].id, top.id, 20 ), newRun( net, top.id, net.nodes[2].id, 20 )];
    commitNet( net, S, "Add runs", () => {} );
    let most = -Infinity;
    for ( let z = 170; z <= 230; z++ ) for ( let x = 185; x <= 215; x++ ) most = Math.max( most, terrain.heightAt( x, z ) );
    expect( most                         ).toBeLessThan( 50.3 );
    expect( terrain.heightAt( 200, 200 ) ).toBeGreaterThan( 47 );
  } );

  it( "points close together on a trail don't tangle the ground", async () => {
    const { addPoint  } = await import( "../../src/trails/edits" );
    const { useEditor } = await import( "../../src/map/store"    );
    const sharpest      = ( v: number ) => {
      history.clear();
      resetTrailGround();
      const res = 401, h = new Float32Array( res * res );
      for ( let j = 0; j < res; j++ ) for ( let i = 0; i < res; i++ ) h[j * res + i] = 140 - j * 0.1;
      terrain.setChunks( [{ key: "a", position: [0, -100, 0], size: [400, 400, 400], res, heights: h }] );
      useEditor.setState( { trails: { ...emptyNet(), v }, trailTool: { width: 30, follow: true } } );
      const g = ( x: number, z: number ) => terrain.heightAt( x, z );
      // a trail of four points, the middle two 12 m apart, a little bend at each
      let at  = addPoint( [200, g( 200, 120 ), 120] ).node;
      for ( const [x, z] of [[205, 190], [212, 201], [200, 280]] ) at = addPoint( [x, g( x, z ), z], at ).node;
      const c   = terrain.chunks[0], hh = ( i: number, j: number ) => c.heights[j * res + i];
      let worst = 0;
      for ( let j = 150; j < 250; j++ )
        for ( let i = 170; i < 240; i++ ) worst = Math.max( worst, Math.abs( hh( i + 1, j ) + hh( i - 1, j ) - 2 * hh( i, j ) ), Math.abs( hh( i, j + 1 ) + hh( i, j - 1 ) - 2 * hh( i, j ) ) );
      return worst;
    };
    const before = sharpest( 4 ), now = sharpest( NET_VERSION );
    console.log( `(close points: sharpest bend ${before.toFixed( 3 )} m before, ${now.toFixed( 3 )} m now)` );
    expect( now ).toBeLessThan( 0.25 );
  } );

  it( "a run's end dropped onto another run joins it there (a T)", async () => {
    const { joinDropped } = await import( "../../src/trails/edits" );
    const net             = straight( 30, 30 );
    // a second run whose end lies on the first one's middle
    const q               = { id: trailId( "n" ), p: [100, 30, 200] as [number, number, number] }, end = { id: trailId( "n" ), p: [203, 30, 201] as [number, number, number] };
    net.nodes.push( q, end );
    net.runs.push( newRun( net, q.id, end.id, 20 ) );
    const joined = joinDropped( net, end.id, null )!;
    expect( joined ).not.toBeNull();
    const at = joined.net.runs.filter( ( r ) => r.a === joined.node || r.b === joined.node );
    expect( at.length               ).toBe( 3 );
    expect( joined.net.nodes.length ).toBe( 4 );
  } );
} );

describe( "the bend", () => {
  it( "a change that moves nothing keeps the last bend (splitting a run where it is)", () => {
    const net   = straight( 10, 30 );
    const field = solveField( net, S, null, null )!;
    // ( nothing changed: no area to work out again )
    expect( () => solveField( net, S, field, [] ) ).not.toThrow();
    expect( solveField( net, S, field, [] )       ).toBe( field );
  } );
} );
