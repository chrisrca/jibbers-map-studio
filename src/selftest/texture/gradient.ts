import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/gradient ): a cube in Assets, a red stripe painted across it, then the Gradient
 * dragged over part of it as a person does: Fade Out ( the colour fading into what's there ) and Two Colours, Radial.
 * Logs what changed where ( past the gradient's end, the faces turned away, the face hidden underneath ); views left in
 * the folder.
**/
export async function gradientSelftest( dir: string ) {
  try {
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st = () => useEditor.getState();
    [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === "Assets" )?.click();
    await sleep( 1000 );
    eng.menus.addMenu( new DOMRect( 10, 10, 1, 1 ) );
    await sleep( 300 );
    [...document.querySelectorAll<HTMLElement>( ".bmenu-item" )].find( ( x ) => x.textContent?.trim() === "Cube" )?.click();
    await sleep( 600 );
    const cube = st().customObjects[st().customObjects.length - 1];
    useEditor.setState( { selection: [{ kind: "custom", uid: cube.uid }] } );
    const { setAssetMode } = await import( "../../ui/blender/AssetsUI" );
    setAssetMode( "paint" );
    await waitFor( () => st().materialMode === "paint" && !st().busy, "Texture Paint", 60000 );
    eng.nav.lookAtUnity( [3.2, 2.6, -3.6], [0, 0.4, 0] );
    await sleep( 800 );
    const { pieceTexture, prepare } = await import( "../../texture/meshPaint" );
    const canvas                    = eng.renderer.domElement, r = canvas.getBoundingClientRect();
    const frame                     = () => new Promise<number>( ( res ) => requestAnimationFrame( res ) );
    const drag                      = async ( a: readonly number[], b: readonly number[] ) => {
      const ev = ( type: string, x: number, y: number, buttons: number ) =>
        ( type === "pointerup" ? window : canvas ).dispatchEvent( new PointerEvent( type, { clientX: r.left + x, clientY: r.top + y, button: 0, buttons, pointerId: 95, bubbles: true } ) );
      ev( "pointerdown", a[0], a[1], 1 );
      for ( let k = 1; k <= 30; k++ ) {
        ev( "pointermove", a[0] + ( ( b[0] - a[0] ) * k ) / 30, a[1] + ( ( b[1] - a[1] ) * k ) / 30, 1 );
        await frame();
      }
      ev( "pointerup", b[0], b[1], 0 );
      await sleep( 400 );
    };
    // ( on the cube as it stands: x, z from −1 to 1 across it, y 1 its top )
    const box      = new THREE.Box3().setFromObject( eng.customR.objectGroup( cube.uid )! );
    const toScreen = ( x: number, y: number, z: number ) => {
      const c = box.getCenter( new THREE.Vector3() ), h = box.getSize( new THREE.Vector3() ).multiplyScalar( 0.5 );
      const q = new THREE.Vector3( c.x + x * h.x, c.y + y * h.y, c.z - z * h.z ).project( eng.camera );
      return [( q.x * 0.5 + 0.5 ) * r.width, ( -q.y * 0.5 + 0.5 ) * r.height] as const;
    };
    // a red stripe across the cube's top, front to back
    st().setPaint( { texTool: "brush", channel: "colour", rgb: [0.9, 0.08, 0.08], radius: 0.25, strength: 1, hardness: 0.9 } );
    await drag( toScreen( -0.9, 1, 0 ), toScreen( 0.9, 1, 0 ) );
    const o     = st().customObjects.find( ( x ) => x.uid === cube.uid )!;
    const T     = pieceTexture( cube.uid )!, map = prepare( o as never ).map;
    // texels by where they are on the cube: the top ( +Y ), the bottom ( −Y, hidden ), the sides
    const where = ( k: number ) => {
      const ny = map.nrm[k * 3 + 1];
      return ny > 0.9 ? "top" : ny < -0.9 ? "bottom" : "side";
    };
    const snap = () => T.rgba.slice();
    const diff = ( before: Uint8Array, pick: ( k: number ) => boolean ) => {
      let changed = 0, of = 0;
      for ( let k = 0; k < T.n * T.n; k++ ) {
        if ( !map.used[k] || !pick( k ) ) continue;
        of++;
        if ( Math.abs( T.rgba[k * 4] - before[k * 4] ) + Math.abs( T.rgba[k * 4 + 2] - before[k * 4 + 2] ) > 6 ) changed++;
      }
      return `${changed}/${of}`;
    };
    const red    = ( k: number ) => T.rgba[k * 4] > 180 && T.rgba[k * 4 + 1] < 60;
    const before = snap(), redBefore = new Set<number>();
    for ( let k = 0; k < T.n * T.n; k++ ) if ( map.used[k] && red( k ) ) redBefore.add( k );
    log( `stripe: ${redBefore.size} red texels` );
    {
      const g    = eng.customR.objectGroup( cube.uid )!;
      const mats = g.children.flatMap( ( m ) => [( m as THREE.Mesh ).material].flat() ) as THREE.Material[];
      const b    = new THREE.Box3().setFromObject( g );
      log( `drawn with: ${mats.map( ( m ) => `${m.type} transparent ${m.transparent} opacity ${m.opacity} depthWrite ${m.depthWrite} depthTest ${m.depthTest} side ${m.side} alphaTest ${m.alphaTest}` ).join( "; " )}; cube y ${b.min.y.toFixed( 2 )}..${b.max.y.toFixed( 2 )}` );
    }
    await ipc.writeBinary( joinPath( dir, "grad-0-stripe.png" ), await eng.pictures.capture() );
    // Fade Out, blue, from the cube's front-left corner half way across: the far half untouched
    st().setPaint( { texTool: "gradient", rgb: [0.1, 0.2, 0.95], strength: 1, gradient: { shape: "linear", to: "fade" } } );
    const g0 = toScreen( -1, 1, -1 ), g1 = toScreen( 0, 1, 0 );
    await drag( g0, g1 );
    const along = ( k: number ) => {
      const x = map.pos[k * 3], z = map.pos[k * 3 + 2];
      return x + z; // the gradient runs from x+z = −2 ( its start ) towards 0 ( its end ) on the top
    };
    log( `fade: top changed ${diff( before, ( k ) => where( k ) === "top" )}; past its end (top, x+z > 0.2) ${diff( before, ( k ) => where( k ) === "top" && along( k ) > 0.2 )}; red past the end still red ${[...redBefore].filter( ( k ) => along( k ) > 0.2 && red( k ) ).length}/${[...redBefore].filter( ( k ) => along( k ) > 0.2 ).length}; sides ${diff( before, ( k ) => where( k ) === "side" )}; bottom (hidden) ${diff( before, ( k ) => where( k ) === "bottom" )}` );
    await ipc.writeBinary( joinPath( dir, "grad-1-fade.png" ), await eng.pictures.capture() );
    history.undo();
    await sleep( 300 );
    // Two Colours, Radial, from the middle of the top out
    st().setPaint( { texTool: "gradient", rgb: [1, 0.85, 0.1], rgb2: [0.1, 0.6, 0.2], gradient: { shape: "radial", to: "second" } } );
    await drag( toScreen( 0, 1, 0 ), toScreen( 0.9, 1, 0 ) );
    log( `radial two colours: top changed ${diff( before, ( k ) => where( k ) === "top" )}; bottom (hidden) ${diff( before, ( k ) => where( k ) === "bottom" )}` );
    await ipc.writeBinary( joinPath( dir, "grad-2-radial.png" ), await eng.pictures.capture() );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
