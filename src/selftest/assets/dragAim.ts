import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { ipc } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/dragaim ): a project in the folder ( a copy ): a piece dragged from the asset
 * browser into the 3D view, held still, then swung to the right before it's let go: it should face the way it was
 * swung ( not away from the camera ); and one dropped without holding, facing away from the camera as before.
**/
export async function dragAimSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st   = () => useEditor.getState();
    // ( a library piece's card: it has an Edit button; the lifts' cards come first in All )
    const card = await waitFor( () => [...document.querySelectorAll<HTMLElement>( ".assets-main .grid .card" )].find( ( c ) => !c.classList.contains( "material" ) && !!c.querySelector( ".edit" ) ), "a card", 20000 );
    const vr   = eng.renderer.domElement.getBoundingClientRect();
    const cr   = card.getBoundingClientRect();
    const at   = { x: vr.left + vr.width * 0.5, y: vr.top + vr.height * 0.55 };
    const drag = async ( hold: boolean ) => {
      const n0 = st().customObjects.length;
      card.dispatchEvent( new PointerEvent( "pointerdown", { clientX: cr.left + 20, clientY: cr.top + 20, button: 0, buttons: 1, pointerId: 51, bubbles: true } ) );
      // across to the view, a few steps
      for ( let k = 1; k <= 8; k++ ) {
        const x = cr.left + 20 + ( ( at.x - cr.left - 20 ) * k ) / 8, y = cr.top + 20 + ( ( at.y - cr.top - 20 ) * k ) / 8;
        window.dispatchEvent( new PointerEvent( "pointermove", { clientX: x, clientY: y, buttons: 1, pointerId: 51, bubbles: true } ) );
        await sleep( 30 );
      }
      await sleep( hold ? 700 : 50 );
      if ( hold ) for ( let k = 1; k <= 6; k++ ) {
        window.dispatchEvent( new PointerEvent( "pointermove", { clientX: at.x + 20 * k, clientY: at.y, buttons: 1, pointerId: 51, bubbles: true } ) );
        await sleep( 30 );
      }
      const end = hold ? { x: at.x + 120, y: at.y } : at;
      window.dispatchEvent( new PointerEvent( "pointerup", { clientX: end.x, clientY: end.y, button: 0, buttons: 0, pointerId: 51, bubbles: true } ) );
      await sleep( 800 );
      const o = st().customObjects[st().customObjects.length - 1];
      if ( st().customObjects.length === n0 ) return null;
      // which way it faces ( its forward, Unity +Z ), as a heading round the up axis, and the way it was swung
      // ( Unity's +Z is three's -Z; headings below are all three's: atan2( x, z ) of a direction on the ground )
      const fwd = new THREE.Vector3( 0, 0, -1 ).applyQuaternion( ( await import( "../../core/coords" ) ).unityEulerToQuat( [o.rotation.x, o.rotation.y, o.rotation.z] ) );
      return { o, heading: Math.atan2( fwd.x, fwd.z ) };
    };
    const held = await drag( true );
    if ( !held ) throw new Error( "the held drag placed nothing" );
    // the way from the spot to where the mouse ended, on the ground
    const local = ( x: number, y: number ) => ( { x: x - vr.left, y: y - vr.top } );
    const a     = local( at.x, at.y ), b = local( at.x + 120, at.y );
    const pa    = ( eng as unknown as { pickTerrain( x: number, y: number ): THREE.Vector3 | null } ).pickTerrain( a.x, a.y )!;
    const pb    = ( eng as unknown as { pickTerrain( x: number, y: number ): THREE.Vector3 | null } ).pickTerrain( b.x, b.y )!;
    const swung = Math.atan2( pb.x - pa.x,                  pb.z - pa.z                  );
    const away  = Math.atan2( pa.x - eng.camera.position.x, pa.z - eng.camera.position.z );
    const deg   = ( r: number ) => ( ( ( ( r * 180 ) / Math.PI ) % 360 ) + 540 ) % 360 - 180;
    log( `held and swung right: faces ${deg( held.heading ).toFixed( 0 )}°, swung ${deg( swung ).toFixed( 0 )}°, away from the camera ${deg( away ).toFixed( 0 )}° — ${Math.abs( deg( held.heading - swung ) ) < 8 ? "aimed" : "not aimed (FAIL)"}` );
    const quick = await drag( false );
    if ( !quick ) throw new Error( "the quick drag placed nothing" );
    log( `dropped without holding: faces ${deg( quick.heading ).toFixed( 0 )}° — ${Math.abs( deg( quick.heading - away ) ) < 8 ? "away from the camera" : "turned (FAIL)"}` );
    log( `aim line after: ${eng.placing.aimLine ? "still drawn (FAIL)" : "gone"}` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
