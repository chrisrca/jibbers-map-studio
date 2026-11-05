import * as THREE from "three/webgpu";
import { toUnity } from "../../core/coords";
import { ipc, joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";

const TEMPLATE = "C:/Projects/jibbers-map/Jibbers_Template";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/farview ): the MLNZ scene imported from Unity, the whole map in view, the frames
 * timed turning the view and dragging a piece ( with its trees and without, and nothing picked ). Every frame is left in
 * frames.json, to line up with a profile.
**/
export async function farViewSelftest( dir: string ) {
  try {
    const { importUnityScene } = await import( "../../map/project" );
    const { newEmptyProject }  = await import( "../../map/project/sessions" );
    await newEmptyProject( joinPath( dir, `start-${Date.now()}.jbrproj` ), "Untitled" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    const st = () => useEditor.getState();
    await importUnityScene( `${TEMPLATE}/Assets/Scenes/MLNZ_Reference.unity`, joinPath( dir, "mlnz.jbrproj" ) );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the imported ground", 120000 );
    const trees = st().customObjects.filter( ( o ) => o.tree );
    await waitFor( () => ( trees.every( ( t ) => ( eng.customR.objectGroup( t.uid )?.children.length ?? 0 ) > 0 ) ? true : null ), "the trees drawn", 120000 ).catch( () => null );
    await waitFor( () => ( eng.veil.loading ? null : true ), "the veil", 180000 ).catch( () => null );
    useEditor.setState( { tool: "select" } );
    st().setSelection( [] );
    eng.nav.frameAll();
    await sleep( 3000 );
    log( "SNAP far" );
    await sleep( 1500 );
    {
      const cr      = eng.customR as unknown as { batches: Map<string, { im: THREE.InstancedMesh }> };
      const visible = trees.flatMap( ( t ) => eng.customR.objectGroup( t.uid )?.children ?? [] ).filter( ( m ) => m.visible ).length;
      let objs = 0, meshes = 0;
      eng.scene.traverseVisible( ( o ) => { objs++; if ( ( o as THREE.Mesh ).isMesh ) meshes++; } );
      log( `alike pieces drawn instanced: ${cr.batches.size} ( ${[...cr.batches.values()].map( ( b ) => b.im.count ).join( "," )} ), tree meshes still drawn ${visible}; visible in the scene: ${objs} objects, ${meshes} meshes` );
    }
    log( "PROFILE from here" );
    await sleep( 1000 );

    let phase  = "between";
    const io   = realInput( eng, () => phase );
    const seen: [number, number, string][] = [];
    let last   = performance.now(), on = true;
    const tick = ( t: number ) => {
      seen.push( [t, t - last, phase] );
      last = t;
      if ( on ) requestAnimationFrame( tick );
    };
    requestAnimationFrame( tick );
    const { rc } = io;
    const cx = rc.width / 2, cy = rc.height / 2;
    const timed = async ( name: string, run: () => Promise<void> ) => {
      phase = name;
      await run();
      phase = "between";
      await sleep( 400 );
    };
    const orbit = ( dx: number ) => io.drag( cx - dx, cy, cx + dx, cy, 2000, 1 );

    await timed( "orbit", () => orbit( 200 ) );
    useEditor.setState( { hiddenInView: Object.fromEntries( trees.map( ( t ) => [t.uid, true as const] ) ) } );
    await sleep( 500 );
    await timed( "orbit no trees", () => orbit( -200 ) );
    useEditor.setState( { hiddenInView: {} } );
    await sleep( 500 );
    // ( a piece in the middle of the view picked: the outline on )
    const mid   = st().customObjects.filter( ( o ) => !o.tree && !o.scenery ).sort( ( a, b ) => Math.hypot( a.position.x, a.position.z ) - Math.hypot( b.position.x, b.position.z ) )[0];
    st().setSelection( [{ kind: "custom", uid: mid.uid }] );
    await sleep( 800 );
    await timed( "orbit picked", () => orbit( 200 ) );
    const ps = io.scr( toUnity( ( eng.blGizmo as unknown as { pivot: THREE.Vector3 } ).pivot ) );
    await timed( "drag", () => io.drag( ...ps, ps[0] + 160, ps[1] + 40, 2000 ) );
    await io.key( "z", { ctrl: true } );
    await sleep( 400 );
    useEditor.setState( { hiddenInView: Object.fromEntries( trees.map( ( t ) => [t.uid, true as const] ) ) } );
    await sleep( 500 );
    const ps2 = io.scr( toUnity( ( eng.blGizmo as unknown as { pivot: THREE.Vector3 } ).pivot ) );
    await timed( "drag no trees", () => io.drag( ...ps2, ps2[0] + 160, ps2[1] + 40, 2000 ) );
    await io.key( "z", { ctrl: true } );
    useEditor.setState( { hiddenInView: {} } );
    await sleep( 400 );

    on = false;
    io.stop();
    for ( const r of io.report() ) if ( !r.startsWith( "between" ) ) log( r );
    log( `draw calls ${eng.renderer.info.render.drawCalls}, triangles ${eng.renderer.info.render.triangles}` );
    await ipc.writeText( joinPath( dir, "frames.json" ), JSON.stringify( seen.filter( ( f ) => f[2] !== "between" ) ) );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
