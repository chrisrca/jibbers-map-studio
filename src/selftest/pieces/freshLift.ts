import type { ObjectEntry } from "../../core/types";
import * as THREE from "three/webgpu";
import type { V3 } from "../../core/coords";
import { domShot, log, pressCard, realInput, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/freshlift ): as a person does it on a fresh start, nothing loaded yet: an untitled
 * map ( no terrain ), the Lifts catalog, a card clicked, the view clicked. Each lift's selection box is checked against
 * its base station's size, while its model loads and after, and again once each of its pieces is clicked.
**/
export async function freshLiftSelftest( dir: string ) {
  try {
    const P              = await import( "../../map/project" );
    const { liftPieces } = await import( "../../pieces/lift" );
    await P.newUntitled();
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 1500 );
    const st  = () => useEditor.getState();
    let phase = "start";
    const io  = realInput( eng, () => phase );
    eng.nav.lookAtUnity( [40, 45, -70], [0, 0, 0] );
    await sleep( 600 );
    const boxOf = () => {
      const boxes = ( eng.objectsR as unknown as { boxes: THREE.Group } ).boxes;
      return boxes.children.length ? new THREE.Box3().setFromObject( boxes ) : null;
    };
    const check = ( what: string, o: ObjectEntry, part: "base" | "top" | number ) => {
      const b    = boxOf();
      const info = eng.lib.info( o.id )!.lift!, pi = part === "base" ? info.base : part === "top" ? info.top : info.mast!;
      const want = ( pi.boundsMax[1] - pi.boundsMin[1] ) * o.scale[1];
      if ( !b ) return log( `  ${what}: no selection box (FAIL)` ), false;
      const size  = b.getSize( new THREE.Vector3() ), c = b.getCenter( new THREE.Vector3() );
      const pc    = liftPieces( o )!, foot = part === "base" ? pc.base.at : part === "top" ? pc.top.at : pc.masts[part].at;
      const reach = Math.hypot( Math.max( -pi.boundsMin[0], pi.boundsMax[0] ), Math.max( -pi.boundsMin[2], pi.boundsMax[2] ) ) + 1;
      const off   = Math.hypot( c.x - foot[0], -c.z - foot[2] ), ok = Math.abs( size.y - want ) < want * 0.15 && off < reach;
      log( `  ${what}: box ${size.x.toFixed( 1 )} × ${size.y.toFixed( 1 )} × ${size.z.toFixed( 1 )} m, the piece ${want.toFixed( 1 )} m tall, ${off.toFixed( 1 )} m from its foot${ok ? "" : " (FAIL)"}` );
      return ok;
    };
    const ids = ["chairlift", "tbar", "ropetow"];
    for ( let k = 0; k < ids.length; k++ ) {
      const id      = ids[k];
      phase         = `put down a ${id}`;
      const catalog = [...document.querySelectorAll<HTMLElement>( ".catalog" )].find( ( c ) => c.textContent?.includes( "Lifts" ) );
      catalog?.click();
      await sleep( 300 );
      const name = { chairlift: "Chairlift", tbar: "T-Bar", ropetow: "Rope Tow" }[id]!;
      const card = [...document.querySelectorAll<HTMLElement>( ".card" )].find( ( c ) => c.textContent?.trim() === name );
      if ( !card ) {
        log( `${name} card: missing (FAIL)` );
        continue;
      }
      pressCard( card );
      await sleep( 200 );
      const n0 = st().objects.length, spot: V3 = [k * 40 - 40, 0, 0];
      await io.click( ...io.scr( spot ), 250 );
      // every frame while its model comes in: the box at once, and as it is a little later
      const fresh = await waitFor( () => st().objects.find( ( o, i ) => i >= n0 && o.id === id ) ?? null, `the ${id}`, 5000 );
      log( `${name} put down (${st().selection[0]?.uid === fresh.uid ? "picked" : "not picked"})` );
      await io.frame();
      check( "the frame after", st().objects.find( ( o ) => o.uid === fresh.uid )!, "base" );
      await sleep( 1500 );
      check( "1.5 s after", st().objects.find( ( o ) => o.uid === fresh.uid )!, "base" );
      // each of its pieces clicked
      st().setTool( "select" );
      await sleep( 200 );
      const o                                    = st().objects.find( ( x ) => x.uid === fresh.uid )!, pc = liftPieces( o )!;
      const parts: ( "base" | "top" | number )[] = ["top", ...pc.masts.map( ( _, i ) => i ), "base"];
      for ( const part of parts ) {
        const at = part === "base" ? pc.base.at : part === "top" ? pc.top.at : pc.masts[part].at;
        await io.click( ...io.scr( [at[0], at[1] + 1, at[2]] ), 250 );
        await sleep( 300 );
        check( `${part === "base" ? "base station" : part === "top" ? "top station" : `mast ${part + 1}`} clicked`, st().objects.find( ( x ) => x.uid === fresh.uid )!, part );
      }
      await io.key( "Escape" );
      await sleep( 300 );
    }
    await domShot( document.querySelector<HTMLElement>( ".area.assets" ), joinPath( dir, "cards.png" ) );
    // the official cards' mark ( read from the game's own icon ) and the stations' pictures, drawn
    [...document.querySelectorAll<HTMLElement>( ".catalog" )].find( ( c ) => c.textContent?.includes( "Features" ) )?.click();
    await sleep( 1500 );
    const imgs  = ( sel: string ) => [...document.querySelectorAll<HTMLImageElement>( sel )];
    const drawn = ( xs: HTMLImageElement[] ) => `${xs.filter( ( x ) => x.complete && x.naturalWidth > 0 ).length} of ${xs.length} drawn`;
    const marks = imgs( ".card img.official" ), thumbs = imgs( ".card .thumb img:not(.official)" );
    log( `official marks: ${drawn( marks )} (${marks[0]?.naturalWidth ?? 0} px)${marks.length && marks.every( ( x ) => x.naturalWidth > 0 ) ? "" : " (FAIL)"}; card pictures: ${drawn( thumbs )}` );
    await ipc.writeBinary( joinPath( dir, "fresh-lifts.png" ), await eng.pictures.capture() );
    log( "SHOT fresh-lifts.png" );
    io.stop();
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
