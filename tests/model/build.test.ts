import { describe, expect, it } from "vitest";
import { buildMesh, evaluate, MODIFIERS, modelColliders, newModel, triangulateFace, type Modifier } from "../../src/model/build";
import { edgesOf, faceNormal, primitive } from "../../src/model/mesh";
import { extrudeFaces } from "../../src/model/ops";

const mod = ( type: Modifier["type"], p: Partial<Modifier> = {} ) => ( { ...MODIFIERS.find( ( m ) => m.type === type )!.make(), ...p } ) as Modifier;

describe( "building a modelled piece", () => {
  it( "a box: 12 triangles, flat normals, a submesh per slot", () => {
    const g = primitive( "cube" );
    g.m[0]  = 1;
    const b = buildMesh( newModel( g ) );
    expect( b.idx.length     ).toBe( 36 );
    expect( b.pos.length / 3 ).toBe( 24 );
    expect( b.submeshes      ).toEqual( [30, 6] );
    // smooth a sphere: fewer corners than flat ( normals shared )
    const s    = primitive( "uvsphere" );
    s.s        = s.s.map( () => true );
    const flat = buildMesh( newModel( primitive( "uvsphere" ) ) ), smooth = buildMesh( { ...newModel( s ), smoothAngle: 89 } );
    expect( smooth.pos.length ).toBeLessThan( flat.pos.length );
  } );

  it( "cuts an L-shaped face into triangles inside it", () => {
    // an L in the ground plane, counter-clockwise seen from above ( y up )
    const v: [number, number, number][] = [[0, 0, 0], [0, 0, 2], [1, 0, 2], [1, 0, 1], [2, 0, 1], [2, 0, 0]];
    const g                             = { v, f: [[0, 1, 2, 3, 4, 5]], m: [0], s: [false], w: [] as [number, number][] };
    const n                             = faceNormal( g, 0 );
    expect( n[1] ).toBeCloseTo( 1 );
    const tris = triangulateFace( g, g.f[0], n );
    expect( tris.length ).toBe( 4 );
    // no triangle covers the L's missing corner ( 1.5, 1.5 )
    const inTri = ( t: number[] ) => {
      const [a, b, c] = t.map( ( i ) => [v[i][0], v[i][2]] );
      const s         = ( p: number[], q: number[] ) => ( q[0] - p[0] ) * ( 1.5 - p[1] ) - ( 1.5 - p[0] ) * ( q[1] - p[1] );
      const d         = [s( a, b ), s( b, c ), s( c, a )];
      return d.every( ( x ) => x > 0 ) || d.every( ( x ) => x < 0 );
    };
    expect( tris.some( inTri ) ).toBe( false );
  } );

  it( "modifiers: mirror joins at the middle, array repeats, subdivision smooths", () => {
    // half a box ( x from 0 to 1 ) with its open side on the mirror plane
    const half = primitive( "cube" );
    half.v     = half.v.map( ( [x, y, z] ) => [x > 0 ? 1 : 0, y, z] );
    const m    = evaluate( { ...newModel( half ), modifiers: [mod( "mirror" )] } );
    expect( m.v.length ).toBe( 12 );
    const arr = evaluate( { ...newModel( primitive( "cube" ) ), modifiers: [mod( "array", { count: 3, merge: true } as Partial<Modifier> )] } );
    // three boxes in a row, their touching faces gone: one long closed box
    expect( [...edgesOf( arr ).values()].every( ( e ) => e.faces.length === 2 ) ).toBe( true );
    expect( arr.f.length ).toBe( 14 );
    const sub = evaluate( { ...newModel( primitive( "cube" ) ), modifiers: [mod( "subsurf", { levels: 2 } as Partial<Modifier> )] } );
    expect( sub.f.length ).toBe( 96 );
    // a subdivided box is rounder: its corners pulled in
    expect( Math.max( ...sub.v.map( ( p ) => Math.hypot( ...p ) ) ) ).toBeLessThan( Math.sqrt( 3 ) * 0.9 );
  } );

  it( "colliders: a box is one box, a cylinder one convex mesh, an L a box under each flat face", () => {
    const box = modelColliders( newModel( primitive( "cube" ) ) );
    expect( box.length  ).toBe( 1     );
    expect( box[0].kind ).toBe( "box" );
    if ( box[0].kind === "box" ) expect( box[0].half.map( ( h ) => +h.toFixed( 4 ) ) ).toEqual( [1, 1, 1] );
    const cyl = modelColliders( newModel( primitive( "cylinder", { segments: 12 } ) ) );
    expect( cyl.map( ( c ) => c.kind ) ).toEqual( ["convex"] );
    // an L: a box with one side face pulled out
    const g    = primitive( "cube" );
    const side = g.f.findIndex( ( _, i ) => faceNormal( g, i )[0] > 0.99 );
    const r    = extrudeFaces( g, new Set( [side] ) );
    for ( const v of r.sel.v ) r.mesh.v[v] = [r.mesh.v[v][0] + 2, r.mesh.v[v][1] - 1, r.mesh.v[v][2]];
    const L = modelColliders( newModel( r.mesh ) );
    expect( L.length                             ).toBeGreaterThan( 4 );
    expect( L.every( ( c ) => c.kind === "box" ) ).toBe( true );
    expect( modelColliders( { ...newModel( primitive( "cube" ) ), colliders: "none" } ) ).toEqual( [] );
  } );
} );

describe( "colliders of bevelled pieces", () => {
  it( "a bevelled box is still one convex collider", () => {
    const c = modelColliders( { ...newModel( primitive( "cube" ) ), modifiers: [mod( "bevel", { width: 0.1, segments: 3 } as Partial<Modifier> )] } );
    expect( c.map( ( x ) => x.kind ) ).toEqual( ["convex"] );
    const two = modelColliders( { ...newModel( primitive( "cube" ) ), modifiers: [mod( "array", { count: 2, relative: [1.5, 0, 0] } as Partial<Modifier> ), mod( "bevel" )] } );
    expect( two.map( ( x ) => x.kind ) ).toEqual( ["convex", "convex"] );
  } );
} );
