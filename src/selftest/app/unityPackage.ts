import { answer, useAsk } from "../../app/ask";
import { joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, sleep, waitFor } from "../harness";

// The template project made into packages ( scratch make_unitypackage.py: as Unity's Export Package writes them ): all
// of it ( both scenes ), and MLNZ's scene with what it uses
const PACKAGES = "C:/Projects/jibbers-map/test-packages";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/unitypackage ): .unitypackage files imported as Import… imports them. The whole
 * template ( two scenes: which one asked, MLNZ picked ), then MLNZ's own package ( one scene: no question ). Each
 * opened as the map the same scene makes from the project itself ( self-test unityimport's counts ), though the
 * package has no Library ( models read from their FBX ) and no Map-Tools of its own ( put in beside it ).
**/
export async function unityPackageSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const { newEmptyProject } = await import( "../../map/project/sessions" );
    const { importUnityFile } = await import( "../../ui/importAny" );
    await newEmptyProject( joinPath( dir, `start-${Date.now()}.jbrproj` ), "Untitled" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    const st = () => useEditor.getState();
    // ( any "save your map?" answered Don't Save; the scene question answered with MLNZ, its answers logged )
    let asked: string[] = [];
    const answering     = setInterval( () => {
      const q = useAsk.getState().question;
      if ( !q ) return;
      if ( q.answers.some( ( a ) => a.id === "discard" ) ) return answer( { id: "discard", text: "" } );
      asked = q.answers.map( ( a ) => a.label );
      const mlnz = q.answers.find( ( a ) => a.id.includes( "MLNZ_Reference" ) );
      answer( mlnz ? { id: mlnz.id, text: "" } : null );
    }, 200 );
    const opened = async ( name: string ) => {
      await waitFor( () => ( st().map?.name === "MLNZ Park" && terrain.chunks.length && !st().busy ? true : null ), `${name} opened`, 900000 );
      await sleep( 3000 );
      const trees = st().customObjects.filter( ( o ) => o.tree ).length;
      return `${terrain.chunks.length} chunk of ${terrain.chunks[0]?.res}, ${st().objects.length} objects ( 54 ), ${st().spawns.length} spawns ( 22 ), ${st().customObjects.length} pieces ( 213+ ), ${trees} trees ( 283 )`;
    };
    const right = () => terrain.chunks.length === 1 && terrain.chunks[0].res === 4097 && st().objects.length === 54 && st().spawns.length === 22 && st().customObjects.length >= 213 && st().customObjects.filter( ( o ) => o.tree ).length === 283;

    // ---- the whole template: two scenes, MLNZ picked
    let t0 = performance.now();
    await importUnityFile( `${PACKAGES}/Jibbers_Template.unitypackage` );
    let got = await opened( "the template's MLNZ" );
    check( asked.length === 2 && asked.some( ( a ) => a.startsWith( "MLNZ_Reference" ) ) && asked.some( ( a ) => a.startsWith( "Main" ) ), `the template package: asked which scene, of ${asked.join( " / " )}` );
    check( right(), `MLNZ from the template package, in ${( ( performance.now() - t0 ) / 1000 ).toFixed( 0 )} s: ${got}` );
    log( "SNAP template-mlnz" );
    await sleep( 2500 );

    // ---- MLNZ's own package: one scene, no question
    asked = [];
    useEditor.setState( { map: { ...st().map!, name: "was" } } );
    // ( where the time goes: unpacking it the first time, then the import from what's unpacked )
    const { ipc } = await import( "../../core/ipc" );
    t0            = performance.now();
    await ipc.openUnityPackage( `${PACKAGES}/MLNZ_Reference.unitypackage` );
    const unpack  = ( performance.now() - t0 ) / 1000;
    t0            = performance.now();
    await importUnityFile( `${PACKAGES}/MLNZ_Reference.unitypackage` );
    got = await opened( "MLNZ's package" );
    check( asked.length === 0 && right(), `MLNZ's own package, no question asked: unpacked in ${unpack.toFixed( 0 )} s, imported in ${( ( performance.now() - t0 ) / 1000 ).toFixed( 0 )} s: ${got}` );
    log( "SNAP package-mlnz" );
    await sleep( 2500 );

    // ---- the same scene from the project itself, for the time it takes
    useEditor.setState( { map: { ...st().map!, name: "was" } } );
    t0 = performance.now();
    await importUnityFile( "C:/Projects/jibbers-map/Jibbers_Template/Assets/Scenes/MLNZ_Reference.unity" );
    got = await opened( "MLNZ from the project" );
    log( `the project's MLNZ ( Library and all ), imported in ${( ( performance.now() - t0 ) / 1000 ).toFixed( 0 )} s: ${got}` );
    clearInterval( answering );
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
