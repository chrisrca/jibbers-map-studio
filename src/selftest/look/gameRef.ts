import { LAYOUTS } from "../../terrain/generate";
import type { ObjectEntry } from "../../core/types";
import { feature, log, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { loadLibrary, placeEntry } from "../../pieces/library";
import { newProject, saveProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/gameref ): "Studio Look Test" — the game's own features ( official objects, drawn
 * by the game ) in a row in front of the spawn, each with our piece of it ( the game's meshes and paint ) just behind,
 * at noon; exported and started in the game ( a script there takes pictures of its window ).
**/
export async function gameRefSelftest( dir: string ) {
  try {
    const { paramDefault } = await import( "../../map/store" );
    const proj             = joinPath( dir, `gameref-${Date.now()}.jbrproj` );
    await newProject( proj, "Studio Look Test", { layout: LAYOUTS[0], base: "flat", slopeDeg: 0, heightRange: 100, seed: 1 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await loadLibrary();
    const g                      = terrain.heightAt( 0, 0 );
    const ids                    = ["half_spine", "rainbow_box", "up_down_box", "tube_long", "stairs_short", "flat_box", "battleship_box", "rail_long"];
    const objects: ObjectEntry[] = [];
    for ( const [k, id] of ids.entries() ) {
      const x    = ( k - ( ids.length - 1 ) / 2 ) * 6;
      const info = useEditor.getState().placeholders.find( ( p ) => p.id === id )!;
      // the game's own, at the library's size ( its prefab is twice that )
      objects.push( { uid: `ref${k}`, id, position: [x, g, 14], rotation: [0, 0, 0], scale: [0.5, 0.5, 0.5], params: Object.fromEntries( info.parameters.map( ( p ) => [p.name, paramDefault( p )] ) ) } );
      await placeEntry( feature( id ), [x, g, 24], [0, 0, 0] );
    }
    // lifted to sit on the ground as the game's do ( pivots are part way up ): the same height as the official one
    useEditor.setState( ( s ) => ( {
      objects,
      spawns: [{ uid: "sp", name: "Look", position: [0, g + 25, 19], rotation: [0, 0, 0], velocity: [0, 0, 0.01] }],
      map:    s.map && { ...s.map, overrideTime: true, dayTimeHours: 12, dayTime: 0.5 },
    } ) );
    await saveProject();
    const r = await ipc.exportProject( proj );
    log( `exported "${useEditor.getState().map?.name}" (${useEditor.getState().map?.id}) to ${r.path}: ${r.objects} objects` );
    const outcome = await ipc.playInGame( useEditor.getState().map!.id, false );
    log( `PLAYING ${outcome}` );
    log( "SELFTEST OK"        );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
