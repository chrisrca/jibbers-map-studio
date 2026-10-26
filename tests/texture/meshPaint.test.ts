import { describe, expect, it } from "vitest";
import { primitive } from "../../src/model/mesh";
import { newModelObject } from "../../src/model/objects";
import { smartProject } from "../../src/model/uv";
import { carry, channelPixels, matchTexels, paintAtlas, prepare, texelMap, updateNormal } from "../../src/texture/meshPaint";
import { extrudeFaces } from "../../src/model/ops";
import { useEditor } from "../../src/map/store";

describe( "paint layout", () => {
  it( "lays a box's six faces out apart, inside the square", () => {
    const g = primitive( "cube" );
    const a = smartProject( g );
    expect( Math.min( ...a.uv ) ).toBeGreaterThanOrEqual( 0 );
    expect( Math.max( ...a.uv ) ).toBeLessThanOrEqual( 1 );
    // each face's own rectangle, none overlapping another
    const boxes = g.f.map( ( f, fi ) => {
      const us = f.map( ( _, k ) => a.uv[( a.start[fi] + k ) * 2] ), vs = f.map( ( _, k ) => a.uv[( a.start[fi] + k ) * 2 + 1] );
      return [Math.min( ...us ), Math.min( ...vs ), Math.max( ...us ), Math.max( ...vs )];
    } );
    for ( let i = 0; i < boxes.length; i++ )
      for ( let j = 0; j < i; j++ ) {
        const [a0, b0, a1, b1] = boxes[i], [c0, d0, c1, d1] = boxes[j];
        expect( a1 <= c0 + 1e-6 || c1 <= a0 + 1e-6 || b1 <= d0 + 1e-6 || d1 <= b0 + 1e-6 ).toBe( true );
      }
    // every face at the same size ( texel density )
    const sizes = boxes.map( ( [x0, y0, x1, y1] ) => ( x1 - x0 ) * ( y1 - y0 ) );
    expect( Math.max( ...sizes ) / Math.min( ...sizes ) ).toBeLessThan( 1.01 );
  } );

  it( "finds where texels lie, and carries paint across a changed shape", () => {
    const g    = primitive( "cube" );
    const m    = texelMap( g, smartProject( g ), 64 );
    const used = m.used.reduce( ( n, u ) => n + ( u ? 1 : 0 ), 0 );
    expect( used ).toBeGreaterThan( 64 * 64 * 0.3 );
    // paint the top red, then make the box a little taller: the new top is still red
    const rgba = new Uint8Array( 64 * 64 * 4 ).fill( 255 );
    for ( let k = 0; k < 64 * 64; k++ ) if ( m.used[k] && m.nrm[k * 3 + 1] > 0.9 ) rgba.set( [255, 0, 0, 255], k * 4 );
    const tall = primitive( "cube" );
    tall.v     = tall.v.map( ( [x, y, z] ) => [x, y > 0 ? y + 0.02 : y, z] );
    const m2   = texelMap( tall, smartProject( tall ), 64 );
    const out  = carry( matchTexels( m, m2 ), rgba );
    let tops   = 0, red = 0;
    for ( let k = 0; k < 64 * 64; k++ )
      if ( m2.used === m2.used && m2.used[k] === 1 && m2.nrm[k * 3 + 1] > 0.9 ) {
        tops++;
        if ( out[k * 4] === 255 && out[k * 4 + 1] === 0 ) red++;
      }
    expect( red / tops ).toBeGreaterThan( 0.95 );
  } );

} );

