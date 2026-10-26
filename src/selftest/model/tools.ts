import type { CustomObjectEntry } from "../../core/types";
import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/tools ): a project in the folder ( a copy ): Knife across a cube's top, Spin of a
 * profile into a cup, and a Boolean difference of two cubes, by keys and clicks; views left in the folder.
**/
export async function toolsSelftest( dir: string ) {
  try {
    const { newModelObject }        = await import( "../../model/objects" );
    const { primitive, faceNormal } = await import( "../../model/mesh"    );
    const { triangulateFace }       = await import( "../../model/build"   );
    const proj                      = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st     = () => useEditor.getState();
    const g      = ( x: number, z: number ) => terrain.heightAt( x, z );
    const canvas = eng.renderer.domElement;
    let r        = canvas.getBoundingClientRect();
    const pt     = ( type: string, x: number, y: number, extra: PointerEventInit = {} ) => {
      const init = { clientX: r.left + x, clientY: r.top + y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 18, bubbles: true, ...extra };
      if ( type === "pointerup" ) window.dispatchEvent( new PointerEvent( type, init ) );
      else canvas.dispatchEvent( new PointerEvent( type, init ) );
    };
    const key = ( k: string, mods: KeyboardEventInit = {} ) => document.body.dispatchEvent( new KeyboardEvent( "keydown", { key: k, bubbles: true, cancelable: true, ...mods } ) );
    const scr = ( o: CustomObjectEntry, p: [number, number, number] ) => {
      const v = new THREE.Vector3( p[0] + o.position.x, p[1] + o.position.y, -( p[2] + o.position.z ) ).project( eng.camera );
      return [( v.x * 0.5 + 0.5 ) * r.width, ( -v.y * 0.5 + 0.5 ) * r.height] as [number, number];
    };
    const volume = ( o: CustomObjectEntry ) => {
      const m = o.model!.mesh;
      let v   = 0;
      m.f.forEach( ( f, fi ) => {
        for ( const [a, b, c] of triangulateFace( m, f, faceNormal( m, fi ) ) ) {
          const [p, q, w] = [m.v[a], m.v[b], m.v[c]];
          v              += ( p[0] * ( q[1] * w[2] - q[2] * w[1] ) - p[1] * ( q[0] * w[2] - q[2] * w[0] ) + p[2] * ( q[0] * w[1] - q[1] * w[0] ) ) / 6;
        }
      } );
      return v;
    };
    const at: [number, number] = [30, 30];
    const y0                   = g( ...at );
    st().setTool( "model" );
    // ( Modeling has no asset bar: the view is taller there )
    await sleep( 300 );
    r = canvas.getBoundingClientRect();
    canvas.dispatchEvent( new PointerEvent( "pointerenter", { bubbles: true } ) );

    // Knife: from the middle of the top's front edge to the middle of its back edge
    const cube = newModelObject( "knifecube", primitive( "cube" ), [at[0], y0 + 1, at[1]] );
    st().addCustom( cube );
    useEditor.setState( { selection: [{ kind: "custom", uid: "knifecube" }] } );
    eng.nav.lookAtUnity( [at[0] - 2.5, y0 + 4.5, at[1] - 3.5], [at[0], y0 + 1, at[1]] );
    await sleep( 1500 );
    pt( "pointermove", r.width / 2, r.height / 2, { buttons: 0 } );
    key( "Tab" );
    await waitFor( () => eng.modelEd.uid, "edit mode" );
    const faces0 = st().customObjects.find( ( x ) => x.uid === "knifecube" )!.model!.mesh.f.length;
    key( "k" );
    for ( const p of [scr( cube, [0, 1, -1] ), scr( cube, [0, 1, 1] )] ) {
      pt( "pointermove", p[0], p[1], { buttons: 0    } );
      pt( "pointerdown", p[0], p[1], { ctrlKey: true } );
      pt( "pointerup",   p[0], p[1]                    );
      await sleep( 100 );
    }
    key( "Enter" );
    await sleep( 300 );
    const kc = st().customObjects.find( ( x ) => x.uid === "knifecube" )!;
    log( `knife: ${faces0} → ${kc.model!.mesh.f.length} faces, ${kc.model!.mesh.v.length} vertices; volume ${volume( kc ).toFixed( 3 )} m³` );
    await ipc.writeBinary( joinPath( dir, "tools-1-knife.png" ), await eng.pictures.capture() );
    key( "Tab" );
    await sleep( 300 );

    // Spin: a cup's profile ( out, up ) a whole way round
    const prof = newModelObject( "spincup", { v: [[0, 0, 0], [0.8, 0, 0], [0.8, 1.2, 0]], f: [], m: [], s: [], w: [[0, 1], [1, 2]] }, [at[0] + 4, y0, at[1]] );
    st().addCustom( prof );
    useEditor.setState( { selection: [{ kind: "custom", uid: "spincup" }] } );
    await sleep( 800 );
    key( "Tab" );
    await waitFor( () => eng.modelEd.uid === "spincup", "edit mode on the profile" );
    key( "a" );
    eng.modelEd.ops.startSpin();
    key( "Enter" );
    await sleep( 300 );
    const cup = st().customObjects.find( ( x ) => x.uid === "spincup" )!.model!.mesh;
    log( `spin: ${cup.v.length} vertices, ${cup.f.length} faces (${cup.f.filter( ( f ) => f.length === 3 ).length} tris)` );
    eng.nav.lookAtUnity( [at[0] + 2, y0 + 2.5, at[1] - 3], [at[0] + 4, y0 + 0.5, at[1]] );
    await sleep( 800 );
    await ipc.writeBinary( joinPath( dir, "tools-2-spin.png" ), await eng.pictures.capture() );
    key( "Tab" );
    await sleep( 300 );

    // Boolean: a cube with a smaller one sunk into its corner, cut out ( Ctrl − )
    const big   = newModelObject( "boolbig",   primitive( "cube" ), [at[0] - 4, y0 + 1, at[1]]     );
    const small = newModelObject( "boolsmall", primitive( "cube" ), [at[0] - 3, y0 + 2, at[1] + 1] );
    st().addCustom( big   );
    st().addCustom( small );
    await sleep( 800 );
    useEditor.setState( { selection: [{ kind: "custom", uid: "boolsmall" }, { kind: "custom", uid: "boolbig" }] } );
    const v0 = volume( st().customObjects.find( ( x ) => x.uid === "boolbig" )! );
    const tb = performance.now();
    key( "-", { ctrlKey: true } );
    await waitFor( () => !st().customObjects.some( ( x ) => x.uid === "boolsmall" ), "the cutter gone", 20000 );
    const cut = st().customObjects.find( ( x ) => x.uid === "boolbig" )!;
    log( `boolean difference in ${( performance.now() - tb ).toFixed( 0 )} ms: volume ${v0.toFixed( 3 )} → ${volume( cut ).toFixed( 3 )} m³ (want 7), ${cut.model!.mesh.f.length} faces, ${cut.colliders.length} colliders` );
    eng.nav.lookAtUnity( [at[0] - 1.5, y0 + 4, at[1] - 3.5], [at[0] - 4, y0 + 1, at[1]] );
    await sleep( 1000 );
    await ipc.writeBinary( joinPath( dir, "tools-3-boolean.png" ), await eng.pictures.capture() );
    history.undo();
    log( `undo: cutter ${st().customObjects.some( ( x ) => x.uid === "boolsmall" ) ? "back" : "missing (FAIL)"}` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
