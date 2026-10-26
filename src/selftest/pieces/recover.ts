import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/recover ): a copy of a map saved while saving dropped grind rails ( map.jbrproj in
 * the folder ) opens with its rails and the pieces' own colliders back; then a number field is dragged with pointer
 * events ( the value moves by the drag, it doesn't jump to an end ).
**/
export async function recoverSelftest( dir: string ) {
  try {
    await openProject( joinPath( dir, "map.jbrproj" ) );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await sleep( 1500 );
    const st = useEditor.getState;
    for ( const o of st().customObjects.filter( ( x ) => x.surface_type === "Jib" ) ) {
      const own = o.colliders.filter( ( c ) => c.mesh_ref !== "studio-rail" );
      log( `${o.parts[0].mesh.split( "/" )[1]}: rail ${o.rail ? `${o.rail.points.length} points, ${( o.rail.radius * 200 ).toFixed( 1 )} cm, mesh collidable ${o.rail.solid}` : "none"}; own colliders ${own.map( ( c ) => `${c.shape}/${c.surface_type}` ).join( ", " ) || "none"}; ${o.colliders.length - own.length} rail capsules` );
    }
    // drag the Thickness field 60 px to the right, as a mouse would
    const crail = st().customObjects.find( ( o ) => o.parts[0].mesh.startsWith( "Features/c_rail/" ) );
    if ( crail?.rail ) {
      st().setSelection( [{ kind: "custom", uid: crail.uid }] );
      await sleep( 800 );
      const field = [...document.querySelectorAll( ".props .drag-num" )].find( ( el ) => el.previousElementSibling?.textContent === "Thickness" ) as HTMLElement | undefined;
      if ( !field ) throw new Error( "no Thickness field" );
      const r      = field.getBoundingClientRect();
      const x0     = r.left + r.width / 2, y0 = r.top + r.height / 2;
      const before = crail.rail.radius * 200;
      field.dispatchEvent( new PointerEvent( "pointerdown", { clientX: x0, clientY: y0, button: 0, pointerId: 7, bubbles: true } ) );
      for ( let k = 1; k <= 6; k++ ) {
        window.dispatchEvent( new PointerEvent( "pointermove", { clientX: x0 + k * 10, clientY: y0, pointerId: 7, bubbles: true } ) );
        await sleep( 50 );
      }
      window.dispatchEvent( new PointerEvent( "pointerup", { clientX: x0 + 60, clientY: y0, pointerId: 7, bubbles: true } ) );
      await sleep( 300 );
      const after = st().customObjects.find( ( o ) => o.uid === crail.uid )!.rail!.radius * 200;
      log( `dragged Thickness 60 px: ${before.toFixed( 1 )} -> ${after.toFixed( 1 )} cm (0.5 a pixel: ${( before + 30 ).toFixed( 1 )} expected); cursor hidden afterwards ${document.documentElement.classList.contains( "scrubbing" )}` );
      history.undo();
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
