import { toThree, type V3 } from "../../core/coords";
import { joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";
import { edgesOf, faceCenter, type Mesh } from "../../model/mesh";
import { selFromEdges, selFromFaces, selFromVerts } from "../../model/ops";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";
import reference from "../../../tests/model/blender/reference.json";

type Where = [string, ">" | "<", number][];

/**
 * Focused run ( STUDIO_SELFTEST=<...>/blendertools ): Edit Mode's tools driven with the keys and mouse, each against
 * what Blender made of the same ( tests/model/blender/reference.json ) where it makes a mesh: Knife across the top
 * ( Esc leaving it ), Spin with its axis, steps and angle typed, Bevel's segments on the wheel, Inset twice for each
 * face its own, Extrude on an edge held to an axis, Alt+S Shrink/Fatten typed, Merge at First and at Last, the
 * toolbar's Smooth, and Adjust Last Operation's fields remaking what Shift+A added.
**/
export async function blenderToolsSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const P = await import( "../../map/project" );
    await P.newEmptyProject( joinPath( dir, `tools-${Date.now()}.jbrproj` ), "Blender Tools" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await sleep( 1000 );
    const st = () => useEditor.getState();
    [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === "Assets" )?.click();
    await sleep( 1200 );
    const io    = realInput( eng, () => "tools" );
    const frame = () => new Promise<void>( ( r ) => requestAnimationFrame( () => r() ) );
    const key   = async ( k: string, m: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {} ) => {
      const init = { key: k, code: k.length === 1 ? ( /[0-9]/.test( k ) ? `Digit${k}` : `Key${k.toUpperCase()}` ) : k, ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: !!m.alt, bubbles: true, cancelable: true };
      window.dispatchEvent( new KeyboardEvent( "keydown", init ) );
      window.dispatchEvent( new KeyboardEvent( "keyup", init ) );
      await frame();
      await sleep( 50 );
    };
    const type = async ( s: string ) => { for ( const ch of s ) await key( ch ); };
    const menu = async ( label: string ) => {
      await sleep( 200 );
      const it = [...document.querySelectorAll<HTMLElement>( ".bmenu .bmenu-item" )].find( ( x ) => x.textContent?.trim().startsWith( label ) );
      it?.click();
      await sleep( 300 );
      return !!it;
    };
    const W = io.rc.width, H = io.rc.height;
    await io.glide( W / 2, H / 2, 200 );
    const scr   = ( p: V3 ) => eng.screenOf( toThree( p ) ).slice( 0, 2 ) as [number, number];
    const holds = ( p: V3, where: Where ) => where.every( ( [a, op, v] ) => ( op === ">" ? p["xyz".indexOf( a )] > v : p["xyz".indexOf( a )] < v ) );
    const mid   = ( g: Mesh, k: string ) => {
      const [a, b] = k.split( "_" ).map( Number );
      return g.v[a].map( ( x, i ) => ( x + g.v[b][i] ) / 2 ) as V3;
    };
    const REF = ( reference as unknown as { cases: Record<string, { v: V3[]; f: number[][] }> } ).cases;
    const off = ( a: V3[], b: V3[] ) => Math.max( 0, ...a.map( ( p ) => Math.min( ...b.map( ( q ) => Math.hypot( p[0] - q[0], p[1] - q[1], p[2] - q[2] ) ) ) ) );
    let uid  = "";
    const g  = () => st().customObjects.find( ( o ) => o.uid === uid )!.model!.mesh;
    const ed = eng.modelEd;
    // ( against Blender's own: the same counts, the same points )
    const like = ( name: string, what: string ) => {
      const ref = REF[name], m = g(), a = off( ref.v, m.v ), b = off( m.v, ref.v );
      check( m.v.length === ref.v.length && m.f.length === ref.f.length && a < 1e-3 && b < 1e-3, `${what}: ${m.v.length} vertices, ${m.f.length} faces ( Blender ${ref.v.length}, ${ref.f.length} ), points off by ${Math.max( a, b ).toFixed( 4 )} m` );
    };
    // a fresh primitive in Edit Mode, its selection as given ( selecting itself is blenderselect's )
    const fresh = async ( label: string, kind?: "verts" | "edges" | "faces", where: Where = [] ) => {
      if ( eng.editing ) await key( "Tab" );
      useEditor.setState( { cursor3d: [0, 0, 0] } );
      if ( st().customObjects.length ) {
        st().setSelection( st().customObjects.map( ( o ) => ( { kind: "custom" as const, uid: o.uid } ) ) );
        await key( "Delete" );
      }
      await key( "A", { shift: true } );
      await menu( label );
      await sleep( 300 );
      uid = st().selection[0]?.uid ?? "";
      await key( "Tab" );
      if ( !kind ) return;
      const m = g();
      ed.mode = kind === "verts" ? "vert" : kind === "edges" ? "edge" : "face";
      ed.sel  = kind === "verts" ? selFromVerts( m, m.v.flatMap( ( p, i ) => ( holds( p, where ) ? [i] : [] ) ) ) : kind === "edges" ? selFromEdges( m, [...edgesOf( m ).keys()].filter( ( k ) => holds( mid( m, k ), where ) ) ) : selFromFaces( m, m.f.flatMap( ( _, i ) => ( holds( faceCenter( m, i ), where ) ? [i] : [] ) ) );
      ed.sync();
      ed.publish();
    };

    // ---------------------------------------------------------------- Knife: two clicks across the top, Enter
    await fresh( "Cube", "faces", [["y", ">", 0.99]] );
    eng.nav.lookAtUnity( [2.6, 4.2, -3.4], [0, 0.5, 0] );
    await sleep( 600 );
    await key( "k" );
    await io.click( ...scr( [0, 1, -1] ) ); await sleep( 120 );
    await key( "Escape" );
    check( g().v.length === 8 && !ed.modal, `K, a click, Esc: nothing cut ( ${g().v.length} vertices )` );
    await key( "k" );
    await io.click( ...scr( [0, 1, -1] ) ); await sleep( 120 );
    await io.click( ...scr( [0, 1, 1] ) ); await sleep( 120 );
    await key( "Enter" );
    await sleep( 200 );
    check( g().v.length === 10 && g().f.length === 7, `K across the top, Enter: ${g().v.length} vertices, ${g().f.length} faces ( Blender: 10, 7 )` );

    // ---------------------------------------------------------------- Spin: the axis, the steps, the angle
    await fresh( "Plane", "edges", [["x", ">", 0.99]] );
    eng.nav.lookAtUnity( [2.5, 3, -4], [0, 0, 0] );
    await sleep( 500 );
    ed.arm( "spin" );
    await io.glide( W / 2 + 60, H / 2 + 20, 150 );
    await key( "y" );
    for ( let k = 0; k < 8; k++ ) await key( "-" );
    await type( "90" ); await key( "Enter" );
    like( "spin a plane's edge a quarter", "Spin, Y, 8 steps fewer ( 4 ), 90 typed" );

    // ---------------------------------------------------------------- Bevel: a width typed, the wheel for segments
    await fresh( "Cube", "edges", [["y", ">", 0.99], ["x", ">", 0.99]] );
    await io.glide( W / 2 + 40, H / 2, 150 );
    await key( "b", { ctrl: true } ); await type( "0.2" );
    await io.wheel( -100, 2 );
    await key( "Enter" );
    like( "bevel one edge 3 segments", "Ctrl+B 0.2, the wheel up twice ( 3 segments )" );
    // a vertex: Shift+Ctrl+B
    await fresh( "Cube", "verts", [["x", ">", 0.99], ["y", ">", 0.99], ["z", ">", 0.99]] );
    await key( "B", { ctrl: true, shift: true } ); await type( "0.3" ); await key( "Enter" );
    like( "bevel a vertex", "Shift+Ctrl+B 0.3 on a corner" );

    // ---------------------------------------------------------------- Inset: I again for each face its own
    await fresh( "Cube", "faces", [["y", ">", 0.99]] );
    ed.sel = selFromFaces( g(), [...ed.sel.f, ...g().f.flatMap( ( _, i ) => ( faceCenter( g(), i )[0] > 0.99 ? [i] : [] ) )] );
    ed.sync();
    await key( "i" ); await key( "i" ); await type( "0.2" ); await key( "Enter" );
    like( "inset two faces each", "I, I ( each its own ), 0.2" );
    await key( "z", { ctrl: true } );
    await key( "i" ); await type( "0.2" ); await key( "Enter" );
    like( "inset two faces as a region", "I 0.2 on the two as one" );

    // ---------------------------------------------------------------- Extrude an edge along X
    await fresh( "Plane", "edges", [["x", ">", 0.99]] );
    await key( "e" ); await key( "x" ); await type( "1" ); await key( "Enter" );
    like( "extrude a plane's edge", "E on an edge, X, 1" );

    // ---------------------------------------------------------------- Alt+S, typed
    await fresh( "Cube", "verts", [] );
    await key( "s", { alt: true } ); await type( "0.1" ); await key( "Enter" );
    like( "shrink fatten every vertex", "Alt+S 0.1 on every vertex" );

    // ---------------------------------------------------------------- Merge at First / at Last: the order picked in
    await fresh( "Cube", "verts", [] );
    eng.nav.lookAtUnity( [3.2, 3.4, -4.2], [0, 0, 0] );
    await sleep( 500 );
    await key( "a", { alt: true } );
    const A: V3 = [1, 1, -1], B: V3 = [-1, 1, -1];
    await io.click( ...scr( A ) ); await sleep( 120 );
    await io.click( ...scr( B ), 300, { shiftKey: true } ); await sleep( 120 );
    await key( "m" ); await menu( "At First" );
    const first = g().v.length === 7 && g().v.some( ( p ) => p.every( ( x, i ) => Math.abs( x - A[i] ) < 1e-6 ) ) && !g().v.some( ( p ) => p.every( ( x, i ) => Math.abs( x - B[i] ) < 1e-6 ) );
    await key( "z", { ctrl: true } );
    await key( "m" ); await menu( "At Last" );
    const last = g().v.length === 7 && g().v.some( ( p ) => p.every( ( x, i ) => Math.abs( x - B[i] ) < 1e-6 ) ) && !g().v.some( ( p ) => p.every( ( x, i ) => Math.abs( x - A[i] ) < 1e-6 ) );
    check( first && last, `M › At First: at the one picked first ( ${first} ); At Last: at the one picked last ( ${last} )` );

    // ---------------------------------------------------------------- the toolbar's Smooth: a drag on the selection
    await key( "z", { ctrl: true } );
    await key( "a" );
    const was = g().v.map( ( p ) => [...p] );
    document.querySelector<HTMLButtonElement>( '.tool-column button[title^="Smooth"]' )?.click();
    await sleep( 200 );
    const at = scr( [1, 1, -1] );
    await io.drag( at[0], at[1], at[0] + 120, at[1], 400 );
    const moved = g().v.some( ( p, i ) => Math.hypot( p[0] - was[i][0], p[1] - was[i][1], p[2] - was[i][2] ) > 0.01 );
    const tool  = st().modelTool;
    useEditor.setState( { modelTool: "select" } );
    check( tool === "smooth" && moved, `the toolbar's Smooth ( ${tool} ), dragged on the selection: the corners eased in ( ${moved} )` );

    // ---------------------------------------------------------------- Adjust Last Operation: Vertices 8
    if ( eng.editing ) await key( "Tab" );
    st().setSelection( st().customObjects.map( ( o ) => ( { kind: "custom" as const, uid: o.uid } ) ) );
    await key( "Delete" );
    await key( "A", { shift: true } );
    await menu( "Cylinder" );
    await sleep( 400 );
    uid = st().selection[0]?.uid ?? "";
    // ( a click on the number, as in Blender, makes it a field to type in )
    const num = document.querySelector<HTMLElement>( ".adjust-last .props .num" );
    if ( num ) {
      const r = num.getBoundingClientRect(), at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 41, bubbles: true };
      num.dispatchEvent( new PointerEvent( "pointerdown", { ...at, buttons: 1 } ) );
      window.dispatchEvent( new PointerEvent( "pointerup", { ...at, buttons: 0 } ) );
      await sleep( 200 );
    }
    const field = document.querySelector<HTMLInputElement>( ".adjust-last .props input" );
    if ( field ) {
      field.focus();
      Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, "value" )!.set!.call( field, "8" );
      field.dispatchEvent( new Event( "input", { bubbles: true } ) );
      field.dispatchEvent( new KeyboardEvent( "keydown", { key: "Enter", bubbles: true } ) );
      field.blur();
    }
    await sleep( 400 );
    uid = st().lastAdd?.uid ?? uid;
    check( !!field && g().v.length === 16 && g().f.length === 10, `Adjust Last Operation › Vertices 8: the cylinder made again, ${g().v.length} vertices, ${g().f.length} faces ( Blender: 16, 10 )` );
    io.stop();
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
