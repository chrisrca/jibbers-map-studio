import { feature, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { loadLibrary, placeEntry } from "../../pieces/library";
import { openProject, saveProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/convert ): a project in the folder ( a copy ): library pieces ( a rail, a box ) made
 * models with Tab in the Modelling workspace, their look baked; views before and after left in the folder.
**/
export async function convertSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    await loadLibrary();
    const st                = () => useEditor.getState();
    const g                 = ( x: number, z: number ) => terrain.heightAt( x, z );
    const results: string[] = [];
    const files             = await import( "../../pieces/assetFiles" );
    const { setAssetScene } = await import( "../../pieces/assetScene" );
    // each opened from the library in Assets, as "Edit in Assets" does ( at the origin, on the stage )
    for ( const id of ["flat_box", "rail_long"] as const ) {
      const x = 0;
      setAssetScene( [] );
      await files.openAsset( feature( id ), id );
      const o = st().customObjects[st().customObjects.length - 1];
      useEditor.setState( { selection: [{ kind: "custom", uid: o.uid }] } );
      await sleep( 1500 );
      // a three-quarter view, nothing selected ( no gizmo or guide in the way )
      const shot = async ( name: string ) => {
        const sel = st().selection;
        useEditor.setState( { selection: [] } );
        eng.nav.lookAtUnity( [x + 2.6, 1.8, -2.6], [x, 0.4, 0] );
        await sleep( 1200 );
        await ipc.writeBinary( joinPath( dir, `convert-${id}-${name}.png` ), await eng.pictures.capture() );
        useEditor.setState( { selection: sel } );
        await sleep( 200 );
      };
      await shot( "1-before" );
      const was    = { colliders: o.colliders.length, rail: !!o.rail, parts: o.parts.length };
      const canvas = eng.renderer.domElement, rc = canvas.getBoundingClientRect();
      canvas.dispatchEvent( new PointerEvent( "pointerenter", { bubbles: true } ) );
      canvas.dispatchEvent( new PointerEvent( "pointermove",  { clientX: rc.left + rc.width / 2, clientY: rc.top + rc.height / 2, bubbles: true } ) );
      const t0 = performance.now();
      document.body.dispatchEvent( new KeyboardEvent( "keydown", { key: "Tab", bubbles: true, cancelable: true } ) );
      await waitFor( () => eng.modelEd.uid, "edit mode", 60000 );
      const ms    = performance.now() - t0;
      const m     = st().customObjects.find( ( x ) => x.uid === o.uid )!;
      const mesh  = m.model!.mesh;
      const sizes = new Map<number, number>();
      for ( const f of mesh.f ) sizes.set( Math.min( f.length, 5 ), ( sizes.get( Math.min( f.length, 5 ) ) ?? 0 ) + 1 );
      const T = ( await import( "../../texture/meshPaint" ) ).pieceTexture( o.uid );
      results.push( `${id}: ${was.parts} parts → model in ${ms.toFixed( 0 )} ms; ${mesh.v.length} vertices, ${mesh.f.length} faces (tris ${sizes.get( 3 ) ?? 0}, quads ${sizes.get( 4 ) ?? 0}, ngons ${sizes.get( 5 ) ?? 0}), smooth ${mesh.s.filter( Boolean ).length}; colliders ${was.colliders} → ${m.colliders.length} (${[...new Set( m.colliders.map( ( c ) => `${c.shape}/${c.surface_type}` ) )].join( ", " )}); rail ${was.rail} → ${!!m.rail}; paint ${T ? `${T.n} px, maps ${Object.keys( T.ch ).join( "+" ) || "-"}` : "none (FAIL)"}; slot 0 ${JSON.stringify( m.parts[0].materials[0].base_color )} tex ${m.parts[0].materials[0].base_tex}` );
      eng.modelling.toggleEditMode();
      await sleep( 1500 );
      await shot( "2-after" );
      history.undo();
      await sleep( 300 );
      const back = st().customObjects.find( ( x ) => x.uid === o.uid )!;
      history.redo();
      await sleep( 300 );
      results.push( `${id}: undo → ${back.model ? "still a model (FAIL)" : "the piece again"}, redo → ${st().customObjects.find( ( x ) => x.uid === o.uid )!.model?.paint ? "model with its paint" : "no paint (FAIL)"}` );
      await sleep( 500 );
    }
    for ( const r of results ) log( r );
    // two corners of a converted ( painted ) piece moved with G: every frame stays quick
    {
      const { selFromVerts } = await import( "../../model/ops" );
      const rail0            = st().customObjects.find( ( x ) => x.model && x.rail )!;
      useEditor.setState( { selection: [{ kind: "custom", uid: rail0.uid }] } );
      st().setTool( "model" );
      await sleep( 800 );
      const canvas = eng.renderer.domElement, rc = canvas.getBoundingClientRect();
      canvas.dispatchEvent( new PointerEvent( "pointerenter", { bubbles: true } ) );
      if ( !eng.modelEd.uid ) eng.modelling.toggleEditMode();
      await waitFor( () => eng.modelEd.uid, "edit mode" );
      const sig0      = st().customObjects.find( ( x ) => x.uid === rail0.uid )!.model!.paint!.sig;
      eng.modelEd.sel = selFromVerts( rail0.model!.mesh, [0, 1] );
      const from      = performance.now();
      const mv        = ( x: number ) => canvas.dispatchEvent( new PointerEvent( "pointermove", { clientX: rc.left + x, clientY: rc.top + rc.height / 2, buttons: 0, bubbles: true } ) );
      mv( rc.width / 2 );
      eng.modelEd.ops.startTransform( "g" );
      for ( let k = 1; k <= 40; k++ ) {
        mv( rc.width / 2 + k * 4 );
        await new Promise( ( r ) => requestAnimationFrame( r ) );
      }
      document.body.dispatchEvent( new KeyboardEvent( "keydown", { key: "Enter", bubbles: true, cancelable: true } ) );
      const ms   = performance.now() - from;
      const gaps = eng.frameStamps.filter( ( t ) => t >= from ).slice( 1 ).map( ( v, i, a ) => v - ( i ? a[i - 1] : v ) );
      await sleep( 500 );
      const after = st().customObjects.find( ( x ) => x.uid === rail0.uid )!.model!;
      log( `moved two corners of a painted piece: 40 moves in ${ms.toFixed( 0 )} ms, worst frame ${Math.max( 0, ...gaps ).toFixed( 0 )} ms; layout ${after.paint!.sig === sig0 ? "kept" : "made again (FAIL)"}` );
      eng.modelling.toggleEditMode();
      await sleep( 500 );
    }
    // levels of detail on the rail ( the first piece made a model )
    const { withModel, builtOf, lodPreview } = await import( "../../model/objects" );
    const rail                               = st().customObjects.find( ( x ) => x.model && x.rail )!;
    st().updateCustom( "LODs", [rail.uid], ( x ) => withModel( x, { ...x.model!, lods: { levels: 2, keep: 0.5 } } ) );
    const withLods = st().customObjects.find( ( x ) => x.uid === rail.uid )!;
    log( `lods: parts ${withLods.parts.map( ( p ) => `${p.mesh.split( "/" ).pop()}#${p.lod_index}/${p.lod_group_index}` ).join( ", " )}; groups ${JSON.stringify( withLods.lod_groups )}; triangles ${[0, 1, 2].map( ( l ) => builtOf( withLods.model!, l ).tris ).join( " / " )}` );
    useEditor.setState( { selection: [] } );
    lodPreview.set( rail.uid, 2 );
    eng.customR.refresh( rail.uid );
    eng.nav.lookAtUnity( [2.6, 1.8, -2.6], [0, 0.4, 0] );
    await sleep( 1500 );
    await ipc.writeBinary( joinPath( dir, "convert-rail_long-3-lod2.png" ), await eng.pictures.capture() );
    lodPreview.delete( rail.uid );
    eng.customR.refresh( rail.uid );
    // saved as an asset, put on the map, the map exported
    useEditor.setState( { selection: [{ kind: "custom", uid: rail.uid }] } );
    const saved = await files.saveAsset( `Selftest rail ${Date.now() % 100000}` );
    const ref   = files.useAssetFile.getState().ref!;
    st().setTool( "select" );
    await placeEntry( ref.id, [30, g( 30, 30 ), 30] );
    const onMap = st().customObjects.find( ( o ) => o.source?.id === ref.id );
    await saveProject();
    const r2 = await ipc.exportProject( proj, joinPath( dir, "convert.jbrmap" ) );
    log( `asset ${saved ? "saved" : "not saved (FAIL)"}; on the map: ${onMap ? `${onMap.parts.length} parts, ${onMap.lod_groups.length} LOD group(s), rail ${onMap.rail ? "kept" : "lost (FAIL)"}` : "missing (FAIL)"}; exported: ${r2.objects} objects` );
    await ipc.deleteUserAsset( ref.path );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
