import * as THREE from "three/webgpu";
import { domShot, feature, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { terrain } from "../../terrain/terrain";
import { toUnity } from "../../core/coords";
import { useEditor, workspaceOf } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/startup ): the studio's start as a person sees it: an untitled map with nothing
 * in it, in Design on Blender's floor, the start window over it; New Asset from it ( the Assets workspace ), back to
 * Design, a piece put on the empty floor. Pictures of the window and the empty map left in the folder.
**/
export async function startupSelftest( dir: string ) {
  try {
    const P = await import( "../../map/project" );
    await P.startSession();
    useEditor.setState( { splash: true } );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 1500 );
    const st = () => useEditor.getState();
    const bg = eng.scene.background as THREE.Color | null;
    log( `open: "${st().map?.name}" untitled ${P.isUntitled( st().projectDir )}; workspace ${workspaceOf( st().tool )}; chunks ${terrain.chunks.length}; floor ${eng.emptyFloor.shown}; background ${bg && ( bg as THREE.Color ).isColor ? "#" + bg.getHexString() : "sky"}` );
    const win = await waitFor( () => document.querySelector<HTMLElement>( ".bsplash" ), "the start window", 10000 );
    await waitFor( () => win.querySelector<HTMLImageElement>( ".bsplash-art img" )?.complete, "its picture", 10000 );
    await sleep( 500 );
    const box = win.getBoundingClientRect();
    log( `start window: ${box.width.toFixed( 0 )}x${box.height.toFixed( 0 )}; "${win.querySelector( ".ver" )?.textContent}" · "${win.querySelector( ".credit" )?.textContent}"; ${[...win.querySelectorAll( ".bsplash-cols > div" )].map( ( c ) => [...c.querySelectorAll( "h3, .bsplash-item .name" )].map( ( x ) => x.textContent ).slice( 0, 7 ).join( " | " ) ).join( "  //  " )}` );
    // ( the whole view: the skier leaps out of the box; its picture inline, as a picture of the page can't load files )
    const img  = win.querySelector<HTMLImageElement>( ".bsplash-art img" )!;
    const blob = await ( await fetch( img.src ) ).blob();
    img.src    = await new Promise<string>( ( res ) => {
      const fr = new FileReader();
      fr.addEventListener( "load", () => res( fr.result as string ) );
      fr.readAsDataURL( blob );
    } );
    await sleep( 200 );
    await domShot( document.querySelector<HTMLElement>( ".splash-back" )!, joinPath( dir, "start-window.png" ) );
    await ipc.writeBinary( joinPath( dir, "empty-map.png" ), await eng.pictures.capture() );
    // New Asset: the Assets workspace, nothing in it
    [...win.querySelectorAll<HTMLButtonElement>( ".bsplash-item" )].find( ( b ) => b.textContent?.includes( "New Asset" ) )!.click();
    await sleep( 1200 );
    {
      const icon = document.querySelector<HTMLElement>( ".vp-header .editor-icon" )!.getBoundingClientRect(), mode = document.querySelector<HTMLElement>( ".vp-header .mode-pull" )!.getBoundingClientRect();
      log( `header: the viewport icon ${icon.width.toFixed( 0 )} px wide, ${( mode.left - icon.right ).toFixed( 0 )} px before the mode` );
      await domShot( document.querySelector<HTMLElement>( ".vp-header" )!, joinPath( dir, "assets-header.png" ) );
    }
    log( `New Asset: window ${document.querySelector( ".bsplash" ) ? "still open (FAIL)" : "closed"}; workspace ${workspaceOf( st().tool )}; pieces ${st().customObjects.length}` );
    // back to Design: a piece on the empty floor, where the middle of the view meets it
    [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === "Design" )?.click();
    await sleep( 1000 );
    const host                        = eng.renderer.domElement.getBoundingClientRect();
    const hit                         = eng.pickTerrain( host.width / 2, host.height / 2 );
    const { placeEntry, loadLibrary } = await import( "../../pieces/library" );
    await loadLibrary();
    const id = feature( "rail_long" );
    if ( hit ) await placeEntry( id, toUnity( hit ) );
    await sleep( 1500 );
    const o = st().customObjects[st().customObjects.length - 1];
    log( `floor under the middle: ${hit ? toUnity( hit ).map( ( v ) => v.toFixed( 1 ) ).join( ", " ) : "none (FAIL)"}; placed ${o ? `${st().labels[o.uid] ?? o.uid} at y ${o.position.y.toFixed( 2 )}` : "nothing (FAIL)"}` );
    eng.nav.frameAll();
    await sleep( 800 );
    await ipc.writeBinary( joinPath( dir, "empty-map-piece.png" ), await eng.pictures.capture() );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
