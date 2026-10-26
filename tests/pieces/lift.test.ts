// ( the tests run in node; the app itself has no node types )
// @ts-expect-error node module
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { V3 } from "../../src/core/coords";
import type { ObjectEntry, PlaceholderInfo } from "../../src/core/types";
import { autoMasts, liftCable, liftLocal, liftPieces, liftPoint, mastIndexFor } from "../../src/pieces/lift";

const infos: PlaceholderInfo[] = JSON.parse( readFileSync( new URL( "../../library/placeholders/placeholders.json", import.meta.url ), "utf8" ) );
const info                     = ( id: string ) => infos.find( ( i ) => i.id === id )!;

// Joyosa Park's chairlift, as the game ships it
const joyosa = (): ObjectEntry => ( {
  uid:      "c",
  id:       "chairlift",
  position: [1.8446, -154.6876, 21.8034],
  rotation: [0, 0, 0],
  scale:    [1, 1, 1],
  params:   { speed: { type: "Float", value: 6.5 }, slack: { type: "Float", value: 0.5 } },
  lift: {
    endPosition: { x: -427.8188, y: 133.3238, z: -254.4904 },
    masts: [
      { x: -109.3814, y: 24.8881,  z: -41.1563  },
      { x: -203.4106, y: 41.5417,  z: -64.1545  },
      { x: -338.9398, y: 95.2316,  z: -93.6662  },
      { x: -383.2214, y: 113.1321, z: -125.0123 },
    ],
  },
} );
const dist = ( a: V3, b: V3 ) => Math.hypot( a[0] - b[0], a[1] - b[1], a[2] - b[2] );

describe( "lifts", () => {
  it( "the placeholders have the lifts' pieces, a rope tow without masts", () => {
    expect( info( "chairlift" ).lift?.mast                             ).toBeTruthy();
    expect( info( "tbar"      ).lift?.mast                             ).toBeTruthy();
    expect( info( "ropetow"    ).lift && !info( "ropetow" ).lift!.mast ).toBe( true );
    expect( info( "floodlight" ).parameters.find( ( p ) => p.name === "light-color" ) ).toEqual( { name: "light-color", type: "color", default: "#FFFFFF" } );
  } );

  it( "puts the stations and masts along the line, each facing along it", () => {
    const o = joyosa(), p = liftPieces( o )!;
    expect( p.base.at ).toEqual( o.position );
    expect( dist( p.top.at, [o.position[0] - 427.8188, o.position[1] + 133.3238, o.position[2] - 254.4904] ) ).toBeLessThan( 1e-3 );
    expect( p.masts ).toHaveLength( 4 );
    // the base faces its first mast; the top faces back at the last
    const toFirst = Math.atan2( p.masts[0].at[0] - p.base.at[0], p.masts[0].at[2] - p.base.at[2] );
    expect( p.base.yaw ).toBeCloseTo( toFirst, 6 );
    expect( Math.abs( Math.abs( p.top.yaw - p.masts[3].yaw ) - Math.PI ) ).toBeLessThan( 0.4 );
  } );

  it( "a point in the lift's own space and back, turned and scaled", () => {
    const o     = { position: [10, 2, -5] as V3, rotation: [5, 70, -3] as V3, scale: [2, 1.5, 0.5] as V3 };
    const p: V3 = [3, 4, 50];
    const back  = liftLocal( o, liftPoint( o, p ) );
    expect( dist( back, p ) ).toBeLessThan( 1e-6 );
    // Unity's yaw: +90° turns forward ( +Z ) to the right ( +X )
    const w = liftPoint( { position: [0, 0, 0], rotation: [0, 90, 0], scale: [1, 1, 1] }, [0, 0, 1] );
    expect( dist( w, [1, 0, 0] ) ).toBeLessThan( 1e-9 );
  } );

  it( "runs the cable as a closed loop through every mast, sagging between them", () => {
    const o = joyosa(), lift = info( "chairlift" ).lift!, cable = liftCable( o, lift, 0.5 )!;
    expect( cable.length ).toBeGreaterThan( 200 );
    const p = liftPieces( o )!;
    // up and down past every mast's sheaves, near its top
    for ( const m of p.masts ) {
      const near = cable.filter( ( c ) => Math.hypot( c[0] - m.at[0], c[2] - m.at[2] ) < 6 );
      expect( near.length ).toBeGreaterThan( 1 );
      for ( const c of near ) expect( Math.abs( c[1] - ( m.at[1] + 13.5 ) ) ).toBeLessThan( 1.5 );
    }
    // the longest span ( the base to its first mast, ~117 m ) dips below the straight line between its ends
    const a      = p.base.at, b = p.masts[0].at, mid: V3 = [( a[0] + b[0] ) / 2, 0, ( a[2] + b[2] ) / 2];
    const middle = cable.reduce( ( best, c ) => ( Math.hypot( c[0] - mid[0], c[2] - mid[2] ) < Math.hypot( best[0] - mid[0], best[2] - mid[2] ) ? c : best ) );
    const chordY = ( a[1] + 3.79 + b[1] + 13.5 ) / 2;
    expect( chordY - middle[1] ).toBeGreaterThan( 1.5 );
    expect( chordY - middle[1] ).toBeLessThan( 4 );
  } );

  it( "a rope tow (no masts) still makes a loop between its stations", () => {
    const o: ObjectEntry = { uid: "r", id: "ropetow", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], params: {}, lift: { endPosition: { x: 0, y: 10, z: 80 }, masts: [] } };
    const cable          = liftCable( o, info( "ropetow" ).lift!, 0.5 )!;
    expect( cable.length                              ).toBeGreaterThan( 40 );
    expect( Math.max( ...cable.map( ( c ) => c[2] ) ) ).toBeGreaterThan( 79 );
  } );

  it( "places masts about every 40 m on the ground, and slots a new one in order", () => {
    const o      = joyosa();
    const masts  = autoMasts( o, ( x, z ) => 0.1 * x - 0.2 * z );
    const length = dist( o.position, liftPieces( o )!.top.at );
    expect( masts ).toHaveLength( Math.floor( length / 40 ) );
    for ( const m of masts ) {
      const w = liftPoint( o, m );
      expect( w[1] ).toBeCloseTo( 0.1 * w[0] - 0.2 * w[2], 4 );
    }
    expect( mastIndexFor( o, [-10,  0, -3  ] ) ).toBe( 0 );
    expect( mastIndexFor( o, [-300, 0, -80 ] ) ).toBe( 2 );
    expect( mastIndexFor( o, [-420, 0, -250] ) ).toBe( 4 );
  } );
} );
