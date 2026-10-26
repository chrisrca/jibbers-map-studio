import { LAYOUTS } from "../../terrain/generate";
import * as THREE from "three/webgpu";
import { toThree } from "../../core/coords";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { newProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/place ): place library pieces on a brand-new map, check they appear.
**/
export async function placeSelftest( dir: string ) {
  try {
    const { loadLibrary, placeEntry } = await import( "../../pieces/library" );
    const proj                        = joinPath( dir, `place-${Date.now()}.jbrproj` );
    await newProject( proj, "Place", { layout: LAYOUTS[0], base: "slope", slopeDeg: 10, heightRange: 1200, seed: 3 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await loadLibrary();
    const meshes = useEditor.getState().assetLibrary.filter( ( e ) => e.kind === "mesh" );
    log( `library: ${meshes.length} meshes` );
    const picks = [meshes.find( ( e ) => e.id.includes( "banana_box" ) ), meshes.find( ( e ) => e.folder.startsWith( "Melon" ) ), meshes[5]].filter( Boolean );
    for ( const [k, e] of picks.entries() ) {
      const before          = useEditor.getState().customObjects.length;
      const x               = k * 6;
      // as the viewport places it: the ghost measured, then turned/tilted/lifted onto the ground
      const { entryObject } = await import( "../../ui/previews" );
      eng.placing.setLibraryGhost( await entryObject( e! ) );
      const pl = eng.placing.libraryPlacement( toThree( [x, terrain.heightAt( x, 0 ), 0] ) );
      eng.placing.setLibraryGhost( null );
      await placeEntry( e!.id, pl.pos, pl.rot );
      const o   = useEditor.getState().customObjects[before];
      const t0  = performance.now();
      let parts = 0;
      while ( performance.now() - t0 < 8000 ) {
        await eng.customR.settled;
        parts = eng.customR.objectGroup( o.uid )?.children.length ?? 0;
        if ( parts ) break;
        await sleep( 100 );
      }
      log( `placed ${e!.name}: ${parts} part(s) shown after ${( performance.now() - t0 ).toFixed( 0 )} ms (object has ${o.parts.length} parts)` );
      // underside vs the ground at its corners ( world bounding box, three.js coords )
      const grp = eng.customR.objectGroup( o.uid );
      if ( grp ) {
        grp.updateMatrixWorld( true );
        const box  = new THREE.Box3().setFromObject( grp );
        const gaps = [[box.min.x, box.min.z], [box.max.x, box.min.z], [box.min.x, box.max.z], [box.max.x, box.max.z]].map( ( [tx, tz] ) => {
          // lowest point of the piece near that corner vs the ground there
          return terrain.heightAt( tx, -tz );
        } );
        log( `  bottom ${box.min.y.toFixed( 2 )} · ground under its corners ${gaps.map( ( v ) => v.toFixed( 2 ) ).join( " " )} · rot ${pl.rot.map( ( v ) => v.toFixed( 1 ) ).join( "," )}` );
      }
    }
    const { spawnOnGround } = await import( "../../viewport/engine/placing" );
    const sp                = spawnOnGround( [20, terrain.heightAt( 20, 0 ), 0], [0, 0, 1] );
    log( `spawn: ${( sp.position[1] - terrain.heightAt( 20, 0 ) ).toFixed( 2 )} m above ground, pitch ${sp.rotation[0].toFixed( 1 )}°, velocity ${sp.velocity.map( ( v ) => v.toFixed( 2 ) ).join( "," )}` );
    eng.nav.lookAtUnity( [6, terrain.heightAt( 6, -15 ) + 6, -15], [6, terrain.heightAt( 6, 0 ), 0] );
    await sleep( 800 );
    await ipc.writeBinary( joinPath( dir, "placed.png" ), await eng.pictures.capture() );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
