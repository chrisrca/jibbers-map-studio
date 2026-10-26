import type { CustomObjectEntry } from "../../core/types";
import * as THREE from "three/webgpu";
import { encodePng } from "../../core/png";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject, saveProject } from "../../map/project";
import { placeEntry } from "../../pieces/library";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/texpaint ): a project in the folder ( a copy ): a modelled cube painted in the
 * Material workspace's Texture Paint with the mouse, worn, its shape changed ( the paint carried across ), exported and
 * opened again; views left in the folder.
**/
export async function texPaintSelftest( dir: string ) {
  try {
    const MP                        = await import( "../../texture/meshPaint" );
    const { newModelObject }        = await import( "../../model/objects"     );
    const { primitive, faceNormal } = await import( "../../model/mesh"        );
    const { extrudeFaces }          = await import( "../../model/ops"         );
    const { withModel }             = await import( "../../model/objects"     );
    const proj                      = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st                   = () => useEditor.getState();
    const g                    = ( x: number, z: number ) => terrain.heightAt( x, z );
    const at: [number, number] = [30, 30];
    st().setTool( "material" );
    const o0 = newModelObject( "paintcube", primitive( "cube" ), [at[0], g( at[0], at[1] ) + 1, at[1]] );
    st().addCustom( o0 );
    eng.nav.lookAtUnity( [at[0] - 3.2, g( at[0], at[1] ) + 3.4, at[1] - 3.2], [at[0], g( at[0], at[1] ) + 1, at[1]] );
    await sleep( 1200 );
    log( `stage: ${eng.stage.shown ? "shown" : "missing (FAIL)"} at y ${eng.stage.at.y.toFixed( 2 )}, terrain ${eng.terrainR.group.visible ? "showing (FAIL)" : "hidden"}, pieces shown ${eng.customR.pickables().length}` );
    const { enterTexturePaint } = await import( "../../ui/blender/AssetsUI" );
    await enterTexturePaint();
    st().setPaint( { rgb: [0.85, 0.08, 0.08], radius: 0.12, strength: 1, hardness: 0.8, blend: "mix", brush: { ...st().paint.brush, flow: 1, airbrush: 0 } } );
    const canvas = eng.renderer.domElement, r = canvas.getBoundingClientRect();
    const frame  = () => new Promise<number>( ( res ) => requestAnimationFrame( res ) );
    const pt     = ( type: string, x: number, y: number ) => {
      const init = { clientX: r.left + x, clientY: r.top + y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 16, bubbles: true };
      if ( type === "pointerup" ) window.dispatchEvent( new PointerEvent( type, init ) );
      else canvas.dispatchEvent( new PointerEvent( type, init ) );
    };
    // across the cube's top and down its front, as on screen
    const scr = ( x: number, y: number, z: number ) => {
      const v = new THREE.Vector3( x, y, -z ).project( eng.camera );
      return [( v.x * 0.5 + 0.5 ) * r.width, ( -v.y * 0.5 + 0.5 ) * r.height];
    };
    const y0                       = g( at[0], at[1] ) + 1;
    const path: [number, number][] = [];
    for ( let k = 0; k <= 30; k++ ) path.push( scr( at[0] - 0.8 + ( 1.6 * k ) / 30, y0 + 1,                      at[1]     ) as [number, number] );
    for ( let k = 0; k <= 30; k++ ) path.push( scr( at[0] - 0.5,                    y0 + 0.9 - ( 1.6 * k ) / 30, at[1] - 1 ) as [number, number] );
    const from = performance.now();
    pt( "pointerdown", ...path[0] );
    for ( const p of path.slice( 1 ) ) {
      pt( "pointermove", ...p );
      await frame();
    }
    pt( "pointerup", ...path[path.length - 1] );
    const gaps = eng.frameStamps.filter( ( t ) => t >= from ).slice( 1 ).map( ( v, i, a ) => v - ( i ? a[i - 1] : v ) );
    const T    = MP.pieceTexture( "paintcube" );
    let red    = 0;
    if ( T ) for ( let k = 0; k < T.n * T.n; k++ ) if ( T.rgba[k * 4] > 180 && T.rgba[k * 4 + 1] < 60 ) red++;
    log( `painted: ${T ? `${T.n} px texture, ${red} red texels` : "no texture (FAIL)"}; worst frame ${Math.max( 0, ...gaps ).toFixed( 0 )} ms; base_tex ${st().customObjects.find( ( o ) => o.uid === "paintcube" )!.parts[0].materials[0].base_tex}` );
    await sleep( 600 );
    await ipc.writeBinary( joinPath( dir, "material-1-painted.png" ), await eng.pictures.capture() );
    const piece = () => st().customObjects.find( ( o ) => o.uid === "paintcube" )! as CustomObjectEntry & { model: NonNullable<CustomObjectEntry["model"]> };
    const W     = await import( "../../texture/weathering" );
    let t0      = performance.now();
    W.edgeWear( piece(), { ...W.DEFAULT_EDGE_WEAR, width: 0.12, amount: 0.9, top: 0.5 } );
    log( `edge wear: ${( performance.now() - t0 ).toFixed( 0 )} ms` );
    t0 = performance.now();
    W.scratches( piece(), W.DEFAULT_SCRATCHES );
    log( `scratches: ${( performance.now() - t0 ).toFixed( 0 )} ms` );
    t0 = performance.now();
    W.dirt( piece(), W.DEFAULT_DIRT );
    log( `dirt: ${( performance.now() - t0 ).toFixed( 0 )} ms` );
    await sleep( 600 );
    await ipc.writeBinary( joinPath( dir, "material-2-worn.png" ), await eng.pictures.capture() );
    // Fill: the top's unpainted part, blue
    const Tt    = MP.pieceTexture( "paintcube" )!;
    const blues = () => {
      let b = 0;
      for ( let k = 0; k < Tt.n * Tt.n; k++ ) if ( Tt.rgba[k * 4 + 2] > 180 && Tt.rgba[k * 4] < 60 ) b++;
      return b;
    };
    st().setPaint( { texTool: "fill", rgb: [0.05, 0.1, 0.9], tolerance: 0.15, strength: 1 } );
    const topMid = scr( at[0] + 0.5, y0 + 1, at[1] + 0.5 ) as [number, number];
    pt( "pointerdown", ...topMid );
    pt( "pointerup",   ...topMid );
    log( `fill: ${blues()} blue texels` );
    history.undo();
    // Gradient on the metallic map, left to right across the screen
    st().setPaint( { texTool: "gradient", channel: "metallic", value: 1, strength: 1 } );
    const gl = scr( at[0] - 1, y0 + 1, at[1] ) as [number, number], gr = scr( at[0] + 1, y0 + 1, at[1] + 1 ) as [number, number];
    pt( "pointerdown", ...gl );
    for ( let k = 1; k <= 10; k++ ) pt( "pointermove", gl[0] + ( ( gr[0] - gl[0] ) * k ) / 10, gl[1] + ( ( gr[1] - gl[1] ) * k ) / 10 );
    pt( "pointerup", ...gr );
    const metal = Tt.ch.metallic;
    let lo      = 255, hi = 0;
    if ( metal ) for ( let k = 0; k < Tt.n * Tt.n; k++ ) if ( metal[k * 4 + 3] ) { lo = Math.min( lo, metal[k * 4] ); hi = Math.max( hi, metal[k * 4] ); }
    log( `gradient: metallic ${metal ? `${lo}..${hi}` : "missing (FAIL)"}, metallic_tex ${piece().parts[0].materials[0].metallic_tex ?? "none (FAIL)"}` );
    // a height stroke: a normal map comes of it
    st().setPaint( { texTool: "brush", channel: "height", value: 1, radius: 0.08 } );
    pt( "pointerdown", ...path[0] );
    for ( const p of path.slice( 1, 20 ) ) {
      pt( "pointermove", ...p );
      await frame();
    }
    pt( "pointerup", ...path[19] );
    let bumped = 0;
    if ( Tt.normal ) for ( let k = 0; k < Tt.n * Tt.n; k++ ) if ( Math.abs( Tt.normal[k * 4] - 128 ) > 8 ) bumped++;
    log( `height: ${Tt.ch.height ? "painted" : "missing (FAIL)"}, normal map ${Tt.normal ? `${bumped} texels bent` : "missing (FAIL)"}, normal_tex ${piece().parts[0].materials[0].normal_tex ?? "none (FAIL)"}` );
    await sleep( 600 );
    await ipc.writeBinary( joinPath( dir, "material-2b-channels.png" ), await eng.pictures.capture() );
    st().setPaint( { texTool: "brush", channel: "colour" } );
    // texture size: 2048 and back ( undo )
    const reds = ( t: typeof Tt ) => {
      let c = 0;
      for ( let k = 0; k < t.n * t.n; k++ ) if ( t.rgba[k * 4] > 180 && t.rgba[k * 4 + 1] < 60 ) c++;
      return c;
    };
    const redBefore = reds( Tt );
    MP.resizeTexture( piece(), 2048 );
    const T4 = MP.pieceTexture( "paintcube" )!;
    log( `texture size: ${T4.n} px (model says ${piece().model.paint?.size}), red ${reds( T4 )} (×${( reds( T4 ) / Math.max( 1, redBefore ) ).toFixed( 2 )}), maps ${Object.keys( T4.ch ).map( ( c ) => `${c} ${Math.sqrt( T4.ch[c as "metallic"]!.length / 4 )}` ).join( ", " )}` );
    await sleep( 600 );
    await ipc.writeBinary( joinPath( dir, "material-2c-2048.png" ), await eng.pictures.capture() );
    history.undo();
    await sleep( 600 );
    const shows = () => ( eng.customR.paint.showsPaint( "paintcube" ) ? "yes" : "NO (FAIL)" );
    log( `undo: ${MP.pieceTexture( "paintcube" )!.n} px; 3D shows the paint: ${shows()}` );
    // a stencil: a yellow ring with a see-through middle, pressed onto the cube's front
    const S  = await import( "../../texture/stencil" );
    const iw = 64, ih = 64, logo = new Uint8Array( iw * ih * 4 );
    for ( let y = 0; y < ih; y++ )
      for ( let x = 0; x < iw; x++ ) {
        const d = Math.hypot( x + 0.5 - iw / 2, y + 0.5 - ih / 2 );
        logo.set( d < 30 && d > 18 ? [250, 210, 20, 255] : [0, 0, 0, 0], ( y * iw + x ) * 4 );
      }
    const logoPath = joinPath( dir, "logo.png" );
    await ipc.writeBinary( logoPath, await encodePng( iw, ih, logo ) );
    await S.loadStencil( logoPath, r.width, r.height );
    const front = scr( at[0] - 0.4, y0, at[1] - 1 );
    S.useStencil.setState( { x: front[0], y: front[1], scale: ( Math.abs( scr( at[0] + 0.2, y0, at[1] - 1 )[0] - scr( at[0] - 1, y0, at[1] - 1 )[0] ) ) / iw } );
    const yellows = () => {
      let c = 0;
      for ( let k = 0; k < Tt.n * Tt.n; k++ ) if ( Tt.rgba[k * 4] > 200 && Tt.rgba[k * 4 + 1] > 170 && Tt.rgba[k * 4 + 2] < 80 ) c++;
      return c;
    };
    await sleep( 300 );
    await ipc.writeBinary( joinPath( dir, "material-2d-stencil-placed.png" ), await eng.pictures.capture() );
    const ta      = performance.now();
    const applied = eng.meshPainter.applyStencil();
    log( `stencil applied: ${applied}, ${yellows()} yellow texels in ${( performance.now() - ta ).toFixed( 0 )} ms` );
    history.undo();
    // brushing through it: only the ring takes the paint
    st().setPaint( { rgb: [0, 1, 0], radius: 0.5, strength: 1 } );
    const y1 = yellows();
    pt( "pointerdown", front[0] - 60, front[1] );
    for ( let k = 1; k <= 12; k++ ) {
      pt( "pointermove", front[0] - 60 + k * 10, front[1] );
      await frame();
    }
    pt( "pointerup", front[0] + 60, front[1] );
    await sleep( 300 );
    log( `brushed through the stencil: ${yellows() - y1} more yellow texels (after undoing Apply: ${y1}); 3D shows the paint: ${shows()}` );
    await sleep( 600 );
    await ipc.writeBinary( joinPath( dir, "material-2e-stencil-brushed.png" ), await eng.pictures.capture() );
    S.clearStencil();
    // the top pulled up half a metre: the paint follows
    const m   = piece().model.mesh;
    const top = m.f.findIndex( ( _, i ) => faceNormal( m, i )[1] > 0.99 );
    const ex  = extrudeFaces( m, new Set( [top] ) );
    for ( const v of ex.sel.v ) ex.mesh.v[v] = [ex.mesh.v[v][0], ex.mesh.v[v][1] + 0.5, ex.mesh.v[v][2]];
    const t1 = performance.now();
    st().updateCustom( "Extrude", ["paintcube"], ( x ) => withModel( x, { ...x.model!, mesh: ex.mesh } ) );
    await sleep( 0 );
    MP.prepare( piece() );
    log( `carried across in ${( performance.now() - t1 ).toFixed( 0 )} ms` );
    await sleep( 800 );
    const T2 = MP.pieceTexture( "paintcube" )!;
    let red2 = 0;
    for ( let k = 0; k < T2.n * T2.n; k++ ) if ( T2.rgba[k * 4] > 180 && T2.rgba[k * 4 + 1] < 60 ) red2++;
    log( `3D shows the paint after the shape changed: ${shows()}` );
    log( `after the shape changed: ${red2} red texels (was ${red}), painted on ${piece().model.paint?.sig === MP.atlasFor( ( await import( "../../model/build" ) ).evaluate( piece().model ) ).sig ? "the new shape" : "the old shape (FAIL)"}` );
    await ipc.writeBinary( joinPath( dir, "material-3-extruded.png" ), await eng.pictures.capture() );
    // the Image view: the texture flat, a stroke across it in 2D
    const { useTexView } = await import( "../../ui/panels/TextureView" );
    useTexView.setState( { open: true } );
    await sleep( 800 );
    const tv = document.querySelector<HTMLCanvasElement>( ".texture-view canvas" );
    if ( !tv ) log( "image view: missing (FAIL)" );
    else {
      st().setPaint( { texTool: "brush", channel: "colour", rgb: [0.1, 0.9, 0.2], radius: 0.1, strength: 1, blend: "mix" } );
      const Ti = MP.pieceTexture( "paintcube" )!, before = Ti.rgba.slice();
      const tr = tv.getBoundingClientRect();
      const ev = ( type: string, fx: number, fy: number ) => tv.dispatchEvent( new PointerEvent( type, { clientX: tr.left + tr.width * fx, clientY: tr.top + tr.height * fy, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 19, bubbles: true, pressure: 0.5 } ) );
      ev( "pointerdown", 0.2, 0.5 );
      for ( let k = 1; k <= 20; k++ ) {
        ev( "pointermove", 0.2 + ( 0.6 * k ) / 20, 0.5 );
        await frame();
      }
      ev( "pointerup", 0.8, 0.5 );
      let diff = 0;
      for ( let k = 0; k < Ti.rgba.length; k += 4 ) if ( Ti.rgba[k + 1] !== before[k + 1] ) diff++;
      await sleep( 300 );
      log( `image view: ${tr.width.toFixed( 0 )}×${tr.height.toFixed( 0 )} px, stroke changed ${diff} texels; 3D shows the paint: ${shows()}` );
      await sleep( 300 );
      const shot = await new Promise<Blob>( ( res ) => tv.toBlob( ( b ) => res( b! ), "image/png" ) );
      await ipc.writeBinary( joinPath( dir, "material-4-image-view.png"   ), new Uint8Array( await shot.arrayBuffer() ) );
      await ipc.writeBinary( joinPath( dir, "material-4b-3d-after-2d.png" ), await eng.pictures.capture()               );
      history.undo();
    }
    useTexView.setState( { open: false } );
    // saved as an asset ( the paint with it ), placed on the map, the map exported; the asset opened again
    const files = await import( "../../pieces/assetFiles" );
    st().setSelection( [{ kind: "custom", uid: "paintcube" }] );
    log( `saved as an asset: ${( await files.saveAsset( `Selftest paint ${Date.now() % 100000}` ) ) ? "yes" : "no (FAIL)"}` );
    const ref = files.useAssetFile.getState().ref!;
    st().setTool( "select" );
    await sleep( 300 );
    log( `left the stage: ${eng.stage.shown ? "still shown (FAIL)" : "gone"}, terrain ${eng.terrainR.group.visible ? "back" : "hidden (FAIL)"}` );
    await placeEntry( ref.id, [at[0], g( at[0], at[1] ) + 1, at[1]] );
    await saveProject();
    const r2 = await ipc.exportProject( proj, joinPath( dir, "material.jbrmap" ) );
    log( `exported: ${r2.objects} objects` );
    MP.resetPieceTextures();
    await files.openAsset( ref.id, ref.name );
    await sleep( 1500 );
    const Tr = MP.pieceTexture( st().customObjects[0]?.uid ?? "" );
    log( `asset opened again: texture ${Tr ? "back" : "missing (FAIL)"}, maps ${Tr ? Object.keys( Tr.ch ).join( ", " ) || "none (FAIL)" : "-"}, normal ${Tr?.normal ? "back" : "missing (FAIL)"}` );
    await ipc.deleteUserAsset( ref.path );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
