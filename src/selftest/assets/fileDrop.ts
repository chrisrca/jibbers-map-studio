import { domShot, log, realInput, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { importAssetFiles } from "../../pieces/userAssets";
import { ipc, joinPath } from "../../core/ipc";
import { loadLibrary, placeEntry } from "../../pieces/library";
import { saveProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/filedrop ): files dragged in from Explorer, by the window's own drag events ( what
 * the system sends as files are held over it and let go ): the places they can go shown, with what each does and the
 * one under the cursor lit; a model let go on the view put down there ( and kept in My imports ); an image let go on a
 * piece put on it as its material; a model and a map let go on the asset bar only added to the library; a map let go
 * on the view asking about the map open first — Cancel keeps it, Don't Save opens the map and adds its pieces.
**/
export async function fileDropSelftest( dir: string ) {
  try {
    const P                     = await import( "../../map/project"       );
    const { emitTo            } = await import( "@tauri-apps/api/event"   );
    const { getCurrentWebview } = await import( "@tauri-apps/api/webview" );
    const label                 = getCurrentWebview().label;
    const st                    = () => useEditor.getState();
    const glb                   = joinPath( st().libraryDir, "placeholders", st().placeholders.find( ( p ) => p.id.includes( "picnic" ) )?.file ?? st().placeholders[0].file );
    const png                   = "C:\\Projects\\jibbers-map\\studio\\public\\splash.png";
    // ---- a map with a piece of its own to drop later: the ground map with a model put on it, exported
    const proj                  = ( await ipc.findProjects( dir ) )[0].dir;
    await P.openProject( proj );
    let eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await waitFor( () => ( eng.veil.loading ? null : true ), "the map's pieces", 300000 );
    const a0 = await importAssetFiles( [glb] );
    await loadLibrary();
    const e0 = st().assetLibrary.find( ( e ) => e.id.startsWith( "user:" ) && e.id.slice( 5 ).toLowerCase() === a0!.path.toLowerCase() )!;
    await placeEntry( e0.id, [0, terrain.heightAt( 0, 0 ), 0] );
    await saveProject();
    const mapFile = joinPath( dir, "dropme.jbrmap" );
    await ipc.exportProject( proj, mapFile );
    const mapName = st().map?.name ?? "";
    log( `a map to drop: "${mapName}", ${st().customObjects.length} pieces of its own` );
    // ( its pieces out of the library, if an earlier run put them there )
    const had = st().assetLibrary.find( ( e ) => e.id.startsWith( "user:" ) && e.folder.startsWith( mapName ) );
    if ( had ) {
      const p = had.id.slice( 5 ), i = p.indexOf( `\\${mapName}\\` );
      if ( i > 0 ) await ipc.setLibraryMap( p.slice( 0, i + mapName.length + 1 ), false ).catch( ( e ) => log( `  couldn't take the map's pieces out: ${e}` ) );
      await loadLibrary();
    }
    // ---- an untitled map, the start window over it, as the studio opens
    await P.newUntitled();
    eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: true } );
    await sleep( 1200 );
    let phase = "start";
    const io  = realInput( eng, () => phase );
    eng.nav.lookAtUnity( [10, 8, -14], [0, 0, 0] );
    await sleep( 500 );
    const phys   = ( x: number, y: number ) => ( { x: x * devicePixelRatio, y: y * devicePixelRatio } );
    const send   = ( kind: "enter" | "over" | "drop" | "leave", x: number, y: number, paths?: string[] ) =>
      emitTo( { kind: "Webview", label }, `tauri://drag-${kind}`, kind === "leave" ? null : { paths: paths ?? [], position: phys( x, y ) } );
    const rectOf = ( sel: string ) => document.querySelector<HTMLElement>( sel )!.getBoundingClientRect();
    const mid    = ( r: DOMRect ): [number, number] => [r.left + r.width / 2, r.top + r.height / 2];
    const zones  = () =>
      [...document.querySelectorAll<HTMLElement>( ".drop-zone" )].map( ( z ) => `${z.classList.contains( "view" ) ? "view" : "dock"}${z.classList.contains( "on" ) ? " (lit)" : ""}: ${[...z.querySelectorAll( ".drop-what span" )].map( ( x ) => x.textContent ).join( " · " )}` );
    // ---- held over the view, then over the asset bar
    phase          = "held";
    const [vx, vy] = mid( rectOf( ".viewport" ) );
    await send( "enter", vx, vy, [glb, png] );
    await sleep( 400 );
    const z1 = zones();
    log( `held over the view: start window ${st().splash ? "still open (FAIL)" : "out of the way"}; ${z1.join( " | " )}${z1.some( ( z ) => z.startsWith( "view (lit): Place · Apply material" ) ) && z1.some( ( z ) => z.startsWith( "dock: Add to library" ) ) ? "" : " (FAIL)"}` );
    await domShot( document.body, joinPath( dir, "held-view.png" ) );
    const [dx, dy] = mid( rectOf( ".area.assets" ) );
    await send( "over", dx, dy );
    await sleep( 300 );
    const z2 = zones();
    log( `over the asset bar: ${z2.join( " | " )}${z2.some( ( z ) => z.startsWith( "dock (lit)" ) ) && !z2.some( ( z ) => z.startsWith( "view (lit)" ) ) ? "" : " (FAIL)"}` );
    await domShot( document.body, joinPath( dir, "held-dock.png" ) );
    await send( "leave", 0, 0 );
    await sleep( 300 );
    log( `let go of outside: zones ${document.querySelector( ".drop-zone" ) ? "still shown (FAIL)" : "gone"}` );
    // ---- a model let go on the view: put down there
    phase                = "model on the view";
    const seen: string[] = [];
    useEditor.subscribe( ( s, p ) => s.toasts !== p.toasts && s.toasts.forEach( ( t ) => !seen.includes( t.text ) && seen.push( t.text ) ) );
    const n0 = st().customObjects.length, want = eng.placing.libraryPlacementAt( vx, vy );
    await send( "enter", vx, vy, [glb] );
    await send( "drop",  vx, vy, [glb] );
    const placed = await waitFor( () => ( st().customObjects.length > n0 ? st().customObjects[st().customObjects.length - 1] : null ), "the model put down", 30000 );
    const off    = want ? Math.hypot( placed.position.x - want.pos[0], placed.position.z - want.pos[2] ) : NaN;
    log( `model on the view: ${st().customObjects.length - n0} put down, ${off.toFixed( 2 )} m from where it was let go${off < 0.5 ? "" : " (FAIL)"}; in My imports ${st().assetLibrary.some( ( e ) => e.folder.startsWith( "My imports" ) && e.name.toLowerCase().includes( "picnic" ) ) ? "yes" : "no (FAIL)"}` );
    // ---- an image let go on that piece: its material
    phase = "image on a piece";
    await sleep( 800 );
    // ( where it was let go: it's there )
    const [px, py] = [vx, vy];
    const before   = JSON.stringify( placed.parts.map( ( q ) => q.materials ) );
    const hit      = eng.surfaceAt( px, py );
    await send( "enter", px, py, [png] );
    await send( "drop",  px, py, [png] );
    const after = await waitFor( () => {
      const o = st().customObjects.find( ( x ) => x.uid === placed.uid )!;
      const j = JSON.stringify( o.parts.map( ( q ) => q.materials ) );
      return j !== before ? j : null;
    }, "the material put on", 30000 ).catch( () => null );
    log( `image on the piece (${hit?.kind === "custom" && hit.uid === placed.uid ? "aimed at it" : `aimed at ${hit?.kind ?? "nothing"} (FAIL)`}): material ${after && after.includes( "splash" ) ? "put on" : "not put on (FAIL)"}; in My materials ${st().userMaterials.some( ( m ) => m.name.toLowerCase().includes( "splash" ) ) ? "yes" : "no (FAIL)"}` );
    // ---- a model let go on the asset bar: library only
    phase    = "model on the bar";
    const n1 = st().customObjects.length, lib1 = st().assetLibrary.length;
    await send( "enter", dx, dy, [glb] );
    await send( "drop",  dx, dy, [glb] );
    await waitFor( () => ( st().assetLibrary.length > lib1 ? true : null ), "the model in the library", 30000 );
    await sleep( 500 );
    log( `model on the asset bar: library ${lib1} -> ${st().assetLibrary.length}; pieces in the map ${n1} -> ${st().customObjects.length}${st().customObjects.length === n1 ? "" : " (FAIL)"}` );
    // ---- a map let go on the asset bar: its pieces into the library, the map open kept
    phase      = "map on the bar";
    const here = st().projectDir, lib2 = st().assetLibrary.length;
    await send( "enter", dx, dy, [mapFile] );
    await send( "drop",  dx, dy, [mapFile] );
    // ( added again on a later run: the same map's pieces replaced, so the count can stay the same )
    await waitFor( () => ( seen.some( ( t ) => t.startsWith( "Added the pieces and materials" ) ) ? true : null ), "the map's pieces in the library", 60000 ).catch( ( e ) => {
      log( `  toasts: ${seen.join( " / " )}` );
      throw e;
    } );
    await sleep( 500 );
    log( `map on the asset bar: added (library ${lib2} -> ${st().assetLibrary.length}); the map open ${st().projectDir === here ? "kept" : "changed (FAIL)"}; asked ${document.querySelector( ".modal" ) ? "something (FAIL)" : "nothing"}` );
    // ---- a map let go on the view: asked about the map open; Cancel keeps it
    phase           = "map on the view";
    const askButton = ( text: string ) => waitFor( () => [...document.querySelectorAll<HTMLButtonElement>( ".modal button" )].find( ( x ) => x.textContent?.trim() === text ) ?? null, `"${text}"`, 10000 );
    await send( "enter", vx, vy, [mapFile] );
    await send( "drop",  vx, vy, [mapFile] );
    const title = await waitFor( () => document.querySelector( ".modal h2" )?.textContent ?? null, "the question", 10000 );
    log( `map on the view: asked "${title}"` );
    await domShot( document.body, joinPath( dir, "asked.png" ) );
    ( await askButton( "Cancel" ) ).click();
    await sleep( 1500 );
    log( `  Cancel: the map open ${st().projectDir === here && st().customObjects.length === n1 ? "kept" : "changed (FAIL)"}` );
    // ---- again, Don't Save: the map opened, its pieces added
    const lib3 = st().assetLibrary.length;
    await send( "enter", vx, vy, [mapFile] );
    await send( "drop",  vx, vy, [mapFile] );
    ( await askButton( "Don't Save" ) ).click();
    await waitFor( () => ( st().projectDir !== here && !st().busy ? true : null ), "the map opened", 120000 );
    await sleep( 2000 );
    log( `  Don't Save: opened "${st().map?.name}"${st().map?.name === mapName ? "" : " (FAIL)"} with ${st().customObjects.length} pieces of its own; library ${lib3} -> ${st().assetLibrary.length}` );
    io.stop();
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
