import { describe, expect, it } from "vitest";
// ( the tests run in node; the app itself has no node types )
// @ts-expect-error node module
import { readFileSync } from "node:fs";
// @ts-expect-error node module
import { gunzipSync } from "node:zlib";
import { pisteColor, skiMapFrom } from "../../../src/geo/skimap/skimap";

const map = skiMapFrom( new Uint8Array( gunzipSync( readFileSync( new URL( "../../../public/skimap.bin.gz", import.meta.url ) ) ) ) );

describe( "the shipped ski map", () => {
  it( "has Stowe's runs and lifts, named, where Stowe is", () => {
    const box: [number, number, number, number] = [-72.83, 44.51, -72.75, 44.56];
    const trails = map.trails( box );
    const runs   = trails.filter( ( t ) => t.kind !== "lift" ), lifts = trails.filter( ( t ) => t.kind === "lift" );
    expect( runs.length  ).toBeGreaterThan( 80 );
    expect( lifts.length ).toBeGreaterThan( 8  );
    expect( trails.some( ( t ) => /Nosedive|Goat|Starr/i.test( t.name ) ) ).toBe( true );
    for ( const t of trails ) for ( const p of t.points ) {
      expect( p.lon ).toBeGreaterThan( -73.5 );
      expect( p.lon ).toBeLessThan( -72 );
      expect( p.lat ).toBeGreaterThan( 44 );
      expect( p.lat ).toBeLessThan( 45 );
    }
  } );

  it( "colours runs the way the region's piste maps do", () => {
    const stowe = map.cell( -73, 44 ).find( ( l ) => l.difficulty === "intermediate" )!;
    expect( stowe.convention    ).toBe( "northAmerica" );
    expect( pisteColor( stowe ) ).toBe( "#1c6ed6"      );
    const alps = map.cell( 10, 47 ).find( ( l ) => l.difficulty === "intermediate" )!;
    expect( alps.convention    ).toBe( "europe"  );
    expect( pisteColor( alps ) ).toBe( "#d62828" );
  } );
} );