describe( "paint carried across", () => {
  it( "a top pulled up half a metre keeps its paint", async () => {
    const { extrudeFaces } = await import( "../../src/model/ops"  );
    const { faceNormal   } = await import( "../../src/model/mesh" );
    const g                = primitive( "cube" );
    const m                = texelMap( g, smartProject( g ), 64 );
    const rgba             = new Uint8Array( 64 * 64 * 4 ).fill( 255 );
    for ( let k = 0; k < 64 * 64; k++ ) if ( m.used[k] && m.nrm[k * 3 + 1] > 0.9 ) rgba.set( [255, 0, 0, 255], k * 4 );
    const top = g.f.findIndex( ( _, i ) => faceNormal( g, i )[1] > 0.99 );
    const r   = extrudeFaces( g, new Set( [top] ) );
    for ( const v of r.sel.v ) r.mesh.v[v] = [r.mesh.v[v][0], r.mesh.v[v][1] + 0.5, r.mesh.v[v][2]];
    const m2  = texelMap( r.mesh, smartProject( r.mesh ), 64 );
    const out = carry( matchTexels( m, m2 ), rgba );
    let tops  = 0, red = 0, sides = 0, sideRed = 0;
    for ( let k = 0; k < 64 * 64; k++ ) {
      if ( m2.used[k] !== 1 ) continue;
      const isRed = out[k * 4 + 1] === 0;
      if ( m2.nrm[k * 3 + 1] > 0.9 ) { tops++; red += isRed ? 1 : 0; }
      else if ( Math.abs( m2.nrm[k * 3 + 1] ) < 0.1 ) { sides++; sideRed += isRed ? 1 : 0; }
    }
    expect( red     / tops  ).toBeGreaterThan( 0.95 );
    expect( sideRed / sides ).toBeLessThan( 0.05 );
  } );
} );

describe( "paint maps", () => {
  it( "starts a grey map at the material's value and bends the normals where the height steps", () => {
    const o = newModelObject( "maps", primitive( "cube" ), [0, 0, 0] );
    useEditor.setState( { customObjects: [o] } );
    const { T } = prepare( o as Parameters<typeof prepare>[0] );
    const metal = channelPixels( T, "metallic", o );
    expect( metal[0] ).toBe( Math.round( ( o.parts[0].materials[0].metallic ?? 0 ) * 255 ) );
    const h = channelPixels( T, "height", o ), n = T.n;
    // a raised square in the middle
    for ( let y = n / 4; y < ( 3 * n ) / 4; y++ ) for ( let x = n / 4; x < ( 3 * n ) / 4; x++ ) h[( y * n + x ) * 4] = 255;
    updateNormal( T );
    const at = ( x: number, y: number ) => [...T.normal!.subarray( ( y * n + x ) * 4, ( y * n + x ) * 4 + 3 )];
    // flat inside and outside, leaning away across the left edge ( x rises: the normal points to -x )
    expect( at( n / 2, n / 2 )    ).toEqual( [128, 128, 255] );
    expect( at( 2, 2 )            ).toEqual( [128, 128, 255] );
    expect( at( n / 4, n / 2 )[0] ).toBeLessThan( 100 );
  } );
} );

describe( "paint layouts", () => {
  it( "keeps the layout while corners move, and makes a new one when the faces change", () => {
    const o = newModelObject( "keep", primitive( "cube" ), [0, 0, 0] );
    useEditor.setState( { customObjects: [o] } );
    prepare( o as Parameters<typeof prepare>[0] );
    const painted = useEditor.getState().customObjects[0] as Parameters<typeof prepare>[0];
    const sig     = painted.model.paint!.sig;
    expect( painted.model.paint!.uv!.length ).toBe( 24 * 2 );
    // a corner pulled up: the same layout
    const moved = { ...painted.model, mesh: { ...painted.model.mesh, v: painted.model.mesh.v.map( ( p, i ) => ( i === 0 ? ( [p[0], p[1] + 0.5, p[2]] as typeof p ) : p ) ) } };
    expect( paintAtlas( moved ).sig ).toBe( sig );
    // a face extruded: a new one
    const ex = extrudeFaces( painted.model.mesh, new Set( [0] ) );
    expect( paintAtlas( { ...painted.model, mesh: ex.mesh } ).sig ).not.toBe( sig );
  } );
} );
