import { ipc, joinPath } from "../../core/ipc";
import { isScenery } from "../../core/types";
import { openProject, saveProject } from "../../map/project";
import { history } from "../../map/history";
import { useEditor } from "../../map/store";
import { getEngine } from "../../ui/Viewport";
import { log, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/piecehue ): a piece of the map's own ( a copy of a park in the folder, a textured
 * piece ) given a Hue from its Material section as a person does ( the slider clicked, 144 typed ): the piece keeps
 * it, the view draws it turned ( before and after shown ), and the export carries a texture with it baked in ( its
 * name logged for the run's script to look for: the file's too big to read in here ).
**/
export async function pieceHueSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    useEditor.setState( { splash: false } );
    const st = () => useEditor.getState();
    const o  = st().customObjects.find( ( c ) => !isScenery( c ) && !c.tree && !st().locked[c.uid] && c.parts.some( ( p ) => p.materials.some( ( m ) => m.base_tex ) ) );
    if ( !o ) throw new Error( "no textured piece" );
    log( `the piece: ${st().labels[o.uid] ?? o.parts[0].mesh}, texture ${o.parts[0].materials[0]?.base_tex}` );
    eng.nav.lookAtUnity( [o.position.x - 6, o.position.y + 4, o.position.z - 6], [o.position.x, o.position.y, o.position.z] );
    st().setSelection( [{ kind: "custom", uid: o.uid }] );
    await sleep( 2500 );
    log( "SNAP hue-before" );
    await sleep( 1200 );
    // the Hue slider: in the piece's Colour picker ( the chip by "Colour" clicked open ), under Adjust
    const colourRow = [...document.querySelectorAll<HTMLLabelElement>( ".props > label" )].find( ( l ) => l.textContent === "Colour" );
    colourRow?.nextElementSibling?.querySelector<HTMLButtonElement>( ".colour-chip" )?.click();
    const adjustSlider = ( name: string ) => [...document.querySelectorAll<HTMLElement>( ".cpick-adjust .bslider" )].find( ( s ) => s.textContent?.startsWith( name ) ) ?? null;
    const slider       = await waitFor( () => adjustSlider( "Hue" ), "the Hue slider in the Colour picker", 3000 ).catch( () => null );
    check( !!slider, "the Colour picker has the piece's Hue, under Adjust" );
    // ( a slider clicked, a number typed, Enter )
    const type = async ( s: HTMLElement | null, text: string ) => {
      if ( !s ) return;
      const r = s.getBoundingClientRect();
      s.dispatchEvent( new PointerEvent( "pointerdown", { clientX: r.left + 10, clientY: r.top + 5, button: 0, buttons: 1, pointerId: 81, bubbles: true } ) );
      window.dispatchEvent( new PointerEvent( "pointerup", { clientX: r.left + 10, clientY: r.top + 5, button: 0, buttons: 0, pointerId: 81, bubbles: true } ) );
      const field = await waitFor( () => document.querySelector<HTMLInputElement>( "input.bslider.editing" ), "the slider's field", 3000 );
      field.focus();
      Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, "value" )!.set!.call( field, text );
      field.dispatchEvent( new Event( "input", { bubbles: true } ) );
      field.dispatchEvent( new KeyboardEvent( "keydown", { key: "Enter", bubbles: true } ) );
      // ( the field saves as it loses focus: the event sent, the test's window not having the keyboard to send it )
      field.dispatchEvent( new FocusEvent( "focusout", { bubbles: true } ) );
      field.blur();
      await sleep( 1500 );
    };
    const steps = () => history.list().labels.slice( 0, history.list().current + 1 ).slice( -4 ).join( " / " );
    await type( slider, "144" );
    log( `  undo steps after the Hue: ${steps()}` );
    await type( adjustSlider( "Saturation" ), "-50" );
    log( `  undo steps after the Saturation: ${steps()}` );
    await sleep( 1500 );
    const now = st().customObjects.find( ( c ) => c.uid === o.uid )!;
    check( Math.abs( ( now.hue ?? 0 ) - 0.4 ) < 1e-6 && now.adjust?.saturation === -0.5, `the piece's Hue ${now.hue}, Saturation ${now.adjust?.saturation}` );
    check( [...document.querySelectorAll<HTMLLabelElement>( ".props > label" )].every( ( l ) => l.textContent !== "Hue" ), "no Hue row of its own any more" );
    // ( drawn turned: its meshes' materials carry the turn )
    const meshes = eng.customR.pickables( ( u ) => u === o.uid ) as unknown as { material: { colorNode?: unknown } | { colorNode?: unknown }[] }[];
    const turned = meshes.some( ( m ) => ( Array.isArray( m.material ) ? m.material : [m.material] ).some( ( x ) => x.colorNode ) );
    check( turned, `the view draws it turned ( ${meshes.length} meshes )` );
    log( "SNAP hue-after" );
    await sleep( 1200 );
    // undone: back as it was
    history.undo();
    await sleep( 500 );
    check( st().customObjects.find( ( c ) => c.uid === o.uid )!.adjust === undefined, `undone: the Saturation ( now ${JSON.stringify( st().customObjects.find( ( c ) => c.uid === o.uid )!.adjust )}, hue ${st().customObjects.find( ( c ) => c.uid === o.uid )!.hue } )` );
    history.redo();
    await sleep( 500 );
    // the export: a texture with the Hue baked in
    await saveProject();
    const out = joinPath( dir, "export-check.jbrmap" );
    await ipc.exportProject( st().projectDir!, out );
    log( `BAKED ${o.parts[0].materials[0].base_tex}~adj144,-0.500,` );
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
