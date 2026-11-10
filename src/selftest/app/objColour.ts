import { ipc } from "../../core/ipc";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";
import { getEngine } from "../../ui/Viewport";
import { log, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/objcolour ): one of the game's own pieces on a map ( a copy in the folder ) given
 * another colour from its panel, as a person does: picked, its colour's red swatch clicked; whether its look in the view
 * changed, before and after shown.
**/
export async function objColourSelftest( dir: string ) {
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
    const o  = st().objects.find( ( x ) => x.id === "rail_long" ) ?? st().objects.find( ( x ) => x.params.color );
    if ( !o ) throw new Error( "no coloured game piece" );
    eng.nav.lookAtUnity( [o.position[0] - 5, o.position[1] + 4, o.position[2] - 5], o.position );
    st().setSelection( [{ kind: "object", uid: o.uid }] );
    await sleep( 2500 );
    const looks = eng.objectsR.looks as unknown as { lookOf: Map<string, string> };
    const before = looks.lookOf.get( o.uid );
    log( "SNAP colour-before" );
    await sleep( 1200 );
    const swatch = document.querySelector<HTMLElement>( ".swatches .swatch[title='red']" );
    log( `colour swatches: ${[...document.querySelectorAll( ".swatches .swatch" )].map( ( s ) => s.getAttribute( "title" ) ).join( ", " ) || "none"}` );
    swatch?.click();
    await sleep( 6000 );
    const now   = st().objects.find( ( x ) => x.uid === o.uid )!;
    const after = looks.lookOf.get( o.uid );
    check( !!swatch && JSON.stringify( now.params.color ) === JSON.stringify( { type: "String", value: "red" } ), `the red swatch clicked: colour ${JSON.stringify( now.params.color )}` );
    check( !!after && after !== before, `its look in the view: ${before} -> ${after}` );
    log( "SNAP colour-after" );
    await sleep( 1200 );
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
