import { joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";
import type { SkiLineShape } from "../../terrain/shapes/shapes";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/skiline ): the Ski Line tool as a person uses it, on a new map. Picked from Terrain
 * Mode's toolbar; four clicks lay a line; a feature added and made a kicker from the panel ( the ground up along it, its
 * stripes painted ); a point dragged; Shift+click puts one in, Ctrl+click and X take them out; the kicker's cone slid
 * along; undone; Enter lets the line go and a click starts another; saved and opened again, as it was.
**/
export async function skiLineToolSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const { newEmptyProject } = await import( "../../map/project/sessions" );
    const proj                = joinPath( dir, `ski-${Date.now()}.jbrproj` );
    await newEmptyProject( proj, "Untitled" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the ground", 60000 );
    await sleep( 1500 );
    const st    = () => useEditor.getState();
    const g     = ( x: number, z: number ) => terrain.heightAt( x, z );
    const lines = () => st().shapes.filter( ( s ): s is SkiLineShape => s.kind === "skiline" );
    const { whenShapesSettled } = await import( "../../terrain/shapes/shapes" );
    const settled = () => new Promise<void>( ( r ) => whenShapesSettled( r ) );
    const g0 = g( 0, 60 );
    eng.nav.lookAtUnity( [-70, g0 + 70, 60], [0, g0, 60] );
    await sleep( 1500 );
    const io  = realInput( eng, () => "ski" );
    const scr = ( x: number, z: number ) => io.scr( [x, g( x, z ), z] );

    // ---- the tool, from Terrain Mode's toolbar
    st().setTool( "sculpt" );
    await sleep( 300 );
    document.querySelector<HTMLButtonElement>( '.tool-column button[title="Ski Line"]' )?.click();
    await sleep( 300 );
    check( st().tool === "shape" && st().shapeKind === "skiline" && ( document.body.textContent ?? "" ).includes( "Ski Line" ), "the Ski Line tool, from Terrain Mode's toolbar" );

    // ---- four clicks: a line
    for ( const z of [0, 40, 80, 120] ) {
      await io.click( ...scr( 0, z ) );
      await sleep( 250 );
    }
    await settled();
    let s = lines()[0];
    check( lines().length === 1 && s?.nodes.length === 4 && Math.abs( s.nodes[2].p[2] - 80 ) < 1, `four clicks laid a line of ${s?.nodes.length} points` );
    await sleep( 600 );

    // ---- a feature, made a kicker from the panel: the ground up along it, its stripes painted
    const button = ( text: string ) => [...document.querySelectorAll<HTMLButtonElement>( "button" )].find( ( b ) => b.textContent?.trim() === text );
    button( "Add Feature" )?.click();
    await sleep( 400 );
    button( "Kicker" )?.click();
    await settled();
    await sleep( 500 );
    s = lines()[0];
    const f = s?.features[0];
    const { skiLineBake, pointAt, rightAt, indexAt } = await import( "../../terrain/shapes/shapes/skiline" );
    const b   = s && skiLineBake( s );
    const lip = b && f ? pointAt( b, f.start + f.length * 0.9 ) : null;
    const up  = lip ? g( lip[0], lip[2] ) - lip[1] : 0;
    check( f?.name === "Kicker" && f.stripes.length === 3 && up > 1.5, `Add Feature, then Kicker: ${f?.name}, ${f?.stripes.length} stripes; the ground ${up.toFixed( 2 )} m up near its lip` );
    const { layerOf } = await import( "../../paint/ground" );
    if ( b && f ) {
      const d = f.start + f.length * 0.5, i = indexAt( b, d ), r = rightAt( b, i ), p = pointAt( b, d ), off = 0.88 * b.half[i];
      const c = terrain.chunks[terrain.chunkAt( p[0], p[2] )], L = layerOf( c.key );
      const px = L ? c.size[0] / L.m : 1;
      const k  = L ? Math.floor( ( p[2] + r[2] * off - c.position[2] ) / px ) * L.m + Math.floor( ( p[0] + r[0] * off - c.position[0] ) / px ) : -1;
      check( !!L && L.rgba[k * 4 + 2] > 100 && Math.abs( L.rgba[k * 4 + 1] - Math.round( 0.6 * 255 ) ) <= 1, `its stripe along its edge painted: marking ${L?.rgba[k * 4 + 2]}, hue ${L?.rgba[k * 4 + 1]} ( blue )` );
    }
    log( "SNAP kicker" );
    await sleep( 1500 );
    // ( the panel's features, scrolled to )
    const body = document.querySelector<HTMLElement>( ".props-body" );
    const feat = [...document.querySelectorAll<HTMLElement>( ".props-body *" )].find( ( x ) => x.children.length === 0 && x.textContent?.trim() === "Features" );
    feat?.scrollIntoView( { block: "start" } );
    await sleep( 500 );
    log( "SNAP panel" );
    await sleep( 1500 );
    body?.scrollTo( { top: 0 } );

    // ---- a point dragged over the ground
    const n1 = s.nodes[1].p;
    await io.drag( ...io.scr( [n1[0], n1[1] + Math.max( 0.35, s.width * 0.04 ), n1[2]] ), ...scr( 15, 40 ), 400 );
    await settled();
    s = lines()[0];
    check( Math.abs( s.nodes[1].p[0] - 15 ) < 1.5 && Math.abs( s.nodes[1].p[1] - g( 15, 40 ) ) < 0.5, `a point dragged: now at ${s.nodes[1].p[0].toFixed( 1 )}, ${s.nodes[1].p[2].toFixed( 1 )}, on the ground` );
    // ( and the kicker gone from where it was, with the line: the flat ground there again )
    const kb = skiLineBake( s )!, nowLip = pointAt( kb, s.features[0].start + s.features[0].length * 0.9 );
    const away = lip && Math.hypot( nowLip[0] - lip[0], nowLip[2] - lip[2] ) > 4;
    check( !!lip && ( !away || Math.abs( g( lip[0], lip[2] ) - g0 ) < 0.05 ), `where the kicker was before: ${lip ? ( g( lip[0], lip[2] ) - g0 ).toFixed( 3 ) : "?"} m off the ground ( it's ${away ? "" : "not "}moved off it )` );

    // ---- Shift+click puts one in; Ctrl+click and X take them out
    const mid = b ? pointAt( skiLineBake( s )!, skiLineBake( s )!.total * 0.6 ) : [0, 0, 100];
    await io.click( ...scr( mid[0] + 2, mid[2] ), 350, { shiftKey: true } );
    await settled();
    const five = lines()[0].nodes.length;
    const p3 = lines()[0].nodes[3].p;
    await io.click( ...io.scr( [p3[0], p3[1] + Math.max( 0.35, s.width * 0.04 ), p3[2]] ), 350, { ctrlKey: true } );
    await settled();
    const four = lines()[0].nodes.length;
    const p0 = lines()[0].nodes[0].p;
    await io.click( ...io.scr( [p0[0], p0[1] + Math.max( 0.35, s.width * 0.04 ), p0[2]] ) );
    await sleep( 200 );
    await io.key( "x" );
    await settled();
    const three = lines()[0].nodes.length;
    check( five === 5 && four === 4 && three === 3, `Shift+click put a point in ( ${five} ), Ctrl+click took one out ( ${four} ), X another ( ${three} )` );

    // ---- the kicker's cone slid along the line
    s = lines()[0];
    const bb = skiLineBake( s )!, f0 = s.features[0], cp = pointAt( bb, f0.start );
    const cone = io.scr( [cp[0], cp[1] + 0.25, cp[2]] ), there = pointAt( bb, Math.min( bb.total - 15, f0.start + 15 ) );
    await io.drag( ...cone, ...scr( there[0], there[2] ), 400 );
    await settled();
    const moved = lines()[0].features[0].start - f0.start;
    check( moved > 8, `the kicker's cone slid it ${moved.toFixed( 1 )} m along` );
    await io.key( "z", { ctrl: true } );
    await settled();
    check( Math.abs( lines()[0].features[0].start - f0.start ) < 0.01, "undone: back where it was" );

    // ---- Enter lets it go; a click starts another line
    await io.key( "Enter" );
    await sleep( 200 );
    await io.click( ...scr( 40, 20 ) );
    await sleep( 200 );
    await io.click( ...scr( 45, 70 ) );
    await settled();
    check( lines().length === 2 && lines()[1].nodes.length === 2, `Enter let it go; two clicks started another: ${lines().length} lines` );
    log( "SNAP lines" );
    await sleep( 1500 );
    io.stop();

    // ---- saved and opened again
    const { saveProject, openProject } = await import( "../../map/project" );
    const was = JSON.stringify( lines().map( ( x ) => [x.nodes.length, x.features.length] ) ), h = g( lip?.[0] ?? 0, lip?.[2] ?? 0 );
    await saveProject();
    await openProject( proj );
    await waitFor( () => ( terrain.chunks.length && lines().length ? true : null ), "opened again", 60000 );
    await sleep( 1000 );
    check( JSON.stringify( lines().map( ( x ) => [x.nodes.length, x.features.length] ) ) === was && Math.abs( g( lip?.[0] ?? 0, lip?.[2] ?? 0 ) - h ) < 0.01, `saved and opened again: ${was}, the kicker's ground as it was` );
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
