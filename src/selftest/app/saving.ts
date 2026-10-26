import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/saving ): a map from the game opened as a project remembers where it came from,
 * is found again in its folder, and the question before replacing a map in the game.
**/
export async function savingSelftest( dir: string ) {
  try {
    const { importMap, currentProject } = await import( "../../map/project" );
    const { ask,       answer         } = await import( "../../app/ask"     );
    await waitFor( () => useEditor.getState().placeholders.length > 0, "asset library" );
    const maps = ( await ipc.listGameMaps() ).sort( ( a, b ) => a.bytes - b.bytes );
    const m    = maps[0];
    const proj = joinPath( dir, `${m.name.replace( /<[^>]*>|[<>:"/|?*]+/g, "" ).trim()} ${Date.now()}.jbrproj` );
    await importMap( m.path, proj );
    const saved = JSON.parse( await ipc.readText( joinPath( proj, "project.json" ) ) );
    log( `opened "${m.name}" (${( m.bytes / 1e6 ).toFixed( 1 )} MB) as ${proj}: id ${saved.map.id === m.id ? "kept" : "CHANGED"}, came from ${saved.editor?.sourceMapId === m.id ? "it (recorded)" : "NOT RECORDED"}; in the editor: ${currentProject()?.map.id === m.id}` );
    const found = await ipc.findProjects( dir );
    log( `projects in the folder: ${found.length}; this one found by its map: ${found.some( ( p ) => p.dir === proj && p.mapId === m.id && p.sourceMapId === m.id )}`           );
    log( `a map in the game: ${JSON.stringify( await ipc.fileStamp( m.path ) )}; a missing file: ${JSON.stringify( await ipc.fileStamp( joinPath( dir, "nothing.jbrmap" ) ) )}` );
    const q = ask( { title: "“Joyosa Park Plus” is already in the game", text: { label: "New map's name", value: "Joyosa Park <color=orange>Plus</color> 2" }, answers: [{ id: "new", label: "Save as new map", usesText: true }, { id: "replace", label: "Replace it", primary: true }] } );
    await sleep( 400 );
    log( "SHOT ask" );
    await sleep( 4000 );
    answer( { id: "replace", text: "" } );
    log( `answered: ${JSON.stringify( await q )}` );
    log( "SELFTEST OK"                            );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
