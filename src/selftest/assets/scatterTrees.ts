import { joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";

const TEMPLATE = "C:/Projects/jibbers-map/Jibbers_Template";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/scattertrees ): MLNZ's own trees ( Unity terrain trees with LODs ) painted with
 * Scatter as terrain trees: the MLNZ scene imported from Unity, one of its trees saved to My assets, its card Ctrl+
 * clicked, Terrain Trees ticked, the brush dragged over the ground: upright trees of its kind, LOD groups and all;
 * saved and opened again, they're terrain trees in the chunks' tree prototypes; Ctrl over them takes them away.
**/
export async function scatterTreesSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const { importUnityScene, saveProject, openProject } = await import( "../../map/project" );
    const { newEmptyProject }                            = await import( "../../map/project/sessions" );
    await newEmptyProject( joinPath( dir, `start-${Date.now()}.jbrproj` ), "Untitled" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    const st   = () => useEditor.getState();
    const proj = joinPath( dir, "mlnz.jbrproj" );
    await importUnityScene( `${TEMPLATE}/Assets/Scenes/MLNZ_Reference.unity`, proj );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the imported ground", 120000 );
    await waitFor( () => ( eng.veil.loading ? null : true ), "the veil", 180000 ).catch( () => null );
    // ---- one of its trees ( with LODs ) into My assets
    const tree = st().customObjects.find( ( o ) => o.tree && o.lod_groups?.length );
    check( !!tree, `a tree of MLNZ's with LODs: ${tree ? `${tree.parts.length} parts, ${tree.lod_groups?.length} LOD group` : "none"}` );
    if ( !tree ) throw new Error( "no LOD tree" );
    const { saveCustomToLibrary } = await import( "../../pieces/userAssets" );
    await saveCustomToLibrary( tree, "Test Pine" );
    useEditor.setState( { tool: "select" } );
    const card = await waitFor( () => [...document.querySelectorAll<HTMLElement>( ".assets-main .grid .card" )].find( ( c ) => c.querySelector( ".name" )?.textContent === "Test Pine" ) ?? null, "its card", 30000 );
    const cr   = card.getBoundingClientRect();
    card.dispatchEvent( new PointerEvent( "pointerdown", { clientX: cr.left + 20, clientY: cr.top + 20, button: 0, buttons: 1, ctrlKey: true, pointerId: 61, bubbles: true } ) );
    window.dispatchEvent( new PointerEvent( "pointerup", { clientX: cr.left + 20, clientY: cr.top + 20, button: 0, buttons: 0, ctrlKey: true, pointerId: 61, bubbles: true } ) );
    await sleep( 400 );
    const box = [...document.querySelectorAll<HTMLLabelElement>( ".tool-settings label.check" )].find( ( l ) => l.textContent?.trim() === "Instanced" )?.querySelector( "input" );
    check( st().tool === "scatter" && st().scatter.picks.length === 1 && !!box?.checked && st().scatter.instanced, `Scatter with Test Pine: Instanced there and ticked by default ( ${box?.checked} )` );
    useEditor.setState( { scatter: { ...st().scatter, radius: 12, spacing: 6 } } );
    // ---- somewhere open on the ground, the brush dragged across
    const c   = terrain.chunks[Math.floor( terrain.chunks.length / 2 )];
    const at  = [c.position[0] + c.size[0] * 0.5, c.position[2] + c.size[2] * 0.5];
    const gy  = terrain.heightAt( at[0], at[1] );
    eng.nav.lookAtUnity( [at[0], gy + 60, at[1] - 70], [at[0], gy, at[1]] );
    await sleep( 2000 );
    const before = new Set( st().customObjects.map( ( o ) => o.uid ) );
    const io     = realInput( eng, () => "scatter" );
    const [x0, y0] = io.scr( [at[0] - 30, gy, at[1]] ), [x1, y1] = io.scr( [at[0] + 30, gy, at[1]] );
    await io.drag( x0, y0, x1, y1, 1800 );
    await sleep( 800 );
    const made = st().customObjects.filter( ( o ) => !before.has( o.uid ) );
    const up   = made.every( ( o ) => Math.abs( o.rotation.x ) < 1e-3 && Math.abs( o.rotation.z ) < 1e-3 && Math.abs( o.scale.x - o.scale.z ) < 1e-6 );
    check( made.length >= 4 && up && made.every( ( o ) => o.tree?.kind && JSON.stringify( o.lod_groups ) === JSON.stringify( tree.lod_groups ) ), `a stroke: ${made.length} trees, ${up ? "upright, as wide as deep" : "not upright"}, their LOD groups ${made.every( ( o ) => JSON.stringify( o.lod_groups ) === JSON.stringify( tree.lod_groups ) ) ? "the tree's" : "lost"}` );
    await eng.customR.settled;
    eng.nav.lookAtUnity( [at[0], gy + 25, at[1] - 45], [at[0], gy + 4, at[1]] );
    await sleep( 2500 );
    log( "SNAP trees" );
    await sleep( 1500 );
    io.stop();
    // ---- saved and opened again: terrain trees
    const n = made.length, x = made.map( ( o ) => o.position.x ).sort( ( a, b ) => a - b );
    const meshes = made[0]?.parts.map( ( p ) => p.mesh ).join( "|" );
    {
      const m = made[0] as unknown as Record<string, unknown>;
      const { packTrees } = await import( "../../map/trees" );
      const pk = packTrees( terrain.chunks, [], made );
      log( `before saving: packed ${made.length - pk.pieces.length} of ${made.length}; keys ${Object.keys( m ).join( "," )}; surface ${m.surface_type}, flags ${[m.can_stabilize, m.can_rotate, m.can_magnetize, m.intended_up_method, m.disable_distance_culling, m.timed_visibility, ( m.lights as unknown[] ).length].join( "," )}; rot ${JSON.stringify( m.rotation )}, scale ${JSON.stringify( m.scale )}` );
    }
    await saveProject();
    await openProject( proj );
    await waitFor( () => ( terrain.chunks.length && st().customObjects.length ? true : null ), "opened again", 120000 );
    await sleep( 1500 );
    const back = st().customObjects.filter( ( o ) => o.tree && o.parts.map( ( p ) => p.mesh ).join( "|" ) === meshes && Math.abs( o.position.x - at[0] ) < 45 && Math.abs( o.position.z - at[1] ) < 20 );
    const all  = st().customObjects.filter( ( o ) => Math.abs( o.position.x - at[0] ) < 45 && Math.abs( o.position.z - at[1] ) < 20 && o.parts.map( ( p ) => p.mesh ).join( "|" ) === meshes );
    log( `of its meshes there: ${all.length}, trees ${all.filter( ( o ) => o.tree ).length}` );
    const bx   = back.map( ( o ) => o.position.x ).sort( ( a, b ) => a - b );
    // ( a piece saved as a plain one comes back unmarked: only a terrain tree comes back a tree )
    check( back.length >= n && x.every( ( v ) => bx.some( ( w ) => Math.abs( v - w ) < 0.01 ) ), `saved and opened again: ${back.length} terrain trees of its kind there, the stroke's ${n} among them` );
    // ---- Ctrl over them takes them away ( no longer from the library piece )
    st().setTool( "scatter" );
    await sleep( 300 );
    eng.nav.lookAtUnity( [at[0], gy + 60, at[1] - 70], [at[0], gy, at[1]] );
    await sleep( 1500 );
    const io2 = realInput( eng, () => "erase" );
    const [e0, f0] = io2.scr( [at[0] - 30, gy, at[1]] ), [e1, f1] = io2.scr( [at[0] + 30, gy, at[1]] );
    await io2.drag( e0, f0, e1, f1, 1800, 0, { ctrlKey: true } );
    await sleep( 600 );
    io2.stop();
    const left = st().customObjects.filter( ( o ) => back.some( ( b ) => b.uid === o.uid ) ).length;
    check( left < back.length, `Ctrl over them: ${back.length - left} of ${back.length} taken away` );
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
