import { LAYOUTS } from "../../terrain/generate";
import { feature, log, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { loadLibrary, placeEntry } from "../../pieces/library";
import { newProject, saveProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/trees ): a map ( "Studio Tree Test", exported to the game ) with Tree Spruce pieces
 * in a ring round the spawn, some bigger and turned, to check in game that they come out as the game's own trees.
**/
export async function treesSelftest( dir: string ) {
  try {
    const proj = joinPath( dir, `trees-${Date.now()}.jbrproj` );
    await newProject( proj, "Studio Tree Test", { layout: LAYOUTS[0], base: "slope", slopeDeg: 12, heightRange: 300, seed: 7 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await loadLibrary();
    const g  = ( x: number, z: number ) => terrain.heightAt( x, z );
    const id = feature( "tree_spruce" );
    for ( let k = 0; k < 12; k++ ) {
      const a = ( k / 12 ) * Math.PI * 2, x = Math.cos( a ) * 18, z = Math.sin( a ) * 18 + 30;
      await placeEntry( id, [x, g( x, z ), z], [0, k * 30, 0] );
      if ( k % 3 === 0 ) {
        const o = useEditor.getState().customObjects[useEditor.getState().customObjects.length - 1];
        const s = 1 + k / 6;
        useEditor.setState( ( st ) => ( { customObjects: st.customObjects.map( ( c ) => ( c.uid === o.uid ? { ...c, scale: { x: s, y: s, z: s } } : c ) ) } ) );
      }
    }
    await saveProject();
    const r = await ipc.exportProject( useEditor.getState().projectDir! );
    log( `exported "${useEditor.getState().map?.name}" to ${r.path}: ${r.objects} objects (the trees aren't among them: they're the game's)` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
