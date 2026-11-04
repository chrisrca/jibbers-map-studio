import { describe, expect, it } from "vitest";
import type { V3 } from "../../src/core/coords";
import { capture, cyclesPerSecond, moved, newMovingPart, type MovingPart } from "../../src/pieces/motion";

// two loose quads side by side along X: a "post" at x = −1..1, a "wheel" at x = 2..4 ( as motion.rs's test )
const post: V3[]  = [[-1, 0, 0], [1, 0, 0], [1, 1, 0], [-1, 1, 0]];
const wheel: V3[] = [[2, 0, 0], [4, 0, 0], [4, 2, 0], [2, 2, 0]];
const shells      = { points: [...post, ...wheel], tris: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7] };

describe( "moving parts: what moves", () => {
  it( "a region takes the loose part whose middle is in it, the rest stays still", () => {
    const m: MovingPart    = { ...newMovingPart(), kind: "spin", axis: "z", region: { shape: "sphere", center: [3, 1, 0], size: [0.5, 0, 0] } };
    const { part, pivots } = capture( [m], [shells] );
    expect( Array.from( part[0] ) ).toEqual( [-1, -1, -1, -1, 0, 0, 0, 0] );
    expect( pivots[0] ).toEqual( [3, 1, 0] );
  } );

  it( "vertices: just those inside; excluded ones taken out; the pivot at the bottom of what's taken", () => {
    const m: MovingPart    = { ...newMovingPart(), kind: "bob", axis: "y", capture: "vertices", region: { shape: "box", center: [0, 1, 0], size: [10, 0.5, 1] }, exclude: [{ shape: "sphere", center: [4, 0, 0], size: [3, 0, 0] }], pivot: "bottom" };
    const { part, pivots } = capture( [m], [{ points: [[-1, 1, 0], [1, 1, 0], [1, 0, 0], [3, 1, 0]], tris: [0, 1, 2] }] );
    expect( Array.from( part[0] ) ).toEqual( [0, 0, -1, -1] );
    expect( pivots[0] ).toEqual( [0, 1, 0] );
  } );

  it( "a mesh split along its seams is still one loose part ( vertices at one place joined )", () => {
    // ( two triangles sharing an edge by position only, no index in common )
    const m: MovingPart = { ...newMovingPart(), region: { shape: "sphere", center: [0.5, 0.5, 0], size: [0.1, 0, 0] } };
    const { part }      = capture( [m], [{ points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], tris: [0, 1, 2, 3, 4, 5] }] );
    expect( Array.from( part[0] ) ).toEqual( [0, 0, 0, 0, 0, 0] );
  } );

  it( "no region: the whole piece", () => {
    const { part } = capture( [newMovingPart()], [shells] );
    expect( Array.from( part[0] ).every( ( k ) => k === 0 ) ).toBe( true );
  } );
} );

describe( "moving parts: how they move", () => {
  it( "a spin turns as many times a second as asked ( a quarter turn in half a second at half a turn a second )", () => {
    const m = { ...newMovingPart(), kind: "spin" as const, axis: "y" as const, speed: 0.5 };
    expect( cyclesPerSecond( m ) ).toBe( 0.5 );
    const p = moved( m, [0, 0, 0], 0.5, [1, 0, 0] );
    expect( p[0] ).toBeCloseTo( 0, 5 );
    expect( Math.abs( p[2] ) ).toBeCloseTo( 1, 5 );
  } );

  it( "a bob goes its distance either side, back where it started each period", () => {
    const m = { ...newMovingPart(), kind: "bob" as const, axis: "y" as const, distance: 1, period: 4, phase: 0 };
    expect( moved( m, [0, 0, 0], 0, [0, 0, 0] )[1] ).toBeCloseTo( 0, 5 );
    expect( moved( m, [0, 0, 0], 1, [0, 0, 0] )[1] ).toBeCloseTo( 1, 1 );
    expect( moved( m, [0, 0, 0], 3, [0, 0, 0] )[1] ).toBeCloseTo( -1, 1 );
    expect( moved( m, [0, 0, 0], 4, [0, 0, 0] )[1] ).toBeCloseTo( 0, 5 );
  } );

  it( "a swing turns its angle either side of where it hangs", () => {
    const m = { ...newMovingPart(), kind: "swing" as const, axis: "z" as const, angle: 30, period: 4, phase: 0 };
    // ( hanging 1 m below the pivot; a quarter period on, swung 30° )
    const p = moved( m, [0, 0, 0], 1, [0, -1, 0] );
    expect( Math.atan2( Math.abs( p[0] ), -p[1] ) * 180 / Math.PI ).toBeCloseTo( 30, 0 );
  } );
} );
