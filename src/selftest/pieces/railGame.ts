import { feature, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { invoke } from "@tauri-apps/api/core";
import { ipc, joinPath } from "../../core/ipc";
import { loadLibrary, placeEntry } from "../../pieces/library";
import { openProject, saveProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/railgame ): a map with grind rails ( c_rail, tube_long ) played in the real game, so
 * its log can be checked for the physics refusing a collider ( riders then spawn under the map ). Launches the game.
**/
export async function railGameSelftest( dir: string ) {
  try {
    const { playInGame } = await import( "../../map/project" );
    await openProject( joinPath( dir, "..", "inputlag", "map.jbrproj" ) );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await loadLibrary();
    const st = useEditor.getState;
    const sp = st().spawns[0]?.position ?? [0, 0, 0];
    const g  = ( x: number, z: number ) => terrain.heightAt( x, z );
    for ( const [id, dx] of [["c_rail", 8], ["tube_long", -6]] as const ) {
      const x = sp[0] + dx, z = sp[2] + 12;
      await placeEntry( feature( id ), [x, g( x, z ), z], [0, 0, 0] );
      const o        = st().customObjects[st().customObjects.length - 1];
      const caps     = o.colliders.filter( ( c ) => c.mesh_ref === "studio-rail" );
      const shortest = Math.min( ...caps.map( ( c ) => c.height - 2 * c.radius ) );
      log( `${id}: ${caps.length} rail capsules (shortest straight part ${( shortest * 100 ).toFixed( 1 )} cm), solid body: ${o.rail?.whole ? "its own collider" : `${o.rail?.parts?.length ?? 0} fitted parts`}, ${o.colliders.length} colliders in all` );
    }
    await saveProject();
    const r = await invoke<{ fixedColliders: number; objects: number }>( "export_project", { projectDir: st().projectDir, outPath: null } );
    log( `exported: ${r.objects} objects, ${r.fixedColliders} colliders the export check had to fix` );
    await playInGame();
    const t0 = performance.now();
    while ( performance.now() - t0 < 180000 && ( await ipc.gameStatus() ) !== "embedded" ) await sleep( 1000 );
    log( `game embedded after ${( ( performance.now() - t0 ) / 1000 ).toFixed( 0 )} s` );
    await sleep( 45000 );
    log( "CHECK the game log now" );
    await sleep( 3000 );
    await ipc.gameClose().catch( () => {} );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
