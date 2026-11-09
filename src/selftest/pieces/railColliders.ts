import * as THREE from "three/webgpu";
import { toUnity } from "../../core/coords";
import { joinPath } from "../../core/ipc";
import type { CustomObjectEntry } from "../../core/types";
import { history } from "../../map/history";
import { useEditor } from "../../map/store";
import { CURVE_PRESETS } from "../../model/curve";
import { colliderInView, railRuns, type RailRun } from "../../pieces/rail";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/railcolliders ): a rail's colliders picked and changed one at a time, as a person
 * does: a Box Rail added and bent, one of its boxes clicked ( the gizmo on it, in its own axes ), R and the mouse round
 * it ( tilted ), G ( moved ), undone; a point added; done; the rail moved on the gizmo; saved and opened again: that box
 * still tilted where it was along the rail, the rest as the rail makes them.
**/
export async function railCollidersSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const P    = await import( "../../map/project" );
    const proj = joinPath( dir, `rails-${Date.now()}.jbrproj` );
    await P.newEmptyProject( proj, "Rail Colliders" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await sleep( 1500 );
    const st    = () => useEditor.getState();
    const io    = realInput( eng, () => "rail" );
    const piece = ( uid: string ) => st().customObjects.find( ( o ) => o.uid === uid )!;
    const runs  = ( o: CustomObjectEntry ) => railRuns( o, o.rail! );
    const deg   = ( r: RailRun ) => THREE.MathUtils.radToDeg( colliderInView( r.auto ).q.angleTo( colliderInView( r.made ).q ) );
    const moved = ( r: RailRun ) => colliderInView( r.auto ).at.distanceTo( colliderInView( r.made ).at );
    const tilts = ( o: CustomObjectEntry ) => runs( o ).map( ( r ) => deg( r ) );
    const button = ( text: string ) => [...document.querySelectorAll<HTMLButtonElement>( "button" )].find( ( b ) => b.textContent?.trim() === text );
    // ---- a Box Rail, its points out to edit, bent ( a point added in the middle, raised and pushed out )
    await io.glide( io.rc.width / 2, io.rc.height / 2, 200 );
    eng.menus.addCurveInView( CURVE_PRESETS.find( ( p ) => p.label === "Box Rail" )! );
    await sleep( 800 );
    const uid = st().customObjects.find( ( o ) => o.model?.curve )?.uid ?? "";
    check( !!uid && st().railEdit?.uid === uid, "a Box Rail added, its points out to edit" );
    eng.rails.commit( "Move rail point", [[-2, 0, 0], [0, 0.4, 0.8], [2, 0, 0]] );
    await sleep( 500 );
    const o0 = piece( uid ), at = o0.position;
    log( `bent: ${runs( o0 ).length} boxes along it` );
    eng.nav.lookAtUnity( [at.x + 0.5, at.y + 2.2, at.z - 4.5], [at.x, at.y + 0.2, at.z + 0.3] );
    await sleep( 1200 );
    // ---- one of its boxes clicked: picked, the gizmo on it
    const n  = runs( o0 ).length, i = Math.floor( n / 3 );
    const c0 = colliderInView( eng.railTool.run( i )!.made );
    const sp = io.scr( toUnity( c0.at ) );
    await io.click( sp[0], sp[1] );
    await sleep( 400 );
    const picked = st().railEdit?.collider;
    check( picked !== null && picked !== undefined && Math.abs( picked - i ) <= 1 && eng.blGizmo.attached, `a box clicked: collider ${picked} picked ( aimed at ${i} ), gizmo ${eng.blGizmo.attached ? "on it" : "missing"}` );
    const k = picked ?? i;
    // ---- the Rotate tool, then R and the mouse round it: tilted
    document.querySelector<HTMLButtonElement>( '.tool-column button[title="Rotate"]' )?.click();
    await sleep( 300 );
    const pv = io.scr( toUnity( colliderInView( eng.railTool.run( k )!.made ).at ) );
    await io.glide( pv[0] + 120, pv[1], 200 );
    await io.key( "r" );
    await io.glide( pv[0] + 85, pv[1] - 85, 350 );
    await io.click( pv[0] + 85, pv[1] - 85, 30 );
    await sleep( 400 );
    let o = piece( uid ), t = tilts( o );
    check( t[k] > 20 && t.every( ( d, j ) => j === k || d < 1e-3 ), `R and the mouse round it: that box tilted ${t[k].toFixed( 1 )}°, the rest ${t.filter( ( _, j ) => j !== k ).every( ( d ) => d < 1e-3 ) ? "as made" : "turned too (FAIL)"}; undo step "${history.nextUndo}"` );
    const tilt = t[k];
    // ( and the game gets it: the piece's own box is that one )
    check( o.colliders.some( ( c ) => c.mesh_ref === "studio-rail" && JSON.stringify( c.local_rotation ) === JSON.stringify( runs( o )[k].made.local_rotation ) ), "the piece's colliders: that box as tilted" );
    log( "SNAP tilted" );
    await sleep( 1500 );
    // ---- G: moved; undone, still tilted
    await io.key( "g" );
    await io.glide( pv[0] + 85, pv[1] - 125, 300 );
    await io.click( pv[0] + 85, pv[1] - 125, 30 );
    await sleep( 400 );
    const shifted = moved( runs( piece( uid ) )[k] );
    await io.key( "z", { ctrl: true } );
    await sleep( 400 );
    o = piece( uid );
    check( shifted > 0.02 && moved( runs( o )[k] ) < 1e-4 && Math.abs( tilts( o )[k] - tilt ) < 0.01, `G: moved ${shifted.toFixed( 3 )} m; undone: ${moved( runs( o )[k] ).toFixed( 4 )} m, still tilted ${tilts( o )[k].toFixed( 1 )}°` );
    // ---- a point added ( Properties ): that box still tilted, where it was
    const where = colliderInView( runs( o )[k].made ).at;
    st().setTool( "select" );
    useEditor.setState( { gizmoMode: "translate", railEdit: { uid, point: 0, collider: null } } );
    await sleep( 300 );
    button( "Add point" )?.click();
    await sleep( 600 );
    o = piece( uid );
    const after = runs( o ), one = after.filter( ( r ) => r.tweak );
    check( o.model!.curve!.splines[0].points.length === 4 && one.length === 1 && Math.abs( deg( one[0] ) - tilt ) < 0.05 && colliderInView( one[0].made ).at.distanceTo( where ) < 0.35, `a point added ( ${o.model!.curve!.splines[0].points.length} now ): ${one.length} box tilted, ${one[0] ? deg( one[0] ).toFixed( 1 ) : "?"}°, ${one[0] ? colliderInView( one[0].made ).at.distanceTo( where ).toFixed( 2 ) : "?"} m from where it was` );
    // ---- done; the rail moved on the Move gizmo's X arrow: still tilted, at its place along it
    button( "Done" )?.click();
    await sleep( 300 );
    st().setSelection( [{ kind: "custom", uid }] );
    await sleep( 400 );
    const p0    = piece( uid ).position, piv = new THREE.Vector3( p0.x, p0.y, -p0.z );
    const [px, py] = eng.screenOf( piv ), [ax, ay] = eng.screenOf( piv.clone().add( new THREE.Vector3( 0.6, 0, 0 ) ) );
    const len   = Math.hypot( ax - px, ay - py ), ux = ( ax - px ) / len, uy = ( ay - py ) / len;
    let hx = px, hy = py;
    for ( let d = 20; d < 160; d += 4 ) if ( eng.blGizmo.hoverAt( px + ux * d, py + uy * d ) && eng.blGizmo.hover?.kind === "axis" && eng.blGizmo.hover.axis === 0 ) { hx = px + ux * d; hy = py + uy * d; break; }
    await io.drag( hx, hy, hx + ux * 120, hy + uy * 120, 500 );
    await sleep( 500 );
    o = piece( uid );
    const lo = one[0]?.lo, mine = runs( o ).filter( ( r ) => r.tweak );
    check( Math.abs( o.position.x - p0.x ) > 0.3 && mine.length === 1 && Math.abs( deg( mine[0] ) - tilt ) < 0.05 && Math.abs( mine[0].lo - ( lo ?? -1 ) ) < 1e-6, `moved ${( o.position.x - p0.x ).toFixed( 2 )} m on X: the box still tilted ${mine[0] ? deg( mine[0] ).toFixed( 1 ) : "?"}°, at the same place along the rail` );
    io.stop();
    // ---- saved and opened again
    await P.saveProject();
    await P.openProject( proj );
    await waitFor( () => ( st().customObjects.some( ( x ) => x.uid === uid ) ? true : null ), "opened again", 60000 );
    await sleep( 800 );
    o = piece( uid );
    const all  = runs( o ), back = all.filter( ( r ) => r.tweak );
    check( back.length === 1 && Math.abs( deg( back[0] ) - tilt ) < 0.05 && o.colliders.some( ( c ) => JSON.stringify( c.local_rotation ) === JSON.stringify( back[0].made.local_rotation ) ), `saved and opened again: ${back.length} box tilted ${back[0] ? deg( back[0] ).toFixed( 1 ) : "?"}°, in the piece's colliders` );
    // ---- shown picked, for a look
    useEditor.setState( { selection: [{ kind: "custom", uid }], railEdit: { uid, point: null, collider: all.indexOf( back[0] ) }, gizmoMode: "rotate" } );
    const q = o.position;
    eng.nav.lookAtUnity( [q.x + 0.5, q.y + 2.2, q.z - 4.5], [q.x, q.y + 0.2, q.z + 0.3] );
    await sleep( 1500 );
    log( "SNAP picked" );
    await sleep( 1500 );
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
