import { describe, expect, it } from "vitest";
import type { ModelData } from "../../src/model/build";
import { primitive, type Mesh } from "../../src/model/mesh";
import { newModelObject } from "../../src/model/objects";
import { history } from "../../src/map/history";
import { channelPixels, pieceTexture, prepare } from "../../src/texture/meshPaint";
import { useEditor } from "../../src/map/store";
import { DEFAULT_DIRT, DEFAULT_EDGE_WEAR, DEFAULT_SCRATCHES, dirt, edgeWear, scratches } from "../../src/texture/weathering";

type Piece = ReturnType<typeof newModelObject> & { model: ModelData };

function place( uid: string, mesh: Mesh ): () => Piece {
  const o        = newModelObject( uid, mesh, [0, 0, 0] );
  o.model!.paint = { size: 256, sig: "", topo: "", uv: [] } as never;
  useEditor.setState( { customObjects: [o], selection: [] } );
  return () => useEditor.getState().customObjects.find( ( x ) => x.uid === uid ) as Piece;
}

/**
 * An L-shaped block ( 2 m deep ): an inside corner where the step meets the floor at y = 1, x = 1.
**/
function lShape(): Mesh {
  // the L's outline ( x, y ), anticlockwise, extruded along z from -1 to 1
  const P: [number, number][]         = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]];
  const v: [number, number, number][] = [...P.map( ( [x, y] ) => [x, y, -1] as [number, number, number] ), ...P.map( ( [x, y] ) => [x, y, 1] as [number, number, number] )];
  const n                             = P.length;
  const f: number[][]                 = [
    // back ( z = -1, facing -z ) as two quads, front ( z = +1 ) the same
    [0, 3, 2, 1], [0, 5, 4, 3],
    [n, n + 1, n + 2, n + 3], [n, n + 3, n + 4, n + 5],
  ];
  // the sides
  for ( let i = 0; i < n; i++ ) f.push( [i, ( i + 1 ) % n, n + ( ( i + 1 ) % n ), n + i] );
  return { v, f, m: f.map( () => 0 ), s: f.map( () => false ), w: [] };
}

const grey = ( px: Uint8Array, k: number ) => px[k * 4];

describe( "edge wear", () => {
  it( "bares the metal along a box's edges, not in the middle of its faces, in one undo step", () => {
    const piece = place( "wear-a", primitive( "cube" ) );
    edgeWear( piece(), { ...DEFAULT_EDGE_WEAR, width: 0.25, amount: 1, top: 0 } );
    const { T, map } = prepare( piece() );
    const metal      = channelPixels( T, "metallic" );
    let edge         = 0, edgeN = 0, mid = 0, midN = 0;
    for ( let k = 0; k < map.n * map.n; k++ ) {
      if ( map.used[k] !== 1 ) continue;
      const s = [map.pos[k * 3], map.pos[k * 3 + 1], map.pos[k * 3 + 2]].map( Math.abs ).sort( ( a, b ) => b - a )[1];
      if ( s > 0.95 ) { edge += grey( metal, k ) > 128 ? 1 : 0; edgeN++; }
      else if ( s < 0.4 ) { mid += grey( metal, k ) > 128 ? 1 : 0; midN++; }
    }
    expect( edge / edgeN     ).toBeGreaterThan( 0.3 );
    expect( mid  / midN      ).toBeLessThan( 0.05 );
    expect( history.nextUndo ).toBe( "Edge Wear" );
  } );

  it( "is undone whole: colour and metal back as they were", () => {
    const piece = place( "wear-b", primitive( "cube" ) );
    const { T } = prepare( piece() );
    const rgb0  = T.rgba.slice();
    edgeWear( piece(), { ...DEFAULT_EDGE_WEAR, width: 0.25, amount: 1 } );
    expect( pieceTexture( "wear-b" )!.rgba ).not.toEqual( rgb0 );
    history.undo();
    expect( pieceTexture( "wear-b" )!.rgba ).toEqual( rgb0 );
  } );
} );

describe( "scratches", () => {
  it( "cuts thin grooves, the same ones again for the same seed", () => {
    const piece = place( "scr-a", primitive( "cube" ) );
    scratches( piece(), { ...DEFAULT_SCRATCHES, count: 60, length: 0.6, width: 0.02 } );
    const { T, map } = prepare( piece() );
    const h          = channelPixels( T, "height" );
    let cut          = 0, used = 0;
    for ( let k = 0; k < map.n * map.n; k++ ) if ( map.used[k] === 1 ) { used++; h[k * 4] < 120 && cut++; }
    // some, but a small share of the surface: they're thin
    expect( cut        ).toBeGreaterThan( 50 );
    expect( cut / used ).toBeLessThan( 0.25 );
    const first = h.slice();
    history.undo();
    scratches( piece(), { ...DEFAULT_SCRATCHES, count: 60, length: 0.6, width: 0.02 } );
    expect( channelPixels( prepare( piece() ).T, "height" ) ).toEqual( first );
  } );

  it( "are more on the top than the bottom when told to be", () => {
    const piece = place( "scr-b", primitive( "cube" ) );
    scratches( piece(), { ...DEFAULT_SCRATCHES, count: 200, length: 0.4, width: 0.02, top: 1 } );
    const { T, map } = prepare( piece() );
    const h          = channelPixels( T, "height" );
    let top          = 0, bottom = 0;
    for ( let k = 0; k < map.n * map.n; k++ ) {
      if ( map.used[k] !== 1 || h[k * 4] >= 120 ) continue;
      if ( map.nrm[k * 3 + 1] > 0.9 ) top++;
      else if ( map.nrm[k * 3 + 1] < -0.9 ) bottom++;
    }
    expect( top ).toBeGreaterThan( bottom * 3 );
  } );
} );

describe( "dirt", () => {
  it( "gathers in an inside corner and low down, and roughens", () => {
    const piece = place( "dirt-a", lShape() );
    dirt( piece(), { ...DEFAULT_DIRT, amount: 1, crevice: 0.3, bottom: 0.2, streaks: 0 } );
    const { T, map } = prepare( piece() );
    const rough      = channelPixels( T, "roughness" );
    // texels near the inside corner ( x ≈ 1, y ≈ 1 ) against ones high up on the outside ( x = 0 face, y ≈ 2.5 )
    let corner       = 0, cornerN = 0, high = 0, highN = 0;
    for ( let k = 0; k < map.n * map.n; k++ ) {
      if ( map.used[k] !== 1 ) continue;
      const x = map.pos[k * 3], y = map.pos[k * 3 + 1], dark = T.rgba[k * 4] < 160 ? 1 : 0;
      if ( Math.abs( x - 1 ) < 0.12 && Math.abs( y - 1 ) < 0.12 ) { corner += dark; cornerN++; }
      else if ( y > 2.2 && y < 2.8 && x < 0.05 ) { high += dark; highN++; }
    }
    expect( cornerN           ).toBeGreaterThan( 0   );
    expect( corner  / cornerN ).toBeGreaterThan( 0.5 );
    expect( high    / highN   ).toBeLessThan( 0.1 );
    let rougher = 0;
    for ( let k = 0; k < map.n * map.n; k++ ) if ( map.used[k] === 1 && T.rgba[k * 4] < 160 && grey( rough, k ) > 200 ) rougher++;
    expect( rougher ).toBeGreaterThan( 0 );
  } );
} );
