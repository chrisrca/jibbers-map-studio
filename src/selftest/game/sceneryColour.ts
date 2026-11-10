import { ipc, joinPath } from "../../core/ipc";
import { isScenery, type CustomObjectEntry, type RGBA } from "../../core/types";
import { chunkCells } from "../../geo/landGround";
import { newEmptyProject } from "../../map/project/sessions";
import { newUid, useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, sleep, waitFor } from "../harness";
import { inMap, pad, probe, until } from "./inGame";

const toLinear = ( c: number ) => ( c <= 0.04045 ? c / 12.92 : ( ( c + 0.055 ) / 1.055 ) ** 2.4 );
const toSrgb   = ( c: number ) => ( c <= 0.0031308 ? c * 12.92 : 1.055 * c ** ( 1 / 2.4 ) - 0.055 );

/**
 * Focused run ( STUDIO_SELFTEST=<...>/scenerycolour ): the surroundings' colour against the map's snow, in the game.
 * A new map, flat, with flat surroundings round it; the spawn near the seam. The game's own screenshot of its view:
 * the seam found in it ( up from the bottom, the ground's grain — its texture's tracks — gives way to the
 * surroundings' smooth snow ), and the rows just either side of it read, as far off and seen as steeply. Each round the
 * surroundings' tint ( its materials' colour, as the export sets it ) is moved by what's between them, channel by
 * channel in linear light; again till they're within a level. Logs the snow target that comes to ( geo/scenery/inner.ts
 * SNOW_TARGET ). With a times.txt in the folder ( hours, "7,12,17" ), instead: the map at each of those times of day,
 * the seam read and its screenshot kept, nothing changed.
**/
export async function sceneryColourSelftest( dir: string ) {
  const { playInGame } = await import( "../../map/project" );
  const id             = "studio-test-scenery";
  try {
    await newEmptyProject( joinPath( dir, `scenery-${Date.now()}.jbrproj` ), "Studio test scenery" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the ground", 60000 );
    const st = () => useEditor.getState();
    st().setMap( "Test id", { id, name: "Studio test scenery" } );
    // ---- flat surroundings round the flat ground, at its height
    const c  = terrain.chunks[0];
    const x1 = c.position[0] + c.size[0], zm = c.position[2] + c.size[2] / 2;
    const h  = terrain.heightAt( x1 - 50, zm );
    const { buildScenery } = await import( "../../geo/scenery/scenery" );
    const made = ( await buildScenery( {
      dir: st().projectDir!, cells: chunkCells(), radius: 2000, edge: ( x, z ) => terrain.heightAt( x, z ), far: async () => () => h, near: async () => () => h,
    } ) ) as Omit<CustomObjectEntry, "uid">;
    const piece = { ...made, uid: newUid(), scenery: { rockAngle: 30, radius: 2000 } } as CustomObjectEntry;
    if ( !st().library ) useEditor.setState( { library: "assets/library.jbrmap" } );
    eng.customR.reloadLibrary();
    useEditor.setState( { customObjects: [...st().customObjects, piece], locked: { ...st().locked, [piece.uid]: true }, labels: { ...st().labels, [piece.uid]: "Surroundings" } } );
    // ---- the spawn on the seam, 2.5 m in from it, facing along it ( +Z: the surroundings to its right )
    useEditor.setState( { spawns: [{ uid: newUid(), name: "Seam", position: [x1 - 2.5, h + 0.3, zm], rotation: [0, 0, 0], velocity: [0, 0, 0] }], gamePoppedOut: false } );
    await sleep( 3000 );

    const req  = joinPath( ( await ipc.appInfo() ).mapsDir, "..", "studio-shot.json" );
    const tint = (): RGBA => st().customObjects.find( isScenery )!.parts[0].materials[0].base_color;
    let first: RGBA | null = null;
    // ( played as it is now: the game's view kept ( <label>-<n>.png ), the seam found and the rows either side read )
    const look = async ( label: string ) => {
      await pad();
      await playInGame();
      await inMap( label );
      await until( async () => ( ( await probe() )?.lookBlocked != null ? true : null ), "the game's camera", 120000 );
      await sleep( 8000 );
      // ( the game's view, twice, a few seconds apart: the second read )
      let file = "";
      for ( let n = 0; n < 2; n++ ) {
        file = joinPath( dir, `${label}-${n}.png` );
        await ipc.writeText( req, JSON.stringify( { path: file } ) );
        await until( async () => ( await ipc.readBinary( file ).then( ( b ) => b.byteLength > 1000, () => false ) ) || null, "the game's screenshot", 30000 );
        await sleep( 4000 );
      }
      // the seam: in columns clear of the rider ( its left and right fifths ), the lowest row, up from the bottom, where
      // the ground's grain stops; the rows just above it the surroundings', just below the ground's
      const bmp = await createImageBitmap( new Blob( [await ipc.readBinary( file )], { type: "image/png" } ), { colorSpaceConversion: "none", premultiplyAlpha: "none" } );
      const cv  = new OffscreenCanvas( bmp.width, bmp.height );
      const g   = cv.getContext( "2d", { willReadFrequently: true } )!;
      g.drawImage( bmp, 0, 0 );
      const W   = bmp.width, H = bmp.height, px = g.getImageData( 0, 0, W, H ).data;
      const cols = [...Array.from( { length: Math.round( W * 0.25 ) }, ( _, i ) => Math.round( W * 0.04 ) + i ), ...Array.from( { length: Math.round( W * 0.25 ) }, ( _, i ) => Math.round( W * 0.71 ) + i )];
      const row  = ( y: number ) => {
        const sum = [0, 0, 0];
        let l1 = 0, l2 = 0;
        for ( const x of cols ) {
          const k = ( y * W + x ) * 4, l = ( px[k] + px[k + 1] + px[k + 2] ) / 3;
          for ( let ch = 0; ch < 3; ch++ ) sum[ch] += px[k + ch];
          l1 += l;
          l2 += l * l;
        }
        return { rgb: sum.map( ( v ) => v / cols.length ), grain: Math.sqrt( Math.max( 0, l2 / cols.length - ( l1 / cols.length ) ** 2 ) ) };
      };
      // ( a few rows' grain together: the tracks run in lines )
      const grain = ( y: number ) => ( row( y - 1 ).grain + row( y ).grain + row( y + 1 ).grain ) / 3;
      let seam    = -1;
      for ( let y = Math.round( H * 0.8 ); y > H * 0.1; y-- ) if ( grain( y ) < 0.8 && grain( y - 4 ) < 0.8 && grain( y + 6 ) > 1.5 ) { seam = y; break; }
      const band  = ( y0: number, y1: number ) => {
        const sum = [0, 0, 0];
        for ( let y = y0; y <= y1; y++ ) row( y ).rgb.forEach( ( v, k ) => ( sum[k] += v ) );
        return { rgb: sum.map( ( v ) => v / ( y1 - y0 + 1 ) ), grain: ( grain( y0 + 1 ) + grain( y1 - 1 ) ) / 2 };
      };
      await ipc.gameClose().catch( () => {} );
      await until( async () => ( ( await ipc.gameStatus() ) === "notRunning" ? true : null ), "the game closed", 60000 );
      await sleep( 3000 );
      // ( none found, as in the dark: its screenshot kept all the same )
      if ( seam < 0 ) return { file, seam, ground: null, around: null, off: null };
      const around = band( seam - 12, seam - 3 ), ground = band( seam + 3, seam + 40 );
      log( `  the seam at row ${seam} of ${H}` );
      return { file, seam, ground, around, off: ground.rgb.map( ( v, k ) => v - around.rgb[k] ) };
    };
    const rgb  = ( v: number[] ) => v.map( ( x ) => x.toFixed( 1 ) ).join( "," );
    // ---- at times of day, as they are
    const times = ( await ipc.readText( joinPath( dir, "times.txt" ) ).catch( () => "" ) ).split( "," ).map( Number ).filter( ( h ) => Number.isFinite( h ) && h > 0 );
    if ( times.length ) {
      for ( const h of times ) {
        st().setMap( "Time", { overrideTime: true, dayTimeHours: h } );
        await sleep( 1000 );
        const r = await look( `time-${h}` );
        log( r.off ? `time ${h}: ground ${rgb( r.ground!.rgb )}, surroundings ${rgb( r.around!.rgb )}; off ${rgb( r.off )} ( ${r.file} )` : `time ${h}: no seam found ( ${r.file} )` );
      }
      log( "SELFTEST OK" );
      return;
    }
    for ( let round = 1; round <= 4; round++ ) {
      first ??= { ...tint() };
      const { ground, around, off, file } = await look( `round-${round}` );
      if ( !ground || !around || !off ) throw new Error( `no seam in the game's view ( ${file} )` );
      const now  = tint();
      log( `round ${round}: ground ${rgb( ground.rgb )} ( grain ${ground.grain.toFixed( 1 )} ), surroundings ${rgb( around.rgb )} ( grain ${around.grain.toFixed( 1 )} ); off ${rgb( off )}; tint ${[now.r, now.g, now.b].map( ( v ) => v.toFixed( 4 ) ).join( "," )}` );
      if ( off.every( ( v ) => Math.abs( v ) <= 1 ) ) {
        log( `matched in round ${round}` );
        break;
      }
      // ( the tint moved by what's between them, in linear light: the surroundings' colour goes as it )
      const ratio = ground.rgb.map( ( v, k ) => toLinear( v / 255 ) / Math.max( 1e-4, toLinear( around.rgb[k] / 255 ) ) );
      // ( over 1 allowed here: the game's material colour multiplies, and what it takes shows in the next round )
      const next  = [now.r, now.g, now.b].map( ( v, k ) => toSrgb( toLinear( v ) * ratio[k] ) );
      useEditor.setState( ( s ) => ( {
        customObjects: s.customObjects.map( ( o ) => ( isScenery( o ) ? { ...o, parts: o.parts.map( ( p ) => ( { ...p, materials: p.materials.map( ( m ) => ( { ...m, base_color: { r: next[0], g: next[1], b: next[2], a: 1 } } ) ) } ) ) } : o ) ),
        dirty: true,
      } ) );
    }
    // ( the snow target that tint comes to: the export's own tint first came from SNOW_TARGET )
    const { SNOW_TARGET } = await import( "../../geo/scenery/inner" );
    const last            = tint();
    if ( first ) log( `SNOW_TARGET: ${[[last.r, first.r], [last.g, first.g], [last.b, first.b]].map( ( [l, f], k ) => ( SNOW_TARGET[k] * toLinear( l ) / toLinear( f ) ).toFixed( 4 ) ).join( ", " )}` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  } finally {
    await ipc.gamePad( null ).catch( () => {} );
    await ipc.gameClose().catch( () => {} );
    const map = joinPath( ( await ipc.appInfo() ).mapsDir, `${id}.jbrmap` );
    for ( let k = 0; k < 20; k++ ) {
      await sleep( 1000 );
      if ( await ipc.recycle( map ).then( () => true, () => false ) ) break;
    }
  }
}
