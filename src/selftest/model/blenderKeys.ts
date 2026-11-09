import { toThree, toUnity, unityEulerToQuat, type V3 } from "../../core/coords";
import { joinPath } from "../../core/ipc";
import { arr3, type CustomObjectEntry } from "../../core/types";
import { history } from "../../map/history";
import { useEditor } from "../../map/store";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/blenderkeys ): the Assets workspace's keys and mouse as Blender has them, each
 * checked against what Blender does ( its Y the game's Z, its Z up ): Object Mode's G / R / S with axes and typed
 * numbers, cancelled with Esc and a right click, Alt+G / R / S, Shift+D, undo and redo, H and Alt+H, Delete; Edit
 * Mode's selection kept from last time, select modes and what they turn a selection into, clicks and Shift+clicks,
 * E / I with typed numbers, G / S in it, Esc putting the mesh back exactly, Ctrl+Z inside it, Loop Cut, Merge, Delete.
**/
export async function blenderKeysSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const P = await import( "../../map/project" );
    await P.newEmptyProject( joinPath( dir, `keys-${Date.now()}.jbrproj` ), "Blender Keys" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await sleep( 1000 );
    const st  = () => useEditor.getState();
    const tab = ( name: string ) => [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === name )?.click();
    tab( "Assets" );
    await sleep( 1200 );
    const io    = realInput( eng, () => "keys" );
    const frame = () => new Promise<void>( ( r ) => requestAnimationFrame( () => r() ) );
    const key   = async ( k: string, m: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {} ) => {
      const init = { key: k, code: k.length === 1 ? ( /[0-9]/.test( k ) ? `Digit${k}` : `Key${k.toUpperCase()}` ) : k, ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: !!m.alt, bubbles: true, cancelable: true };
      window.dispatchEvent( new KeyboardEvent( "keydown", init ) );
      window.dispatchEvent( new KeyboardEvent( "keyup", init ) );
      await frame();
      await sleep( 60 );
    };
    const type  = async ( s: string ) => { for ( const ch of s ) await key( ch ); };
    const menu  = async ( label: string ) => {
      await sleep( 200 );
      const it = [...document.querySelectorAll<HTMLElement>( ".bmenu .bmenu-item" )].find( ( x ) => x.textContent?.trim().startsWith( label ) );
      it?.click();
      await sleep( 300 );
      return !!it;
    };
    const W = io.rc.width, H = io.rc.height;
    await io.glide( W / 2, H / 2, 200 );
    const near  = ( a: number[], b: number[], e = 1e-3 ) => a.every( ( x, i ) => Math.abs( x - b[i] ) < e );
    const fmt   = ( a: number[] ) => `(${a.map( ( x ) => x.toFixed( 3 ) ).join( ", " )})`;
    const at    = ( o: CustomObjectEntry ) => arr3( o.position );
    // ( a direction of the piece's own, where its turn points it: the game's axes )
    const dirOf = ( o: CustomObjectEntry, d: V3 ) => toUnity( toThree( d ).applyQuaternion( unityEulerToQuat( arr3( o.rotation ) ) ) );

    // ---------------------------------------------------------------- Object Mode
    await key( "A", { shift: true } );
    check( await menu( "Cube" ), "Shift+A: the Add menu, Cube in it" );
    await sleep( 600 );
    let uid     = st().selection[0]?.uid ?? "";
    const piece = () => st().customObjects.find( ( o ) => o.uid === uid )!;
    check( !!piece()?.model && piece().model!.mesh.v.length === 8, "a cube added, selected" );
    const p0 = at( piece() );
    // G X 2: along Blender's X ( the game's X )
    await key( "g" ); await key( "x" ); await type( "2" ); await key( "Enter" );
    check( near( at( piece() ), [p0[0] + 2, p0[1], p0[2]] ), `G X 2 Enter: moved 2 along X: ${fmt( at( piece() ) )}` );
    // G Y 1: Blender's Y is the game's Z
    await key( "g" ); await key( "y" ); await type( "1" ); await key( "Enter" );
    check( near( at( piece() ), [p0[0] + 2, p0[1], p0[2] + 1] ), `G Y 1 Enter: 1 along Blender's Y ( the game's Z ): ${fmt( at( piece() ) )}` );
    // G Z -0.5: up is Blender's Z; "-" typed first turns it negative
    await key( "g" ); await key( "z" ); await type( "-0.5" ); await key( "Enter" );
    check( near( at( piece() ), [p0[0] + 2, p0[1] - 0.5, p0[2] + 1] ), `G Z -0.5 Enter: down half a metre: ${fmt( at( piece() ) )}` );
    // ( "-" again turns it back; Backspace takes a digit off )
    await key( "g" ); await key( "x" ); await type( "35" ); await key( "Backspace" ); await key( "-" ); await key( "-" ); await key( "Enter" );
    check( near( at( piece() ), [p0[0] + 5, p0[1] - 0.5, p0[2] + 1] ), `G X 3 5 Backspace - - Enter: 3 along X: ${fmt( at( piece() ) )}` );
    // Ctrl+Z, Ctrl+Shift+Z
    await key( "z", { ctrl: true } );
    const undone = at( piece() );
    await key( "z", { ctrl: true, shift: true } );
    check( near( undone, [p0[0] + 2, p0[1] - 0.5, p0[2] + 1] ) && near( at( piece() ), [p0[0] + 5, p0[1] - 0.5, p0[2] + 1] ), `Ctrl+Z took the last move back ${fmt( undone )}, Ctrl+Shift+Z put it again` );
    // G with the mouse, then Esc / a right click: where it was
    const before = at( piece() );
    await key( "g" ); await io.glide( W / 2 + 120, H / 2 - 60, 250 ); await key( "Escape" );
    const esc = at( piece() );
    await key( "g" ); await io.glide( W / 2 - 100, H / 2 + 40, 250 ); await io.press( 2 ); await io.release( 2 );
    check( near( esc, before ) && near( at( piece() ), before ), `G and the mouse, Esc: back ${fmt( esc )}; a right click: back ${fmt( at( piece() ) )}` );
    await io.glide( W / 2, H / 2, 150 );
    // Alt+G
    await key( "g", { alt: true } );
    check( near( at( piece() ), [0, 0, 0] ), `Alt+G: back to the origin ${fmt( at( piece() ) )}` );
    // R Z 90: about up, the right-hand way ( Blender's X turns to its Y: the game's X to its Z )
    await key( "r" ); await key( "z" ); await type( "90" ); await key( "Enter" );
    check( near( dirOf( piece(), [1, 0, 0] ), [0, 0, 1] ), `R Z 90 Enter: its X turned to Blender's Y ( the game's Z ): ${fmt( dirOf( piece(), [1, 0, 0] ) )}` );
    await key( "r", { alt: true } );
    // R X 90: Blender's Z ( up ) turns to its -Y ( the game's -Z )
    await key( "r" ); await key( "x" ); await type( "90" ); await key( "Enter" );
    check( near( dirOf( piece(), [0, 1, 0] ), [0, 0, -1] ), `R X 90 Enter: its up turned to Blender's -Y ( the game's -Z ): ${fmt( dirOf( piece(), [0, 1, 0] ) )}` );
    await key( "r", { alt: true } );
    check( near( arr3( piece().rotation ), [0, 0, 0] ), `Alt+R: no turn ${fmt( arr3( piece().rotation ) )}` );
    // S 2, then S Y 3 ( Blender's Y: the game's Z ), Alt+S
    await key( "s" ); await type( "2" ); await key( "Enter" );
    const s2 = arr3( piece().scale );
    await key( "s" ); await key( "y" ); await type( "3" ); await key( "Enter" );
    check( near( s2, [2, 2, 2] ) && near( arr3( piece().scale ), [2, 2, 6] ), `S 2 Enter: ${fmt( s2 )}; S Y 3 Enter: ${fmt( arr3( piece().scale ) )} ( Blender's Y the game's Z )` );
    await key( "s", { alt: true } );
    check( near( arr3( piece().scale ), [1, 1, 1] ), `Alt+S: size 1 ${fmt( arr3( piece().scale ) )}` );
    // Shift+D, Esc: a copy left where it was ( as Blender's ); Shift+D X 3: one 3 along
    const n0 = st().customObjects.length;
    await key( "D", { shift: true } ); await io.glide( W / 2 + 80, H / 2, 200 ); await key( "Escape" );
    const copy = st().customObjects.find( ( o ) => o.uid === st().selection[0]?.uid );
    check( st().customObjects.length === n0 + 1 && !!copy && copy.uid !== uid && near( at( copy ), [0, 0, 0] ), `Shift+D, Esc: a copy, where the cube is ${copy ? fmt( at( copy ) ) : "none"}` );
    await key( "D", { shift: true } ); await key( "x" ); await type( "3" ); await key( "Enter" );
    const third = st().customObjects.find( ( o ) => o.uid === st().selection[0]?.uid );
    check( st().customObjects.length === n0 + 2 && !!third && near( at( third ), [3, 0, 0] ), `Shift+D X 3 Enter: another, 3 along X ${third ? fmt( at( third ) ) : "none"}` );
    // H, Alt+H
    await key( "h" );
    const hid = !!st().hiddenInView[third!.uid];
    await key( "h", { alt: true } );
    check( hid && !st().hiddenInView[third!.uid] && st().selection.some( ( x ) => x.uid === third!.uid ), `H hid it ( ${hid} ); Alt+H showed it again, selected` );
    // Delete: the two copies gone
    st().setSelection( [{ kind: "custom", uid: copy!.uid }, { kind: "custom", uid: third!.uid }] );
    await sleep( 200 );
    await key( "Delete" );
    await sleep( 200 );
    check( st().customObjects.length === n0, `Delete: ${n0 + 2 - st().customObjects.length} pieces gone` );

    // ---------------------------------------------------------------- Edit Mode
    st().setSelection( [{ kind: "custom", uid }] );
    eng.nav.lookAtUnity( [3.2, 3.4, -4.2], [0, 0, 0] );
    await sleep( 800 );
    await key( "Tab" );
    await sleep( 300 );
    const me = () => st().modelEdit;
    const g  = () => piece().model!.mesh;
    check( !!me() && me()!.verts === 8, `Tab: Edit Mode, a new cube all selected as Blender's ( ${me()?.verts} vertices )` );
    await key( "3" );
    check( me()?.mode === "face" && me()!.faces === 6, `3: face select, its 6 faces still selected ( ${me()?.faces} )` );
    await key( "a", { alt: true } );
    const none = me()?.faces;
    await key( "a" );
    check( none === 0 && me()!.faces === 6, `Alt+A: none ( ${none} ); A: all ( ${me()?.faces} )` );
    // a click on the top face picks it alone; Ctrl+I the rest
    const scr = ( p: V3 ) => {
      const [x, y] = eng.screenOf( toThree( p ) );
      return [x, y] as const;
    };
    await io.click( ...scr( [0, 1, 0] ) );
    await sleep( 200 );
    const one = me()?.faces;
    await key( "i", { ctrl: true } );
    check( one === 1 && me()!.faces === 5, `a click on the top: ${one} face; Ctrl+I: the other ${me()?.faces}` );
    await io.click( ...scr( [0, 1, 0] ) );
    await sleep( 200 );
    // E 1: the top up a metre, along its normal
    await key( "e" ); await type( "1" ); await key( "Enter" );
    const ys = g().v.map( ( p ) => p[1] );
    check( g().v.length === 12 && Math.abs( Math.max( ...ys ) - 2 ) < 1e-6, `E 1 Enter: ${g().v.length} vertices, its top at ${Math.max( ...ys ).toFixed( 3 )}` );
    // Ctrl+Z inside Edit Mode, then Ctrl+Shift+Z
    await key( "z", { ctrl: true } );
    const back = g().v.length;
    await key( "z", { ctrl: true, shift: true } );
    check( back === 8 && g().v.length === 12 && !!me(), `Ctrl+Z in Edit Mode: ${back} vertices; Ctrl+Shift+Z: ${g().v.length}, still in Edit Mode` );
    // G Z 1 and S 0.5 on the top
    await key( "g" ); await key( "z" ); await type( "1" ); await key( "Enter" );
    const top = () => g().v.filter( ( p ) => p[1] > 2.5 );
    check( top().length === 4 && top().every( ( p ) => Math.abs( p[1] - 3 ) < 1e-6 ), `G Z 1 Enter: the top up to ${top()[0]?.[1].toFixed( 3 )}` );
    await key( "s" ); await type( "0.5" ); await key( "Enter" );
    check( top().every( ( p ) => Math.abs( Math.abs( p[0] ) - 0.5 ) < 1e-6 && Math.abs( Math.abs( p[2] ) - 0.5 ) < 1e-6 ), `S 0.5 Enter: the top half as wide ${fmt( top()[0] ?? [] )}` );
    // Esc and a right click put the mesh back exactly
    const was = JSON.stringify( g().v );
    await key( "g" ); await io.glide( W / 2 + 90, H / 2 - 70, 250 ); await key( "Escape" );
    const escMesh = JSON.stringify( g().v ) === was;
    await key( "r" ); await io.glide( W / 2 - 90, H / 2 + 50, 250 ); await io.press( 2 ); await io.release( 2 );
    check( escMesh && JSON.stringify( g().v ) === was, `G, Esc: the mesh as it was ( ${escMesh} ); R, a right click: ( ${JSON.stringify( g().v ) === was} )` );
    await io.glide( W / 2, H / 2, 150 );
    // I 0.2 on the top: four faces round it
    const f0 = g().f.length;
    await key( "i" ); await type( "0.2" ); await key( "Enter" );
    check( g().f.length === f0 + 4, `I 0.2 Enter: ${g().f.length - f0} faces more` );
    // vertex select: clicks and Shift+clicks; four top corners, then 3 and 2: what they make
    await key( "1" );
    await key( "a", { alt: true } );
    const corners = g().v.map( ( p, i ) => [p, i] as const ).filter( ( [p] ) => p[1] < -0.5 ).map( ( [p] ) => p );
    const front   = corners.filter( ( p ) => p[2] < 0 || p[0] > 0 );
    await io.click( ...scr( front[0] ) );
    await sleep( 150 );
    await io.click( ...scr( front[1] ), 300, { shiftKey: true } );
    await sleep( 150 );
    const two = me()?.verts;
    await io.click( ...scr( front[1] ), 300, { shiftKey: true } );
    await sleep( 150 );
    check( two === 2 && me()!.verts === 1, `a click, a Shift+click: ${two} selected; Shift+click on the active one again: ${me()?.verts} ( as Blender's )` );
    // the +X side's four corners, facing the camera ( Shift+clicks ), then edge mode: its four edges; face mode: that face
    await key( "a", { alt: true } );
    const bottom = g().v.filter( ( p ) => p[0] > 0.99 );
    for ( const [k, p] of bottom.entries() ) {
      await io.click( ...scr( p ), 300, k ? { shiftKey: true } : {} );
      await sleep( 120 );
    }
    const picked = me()?.verts;
    await key( "2" );
    const edges = me()?.edges;
    await key( "3" );
    check( picked === 4 && edges === 4 && me()!.faces === 1, `four corners clicked ( ${picked} ): edge select ${edges} edges, face select ${me()?.faces} face, as Blender's` );
    // Tab out and in: the selection kept
    await key( "Tab" ); await sleep( 200 ); await key( "Tab" ); await sleep( 200 );
    check( me()?.faces === 1, `Tab out and back in: the same face still selected ( ${me()?.faces} )` );
    // M › At Center on two vertices; X › Vertices
    await key( "1" );
    await key( "a", { alt: true } );
    await io.click( ...scr( bottom[0] ) ); await sleep( 120 );
    await io.click( ...scr( bottom[1] ), 300, { shiftKey: true } ); await sleep( 120 );
    const v0 = g().v.length;
    await key( "m" );
    const merged = await menu( "At Center" );
    check( merged && g().v.length === v0 - 1, `M › At Center: ${v0 - g().v.length} vertex fewer` );
    await key( "x" );
    const deleted = await menu( "Vertices" );
    check( deleted && g().v.length === v0 - 2, `X › Vertices: the merged one gone ( ${g().v.length} left )` );
    // Ctrl+R over a side edge, a click, a right click: a ring round it
    await key( "z", { ctrl: true } ); await key( "z", { ctrl: true } );
    const v1   = g().v.length;
    const side = g().v.filter( ( p ) => p[0] > 0.9 && p[2] < -0.9 );
    const midS = side.length >= 2 ? scr( side.slice( 0, 2 ).reduce( ( a, p ) => a.map( ( x, i ) => x + p[i] / 2 ) as V3, [0, 0, 0] as V3 ) ) : scr( [1, 0, -1] );
    await io.glide( midS[0], midS[1], 250 );
    await key( "r", { ctrl: true } );
    await io.glide( midS[0] + 2, midS[1] + 1, 120 );
    await io.click( midS[0] + 2, midS[1] + 1, 50 );
    await io.press( 2 ); await io.release( 2 );
    await sleep( 300 );
    check( g().v.length > v1 && !eng.modelEd.modal, `Ctrl+R, a click, a right click: ${g().v.length - v1} vertices more, a ring round it ( modal ${eng.modelEd.modal?.kind ?? "none"} )` );
    await key( "Tab" );
    await sleep( 300 );
    check( !me() && g().v.length > 8, `Tab: back in Object Mode, the mesh kept ( ${g().v.length} vertices ); undo step "${history.nextUndo}"` );
    log( "SNAP done" );
    await sleep( 1000 );
    io.stop();
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
