import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject, saveProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/model ): a project in the folder ( a copy ) opened in the Modelling workspace: a
 * cube added, edited in Edit Mode with the mouse and keys as a person would ( its top face clicked, extruded up a typed
 * metre, inset, bevelled, loop cut ), modifiers added, exported and opened again; views left in the folder.
**/
export async function modelSelftest( dir: string ) {
  try {
    const { edgesOf, runs } = await import( "../../model/mesh" );
    const proj              = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st = () => useEditor.getState();
    const g  = ( x: number, z: number ) => terrain.heightAt( x, z );
    st().setTool( "model" );
    const at: [number, number] = [30, 30];
    eng.nav.lookAtUnity( [at[0] - 7, g( at[0], at[1] ) + 5, at[1] - 6], [at[0], g( at[0], at[1] ) + 1, at[1]] );
    await sleep( 800 );
    const canvas = eng.renderer.domElement, r = canvas.getBoundingClientRect();
    const frame  = () => new Promise<number>( ( res ) => requestAnimationFrame( res ) );
    const pt     = ( type: string, x: number, y: number, extra: PointerEventInit = {} ) => {
      const init = { clientX: r.left + x, clientY: r.top + y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 15, bubbles: true, ...extra };
      if ( type === "pointerup" ) window.dispatchEvent( new PointerEvent( type, init ) );
      else canvas.dispatchEvent( new PointerEvent( type, init ) );
    };
    // ( from the page, as a real key press comes: the window's capturing listeners first )
    const key      = ( k: string, mods: KeyboardEventInit = {} ) => document.body.dispatchEvent( new KeyboardEvent( "keydown", { key: k, bubbles: true, cancelable: true, ...mods } ) );
    // ( the cube this adds: the map may have models of its own )
    const existing = new Set( st().customObjects.map( ( o ) => o.uid ) );
    let cubeUid    = "";
    const piece    = () => st().customObjects.find( ( o ) => ( cubeUid ? o.uid === cubeUid : o.model && !existing.has( o.uid ) ) )!;
    const closed   = () => {
      const m = piece().model!.mesh;
      return [...edgesOf( m ).values()].every( ( e ) => e.faces.length === 2 && runs( m.f[e.faces[0]], e.a, e.b ) !== runs( m.f[e.faces[1]], e.a, e.b ) );
    };
    const counts = () => `${piece().model!.mesh.v.length} vertices, ${piece().model!.mesh.f.length} faces, closed ${closed()}, ${piece().colliders.length} colliders`;
    // the mouse in the view ( the editor listens only then )
    canvas.dispatchEvent( new PointerEvent( "pointerenter", { bubbles: true } ) );
    pt( "pointermove", r.width / 2, r.height / 2, { buttons: 0 } );
    await frame();
    // Shift+A › Cube
    key( "A", { shiftKey: true } );
    await sleep( 300 );
    const cubeItem = [...document.querySelectorAll<HTMLElement>( ".bmenu .lbl" )].find( ( e ) => e.textContent === "Cube" );
    log( `add menu: ${cubeItem ? "shown" : "not shown"}` );
    cubeItem?.closest<HTMLElement>( "button, .item, [role=menuitem], div" )?.click();
    await sleep( 500 );
    if ( !piece() ) throw new Error( "no cube added" );
    cubeUid = piece().uid;
    log( `cube added: ${counts()}; selected ${st().selection.map( ( s ) => s.kind ).join( "," )}` );
    key( "Tab" );
    await sleep( 300 );
    log( `edit mode: ${st().modelEdit ? "on" : "off"}` );
    key( "3" );
    await sleep( 200 );
    // click the cube's top face
    const o   = piece();
    const top = o.model!.mesh.f.findIndex( ( f ) => f.every( ( v ) => o.model!.mesh.v[v][1] > 0.9 ) );
    const c   = ( await import( "../../model/mesh" ) ).faceCenter( o.model!.mesh, top );
    const w   = new THREE.Vector3( c[0] + o.position.x, c[1] + o.position.y, -( c[2] + o.position.z ) ).project( eng.camera );
    const sx  = ( w.x * 0.5 + 0.5 ) * r.width, sy = ( -w.y * 0.5 + 0.5 ) * r.height;
    pt( "pointermove", sx, sy, { buttons: 0 } );
    pt( "pointerdown", sx, sy                 );
    pt( "pointerup",   sx, sy                 );
    await sleep( 200 );
    log( `top face clicked: ${st().modelEdit?.faces} face selected` );
    await ipc.writeBinary( joinPath( dir, "model-1-selected.png" ), await eng.pictures.capture() );
    // E, a typed 1, Enter: up a metre
    key( "e" );
    for ( const ch of "1" ) key( ch );
    key( "Enter" );
    await sleep( 300 );
    const ys = piece().model!.mesh.v.map( ( p ) => p[1] );
    log( `extruded: ${counts()}; top at ${Math.max( ...ys ).toFixed( 3 )} m` );
    // I and the mouse towards the middle, then a click
    key( "i" );
    pt( "pointermove", sx + 40, sy, { buttons: 0 } );
    key( "0"     );
    key( "."     );
    key( "3"     );
    key( "Enter" );
    await sleep( 300 );
    log( `inset 0.3: ${counts()}` );
    // Ctrl+B on the inset face's edges: edge mode, all of them ( the inset face selected stays )
    key( "2"                        );
    key( "b",     { ctrlKey: true } );
    key( "0"                        );
    key( "."                        );
    key( "1"                        );
    key( "Enter"                    );
    await sleep( 300 );
    log( `bevel 0.1: ${counts()}` );
    // Ctrl+R across the side: hover a side edge, click, right-click ( no slide )
    key( "a", { altKey: true } );
    log( `before loop cut: inside ${( eng as unknown as { mouseInside: boolean } ).mouseInside}, editing ${eng.modelEd.uid}, modal ${eng.modelEd.modal?.kind ?? "none"}, flying ${( eng as unknown as { controls: { flying: boolean } } ).controls.flying}` );
    key( "r", { ctrlKey: true } );
    log( `after Ctrl+R: modal ${eng.modelEd.modal?.kind ?? "none"}, camera ${st().cameraMode}` );
    // a vertical side edge, the one nearest the camera
    const mm  = piece().model!.mesh;
    const ed  = [...( await import( "../../model/mesh" ) ).edgesOf( mm ).values()].filter( ( x ) => Math.abs( mm.v[x.a][1] - mm.v[x.b][1] ) > 0.5 && Math.min( mm.v[x.a][1], mm.v[x.b][1] ) < 0 );
    const mid = ( x: { a: number; b: number } ) => new THREE.Vector3( ( mm.v[x.a][0] + mm.v[x.b][0] ) / 2 + o.position.x, ( mm.v[x.a][1] + mm.v[x.b][1] ) / 2 + o.position.y, -( ( mm.v[x.a][2] + mm.v[x.b][2] ) / 2 + o.position.z ) );
    ed.sort( ( p1, p2 ) => mid( p1 ).distanceTo( eng.camera.position ) - mid( p2 ).distanceTo( eng.camera.position ) );
    const side = mid( ed[0] ).project( eng.camera );
    const lx   = ( side.x * 0.5 + 0.5 ) * r.width, ly = ( -side.y * 0.5 + 0.5 ) * r.height;
    pt( "pointermove", lx, ly, { buttons: 0 } );
    await sleep( 100 );
    // the wheel while it's shown: a cut more, then back to one, the camera staying put
    const cam0  = eng.camera.position.clone();
    const wheel = ( dy: number ) => canvas.dispatchEvent( new WheelEvent( "wheel", { deltaY: dy, clientX: r.left + lx, clientY: r.top + ly, bubbles: true, cancelable: true } ) );
    const cuts  = () => ( eng.modelEd.modal as { cuts?: number } | null )?.cuts;
    wheel( -100 );
    await sleep( 100 );
    const up = cuts();
    wheel( 100 );
    await sleep( 100 );
    const moved = eng.camera.position.distanceTo( cam0 );
    log( `loop cut's wheel: ${up} cuts, then ${cuts()}; camera moved ${moved.toFixed( 3 )} m` );
    if ( up !== 2 || cuts() !== 1 || moved > 1e-6 ) throw new Error( "the wheel didn't set the loop cut's cuts" );
    pt( "pointerdown", lx, ly );
    pt( "pointerup",   lx, ly );
    key( "Enter" );
    await sleep( 300 );
    log( `loop cut: ${counts()}` );
    history.undo();
    await sleep( 200 );
    log( `undone: ${counts()}` );
    history.redo();
    const click = ( x: number, y: number ) => {
      pt( "pointermove", x, y, { buttons: 0 } );
      pt( "pointerdown", x, y                 );
      pt( "pointerup",   x, y                 );
    };
    // snapping: a top corner dragged onto another top corner ( vertex snapping )
    const scrOf = ( v: number ) => {
      const pc = piece(), q = pc.model!.mesh.v[v];
      const w2 = new THREE.Vector3( q[0] + pc.position.x, q[1] + pc.position.y, -( q[2] + pc.position.z ) ).project( eng.camera );
      return [( w2.x * 0.5 + 0.5 ) * r.width, ( -w2.y * 0.5 + 0.5 ) * r.height] as const;
    };
    key( "1" );
    const mv       = piece().model!.mesh.v;
    const topY     = Math.max( ...mv.map( ( q ) => q[1] ) );
    const tops     = mv.map( ( q, i ) => [q, i] as const ).filter( ( [q] ) => q[1] > topY - 1e-6 ).map( ( [, i] ) => i );
    const [va, vb] = [tops[0], tops.find( ( i ) => mv[i][0] !== mv[tops[0]][0] && mv[i][2] !== mv[tops[0]][2] ) ?? tops[1]];
    const [ax, ay] = scrOf( va ), [bx, by] = scrOf( vb );
    click( ax, ay );
    useEditor.setState( ( s2 ) => ( { modelTools: { ...s2.modelTools, snap: true, snapTo: "vertex" } } ) );
    key( "g" );
    pt( "pointermove", bx, by, { buttons: 0 } );
    key( "Enter" );
    await sleep( 200 );
    const m2 = piece().model!.mesh;
    log( `vertex snap: moved vertex ${Math.hypot( ...m2.v[va].map( ( x2, k ) => x2 - m2.v[vb][k] ) ) < 1e-4 ? "landed on" : "missed"} the other corner` );
    history.undo();
    useEditor.setState( ( s2 ) => ( { modelTools: { ...s2.modelTools, snap: false, proportional: true, propRadius: 3 } } ) );
    // proportional: one top corner up 1 m; its neighbours follow part of the way
    click( ...scrOf( va ) );
    const before = piece().model!.mesh.v.map( ( q ) => q[1] );
    // ( Blender's axes: Z is up )
    key( "g"     );
    key( "z"     );
    key( "1"     );
    key( "Enter" );
    await sleep( 200 );
    const after = piece().model!.mesh.v.map( ( q ) => q[1] );
    const rose  = after.map( ( y2, i ) => y2 - before[i] );
    log( `proportional: picked rose ${rose[va].toFixed( 2 )} m${Math.abs( rose[va] - 1 ) < 0.01 ? "" : " (FAIL)"}, others between 0 and 1: ${rose.filter( ( d, i ) => i !== va && d > 0.01 && d < 0.99 ).length} of ${rose.length - 1}` );
    history.undo();
    useEditor.setState( ( s2 ) => ( { modelTools: { ...s2.modelTools, proportional: false } } ) );
    key( "Tab" );
    await sleep( 300 );
    log( `object mode: ${st().modelEdit ? "still editing" : "back"}` );
    await ipc.writeBinary( joinPath( dir, "model-2-edited.png" ), await eng.pictures.capture() );
    // modifiers: mirror off its side, an array along X, a bevel
    const { MODIFIERS } = await import( "../../model/build"   );
    const { withModel } = await import( "../../model/objects" );
    const p             = piece();
    st().updateCustom( "Modifiers", [p.uid], ( x ) => withModel( x, { ...x.model!, modifiers: [MODIFIERS[1].make(), { ...MODIFIERS[3].make() }] } ) );
    await sleep( 500 );
    log( `with array + bevel: ${( await import( "../../model/build" ) ).evaluate( piece().model! ).f.length} faces evaluated, ${piece().colliders.length} colliders (${piece().colliders.map( ( x ) => x.shape ).join( "," )})` );
    await ipc.writeBinary( joinPath( dir, "model-3-modifiers.png" ), await eng.pictures.capture() );
    const { updateModelMeshes } = await import( "../../model/export" );
    await updateModelMeshes();
    await saveProject();
    const ex = await ipc.exportProject( proj, joinPath( dir, "model.jbrmap" ) );
    log( `exported: ${ex.objects} objects, ${( ex.bytes / 1e6 ).toFixed( 1 )} MB` );
    // the piece is the Assets workspace's ( not the map's ): saved as an asset, and opened again from it
    const AF     = await import( "../../pieces/assetFiles" );
    const faces0 = ( await import( "../../model/build" ) ).evaluate( piece().model! ).f.length;
    st().setSelection( [{ kind: "custom", uid: cubeUid }] );
    const savedOk = await AF.saveAsset( `Model test ${Date.now()}` );
    const ref     = AF.useAssetFile.getState().ref;
    await AF.newAsset();
    await sleep( 300 );
    if ( ref ) await AF.openAsset( ref.id, ref.name );
    await sleep( 1500 );
    const back   = st().customObjects.find( ( x ) => x.model );
    const faces1 = back ? ( await import( "../../model/build" ) ).evaluate( back.model! ).f.length : 0;
    log( `saved as an asset ${savedOk ? "" : "(FAIL) "}and opened again: ${back ? `${back.model!.mesh.f.length} faces, ${back.model!.modifiers.length} modifiers, ${faces1} evaluated${faces1 === faces0 ? "" : ` (FAIL: was ${faces0})`}` : "no modelled piece (FAIL)"}` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
