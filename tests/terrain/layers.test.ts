import { beforeEach, describe, expect, it } from "vitest";
import { history } from "../../src/map/history";
import { terrain } from "../../src/terrain/terrain";
import { groundWithout, newFormation, newSkiLine, previewShape, removeShape, resetShapes, setRockLayers, setShapeDoc, type Shape, type SkiLineShape } from "../../src/terrain/shapes/shapes";
import { commitNet, resetTrailGround, REAL_GROUND } from "../../src/trails/ground";
import { newRun, trailId, type TrailNet } from "../../src/trails/trails";

// The ground in layers: the trails its base, formations on them, ski lines on those ( terrain/shapes/shapes/apply.ts ).
// One 256 m chunk round the middle, 1 m apart, flat at 20 m; its snow mask 256 pixels a side, all snow, with markings.
const m     = 256;
const layer = { m, rgba: new Uint8Array( m * m * 4 ), four: true };
setRockLayers( { layerOf: () => layer, four: () => {}, ensure: async () => layer, changed: () => {} } );

// the shapes' list, as the editor keeps it ( a shape built on changed ground made again there at once )
let shapes: Shape[] = [];
setShapeDoc( {
  list:   () => shapes,
  follow: ( s ) => {
    shapes = shapes.map( ( x ) => ( x.uid === s.uid ? s : x ) );
    previewShape( s );
  },
} );
const put = ( s: Shape ) => {
  shapes = shapes.some( ( x ) => x.uid === s.uid ) ? shapes.map( ( x ) => ( x.uid === s.uid ? s : x ) ) : [...shapes, s];
  previewShape( s );
};

beforeEach( () => {
  history.clear();
  resetTrailGround();
  resetShapes();
  shapes = [];
  const res = 257;
  terrain.setChunks( [{ key: "a", position: [-128, 0, -128], size: [256, 300, 256], res, heights: new Float32Array( res * res ).fill( 20 ) }] );
  for ( let k = 0; k < m * m; k++ ) layer.rgba.set( [255, 51, 255, 0], k * 4 );
} );

const ring = ( r: number, x = 0 ) => Array.from( { length: 16 }, ( _, k ) => [x + Math.cos( ( k / 16 ) * Math.PI * 2 ) * r, Math.sin( ( k / 16 ) * Math.PI * 2 ) * r] as [number, number] );
// a smooth dome 20 m high ( no noise ), and one with rock on its steep sides
const dome = ( r = 40, height = 20 ) => ( { ...newFormation( ring( r ) ), height, peakWidth: 15, edgeBlend: 8, roughness: 0 } );
const rocky = () => { const s = dome( 40, 60 ); return { ...s, snow: { ...s.snow, on: true } }; };

// a run along Z through the middle, 30 m wide, at height y
const run = ( y: number ): TrailNet => {
  const a = { id: "n-a", p: [0, y, -110] as [number, number, number] }, b = { id: "n-b", p: [0, y, 110] as [number, number, number] };
  const net: TrailNet = { nodes: [a, b], runs: [] };
  net.runs.push( { ...newRun( net, a.id, b.id, 30 ), id: "r-1" } );
  return net;
};
const lay = ( y: number ) => commitNet( run( y ), REAL_GROUND, "Run", () => {} );
void trailId;

// a ski line along Z over the middle, its points on the ground there
const line = (): SkiLineShape => newSkiLine( [-60, -20, 20, 60].map( ( z ) => ( { p: [0, terrain.heightAt( 0, z ), z] as [number, number, number], width: 8, roll: 0 } ) ) );

const grid = () => Float32Array.from( terrain.chunks[0].heights );
const most = ( a: Float32Array, b: Float32Array ) => a.reduce( ( d, v, k ) => Math.max( d, Math.abs( v - b[k] ) ), 0 );

