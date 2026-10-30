import { describe, expect, it } from "vitest";
import type { ObjectEntry, SpawnEntry } from "../../src/core/types";
import { currentProject } from "../../src/map/project";
import { toHide, useEditor } from "../../src/map/store";

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
