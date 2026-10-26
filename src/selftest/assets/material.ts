import { LAYOUTS } from "../../terrain/generate";
import * as THREE from "three/webgpu";
import { feature, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { loadLibrary, placeEntry } from "../../pieces/library";
import { newProject, saveProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/material ): a texture put on a placed rail, its material panel and the look.
**/
export async function materialSelftest( dir: string ) {
  try {
    const proj = joinPath( dir, `material-${Date.now()}.jbrproj` );
    await newProject( proj, "Material", { layout: LAYOUTS[0], base: "flat", slopeDeg: 0, heightRange: 100, seed: 1 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await loadLibrary();
    const g = ( x: number, z: number ) => terrain.heightAt( x, z );
    await placeEntry( feature( "rail_long" ), [0, g( 0, 0 ), 0], [0, 0, 0] );
    const o  = useEditor.getState().customObjects[useEditor.getState().customObjects.length - 1];
    // a striped, scuffed image, made here
    const cv = document.createElement( "canvas" );
    cv.width = cv.height = 256;
    const cx = cv.getContext( "2d" )!;
    for ( let k = 0; k < 16; k++ ) {
      cx.fillStyle = k % 2 ? "#c0392b" : "#f1c40f";
      cx.fillRect( k * 16, 0, 16, 256 );
    }
    for ( let k = 0; k < 300; k++ ) {
      cx.fillStyle = `rgba(80,80,80,${Math.random() * 0.5})`;
      cx.fillRect( Math.random() * 256, Math.random() * 256, 2 + Math.random() * 10, 1 + Math.random() * 2 );
    }
    const png  = new Uint8Array( await ( await new Promise<Blob>( ( r ) => cv.toBlob( ( b ) => r( b! ), "image/png" ) ) ).arrayBuffer() );
    const file = joinPath( dir, "stripes.png" );
    await ipc.writeBinary( file, png );
    const key = await ipc.addTextureToProject( proj, file, false );
    useEditor.setState( { library: "assets/library.jbrmap" } );
    eng.customR.reloadLibrary();
    useEditor.setState( ( s ) => ( {
      customObjects: s.customObjects.map( ( c ) =>
        c.uid === o.uid ? { ...c, parts: c.parts.map( ( p ) => ( { ...p, materials: p.materials.map( ( m ) => ( { ...m, base_tex: key, base_color: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0.5, smoothness: 0.6, tiling: { x: 4, y: 1 } } ) ) } ) ) } : c,
      ),
    } ) );
    useEditor.getState().setSelection( [{ kind: "custom", uid: o.uid }] );
    await saveProject();
    const saved = JSON.parse( await ipc.readText( joinPath( proj, "project.json" ) ) );
    const sm    = saved.customObjects?.[0]?.parts?.[0]?.materials?.[0];
    log( `texture ${key}; saved material: base_tex ${sm?.base_tex === key}, metallic ${sm?.metallic}, smoothness ${sm?.smoothness}, tiling ${JSON.stringify( sm?.tiling )}` );
    eng.nav.lookAtUnity( [2.5, g( 2.5, -3 ) + 2.2, -3], [0, g( 0, 0 ) + 0.4, 0] );
    await sleep( 3000 );
    eng.scene.traverse( ( m ) => {
      const mesh = m as THREE.Mesh;
      if ( !mesh.isMesh || mesh.userData?.uid !== o.uid ) return;
      const uv = mesh.geometry.getAttribute( "uv" );
      let lo   = Infinity, hi = -Infinity;
      for ( let k = 0; k < ( uv?.count ?? 0 ); k++ ) { lo = Math.min( lo, uv.getX( k ) ); hi = Math.max( hi, uv.getX( k ) ); }
      const mats = ( Array.isArray( mesh.material ) ? mesh.material : [mesh.material] ) as THREE.MeshStandardNodeMaterial[];
      log( `part ${mesh.userData.partIndex}: ${uv?.count} uvs, u ${lo.toFixed( 2 )}..${hi.toFixed( 2 )}; materials ${mats.map( ( x ) => `${x.map ? "textured" : "plain"} metal ${x.metalness}` ).join( ", " )}` );
    } );
    log( "SHOT material" );
    await sleep( 2500 );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
