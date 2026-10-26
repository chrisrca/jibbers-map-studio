import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject, saveProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/rocks ): a copy of a real-world map with surroundings ( map.jbrproj in the folder ):
 * they open locked ( clicked through in the viewport ), and are painted again with rock from other angles ( and back
 * with undo ). Views of the surroundings at each angle are left in the folder.
**/
export async function rocksSelftest( dir: string ) {
  try {
    const { isScenery      } = await import( "../../core/types"        );
    const { repaintScenery } = await import( "../../geo/scenery/inner" );
    await openProject( joinPath( dir, "map.jbrproj" ) );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    const sc = useEditor.getState().customObjects.find( isScenery );
    if ( !sc ) throw new Error( "no surroundings in the map" );
    log( `surroundings locked on opening: ${!!useEditor.getState().locked[sc.uid]}` );
    await eng.customR.settled;
    await sleep( 1500 );
    const g = ( x: number, z: number ) => terrain.heightAt( x, z );
    const b = terrain.bounds();
    // from over the play area's south edge, looking out across the surroundings
    eng.nav.lookAtUnity( [0, g( 0, b.z0 + 50 ) + 400, b.z0 + 50], [0, g( 0, b.z0 ) - 200, b.z0 - 3000] );
    await sleep( 800 );
    // a click on the surroundings: what it picks, unlocked and locked
    const pick                        = ( x: number, y: number ) => ( eng as unknown as { pickObject( x: number, y: number ): { uid: string } | null } ).pickObject( x, y );
    const host                        = eng.renderer.domElement;
    let spot: [number, number] | null = null;
    useEditor.getState().setLocked( [sc.uid], false );
    for ( let j = 1; j < 12 && !spot; j++ )
      for ( let i = 1; i < 16 && !spot; i++ ) {
        const x = ( i / 16 ) * host.clientWidth, y = ( j / 12 ) * host.clientHeight;
        if ( pick( x, y )?.uid === sc.uid ) spot = [x, y];
      }
    log( `unlocked: a click picks the surroundings ${spot ? `(at ${spot.map( ( v ) => v.toFixed( 0 ) ).join( ", " )})` : "nowhere (FAIL)"}` );
    useEditor.getState().setLocked( [sc.uid], true );
    if ( spot ) log( `locked: the same click picks ${pick( spot[0], spot[1] )?.uid ?? "nothing"}` );

    const shot = async ( name: string ) => {
      await eng.customR.settled;
      await sleep( 1200 );
      const png = await eng.pictures.capture();
      await ipc.writeBinary( joinPath( dir, `${name}.png` ), png );
    };
    await shot( "rocks-before" );
    for ( const angle of [12, 45] ) {
      const t0 = performance.now();
      await repaintScenery( sc.uid, angle );
      eng.customR.reloadLibrary();
      const now = useEditor.getState().customObjects.find( ( o ) => o.uid === sc.uid )!;
      log( `rocks from ${angle}: painted in ${( ( performance.now() - t0 ) / 1000 ).toFixed( 1 )} s; texture ${now.parts[0].materials[0].base_tex} (inner part: ${now.parts.find( ( p ) => p.mesh.endsWith( "/inner" ) )?.materials[0].base_tex})` );
      await shot( `rocks-${angle}` );
    }
    history.undo();
    const back = useEditor.getState().customObjects.find( ( o ) => o.uid === sc.uid )!;
    log( `undone: texture ${back.parts[0].materials[0].base_tex}, rock angle ${back.scenery?.rockAngle}` );
    await shot( "rocks-undone" );
    await saveProject();
    const r = await ipc.exportProject( joinPath( dir, "map.jbrproj" ), joinPath( dir, "rocks.jbrmap" ) );
    log( `exported: ${JSON.stringify( r )}` );
    log( "SELFTEST OK"                      );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
