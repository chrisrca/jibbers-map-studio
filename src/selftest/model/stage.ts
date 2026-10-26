import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/stage ): a project in the folder ( a copy ): the Modelling workspace's stage with a
 * cube on it, from above and from low down; views left in the folder.
**/
export async function stageSelftest( dir: string ) {
  try {
    const { newModelObject } = await import( "../../model/objects" );
    const { primitive      } = await import( "../../model/mesh"    );
    const proj               = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st = () => useEditor.getState();
    const g  = terrain.heightAt( 30, 30 );
    log( `tool at open: ${st().tool}, stage ${eng.stage.shown ? `shown at ${eng.stage.at.y.toFixed( 2 )}` : "hidden"}` );
    const o = newModelObject( "stagecube", primitive( "cube" ), [30, g + 1, 30] );
    st().addCustom( o );
    useEditor.setState( { selection: [{ kind: "custom", uid: "stagecube" }] } );
    st().setTool( "model" );
    await sleep( 1500 );
    log( `stage at y ${eng.stage.at.y.toFixed( 2 )} (cube's bottom ${g.toFixed( 2 )}), shown ${eng.stage.shown}` );
    const grp = eng.customR.objectGroup( "stagecube" );
    if ( grp ) {
      grp.updateMatrixWorld( true );
      const b = new THREE.Box3().expandByObject( grp );
      log( `cube group: ${grp.children.length} children (${grp.children.map( ( c ) => `${c.type}:${c.name}` ).join( ", " )}), box y ${b.min.y.toFixed( 2 )}..${b.max.y.toFixed( 2 )}` );
    }
    eng.nav.lookAtUnity( [30 - 6, g + 4, 30 - 6], [30, g + 0.5, 30] );
    await sleep( 800 );
    await ipc.writeBinary( joinPath( dir, "stage-1.png" ), await eng.pictures.capture() );
    eng.nav.lookAtUnity( [30 - 5, g + 1.2, 30 - 5], [30, g + 1.4, 30] );
    await sleep( 800 );
    await ipc.writeBinary( joinPath( dir, "stage-2-low.png" ), await eng.pictures.capture() );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
