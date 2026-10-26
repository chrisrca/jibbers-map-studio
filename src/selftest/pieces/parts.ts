import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/parts ): a copy of a map with rails ( map.jbrproj in the folder ): their pieces'
 * visible parts get their own colliders on opening; what each got is logged and written to parts.json ( piece
 * coordinates ) to be drawn over the meshes.
**/
export async function partsSelftest( dir: string ) {
  try {
    await openProject( joinPath( dir, "map.jbrproj" ) );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    const st     = useEditor.getState;
    const railed = () => st().customObjects.filter( ( o ) => o.rail && o.rail.points.length >= 2 && o.rail.solid !== false );
    await waitFor( () => railed().length > 0 && railed().every( ( o ) => o.rail!.parts ), "parts fitted", 60000 );
    const dump: unknown[] = [];
    for ( const o of railed() ) {
      const parts   = o.rail!.parts!;
      const caps    = parts.filter( ( c ) => c.shape === "Capsule" ).length;
      const biggest = Math.max( 0, ...parts.filter( ( c ) => c.shape === "Box" ).map( ( c ) => Math.min( c.size.x, c.size.y, c.size.z ) ) );
      log( `${o.parts[0].mesh.split( "/" )[1]}: ${o.rail!.whole ? "whole piece, " : ""}${parts.length} parts (${caps} capsules, ${parts.length - caps} boxes; thickest box ${( biggest * 100 ).toFixed( 0 )} cm); ${o.colliders.length} colliders in all` );
      dump.push( { mesh: o.parts[0].mesh, scale: o.scale, rail: o.rail!.points, radius: o.rail!.radius, parts } );
    }
    await ipc.writeText( joinPath( dir, "parts.json" ), JSON.stringify( dump ) );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
