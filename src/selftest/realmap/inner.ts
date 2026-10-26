import { getEngine } from "../../ui/Viewport";
import { joinPath } from "../../core/ipc";
import { log, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/inner ): a copy of a real-world map with scenery ( map.jbrproj in the folder ): the
 * play area's terrain built into the scenery as its coarse stand-in, and whether it stays under the real terrain.
**/
export async function innerSelftest( dir: string ) {
  try {
    const { updateSceneryInner, lastInner } = await import( "../../geo/scenery/inner" );
    await openProject( joinPath( dir, "map.jbrproj" ) );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    const t0      = performance.now();
    const changed = await updateSceneryInner();
    const g       = ( await import( "../../geo/scenery/inner" ) ).lastInner ?? lastInner;
    log( `inner part: ${changed ? "built" : "unchanged"} in ${( ( performance.now() - t0 ) / 1000 ).toFixed( 1 )} s, ${g ? `${g.vw} x ${g.vh} points every ${g.sx.toFixed( 1 )} x ${g.sz.toFixed( 1 )} m` : "none"}` );
    const sc = useEditor.getState().customObjects.find( ( o ) => o.parts.some( ( p ) => p.mesh.endsWith( "/inner" ) ) );
    log( `scenery parts: ${sc?.parts.map( ( p ) => p.mesh.split( "/" ).pop() ).join( ", " )}; tint ${JSON.stringify( sc?.parts[0].materials[0].base_color )}` );
    if ( g ) {
      // the mesh as drawn ( two triangles a cell ) against the terrain, at random spots
      let above = 0, worst = 0, checked = 0, gapSum = 0;
      for ( let k = 0; k < 20000; k++ ) {
        const x      = g.x0 + Math.random() * ( g.vw - 1 ) * g.sx, z = g.z0 + Math.random() * ( g.vh - 1 ) * g.sz;
        const fi     = ( x - g.x0 ) / g.sx, fj = ( z - g.z0 ) / g.sz, i = Math.floor( fi ), j = Math.floor( fj ), u = fi - i, v = fj - j;
        const A      = g.H[j * g.vw + i], B = g.H[( j + 1 ) * g.vw + i], C = g.H[( j + 1 ) * g.vw + i + 1], D = g.H[j * g.vw + i + 1];
        // triangles ( a, b, c ) and ( a, c, d ): a = ( i, j ), b = ( i, j + 1 ), c = ( i + 1, j + 1 ), d = ( i + 1, j )
        const h      = v >= u ? A + ( C - B ) * u + ( B - A ) * v : A + ( D - A ) * u + ( C - D ) * v;
        const ground = terrain.heightAt( x, z );
        if ( !Number.isFinite( h ) || !Number.isFinite( ground ) ) continue;
        checked++;
        gapSum += ground - h;
        if ( h > ground ) { above++; worst = Math.max( worst, h - ground ); }
      }
      log( `under the terrain: ${checked - above} of ${checked} spots (${above} above, worst ${worst.toFixed( 2 )} m); on average ${( gapSum / Math.max( 1, checked ) ).toFixed( 1 )} m below` );
    }
    {
      const g2 = ( await import( "../../geo/scenery/inner" ) ).lastInner;
      const b  = terrain.bounds();
      log( `reaches the play area's edges: x ${g2!.x0.toFixed( 0 )}..${( g2!.x0 + ( g2!.vw - 1 ) * g2!.sx ).toFixed( 0 )} of ${b.x0}..${b.x1}, z ${g2!.z0.toFixed( 0 )}..${( g2!.z0 + ( g2!.vh - 1 ) * g2!.sz ).toFixed( 0 )} of ${b.z0}..${b.z1}; skirt points south/north/west/east ${g2!.skirt?.join( "/" )}` );
    }
    const again = await updateSceneryInner();
    log( `built again with no edits: ${again ? "rebuilt (should have been skipped)" : "skipped"}` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
