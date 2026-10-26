import { describe, expect, it } from "vitest";
import { history } from "../../src/map/history";

describe( "undo history", () => {
  it( "undoes, redoes, and drops the oldest steps over the memory budget", () => {
    history.clear();
    let v      = 0;
    const step = ( to: number, bytes = 0 ) => {
      const from = v;
      v          = to;
      history.push( { label: `set ${to}`, undo: () => ( v = from ), redo: () => ( v = to ), bytes } );
    };
    step( 1 ); step( 2 ); step( 3 );
    history.undo();
    history.undo();
    expect( v              ).toBe( 1 );
    expect( history.list() ).toEqual( { labels: ["set 1", "set 2", "set 3"], current: 1 } );
    history.redo();
    history.redo();
    expect( v ).toBe( 3 );
    const budget   = history.budget;
    history.budget = 100;
    step( 4, 60 ); step( 5, 60 );
    expect( history.list().labels ).toEqual( ["set 5"] );
    history.budget = budget;
    history.clear();
  } );
} );
