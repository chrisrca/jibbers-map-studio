import { describe, expect, it } from "vitest";
import { history } from "../../../src/map/history";
import { useEditor } from "../../../src/map/store";
import { primitive } from "../../../src/model/mesh";
import { stillLast } from "../../../src/ui/blender/AdjustLast";
import type { Engine } from "../../../src/viewport/engine/engine";
import { ViewportMenus } from "../../../src/viewport/engine/menus";

describe( "Add › Mesh, adjusted after ( Blender's Adjust Last Operation )", () => {
  const menus = () => new ViewportMenus( { modelEd: { uid: null } } as unknown as Engine );
  const piece = () => useEditor.getState().customObjects.find( ( o ) => o.uid === "s1" )!;

  it( "a UV sphere's segments and rings changed: the same piece made again, one undo step", () => {
    history.clear();
    useEditor.setState( { customObjects: [], selection: [], lastAdd: null } );
    const m = menus();
    m.addPrimitive( { uid: "s1", id: "uvsphere", opts: {}, at: [0, 1, 0], rot: [0, 0, 0], into: false } );
    expect( piece().model!.mesh.v.length      ).toBe( 32 * 15 + 2 );
    expect( stillLast( useEditor.getState() ) ).toBe( true );
    m.redoAdd( { ...useEditor.getState().lastAdd!, opts: { segments: 8, rings: 4 } } );
    expect( piece().model!.mesh.v.length             ).toBe( 8 * 3 + 2 );
    expect( useEditor.getState().customObjects.length ).toBe( 1 );
    expect( history.list().labels                     ).toEqual( ["Add UV Sphere"] );
    // moved since: no longer the last thing done
    useEditor.setState( ( s ) => ( { customObjects: s.customObjects.map( ( o ) => ( { ...o, position: { x: 5, y: 1, z: 0 } } ) ) } ) );
    expect( stillLast( useEditor.getState() ) ).toBe( false );
    history.undo();
    expect( useEditor.getState().customObjects.length ).toBe( 0 );
  } );

  it( "a cylinder's vertices and depth, a torus' minor segments, an ico sphere's subdivisions", () => {
    const cyl = primitive( "cylinder", { segments: 6, depth: 4 } );
    expect( cyl.v.length                                             ).toBe( 12 );
    expect( Math.max( ...cyl.v.map( ( p ) => p[1] ) )                ).toBeCloseTo( 2, 9 );
    expect( primitive( "torus", { segments: 8, minor: 4 } ).f.length ).toBe( 32 );
    expect( primitive( "icosphere", { rings: 1 } ).f.length          ).toBe( 20 );
    expect( primitive( "icosphere", { rings: 3 } ).f.length          ).toBe( 320 );
  } );

  it( "turned as the panel says", () => {
    history.clear();
    useEditor.setState( { customObjects: [], selection: [], lastAdd: null } );
    menus().addPrimitive( { uid: "s1", id: "cylinder", opts: {}, at: [0, 0, 0], rot: [90, 0, 0], into: false } );
    expect( piece().rotation.x ).toBeCloseTo( 90, 6 );
  } );
} );
