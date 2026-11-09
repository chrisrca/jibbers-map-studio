import { toThree, type V3 } from "../../core/coords";
import { joinPath } from "../../core/ipc";
import { arr3 } from "../../core/types";
import { history } from "../../map/history";
import { newUid, useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/colliderbrush ): the Collider tool, as a person uses it, on a new map. A board
 * ( a box 4 m long, its top 1 m up ) put down; the Colliders tool picked from Object Mode's tool column; the board
 * clicked, then a stroke drawn along its top: boxes laid along it, their tops on its top; a click on one picks it ( the
 * gizmo on it ), X takes it out; Ctrl+stroke erases drawn ones; undo brings them back; the board's model changed ( its
 * size ): the drawn ones kept.
**/
export async function colliderBrushSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const { newEmptyProject } = await import( "../../map/project/sessions" );
    await newEmptyProject( joinPath( dir, `colliders-${Date.now()}.jbrproj` ), "Untitled" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the ground", 60000 );
    await sleep( 1000 );
    const st = () => useEditor.getState();
    const g  = terrain.heightAt( 0, 0 );
    // a board: a box 4 m long, 0.6 m wide, its top 1 m above the ground
    const { newModelObject } = await import( "../../model/objects" );
    const { primitive }      = await import( "../../model/mesh" );
    const { transformCustom, composeUnity } = await import( "../../core/transform" );
    const board = transformCustom( newModelObject( newUid(), primitive( "cube", { size: 1 } ), [0, 0, 0] ), composeUnity( [0, g + 0.5, 0], [0, 0, 0], [4, 1, 0.6] ) );
    st().addCustom( board, "Board" );
    const own   = () => st().customObjects.find( ( o ) => o.uid === board.uid )!;
    await sleep( 1500 );
    eng.nav.lookAtUnity( [-3, g + 4, -4], [0, g + 1, 0] );
    await sleep( 800 );
    const io  = realInput( eng, () => "colliders" );
    const scr = ( p: V3 ) => eng.screenOf( toThree( p ) ).slice( 0, 2 ) as [number, number];
    const before = own().colliders.length;
    // the tool, from the column
    const button = document.querySelector<HTMLButtonElement>( ".tool-column button[title='Colliders']" );
    check( !!button, "Object Mode's tool column has Colliders" );
    button?.click();
    await sleep( 300 );
    useEditor.setState( { colliderBrush: { radius: 0.1, shape: "Box", surface: null } } );
    // the board clicked: picked
    await io.click( ...scr( [0, g + 1, 0] ) );
    await sleep( 300 );
    check( st().tool === "collider" && st().selection[0]?.uid === board.uid, `the board clicked with the tool: ${st().tool}, ${st().selection.map( ( s ) => s.uid === board.uid ? "the board" : s.kind ).join( "," ) || "nothing"} picked` );
    // a stroke along its top
    await io.drag( ...scr( [-1.6, g + 1, 0] ), ...scr( [1.6, g + 1, 0] ), 900 );
    await sleep( 400 );
    const { isBrushCollider } = await import( "../../pieces/brushColliders" );
    const drawn = () => own().colliders.filter( isBrushCollider );
    const d1    = drawn();
    const tops  = d1.map( ( c ) => c.local_position.y + c.size.z / 2 - ( g + 1 ) );
    check( d1.length >= 6 && tops.every( ( t ) => Math.abs( t ) < 0.03 ) && d1.every( ( c ) => Math.abs( c.local_position.z ) < 0.1 ), `a stroke along its top: ${d1.length} boxes (the board's own ${before}); their tops ${tops.map( ( t ) => t.toFixed( 3 ) ).join( " " )} m off its top` );
    const span = Math.max( ...d1.map( ( c ) => c.local_position.x ) ) - Math.min( ...d1.map( ( c ) => c.local_position.x ) );
    check( span > 2.4, `laid the length of the stroke: ${span.toFixed( 2 )} m from first to last` );
    // a click on one: picked, the gizmo on it; X takes it out
    const one = d1[Math.floor( d1.length / 2 )];
    await io.click( ...scr( arr3( one.local_position ).map( ( v, k ) => ( k === 1 ? v + one.size.z / 2 : v ) ) as V3 ) );
    await sleep( 300 );
    const pickedIs = st().colliderPick !== null ? own().colliders[st().colliderPick!] : null;
    check( !!pickedIs && isBrushCollider( pickedIs ) && eng.blGizmo.attached && drawn().length === d1.length, `a click on a drawn collider picks it (none drawn): picked ${st().colliderPick}, the gizmo on it ${eng.blGizmo.attached}` );
    await io.key( "x" );
    await sleep( 300 );
    check( drawn().length === d1.length - 1 && st().colliderPick === null, `X takes it out: ${drawn().length} left` );
    // Ctrl+stroke over half of it: those erased, the board's own kept
    await io.drag( ...scr( [-1.6, g + 1, 0] ), ...scr( [0, g + 1, 0] ), 700, 0, { ctrlKey: true } );
    await sleep( 400 );
    const left = drawn().length;
    check( left > 0 && left < d1.length - 1 && own().colliders.length - left === before, `Ctrl+stroke erases drawn ones: ${left} left, the board's own ${own().colliders.length - left}` );
    // undo: back
    history.undo();
    await sleep( 300 );
    check( drawn().length === d1.length - 1, `undo brings them back: ${drawn().length}` );
    // the board's model changed: drawn ones kept
    const { withModel } = await import( "../../model/objects" );
    const o = own();
    st().commit( "Bevel", { customObjects: st().customObjects.map( ( x ) => ( x.uid === o.uid && o.model ? withModel( x, { ...o.model } ) : x ) ) } );
    await sleep( 300 );
    check( drawn().length === d1.length - 1, `its model made again: the drawn ones kept (${drawn().length})` );
    log( "SNAP colliders" );
    await sleep( 1200 );
    io.stop();
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
