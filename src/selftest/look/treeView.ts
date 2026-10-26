import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/treeview ): a map with the game's trees ( map.jbrproj in the folder ) drawn.
**/
export async function treeViewSelftest( dir: string ) {
  try {
    await openProject( joinPath( dir, "map.jbrproj" ) );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await sleep( 4000 );
    let n = 0;
    eng.scene.traverse( ( o ) => {
      if ( ( o as THREE.InstancedMesh ).isInstancedMesh ) n += ( o as THREE.InstancedMesh ).count;
    } );
    log( `trees drawn: ${n}` );
    const g = ( x: number, z: number ) => terrain.heightAt( x, z );
    eng.nav.lookAtUnity( [0, g( 0, -150 ) + 60, -150], [0, g( 0, 100 ), 100] );
    await sleep( 2500 );
    log( "SHOT treeview" );
    await sleep( 2500 );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
