// The map into the game: exported to its Maps folder, and played ( in the studio's Game tab or popped out ).

import { ask } from "../../app/ask";
import { ipc, joinPath } from "../../core/ipc";
import { inAssets } from "../../pieces/assetScene";
import { terrain } from "../../terrain/terrain";
import { testRun, useEditor } from "../store";
import { rememberRecent } from "./recent";
import { currentProject, saveProject } from "./save";
import { meta, uuid } from "./state";

export async function exportToGame() {
  // ( the export brings map pieces up to date: done on the map, out of the Assets workspace )
  if ( inAssets() ) useEditor.getState().setTool( "select" );
  const st  = useEditor.getState();
  const dir = st.projectDir;
  if ( !dir ) return null;
  // ( the game needs ground to load a map onto )
  if ( !terrain.chunks.length ) {
    st.toast( "Add terrain first", "info" );
    return null;
  }
  st.setBusy( "Exporting…" );
  try {
    // a real-world map's scenery gets the play area's terrain as it is now, coarse, for where the game has hidden
    // distant chunks ( geo/scenery/inner.ts )
    await import( "../../geo/scenery/inner" )
      .then( ( m ) => m.updateSceneryInner() )
      .catch( ( e ) => st.toast( `The scenery's view of the play area wasn't updated: ${e}`, "error" ) );
    // modelled pieces' meshes, into the library the map carries
    await import( "../../model/export" ).then( ( m ) => m.updateModelMeshes() ).catch( ( e ) => st.toast( `The modelled pieces weren't exported: ${e}`, "error" ) );
    // a map in the game with this id that this project didn't write ( the one it was imported from, or another
    // project's ): replaced only when you say so
    const target = joinPath( ( await ipc.appInfo() ).mapsDir, `${st.map!.id}.jbrmap` );
    const there  = await ipc.fileStamp( target ).catch( () => null );
    const was    = meta.exported;
    const ours   = was && there && was.id === st.map!.id && was.bytes === there[0] && Math.abs( was.modified - there[1] ) < 2000;
    if ( there && !ours && !testRun.active ) {
      st.setBusy( null );
      const name = st.map!.name.replace( /<[^>]*>/g, "" ).trim() || "This map";
      const a    = await ask( {
        title:   `“${name}” is already in the game`,
        text:    { label: "New map's name", value: `${st.map!.name} 2` },
        answers: [
          { id: "new",     label: "Save as new map", usesText: true },
          { id: "replace", label: "Replace it",      primary:  true },
        ],
      } );
      if ( !a ) return null;
      st.setBusy( "Exporting…" );
      if ( a.id === "new" ) {
        useEditor.setState( ( s ) => ( { map: s.map && { ...s.map, id: uuid(), name: a.text }, dirty: true } ) );
        rememberRecent( dir, a.text, useEditor.getState().map!.id );
      }
    }
    await saveProject();
    const r     = await ipc.exportProject( dir );
    // what was written, so the next export knows it's its own
    const stamp = await ipc.fileStamp( r.path ).catch( () => null );
    if ( stamp ) {
      meta.exported = { id: useEditor.getState().map!.id, bytes: stamp[0], modified: stamp[1] };
      await ipc.saveProject( dir, currentProject()! );
    }
    useEditor.setState( { gameCopy: "current" } );
    st.toast( `Exported ${( r.bytes / 1e6 ).toFixed( 1 )} MB · ${r.chunks} chunk${r.chunks > 1 ? "s" : ""} · ${r.objects} objects · ${r.spawns} spawns`, "success" );
    if ( r.fixedColliders )
      st.toast( `${r.fixedColliders} collider${r.fixedColliders > 1 ? "s" : ""} had a size the game's physics refuses (it would drop you under the map) — exported made safe`, "info" );
    if ( r.fixedScales )
      st.toast( `${r.fixedScales} object${r.fixedScales > 1 ? "s were" : " was"} mirrored or flattened (negative/zero scale), which breaks the game's physics — exported with positive scale instead`, "error" );
    return r;
  } catch ( e ) {
    st.toast( `Export failed: ${e}`, "error" );
    return null;
  } finally {
    st.setBusy( null );
  }
}

export async function playInGame() {
  const r = await exportToGame();
  if ( !r ) return;
  const st = useEditor.getState();
  const id = currentProject()?.map.id;
  if ( !id ) return;
  const embed = !st.gamePoppedOut;
  // the Game tab shows what's going on until the game is there
  const since = Date.now();
  useEditor.setState( { gameLaunch: { stage: "Starting Jibbers…", progress: null, since, started: false }, ...( embed ? { centerTab: "game" as const } : {} ) } );
  try {
    const outcome = await ipc.playInGame( id, embed );
    useEditor.setState( ( s ) => ( { gameLaunch: s.gameLaunch && { ...s.gameLaunch, started: true } } ) );
    const messages = {
      reloaded:  ["Reloading your map in Jibbers",  "success"],
      restarted: ["Restarting Jibbers on your map", "success"],
      launched:  [embed ? "Launching Jibbers in the Game tab" : "Launching Jibbers", "info"],
    } as const;
    const [text, kind] = messages[outcome];
    st.toast( text, kind );
    void watchLink( since );
  } catch ( e ) {
    useEditor.setState( { gameLaunch: null } );
    st.toast( String( e ), "error" );
  }
}

/**
 * After Play: whether the studio's link got going in the game ( it reports in ). If it couldn't, say so, rather than
 * Play seeming to do nothing: the game still starts with the map chosen, a click through its menu away.
**/
async function watchLink( since: number ) {
  const until = since + 3 * 60_000;
  while ( Date.now() < until ) {
    await new Promise( ( r ) => setTimeout( r, 3000 ) );
    const health = await ipc.linkHealth( since ).catch( () => null );
    if ( health === null ) continue;
    if ( health !== "ok" )
      useEditor.getState().toast(
        `The studio's link couldn't start in Jibbers (${health}). Your map is chosen: press Play in the game's menu.`,
        "error",
      );
    return;
  }
}
