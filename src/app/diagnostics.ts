// Help > Save game diagnostics: a text report ( written by the Rust side, src-tauri/src/game/diag.rs ) of everything that
// decides how the game sits inside the studio, plus what the UI knows, for sending to whoever is helping.

import { invoke } from "@tauri-apps/api/core";
import { desktopDir } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";
import { joinPath } from "../core/ipc";
import { useEditor } from "../map/store";

export async function saveGameDiagnostics() {
  const stamp = new Date().toISOString().slice( 0, 19 ).replace( /[:T]/g, "-" );
  const path  = await save( {
    title:       "Save game diagnostics",
    defaultPath: joinPath( await desktopDir().catch( () => "" ), `jibbers-studio-diagnostics-${stamp}.txt` ),
    filters:     [{ name: "Text", extensions: ["txt"] }],
  } );
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
    st.toast( `Saved diagnostics to ${path}`, "success" );
  } catch ( e ) {
    st.toast( `Couldn't save diagnostics: ${e}`, "error" );
  }
}
