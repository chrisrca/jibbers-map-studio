import { describe, expect, it } from "vitest";
import { selFromVerts, spin } from "../../src/model/ops";
import type { Mesh } from "../../src/model/mesh";

describe( "spin", () => {
  // a lathe profile: up the side, then in to the axis
  const profile: Mesh = { v: [[1, 0, 0], [1, 1, 0], [0, 1, 0]], f: [], m: [], s: [], w: [[0, 1], [1, 2]] };

  it( "turns a profile a whole way round into a closed-up cup", () => {
    const r = spin( profile, selFromVerts( profile, [0, 1, 2] ), [0, 0, 0], [0, 1, 0], Math.PI * 2, 8 );
    const g = r.mesh;
    expect( g.f.length ).toBe( 16 );
    // the bottom ring, the top ring and the point on the axis
    expect( g.v.length ).toBe( 17 );
    expect( g.f.every( ( f ) => new Set( f ).size === f.length && f.length >= 3 ) ).toBe( true );
    const radii = g.v.map( ( p ) => Math.hypot( p[0], p[2] ) );
    expect( radii.filter( ( x ) => Math.abs( x - 1 ) < 1e-6 ).length ).toBe( 16 );
  } );

  it( "turns part way, leaving the last ring selected", () => {
    const r = spin( profile, selFromVerts( profile, [0, 1, 2] ), [0, 0, 0], [0, 1, 0], Math.PI / 2, 3 );
    expect( r.mesh.f.length ).toBe( 6 );
    const last = [...r.sel.v].map( ( v ) => r.mesh.v[v] );
    // a quarter turn: the side's foot is round on the z axis
    expect( last.some( ( p ) => Math.abs( p[0] ) < 1e-6 && Math.abs( Math.abs( p[2] ) - 1 ) < 1e-6 && Math.abs( p[1] ) < 1e-6 ) ).toBe( true );
  } );
} );
