import type * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/mapnav, the map named in the folder's map.txt, the piece to start on in
 * pieces.txt ): a map's frames as a person moves round it. A piece picked and framed, then scrolled out until the
 * whole map shows ( twice: the first time and after ), then looked round with the right button held. Each phase's
 * frames are told ( their longest, how many over 34 ms and 100 ms ); "PHASE <name>" lines mark them for a profiler.
**/
export async function mapNavSelftest( dir: string ) {
  try {
    const { importMap } = await import( "../../map/project" );
    const mapPath       = ( await ipc.readText( joinPath( dir, "map.txt"    ) ) ).trim();
    const name          = ( await ipc.readText( joinPath( dir, "pieces.txt" ) ) ).split( /\r?\n/ )[0].trim();
    await importMap( mapPath, joinPath( dir, `nav-${Date.now()}.jbrproj` ) );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st = () => useEditor.getState();
    const o  = st().customObjects.find( ( x ) => x.parts.some( ( p ) => p.mesh.includes( name ) ) );
    if ( !o ) throw new Error( `no piece ${name}` );
    st().setSelection( [{ kind: "custom", uid: o.uid }] );
    eng.nav.frameSelection();
    await sleep( 4000 );

    // ( the shaders made ready for all of it, as the veil does: how long that takes )
    const tc = performance.now();
    await eng.look.compileAll();
    log( `compileAll: ${( performance.now() - tc ).toFixed( 0 )} ms` );
    await sleep( 1000 );
    // what the renderer has to set up anew in each phase ( each thing's first draw with its material and target ), by what
    // it belongs to
    const objects                    = ( eng.renderer as unknown as { _objects: { createRenderObject: ( ...a: unknown[] ) => unknown } } )._objects;
    const create                     = objects.createRenderObject.bind( objects );
    let made: Record<string, number> = {};
    const owner                      = ( o: THREE.Object3D ) => {
      for ( let p: THREE.Object3D | null = o; p; p = p.parent ) {
        const u = p.userData as { kind?: string; uid?: string };
        if ( u.kind ) return u.kind;
        if ( p === eng.terrainR.group ) return "terrain";
        if ( p === eng.objectsR.group ) return "game objects";
        if ( p === eng.customR.group ) return "pieces";
        if ( p === eng.trees.builtTrees ) return "trees";
      }
      return o.type;
    };
    objects.createRenderObject = ( ...a: unknown[] ) => {
      const k = `${owner( a[3] as THREE.Object3D )} ${( a[4] as THREE.Material ).type}`;
      made[k] = ( made[k] ?? 0 ) + 1;
      return create( ...a );
    };
    const canvas = eng.renderer.domElement, r = canvas.getBoundingClientRect();
    const cx     = r.left + r.width / 2, cy = r.top + r.height / 2;
    // the frames while `act` runs, and a second after
    const frames = async ( phase: string, act: () => Promise<void> ) => {
      log( `PHASE ${phase}` );
      await sleep( 300 );
      const gaps: number[] = [];
      let last             = performance.now(), on = true;
      const tick           = () => {
        const t = performance.now();
        gaps.push( t - last );
        last = t;
        if ( on ) requestAnimationFrame( tick );
      };
      requestAnimationFrame( tick );
      const t0 = performance.now();
      await act();
      await sleep( 1000 );
      on      = false;
      const s = [...gaps].sort( ( a, b ) => b - a );
      log( `  set up anew: ${Object.entries( made ).sort( ( a, b ) => b[1] - a[1] ).slice( 0, 8 ).map( ( [k, n] ) => `${k} ×${n}` ).join( ", " ) || "nothing"}` );
      made = {};
      log( `${phase}: ${gaps.length} frames in ${( ( performance.now() - t0 ) / 1000 ).toFixed( 1 )} s; longest ${s.slice( 0, 5 ).map( ( g ) => g.toFixed( 0 ) ).join( ", " )} ms; over 34 ms ${gaps.filter( ( g ) => g > 34 ).length}, over 100 ms ${gaps.filter( ( g ) => g > 100 ).length}` );
    };
    // a mouse wheel's notches ( 100 each ), ten a second
    const scroll = async ( notches: number, dy: number ) => {
      for ( let k = 0; k < notches; k++ ) {
        canvas.dispatchEvent( new WheelEvent( "wheel", { clientX: cx, clientY: cy, deltaY: dy, bubbles: true, cancelable: true } ) );
        await sleep( 100 );
      }
    };
    const ptr  = ( type: string, x: number, y: number, button: number, buttons: number ) =>
      ( type === "pointerdown" ? canvas : window ).dispatchEvent( new PointerEvent( type, { clientX: x, clientY: y, button, buttons, pointerId: 41, bubbles: true } ) );
    const look = async ( ms: number ) => {
      ptr( "pointerdown", cx, cy, 2, 2 );
      const t0 = performance.now();
      // quick sweeps left and right ( and a little up and down ), a move every few milliseconds
      while ( performance.now() - t0 < ms ) {
        const t = ( performance.now() - t0 ) / 1000;
        ptr( "pointermove", cx + Math.sin( t * 9 ) * 350, cy + Math.sin( t * 4 ) * 60, -1, 2 );
        await sleep( 8 );
      }
      ptr( "pointerup", cx, cy, 2, 0 );
    };

    await frames( "look-round-first", () => look( 4000 )       );
    await frames( "zoom-out-first",   () => scroll( 40, 100 )  );
    await frames( "look-round-far",   () => look( 4000 )       );
    await frames( "zoom-in",          () => scroll( 40, -100 ) );
    await frames( "zoom-out-again",   () => scroll( 40, 100 )  );
    await frames( "look-round-again", () => look( 4000 )       );
    log( "PHASE done"  );
    log( "SELFTEST OK" );
  } catch ( e ) {
    log( `SELFTEST FAILED: ${e instanceof Error ? e.stack ?? e.message : e}` );
  }
}
