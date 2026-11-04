import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { history } from "../../map/history";
import { log, realInput, sleep, waitFor } from "../harness";
import { newUid, useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/toolsparity ): the Map-Tools features and the fence builder driven as a person
 * does, on a new 1 km map: a fence added and drawn by clicking the ground, a point of it dragged, undone; a piece
 * copied in a row ( Duplicate Array ) and the row made longer after; a piece's moving part previewed in the view and
 * stopped; a formation's outline clicked on the ground and closed; an arch rail added; the map exported with its
 * moving piece and fence. Anything not as it should be is said with FAIL.
**/
export async function toolsParitySelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok" : "FAIL"}: ${what}` ); };
  try {
    const { newProject }                      = await import( "../../map/project" );
    const { LAYOUTS }                         = await import( "../../terrain/generate" );
    const { fenceOf }                         = await import( "../../pieces/fence" );
    const { transformCustom, composeUnity }   = await import( "../../core/transform" );
    const { newModelObject }                  = await import( "../../model/objects" );
    const { primitive }                       = await import( "../../model/mesh" );
    const { CURVE_PRESETS }                   = await import( "../../model/curve" );
    const { useMotionPreview, newMovingPart } = await import( "../../pieces/motion" );
    const { redoOp }                          = await import( "../../app/lastOp" );
    const proj                                = joinPath( dir, `parity-${Date.now()}.jbrproj` );
    await newProject( proj, "Parity", { layout: LAYOUTS[0], base: "slope", slopeDeg: 6, heightRange: 1200, seed: 3 } );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 2000 );
    useEditor.setState( { splash: false } );
    const st = () => useEditor.getState();
    st().setTool( "select" );
    const io = realInput( eng, () => "parity" );
    // a click on the ground at ( x, z ), the view brought round to look at it first
    const look = async ( x: number, z: number, far = 40 ) => {
      const g = terrain.heightAt( x, z );
      eng.nav.lookAtUnity( [x - far * 0.6, g + far * 0.8, z - far * 0.6], [x, g, z] );
      await sleep( 250 );
    };
    const clickAt = async ( x: number, z: number, extra: Record<string, unknown> = {} ) => {
      await look( x, z );
      const [sx, sy] = io.scr( [x, terrain.heightAt( x, z ), z] );
      await io.click( sx, sy, 200, extra );
      await sleep( 300 );
    };

    // ---- the fence: a board of your own ( a cube made 2.4 m long ) made a fence; then, picked, three more points
    // Ctrl+clicked in
    await look( 0, 0, 60 );
    const board = transformCustom( newModelObject( newUid(), primitive( "cube", { size: 1 } ), [0, 0, 0] ), composeUnity( [0, terrain.heightAt( 0, 0 ) + 0.5, 0], [0, 0, 0], [2.4, 1, 0.1] ) );
    st().addCustom( board, "Board" );
    st().setSelection( [{ kind: "custom", uid: board.uid }] );
    await eng.menus.makeFence();
    const fenceUid = st().selection[0]?.uid;
    await sleep( 500 );
    const f0 = st().customObjects.find( ( o ) => o.uid === fenceUid )!;
    check( !!f0 && fenceOf( f0 )?.points.length === 2 && !st().customObjects.some( ( o ) => o.uid === board.uid ), `fence made of a board, the board gone into it: ${fenceOf( f0 )?.points.length} points ( 2 wanted )` );
    // ( one undo step: the board back, no fence; redone, the fence again )
    history.undo();
    await sleep( 200 );
    const undone = st().customObjects.some( ( o ) => o.uid === board.uid ) && !st().customObjects.some( ( o ) => o.uid === fenceUid );
    history.redo();
    await sleep( 200 );
    check( undone && st().customObjects.some( ( o ) => o.uid === fenceUid ) && !st().customObjects.some( ( o ) => o.uid === board.uid ), "Make Repeat undone in one step, and redone" );
    st().setSelection( [{ kind: "custom", uid: fenceUid }] );
    const w0 = [f0.position.x, f0.position.z];
    for ( const [dx, dz] of [[8, 4], [14, 10], [16, 18]] ) await clickAt( w0[0] + dx, w0[1] + dz, { ctrlKey: true } );
    let fence = st().customObjects.find( ( o ) => o.uid === fenceUid )!;
    check( fenceOf( fence )?.points.length === 5, `fence points Ctrl+clicked in: ${fenceOf( fence )?.points.length} points ( 5 wanted )` );
    check( fence.parts[0].materials.length === 1 && fence.colliders.length > 0, `repeat made: ${fence.colliders.length} colliders, ${fence.parts[0].materials.length} material ( the board's )` );
    check( fence.surface_type === board.surface_type && !fence.rail, `the repeat rides as the board did: ${fence.surface_type}` );
    // ( a click without Ctrl doesn't add one )
    await clickAt( w0[0] - 10, w0[1] - 10 );
    fence = st().customObjects.find( ( o ) => o.uid === fenceUid )!;
    check( fenceOf( fence )?.points.length === 5, "a plain click adds no point" );
    st().setSelection( [{ kind: "custom", uid: fenceUid }] );
    // a point dragged over the ground, then undone
    st().setSelection( [{ kind: "custom", uid: fenceUid }] );
    await sleep( 300 );
    const last = fenceOf( fence )!.points[4], lw = [fence.position.x + last[0], fence.position.z + last[1]];
    await look( lw[0], lw[1] );
    const ly       = terrain.heightAt( lw[0], lw[1] ) + 0.3;
    const [hx, hy] = io.scr( [lw[0], ly, lw[1]] ), [tx, ty] = io.scr( [lw[0] + 6, terrain.heightAt( lw[0] + 6, lw[1] ), lw[1]] );
    await io.drag( hx, hy, tx, ty, 400 );
    await sleep( 400 );
    const moved = fenceOf( st().customObjects.find( ( o ) => o.uid === fenceUid )! )!.points[4];
    check( Math.hypot( moved[0] - last[0], moved[1] - last[1] ) > 3, `fence point dragged ${Math.hypot( moved[0] - last[0], moved[1] - last[1] ).toFixed( 1 )} m` );
    history.undo();
    await sleep( 300 );
    const back = fenceOf( st().customObjects.find( ( o ) => o.uid === fenceUid )! )!.points[4];
    check( Math.hypot( back[0] - last[0], back[1] - last[1] ) < 0.01, "the drag undone in one step" );

    // ---- Duplicate Array, then made longer in its panel
    const cube = newModelObject( newUid(), primitive( "cube", { size: 1 } ), [w0[0] + 30, terrain.heightAt( w0[0] + 30, w0[1] ) + 0.5, w0[1]] );
    st().addCustom( cube, "Cube" );
    st().setSelection( [{ kind: "custom", uid: cube.uid }] );
    const n0 = st().customObjects.length;
    eng.menus.duplicateArray();
    await sleep( 300 );
    check( st().customObjects.length === n0 + 3, `Duplicate Array: ${st().customObjects.length - n0} copies ( 3 wanted )` );
    redoOp( "count", 5 );
    await sleep( 300 );
    check( st().customObjects.length === n0 + 5, `made longer in its panel: ${st().customObjects.length - n0} copies ( 5 wanted )` );
    const row = st().customObjects.slice( n0 ).map( ( o ) => o.position.x - cube.position.x );
    check( row.every( ( d, k ) => Math.abs( d - 2 * ( k + 1 ) ) < 1e-4 ), `the copies 2 m apart: ${row.map( ( d ) => d.toFixed( 1 ) ).join( ", " )}` );

    // ---- a moving part: the cube spinning, seen moving in the view, put back when stopped
    st().updateCustom( "Add moving part", [cube.uid], ( o ) => ( { ...o, motions: [{ ...newMovingPart(), kind: "spin", axis: "y", speed: 0.5 }] } ) );
    st().setSelection( [{ kind: "custom", uid: cube.uid }] );
    await sleep( 800 );
    const meshOf = () => eng.customR.objectGroup( cube.uid )?.children[0] as { geometry: { getAttribute: ( n: string ) => { array: ArrayLike<number> } } } | undefined;
    const shared = meshOf()?.geometry;
    const rest   = Array.from( shared?.getAttribute( "position" ).array ?? [] );
    useMotionPreview.setState( { on: true, playing: true, t: 0 } );
    await sleep( 1200 );
    const now = Array.from( meshOf()?.geometry.getAttribute( "position" ).array ?? [] );
    check( now.length === rest.length && now.some( ( v, k ) => Math.abs( v - rest[k] ) > 0.01 ), "the moving part turns in the preview" );
    useMotionPreview.setState( { on: false, t: 0 } );
    await sleep( 600 );
    check( meshOf()?.geometry === shared, "stopped: back on the shared geometry, at rest" );

    // ---- a formation: its outline clicked on the ground, closed with Enter
    const fc = [w0[0] + 150, w0[1] + 150], before = terrain.heightAt( fc[0], fc[1] );
    useEditor.setState( { tool: "shape", shapeKind: "formation" } );
    await sleep( 300 );
    for ( const [dx, dz] of [[-40, -40], [40, -40], [40, 40], [-40, 40]] ) await clickAt( fc[0] + dx, fc[1] + dz );
    await io.key( "Enter" );
    await sleep( 800 );
    const form = st().shapes.find( ( s ) => s.kind === "formation" );
    check( !!form && form.kind === "formation" && form.points.length === 4, `formation drawn: ${form && form.kind === "formation" ? form.points.length : 0} points` );
    check( terrain.heightAt( fc[0], fc[1] ) - before > 10, `the ground raised ${( terrain.heightAt( fc[0], fc[1] ) - before ).toFixed( 1 )} m in its middle` );
    st().setTool( "select" );

    // ---- an arch rail
    const arch = eng.menus.addCurveInView( CURVE_PRESETS.find( ( p ) => p.label === "Arch" )! );
    const ao   = st().customObjects.find( ( o ) => o.uid === arch );
    check( !!ao?.model?.curve?.arch && ao.model.curve.splines[0].points.length === 9, "Add › Rail › Arch: an arch rail" );

    // ---- exported, as Export does it ( the modelled pieces' meshes into the map's library first ): the moving piece's
    // meshes baked to move, the fence's in
    await ( await import( "../../model/export" ) ).updateModelMeshes();
    await P_save();
    const out = joinPath( dir, "parity.jbrmap" );
    await ipc.exportProject( proj, out );
    const text = await ipc.readText( out );
    check( text.includes( "#move-" ) && text.includes( "_MOVING_PARTS" ), "exported: the moving piece's meshes baked to move" );
    check( text.split( `Models/${fenceUid}/mesh` ).length > 2, "exported: the fence's mesh ( its part and the mesh itself )" );
    io.stop();
  } catch ( e ) {
    fails.push( String( e instanceof Error ? e.stack ?? e.message : e ) );
    log( `FAIL: ${e instanceof Error ? e.stack ?? e.message : e}` );
  }
  log( fails.length ? `${fails.length} problems:\n${fails.join( "\n" )}` : "every step as it should be" );
  log( "SELFTEST OK" );
}

/**
 * The project saved ( the export reads it from disk ).
**/
async function P_save() {
  const { saveProject } = await import( "../../map/project" );
  await saveProject();
}
