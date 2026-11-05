import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { toUnity } from "../../core/coords";
import { ipc, joinPath } from "../../core/ipc";
import { log, realInput, sleep, waitFor } from "../harness";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";

const TEMPLATE = "C:/Projects/jibbers-map/Jibbers_Template";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/unityimport ): Unity scenes made with Map-Tools opened as projects, as Import…
 * opens one. The template's MLNZ scene ( text: prefab instances, custom pieces, trees, spawns ) and its Main scene
 * ( binary: two curve inserts, the studio's curve shapes now ). Shots logged "SNAP <name>" for a capture from outside.
**/
export async function unityImportSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const { importUnityScene } = await import( "../../map/project" );
    const { newEmptyProject }  = await import( "../../map/project/sessions" );
    await newEmptyProject( joinPath( dir, `start-${Date.now()}.jbrproj` ), "Untitled" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    const st = () => useEditor.getState();

    // ---- MLNZ: a text scene of prefab instances
    const t0 = performance.now();
    await importUnityScene( `${TEMPLATE}/Assets/Scenes/MLNZ_Reference.unity`, joinPath( dir, "mlnz.jbrproj" ) );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the imported ground", 120000 );
    await sleep( 4000 );
    const took = ( performance.now() - t0 ) / 1000;
    const c    = terrain.chunks[0];
    check( terrain.chunks.length === 1 && c.res === 4097 && Math.abs( c.position[0] + 470.6 ) < 0.01, `MLNZ: 1 chunk of 4097 at x ${c?.position[0].toFixed( 1 )}, in ${took.toFixed( 1 )} s` );
    check( st().objects.length === 54 && st().spawns.length === 22, `MLNZ: ${st().objects.length} objects ( 54 ), ${st().spawns.length} spawns ( 22 )` );
    check( st().customObjects.length >= 213, `MLNZ: ${st().customObjects.length} custom pieces ( 213 )` );
    check( st().map?.name === "MLNZ Park", `MLNZ: named "${st().map?.name}"` );
    const sp = st().spawns[0];
    if ( sp ) eng.nav.lookAtUnity( [sp.position[0] - 30, sp.position[1] + 25, sp.position[2] - 30], [sp.position[0], sp.position[1], sp.position[2]] );
    log( "SNAP mlnz" );
    await sleep( 3500 );

    // ---- MLNZ's terrain trees, pieces like any other ( in a Trees collection ): one clicked, dragged on the gizmo
    // ( the frames timed ), copied, and another deleted; saved and opened again, as edited, trees still
    const trees  = () => st().customObjects.filter( ( o ) => o.tree );
    const trees0 = trees().length;
    check( trees0 === 283 && trees().every( ( o ) => st().membership[o.uid] === "trees" ) && st().collections.some( ( c ) => c.id === "trees" && c.name === "Trees" ), `MLNZ: ${trees0} terrain trees as pieces, in the Trees collection` );
    // ( one with nothing else close by, to click )
    const others = st().customObjects.filter( ( o ) => !o.tree && !o.scenery );
    const tr     = trees().find( ( t ) => others.every( ( o ) => Math.hypot( o.position.x - t.position.x, o.position.z - t.position.z ) > 40 ) && trees().every( ( u ) => u === t || Math.hypot( u.position.x - t.position.x, u.position.z - t.position.z ) > 8 ) );
    if ( tr ) {
      const { saveProject, openProject } = await import( "../../map/project" );
      let phase                          = "trees";
      const io                           = realInput( eng, () => phase );
      // ( every frame: when it came, how long, in which phase; left in frames.json, to line up with a profile )
      const seen: [number, number, string][] = [];
      let last = performance.now(), on = true;
      const tick = ( t: number ) => {
        seen.push( [t, t - last, phase] );
        last = t;
        if ( on ) requestAnimationFrame( tick );
      };
      requestAnimationFrame( tick );
      const tw0                          = performance.now();
      // ( their looks are the map's own meshes: drawn once they've loaded )
      await waitFor( () => ( ( eng.customR.objectGroup( tr.uid )?.children.length ?? 0 ) > 0 ? true : null ), "the tree drawn", 90000 ).catch( () => null );
      await waitFor( () => ( eng.veil.loading ? null : true ), "the veil", 180000 ).catch( () => null );
      log( `MLNZ: the trees drawn ${( ( performance.now() - tw0 ) / 1000 ).toFixed( 1 )} s on` );
      const at = [tr.position.x, tr.position.y, tr.position.z] as [number, number, number];
      eng.nav.lookAtUnity( [at[0] - 9, at[1] + 5, at[2] - 9], [at[0], at[1] + 2, at[2]] );
      await sleep( 1500 );
      log( `MLNZ: aiming at ${tr.uid}: the click would pick ${JSON.stringify( eng.pickObject( ...io.scr( [at[0], at[1] + 1.5 * tr.scale.y, at[2]] ) ) )}` );
      log( "SNAP aim" );
      await sleep( 1500 );
      // ( its trunk, a little off the ground )
      await io.click( ...io.scr( [at[0], at[1] + 1.5 * tr.scale.y, at[2]] ) );
      await sleep( 600 );
      const picked = st().selection[0];
      check( picked?.kind === "custom" && st().customObjects.find( ( o ) => o.uid === picked.uid )?.tree !== undefined && st().selection.length === 1, `MLNZ: a tree clicked selects it: ${picked?.kind} ${picked?.uid}` );
      const uid    = picked?.kind === "custom" ? picked.uid : tr.uid;
      if ( picked?.uid !== uid ) st().setSelection( [{ kind: "custom", uid }] );
      await sleep( 600 );
      check( ( document.body.textContent ?? "" ).includes( "Tree_A_0" ), "MLNZ: the tree's panel, a piece's" );
      log( "SNAP tree" );
      await sleep( 1500 );
      const was    = st().customObjects.find( ( o ) => o.uid === uid )!;
      const cs     = io.scr( toUnity( ( eng.blGizmo as unknown as { pivot: THREE.Vector3 } ).pivot ) );
      // ( for comparison: the whole view drawn again each frame, the camera turned about )
      phase        = "orbit";
      await io.drag( cs[0] - 200, cs[1], cs[0] + 200, cs[1], 1500, 1 );
      phase        = "after";
      await sleep( 300 );
      // ( and with the trees hidden )
      useEditor.setState( { hiddenInView: Object.fromEntries( trees().map( ( t ) => [t.uid, true as const] ) ) } );
      await sleep( 500 );
      phase        = "bare";
      await io.drag( cs[0] + 200, cs[1], cs[0] - 200, cs[1], 1500, 1 );
      phase        = "after";
      useEditor.setState( { hiddenInView: {} } );
      await sleep( 500 );
      log( `MLNZ: turning the view: ${io.report().filter( ( r ) => r.startsWith( "orbit" ) || r.startsWith( "bare" ) ).join( "; " )}` );
      eng.nav.lookAtUnity( [at[0] - 9, at[1] + 5, at[2] - 9], [at[0], at[1] + 2, at[2]] );
      await sleep( 1500 );
      const cs2    = io.scr( toUnity( ( eng.blGizmo as unknown as { pivot: THREE.Vector3 } ).pivot ) );
      phase        = "drag";
      await io.drag( ...cs2, cs2[0] + 160, cs2[1] + 40, 1500 );
      phase        = "after";
      log( "SNAP dragged" );
      await sleep( 500 );
      log( `MLNZ: dragging a tree: ${io.report().filter( ( r ) => r.startsWith( "drag" ) ).join( "; " )}` );
      const now    = st().customObjects.find( ( o ) => o.uid === uid )!;
      const gone   = Math.hypot( now.position.x - was.position.x, now.position.z - was.position.z );
      check( gone > 1 && Math.abs( now.position.y - terrain.heightAt( now.position.x, now.position.z ) - ( was.position.y - terrain.heightAt( was.position.x, was.position.z ) ) ) < 0.05, `MLNZ: the tree dragged ${gone.toFixed( 1 )} m on the gizmo, over the ground` );
      // ( for comparison: a piece that isn't a tree dragged the same way )
      const plain = st().customObjects.find( ( o ) => !o.tree && !o.scenery && Math.hypot( o.position.x - at[0], o.position.z - at[2] ) < 400 );
      if ( plain ) {
        st().setSelection( [{ kind: "custom", uid: plain.uid }] );
        eng.nav.lookAtUnity( [plain.position.x - 12, plain.position.y + 7, plain.position.z - 12], [plain.position.x, plain.position.y, plain.position.z] );
        await sleep( 1500 );
        const ps = io.scr( toUnity( ( eng.blGizmo as unknown as { pivot: THREE.Vector3 } ).pivot ) );
        phase    = "piece";
        await io.drag( ...ps, ps[0] + 160, ps[1] + 40, 1500 );
        phase    = "after";
        await sleep( 300 );
        log( `MLNZ: dragging a piece: ${io.report().filter( ( r ) => r.startsWith( "piece" ) ).join( "; " )}` );
        await io.key( "z", { ctrl: true } );
        await sleep( 300 );
        st().setSelection( [{ kind: "custom", uid }] );
        await sleep( 300 );
      }
      await io.key( "z", { ctrl: true } );
      await sleep( 300 );
      const back   = st().customObjects.find( ( o ) => o.uid === uid )!;
      check( Math.hypot( back.position.x - was.position.x, back.position.z - was.position.z ) < 1e-4, "MLNZ: the drag undone" );
      await io.key( "z", { ctrl: true, shift: true } );
      await sleep( 300 );
      // ( a copy where it is; then another tree deleted )
      await io.key( "D", { shift: true } );
      await sleep( 300 );
      const copies = trees().length;
      const first  = trees().find( ( x ) => x.uid !== uid && st().customObjects.find( ( o ) => o.uid === uid ) !== undefined && Math.hypot( x.position.x - tr.position.x, x.position.z - tr.position.z ) > 1 )!.uid;
      st().setSelection( [{ kind: "custom", uid: first }] );
      await io.key( "x" );
      await sleep( 300 );
      check( copies === trees0 + 1 && trees().length === trees0 && !trees().some( ( x ) => x.uid === first ), `MLNZ: a tree copied ( ${copies} ) and one deleted ( ${trees().length} )` );
      const saved  = JSON.stringify( ( await import( "../../map/project" ) ).currentProject()?.chunks.map( ( c ) => ( c as { treePrototypes?: { instances: number[] }[] } ).treePrototypes?.map( ( p ) => p.instances.length / 28 ) ) );
      await saveProject();
      const dirOf  = st().projectDir!;
      const moved  = st().customObjects.find( ( o ) => o.uid === uid )!;
      await openProject( dirOf );
      await waitFor( () => ( terrain.chunks.length && trees().length ? true : null ), "MLNZ opened again", 120000 );
      await sleep( 2000 );
      const again  = trees().filter( ( x ) => Math.hypot( x.position.x - moved.position.x, x.position.z - moved.position.z ) < 1e-2 );
      check( trees().length === trees0 && again.length === 2 && again.every( ( x ) => st().membership[x.uid] === "trees" ) && st().customObjects.length === 213 + trees0, `MLNZ: saved as terrain trees ( ${saved} ) and opened again: ${trees().length} trees ( ${trees0} ), the moved one and its copy where they were left ( ${again.length} ), ${st().customObjects.length - trees0} other pieces` );
      io.stop();
      on = false;
      await ipc.writeText( joinPath( dir, "frames.json" ), JSON.stringify( seen.filter( ( f ) => f[2] !== "trees" && f[2] !== "after" ) ) );
    }

    // ---- Main: a binary scene with two curve inserts
    await importUnityScene( `${TEMPLATE}/Assets/Scenes/Main.unity`, joinPath( dir, "main.jbrproj" ) );
    await waitFor( () => ( st().map?.name === "Cool Map Name" && terrain.chunks.length ? true : null ), "the second import", 120000 );
    await sleep( 3000 );
    const curves = st().shapes.filter( ( s ) => s.kind === "curve" );
    check( curves.length === 2 && curves.map( ( s ) => s.name ).join( "," ) === "Knuckle,Jump", `Main: its curve inserts the studio's shapes: ${curves.map( ( s ) => s.name ).join( ", " )}` );
    const k = curves[0];
    if ( k?.kind === "curve" ) {
      const mid = [( k.start[0] + k.end[0] ) / 2, ( k.start[1] + k.end[1] ) / 2];
      check( k.width > 1 && k.profile.length >= 2 && Number.isFinite( terrain.heightAt( mid[0], mid[1] ) ), `Main: Knuckle ${k.width.toFixed( 1 )} m wide, ${k.profile.length} profile keys, ground under it ${terrain.heightAt( mid[0], mid[1] ).toFixed( 1 )} m` );
      const g = terrain.heightAt( mid[0], mid[1] );
      eng.nav.lookAtUnity( [mid[0] - 60, g + 45, mid[1] - 60], [mid[0], g, mid[1]] );
      st().setSelection( [{ kind: "shape", uid: k.uid }] );
    }
    check( st().objects.length >= 5, `Main: ${st().objects.length} objects` );
    log( "SNAP main" );
    await sleep( 3500 );

    // ---- a project with every Map-Tools tool ( written by the Rust tests: src-tauri/src/unity/tests.rs )
    const synth = "C:/Users/goali/AppData/Local/Temp/jibbers-unity-synthetic/Assets/S.unity";
    await importUnityScene( synth, joinPath( dir, "synth.jbrproj" ) );
    await waitFor( () => ( st().map?.name === "Synthetic" && terrain.chunks.length ? true : null ), "the synthetic import", 120000 );
    await sleep( 2000 );
    const kinds = st().shapes.map( ( x ) => x.kind ).sort().join( "," );
    check( kinds === "circle,curve,formation,paint,stamp,stamp", `Synthetic: its inserts and formation the studio's shapes: ${kinds}` );
    check( st().trails.runs.length === 2 && ( st().trails.runs[0].features?.length ?? 0 ) === 1, `Synthetic: its ski line made trails: ${st().trails.runs.length} runs, ${st().trails.runs[0]?.features?.length ?? 0} feature` );
    // the formation switched off: its ground taken out, back to its builder's baseline ( 10 + 40 m )
    const f = st().shapes.find( ( x ) => x.kind === "formation" );
    if ( f?.kind === "formation" ) {
      const { liveShape, commitShape } = await import( "../../terrain/shapes/edits" );
      const cx = ( f.points[0][0] + f.points[2][0] ) / 2, cz = ( f.points[0][1] + f.points[2][1] ) / 2;
      const was = terrain.heightAt( cx, cz );
      liveShape( { ...f, enabled: false } );
      commitShape();
      const { whenShapesSettled } = await import( "../../terrain/shapes/shapes" );
      await new Promise<void>( ( r ) => whenShapesSettled( r ) );
      await sleep( 300 );
      const off = terrain.heightAt( cx, cz );
      check( Math.abs( was - 60 ) < 0.05 && Math.abs( off - 50 ) < 0.05, `Synthetic: the formation off, its ground back to the baseline: ${was.toFixed( 2 )} m → ${off.toFixed( 2 )} m ( 60 → 50 )` );
    }
    const pa = st().shapes.find( ( x ) => x.kind === "paint" );
    if ( pa ) {
      useEditor.setState( { tool: "shape", shapeKind: "curve" } );
      await sleep( 300 );
      st().setSelection( [{ kind: "shape", uid: pa.uid }] );
      await sleep( 800 );
      const panel = document.body.textContent ?? "";
      check( ["Paints", "Along", "Across", "Coverage"].every( ( w ) => panel.includes( w ) ), "Synthetic: the paint stroke's panel, its settings shown" );
    }

    // ---- a model placed in a scene ( a URP fbx, no Library: made here )
    await importUnityScene( "C:/Users/goali/AppData/Local/Temp/jibbers-unity-models/Assets/S.unity", joinPath( dir, "models.jbrproj" ) );
    await waitFor( () => ( st().customObjects.length ? true : null ), "the model import", 120000 );
    await sleep( 3000 );
    const piece = st().customObjects[0];
    check( st().customObjects.length === 1 && ( piece?.parts.length ?? 0 ) === 11, `Models: the ball a custom piece of ${piece?.parts.length} parts` );
    // ---- a map with the game's own trees ( a copy of Joyosa Park in the folder, when there is one ): features like any
    // other, dragged ( the frames timed ), saved back as the terrain's trees
    const joyosa = joinPath( dir, "Joyosa Park _color=orange_Plus_color_.jbrproj" );
    if ( await ipc.readText( joinPath( joyosa, "project.json" ) ).then( () => true, () => false ) ) {
      const { saveProject, openProject, currentProject } = await import( "../../map/project" );
      await openProject( joyosa );
      await waitFor( () => ( terrain.chunks.length && st().map ? true : null ), "Joyosa", 120000 );
      await waitFor( () => ( eng.veil.loading ? null : true ), "the veil", 180000 ).catch( () => null );
      await sleep( 3000 );
      const gt = () => st().objects.filter( ( o ) => o.tree );
      check( gt().length === 1911 && gt().every( ( o ) => st().membership[o.uid] === "trees" ), `Joyosa: ${gt().length} of the game's trees as features ( 1911 ), in the Trees collection` );
      const one = gt()[100];
      useEditor.setState( { tool: "select" } );
      await sleep( 300 );
      st().setSelection( [{ kind: "object", uid: one.uid }] );
      eng.nav.lookAtUnity( [one.position[0] - 12, one.position[1] + 7, one.position[2] - 12], [one.position[0], one.position[1] + 2, one.position[2]] );
      await sleep( 1500 );
      let phase = "";
      const io  = realInput( eng, () => phase );
      const cs  = io.scr( toUnity( ( eng.blGizmo as unknown as { pivot: THREE.Vector3 } ).pivot ) );
      log( "SNAP joyosa" );
      await sleep( 1500 );
      phase     = "drag";
      await io.drag( ...cs, cs[0] + 160, cs[1] + 40, 1500 );
      phase     = "after";
      await sleep( 300 );
      log( `Joyosa: dragging a tree: ${io.report().filter( ( r ) => r.startsWith( "drag" ) ).join( "; " )}` );
      io.stop();
      const moved = st().objects.find( ( o ) => o.uid === one.uid )!;
      check( Math.hypot( moved.position[0] - one.position[0], moved.position[2] - one.position[2] ) > 1, "Joyosa: the tree dragged" );
      const protos = currentProject()?.chunks.flatMap( ( c ) => ( ( c as { treePrototypes?: { object_id: string; instances: number[] }[] } ).treePrototypes ?? [] ).map( ( p ) => `${p.object_id} ${p.instances.length / 28}` ) );
      check( JSON.stringify( protos ) === JSON.stringify( ["tree_pine 1911"] ) || ( protos?.length === 1 && protos[0].endsWith( " 1911" ) ), `Joyosa: saved as the terrain's trees: ${protos?.join( ", " )}` );
      await saveProject();
    }

    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
