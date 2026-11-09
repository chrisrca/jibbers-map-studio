import { toThree, type V3 } from "../../core/coords";
import { joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/selectbox ): Design's Select Box over Terrain Mode's things, as a person uses it.
 * A trail and a ramp on a new map; with the Trails tool a trail point picked; then Select Box: a click on the trail
 * picks it ( its points there to drag, and one dragged ), a click on the ramp picks it ( its handles there ), a click on
 * nothing lets everything go ( nothing left looking picked ).
**/
export async function selectBoxSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const { newEmptyProject } = await import( "../../map/project/sessions" );
    await newEmptyProject( joinPath( dir, `box-${Date.now()}.jbrproj` ), "Untitled" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the ground", 60000 );
    await sleep( 1200 );
    const st = () => useEditor.getState();
    const g  = ( x: number, z: number ) => terrain.heightAt( x, z );
    // a trail and a ramp
    const { addPoint } = await import( "../../trails/edits" );
    const a = addPoint( [-40, g( -40, 40 ), 40] ), b = addPoint( [-40, g( -40, 80 ), 80], a.node );
    const { newCurve } = await import( "../../terrain/shapes/shapes" );
    const { liveShape, commitShape } = await import( "../../terrain/shapes/edits" );
    const ramp = newCurve( [30, 40], [30, 80] );
    liveShape( ramp, "Add shape" );
    commitShape();
    await sleep( 1500 );
    eng.nav.lookAtUnity( [0, g( 0, 60 ) + 70, -10], [0, g( 0, 60 ), 60] );
    await sleep( 1000 );
    const io  = realInput( eng, () => "box" );
    const scr = ( p: V3 ) => eng.screenOf( toThree( p ) ).slice( 0, 2 ) as [number, number];
    const sel = () => st().selection.map( ( s ) => `${s.kind}` ).join( "," ) || "nothing";
    // the Trails tool: a point picked
    st().setTool( "trail" );
    await sleep( 400 );
    await io.click( ...scr( [-40, g( -40, 40 ), 40] ) );
    await sleep( 200 );
    log( `Trails tool, a point clicked: ${sel()}` );
    // Select Box from the toolbar
    useEditor.setState( { designPick: "box" } );
    await sleep( 300 );
    // a click on nothing
    await io.click( ...scr( [0, g( 0, 20 ), 20] ) );
    await sleep( 300 );
    const marks = eng.trailTool.marks.children.filter( ( c ) => c.visible ).length;
    check( st().selection.length === 0 && !st().trailHandle, `Select Box, a click on nothing: ${sel()} picked; trail marks drawn ${marks}` );
    // a click on the trail's point: picked, and dragged
    await io.click( ...scr( [-40, g( -40, 80 ), 80] ) );
    await sleep( 300 );
    const onTrail = sel();
    const p0      = st().trails.nodes.find( ( n ) => n.id === b.node )!.p;
    await io.drag( ...scr( p0 ), ...scr( [-30, g( -30, 80 ), 80] ), 400 );
    await sleep( 300 );
    const p1 = st().trails.nodes.find( ( n ) => n.id === b.node )!.p;
    check( onTrail.includes( "trail" ) && Math.abs( p1[0] - p0[0] ) > 3, `Select Box on a trail's point: ${onTrail}; dragged ${( p1[0] - p0[0] ).toFixed( 1 )} m` );
    // a click on the ramp: picked, its handles there
    await io.click( ...scr( [30, g( 30, 60 ), 60] ) );
    await sleep( 300 );
    const onRamp = st().selection.find( ( s ) => s.kind === "shape" )?.uid;
    check( onRamp === ramp.uid, `Select Box on the ramp: ${sel()}` );
    await io.click( ...scr( [0, g( 0, 20 ), 20] ) );
    await sleep( 300 );
    check( st().selection.length === 0, `a click on nothing: ${sel()}` );
    log( "SNAP after" );
    await sleep( 1000 );
    io.stop();
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
