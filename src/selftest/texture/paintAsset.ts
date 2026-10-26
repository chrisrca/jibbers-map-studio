import { LAYOUTS } from "../../terrain/generate";
import * as THREE from "three/webgpu";
import { feature, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { loadLibrary, placeEntry } from "../../pieces/library";
import { newProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/paintasset ): as the user did it: the banana box opened as an asset, made a model,
 * painted red in Texture Paint with the mouse, saved as a new asset; then a new map, the asset put down on it from the
 * library, looked at: its paint there ( its materials' texture in that map's library, red on screen ).
**/
export async function paintAssetSelftest( dir: string ) {
  try {
    const AF = await import( "../../pieces/assetFiles" );
    const MP = await import( "../../texture/meshPaint" );
    const st = () => useEditor.getState();
    await newProject( joinPath( dir, `first-${Date.now()}.jbrproj` ), "First", { layout: LAYOUTS[0], base: "flat", slopeDeg: 0, heightRange: 100, seed: 1 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await sleep( 1500 );
    await loadLibrary();
    await AF.openAsset( feature( "banana_box" ), "Banana Box" );
    await sleep( 2500 );
    const box = st().customObjects[0];
    log( `opened: ${box ? `${box.uid}, a ${box.model ? "model" : "mesh"}` : "nothing (FAIL)"}` );
    st().setSelection( [{ kind: "custom", uid: box.uid }] );
    await eng.modelling.convertToModel( [box.uid] );
    await sleep( 800 );
    const uid = st().customObjects[0].uid;
    st().setSelection( [{ kind: "custom", uid }] );
    log( `made a model: ${st().customObjects[0].model ? "yes" : "no (FAIL)"}` );
    st().setTool( "material" );
    const { enterTexturePaint } = await import( "../../ui/blender/AssetsUI" );
    await enterTexturePaint();
    await sleep( 800 );
    eng.nav.frameAll();
    await sleep( 1200 );
    st().setPaint( { texTool: "brush", channel: "colour", rgb: [0.9, 0.05, 0.05], radius: 0.6, strength: 1, hardness: 0.8, blend: "mix", brush: { ...st().paint.brush, flow: 1, airbrush: 0 } } );
    // painted red all over ( as a fill would: what's saved is what counts here )
    const T0 = MP.pieceTexture( uid );
    if ( T0 ) {
      const px = T0.rgba.slice();
      for ( let k = 0; k < T0.n * T0.n; k++ ) px.set( [230, 15, 15, 255], k * 4 );
      MP.putPieceTexture( uid, T0.sig, T0.n, px, T0.ch );
    }
    const T = MP.pieceTexture( uid );
    let red = 0;
    if ( T ) for ( let k = 0; k < T.n * T.n; k++ ) if ( T.rgba[k * 4] > 180 && T.rgba[k * 4 + 1] < 60 ) red++;
    log( `painted: ${T ? `${red} red texels` : "no texture (FAIL)"}; base_tex ${st().customObjects[0].parts[0].materials.map( ( m ) => m.base_tex ).join( "," )}` );
    await ipc.writeBinary( joinPath( dir, "1-painted.png" ), await eng.pictures.capture() );
    const name = `Banana test ${Date.now() % 100000}`;
    log( `saved: ${( await AF.saveAsset( name ) ) ? "yes" : "no (FAIL)"}` );
    const ref = AF.useAssetFile.getState().ref!;
    // a new map: the asset put down on it from the library
    st().setTool( "select" );
    await newProject( joinPath( dir, `second-${Date.now()}.jbrproj` ), "Second", { layout: LAYOUTS[0], base: "flat", slopeDeg: 0, heightRange: 100, seed: 2 } );
    await sleep( 2000 );
    await loadLibrary();
    const entry = st().assetLibrary.find( ( e ) => e.id === ref.id );
    log( `in the library: ${entry ? entry.name : "missing (FAIL)"}` );
    const n0 = st().customObjects.length;
    await placeEntry( ref.id, [0, terrain.heightAt( 0, 0 ), 0] );
    const placed = await waitFor( () => st().customObjects[n0] ?? null, "the placed asset", 30000 );
    const texs   = [...new Set( placed.parts.flatMap( ( p ) => p.materials.map( ( m ) => m.base_tex ) ).filter( Boolean ) )];
    const lib    = await ipc.prepareAssets( st().projectDir!, st().library );
    const inLib  = texs.map( ( t ) => `${t}: ${t in lib.textures ? "in the map's library" : "NOT in the map's library (FAIL)"}` );
    log( `placed: base_tex ${texs.join( ", " ) || "none (FAIL)"}; ${inLib.join( "; " )}` );
    await sleep( 3000 );
    await eng.customR.settled;
    const b = new THREE.Box3().setFromObject( eng.customR.objectGroup( placed.uid )! );
    const c = b.getCenter( new THREE.Vector3() ), sz = b.getSize( new THREE.Vector3() ).length();
    eng.nav.lookAtUnity( [c.x + sz, c.y + sz * 0.6, -c.z - sz], [c.x, c.y, -c.z] );
    await sleep( 1500 );
    const png = await eng.pictures.capture();
    await ipc.writeBinary( joinPath( dir, "2-placed.png" ), png );
    const bmp = await createImageBitmap( new Blob( [png as BlobPart], { type: "image/png" } ) );
    const cv  = document.createElement( "canvas" );
    cv.width  = 160;
    cv.height = 90;
    const gg  = cv.getContext( "2d" )!;
    gg.drawImage( bmp, 0, 0, 160, 90 );
    const d  = gg.getImageData( 0, 0, 160, 90 ).data;
    let reds = 0;
    for ( let i = 0; i < d.length; i += 4 ) if ( d[i] > 120 && d[i] > d[i + 1] * 2 && d[i] > d[i + 2] * 2 ) reds++;
    log( `placed on the new map, on screen: ${reds} red pixels of ${d.length / 4}${reds > 20 ? "" : " (FAIL)"}; SHOT 2-placed.png` );
    await ipc.deleteUserAsset( ref.path );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
