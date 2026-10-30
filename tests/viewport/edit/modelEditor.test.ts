import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { history } from "../../../src/map/history";
import { useEditor } from "../../../src/map/store";
import { edgesOf, primitive, type Mesh, type V3 } from "../../../src/model/mesh";
import { newModelObject } from "../../../src/model/objects";
import { loopCut } from "../../../src/model/ops";
import { useUvEditor } from "../../../src/ui/panels/UvEditor";
import { editing, midOf } from "./editor";

// A box cut round its middle: the cut's corners have four edges, so loops run on round it.
function cutBox() {
  const g  = primitive( "cube" );
  const up = [...edgesOf( g ).entries()].find( ( [, e] ) => Math.abs( g.v[e.a][1] - g.v[e.b][1] ) > 1 )![0];
  return loopCut( g, up ).mesh;
}

// The edge round the box's middle that's nearest the camera.
function middleEdge( e: ReturnType<typeof editing> ) {
  const g     = e.mesh();
  const round = [...edgesOf( g ).values()].filter( ( x ) => Math.abs( g.v[x.a][1] ) < 1e-6 && Math.abs( g.v[x.b][1] ) < 1e-6 );
  const near  = ( x: { a: number; b: number } ) => g.v[x.a][0] + g.v[x.b][0] + g.v[x.a][2] + g.v[x.b][2];
  return round.sort( ( p, q ) => near( q ) - near( p ) )[0];
}

describe( "Edit Mode: loops", () => {
  it( "Alt+click selects the edge loop in vertex mode too, not only edge mode", () => {
    const e    = editing( cutBox() );
    const edge = middleEdge( e );
    e.key( "1" );
    e.click( ...midOf( e, edge.a, edge.b ), { altKey: true } );
    // the four edges round the middle, their four corners
    expect( e.ed.sel.e.size ).toBe( 4 );
    expect( e.ed.sel.v.size ).toBe( 4 );
    expect( [...e.ed.sel.v].every( ( v ) => Math.abs( e.mesh().v[v][1] ) < 1e-6 ) ).toBe( true );
  } );

  it( "Alt+click near an edge ( not on it ) still finds it", () => {
    const e      = editing( cutBox() );
    const edge   = middleEdge( e );
    const [x, y] = midOf( e, edge.a, edge.b );
    e.key( "2" );
    e.click( x, y + 6, { altKey: true } );
    expect( e.ed.sel.e.size ).toBe( 4 );
  } );

  it( "Alt+click in face mode selects the faces round the loop", () => {
    const e    = editing( cutBox() );
    const g    = e.mesh();
    // a vertical edge: the faces across it, round the box's side
    const side = [...edgesOf( g ).values()].filter( ( x ) => Math.abs( g.v[x.a][1] - g.v[x.b][1] ) > 0.5 ).sort( ( p, q ) => g.v[q.a][0] + g.v[q.a][2] - g.v[p.a][0] - g.v[p.a][2] )[0];
    e.key( "3" );
    e.click( ...midOf( e, side.a, side.b ), { altKey: true } );
    expect( e.ed.sel.f.size ).toBe( 4 );
  } );
} );

