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
    // ( the trees are features and pieces now: the map's own drawn as its pieces are )
    const pieces = st().customObjects.filter( ( o ) => o.tree ), objects = st().objects.filter( ( o ) => o.tree );
    log( `as features: ${objects.length}, as pieces: ${pieces.length}` );
    const t0     = performance.now();
    const drawn  = () => pieces.filter( ( o ) => ( eng.customR.objectGroup( o.uid )?.children.length ?? 0 ) > 0 ).length;
    while ( performance.now() - t0 < 180000 && drawn() < pieces.length ) await sleep( 250 );
    log( `the map's own trees drawn: ${drawn()} of ${pieces.length}, after ${( ( performance.now() - t0 ) / 1000 ).toFixed( 1 )} s` );
    // looking at the first one
    const first = pieces[0] ? new THREE.Vector3( pieces[0].position.x, pieces[0].position.y, pieces[0].position.z ) : objects[0] ? new THREE.Vector3( ...objects[0].position ) : null;
    if ( first ) {
      const p = first;
      eng.nav.lookAtUnity( [p.x + 14, p.y + 7, p.z - 14], [p.x, p.y + 3, p.z] );
      await sleep( 1500 );
      await ipc.writeBinary( joinPath( dir, "map-trees.png" ), await eng.pictures.capture() );
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