describe( "trails under formations", () => {
  it( "a run laid through a formation made first goes under it: the formation stays on top, and taken away leaves the run", () => {
    put( dome() );
    expect( terrain.heightAt( 0, 0 ) ).toBeCloseTo( 40, 0 );
    lay( 26 );
    // ( on the run, 6 m up: the dome on top of it )
    expect( terrain.heightAt( 0, 0 ) ).toBeCloseTo( 46, 0 );
    removeShape( shapes[0].uid );
    expect( terrain.heightAt( 0, 0 ) ).toBeCloseTo( 26, 1 );
    expect( terrain.heightAt( 0, 90 ) ).toBeCloseTo( 26, 1 );
  } );

  it( "a run changed under a formation: the formation made again on it, as if made there", () => {
    lay( 20 );
    const f = dome();
    put( f );
    lay( 30 );
    const moved = grid();
    // ( the same, made on the run as it is now )
    removeShape( f.uid );
    put( { ...f } );
    expect( most( grid(), moved ) ).toBeLessThan( 1e-3 );
    expect( terrain.heightAt( 0, 0 ) ).toBeCloseTo( 50, 0 );
  } );

  it( "undone, the run and the formation on it are back as they were", () => {
    lay( 20 );
    put( dome() );
    const before = grid();
    lay( 32 );
    history.undo();
    expect( most( grid(), before ) ).toBeLessThan( 1e-3 );
  } );
} );

describe( "ski lines on formations", () => {
  it( "a formation changed under a ski line: its points move with the ground, the line made again on it", () => {
    const f = dome();
    put( f );
    const s = line();
    put( s );
    const was = s.nodes.map( ( n ) => n.p[1] );
    put( { ...f, height: 30 } );
    const now = ( shapes.find( ( x ) => x.uid === s.uid ) as SkiLineShape ).nodes;
    const g   = groundWithout( s.uid );
    now.forEach( ( n, k ) => {
      // ( each still on the ground beneath it )
      expect( n.p[1] ).toBeCloseTo( g( n.p[0], n.p[2] ), 3 );
      if ( Math.abs( n.p[2] ) < 30 ) expect( n.p[1] ).toBeGreaterThan( was[k] + 5 );
    } );
    // ( the line through them )
    for ( const n of now.slice( 1, -1 ) ) expect( terrain.heightAt( n.p[0], n.p[2] ) ).toBeCloseTo( n.p[1], 1 );
  } );

  it( "the formation and the line each changed in turn come out as made at once", () => {
    const f = dome();
    put( f );
    const s = line();
    put( s );
    put( { ...f, height: 26 } );
    const s2 = { ...( shapes.find( ( x ) => x.uid === s.uid ) as SkiLineShape ), width: 12 };
    put( s2 );
    put( { ...f, height: 22 } );
    const edited = grid(), last = shapes.find( ( x ) => x.uid === s.uid ) as SkiLineShape;
    // ( from scratch: the formation, then the line as it ended )
    removeShape( s.uid );
    removeShape( f.uid );
    shapes = [];
    expect( terrain.heightAt( 0, 0 ) ).toBeCloseTo( 20, 3 );
    put( { ...f, height: 22 } );
    put( last );
    expect( most( grid(), edited ) ).toBeLessThan( 1e-3 );
  } );
} );

describe( "the snow mask: rock over stripes over runs", () => {
  const rockAt   = () => { let n = 0, marked = 0; for ( let k = 0; k < m * m; k++ ) if ( layer.rgba[k * 4] < 64 ) { n++; if ( layer.rgba[k * 4 + 2] > 128 ) marked++; } return { n, marked }; };

  it( "a formation's rock takes the markings under it out, and gives them back when it goes", () => {
    const f = rocky();
    put( f );
    const r = rockAt();
    expect( r.n ).toBeGreaterThan( 200 );
    expect( r.marked ).toBe( 0 );
    removeShape( f.uid );
    for ( let k = 0; k < m * m; k++ ) expect( layer.rgba[k * 4 + 2] ).toBe( 255 );
  } );

  it( "a ski line's stripes stay off a formation's rock", () => {
    for ( let k = 0; k < m * m; k++ ) layer.rgba[k * 4 + 2] = 0;
    put( rocky() );
    const s = line();
    put( { ...s, width: 60, features: [{ name: "Box", enabled: true, start: 0, length: 120, height: 0, lateral: 0, width: 0, sideBlend: 0, profile: [{ t: 0, v: 0 }, { t: 1, v: 0 }], stripes: [{ across: false, position: 0.5, width: 60, softness: 0, opacity: 1, inset: 0, colour: 2 }] }] } );
    let striped = 0;
    for ( let k = 0; k < m * m; k++ ) if ( layer.rgba[k * 4 + 2] > 128 ) striped++;
    expect( striped ).toBeGreaterThan( 500 );
    expect( rockAt().marked ).toBe( 0 );
  } );
} );
