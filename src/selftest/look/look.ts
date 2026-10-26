import { arr3 } from "../../core/types";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/look ): a copy of a map ( map.jbrproj in the folder ) with the piece named in
 * look.txt selected and looked at from around it, with its grind guide — a SHOT from each side.
**/
export async function lookSelftest( dir: string ) {
  try {
    const name = ( await ipc.readText( joinPath( dir, "look.txt" ) ) ).trim();
    await openProject( joinPath( dir, "map.jbrproj" ) );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    const st = useEditor.getState;
    const o  = await waitFor( () => st().customObjects.find( ( x ) => x.parts[0]?.mesh.includes( name ) ), name );
    useEditor.setState( { selection: [{ kind: "custom", uid: o.uid }] } );
    const c = arr3( o.position );
    const d = 6 * Math.abs( o.scale.x );
    for ( const [i, a] of [0, 90, 180, 270].entries() ) {
      const r = ( a * Math.PI ) / 180;
      eng.nav.lookAtUnity( [c[0] + Math.sin( r ) * d, c[1] + d * 0.4, c[2] + Math.cos( r ) * d], c );
      await sleep( 1500 );
      log( `SHOT look${i}` );
      await sleep( 3000 );
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
