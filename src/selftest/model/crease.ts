import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/crease ): Edge Crease as a person uses it, in the Assets workspace: a cube added,
 * Subdivision Surface put on it, Edit Mode, every edge selected, Shift+E with the mouse pulled out ( and once with a
 * typed 1 ), kept: the subdivided cube stays a box.
**/
export async function creaseSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const { newEmptyProject } = await import( "../../map/project/sessions" );
    const { joinPath }        = await import( "../../core/ipc" );
    await newEmptyProject( joinPath( dir, `crease-${Date.now()}.jbrproj` ), "Untitled" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await sleep( 1500 );
    const st  = () => useEditor.getState();
    const tab = ( name: string ) => [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === name )?.click();
    tab( "Assets" );
    await sleep( 1200 );
    const r = eng.renderer.domElement.getBoundingClientRect();
    eng.menus.addMenu( new DOMRect( r.left + 40, r.top + 40, 30, 20 ) );
    await sleep( 300 );
    [...document.querySelectorAll<HTMLElement>( ".bmenu-item" )].find( ( x ) => x.textContent?.trim() === "Cube" )?.click();
    await sleep( 1000 );
    const cube = st().customObjects[0];
    check( !!cube?.model, `a cube added: ${cube?.model ? "modelled" : "not modelled"}` );
    st().setSelection( [{ kind: "custom", uid: cube.uid }] );
    const { MODIFIERS, evaluate } = await import( "../../model/build" );
    const { withModel }           = await import( "../../model/objects" );
    st().updateCustom( "Add modifier", [cube.uid], ( x ) => withModel( x, { ...x.model!, modifiers: [MODIFIERS[4].make()] } ) );
    await sleep( 500 );
    const piece  = () => st().customObjects.find( ( o ) => o.uid === cube.uid )!;
    const corner = () => Math.max( ...evaluate( piece().model! ).v.map( ( p ) => Math.hypot( ...p ) ) );
    log( `subdivided: corner ${corner().toFixed( 3 )} from the middle ( a box's ${Math.sqrt( 3 ).toFixed( 3 )} )` );
    const io = realInput( eng, () => "crease" );
    await io.glide( r.width / 2, r.height / 2, 200 );
    await io.key( "Tab" );
    await sleep( 300 );
    await io.key( "2" );
    await io.key( "a" );
    await sleep( 200 );
    log( `edit mode ${st().modelEdit ? "on" : "off"}, ${st().modelEdit?.edges} edges selected, mode ${st().modelEdit?.mode}` );
    // Shift+E, the mouse pulled out, a click
    await io.key( "E", { shift: true } );
    log( `modal ${eng.modelEd.modal?.kind ?? "none"}` );
    await io.glide( r.width / 2 + 260, r.height / 2 + 120, 400 );
    log( `status: ${eng.modelEd.statusText}` );
    await io.click( r.width / 2 + 260, r.height / 2 + 120, 50 );
    await sleep( 300 );
    const c1 = piece().model!.mesh.c ?? {};
    log( `creases on the mesh: ${Object.keys( c1 ).length}, ${[...new Set( Object.values( c1 ).map( ( v ) => v.toFixed( 2 ) ) )].join( "," )}; modal ${eng.modelEd.modal?.kind ?? "none"}` );
    check( Object.keys( c1 ).length === 12 && corner() > Math.sqrt( 3 ) * 0.99, `pulled out: ${Object.keys( c1 ).length} edges creased, the corner ${corner().toFixed( 3 )} from the middle` );
    await io.glide( r.width / 2, r.height / 2, 200 );
    log( "SNAP pulled" );
    await sleep( 1200 );
    // undone; then a typed 1
    await io.key( "z", { ctrl: true } );
    await sleep( 300 );
    await io.key( "E", { shift: true } );
    await io.key( "1" );
    await io.key( "Enter" );
    await sleep( 300 );
    const c2 = piece().model!.mesh.c ?? {};
    check( Object.keys( c2 ).length === 12 && Object.values( c2 ).every( ( v ) => v === 1 ) && corner() > Math.sqrt( 3 ) * 0.999, `typed 1: ${Object.keys( c2 ).length} edges creased, the corner ${corner().toFixed( 3 )}` );
    await io.key( "Tab" );
    await sleep( 800 );
    log( "SNAP object" );
    await sleep( 1200 );
    io.stop();
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
