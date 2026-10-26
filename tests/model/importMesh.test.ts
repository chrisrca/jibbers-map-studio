import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { gatherTris, trisToMesh, type SourceMesh } from "../../src/model/importMesh";
import { primitive } from "../../src/model/mesh";
import { buildMesh, newModel } from "../../src/model/build";
import { atlasFor, texelMap } from "../../src/texture/meshPaint";
import { bakeLook } from "../../src/texture/bake";

/**
 * A model's triangles as a part's mesh would store them ( with the box projection's UVs ).
**/
function asSource( id: Parameters<typeof primitive>[0], smoothAngle = 30 ): SourceMesh {
  const model = { ...newModel( primitive( id ) ), smoothAngle };
  if ( id === "cylinder" ) model.mesh.s = model.mesh.s.map( () => true );
  const b = buildMesh( model );
  return { pos: b.pos, nrm: b.nrm, uv: b.uv, idx: b.idx, submeshes: b.submeshes };
}

describe( "making a model of a piece's mesh", () => {
  it( "makes a triangulated cube six quads again", () => {
    const src = gatherTris( [{ mesh: asSource( "cube" ), matrix: new THREE.Matrix4(), slotBase: 0, slots: 1 }] );
    expect( src.slot.length ).toBe( 12 );
    const g = trisToMesh( src );
    expect( g.v.length                           ).toBe( 8    );
    expect( g.f.length                           ).toBe( 6    );
    expect( g.f.every( ( f ) => f.length === 4 ) ).toBe( true );
    expect( g.s.every( ( s ) => !s )             ).toBe( true );
  } );

  it( "pairs a round side into quads and keeps it smooth", () => {
    const src   = gatherTris( [{ mesh: asSource( "cylinder" ), matrix: new THREE.Matrix4(), slotBase: 0, slots: 1 }] );
    const g     = trisToMesh( src );
    const quads = g.f.filter( ( f ) => f.length === 4 );
    // the side's quads, smooth; the two caps one face each
    expect( quads.length                      ).toBeGreaterThanOrEqual( 16 );
    expect( g.f.some( ( f ) => f.length > 4 ) ).toBe( true );
    expect( g.s.filter( Boolean ).length      ).toBeGreaterThanOrEqual( quads.length );
  } );

  it( "bakes a texture onto the faces it was on", () => {
    const src  = gatherTris( [{ mesh: asSource( "cube" ), matrix: new THREE.Matrix4(), slotBase: 0, slots: 1 }] );
    const g    = trisToMesh( src );
    // a texture red on the left, blue on the right ( box projection: 1 m per repeat )
    const data = new Uint8Array( 16 * 16 * 4 );
    for ( let y = 0; y < 16; y++ ) for ( let x = 0; x < 16; x++ ) data.set( x < 8 ? [255, 0, 0, 255] : [0, 0, 255, 255], ( y * 16 + x ) * 4 );
    const tex   = { w: 16, h: 16, data };
    const map   = texelMap( g, atlasFor( g ), 128 );
    const baked = bakeLook( map, src, [{ colour: [1, 1, 1], tex, tiling: [1, 1], offset: [0, 0], metallic: 0, smoothness: 0.5 }] );
    let red     = 0, blue = 0, used = 0;
    for ( let k = 0; k < 128 * 128; k++ ) {
      if ( map.used[k] !== 1 ) continue;
      used++;
      if ( baked.rgba[k * 4] > 200 && baked.rgba[k * 4 + 2] < 60 ) red++;
      if ( baked.rgba[k * 4 + 2] > 200 && baked.rgba[k * 4] < 60 ) blue++;
    }
    expect( red + blue     ).toBeGreaterThan( used * 0.5  );
    expect( red            ).toBeGreaterThan( used * 0.15 );
    expect( blue           ).toBeGreaterThan( used * 0.15 );
    expect( baked.metallic ).toBeNull();
  } );
} );
