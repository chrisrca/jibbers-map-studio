import { customName } from "../../core/types";
import { feature, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { placeEntry } from "../../pieces/library";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/texcheck ): the game's features as the user sees them on opening the studio —
 * an untitled map, a few put down from the asset bar — looked at close, then the same on a map with ground. Shots of
 * each, and how much detail ( contrast ) each shows where it is on the screen.
**/
export async function texCheckSelftest( dir: string ) {
  try {
    const P    = await import( "../../map/project" );
    // a shot of the view, and how much the middle of it ( where the piece is ) varies: a painted one does, a washed-out
    // one doesn't
    const shot = async ( name: string ) => {
      const png = await getEngine()!.pictures.capture();
      await ipc.writeBinary( joinPath( dir, `${name}.png` ), png );
      const bmp = await createImageBitmap( new Blob( [png as BlobPart], { type: "image/png" } ) );
      const c   = document.createElement( "canvas" );
      c.width   = 160;
      c.height  = 90;
      const gg  = c.getContext( "2d" )!;
      gg.drawImage( bmp, 0, 0, 160, 90 );
      const d = gg.getImageData( 50, 25, 60, 40 ).data;
      let sum = 0, sum2 = 0, n = 0;
      for ( let i = 0; i < d.length; i += 4 ) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        sum    += l;
        sum2   += l * l;
        n++;
      }
      const mean = sum / n, sd = Math.sqrt( Math.max( 0, sum2 / n - mean * mean ) );
      log( `${name}: brightness ${mean.toFixed( 0 )}, contrast ${sd.toFixed( 1 )}; SHOT ${name}.png` );
    };
    const ids = ["half_spine_tall", "up_down_box_wide", "banana_box", "battleship_rail", "floodlight"];
    const run = async ( what: string ) => {
      const eng = await waitFor( () => getEngine(), "engine", 60000 );
      await eng.ready;
      await sleep( 1000 );
      await waitFor( () => ( eng.veil.loading ? null : true ), "the map's pieces", 300000 );
      const g0 = terrain.chunks.length ? terrain.heightAt( 0, 0 ) : 0;
      for ( const [k, id] of ids.entries() ) {
        const x = k * 6 - 12, y = terrain.chunks.length ? terrain.heightAt( x, 0 ) : 0;
        await placeEntry( feature( id ), [x, Number.isNaN( y ) ? g0 : y, 0], [0, 0, 0] );
      }
      await sleep( 2500 );
      await eng.customR.settled;
      await sleep( 1000 );
      for ( const [k, id] of ids.entries() ) {
        const x = k * 6 - 12, y = terrain.chunks.length ? terrain.heightAt( x, 0 ) : 0;
        eng.nav.lookAtUnity( [x + 3.5, ( Number.isNaN( y ) ? g0 : y ) + 3, -5], [x, ( Number.isNaN( y ) ? g0 : y ) + 0.8, 0] );
        await sleep( 700 );
        await shot( `${what}-${id}` );
      }
    };
    // a map as the user had it ( a copy, in user/ ): each of its pieces looked at
    const mine = ( await ipc.findProjects( joinPath( dir, "user" ) ) )[0]?.dir;
    log( `user's map: ${mine ?? "none"}` );
    if ( mine ) {
      const opening = P.openProject( mine );
      await Promise.race( [opening, sleep( 30000 )] );
      log( `after 30 s: busy ${JSON.stringify( useEditor.getState().busy )}, dir ${useEditor.getState().projectDir}; on screen: ${document.body.innerText.replace( /\s+/g, " " ).slice( 0, 400 )}` );
      await opening;
      log( `opened: ${useEditor.getState().projectDir}, ${useEditor.getState().customObjects.length} pieces` );
      const eng0 = await waitFor( () => getEngine(), "engine", 60000 );
      await eng0.ready;
      await sleep( 1000 );
      await waitFor( () => ( eng0.veil.loading ? null : true ), "the map's pieces", 300000 );
      await sleep( 2500 );
      await eng0.customR.settled;
      await sleep( 1000 );
      for ( const o of useEditor.getState().customObjects ) {
        const p = o.position;
        eng0.nav.lookAtUnity( [p.x + 3.5, p.y + 3, p.z - 5], [p.x, p.y + 0.5, p.z] );
        await sleep( 700 );
        await shot( `user-${customName( o ).replace( /[^a-z0-9]+/gi, "_" )}` );
      }
      // ( closed as it is: a copy, nothing to keep )
      await P.closeProject();
    }
    await P.newUntitled();
    await run( "empty" );
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( proj ) {
      await P.openProject( proj );
      await run( "ground" );
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
