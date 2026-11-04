import { describe, expect, it } from "vitest";
import { buildMesh, evaluate, MODIFIERS, newModel, type Modifier } from "../../src/model/build";
import { faceNormal, faceUvs, primitive } from "../../src/model/mesh";
import { remove, selFromFaces } from "../../src/model/ops";
import { joined, moveUvs, unwrap, uvAt } from "../../src/model/uvEdit";

const all  = ( n: number ) => Array.from( { length: n }, ( _, i ) => i );
const top  = ( g: ReturnType<typeof primitive> ) => g.f.findIndex( ( _, i ) => faceNormal( g, i )[1] > 0.99 );
const in01 = ( u: number[] ) => u.every( ( x ) => x >= -1e-9 && x <= 1 + 1e-9 );

describe( "UVs", () => {
  it( "Reset lays each face on the whole square; the built mesh takes them over the box projection", () => {
    const g = unwrap( primitive( "cube" ), all( 6 ), "reset" );
    expect( g.u!.every( ( u ) => u.join() === "0,0,1,0,1,1,0,1" ) ).toBe( true );
    const b = buildMesh( newModel( g ) );
    expect( in01( [...b.uv] ) ).toBe( true );
    // the box projection's are in metres: a 2 m box goes from -1 to 1
    expect( Math.min( ...buildMesh( newModel( primitive( "cube" ) ) ).uv ) ).toBeCloseTo( -1, 6 );
  } );

  it( "Smart UV Project, Cube Projection and Project from View each fit the square", () => {
    const g = primitive( "uvsphere", { segments: 12, rings: 6 } );
    for ( const kind of ["smart", "cube"] as const ) {
      const u = unwrap( g, all( g.f.length ), kind );
      expect( u.f.every( ( _, fi ) => faceUvs( u, fi ) && in01( faceUvs( u, fi )! ) ) ).toBe( true );
    }
    // the top of a box seen from above: its corners on the square's
    const box  = primitive( "cube" ), t = top( box );
    const seen = unwrap( box, [t], "view", { right: [1, 0, 0], up: [0, 0, 1] } );
    expect( [...faceUvs( seen, t )!].map( ( x ) => +x.toFixed( 6 ) ).sort() ).toEqual( [0, 0, 0, 0, 1, 1, 1, 1] );
    // only what was unwrapped has UVs of its own
    expect( seen.f.filter( ( _, fi ) => faceUvs( seen, fi ) ).length ).toBe( 1 );
  } );

  it( "moving corners: a face with none of its own gets its projection first, and only the corners move", () => {
    const g     = primitive( "cube" ), t = top( g );
    const was   = g.f[t].map( ( _, k ) => uvAt( g, t, k ) );
    const moved = moveUvs( g, [[t, 0]], ( u, v ) => [u + 0.5, v] );
    expect( uvAt( moved, t, 0 )[0] ).toBeCloseTo( was[0][0] + 0.5, 9 );
    expect( uvAt( moved, t, 1 )    ).toEqual( was[1] );
    expect( faceUvs( moved, t )    ).not.toBeNull();
  } );

  it( "corners are joined where faces share a vertex at the same place in UV, not across a seam", () => {
    const g = unwrap( primitive( "cube" ), all( 6 ), "smart" ), t = top( g );
    // the box's sides laid out apart: the top's corner has nothing joined to it
    expect( joined( g, all( 6 ), t, 0 ) ).toEqual( [[t, 0]] );
    const flat = unwrap( primitive( "grid", { segments: 2 } ), all( 4 ), "view", { right: [1, 0, 0], up: [0, 0, 1] } );
    // the grid's middle vertex, in all four of its faces
    const mid  = flat.v.findIndex( ( p ) => Math.abs( p[0] ) < 1e-9 && Math.abs( p[2] ) < 1e-9 );
    const fi   = flat.f.findIndex( ( f ) => f.includes( mid ) );
    expect( joined( flat, all( 4 ), fi, flat.f[fi].indexOf( mid ) ).length ).toBe( 4 );
  } );

  it( "stay with their faces through deleting others, and through Mirror", () => {
    const g    = unwrap( primitive( "cube" ), all( 6 ), "reset" ), t = top( g );
    const less = remove( g, selFromFaces( g, [t] ), "faces" ).mesh;
    expect( less.f.length ).toBe( 5 );
    expect( less.f.every( ( _, fi ) => faceUvs( less, fi )?.join() === "0,0,1,0,1,1,0,1" ) ).toBe( true );
    const half = primitive( "plane" );
    half.v     = half.v.map( ( [x, y, z] ) => [x > 0 ? 1 : 0, y, z] );
    const laid = unwrap( half, [0], "reset" );
    const mir  = evaluate( { ...newModel( laid ), modifiers: [{ ...MODIFIERS.find( ( m ) => m.type === "mirror" )!.make() } as Modifier] } );
    expect( mir.f.length                                   ).toBe( 2 );
    expect( mir.f.every( ( _, fi ) => faceUvs( mir, fi ) ) ).toBe( true );
  } );
} );
