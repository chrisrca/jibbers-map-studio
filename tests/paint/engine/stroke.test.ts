import { describe, expect, it } from "vitest";
import { mergeBrush, PAINT_PRESETS } from "../../../src/paint/engine/brush";
import { EngineStroke, type StrokeOptions, type TileStore } from "../../../src/paint/engine/stroke";

/**
 * One 256 px image as the store.
**/
function image() {
  const n                = 256, px = new Uint8Array( n * n * 4 );
  const store: TileStore = { size: n, get: ( tx, ty ) => ( tx === 0 && ty === 0 ? px : null ), make: () => px, changed: () => {} };
  return { px, store, at: ( x: number, y: number ) => Array.from( px.subarray( ( y * n + x ) * 4, ( y * n + x ) * 4 + 4 ) ) };
}
const opts = ( o: Partial<StrokeOptions> ): StrokeOptions => ( {
  kind: "paint", brush: mergeBrush( { airbrush: 0 } ), radius: 8, hardness: 1, strength: 1, mode: "mix", colour: [1, 0, 0], colour2: [1, 1, 1], patternPx: 32, base: [1, 1, 1], ...o,
} );
function draw( store: TileStore, o: Partial<StrokeOptions>, pts: [number, number][] ) {
  const s = new EngineStroke( store, opts( o ) );
  for ( const [x, y] of pts ) s.move( { x, y, pressure: 1 } );
  s.end();
}

describe( "paint engine", () => {
  it( "smudges colour along the stroke and clones from the source", () => {
    const { store, at } = image();
    draw( store, { radius: 6 }, [[60, 60]] );
    expect( at( 80, 60 )[3] ).toBe( 0 );
    draw( store, { kind: "smudge", strength: 0.9, hardness: 0.8, radius: 6 }, [[60, 60], [66, 60], [72, 60], [78, 60]] );
    const smeared = at( 72, 60 );
    expect( smeared[3] ).toBeGreaterThan( 40         );
    expect( smeared[0] ).toBeGreaterThan( smeared[2] );
    draw( store, { kind: "clone", radius: 5, cloneOffset: [-100, 0] }, [[160, 60]] );
    expect( at( 160, 60 ) ).toEqual( at( 60, 60 ) );
  } );

  it( "scatters dabs off the stroke and paints every preset", () => {
    const { store, at } = image();
    draw( store, { colour: [0, 0, 0], radius: 2, brush: mergeBrush( { scatter: 3, scatterBothAxes: true, spacing: 0.5, airbrush: 0 } ) }, [[20, 20], [100, 20]] );
    let off = 0;
    for ( let y = 26; y < 34; y++ ) for ( let x = 20; x < 100; x += 4 ) if ( at( x, y )[3] ) off++;
    expect( off ).toBeGreaterThan( 0 );
    for ( const p of PAINT_PRESETS ) {
      const { store: s2, at: at2 } = image();
      draw( s2, { colour: [0, 0, 1], strength: p.strength, hardness: p.hardness, radius: 10, brush: mergeBrush( { ...p.brush, airbrush: 0 } ) }, [[60, 128], [180, 140]] );
      let painted = 0;
      for ( let x = 50; x < 190; x += 2 ) for ( let y = 110; y < 160; y += 2 ) if ( at2( x, y )[3] ) painted++;
      expect( painted, p.name ).toBeGreaterThan( 20 );
    }
  } );
} );

describe( "a paced paint stroke ( a frame's share at a time )", () => {
  // a cover of its own ( as Texture Paint's ), stopping after every few pixels
  const steps = function* ( d: { x: number; y: number }, reach: number, at: ( dx: number, dy: number, gx: number, gy: number ) => number, f: ( gx: number, gy: number, cov: number ) => void ) {
    let n = 0;
    for ( let gy = Math.floor( d.y - reach ); gy <= Math.ceil( d.y + reach ); gy++ )
      for ( let gx = Math.floor( d.x - reach ); gx <= Math.ceil( d.x + reach ); gx++ ) {
        const cov = at( gx + 0.5 - d.x, gy + 0.5 - d.y, gx, gy );
        if ( cov ) f( gx, gy, cov );
        if ( ++n % 7 === 0 ) yield;
      }
  };
  const run = ( paced: boolean, o: Partial<StrokeOptions> ) => {
    const { px, store } = image();
    const s             = new EngineStroke( store, opts( { coverSteps: steps, seed: 42, ...o } ) );
    s.paced             = paced;
    let pauses          = 0;
    for ( const [x, y] of [[30, 40], [70, 52], [110, 48], [150, 90], [190, 60]] ) {
      s.move( { x, y, pressure: 0.8 } );
      while ( paced && s.work( 0 ) ) pauses++;
    }
    s.end();
    while ( paced && s.work( 0 ) ) pauses++;
    return { px, pauses };
  };

  it( "paints the same pixels as all at once, however often it's paused ( dabs that follow the stroke too )", () => {
    for ( const o of [{}, { mode: "multiply" as const, colour: [0.2, 0.6, 0.9] as [number, number, number] }, { brush: mergeBrush( { airbrush: 0, followStroke: true, scatter: 1, angleJitter: 0.5 } ) }] ) {
      const once = run( false, o ), paced = run( true, o );
      expect( paced.pauses ).toBeGreaterThan( 50 );
      expect( paced.px ).toEqual( once.px );
    }
  } );
} );
