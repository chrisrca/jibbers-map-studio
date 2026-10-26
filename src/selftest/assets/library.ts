import { LAYOUTS } from "../../terrain/generate";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, plainNameOf, sleep, waitFor } from "../harness";
import { newProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/library, with JIBBERS_STUDIO_DATA pointing at a copy of the studio's data ): the
 * library's folders, previews from both roots, a map's pieces into a folder of their own and back out.
**/
export async function librarySelftest( dir: string ) {
  try {
    const { loadLibrary } = await import( "../../pieces/library" );
    // ( previews are drawn by the 3D view: a map open )
    await newProject( joinPath( dir, `library-${Date.now()}.jbrproj` ), "Library", { layout: LAYOUTS[0], base: "flat", slopeDeg: 0, heightRange: 100, seed: 1 } );
    await ( await waitFor( () => getEngine(), "engine" ) ).ready;
    const { resetLibraryPreviews, entryPreview } = await import( "../../ui/previews" );
    const lib                                    = () => useEditor.getState().assetLibrary;
    const count                                  = () => `${lib().filter( ( e ) => e.kind === "mesh" ).length} objects, ${lib().filter( ( e ) => e.kind === "material" ).length} materials`;
    const folders                                = () => {
      const n = new Map<string, number>();
      for ( const e of lib() ) n.set( `${e.id.split( ":" )[0]}:${e.folder}`, ( n.get( `${e.id.split( ":" )[0]}:${e.folder}` ) ?? 0 ) + 1 );
      return [...n].map( ( [k, v] ) => `${k} ${v}` ).join( ", " );
    };
    let t = performance.now();
    await loadLibrary();
    log( `start (${( performance.now() - t ).toFixed( 0 )} ms): ${count()}; folders: ${folders()}` );
    t = performance.now();
    await loadLibrary();
    log( `listed again in ${( performance.now() - t ).toFixed( 0 )} ms` );
    await sleep( 2500 );
    log( "SHOT library" );
    await sleep( 2500 );
    for ( const e of [lib().find( ( x ) => x.id.startsWith( "app:" ) && x.kind === "mesh" ), lib().find( ( x ) => x.id.startsWith( "app:" ) && x.kind === "material" ), lib().find( ( x ) => x.id.startsWith( "user:" ) )] ) {
      if ( !e ) continue;
      const url = await entryPreview( e );
      log( `preview of ${e.id.split( ":" )[0]} ${e.kind} "${e.folder}/${e.name}": ${url ? "drawn" : "NONE"}` );
    }
    const maps = ( await ipc.listGameMaps() ).sort( ( a, b ) => a.bytes - b.bytes ).filter( ( m ) => m.bytes > 5e6 );
    const m    = maps.find( ( x ) => /Joyosa/.test( x.name ) ) ?? maps[0];
    t          = performance.now();
    const n    = await ipc.setLibraryMap( m.path, true );
    resetLibraryPreviews();
    await loadLibrary();
    const added = await ipc.listLibraryMaps();
    log( `added "${m.name}" (${( m.bytes / 1e6 ).toFixed( 0 )} MB): ${n} pieces in ${( performance.now() - t ).toFixed( 0 )} ms: ${count()}; maps ${JSON.stringify( added.map( ( a ) => a.label ) )}` );
    const again = await ipc.setLibraryMap( m.path, true ).then( () => "added AGAIN", ( e ) => `refused (${e})` );
    log( `adding it again: ${again}` );
    const piece = lib().find( ( e ) => e.kind === "mesh" && e.id.startsWith( "user:" ) && added.some( ( a ) => e.id.includes( a.path ) ) );
    if ( piece ) log( `a piece: "${piece.name}" in "${piece.folder}"; preview ${( await entryPreview( piece ) ) ? "drawn" : "NONE"}` );
    const mine = added.find( ( a ) => m.name.includes( a.label ) || a.label.includes( plainNameOf( m.name ) ) );
    t          = performance.now();
    if ( mine ) await ipc.setLibraryMap( mine.path, false );
    resetLibraryPreviews();
    await loadLibrary();
    log( `removed in ${( performance.now() - t ).toFixed( 0 )} ms: ${count()}; maps ${JSON.stringify( ( await ipc.listLibraryMaps() ).map( ( a ) => a.label ) )}` );
    log( "SELFTEST OK" );
  } catch ( e ) {
    log( `SELFTEST FAILED: ${e}` );
  }
}
