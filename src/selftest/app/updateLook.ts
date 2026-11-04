import { getEngine } from "../../ui/Viewport";
import { joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/updatelook ): what users see when an update comes ( app/updates.ts offerUpdate,
 * as the real one runs it ), with a stand-in download: the question, Update pressed, the download's progress, the
 * install. Each step logged "SNAP <name>" and held for a screen capture from outside; nothing's installed or restarted.
**/
export async function updateLookSelftest( dir: string ) {
  try {
    const { newEmptyProject } = await import( "../../map/project/sessions" );
    const { offerUpdate }     = await import( "../../app/updates" );
    await newEmptyProject( joinPath( dir, `look-${Date.now()}.jbrproj` ), "Untitled" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await sleep( 3000 );
    const snap = async ( name: string ) => {
      log( `SNAP ${name}` );
      await sleep( 2500 );
    };
    // ( a 30 MB installer, come in over a few seconds )
    const total   = 30e6;
    let   step    = "";
    const offered = offerUpdate( {
      version: "0.2.0",
      downloadAndInstall: async ( progress ) => {
        progress( { event: "Started", data: { contentLength: total } } );
        for ( let got = 0; got < total; got += total / 40 ) {
          progress( { event: "Progress", data: { chunkLength: total / 40 } } );
          if ( got >= total * 0.4 && step === "" ) {
            step = "downloading";
            await snap( "2-downloading" );
          }
          await sleep( 60 );
        }
        progress( { event: "Finished" } );
        await snap( "3-installing" );
      },
    }, async () => {
      log( "  ( would start again here )" );
    } );
    await sleep( 800 );
    await snap( "1-asked" );
    const press = [...document.querySelectorAll<HTMLButtonElement>( "button" )].find( ( b ) => b.textContent?.trim() === "Update" );
    if ( !press ) throw new Error( "no Update button" );
    press.click();
    await offered;
    useEditor.getState().setBusy( null );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
