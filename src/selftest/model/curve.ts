import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/curve ): a project in the folder ( a copy ) in the Modelling workspace: a kinked rail
 * added from Shift+A, its end point extruded and a point added with Ctrl+click in Edit Mode, the kink made smooth and
 * back, legs added and joined to it; its colliders checked; views left in the folder.
**/
export async function curveSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st = () => useEditor.getState();
    const g  = ( x: number, z: number ) => terrain.heightAt( x, z );
    st().setTool( "model" );
    const at: [number, number] = [30, 30];
    eng.nav.lookAtUnity( [at[0] + 1, g( at[0], at[1] ) + 4, at[1] - 7], [at[0], g( at[0], at[1] ) + 0.6, at[1]] );
    await sleep( 800 );
    const canvas = eng.renderer.domElement, r = canvas.getBoundingClientRect();
    const pt     = ( type: string, x: number, y: number, extra: PointerEventInit = {} ) => {
      const init = { clientX: r.left + x, clientY: r.top + y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 17, bubbles: true, ...extra };
      if ( type === "pointerup" ) window.dispatchEvent( new PointerEvent( type, init ) );
      else canvas.dispatchEvent( new PointerEvent( type, init ) );
    };
    const key   = ( k: string, mods: KeyboardEventInit = {} ) => document.body.dispatchEvent( new KeyboardEvent( "keydown", { key: k, bubbles: true, cancelable: true, ...mods } ) );
    const click = ( x: number, y: number, extra: PointerEventInit = {} ) => {
      pt( "pointermove", x, y, { buttons: 0 } );
      pt( "pointerdown", x, y, extra          );
      pt( "pointerup",   x, y, extra          );
    };
    const menu = async ( label: string ) => {
      await sleep( 250 );
      const b = [...document.querySelectorAll<HTMLElement>( ".bmenu .lbl" )].find( ( e ) => e.textContent === label );
      b?.closest<HTMLElement>( "button" )?.click();
      await sleep( 400 );
      return !!b;
    };
    canvas.dispatchEvent( new PointerEvent( "pointerenter", { bubbles: true } ) );
    pt( "pointermove", r.width / 2, r.height / 2, { buttons: 0 } );
    key( "A", { shiftKey: true } );
    log( `Kinked Rail in the add menu: ${await menu( "Kinked Rail" )}` );
    const rail = () => st().customObjects.find( ( o ) => o.model?.curve )!;
    const info = () => {
      const o = rail();
      return `${o.model!.curve!.splines.map( ( s ) => s.points.length ).join( "+" )} points, ${o.colliders.length} colliders (${[...new Set( o.colliders.map( ( c ) => `${c.shape}/${c.surface_type}` ) )].join( ", " )}), rail ${o.rail ? `${o.rail.points.length} points` : "none"}`;
    };
    log( `added: ${info()}` );
    await ipc.writeBinary( joinPath( dir, "curve-1-added.png" ), await eng.pictures.capture() );
    key( "Tab" );
    await sleep( 200 );
    log( `edit mode: ${eng.curveEd.uid ? "curve" : eng.modelEd.uid ? "mesh (wrong)" : "off"}` );
    // the last point, clicked
    const o   = rail();
    const pts = o.model!.curve!.splines[0].points;
    const end = pts[pts.length - 1].p;
    const w   = new THREE.Vector3( end[0] + o.position.x, end[1] + o.position.y, -( end[2] + o.position.z ) ).project( eng.camera );
    const ex  = ( w.x * 0.5 + 0.5 ) * r.width, ey = ( -w.y * 0.5 + 0.5 ) * r.height;
    click( ex, ey );
    log( `end clicked: ${eng.curveEd.sel.size} point selected` );
    // E, X, 1.5, Enter: on along X by 1.5 m
    key( "e" );
    key( "x" );
    for ( const ch of "1.5" ) key( ch );
    key( "Enter" );
    await sleep( 200 );
    log( `extruded: ${info()}` );
    // Ctrl+click further on: another point there
    click( ex + 120, ey + 10, { ctrlKey: true } );
    await sleep( 200 );
    log( `Ctrl+click: ${info()}` );
    // the kink smooth ( V › Smooth ), then undone
    key( "a" );
    key( "v" );
    await menu( "Smooth" );
    log( `all smooth: sharp points ${rail().model!.curve!.splines[0].points.filter( ( q ) => q.sharp ).length}` );
    history.undo();
    log( `undone: sharp points ${rail().model!.curve!.splines[0].points.filter( ( q ) => q.sharp ).length}` );
    key( "Tab" );
    await sleep( 200 );
    await ipc.writeBinary( joinPath( dir, "curve-2-edited.png" ), await eng.pictures.capture() );
    // two legs, joined to the rail
    const { newCurveObject } = await import( "../../model/objects" );
    const { newCurve       } = await import( "../../model/curve"   );
    const base               = rail().position;
    const legs               = [-2.4, 0.6].map( ( dx, i ) => newCurveObject( `leg${i}`, { ...newCurve( [[0, -0.6, 0], [0, 0, 0]] ), radius: 0.03 }, [base.x + dx, base.y, base.z], false ) );
    for ( const l of legs ) st().addCustom( l );
    st().setSelection( [...legs.map( ( l ) => ( { kind: "custom" as const, uid: l.uid } ) ), { kind: "custom", uid: rail().uid }] );
    const railUid = rail().uid;
    eng.modelling.joinSelected();
    await sleep( 500 );
    const joined = st().customObjects.find( ( x ) => x.uid === railUid )!;
    log( `joined: ${st().customObjects.filter( ( x ) => x.model ).length} modelled piece(s); splines ${joined.model!.curve?.splines.length}; rail ${joined.rail ? `${joined.rail.points.length} points` : "none"}; ${joined.colliders.length} colliders (${[...new Set( joined.colliders.map( ( c ) => `${c.shape}/${c.surface_type}` ) )].join( ", " )})` );
    await ipc.writeBinary( joinPath( dir, "curve-3-joined.png" ), await eng.pictures.capture() );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
