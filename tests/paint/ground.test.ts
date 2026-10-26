import { describe, expect, it } from "vitest";
import { gripBlocked, spreadHue, upsampleMask, type PaintLayer } from "../../src/paint/ground";

/**
 * An m × m mask, all snow, with a marking ( hue `g`, coverage 255 ) on the given pixels.
**/
function mask( m: number, marked: [number, number, number][] ) {
  const px = new Uint8Array( m * m * 4 );
  for ( let k = 0; k < m * m; k++ ) px[k * 4] = 255;
  for ( const [x, y, g] of marked ) {
    px[( y * m + x ) * 4 + 1] = g;
    px[( y * m + x ) * 4 + 2] = 255;
  }
  return px;
}
const hueAt = ( px: Uint8Array, m: number, x: number, y: number ) => px[( y * m + x ) * 4 + 1];
const covAt = ( px: Uint8Array, m: number, x: number, y: number ) => px[( y * m + x ) * 4 + 2];

describe( "spreadHue", () => {
  it( "gives the pixels just outside a marking its hue, without covering them", () => {
    const m  = 16;
    const px = mask( m, [[8, 8, 51]] );
    spreadHue( px, m );
    expect( hueAt( px, m, 9, 8 )  ).toBe( 51 );
    expect( hueAt( px, m, 10, 8 ) ).toBe( 51 );
    expect( hueAt( px, m, 11, 8 ) ).toBe( 0  ); // beyond the reach
    expect( covAt( px, m, 9, 8 )  ).toBe( 0  ); // the coverage is untouched: nothing new shows, only the edge softens
  } );

  it( "never repaints another marking, and the stronger neighbour wins", () => {
    const m                   = 16;
    const px                  = mask( m, [[4, 4, 51], [7, 4, 153]] );
    px[( 4 * m + 7 ) * 4 + 2] = 120; // the second marking is fainter
    spreadHue( px, m );
    expect( hueAt( px, m, 7, 4 ) ).toBe( 153 ); // a covered pixel keeps its own hue
    expect( hueAt( px, m, 5, 4 ) ).toBe( 51  );
    expect( hueAt( px, m, 6, 4 ) ).toBe( 51  ); // 2 px from the strong one, 1 px from the faint one: the strong one wins
  } );

  it( "works on a part of the mask, reaching just past it", () => {
    const m  = 32;
    const px = mask( m, [[10, 10, 51], [25, 25, 102]] );
    spreadHue( px, m, 8, 8, 12, 12 );
    expect( hueAt( px, m, 12, 10 ) ).toBe( 51 );
    expect( hueAt( px, m, 26, 25 ) ).toBe( 0  ); // outside the area asked for
  } );
} );

describe( "upsampleMask", () => {
  it( "blends snow and coverage between pixels and keeps each hue whole", () => {
    // 2 x 2: left column rock with a red marking, right column snow with a blue one
    const m  = 2;
    const px = new Uint8Array( m * m * 4 );
    for ( const y of [0, 1] ) {
      px.set( [0,   10,  255, 0  ], ( y * m ) * 4     );
      px.set( [255, 120, 0,   200], ( y * m + 1 ) * 4 );
    }
    const M    = 8;
    const up   = upsampleMask( px, m, M );
    const row  = ( c: number ) => Array.from( { length: M }, ( _, x ) => up[( 3 * M + x ) * 4 + c] );
    // snow ramps from rock to snow across the middle, never outside 0..255, and is flat at the ends
    const snow = row( 0 );
    expect( snow[0]     ).toBe( 0   );
    expect( snow[M - 1] ).toBe( 255 );
    for ( let x = 1; x < M; x++ ) expect( snow[x] ).toBeGreaterThanOrEqual( snow[x - 1] );
    expect( new Set( snow ).size ).toBeGreaterThan( 3 );
    // hues are only ever one of the two, split down the middle
    expect( row( 1 ) ).toEqual( [10, 10, 10, 10, 120, 120, 120, 120] );
    // powder blends too
    expect( row( 3 )[0]     ).toBe( 0   );
    expect( row( 3 )[M - 1] ).toBe( 200 );
  } );
} );

describe( "gripBlocked", () => {
  const layer = ( four: boolean, rgba: Uint8Array ): PaintLayer => ( { key: "c", m: 16, rgba, flow: null, four, dirty: false, version: 0, pending: null } );
  it( "lets grip onto a chunk without the flag, or with it and nothing on it yet", () => {
    expect( gripBlocked( layer( false, mask( 16, [[3, 3, 51]] ) ) ) ).toBe( false );
    expect( gripBlocked( layer( true,  mask( 16, [] ) ) )           ).toBe( false );
  } );
  it( "keeps it off a chunk showing markings or powder", () => {
    expect( gripBlocked( layer( true, mask( 16, [[3, 3, 51]] ) ) ) ).toBe( true );
    const px                   = mask( 16, [] );
    px[( 5 * 16 + 5 ) * 4 + 3] = 128;
    expect( gripBlocked( layer( true, px ) ) ).toBe( true );
  } );
  it( "looks again once the mask has changed", () => {
    const L = layer( true, mask( 16, [] ) );
    expect( gripBlocked( L ) ).toBe( false );
    L.rgba[3] = 200;
    expect( gripBlocked( L ) ).toBe( false ); // ( the same version: remembered )
    L.version++;
    expect( gripBlocked( L ) ).toBe( true );
  } );
} );
