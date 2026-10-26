import { LAYOUTS } from "../../terrain/generate";
import { feature, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { joinPath } from "../../core/ipc";
import { loadLibrary, placeEntry } from "../../pieces/library";
import { newProject, openProject, saveProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/outliner ): collections, renaming, copy/paste, features from the library.
**/
export async function outlinerSelftest( dir: string ) {
  try {
    const { fixJibs, uprightness, undoUpMethodSwitch } = await import( "../../pieces/library" );
    const { copySelection, paste }                     = await import( "../../map/clipboard"  );
    const proj                                         = joinPath( dir, `outliner-${Date.now()}.jbrproj` );
    await newProject( proj, "Outliner Test", { layout: LAYOUTS[0], base: "slope", slopeDeg: 10, heightRange: 1200, seed: 3 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await loadLibrary();
    const st = useEditor.getState;
    const g  = ( x: number, z: number ) => terrain.heightAt( x, z );
    // library tubes are plain pieces with the library's settings
    await placeEntry( feature( "tube_long" ), [0, g( 0, 0 ), 0], [0, 0, 0] );
    const tube = st().customObjects[0];
    log( `placed tube: pieces ${st().customObjects.length}, features ${st().objects.length}, up method ${tube?.intended_up_method}` );
    // one flipped over with its mesh mirrored ( as scaling through zero used to leave it ), then fixed
    const flipped = {
      ...tube, uid: "flipped", rotation: { x: 356.3, y: 105.8, z: 177.8 }, intended_up_method: 0,
      parts: tube.parts.map( ( p ) => ( { ...p, local_scale: { ...p.local_scale, x: -Math.abs( p.local_scale.x ) } } ) ),
    };
    const fx = fixJibs( [flipped] );
    const f0 = fx.list[0];
    log( `flipped tube_long uprightness ${uprightness( flipped ).toFixed( 2 )} -> ${uprightness( f0 ).toFixed( 2 )}, roll ${f0.rotation.z.toFixed( 1 )}, mesh mirrored ${f0.parts[0].local_scale.x < 0}, up method ${f0.intended_up_method}, fixed ${fx.fixed}` );
    // a curved tube upside down is left alone ( that shows, so it may be meant )
    const cTube = { ...flipped, uid: "ctube", parts: flipped.parts.map( ( p ) => ( { ...p, mesh: "Features/c_tube_narrow/0" } ) ) };
    log( `flipped c_tube_narrow fixed ${fixJibs( [cTube] ).fixed}` );
    // the first version's switch to up method 2 is undone when every tube/rail is on 2, not when they're mixed
    log( `undo switch: ${undoUpMethodSwitch( [{ ...tube, intended_up_method: 2 }, { ...cTube, intended_up_method: 2 }] ).fixed} of 2, mixed ${undoUpMethodSwitch( [{ ...tube, intended_up_method: 2 }, { ...cTube, intended_up_method: 0 }] ).fixed}` );
    st().addCustom( f0 );
    // collections
    const rails = st().newCollection( null,  "Rails" );
    const tubes = st().newCollection( rails, "Tubes" );
    st().moveToCollection( [st().customObjects[0].uid], tubes );
    st().renameCollection( rails, "Rails & tubes" );
    st().renameItem( { kind: "custom", uid: st().customObjects[0].uid }, "Main tube" );
    st().setActiveCollection( rails );
    st().addSpawn( { uid: "sp2", name: "Drop in", position: [0, g( 0, -20 ) + 1.2, -20], rotation: [0, 0, 0], velocity: [0, 0, 0] } );
    log( `collections: ${st().collections.map( ( c ) => `${c.name}<${c.parent ? st().collections.find( ( x ) => x.id === c.parent )?.name : "map"}` ).join( ", " )}; membership ${JSON.stringify( Object.values( st().membership ).map( ( id ) => st().collections.find( ( c ) => c.id === id )?.name ) )}` );
    // copy / paste ( no cursor: in place, into the active collection )
    st().setActiveCollection( null );
    st().setSelection( [{ kind: "custom", uid: st().customObjects[0].uid }] );
    const n = copySelection();
    await paste();
    const pasted = st().customObjects[st().customObjects.length - 1];
    log( `copied ${n}, now ${st().customObjects.length} pieces; pasted one in ${st().collections.find( ( c ) => c.id === st().membership[pasted.uid] )?.name ?? "the map"}, named ${st().labels[pasted.uid]}` );
    history.undo();
    log( `undo paste: ${st().customObjects.length} pieces` );
    history.redo();
    // nested collection out to the map, delete the outer one ( its contents move up )
    st().moveCollection( tubes, null );
    st().deleteCollection( rails );
    log( `after delete: collections ${st().collections.map( ( c ) => c.name ).join( ", " )}; spawn 'Drop in' in ${st().membership.sp2 ?? "the map"}` );
    await saveProject();
    const before = JSON.stringify( { c: st().collections.map( ( c ) => c.name ), m: Object.keys( st().membership ).length, l: st().labels } );
    await openProject( proj );
    const after = JSON.stringify( { c: st().collections.map( ( c ) => c.name ), m: Object.keys( st().membership ).length, l: st().labels } );
    log( `reopened: same Outliner ${before === after} (${after})` );
    // a few to look at
    const extra = st().newCollection( null, "Park line" );
    st().setActiveCollection( extra );
    for ( const [k, id] of ["flat_box", "rainbow_box", "rail_long"].entries() ) await placeEntry( feature( id ), [k * 5 - 5, g( k * 5 - 5, 15 ), 15], [0, 0, 0] );
    st().setSelection( [{ kind: "custom", uid: st().customObjects[st().customObjects.length - 1].uid }] );
    eng.nav.lookAtUnity( [0, g( 0, -8 ) + 8, -8], [0, g( 0, 10 ), 10] );
    await sleep( 1500 );
    log( "SHOT outliner" );
    await sleep( 5000 );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
