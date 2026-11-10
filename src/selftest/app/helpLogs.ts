import { invoke } from "@tauri-apps/api/core";
import { ipc, joinPath } from "../../core/ipc";
import { lagSummary } from "../../app/lagWatch";
import { log } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/helplogs ): Help › Save game logs and Save studio logs, as their menu items
 * write them ( the save dialog aside ), each file read back for its sections.
**/
export async function helpLogsSelftest( dir: string ) {
  try {
    console.warn( "helplogs: a warning for the studio log" );
    const game   = joinPath( dir, "game-logs.txt" ), studio = joinPath( dir, "studio-logs.txt" );
    await invoke( "save_game_diagnostics", { path: game, frontend: "" } );
    await invoke( "save_studio_logs", { path: studio, frontend: lagSummary().join( "\n" ) } );
    const want = {
      [game]:   ["game logs", "The game's own log", "Unity's log"],
      [studio]: ["studio logs", "== the editor", "Starting up", "Warnings and errors", "helplogs: a warning", "The machine", "Lag reports"],
    };
    for ( const [path, heads] of Object.entries( want ) ) {
      const text    = await ipc.readText( path );
      const missing = heads.filter( ( h ) => !text.includes( h ) );
      log( `${path}: ${text.length} chars, ${text.split( "\n" ).length} lines` );
      if ( missing.length ) throw new Error( `${path} is missing ${missing.join( ", " )}` );
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
