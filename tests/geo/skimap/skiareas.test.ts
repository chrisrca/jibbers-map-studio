import { describe, expect, it } from "vitest";
// ( the tests run in node; the app itself has no node types )
// @ts-expect-error node module
import { readFileSync } from "node:fs";
// @ts-expect-error node module
import { gunzipSync } from "node:zlib";
import { searchSkiAreas, skiAreasFrom } from "../../../src/geo/skimap/skiareas";

const all = skiAreasFrom( new TextDecoder().decode( gunzipSync( readFileSync( new URL( "../../../public/skiareas.json.gz", import.meta.url ) ) ) ) );

describe( "the ski area search", () => {
  it( "finds what's typed, the obvious one first", () => {
    expect( searchSkiAreas( all, "stowe"    )[0].name ).toBe( "Stowe Mountain Resort" );
    expect( searchSkiAreas( all, "crotched" )[0].name ).toMatch( /Crotched Mountain/ );
    expect( searchSkiAreas( all, "whistler" )[0].name ).toMatch( /Whistler/          );
  } );

  it( "ignores accents and takes the region as well", () => {
    expect( searchSkiAreas( all, "meribel" ).some( ( a ) => /M[ée]ribel/.test( a.name ) || /Trois Vall/.test( a.name ) ) ).toBe( true );
    const vt = searchSkiAreas( all, "killington vermont" );
    expect( vt[0].name   ).toMatch( /Killington/ );
    expect( vt[0].region ).toBe( "Vermont" );
  } );

  it( "knows where each one's runs are", () => {
    const stowe        = searchSkiAreas( all, "stowe" )[0];
    const [w, s, e, n] = stowe.box;
    expect( stowe.lon       ).toBeGreaterThan( w );
    expect( stowe.lon       ).toBeLessThan( e );
    expect( ( e - w ) * 80  ).toBeGreaterThan( 2 ); // km across: Mansfield and Spruce Peak
    expect( ( n - s ) * 111 ).toBeLessThan( 10 );
  } );
} );
