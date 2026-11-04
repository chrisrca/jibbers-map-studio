import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/editview ): an untitled map, the Modelling workspace, a cube in Edit Mode seen in
 * each select mode ( its edges drawn, faces outlined ); views left in the folder.
**/
export async function editViewSelftest( dir: string ) {
  try {
    const { newModelObject } = await import( "../../model/objects" );
    const { primitive      } = await import( "../../model/mesh"    );
    const P                  = await import( "../../map/project"   );
    await P.newUntitled();
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 1500 );
    useEditor.setState( { splash: false } );
    const st = () => useEditor.getState();
    st().setTool( "model" );
    await sleep( 800 );
    const o = newModelObject( "editcube", primitive( "cube" ), [0, 1, 0] );
    st().addCustom( o );
    useEditor.setState( { selection: [{ kind: "custom", uid: "editcube" }] } );
    eng.nav.lookAtUnity( [-4.5, 3.6, -5], [0, 1, 0] );
    await sleep( 800 );
    await ipc.writeBinary( joinPath( dir, "editview-0-object.png" ), await eng.pictures.capture() );
    eng.modelEd.enter( "editcube" );
    useEditor.setState( { modelEdit: { uid: "editcube", mode: "vert", verts: 0, edges: 0, faces: 0, status: "" } } );
    for ( const [i, mode] of ( ["vert", "edge", "face"] as const ).entries() ) {
      eng.modelEd.picking.setMode( mode );
      await sleep( 600 );
      await ipc.writeBinary( joinPath( dir, `editview-${i + 1}-${mode}.png` ), await eng.pictures.capture() );
    }
    // its faces unwrapped ( U › Smart UV Project ), the UV Editor open beside the view
    eng.modelEd.picking.selectAll( true );
    eng.modelEd.menus.unwrapItems().find( ( x ) => x.label === "Smart UV Project" )!.run!();
    const { useUvEditor } = await import( "../../ui/panels/UvEditor" );
    useUvEditor.setState( { open: true } );
    await sleep( 800 );
    const uvCanvas = await waitFor( () => document.querySelector<HTMLCanvasElement>( ".uv-editor canvas" ), "the UV Editor" );
    const blob     = await new Promise<Blob | null>( ( r ) => uvCanvas.toBlob( r, "image/png" ) );
    if ( blob ) await ipc.writeBinary( joinPath( dir, "editview-4-uv.png" ), new Uint8Array( await blob.arrayBuffer() ) );
    log( `UV Editor: ${uvCanvas.clientWidth}×${uvCanvas.clientHeight}, faces with UVs ${o.uid && st().customObjects.find( ( x ) => x.uid === "editcube" )?.model?.mesh.u?.filter( ( u ) => u.length ).length}` );
    useUvEditor.setState( { open: false } );
    // out of Edit Mode, Add › UV Sphere: the Adjust Last Operation panel, its segments set to 8
    eng.modelEd.exit();
    eng.menus.addPrimitive( { uid: "editsphere", id: "uvsphere", opts: {}, at: [3, 1, 0], rot: [0, 0, 0], into: false } );
    await sleep( 600 );
    const panel = document.querySelector( ".adjust-last" );
    log( `Adjust Last: ${panel ? `shown, "${panel.querySelector( ".al-head" )?.textContent?.trim()}", ${panel.querySelectorAll( "label" ).length} rows` : "not shown (FAIL)"}` );
    eng.menus.redoAdd( { ...st().lastAdd!, opts: { segments: 8, rings: 6 } } );
    await sleep( 600 );
    log( `sphere after: ${st().customObjects.find( ( x ) => x.uid === "editsphere" )?.model?.mesh.v.length} vertices; panel ${document.querySelector( ".adjust-last" ) ? "still shown" : "gone (FAIL)"}` );
    const { domShot } = await import( "../harness" );
    await domShot( document.querySelector( ".adjust-last" ), joinPath( dir, "editview-5-adjust.png" ) );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
