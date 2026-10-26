import { describe, expect, it } from "vitest";
import { useEditor } from "../../src/map/store";

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
