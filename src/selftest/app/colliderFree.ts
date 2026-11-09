import { toThree, type V3 } from "../../core/coords";
import { ipc, joinPath } from "../../core/ipc";
import { arr3 } from "../../core/types";
import { newEmptyProject } from "../../map/project/sessions";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/colliderfree ): colliders put where there's nothing, as a person does on a new
 * map: the Colliders tool from the column; a click on the ground ( a jib: a grind rail through two points, two
 * metres ); a press held and dragged ( one from there to where it's let go ); Solid picked, a click ( a box ); one
 * clicked ( picked ) and its points edited as any jib's ( Edit points ); exported ( pieces with colliders and nothing
 * to see ).
**/
export async function colliderFreeSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    await newEmptyProject( joinPath( dir, `free-${Date.now()}.jbrproj` ), "Free colliders" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the ground", 60000 );
    await waitFor( () => !eng.veil.loading, "the veil", 120000 );
    await sleep( 1000 );
    const st  = () => useEditor.getState();
    const g   = ( x: number, z: number ) => terrain.heightAt( x, z );
    eng.nav.lookAtUnity( [0, g( 0, 0 ) + 12, -16], [0, g( 0, 0 ), 0] );
    await sleep( 800 );
    const io  = realInput( eng, () => "colliders" );
    const scr = ( p: V3 ) => eng.screenOf( toThree( p ) ).slice( 0, 2 ) as [number, number];
    document.querySelector<HTMLButtonElement>( ".tool-column button[title='Colliders']" )?.click();
    await sleep( 300 );
    check( st().tool === "collider", `the Colliders tool: ${st().tool}` );
    const r  = st().colliderBrush.radius;
    const n0 = st().customObjects.length;
    // ---- a click on the ground: a jib, two points, two metres
    await io.click( ...scr( [-3, g( -3, 0 ), 0] ) );
    await sleep( 600 );
    const one = st().customObjects.slice( n0 )[0];
    const len = ( o: typeof one ) => {
      const [a, b] = o.rail!.points;
      return Math.hypot( b[0] - a[0], b[1] - a[1], b[2] - a[2] );
    };
    check( !!one && one.parts.length === 0 && one.surface_type === "Jib" && one.rail?.points.length === 2 && one.colliders.length > 0, `a click on the ground: ${one ? `${st().labels[one.uid]}, ${one.parts.length} parts, rail of ${one.rail?.points.length} points, ${one.colliders.length} colliders` : "nothing"}` );
    check( !!one?.rail && Math.abs( len( one ) - 2 ) < 0.05, `two metres long: ${one?.rail ? len( one ).toFixed( 2 ) : "?"} m` );
    check( !!one && Math.abs( one.position.y - g( -3, 0 ) - r ) < 0.05, `its middle its size's half above the ground: ${one ? ( one.position.y - g( -3, 0 ) ).toFixed( 3 ) : "?"} m` );
    // ---- held and dragged: from there to where it's let go
    const a: V3 = [2, g( 2, -3 ), -3], b: V3 = [2, g( 2, 4 ), 4];
    await io.drag( ...scr( a ), ...scr( b ), 700 );
    await sleep( 600 );
    const two = st().customObjects.slice( n0 )[1];
    check( !!two?.rail && Math.abs( len( two ) - 7 ) < 0.6, `held and dragged 7 m: a rail ${two?.rail ? len( two ).toFixed( 2 ) : "?"} m long` );
    // ---- Solid: a box
    useEditor.setState( { colliderBrush: { ...st().colliderBrush, surface: "Generic" } } );
    await io.click( ...scr( [-6, g( -6, 4 ), 4] ) );
    await sleep( 600 );
    const box = st().customObjects.slice( n0 )[2];
    check( !!box && !box.rail && box.colliders.length === 1 && box.colliders[0].shape === "Box" && box.surface_type === "Generic", `Solid, a click: ${box ? `${box.colliders.length} ${box.colliders[0]?.shape}, ${box.surface_type}` : "nothing"}` );
    useEditor.setState( { colliderBrush: { ...st().colliderBrush, surface: "Jib" } } );
    // ---- shown, and picked by a click on it
    const shells = eng.customR.pickables( ( u ) => u === one?.uid );
    check( shells.length > 0, `the jib drawn in the view: ${shells.length} shells` );
    st().setSelection( [] );
    await sleep( 300 );
    await io.click( ...scr( arr3( one.colliders[0].local_position ) ) );
    await sleep( 400 );
    check( st().selection[0]?.uid === one?.uid && st().customObjects.length === n0 + 3, `clicked: ${st().selection[0] ? st().labels[st().selection[0].uid] : "nothing"} picked, nothing new made` );
    // ---- its points, edited as any jib's
    useEditor.setState( { railEdit: { uid: one.uid, point: 1, collider: null } } );
    await sleep( 400 );
    const moved = { ...one.rail!, points: [one.rail!.points[0], [one.rail!.points[1][0], one.rail!.points[1][1] + 1, one.rail!.points[1][2]] as [number, number, number]] };
    eng.rails.commit( "Move point", moved.points );
    await sleep( 400 );
    const after = st().customObjects.find( ( o ) => o.uid === one.uid )!;
    check( Math.abs( after.rail!.points[1][1] - one.rail!.points[1][1] - 1 ) < 1e-4 && after.colliders !== one.colliders, "Edit points: its end raised a metre, its colliders made again" );
    useEditor.setState( { railEdit: null } );
    log( "SNAP colliderfree" );
    await sleep( 1200 );
    io.stop();
    // ---- exported: pieces of colliders, nothing to see
    const { saveProject } = await import( "../../map/project" );
    await saveProject();
    const out  = joinPath( dir, "free.jbrmap" );
    await ipc.exportProject( st().projectDir!, out );
    const text = await ipc.readText( out );
    // ( each with one part of no mesh: the game leaves out a piece with no parts, colliders and all )
    type Out    = { chunks: Record<string, { "custom-objects": Record<string, { parts: Record<string, { mesh: string }>; "colliders-count": number }> }> };
    const map   = JSON.parse( text ) as Out;
    const kept  = Object.values( map.chunks ).flatMap( ( c ) => Object.values( c["custom-objects"] ) );
    const empty = kept.filter( ( o ) => o["colliders-count"] > 0 && Object.values( o.parts ).length === 1 && Object.values( o.parts )[0].mesh === "" );
    check( empty.length === 3, `exported: ${empty.length} pieces of colliders, each one part with no mesh` );
    // ---- imported again: still pieces of colliders, drawn as them ( their empty part left be )
    const { importMap } = await import( "../../map/project" );
    useEditor.setState( { dirty: false } );
    await importMap( out, joinPath( dir, "free-again.jbrproj" ) );
    await waitFor( () => ( st().projectDir?.includes( "free-again" ) && !st().busy ? true : null ), "the map imported again", 60000 );
    await sleep( 3000 );
    const back   = st().customObjects.filter( ( o ) => o.colliders.length && o.parts.every( ( p ) => !p.mesh ) );
    const drawnAs = back.filter( ( o ) => getEngine()!.customR.pickables( ( u ) => u === o.uid ).length > 0 ).length;
    check( back.length === 3 && drawnAs === 3, `imported again: ${back.length} pieces of colliders, ${drawnAs} drawn as them` );
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
