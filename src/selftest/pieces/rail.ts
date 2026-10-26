import { LAYOUTS } from "../../terrain/generate";
import * as THREE from "three/webgpu";
import { feature, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { joinPath } from "../../core/ipc";
import { loadLibrary, placeEntry } from "../../pieces/library";
import { newProject } from "../../map/project";
import { railShellsUp } from "./railShells";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/rail ): grind rails — made along official pieces as they're placed ( c_rail and
 * tube_long; not flat_box, slid on flat; not the spiral, which doubles back ), lying on the piece's top; then edited:
 * a point dragged through the gizmo, one added, one deleted, all undone. SHOTs of the rail being edited.
**/
export async function railSelftest( dir: string ) {
  try {
    const proj = joinPath( dir, `rail-${Date.now()}.jbrproj` );
    await newProject( proj, "Rail Test", { layout: LAYOUTS[0], base: "slope", slopeDeg: 6, heightRange: 1200, seed: 5 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await loadLibrary();
    const st       = useEditor.getState;
    const g        = ( x: number, z: number ) => terrain.heightAt( x, z );
    const railCaps = ( uid: string ) => st().customObjects.find( ( o ) => o.uid === uid )!.colliders.filter( ( c ) => c.mesh_ref === "studio-rail" ).length;
    for ( const [id, x] of [["c_rail", 0], ["tube_long", -5], ["flat_box", -9], ["spiral_rail", 9]] as const ) {
      await placeEntry( feature( id ), [x, g( x, 0 ), 0], [0, 0, 0] );
      const o = st().customObjects[st().customObjects.length - 1];
      let fit = "";
      if ( o.rail ) {
        // the rail's top against the piece's top surface, around each of its points but the two ends ( rounded off )
        const pts = ( await eng.customR.localVertices( o ) )!;
        let worst = 0;
        for ( const p of o.rail.points.slice( 1, -1 ) ) {
          let top = -Infinity;
          for ( let i = 0; i < pts.length; i += 3 ) if ( Math.abs( pts[i] - p[0] ) < 0.03 && Math.abs( pts[i + 2] - p[2] ) < 0.04 ) top = Math.max( top, pts[i + 1] );
          if ( top > -Infinity ) worst = Math.max( worst, Math.abs( p[1] + o.rail.radius - top ) );
        }
        fit = o.rail.points.length > 2 ? `, its top within ${( worst * 100 ).toFixed( 1 )} cm of the piece's` : "";
      }
      // ( no rail: why not — what it's ridden as, and what the rail finder said of its shape )
      let why = "";
      if ( !o.rail ) {
        const { autoRail } = await import( "../../pieces/rail" );
        const pts          = await eng.customR.localVertices( o );
        why                = ` (surface ${o.surface_type}, from ${feature( id )}, ${pts ? `${pts.length / 3} corners, finder: ${autoRail( pts ).why ?? "a rail"}` : "no mesh yet"})`;
      }
      log( `${id}: ${o.rail ? `rail of ${o.rail.points.length} points, ${( o.rail.radius * 200 ).toFixed( 1 )} cm thick, ${railCaps( o.uid )} capsules, setting ${o.intended_up_method}${fit}` : `no rail, setting ${o.intended_up_method}${why}`}` );
    }
    // the Riding section's surface buttons: Generic takes a rail away, Jib makes it again
    const tube = st().customObjects.find( ( o ) => o.parts[0].mesh.startsWith( "Features/tube_long/" ) )!;
    st().setSelection( [{ kind: "custom", uid: tube.uid }] );
    await sleep( 800 );
    const surface = ( label: string ) => [...document.querySelectorAll( ".seg button" )].find( ( b ) => b.textContent === label ) as HTMLButtonElement | undefined;
    surface( "Generic" )?.click();
    await sleep( 500 );
    log( `tube_long set to Generic: rail ${st().customObjects.find( ( o ) => o.uid === tube.uid )!.rail ? "still there" : "gone"}, setting ${st().customObjects.find( ( o ) => o.uid === tube.uid )!.intended_up_method}` );
    surface( "Jib" )?.click();
    await waitFor( () => st().customObjects.find( ( o ) => o.uid === tube.uid )!.rail, "a rail made on choosing Jib", 15000 );
    const tube2 = st().customObjects.find( ( o ) => o.uid === tube.uid )!;
    log( `tube_long set to Jib: magnetize ${tube2.can_magnetize}, mesh collidable ${tube2.rail!.solid}, rail of ${tube2.rail!.points.length} points, ${tube2.colliders.filter( ( c ) => c.mesh_ref === "studio-rail" ).length} capsules, setting ${tube2.intended_up_method}` );
    const crail = st().customObjects.find( ( o ) => o.parts[0].mesh.startsWith( "Features/c_rail/" ) )!;
    st().setSelection( [{ kind: "custom", uid: crail.uid }] );
    await waitFor( () => eng.customR.guides.of( crail.uid ), "c_rail guide", 20000 );
    const gd      = eng.customR.guides.of( crail.uid )!;
    // the arrow: halfway along the whole line, by length
    const lineLen = gd.lines.reduce( ( sum, l ) => sum + l.slice( 1 ).reduce( ( d, p, k ) => d + p.distanceTo( l[k] ), 0 ), 0 );
    let walked    = 0, nearest = Infinity, atLength = 0;
    for ( const l of gd.lines ) for ( let k = 1; k < l.length; k++ ) {
      const d   = l[k].distanceTo( l[k - 1] );
      const t   = Math.max( 0, Math.min( 1, gd.mid.clone().sub( l[k - 1] ).dot( l[k].clone().sub( l[k - 1] ) ) / ( d * d || 1 ) ) );
      const off = l[k - 1].clone().lerp( l[k], t ).distanceTo( gd.mid );
      if ( off < nearest ) { nearest = off; atLength = walked + t * d; }
      walked += d;
    }
    log( `c_rail guide: ${gd.lines.length} lines, ${gd.ok ? "ok" : gd.problem}; arrow at ${( ( atLength / lineLen ) * 100 ).toFixed( 0 )}% of the line's length` );
    eng.nav.lookAtUnity( [0, g( 0, 5 ) + 4, 5], [0, g( 0, -1.1 ) + 0.4, -1.1] );
    await sleep( 1500 );
    log( "SHOT railguide" );
    await sleep( 4000 );
    log( "SHOT riding" );
    await sleep( 3000 );
    // editing: point 1 picked, dragged 0.3 m up through the gizmo as a mouse drag would
    useEditor.setState( { railEdit: { uid: crail.uid, point: 1 } } );
    await sleep( 800 );
    log( "SHOT railedit" );
    await sleep( 4000 );
    // ( the gizmo's own drag, as its handle would give it: a change in the view's space )
    const gz      = eng.blGizmo;
    const pivotOf = () => ( gz as unknown as { pivot: THREE.Vector3 } ).pivot.clone();
    const y0      = st().customObjects.find( ( o ) => o.uid === crail.uid )!.rail!.points[1][1];
    gz.onStart!();
    gz.onChange!( new THREE.Matrix4().makeTranslation( 0, 0.3, 0 ) );
    gz.onEnd!();
    const moved = st().customObjects.find( ( o ) => o.uid === crail.uid )!;
    log( `dragged point 1 up 0.3 m: ${y0.toFixed( 3 )} -> ${moved.rail!.points[1][1].toFixed( 3 )}, ${railCaps( crail.uid )} capsules` );
    await sleep( 800 );
    log( "SHOT railmoved" );
    await sleep( 4000 );
    const n0 = moved.rail!.points.length;
    eng.rails.addPoint();
    const n1 = st().customObjects.find( ( o ) => o.uid === crail.uid )!.rail!.points.length;
    eng.rails.deletePoint();
    const n2 = st().customObjects.find( ( o ) => o.uid === crail.uid )!.rail!.points.length;
    history.undo();
    history.undo();
    history.undo();
    const back = st().customObjects.find( ( o ) => o.uid === crail.uid )!.rail!;
    log( `points ${n0} -> add ${n1} -> delete ${n2}; three undos: point 1 at ${back.points[1][1].toFixed( 3 )} (was ${y0.toFixed( 3 )}), ${back.points.length} points` );
    // Scale while editing points: Move instead
    useEditor.setState( { gizmoMode: "scale", railEdit: null }     );
    useEditor.setState( { railEdit: { uid: crail.uid, point: 1 } } );
    await sleep( 300 );
    log( `scale while editing points: ${st().gizmoMode}, gizmo ${gz.mode}` );
    // Rotate: the gizmo on the arrow halfway along turns the whole rail's way up, 45° about the rail
    useEditor.setState( { gizmoMode: "rotate" } );
    await sleep( 300 );
    const up0     = st().customObjects.find( ( o ) => o.uid === crail.uid )!.rail!.up ?? [0, 1, 0];
    const arrowAt = eng.railTool.arrowFrame()?.at;
    log( `rotate gizmo on the arrow: ${!!arrowAt && gz.attached && gz.mode === "rotate" && pivotOf().distanceTo( arrowAt ) < 1e-4}` );
    const alongQ = eng.railTool.arrowFrame()!.q.clone();
    // 45° about the arrow's own Z ( along the rail ), round the arrow
    const P      = arrowAt!, ax = new THREE.Vector3( 0, 0, 1 ).applyQuaternion( alongQ );
    gz.onStart!();
    gz.onChange!( new THREE.Matrix4().makeTranslation( P.x, P.y, P.z ).multiply( new THREE.Matrix4().makeRotationAxis( ax, Math.PI / 4 ) ).multiply( new THREE.Matrix4().makeTranslation( -P.x, -P.y, -P.z ) ) );
    gz.onEnd!();
    const turned = st().customObjects.find( ( o ) => o.uid === crail.uid )!;
    const up1    = turned.rail!.up;
    const capUps = railShellsUp( turned );
    log( `turned the rail's way up 45° (gizmo frame ${alongQ.toArray().map( ( x ) => x.toFixed( 2 ) ).join( "," )}): [${up0.map( ( x ) => x.toFixed( 2 ) )}] -> [${up1?.map( ( x ) => x.toFixed( 2 ) )}], capsule tops tilted up to ${capUps.toFixed( 0 )}° from straight up` );
    await sleep( 800 );
    log( "SHOT railturned" );
    await sleep( 4000 );
    history.undo();
    useEditor.setState( { gizmoMode: "translate" } );
    log( `undo: the rail's way up ${JSON.stringify( st().customObjects.find( ( o ) => o.uid === crail.uid )!.rail!.up ?? "straight up" )}` );
    // clicking off the piece while editing its points: done editing and deselected, in one click
    const clickOff = async () => {
      const canvas = eng.renderer.domElement, r = canvas.getBoundingClientRect();
      const at     = { clientX: r.left + 20, clientY: r.top + 20, button: 0, pointerId: 9, bubbles: true };
      canvas.dispatchEvent( new PointerEvent( "pointerdown", at ) );
      window.dispatchEvent( new PointerEvent( "pointerup",   at ) );
      await sleep( 300 );
    };
    // what's drawn for editing ( the curve, the points ) is gone once done: by Done, by clicking off, by picking another
    const drawn = () => eng.railTool.group.children.length;
    useEditor.setState( { railEdit: { uid: crail.uid, point: 1 } } );
    await sleep( 300 );
    const editing = drawn();
    useEditor.setState( { railEdit: null } );
    await sleep( 300 );
    log( `Done: drawn for editing ${editing} -> ${drawn()}` );
    useEditor.setState( { railEdit: { uid: crail.uid, point: 1 } } );
    await sleep( 300 );
    await clickOff();
    log( `clicked off while editing: editing ${st().railEdit ? "still on" : "done"}, piece still selected ${st().selection.some( ( x ) => x.uid === crail.uid )}, drawn for editing ${drawn()}` );
    useEditor.setState( { selection: [{ kind: "custom", uid: crail.uid }], railEdit: { uid: crail.uid, point: 1 } } );
    await sleep( 300 );
    useEditor.setState( { selection: [] } );
    await sleep( 300 );
    log( `selection cleared while editing: editing ${st().railEdit ? "still on" : "done"}, drawn for editing ${drawn()}` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
