import * as THREE from "three/webgpu";
import { feature, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/paintlag ): a game feature ( Rail Long ) opened in Assets, made a model ( Tab ) and
 * painted in Texture Paint as a mouse does ( a few moves a frame ): what handling the mouse costs, hovering and
 * painting, and how evenly frames come.
**/
export async function paintLagSelftest( dir: string ) {
  try {
    const { loadLibrary  } = await import( "../../pieces/library"      );
    const { openAsset    } = await import( "../../pieces/assetFiles"   );
    const { setAssetMode } = await import( "../../ui/blender/AssetsUI" );
    const proj             = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    await loadLibrary();
    const st = () => useEditor.getState();
    const id = feature( "rail_long" );
    await openAsset( id, "Rail Long" );
    await sleep( 1500 );
    const o = st().customObjects[0];
    useEditor.setState( { selection: [{ kind: "custom", uid: o.uid }] } );
    eng.modelling.toggleEditMode();
    await sleep( 800 );
    eng.modelling.toggleEditMode();
    await sleep( 500 );
    const m = st().customObjects.find( ( x ) => x.model );
    if ( !m ) throw new Error( "not a model after Tab" );
    useEditor.setState( { selection: [{ kind: "custom", uid: m.uid }] } );
    const { evaluate } = await import( "../../model/build" );
    log( `piece: ${evaluate( m.model! ).f.length} faces, ${evaluate( m.model! ).v.length} corners` );
    setAssetMode( "paint" );
    await waitFor( () => st().materialMode === "paint" && !st().busy, "Texture Paint", 60000 );
    eng.nav.frameAll();
    await sleep( 1000 );
    st().setPaint( { rgb: [0.9, 0.1, 0.1], radius: 0.4, strength: 1, texTool: "brush" } );
    const canvas            = eng.renderer.domElement, r = canvas.getBoundingClientRect();
    const frame             = () => new Promise<number>( ( res ) => requestAnimationFrame( res ) );
    const handled: number[] = [];
    const ev                = ( type: string, x: number, y: number, buttons: number ) => {
      const init = { clientX: r.left + x, clientY: r.top + y, button: 0, buttons, pointerId: 91, bubbles: true };
      const t0   = performance.now();
      ( type === "pointerup" ? window : canvas ).dispatchEvent( new PointerEvent( type, init ) );
      handled.push( performance.now() - t0 );
    };
    const q        = ( a: number[], p: number ) => ( a.length ? [...a].sort( ( x, y ) => x - y )[Math.min( a.length - 1, Math.floor( a.length * p ) )] : NaN );
    const span     = ( a: number[] ) => `${q( a, 0.5 ).toFixed( 1 )}/${q( a, 0.95 ).toFixed( 1 )}/${Math.max( ...a ).toFixed( 1 )}`;
    // along the piece's longest side, through its middle, as it is on the screen
    const box      = new THREE.Box3().setFromObject( eng.customR.objectGroup( m.uid )! );
    const size     = box.getSize( new THREE.Vector3() ), mid = box.getCenter( new THREE.Vector3() );
    const long     = size.x >= size.z ? new THREE.Vector3( size.x * 0.4, 0, 0 ) : new THREE.Vector3( 0, 0, size.z * 0.4 );
    const toScreen = ( v: THREE.Vector3 ) => {
      const q2 = v.clone().project( eng.camera );
      return [( q2.x * 0.5 + 0.5 ) * r.width, ( -q2.y * 0.5 + 0.5 ) * r.height] as const;
    };
    const a0               = toScreen( mid.clone().sub( long ) ), a1 = toScreen( mid.clone().add( long ) );
    const pathAt           = ( k: number, n: number ) => [a0[0] + ( ( a1[0] - a0[0] ) * k ) / n, a0[1] + ( ( a1[1] - a0[1] ) * k ) / n] as const;
    const { pieceTexture } = await import( "../../texture/meshPaint" );
    const reds             = () => {
      const T = pieceTexture( m.uid );
      let n   = 0;
      if ( T ) for ( let k = 0; k < T.n * T.n; k++ ) if ( T.rgba[k * 4] > 180 && T.rgba[k * 4 + 1] < 60 ) n++;
      return n;
    };
    // where a frame goes: the stroke held, the paint sent to the graphics card, drawing
    const cost: Record<string, number[]> = { hold: [], upload: [], render: [] };
    const timed                          = ( o: Record<string, ( ...a: unknown[] ) => unknown>, name: string, bucket: string ) => {
      const f = o[name].bind( o );
      o[name] = ( ...a: unknown[] ) => {
        const t0 = performance.now();
        try {
          return f( ...a );
        } finally {
          cost[bucket].push( performance.now() - t0 );
        }
      };
    };
    timed( eng.meshPainter as unknown as Record<string, ( ...a: unknown[] ) => unknown>,   "hold",   "hold"   );
    timed( eng.customR.paint as unknown as Record<string, ( ...a: unknown[] ) => unknown>, "update", "upload" );
    timed( eng.renderer as unknown as Record<string, ( ...a: unknown[] ) => unknown>,      "render", "render" );
    for ( const [what, buttons] of [["hovering", 0], ["painting", 1]] as const ) {
      handled.length = 0;
      for ( const c of Object.values( cost ) ) c.length = 0;
      const from = performance.now();
      if ( buttons ) ev( "pointerdown", ...pathAt( 0, 60 ), 1 );
      for ( let k = 1; k <= 60; k++ ) {
        for ( let j = 0; j < 4; j++ ) ev( "pointermove", ...pathAt( k - 1 + ( j + 1 ) / 4, 60 ), buttons );
        await frame();
      }
      if ( buttons ) ev( "pointerup", ...pathAt( 60, 60 ), 0 );
      const s0   = eng.frameStamps.filter( ( t ) => t >= from );
      const gaps = s0.slice( 1 ).map( ( v, i ) => v - s0[i] );
      log( `${what}: mouse handled in ms p50/p95/max ${span( handled )} (4 moves a frame); frame gaps ${span( gaps )}; ${( 1000 / q( gaps, 0.5 ) ).toFixed( 0 )} fps; red texels ${reds()}` );
      log( `  ${what} costs ms p50/p95/max: hold ${span( cost.hold )}; upload ${span( cost.upload )}; render ${span( cost.render )}` );
      await sleep( 500 );
    }
    await ipc.writeBinary( joinPath( dir, "painted.png" ), await eng.pictures.capture() );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
