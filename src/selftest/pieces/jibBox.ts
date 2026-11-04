import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { newUid, useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/jibbox ): a cube stretched into a box ( 4 m along its own Z ) made a jib from
 * Riding's Jib button, as a person does: its rail along the box, as thick as its top is wide, the scale put into its
 * mesh. Logged "SNAP jib-box" for a screen capture from outside.
**/
export async function jibBoxSelftest( dir: string ) {
  try {
    const { newEmptyProject }               = await import( "../../map/project/sessions" );
    const { newModelObject }                = await import( "../../model/objects" );
    const { primitive }                     = await import( "../../model/mesh" );
    const { transformCustom, composeUnity } = await import( "../../core/transform" );
    await newEmptyProject( joinPath( dir, `jib-${Date.now()}.jbrproj` ), "Untitled" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await sleep( 2000 );
    const st  = () => useEditor.getState();
    const box = transformCustom( newModelObject( newUid(), primitive( "cube", { size: 1 } ), [0, 0, 0] ), composeUnity( [0, 0.25, 0], [0, 0, 0], [1, 0.5, 4] ) );
    st().addCustom( box, "Box" );
    st().setTool( "select" );
    st().setSelection( [{ kind: "custom", uid: box.uid }] );
    eng.nav.lookAtUnity( [5, 3, -3], [0, 0.25, 0] );
    await sleep( 800 );
    const jib = [...document.querySelectorAll<HTMLButtonElement>( ".seg button" )].find( ( b ) => b.textContent?.trim() === "Jib" );
    jib?.click();
    await waitFor( () => st().customObjects.find( ( o ) => o.uid === box.uid )?.rail, "its rail", 20000 );
    await sleep( 1500 );
    const o = st().customObjects.find( ( x ) => x.uid === box.uid )!, r = o.rail!;
    const a = new THREE.Vector3( ...r.points[0] ), b = new THREE.Vector3( ...r.points[r.points.length - 1] );
    const along = Math.abs( b.z - a.z ) > 3.5 && Math.abs( b.x - a.x ) < 0.05;
    const ok    = along && o.scale.x === 1 && o.scale.z === 1 && r.radius <= 0.5;
    log( `${ok ? "ok  " : "FAIL"} a stretched box made a jib: its rail ${r.points.length} points from ${a.toArray().map( ( v ) => v.toFixed( 2 ) )} to ${b.toArray().map( ( v ) => v.toFixed( 2 ) )} (along it ${along}), radius ${r.radius.toFixed( 3 )}, scale now ${o.scale.x},${o.scale.y},${o.scale.z}` );
    log( "SNAP jib-box" );
    await sleep( 2500 );
    // ( one of the game's boxes, a jib with its rail: scaled along X with the gizmo, its rail made boxes )
    const { loadLibrary, placeEntry } = await import( "../../pieces/library" );
    const { feature }                 = await import( "../harness" );
    const { isRailCollider }          = await import( "../../pieces/rail" );
    await loadLibrary();
    st().setTool( "select" );
    await placeEntry( feature( "flat_box" ), [8, 0, 0] );
    await sleep( 1500 );
    const fid = st().selection[0]?.uid;
    const fb  = () => st().customObjects.find( ( x ) => x.uid === fid )!;
    eng.nav.lookAtUnity( [14, 5, -6], [8, 0.3, 0] );
    useEditor.setState( { gizmoMode: "scale" } );
    eng.gizmo.sync();
    await sleep( 600 );
    const gp = eng.blGizmo as unknown as { pick( x: number, y: number ): { kind: string; axis: number } | null; pivot: THREE.Vector3 };
    const io = ( await import( "../harness" ) ).realInput( eng, () => "jibbox" );
    const [px, py] = io.scr( [gp.pivot.x, gp.pivot.y, -gp.pivot.z] );
    let grip: [number, number] | null = null;
    for ( let r = 20; r < 200 && !grip; r += 4 )
      for ( let a = 0; a < 360 && !grip; a += 8 ) {
        const x = px + r * Math.cos( ( a * Math.PI ) / 180 ), y = py + r * Math.sin( ( a * Math.PI ) / 180 ), h = gp.pick( x, y );
        if ( h?.kind === "axis" && h.axis === 0 ) grip = [x, y];
      }
    if ( grip ) await io.drag( ...grip, grip[0] + ( grip[0] - px ) * 1.5, grip[1] + ( grip[1] - py ) * 1.5, 500 );
    useEditor.setState( { gizmoMode: "translate" } );
    await sleep( 600 );
    const scaled = fb().scale.x > 1.3 && Math.abs( fb().scale.y - 1 ) < 1e-6;
    const boxBtn = [...document.querySelectorAll<HTMLButtonElement>( ".seg button" )].find( ( b ) => b.textContent?.trim() === "Box" );
    boxBtn?.click();
    await sleep( 800 );
    const caps    = fb().colliders.filter( isRailCollider );
    const deg     = Math.PI / 180;
    // ( each box's own up, its Z, straight up; not stretched )
    const zUp     = ( c: ( typeof caps )[number] ) => new THREE.Vector3().setFromMatrixColumn( new THREE.Matrix4().makeRotationY( c.local_rotation.y * deg ).multiply( new THREE.Matrix4().makeRotationX( c.local_rotation.x * deg ) ).multiply( new THREE.Matrix4().makeRotationZ( c.local_rotation.z * deg ) ), 2 ).y;
    const upright = caps.length > 0 && caps.every( ( c ) => c.shape === "Box" && Math.abs( c.local_scale.x - 1 ) < 1e-6 && Math.abs( c.local_scale.z - 1 ) < 1e-6 && zUp( c ) > 0.999 );
    log( `${scaled && upright ? "ok  " : "FAIL"} the game's flat box scaled ${fb().scale.x.toFixed( 2 )} along X with the gizmo ${scaled}; its rail ${caps.length} ${caps[0]?.shape ?? "none"} colliders, upright and not stretched ${upright}` );
    eng.nav.lookAtUnity( [14, 5, -6], [8, 0.3, 0] );
    log( "SNAP jib-flatbox" );
    await sleep( 2500 );
    log( ok && scaled && upright ? "SELFTEST OK" : "SELFTEST FAILED: the boxes' rails" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
