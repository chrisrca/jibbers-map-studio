import { ipc, joinPath } from "../../core/ipc";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/placeexport ): a project in the folder ( a copy: a big imported map ) opened, a
 * piece from the asset browser placed on it as a person does ( its card clicked, the ground clicked ), every message
 * shown meanwhile and how long it took logged; then the map exported ( into the folder, not the game's ) and the
 * export checked for the piece and its mesh.
**/
export async function placeExportSelftest( dir: string ) {
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
    // every message shown
    const said: string[] = [];
    const off            = useEditor.subscribe( ( s, p ) => {
      for ( const t of s.toasts ) if ( !p.toasts.includes( t ) ) said.push( `${t.kind}: ${t.text}` );
    } );
    // a piece's card ( not a lift ), clicked: the Place tool with it
    const card = await waitFor( () => [...document.querySelectorAll<HTMLElement>( ".assets-main .grid .card" )].find( ( x ) => !x.classList.contains( "material" ) && !["Chairlift", "T-Bar", "Rope Tow"].includes( x.querySelector( ".name" )?.textContent ?? "" ) ) ?? null, "a card", 20000 );
    const name = card.querySelector( ".name" )?.textContent ?? "";
    const r    = card.getBoundingClientRect();
    card.dispatchEvent( new PointerEvent( "pointerdown", { clientX: r.left + 20, clientY: r.top + 20, button: 0, buttons: 1, pointerId: 71, bubbles: true } ) );
    window.dispatchEvent( new PointerEvent( "pointerup", { clientX: r.left + 20, clientY: r.top + 20, button: 0, buttons: 0, pointerId: 71, bubbles: true } ) );
    await sleep( 300 );
    check( st().tool === "place" && !!st().placeEntry, `${name}'s card clicked: tool ${st().tool}, placing ${st().placeEntry}` );
    // the ground clicked
    const c  = terrain.chunks[0];
    const at = [c.position[0] + c.size[0] / 2, c.position[2] + c.size[2] / 2] as const;
    eng.nav.lookAtUnity( [at[0] - 30, terrain.heightAt( at[0], at[1] ) + 20, at[1] - 10], [at[0], terrain.heightAt( at[0], at[1] ), at[1]] );
    await sleep( 1500 );
    const canvas = eng.renderer.domElement, cr = canvas.getBoundingClientRect();
    const n0     = st().customObjects.length;
    const x = cr.left + cr.width / 2, y = cr.top + cr.height / 2;
    canvas.dispatchEvent( new PointerEvent( "pointerenter", { bubbles: true } ) );
    canvas.dispatchEvent( new PointerEvent( "pointermove", { clientX: x, clientY: y, buttons: 0, pointerId: 72, bubbles: true } ) );
    await sleep( 100 );
    // ( the longest the page was held up meanwhile )
    let worst = 0, last = performance.now(), on = true;
    const tick = ( t: number ) => {
      worst = Math.max( worst, t - last );
      last  = t;
      if ( on ) requestAnimationFrame( tick );
    };
    requestAnimationFrame( tick );
    const t0 = performance.now();
    canvas.dispatchEvent( new PointerEvent( "pointerdown", { clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 72, bubbles: true } ) );
    window.dispatchEvent( new PointerEvent( "pointerup", { clientX: x, clientY: y, button: 0, buttons: 0, pointerId: 72, bubbles: true } ) );
    await waitFor( () => ( st().customObjects.length > n0 ? true : null ), "the piece placed", 120000 ).catch( () => null );
    const took = performance.now() - t0;
    await sleep( 1500 );
    on = false;
    const placed = st().customObjects.slice( n0 );
    check( placed.length === 1, `the ground clicked: ${placed.length} placed in ${( took / 1000 ).toFixed( 1 )} s, the page held up at most ${worst.toFixed( 0 )} ms; said: ${said.join( " | " ) || "nothing"}` );
    check( took < 1500 && worst < 250, `placing it was quick: ${( took / 1000 ).toFixed( 1 )} s, the page held up at most ${worst.toFixed( 0 )} ms` );
    // the export: the piece in it, its mesh with it
    const out = joinPath( dir, "export-check.jbrmap" );
    const t1  = performance.now();
    // ( saved first, as Play does )
    await ( await import( "../../map/project" ) ).saveProject();
    const ex  = await ipc.exportProject( st().projectDir!, out );
    // ( the file's too big to read in here: its mesh looked for by the run's script )
    const mesh  = placed[0]?.parts[0]?.mesh ?? "";
    const saved = ( JSON.parse( await ipc.readText( joinPath( st().projectDir!, "project.json" ) ) ) as { customObjects: unknown[]; objects: unknown[] } );
    check( ex.objects === saved.customObjects.length + saved.objects.length, `exported in ${( ( performance.now() - t1 ) / 1000 ).toFixed( 1 )} s: ${ex.objects} objects ( ${saved.customObjects.length} pieces and ${saved.objects.length} of the game's saved ); MESH ${mesh}` );
    off();
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
