import { LAYOUTS } from "../../terrain/generate";
import * as THREE from "three/webgpu";
import { arr3 } from "../../core/types";
import { deltaBetween, transformCustom } from "../../core/transform";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { loadLibrary, placeEntry } from "../../pieces/library";
import { log, sleep, waitFor } from "../harness";
import { newProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/allfeatures ): every feature from the library, placed alone and pictured close.
**/
export async function allFeaturesSelftest( dir: string ) {
  try {
    const proj = joinPath( dir, `all-${Date.now()}.jbrproj` );
    await newProject( proj, "All features", { layout: LAYOUTS[0], base: "flat", slopeDeg: 0, heightRange: 100, seed: 1 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await loadLibrary();
    const g    = terrain.heightAt( 0, 0 );
    const list = useEditor.getState().assetLibrary.filter( ( e ) => e.kind === "mesh" && e.folder.startsWith( "Features/" ) );
    for ( const e of list ) {
      useEditor.setState( { customObjects: [], selection: [] } );
      await placeEntry( e.id, [0, g, 0], [0, 0, 0] );
      const o = useEditor.getState().customObjects[0];
      if ( !o ) continue;
      await eng.customR.settled;
      await sleep( 600 );
      let grp = eng.customR.objectGroup( o.uid );
      if ( !grp ) continue;
      // its bottom on the ground ( pivots are often part way up )
      const lift = g - new THREE.Box3().setFromObject( grp ).min.y;
      const cur  = { pos: arr3( o.position ), rot: arr3( o.rotation ), scl: arr3( o.scale ) };
      const up   = transformCustom( o, deltaBetween( cur, { ...cur, pos: [cur.pos[0], cur.pos[1] + lift, cur.pos[2]] } ) );
      // nothing selected: no grind line or collider shells over it
      useEditor.setState( { customObjects: [up], selection: [] } );
      await eng.customR.settled;
      await sleep( 400 );
      grp = eng.customR.objectGroup( o.uid );
      if ( !grp ) continue;
      const box = new THREE.Box3().setFromObject( grp );
      const c   = box.getCenter( new THREE.Vector3() ), r = box.getSize( new THREE.Vector3() ).length() / 2;
      // a three-quarter view from above, from the side the sun lights ( three's coordinates: z mirrored )
      eng.nav.lookAtUnity( [c.x - r * 1.2, c.y + r * 0.8, -c.z + r * 0.9], [c.x, c.y, -c.z] );
      await sleep( 500 );
      await ipc.writeBinary( joinPath( dir, `${e.id.startsWith( "game:" ) ? "g" : "a"}-${e.name}.png` ), await eng.pictures.capture() );
    }
    log( `pictured ${list.length} features` );
    log( "SELFTEST OK"                      );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
