import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/maptrees, the map to import named in the folder's map.txt ): a map imported as a
 * person does ( File › Import ), its trees drawn — the game's own, and those it built from its own meshes — counted, and
 * a view of some of them left in the folder.
**/
export async function mapTreesSelftest( dir: string ) {
  try {
    const { importMap } = await import( "../../map/project" );
    const mapPath       = ( await ipc.readText( joinPath( dir, "map.txt" ) ) ).trim();
    const proj          = joinPath( dir, `trees-${Date.now()}.jbrproj` );
    await importMap( mapPath, proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st     = () => useEditor.getState();
    const protos = Object.values( st().chunkExtras ).flatMap( ( e ) => ( ( e as { treePrototypes?: { object_id?: string; parts?: unknown[]; instances?: number[] }[] } ).treePrototypes ?? [] ) );
    log( `prototypes: ${protos.length} (${protos.filter( ( t ) => t.object_id ).length} the game's, ${protos.filter( ( t ) => !t.object_id && t.parts?.length ).length} the map's own), trees ${protos.reduce( ( a, t ) => a + Math.floor( ( t.instances?.length ?? 0 ) / 28 ), 0 )}` );
    const built = eng.trees.builtTrees;
    const want  = protos.filter( ( t ) => !t.object_id ).reduce( ( a, t ) => a + Math.floor( ( t.instances?.length ?? 0 ) / 28 ), 0 );
    const t0    = performance.now();
    while ( performance.now() - t0 < 180000 && ( built.children as THREE.InstancedMesh[] ).reduce( ( a, m ) => a + m.count, 0 ) < want ) await sleep( 250 );
    log( `drawn after ${( ( performance.now() - t0 ) / 1000 ).toFixed( 1 )} s${eng.trees.treeError ? `; error: ${eng.trees.treeError}` : ""}` );
    const meshes = built.children as THREE.InstancedMesh[];
    log( `the map's own trees drawn: ${meshes.length} instanced meshes, ${meshes.reduce( ( a, m ) => a + m.count, 0 )} instances` );
    // looking at the first one
    const first = meshes[0];
    if ( first ) {
      const m = new THREE.Matrix4();
      first.getMatrixAt( 0, m );
      const p = new THREE.Vector3().setFromMatrixPosition( m );
      eng.nav.lookAtUnity( [p.x + 14, p.y + 7, -p.z - 14], [p.x, p.y + 3, -p.z] );
      await sleep( 1500 );
      await ipc.writeBinary( joinPath( dir, "map-trees.png" ), await eng.pictures.capture() );
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
