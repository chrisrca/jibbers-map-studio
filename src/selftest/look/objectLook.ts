import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/objlook, the map to import named in the folder's map.txt ): a map's game objects
 * ( its features: rails, snow cannons… ) drawn with the game's look for their settings — each object's look, its size
 * and place against the placeholder it stands in for, and views of a snow cannon and a rail left in the folder.
**/
export async function objectLookSelftest( dir: string ) {
  try {
    const { importMap } = await import( "../../map/project" );
    const mapPath       = ( await ipc.readText( joinPath( dir, "map.txt" ) ) ).trim();
    await importMap( mapPath, joinPath( dir, `objlook-${Date.now()}.jbrproj` ) );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    await sleep( 1500 );
    const t0 = performance.now();
    log( `asked directly: rail_long blue -> ${await ipc.gameObjectLook( "rail_long", { color: "blue" } ).catch( ( e ) => `error ${e}` )} (${( ( performance.now() - t0 ) / 1000 ).toFixed( 1 )} s)` );
    type LookSet = { template: THREE.Mesh[] | null; meshes: THREE.InstancedMesh[] };
    const R      = eng.objectsR.looks as unknown as { lookOf: Map<string, string>; lookSets: Map<string, LookSet> };
    await waitFor( () => [...R.lookSets.values()].some( ( l ) => l.template ), "a game look", 180000 ).catch( () => null );
    await eng.objectsR.settled;
    await sleep( 500 );
    const objs = useEditor.getState().objects;
    const byId = new Map<string, { n: number; looked: number; size: string; off: number }>();
    for ( const o of objs ) {
      const set = R.lookSets.get( R.lookOf.get( o.uid ) ?? "" ), m = eng.objectsR.objectMesh( o.uid )!;
      const e   = byId.get( o.id ) ?? { n: 0, looked: 0, size: "", off: 0 };
      e.n++;
      if ( set?.template && !m.visible ) {
        e.looked++;
        const at = new THREE.Matrix4().compose( m.position, m.quaternion, m.scale.clone().multiplyScalar( 2 ) );
        const a  = new THREE.Box3();
        for ( const t of set.template ) {
          t.geometry.computeBoundingBox();
          a.union( t.geometry.boundingBox!.clone().applyMatrix4( new THREE.Matrix4().multiplyMatrices( at, t.matrixWorld ) ) );
        }
        const b  = new THREE.Box3().setFromObject( m, true );
        const sa = a.getSize( new THREE.Vector3() ), sb = b.getSize( new THREE.Vector3() );
        e.size   = `${sa.x.toFixed( 1 )}x${sa.y.toFixed( 1 )}x${sa.z.toFixed( 1 )} vs ${sb.x.toFixed( 1 )}x${sb.y.toFixed( 1 )}x${sb.z.toFixed( 1 )}`;
        e.off    = Math.max( e.off, a.getCenter( new THREE.Vector3() ).distanceTo( b.getCenter( new THREE.Vector3() ) ) );
      }
      byId.set( o.id, e );
    }
    for ( const [id, e] of byId ) log( `${id}: ${e.looked}/${e.n} with the game's look; look ${e.size || "-"} (placeholder after "vs"), centres ${e.off.toFixed( 2 )} m apart` );
    log( `instanced meshes: ${[...R.lookSets.values()].reduce( ( n, l ) => n + l.meshes.length, 0 )} for ${objs.length} objects` );
    const shot = async ( id: string, name: string ) => {
      const o = objs.find( ( x ) => x.id === id );
      if ( !o ) return;
      const [x, y, z] = o.position;
      eng.nav.lookAtUnity( [x + 5, y + 3, z - 5], [x, y + 1, z] );
      await sleep( 1500 );
      await ipc.writeBinary( joinPath( dir, `${name}.png` ), await eng.pictures.capture() );
    };
    await shot( "snowcannon", "snowcannon" );
    await shot( "rail_long",  "rail"       );
    await shot( "floodlight", "floodlight" );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
