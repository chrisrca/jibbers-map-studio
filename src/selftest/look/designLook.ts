import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/designlook ): a project in the folder ( a copy ) seen in Design from above a
 * slope and from low down across it: how much the snow's shading shows the ground's shape ( its brightness and its
 * contrast, the spread of it ); views left in the folder.
**/
export async function designLookSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    useEditor.setState( { splash: false } );
    // the steepest place near the middle of the map, to look at
    const c0 = terrain.chunks[Math.floor( terrain.chunks.length / 2 )];
    let best = { x: 0, z: 0, s: -1 };
    for ( let k = 0; k < 400; k++ ) {
      // ( away from the map's edge )
      const x = c0.position[0] + ( 0.25 + ( ( k % 20 ) + 0.5 ) / 40 ) * c0.size[0], z = c0.position[2] + ( 0.25 + ( Math.floor( k / 20 ) + 0.5 ) / 40 ) * c0.size[2];
      const s = Math.abs( terrain.heightAt( x + 10, z ) - terrain.heightAt( x - 10, z ) ) + Math.abs( terrain.heightAt( x, z + 10 ) - terrain.heightAt( x, z - 10 ) );
      if ( s > best.s ) best = { x, z, s };
    }
    const g     = ( x: number, z: number ) => terrain.heightAt( x, z );
    const stats = async ( png: Uint8Array ) => {
      const bmp = await createImageBitmap( new Blob( [png as BlobPart], { type: "image/png" } ) );
      const c   = new OffscreenCanvas( bmp.width, bmp.height ), cx = c.getContext( "2d" )!;
      cx.drawImage( bmp, 0, 0 );
      const d = cx.getImageData( 0, 0, bmp.width, bmp.height ).data;
      let n   = 0, s = 0, s2 = 0;
      // ( the lower two thirds: ground, not sky )
      for ( let i = Math.floor( d.length / 3 / 4 ) * 4; i < d.length; i += 16 ) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        n++; s += l; s2 += l * l;
      }
      const m = s / n;
      return `brightness ${m.toFixed( 0 )}, contrast ${Math.sqrt( Math.max( 0, s2 / n - m * m ) ).toFixed( 1 )}`;
    };
    const views: [string, [number, number, number], [number, number, number]][] = [
      ["above", [best.x - 120, g( best.x, best.z ) + 160, best.z - 120], [best.x, g( best.x, best.z ), best.z]],
      ["low",   [best.x - 60,  g( best.x, best.z ) + 12,  best.z - 60 ], [best.x + 40, g( best.x + 40, best.z + 40 ), best.z + 40]],
    ];
    // as the game draws it ( no relief ), as Design does, and at full relief
    for ( const relief of [0, 0.5, 1] ) {
      useEditor.setState( ( s ) => ( { terrainView: { ...s.terrainView, relief } } ) );
      for ( const [name, from, to] of views ) {
        eng.nav.lookAtUnity( from, to );
        await sleep( 2500 );
        const png = await eng.pictures.capture();
        await ipc.writeBinary( joinPath( dir, `design-${name}-relief${relief}.png` ), png );
        log( `${name}, relief ${relief}: ${await stats( png )}` );
      }
    }
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
