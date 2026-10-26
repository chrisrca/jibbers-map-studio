// A new version of the studio, from its releases on GitHub ( Tauri's updater: the release's latest.json, its installer
// signed with the studio's key ): looked for each time the studio opens, and asked about — Update installs it and
// starts the studio again ( the map open is asked about first, as when it's closed ), Later leaves it till next time.
// Nothing's said when there's no new one, or no way to look ( offline, no release yet ).

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "./ask";
import { keepMapChanges } from "../map/project";
import { useEditor } from "../map/store";

export async function checkForUpdate() {
  let update;
  try {
    update = await check();
  } catch ( e ) {
    console.warn( "update check", e );
    return;
  }
  if ( !update ) return;
  const a = await ask( {
    title: `Jibbers Map Studio ${update.version} is out`,
    answers: [
      { id: "later",  label: "Later" },
      { id: "update", label: "Update", primary: true },
    ],
  } );
  if ( a?.id !== "update" || !( await keepMapChanges() ) ) return;
  const st  = useEditor.getState();
  let total = 0, got = 0;
  st.setBusy( `Updating to ${update.version}…` );
  try {
    await update.downloadAndInstall( ( e ) => {
      if ( e.event === "Started" ) total = e.data.contentLength ?? 0;
      else if ( e.event === "Progress" ) {
        got += e.data.chunkLength;
        if ( total ) st.setBusy( `Updating to ${update.version}… ${Math.round( ( got / total ) * 100 )}%` );
      } else if ( e.event === "Finished" ) st.setBusy( `Installing ${update.version}…` );
    } );
    await relaunch();
  } catch ( e ) {
    st.setBusy( null );
    st.toast( `Couldn't update: ${e}`, "error" );
  }
}