describe( "Edit Mode: undoing a selection", () => {
  it( "Ctrl+Z puts back the edges picked before a miss-click, one click at a time", () => {
    const e = editing( cutBox() );
    const g = e.mesh();
    e.key( "2" );
    // two edges picked round the middle, then a click on the wrong one
    const round  = [...edgesOf( g ).values()].filter( ( x ) => Math.abs( g.v[x.a][1] ) < 1e-6 && Math.abs( g.v[x.b][1] ) < 1e-6 );
    const [a, b] = round.filter( ( x ) => e.ed.picking.pickEdge( ...midOf( e, x.a, x.b ), 3 ) !== null );
    e.click( ...midOf( e, a.a, a.b ) );
    e.click( ...midOf( e, b.a, b.b ), { shiftKey: true } );
    expect( e.ed.sel.e.size ).toBe( 2 );
    const top = [...edgesOf( g ).values()].find( ( x ) => g.v[x.a][1] > 0.9 && g.v[x.b][1] > 0.9 && e.ed.picking.pickEdge( ...midOf( e, x.a, x.b ), 3 ) !== null )!;
    e.click( ...midOf( e, top.a, top.b ) );
    expect( e.ed.sel.e.size ).toBe( 1 );
    expect( history.nextUndo ).toBe( "Select" );
    history.undo();
    expect( e.ed.sel.e.size ).toBe( 2 );
    history.undo();
    expect( e.ed.sel.e.size ).toBe( 1 );
    history.redo();
    history.redo();
    expect( [...e.ed.sel.e] ).toEqual( [`${Math.min( top.a, top.b )}_${Math.max( top.a, top.b )}`] );
  } );

  it( "puts back the select mode too", () => {
    const e = editing( primitive( "cube" ) );
    e.key( "3" );
    expect( history.nextUndo ).toBe( "Select mode" );
    history.undo();
    expect( e.ed.mode ).toBe( "vert" );
  } );
} );

describe( "Edit Mode: snapping", () => {
  it( "Shift+S opens the Snap menu: the cursor to the selection, the selection to the cursor", () => {
    const e = editing( primitive( "cube" ) );
    e.ed.picking.selectAll( true );
    e.ed.picking.setMode( "face" );
    const top = e.mesh().f.findIndex( ( f ) => f.every( ( v ) => e.mesh().v[v][1] > 0.9 ) );
    e.ed.picking.selectOnly( top, false );
    e.key( "S", { shiftKey: true } );
    expect( e.menus[e.menus.length - 1].title ).toBe( "Snap" );
    // ( G wasn't started by it )
    expect( e.ed.modal ).toBeNull();
    e.choose( "Cursor to Selected" );
    expect( useEditor.getState().cursor3d.map( ( x ) => +x.toFixed( 6 ) ) ).toEqual( [0, 1, 0] );
    useEditor.setState( { cursor3d: [0, 3, 0] } );
    e.key( "S", { shiftKey: true } );
    e.choose( "Selection to Cursor (Keep Offset)" );
    expect( e.mesh().f[top].every( ( v ) => Math.abs( e.mesh().v[v][1] - 3 ) < 1e-6 ) ).toBe( true );
    expect( history.nextUndo                                                           ).toBe( "Selection to cursor" );
  } );

  it( "snaps a moved vertex onto an edge ( another piece's ), not just a corner or a face", () => {
    const e     = editing( primitive( "cube" ) );
    const other = newModelObject( "n", primitive( "cube" ), [3, 0, 0] );
    useEditor.setState( ( s ) => ( { customObjects: [...s.customObjects, other], modelTools: { ...s.modelTools, snap: true, snapTo: "edge" } } ) );
    const g = e.mesh();
    const v = g.v.findIndex( ( p ) => p[0] > 0.9 && p[1] > 0.9 && p[2] > 0.9 );
    e.click( ...e.at( g.v[v] ) );
    // the other box's top edge nearest the camera, a quarter of the way along it
    const target: V3 = [2.5, 1, 1];
    const [tx, ty]   = e.ed.picking.screen( e.ed.world( other, [-0.5, 1, 1] ) );
    e.key( "g" );
    e.move( tx + 2, ty + 1 );
    e.key( "Enter" );
    const p = e.mesh().v[v];
    expect( Math.hypot( p[0] - target[0], p[1] - target[1], p[2] - target[2] ) ).toBeLessThan( 0.05 );
  } );
} );

