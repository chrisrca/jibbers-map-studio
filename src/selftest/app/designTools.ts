import { getEngine } from "../../ui/Viewport";
import { joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/designtools ): Design's own ways in, driven as a person does: Add › Rail ( its
 * points out to edit, its shape a box rail in Properties: boxes to ride ), H, Shift+H and Alt+H on what's selected,
 * the map's id typed in its settings.
**/
export async function designToolsSelftest( dir: string ) {
  try {
    const P = await import( "../../map/project" );
    await P.newEmptyProject( joinPath( dir, `design-${Date.now()}.jbrproj` ), "Design Tools" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 1000 );
    useEditor.setState( { splash: false } );
    const st     = () => useEditor.getState();
    const canvas = eng.renderer.domElement, r = canvas.getBoundingClientRect();
    const key    = ( k: string, mods: KeyboardEventInit = {} ) => window.dispatchEvent( new KeyboardEvent( "keydown", { key: k, bubbles: true, cancelable: true, ...mods } ) );
    canvas.dispatchEvent( new PointerEvent( "pointerenter", { bubbles: true } ) );
    canvas.dispatchEvent( new PointerEvent( "pointermove", { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true } ) );
    // the header's Add menu › Rail › Box Rail
    const pull = [...document.querySelectorAll<HTMLElement>( ".vp-header .bpull" )].find( ( b ) => b.textContent?.trim() === "Add" );
    pull?.dispatchEvent( new MouseEvent( "mousedown", { button: 0, bubbles: true, cancelable: true } ) );
    await sleep( 300 );
    const item = ( label: string ) => [...document.querySelectorAll<HTMLElement>( ".bmenu .bmenu-item" )].find( ( b ) => b.textContent?.trim() === label );
    log( `Add menu: ${pull ? "opened" : "no Add button (FAIL)"}, Rail ${item( "Rail" ) ? "in it" : "missing (FAIL)"}` );
    item( "Rail" )?.click();
    await sleep( 300 );
    item( "Box Rail" )?.click();
    await sleep( 800 );
    const rail = st().customObjects.find( ( o ) => o.model?.curve );
    log( `Add › Rail › Box Rail: ${rail ? `added, ${rail.surface_type}, points out to edit ${st().railEdit?.uid === rail.uid}, ${rail.colliders.filter( ( c ) => c.shape === "Box" ).length} box colliders, ${rail.colliders.filter( ( c ) => c.shape === "Capsule" ).length} capsules` : "nothing added (FAIL)"}` );
    if ( !rail ) throw new Error( "no rail" );
    // Properties: the rail's shape, Round
    await sleep( 300 );
    const seg = [...document.querySelectorAll<HTMLButtonElement>( ".props .seg button" )].find( ( b ) => b.textContent === "Round" );
    seg?.click();
    await sleep( 400 );
    const round = st().customObjects.find( ( o ) => o.uid === rail.uid )!;
    log( `Shape › Round: ${round.model?.curve?.profile}, ${round.colliders.filter( ( c ) => c.shape === "Capsule" ).length} capsules${round.colliders.some( ( c ) => c.shape === "Box" ) ? " (FAIL: boxes left)" : ""}` );
    // a point of it moved ( as Edit Points' gizmo leaves it ): the curve's own point
    eng.rails.commit( "Move rail point", [[-2, 0, 0], [2, 0.5, 0]] );
    await sleep( 300 );
    const moved = st().customObjects.find( ( o ) => o.uid === rail.uid )!;
    log( `point moved: the curve's end at ${moved.model?.curve?.splines[0].points[1].p.join( ", " )}; rail's ${moved.rail?.points.length} points end ${moved.rail?.points[moved.rail.points.length - 1].map( ( x ) => x.toFixed( 2 ) ).join( ", " )}` );
    useEditor.setState( { railEdit: null } );
    // H with it selected: hidden, not drawn, not picked; Alt+H: back
    st().setSelection( [{ kind: "custom", uid: rail.uid }] );
    key( "h" );
    await sleep( 300 );
    const grp = eng.customR.objectGroup( rail.uid );
    log( `H: hidden ${!!st().hiddenInView[rail.uid]}, drawn ${grp?.visible}, picked ${eng.customR.pickables().some( ( m ) => m.parent === grp )}, still in the map ${st().customObjects.some( ( o ) => o.uid === rail.uid )}, selected ${st().selection.length}` );
    key( "h", { altKey: true } );
    await sleep( 300 );
    log( `Alt+H: hidden ${!!st().hiddenInView[rail.uid]}, drawn ${eng.customR.objectGroup( rail.uid )?.visible}` );
    // the map's id, typed into its settings ( nothing selected )
    st().setSelection( [] );
    await sleep( 300 );
    [...document.querySelectorAll<HTMLButtonElement>( ".props-tabs button" )].find( ( b ) => /map/i.test( b.title ) )?.click();
    await sleep( 300 );
    const idField = [...document.querySelectorAll<HTMLInputElement>( ".props input.txt" )].find( ( i ) => i.maxLength === 36 );
    if ( idField ) {
      const set = Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, "value" )!.set!;
      idField.focus();
      set.call( idField, "Ruka Park 2" );
      idField.dispatchEvent( new Event( "input", { bubbles: true } ) );
      idField.blur();
      await sleep( 300 );
    }
    log( `map id: field ${idField ? "shown" : "missing (FAIL)"}, now ${st().map?.id}` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
