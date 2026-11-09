import { toThree, type V3 } from "../../core/coords";
import { ipc } from "../../core/ipc";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/colliderpark ): the Collider tool on a real map ( a copy of a park in the folder ),
 * as a person tries it: the tool picked from the column, one of the map's pieces clicked, a stroke drawn across it.
 * What's picked and what's drawn at each step logged.
**/
export async function colliderParkSelftest( dir: string ) {
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
    // a piece of the map's own ( not a tree ), a box or a rail at least a couple of metres long, framed
    const o = st().customObjects.find( ( c ) => !c.scenery && !c.tree && !st().locked[c.uid] && c.colliders.length > 0 && c.parts.length > 0 && !/tree|pine|spruce/i.test( st().labels[c.uid] ?? "" ) );
    if ( !o ) throw new Error( "no piece to try it on" );
    const at: V3 = [o.position.x, o.position.y, o.position.z];
    eng.nav.lookAtUnity( [at[0] - 6, at[1] + 5, at[2] - 6], at );
    await sleep( 1500 );
    const io  = realInput( eng, () => "colliders" );
    const scr = ( p: V3 ) => eng.screenOf( toThree( p ) ).slice( 0, 2 ) as [number, number];
    log( `the piece: ${st().labels[o.uid] ?? o.parts[0].mesh} ( ${o.parts.length} parts, ${o.colliders.length} colliders, ${o.surface_type} )` );
    // the tool, from the column
    document.querySelector<HTMLButtonElement>( ".tool-column button[title='Colliders']" )?.click();
    await sleep( 300 );
    check( st().tool === "collider", `the Colliders tool picked: ${st().tool}` );
    // the piece clicked: what's under the mouse first
    const [x, y] = scr( at );
    const under  = eng.pickObject( x, y );
    log( `under the mouse at the piece's middle: ${under ? `${under.kind} ${st().labels[under.uid] ?? under.uid}` : "nothing"}` );
    await io.click( x, y );
    await sleep( 400 );
    const picked = st().selection[0];
    check( picked?.kind === "custom", `a click on it with the tool: ${picked ? `${picked.kind} ${st().labels[picked.uid] ?? picked.uid}` : "nothing"} picked` );
    // a stroke across the picked piece, where the mouse finds it
    const uid = picked?.uid ?? o.uid, p0 = st().customObjects.find( ( c ) => c.uid === uid )!;
    const before = p0.colliders.length;
    const c = [p0.position.x, p0.position.y, p0.position.z] as V3;
    // ( along the screen, through its middle, short )
    await io.drag( x - 40, y, x + 40, y, 600 );
    await sleep( 500 );
    const after = st().customObjects.find( ( c2 ) => c2.uid === uid )!.colliders.length;
    check( after > before, `a stroke across it drew colliders: ${before} -> ${after}` );
    void c;
    log( "SNAP colliderpark" );
    await sleep( 1200 );
    io.stop();
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
