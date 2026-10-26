import { LAYOUTS } from "../../terrain/generate";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { newProject, saveProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/grip ): a new map: the Grip tool taken from the paint tool
 * shelf and dragged across the ground ( the chunk loses its 4-channel flag, the alpha holds the depth, the overlay
 * shows it ), saved and exported ( the map's chunk: flag off, alpha painted ); then undone, markings painted there, and
 * grip dragged again ( kept off: the chunk shows markings ). Views left in the folder.
**/
export async function gripSelftest( dir: string ) {
  try {
    const P            = await import( "../../paint/ground"                    );
    const { snowLook } = await import( "../../viewport/render/terrainRenderer" );
    // ( a new map: its chunks have nothing painted on them yet )
    const proj         = joinPath( dir, `grip-${Date.now()}.jbrproj` );
    await newProject( proj, "Grip", { layout: LAYOUTS[0], base: "mountain", slopeDeg: 14, heightRange: 200, seed: 5 } );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st                   = () => useEditor.getState();
    const c0                   = terrain.chunks[0];
    const at: [number, number] = [c0.position[0] + c0.size[0] / 2, c0.position[2] + c0.size[2] / 2];
    const g                    = terrain.heightAt( at[0], at[1] );
    eng.nav.lookAtUnity( [at[0] - 40, g + 22, at[1]], [at[0], g, at[1]] );
    st().setTool( "paint" );
    await sleep( 1500 );
    const btn = await waitFor( () => [...document.querySelectorAll<HTMLButtonElement>( ".tool-column .tool" )].find( ( b ) => b.title.startsWith( "Grip" ) ) ?? null, "the Grip tool", 10000 );
    btn.click();
    await sleep( 1500 );
    log( `tool ${st().paint.tool}; overlay ${snowLook.showGrip.value}; header "${document.querySelector( ".tool-settings b" )?.textContent}"` );
    st().setPaint( { radius: 6, strength: 1, powder: 0.6, invert: false } );
    const canvas = eng.renderer.domElement, r = canvas.getBoundingClientRect();
    const frame  = () => new Promise<number>( ( res ) => requestAnimationFrame( res ) );
    const stroke = async () => {
      const ev = ( type: string, fx: number ) => {
        const init = { clientX: r.left + fx * r.width, clientY: r.top + 0.6 * r.height, button: 0, buttons: 1, pointerId: 71, bubbles: true };
        if ( type === "pointerup" ) window.dispatchEvent( new PointerEvent( type, init ) );
        else canvas.dispatchEvent( new PointerEvent( type, init ) );
      };
      ev( "pointerdown", 0.35 );
      await frame();
      for ( let k = 1; k <= 40; k++ ) {
        ev( "pointermove", 0.35 + ( 0.3 * k ) / 40 );
        await frame();
      }
      ev( "pointerup", 0.65 );
      await sleep( 800 );
    };
    // ( the strokes cross the middle of the first chunk )
    const key   = c0.key;
    const L     = await P.ensureLayer( terrain.chunks[terrain.indexOf( key )] );
    const maxOf = ( ch: number ) => { let v = 0; for ( let k = ch; k < L.rgba.length; k += 4 ) v = Math.max( v, L.rgba[k] ); return v; };
    log( `before: chunk ${key} 4-channel ${L.four}, alpha up to ${maxOf( 3 )}, blocked ${P.gripBlocked( L )}` );
    await stroke();
    log( `grip stroke: 4-channel ${L.four}, alpha up to ${maxOf( 3 )} (want ${Math.round( 0.6 * 255 )}), markings up to ${maxOf( 2 )}; undo step "${history.nextUndo}"` );
    await sleep( 500 );
    await ipc.writeBinary( joinPath( dir, "grip.png" ), await eng.pictures.capture() );
    // saved and exported: the map's chunk as the game reads it
    await saveProject();
    log( `saved: chunk extras 4-channel ${( st().chunkExtras[key] as { snowMask4Channel?: boolean } )?.snowMask4Channel}` );
    const out = joinPath( dir, "grip.jbrmap" );
    await ipc.exportProject( proj, out );
    const map = JSON.parse( await ipc.readText( out ) );
    const ci  = terrain.indexOf( key );
    const ch  = map.chunks[`value-${ci}`];
    const b64 = ch["snow-mask"].data as string;
    const gz  = Uint8Array.from( atob( b64 ), ( c ) => c.charCodeAt( 0 ) );
    const png = new Uint8Array( await new Response( new Blob( [gz] ).stream().pipeThrough( new DecompressionStream( "gzip" ) ) ).arrayBuffer() );
    const bmp = await createImageBitmap( new Blob( [png], { type: "image/png" } ), { premultiplyAlpha: "none", colorSpaceConversion: "none" } );
    const cv  = new OffscreenCanvas( bmp.width, bmp.height ), cx = cv.getContext( "2d" )!;
    cx.drawImage( bmp, 0, 0 );
    const px = cx.getImageData( 0, 0, bmp.width, bmp.height ).data;
    let a    = 0;
    for ( let k = 3; k < px.length; k += 4 ) a = Math.max( a, px[k] );
    log( `exported: version ${map.version}, chunk snow-mask-4channel ${ch["snow-mask-4channel"]}, mask ${bmp.width}², alpha up to ${a}` );
    // markings there instead: grip kept off
    history.undo();
    await sleep( 300 );
    st().setPaint( { tool: "marking" } );
    await sleep( 300 );
    await stroke();
    log( `markings: 4-channel ${L.four}, markings up to ${maxOf( 2 )}, blocked ${P.gripBlocked( L )}` );
    btn.click();
    await sleep( 1200 );
    const a0 = maxOf( 3 );
    await stroke();
    log( `grip over markings: alpha ${a0} -> ${maxOf( 3 )}, 4-channel ${L.four}; the chunk darkened ${( eng.terrainR as unknown as { tiles: { gripBlocked: { value: number } }[][] } ).tiles[ci]?.[0]?.gripBlocked.value}` );
    await ipc.writeBinary( joinPath( dir, "grip-blocked.png" ), await eng.pictures.capture() );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
