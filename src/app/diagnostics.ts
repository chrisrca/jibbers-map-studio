// Help > Save game logs / Save studio logs: text files ( written by the Rust side, src-tauri/src/game/diag.rs ) for
// sending to whoever is helping. The game's: everything that decides how it sits inside the studio, and its own logs.
// The studio's: how it started, the warnings and errors it printed, its slowdown figures, the machine.

import { invoke } from "@tauri-apps/api/core";
import { desktopDir } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";
import { joinPath } from "../core/ipc";
import { useEditor } from "../map/store";
import { lagSummary } from "./lagWatch";

/**
 * Where to save `name`-<time>.txt ( the desktop to begin with ), or null if put off.
**/
async function saveTo( title: string, name: string ) {
  const stamp = new Date().toISOString().slice( 0, 19 ).replace( /[:T]/g, "-" );
  return save( {
    title,
    defaultPath: joinPath( await desktopDir().catch( () => "" ), `${name}-${stamp}.txt` ),
    filters:     [{ name: "Text", extensions: ["txt"] }],
  } );
}

export async function saveGameLogs() {
  const path = await saveTo( "Save game logs", "jibbers-game-logs" );
  if ( !path ) return;
  const st    = useEditor.getState();
  const host  = document.querySelector<HTMLElement>( ".game-panel" );
  const r     = host?.getBoundingClientRect();
  const d     = window.devicePixelRatio;
  const lines = [
    `devicePixelRatio ${d}`,
    `webview inner ${window.innerWidth}x${window.innerHeight} css px (${Math.round( window.innerWidth * d )}x${Math.round( window.innerHeight * d )} physical)`,
    `screen ${screen.width}x${screen.height} css px`,
    `centre tab ${st.centerTab}, game popped out ${st.gamePoppedOut}`,
    r
      ? `Game tab area: (${r.left.toFixed( 1 )}, ${r.top.toFixed( 1 )}) ${r.width.toFixed( 1 )}x${r.height.toFixed( 1 )} css px = (${Math.round( r.left * d )}, ${Math.round( r.top * d )}) ${Math.round( r.width * d )}x${Math.round( r.height * d )} physical, visible ${host!.style.visibility || "visible"}`
      : "Game tab area: (the Game tab isn't open)",
    `user agent ${navigator.userAgent}`,
  ];
  try {
    await invoke( "save_game_diagnostics", { path, frontend: lines.join( "\n" ) } );
    st.toast( `Saved ${path}`, "success" );
  } catch ( e ) {
    st.toast( `Couldn't save the game logs: ${e}`, "error" );
  }
}

export async function saveStudioLogs() {
  const path = await saveTo( "Save studio logs", "jibbers-studio-logs" );
  if ( !path ) return;
  const st = useEditor.getState();
  try {
    await invoke( "save_studio_logs", { path, frontend: [`user agent ${navigator.userAgent}`, "", ...lagSummary()].join( "\n" ) } );
    st.toast( `Saved ${path}`, "success" );
  } catch ( e ) {
    st.toast( `Couldn't save the studio logs: ${e}`, "error" );
  }
}
