import { describe, expect, it } from "vitest";
import { buildMesh, newModel } from "../../src/model/build";
import { primitive } from "../../src/model/mesh";
import { simplify } from "../../src/model/simplify";
import { atlasFor } from "../../src/texture/meshPaint";

const bounds = ( pos: Float32Array ) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for ( let i = 0; i < pos.length; i += 3 ) for ( let k = 0; k < 3; k++ ) { lo[k] = Math.min( lo[k], pos[i + k] ); hi[k] = Math.max( hi[k], pos[i + k] ); }
  return [0, 1, 2].map( ( k ) => hi[k] - lo[k] );
};

describe( "levels of detail", () => {
  it( "halves a smooth sphere and keeps its size", () => {
    const m       = newModel( primitive( "uvsphere" ) );
    m.mesh.s      = m.mesh.s.map( () => true );
    m.smoothAngle = 180;
    const full    = buildMesh( m, atlasFor );
    const half    = simplify( full, 0.5 );
    const tris    = full.idx.length / 3, left = half.idx.length / 3;
    expect( left ).toBeLessThan( tris * 0.75 );
    expect( left ).toBeGreaterThan( tris * 0.3 );
    const a = bounds( full.pos ), b = bounds( half.pos );
    for ( let k = 0; k < 3; k++ ) expect( Math.abs( a[k] - b[k] ) ).toBeLessThan( a[k] * 0.05 );
    expect( [...half.pos].every( Number.isFinite )        ).toBe( true            );
    expect( half.submeshes.reduce( ( x, y ) => x + y, 0 ) ).toBe( half.idx.length );
  } );

  it( "leaves a hard-edged cube whole", () => {
    const full = buildMesh( newModel( primitive( "cube" ) ) );
    expect( simplify( full, 0.25 ).idx.length ).toBe( full.idx.length );
  } );
} );
