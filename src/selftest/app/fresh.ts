import { LAYOUTS } from "../../terrain/generate";
import * as THREE from "three/webgpu";
import { feature, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { newProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/fresh ), meant with an empty data folder ( a new user ): a new map, a few of the
 * game's features placed from the library as a person would, what each is drawn with logged ( its parts' materials
 * and textures, and what the 3D view built ), and a view of them left in the folder.
**/
export async function freshSelftest( dir: string ) {
  try {
    const { loadLibrary, placeEntry } = await import( "../../pieces/library" );
    const info                        = await ipc.appInfo();
    log( `data folder: ${info.dataDir}` );
    const proj = joinPath( dir, `fresh-${Date.now()}.jbrproj` );
    await newProject( proj, "Fresh", { layout: LAYOUTS[0], base: "slope", slopeDeg: 6, heightRange: 1200, seed: 3 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await loadLibrary();
    const lib      = useEditor.getState().assetLibrary;
    const byPrefix = ( p: string ) => lib.filter( ( e ) => e.id.startsWith( p ) && e.kind === "mesh" ).length;
    log( `library: ${lib.length} entries (game: ${byPrefix( "game:" )}, app: ${byPrefix( "app:" )}, user: ${byPrefix( "user:" )})` );
    log( `snow cannons: ${lib.filter( ( e ) => /snowcannon/i.test( e.name ) ).map( ( e ) => e.name ).join( ", " )}`                );
    // ( the features to place: the folder's ids.txt, one a line, when there is one )
    const listed = ( await ipc.readText( joinPath( dir, "ids.txt" ) ).catch( () => "" ) ).split( /\s+/ ).filter( Boolean );
    const ids    = listed.length ? listed : ["tube_long", "flat_box", "c_rail", "snowcannon", "kicker_medium"];
    for ( const [k, id] of ids.entries() ) {
      const eid = feature( id );
      if ( eid.startsWith( "missing" ) ) {
        log( `${id}: not in the library` );
        continue;
      }
      const x = k * 7;
      await placeEntry( eid, [x, terrain.heightAt( x, 0 ), 0] );
      const o = useEditor.getState().customObjects[useEditor.getState().customObjects.length - 1];
      await eng.customR.settled;
      await sleep( 300 );
      const g    = eng.customR.objectGroup( o.uid );
      const mats = ( g?.children ?? [] ).flatMap( ( m ) => [( m as THREE.Mesh ).material].flat() ) as THREE.MeshStandardNodeMaterial[];
      log( `${id} (${eid.split( ":" )[0]}): ${o.parts.length} parts; textures ${[...new Set( o.parts.flatMap( ( p ) => p.materials.map( ( m ) => m.base_tex || "-" ) ) )].join( ", " )}; drawn ${g?.children.length ?? 0} meshes, maps ${mats.filter( ( m ) => m.map ).length}/${mats.length}, colours ${[...new Set( mats.map( ( m ) => "#" + m.color.getHexString() ) )].join( " " )}` );
    }
    eng.nav.lookAtUnity( [14, terrain.heightAt( 14, -16 ) + 7, -16], [14, terrain.heightAt( 14, 0 ), 0] );
    await sleep( 2000 );
    await ipc.writeBinary( joinPath( dir, "fresh-features.png" ), await eng.pictures.capture() );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
