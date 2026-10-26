import * as THREE from "three/webgpu";
import type { V3 } from "../../core/coords";
import { getEngine } from "../../ui/Viewport";
import { ipc } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/dragcards ): cards dragged from the asset bar into the view as a person drags
 * them — pressed, the mouse gliding up into the view a frame at a time, a moment's pause, let go — on an empty map
 * and on one with ground: a library piece, an official feature, and each lift. What's put down, and where.
**/
export async function dragCardsSelftest( dir: string ) {
  try {
    const P     = await import( "../../map/project" );
    const st    = () => useEditor.getState();
    const runOn = async ( what: string ) => {
      const eng = await waitFor( () => getEngine(), "engine", 60000 );
      await eng.ready;
      await sleep( 1000 );
      await waitFor( () => ( eng.veil.loading ? null : true ), "the map's pieces", 300000 );
      st().setTool( "select" );
      const canvas = eng.renderer.domElement, rc = canvas.getBoundingClientRect();
      const frame  = () => new Promise<void>( ( r ) => requestAnimationFrame( () => r() ) );
      const drag   = async ( card: HTMLElement, to: [number, number], pause = 500 ) => {
        const r  = card.getBoundingClientRect();
        let x    = r.left + r.width / 2, y = r.top + r.height / 2;
        const ev = ( type: string, target: EventTarget, buttons: number ) =>
          target.dispatchEvent( new PointerEvent( type, { clientX: x, clientY: y, button: 0, buttons, pointerId: 7, pointerType: "mouse", bubbles: true, cancelable: true } ) );
        ev( "pointerdown", card, 1 );
        await frame();
        const x0 = x, y0 = y, tx = rc.left + to[0], ty = rc.top + to[1];
        for ( let k = 1; k <= 40; k++ ) {
          const f = k / 40, e = f * f * ( 3 - 2 * f );
          x       = x0 + ( tx - x0 ) * e;
          y       = y0 + ( ty - y0 ) * e;
          ev( "pointermove", window, 1 );
          await frame();
        }
        await sleep( pause );
        ev( "pointerup", window, 0 );
        await sleep( 800 );
      };
      const card = ( name: string ) => [...document.querySelectorAll<HTMLElement>( ".card" )].find( ( c ) => c.textContent?.trim() === name ) ?? null;
      // the Features catalog ( the library's and the lifts' )
      for ( const [name, aim] of [["Banana Box", [0.5, 0.55]], ["Floodlight", [0.35, 0.6]], ["Chairlift", [0.62, 0.62]], ["T-Bar", [0.45, 0.7]], ["Rope Tow", [0.3, 0.72]]] as const ) {
        if ( /Lift|Bar|Tow/.test( name ) ) {
          [...document.querySelectorAll<HTMLElement>( ".catalog" )].find( ( c ) => c.textContent?.includes( "Lifts" ) )?.click();
          await sleep( 300 );
        } else {
          [...document.querySelectorAll<HTMLElement>( ".catalog, .tree-item, .lib-folder" )].find( ( c ) => c.textContent?.trim().startsWith( "All" ) )?.click();
          await sleep( 300 );
        }
        const c = await waitFor( () => card( name ), `the ${name} card`, 20000 ).catch( () => null );
        if ( !c ) {
          log( `${what}: ${name} card missing (FAIL)` );
          continue;
        }
        const n0                   = st().customObjects.length + st().objects.length;
        const at: [number, number] = [rc.width * aim[0], rc.height * aim[1]];
        await drag( c, at );
        const n1    = st().customObjects.length + st().objects.length;
        const fresh = [...st().customObjects, ...st().objects].slice( -1 )[0] as { position: { x: number; y: number; z: number } | V3 } | undefined;
        const pos   = fresh ? ( Array.isArray( fresh.position ) ? fresh.position : [fresh.position.x, fresh.position.y, fresh.position.z] ) as V3 : null;
        let off     = Infinity;
        if ( pos ) {
          const v = new THREE.Vector3( pos[0], pos[1], -pos[2] ).project( eng.camera );
          off     = Math.hypot( ( v.x * 0.5 + 0.5 ) * rc.width - at[0], ( -v.y * 0.5 + 0.5 ) * rc.height - at[1] );
        }
        log( `${what}: dragged ${name} into the view: ${n1 - n0} put down${n1 > n0 ? `, ${off.toFixed( 0 )} px from where it was let go${off < 60 ? "" : " (FAIL)"}` : " (FAIL)"}; tool after ${st().tool}` );
      }
    };
    await P.newUntitled();
    await runOn( "empty map" );
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( proj ) {
      await P.openProject( proj );
      await runOn( "map with ground" );
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