describe( "Edit Mode: Spin", () => {
  // a lathe profile: a line out from the axis, 1 m to 2 m along X
  const profile = (): Mesh => ( { v: [[1, 0, 0], [2, 0, 0]], f: [], m: [], s: [], w: [[0, 1]] } );

  it( "starts from nothing and sweeps round the 3D cursor as far as the mouse goes round it", () => {
    const e = editing( profile(), [0.5, 8, 0.5] );
    e.ed.picking.selectAll( true );
    const [cx, cy] = e.at( [0, 0, 0] );
    // the mouse out to the right of the cursor, then a quarter of the way round it on the screen
    e.move( cx + 150, cy );
    e.ed.ops.startSpin();
    expect( e.mesh().v.length ).toBe( 2 );
    for ( let k = 1; k <= 10; k++ ) e.move( cx + 150 * Math.cos( ( k / 10 ) * Math.PI / 2 ), cy - 150 * Math.sin( ( k / 10 ) * Math.PI / 2 ) );
    expect( e.ed.statusText ).toMatch( /^Spin: 90°/ );
    const [sx, sy] = e.at( [2, 0, 0] );
    e.key( "Enter" );
    // the swept end has gone round the cursor the way the mouse did, as far ( on the screen, seen from above )
    const ends = [...e.ed.sel.v].map( ( v ) => e.mesh().v[v] );
    expect( ends.length ).toBe( 2 );
    const far    = ends.find( ( p ) => Math.hypot( p[0], p[2] ) > 1.5 )!;
    const [x, y] = e.at( far );
    const turn   = THREE.MathUtils.radToDeg( Math.atan2( -( y - cy ), x - cx ) - Math.atan2( -( sy - cy ), sx - cx ) );
    expect( ( ( turn % 360 ) + 360 ) % 360 ).toBeCloseTo( 90, -1 );
    // a quarter turn in 12 steps: a fan of 12 quads
    expect( e.mesh().f.length ).toBe( 12 );
  } );

  it( "goes on past a half turn, to a whole one", () => {
    const e = editing( profile(), [0.5, 8, 0.5] );
    e.ed.picking.selectAll( true );
    const [cx, cy] = e.at( [0, 0, 0] );
    e.move( cx + 150, cy );
    e.ed.ops.startSpin();
    for ( let k = 1; k <= 36; k++ ) e.move( cx + 150 * Math.cos( ( k / 36 ) * Math.PI * 2 * 0.75 ), cy - 150 * Math.sin( ( k / 36 ) * Math.PI * 2 * 0.75 ) );
    expect( e.ed.statusText ).toMatch( /^Spin: 270°/ );
  } );
} );

describe( "Edit Mode: Knife", () => {
  it( "cuts through a point clicked inside a face, not only on edges", () => {
    const e   = editing( primitive( "cube" ), [0.5, 8, 0.5] );
    const g   = e.mesh();
    const top = g.f.findIndex( ( f ) => f.every( ( v ) => g.v[v][1] > 0.9 ) );
    const f   = g.f[top];
    e.key( "k" );
    // from the middle of one edge of the top, through a point inside it, to the middle of the edge across
    e.click( ...midOf( e, f[0], f[1] ), { ctrlKey: true } );
    e.click( ...e.at( [0.3, 1, -0.2] ) );
    e.click( ...midOf( e, f[2], f[3] ), { ctrlKey: true } );
    e.key( "Enter" );
    const m = e.mesh();
    expect( m.f.length ).toBe( 7 );
    const inside = m.v.findIndex( ( p ) => Math.abs( p[0] - 0.3 ) < 1e-3 && Math.abs( p[1] - 1 ) < 1e-3 && Math.abs( p[2] + 0.2 ) < 1e-3 );
    expect( inside                                             ).toBeGreaterThanOrEqual( 0 );
    expect( m.f.filter( ( x ) => x.includes( inside ) ).length ).toBe( 2 );
  } );
} );

describe( "Edit Mode: Edge Crease", () => {
  it( "Shift+E creases the selected edges, a typed amount as it is; one undo step", () => {
    const e = editing( primitive( "cube" ) );
    e.ed.picking.selectAll( true );
    e.key( "E", { shiftKey: true } );
    expect( e.ed.modal?.kind ).toBe( "crease" );
    e.key( "1" );
    e.key( "Enter" );
    const c = e.mesh().c ?? {};
    expect( Object.keys( c ).length                ).toBe( 12   );
    expect( Object.values( c ).every( ( w ) => w === 1 ) ).toBe( true );
    expect( history.nextUndo                       ).toBe( "Edge crease" );
    history.undo();
    expect( e.mesh().c ).toBeUndefined();
  } );

  it( "creases more as the mouse goes out from the edges, less coming back in", () => {
    const e = editing( primitive( "cube" ) );
    e.ed.picking.selectAll( true );
    const [cx, cy] = e.at( [0, 0, 0] );
    e.move( cx + 60, cy );
    e.key( "E", { shiftKey: true } );
    e.move( cx + 90, cy );
    const out = Object.values( e.mesh().c ?? {} )[0];
    expect( out ).toBeGreaterThan( 0.2 );
    e.move( cx + 70, cy );
    expect( Object.values( e.mesh().c ?? {} )[0] ).toBeLessThan( out );
    e.key( "Escape" );
    expect( e.mesh().c ).toBeUndefined();
  } );
} );

