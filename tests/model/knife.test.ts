import { describe, expect, it } from "vitest";
import { knifeCut } from "../../src/model/ops";
import { faceNormal, primitive, type V3 } from "../../src/model/mesh";

describe( "knife", () => {
  it( "cuts the top of a cube in two between two edge midpoints", () => {
    const g   = primitive( "cube" );
    const top = g.f.findIndex( ( _, i ) => faceNormal( g, i )[1] > 0.99 );
    const f   = g.f[top];
    const mid = ( a: number, b: number ): V3 => [0, 1, 2].map( ( k ) => ( g.v[a][k] + g.v[b][k] ) / 2 ) as V3;
    // two opposite edges of the top
    const r   = knifeCut( g, [{ a: f[0], b: f[1], p: mid( f[0], f[1] ) }, { a: f[2], b: f[3], p: mid( f[2], f[3] ) }] );
    expect( r.mesh.v.length ).toBe( 10 );
    expect( r.mesh.f.length ).toBe( 7  );
    // the sides along the cut edges took the new corners: still closed ( each edge in two faces )
    const count = new Map<string, number>();
    for ( const face of r.mesh.f )
      for ( let i = 0; i < face.length; i++ ) {
        const a = face[i], b = face[( i + 1 ) % face.length], k = a < b ? `${a},${b}` : `${b},${a}`;
        count.set( k, ( count.get( k ) ?? 0 ) + 1 );
      }
    expect( [...count.values()].every( ( n ) => n === 2 ) ).toBe( true );
    expect( r.sel.v.size                                  ).toBe( 2    );
  } );
} );

describe( "knife through faces", () => {
  const g    = primitive( "cube" );
  const top  = g.f.findIndex( ( _, i ) => faceNormal( g, i )[1] > 0.99 );
  const f    = g.f[top];
  const mid  = ( a: number, b: number ): V3 => [0, 1, 2].map( ( k ) => ( g.v[a][k] + g.v[b][k] ) / 2 ) as V3;
  const shut = ( m: typeof g ) => {
    const count = new Map<string, number>();
    for ( const face of m.f )
      for ( let i = 0; i < face.length; i++ ) {
        const a = face[i], b = face[( i + 1 ) % face.length], k = a < b ? `${a},${b}` : `${b},${a}`;
        count.set( k, ( count.get( k ) ?? 0 ) + 1 );
      }
    return [...count.values()].every( ( n ) => n === 2 );
  };

  it( "cuts from an edge, through a point inside the face, to the edge across", () => {
    const inside: V3 = [0.3, 1, 0.2];
    const r          = knifeCut( g, [{ a: f[0], b: f[1], p: mid( f[0], f[1] ) }, { f: top, p: inside }, { a: f[2], b: f[3], p: mid( f[2], f[3] ) }] );
    expect( r.mesh.f.length ).toBe( 7 );
    // the point inside is a corner of both halves of the top
    const at = r.mesh.v.findIndex( ( p ) => p[0] === inside[0] && p[1] === inside[1] && p[2] === inside[2] );
    expect( r.mesh.f.filter( ( x ) => x.includes( at ) ).length ).toBe( 2 );
    expect( shut( r.mesh ) ).toBe( true );
    expect( r.sel.v.size   ).toBe( 3    );
  } );

  it( "cuts from corner to corner through two points inside", () => {
    const r = knifeCut( g, [{ v: f[0] }, { f: top, p: [0.2, 1, 0.1] }, { f: top, p: [-0.1, 1, 0.3] }, { v: f[2] }] );
    expect( r.mesh.f.length ).toBe( 7    );
    expect( shut( r.mesh )  ).toBe( true );
    expect( r.mesh.f.filter( ( x ) => x.length === 5 ).length ).toBe( 2 );
  } );

  it( "leaves a cut that stops inside a face as a loose edge", () => {
    const r = knifeCut( g, [{ a: f[0], b: f[1], p: mid( f[0], f[1] ) }, { f: top, p: [0.1, 1, 0.1] }] );
    expect( r.mesh.f.length ).toBe( 6 );
    expect( r.mesh.w.length ).toBe( 1 );
  } );
} );
