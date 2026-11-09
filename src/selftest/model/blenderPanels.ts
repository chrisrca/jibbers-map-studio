import type { V3 } from "../../core/coords";
import { joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";
import { evaluate, type ModelData } from "../../model/build";
import { selFromFaces } from "../../model/ops";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";
import reference from "../../../tests/model/blender/reference.json";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/blenderpanels ): Properties › Modifiers as a person uses it, each step against
 * what Blender's stack makes ( tests/model/blender/reference.json ): Add Modifier › Subdivision Surface then Array; Move
 * up ( the order Blender's results show ); the Show box off and on; Apply on the second ( as if first, as Blender's );
 * Remove. Then U in Edit Mode: Cube Projection and Reset laid on every face, inside the square.
**/
export async function blenderPanelsSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const P = await import( "../../map/project" );
    await P.newEmptyProject( joinPath( dir, `panels-${Date.now()}.jbrproj` ), "Blender Panels" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await sleep( 1000 );
    const st = () => useEditor.getState();
    [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === "Assets" )?.click();
    await sleep( 1200 );
    const io    = realInput( eng, () => "panels" );
    const frame = () => new Promise<void>( ( r ) => requestAnimationFrame( () => r() ) );
    const key   = async ( k: string, m: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {} ) => {
      const init = { key: k, code: k.length === 1 ? ( /[0-9]/.test( k ) ? `Digit${k}` : `Key${k.toUpperCase()}` ) : k, ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: !!m.alt, bubbles: true, cancelable: true };
      window.dispatchEvent( new KeyboardEvent( "keydown", init ) );
      window.dispatchEvent( new KeyboardEvent( "keyup", init ) );
      await frame();
      await sleep( 60 );
    };
    const menu = async ( label: string ) => {
      await sleep( 200 );
      const it = [...document.querySelectorAll<HTMLElement>( ".bmenu .bmenu-item" )].find( ( x ) => x.textContent?.trim().startsWith( label ) );
      it?.click();
      await sleep( 300 );
      return !!it;
    };
    const pull = async ( label: string ) => {
      const b = [...document.querySelectorAll<HTMLElement>( ".props .bpull, .props button" )].find( ( x ) => x.textContent?.trim() === label );
      b?.dispatchEvent( new MouseEvent( "mousedown", { button: 0, bubbles: true, cancelable: true } ) );
      b?.click();
      await sleep( 200 );
      return !!b;
    };
    await io.glide( io.rc.width / 2, io.rc.height / 2, 200 );
    const REF  = ( reference as unknown as { cases: Record<string, { v: V3[]; f: number[][] }> } ).cases;
    const off  = ( a: V3[], b: V3[] ) => Math.max( 0, ...a.map( ( p ) => Math.min( ...b.map( ( q ) => Math.hypot( p[0] - q[0], p[1] - q[1], p[2] - q[2] ) ) ) ) );
    const like = ( model: ModelData, name: string ) => {
      const g = evaluate( model ), r = REF[name];
      return g.v.length === r.v.length && g.f.length === r.f.length && off( g.v, r.v ) < 1e-3 && off( r.v, g.v ) < 1e-3;
    };

    await key( "A", { shift: true } );
    await menu( "Cube" );
    await sleep( 300 );
    const uid   = st().selection[0]!.uid;
    const model = () => st().customObjects.find( ( o ) => o.uid === uid )!.model!;
    [...document.querySelectorAll<HTMLButtonElement>( ".props-hdr ~ * button, .area button" )].find( ( b ) => b.title === "Modifiers" )?.click();
    await sleep( 300 );
    // Add Modifier › Subdivision Surface, › Array
    await pull( "Add Modifier" ); await menu( "Subdivision Surface" );
    await pull( "Add Modifier" ); await menu( "Array" );
    await sleep( 200 );
    const types = () => model().modifiers.map( ( m ) => m.type ).join( ", " );
    check( types() === "subsurf, array" && like( model(), "subdivision then array" ), `Add Modifier twice: ${types()}, as Blender's stack makes it ( ${like( model(), "subdivision then array" )} )` );
    // Move up on the Array: first
    const rows = () => [...document.querySelectorAll<HTMLElement>( ".props .modifier" )];
    rows()[1]?.querySelector<HTMLButtonElement>( 'button[title="Move up"]' )?.click();
    await sleep( 200 );
    check( types() === "array, subsurf" && like( model(), "array then subdivision" ), `Move up on the Array: ${types()}, as Blender's in that order ( ${like( model(), "array then subdivision" )} )` );
    // the Show box off on the second: only the first counts; on again
    const box = () => rows()[1]?.querySelector<HTMLInputElement>( 'input[type="checkbox"]' );
    box()?.click();
    await sleep( 200 );
    const shown = evaluate( model() ).v.length;
    box()?.click();
    await sleep( 200 );
    check( shown === 16 && model().modifiers.every( ( m ) => m.on ), `the Show box off on Subdivision: ${shown} vertices ( the array alone ); on again` );
    // Apply on the second: made part of the mesh as if first
    rows()[1]?.querySelector<HTMLButtonElement>( 'button[title="Apply"]' )?.click();
    await sleep( 300 );
    check( types() === "array" && model().mesh.v.length === 26 && like( model(), "apply the second of two" ), `Apply on Subdivision: ${types()} left, the mesh ${model().mesh.v.length} vertices, as Blender's ( ${like( model(), "apply the second of two" )} )` );
    // Remove
    rows()[0]?.querySelector<HTMLButtonElement>( 'button[title="Remove"]' )?.click();
    await sleep( 200 );
    check( model().modifiers.length === 0, "Remove: no modifiers left" );

    // ---------------------------------------------------------------- U in Edit Mode
    await key( "Tab" );
    await key( "3" );
    await key( "a" );
    const g = () => model().mesh;
    eng.modelEd.sel = selFromFaces( g(), g().f.map( ( _, i ) => i ) );
    eng.modelEd.sync();
    for ( const item of ["Cube Projection", "Reset", "Smart UV Project"] ) {
      await key( "u" );
      const ran = await menu( item );
      const u   = g().u ?? [];
      const ok  = ran && g().f.every( ( f, i ) => u[i]?.length === f.length * 2 ) && u.flat().every( ( x ) => x >= -1e-6 && x <= 1 + 1e-6 );
      check( ok, `U › ${item}: every face laid out inside the square ( ${g().f.length} faces )` );
    }
    await key( "Tab" );
    io.stop();
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
