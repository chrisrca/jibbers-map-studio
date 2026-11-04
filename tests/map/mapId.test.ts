import { describe, expect, it } from "vitest";
import { isValidMapId, MAP_ID_MAX, mapIdFrom } from "../../src/map/mapId";

describe( "map ids", () => {
  it( "makes a short id from a name, as the game's own maps have them", () => {
    expect( mapIdFrom( "Ruka Park"            ) ).toBe( "ruka-park"       );
    expect( mapIdFrom( "nines26"              ) ).toBe( "nines26"         );
    expect( mapIdFrom( "  Swatch Nines '26! " ) ).toBe( "swatch-nines-26" );
    expect( mapIdFrom( "<b>MLNZ</b> Park"     ) ).toBe( "mlnz-park"       );
    expect( mapIdFrom( "my_map"               ) ).toBe( "my_map"          );
  } );

  it( "keeps what's typed within what the game takes", () => {
    const long = mapIdFrom( "a very long map name that goes on and on past the limit" );
    expect( long.length          ).toBeLessThanOrEqual( MAP_ID_MAX );
    expect( long.endsWith( "-" ) ).toBe( false );
    expect( isValidMapId( long ) ).toBe( true );
    expect( mapIdFrom( "!!!"   ) ).toBe( "" );
  } );

  it( "tells ids the game refuses", () => {
    expect( isValidMapId( "ruka-park"                            ) ).toBe( true  );
    expect( isValidMapId( "0ce48026-8aa4-4e72-b861-ff45c028ef6d" ) ).toBe( true  );
    expect( isValidMapId( ""                                     ) ).toBe( false );
    expect( isValidMapId( "has space"                            ) ).toBe( false );
    expect( isValidMapId( "x".repeat( 37 )                       ) ).toBe( false );
  } );
} );