describe( "Edit Mode: UVs", () => {
  it( "U unwraps the selected faces ( Reset ), one undo step, and opens the UV Editor", () => {
    const e = editing( primitive( "cube" ) );
    e.ed.picking.setMode( "face" );
    e.ed.picking.selectAll( true );
    e.key( "u" );
    expect( e.menus[e.menus.length - 1].title ).toBe( "UV" );
    e.choose( "Reset" );
    expect( e.mesh().u?.every( ( u ) => u.join() === "0,0,1,0,1,1,0,1" ) ).toBe( true );
    expect( history.nextUndo                                               ).toBe( "Reset UVs" );
    e.key( "u" );
    e.choose( "UV Editor" );
    expect( useUvEditor.getState().open ).toBe( true );
  } );
} );

describe( "Edit Mode: Merge by Distance", () => {
  it( "says how many vertices went", () => {
    // a box with its top doubled up: four corners on top of four others
    const g = primitive( "cube" );
    const n = g.v.length;
    for ( const v of [4, 5, 6, 7] ) g.v.push( [...g.v[v]] );
    g.f.push( [n, n + 1, n + 2, n + 3] );
    g.m.push( 0 );
    g.s.push( false );
    const e = editing( g );
    e.ed.picking.selectAll( true );
    useEditor.setState( { toasts: [] } );
    e.key( "m" );
    e.choose( "By Distance" );
    expect( e.mesh().v.length                                  ).toBe( 8 );
    expect( useEditor.getState().toasts.map( ( t ) => t.text ) ).toEqual( ["Removed 4 vertices"] );
  } );
} );

describe( "Edit Mode: Shift with an axis locks it out", () => {
  it( "G then Shift+Z moves on Blender's X and Y only ( the game's height stays )", () => {
    const e   = editing( primitive( "cube" ) );
    const top = e.mesh().f.findIndex( ( f ) => f.every( ( v ) => e.mesh().v[v][1] > 0.9 ) );
    e.ed.sel  = { v: new Set( e.mesh().f[top] ), e: new Set(), f: new Set( [top] ) };
    e.move( 400, 300 );
    e.key( "g" );
    e.key( "Z", { shiftKey: true } );
    e.move( 470, 250 );
    e.key( "Enter" );
    const tops = e.mesh().f[top].map( ( v ) => e.mesh().v[v] );
    expect( tops.every( ( p ) => Math.abs( p[1] - 1 ) < 1e-9 ) ).toBe( true );
    // it did move, across the ground
    expect( Math.abs( tops[0][0] - 1 ) + Math.abs( Math.abs( tops[0][2] ) - 1 ) ).toBeGreaterThan( 0.05 );
  } );

  it( "S then Shift+Z scales across, not up", () => {
    const e = editing( primitive( "cube" ) );
    e.ed.picking.selectAll( true );
    e.move( 500, 300 );
    e.key( "s" );
    e.key( "Z", { shiftKey: true } );
    e.move( 600, 300 );
    e.key( "Enter" );
    const g = e.mesh();
    expect( Math.max( ...g.v.map( ( p ) => p[1] ) ) ).toBeCloseTo( 1, 9 );
    expect( Math.max( ...g.v.map( ( p ) => p[0] ) ) ).toBeGreaterThan( 1.2 );
    expect( e.ed.statusText                          ).toBe( "" );
  } );
} );
