import { describe, expect, it } from "vitest";
import type { ObjectEntry, SpawnEntry } from "../../src/core/types";
import { currentProject } from "../../src/map/project";
import { toHide, useEditor } from "../../src/map/store";
import { history } from "../../src/map/history";
import { doOp, redoOp, stillLastOp, useLastOp } from "../../src/app/lastOp";

describe( "hiding in the view", () => {
  const obj   = ( uid: string ) => ( { uid, id: "box", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], params: {} } ) as ObjectEntry;
  const spawn = ( uid: string ) => ( { uid, name: uid, position: [0, 0, 0], rotation: [0, 0, 0], velocity: [0, 0, 0] } ) as SpawnEntry;
  const st    = () => useEditor.getState();

  it( "hides the selection ( H ), everything else ( Shift+H ), and shows it all again ( Alt+H )", () => {
    useEditor.setState( { objects: [obj( "a" ), obj( "b" )], spawns: [spawn( "s" )], customObjects: [], hiddenInView: {}, selection: [{ kind: "object", uid: "a" }] } );
    expect( toHide( st()       ) ).toEqual( ["a"]      );
    expect( toHide( st(), true ) ).toEqual( ["b", "s"] );
    st().setHidden( toHide( st() ), true );
    expect( st().hiddenInView ).toEqual( { a: true } );
    // ( what's hidden is let go of )
    expect( st().selection    ).toEqual( [] );
    st().setSelection( [{ kind: "spawn", uid: "s" }] );
    st().setHidden( toHide( st(), true ), true );
    expect( Object.keys( st().hiddenInView ).sort() ).toEqual( ["a", "b"] );
    expect( st().selection                          ).toEqual( [{ kind: "spawn", uid: "s" }] );
    st().setHidden( Object.keys( st().hiddenInView ), false );
    expect( st().hiddenInView ).toEqual( {} );
  } );

  it( "is kept with the map, and doesn't take anything out of it", () => {
    useEditor.setState( {
      map:           { id: "m", name: "M", camStart: [0, 0, 0], allowBackgroundMountains: true, overrideTime: false, dayTime: 1, dayTimeHours: -1, sunAngle: 0 },
      objects:       [obj( "a" ), obj( "b" )],
      spawns:        [spawn( "s" )],
      customObjects: [],
      shapes:        [],
      hiddenInView:  { a: true, gone: true },
    } );
    const p = currentProject()!;
    expect( p.objects.map( ( o ) => o.uid )               ).toEqual( ["a", "b"] );
    expect( ( p.editor as { hidden?: string[] } ).hidden ).toEqual( ["a"]      );
  } );
} );

describe( "workspaces", () => {
  it( "start with nothing selected; tools within one keep the selection", () => {
    const st   = () => useEditor.getState();
    const pick = [{ kind: "shape" as const, uid: "s1" }];
    st().setTool( "select" );
    st().setSelection( pick );
    st().setTool( "place" );
    expect( st().selection ).toEqual( pick );
    st().setTool( "sculpt" );
    expect( st().selection ).toEqual( [] );
    st().setSelection( pick );
    useEditor.setState( { tool: "shape", shapeKind: "curve" } );
    expect( st().selection ).toEqual( pick );
    st().setTool( "paint" );
    expect( st().selection ).toEqual( [] );
    st().setSelection( pick );
    st().setTool( "select" );
    expect( st().selection ).toEqual( [] );
  } );
} );

describe( "duplicate array", () => {
  const obj = ( uid: string ) => ( { uid, id: "box", position: [1, 2, 3], rotation: [0, 10, 0], scale: [1, 1, 1], params: {} } ) as ObjectEntry;
  const st  = () => useEditor.getState();

  it( "copies in a row, each a step on in place, turn and size; one undo step; the last copy selected", () => {
    history.clear();
    useEditor.setState( { objects: [obj( "a" )], spawns: [], customObjects: [], selection: [{ kind: "object", uid: "a" }] } );
    const made = st().duplicateArray( 3, [2, 0, -1], 15, 2 );
    expect( made.length                  ).toBe( 3 );
    const copies = made.map( ( uid ) => st().objects.find( ( o ) => o.uid === uid )! );
    expect( copies.map( ( c ) => c.position ) ).toEqual( [[3, 2, 2], [5, 2, 1], [7, 2, 0]] );
    expect( copies.map( ( c ) => c.rotation[1] ) ).toEqual( [25, 40, 55] );
    expect( copies.map( ( c ) => c.scale[0] ) ).toEqual( [2, 4, 8] );
    expect( st().selection ).toEqual( [{ kind: "object", uid: made[2] }] );
    history.undo();
    expect( st().objects.map( ( o ) => o.uid ) ).toEqual( ["a"] );
  } );

  it( "adjusted after: done again with the new setting, what it did first taken back", () => {
    history.clear();
    useEditor.setState( { objects: [obj( "a" )], spawns: [], customObjects: [], selection: [{ kind: "object", uid: "a" }] } );
    doOp( "Duplicate Array", [], { count: 2 }, ( v ) => st().duplicateArray( v.count, [1, 0, 0] ) );
    expect( st().objects.length ).toBe( 3 );
    redoOp( "count", 5 );
    expect( st().objects.length ).toBe( 6 );
    expect( stillLastOp( useLastOp.getState().op ) ).toBe( true );
    // ( anything else done: no longer adjustable )
    st().duplicateSelected();
    expect( stillLastOp( useLastOp.getState().op ) ).toBe( false );
    redoOp( "count", 1 );
    expect( st().objects.length ).toBe( 7 );
  } );
} );
