import { joinPath } from "../../core/ipc";
import type { ObjectEntry } from "../../core/types";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { brushLook } from "../../viewport/render/terrainRenderer";
import { log, realInput, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/designpick ): Design's Select Box and Cursor, as a person uses them. On a new map
 * with three features: Select Box from the toolbar ( no gizmo then ), a box dragged round two of them, a click on the
 * third ( a new selection ), Shift+click adding, the header's Subtract taking one away; the Cursor put down on the
 * ground and a cube added there; in Terrain Mode, Select Box at the top too, the brush's ring gone while it's the tool,
 * let go of when a brush is picked. And the splash screen's Import button, above Real Mountain.
**/
export async function designPickSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const { newEmptyProject } = await import( "../../map/project/sessions" );
    await newEmptyProject( joinPath( dir, `pick-${Date.now()}.jbrproj` ), "Untitled" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the ground", 60000 );
    await sleep( 1500 );
    const st  = () => useEditor.getState();
    const g   = ( x: number, z: number ) => terrain.heightAt( x, z );
    const put = ( uid: string, id: string, x: number, z: number ): ObjectEntry => ( { uid, id, position: [x, g( x, z ), z], rotation: [0, 0, 0], scale: [1, 1, 1], params: {} } );
    useEditor.setState( { objects: [put( "a", "flat_box", -10, 0 ), put( "b", "ball", 0, 0 ), put( "c", "rail_long", 14, 0 )], tool: "select" } );
    eng.nav.lookAtUnity( [0, g( 0, 0 ) + 30, -35], [0, g( 0, 0 ), 0] );
    await sleep( 1500 );
    const io     = realInput( eng, () => "pick" );
    const button = ( title: string ) => document.querySelector<HTMLButtonElement>( `.tool-column button[title="${title}"]` );
    const scr    = ( uid: string ) => io.scr( st().objects.find( ( o ) => o.uid === uid )!.position );
    const sel    = () => st().selection.map( ( s ) => s.uid ).sort().join( "," );

    // ---- Select Box: picked from the top of the toolbar; no gizmo while it's the tool
    check( !!button( "Select Box" ) && !!button( "Cursor" ) && button( "Select Box" ) === document.querySelector( ".tool-column .tool-group button" ), "Object Mode: Select Box and Cursor at the top of the toolbar" );
    button( "Select Box" )!.click();
    await sleep( 300 );
    check( st().designPick === "box" && ( document.body.textContent ?? "" ).includes( "Select Box" ), "Select Box the tool, its name in the tool settings" );
    const [ax, ay] = scr( "a" ), [bx, by] = scr( "b" );
    await io.drag( Math.min( ax, bx ) - 40, Math.min( ay, by ) - 40, Math.max( ax, bx ) + 25, Math.max( ay, by ) + 30, 500 );
    await sleep( 300 );
    check( sel() === "a,b" && !eng.blGizmo.group.visible, `a box round two of them selects those two: ${sel()}, no gizmo` );
    await io.click( ...scr( "c" ) );
    await sleep( 300 );
    check( sel() === "c", `a click on the third: a new selection, ${sel()}` );
    await io.click( ...scr( "a" ), 350, { shiftKey: true } );
    await sleep( 300 );
    check( sel() === "a,c", `Shift+click adds: ${sel()}` );
    useEditor.setState( { selectOp: "subtract" } );
    await sleep( 200 );
    const [cx, cy] = scr( "c" );
    await io.drag( cx - 30, cy - 30, cx + 30, cy + 30, 400 );
    await sleep( 300 );
    check( sel() === "a", `the header's Subtract: a box takes one away, ${sel()}` );
    useEditor.setState( { selectOp: "set" } );

    // ---- Cursor: put down on the ground, a cube added there
    button( "Cursor" )!.click();
    await sleep( 300 );
    const spot = io.scr( [5, g( 5, 8 ), 8] );
    await io.click( ...spot );
    await sleep( 400 );
    const cur  = st().cursor3d;
    check( st().cursorDown && Math.hypot( cur[0] - 5, cur[2] - 8 ) < 1.5 && !!document.querySelector( ".cursor3d" ), `the 3D cursor put down where it's clicked: ${cur.map( ( v ) => v.toFixed( 1 ) ).join( ", " )}, drawn` );
    const n0 = st().customObjects.length;
    eng.menus.addMenu( new DOMRect( 10, 10, 1, 1 ) );
    await sleep( 300 );
    [...document.querySelectorAll<HTMLElement>( ".bmenu-item" )].find( ( x ) => x.textContent?.trim() === "Cube" )?.click();
    await sleep( 800 );
    const cube = st().customObjects[n0];
    check( !!cube && Math.hypot( cube.position.x - cur[0], cube.position.z - cur[2] ) < 1, `Add › Cube put at the cursor: ${cube ? `${cube.position.x.toFixed( 1 )}, ${cube.position.z.toFixed( 1 )}` : "none"}` );
    log( "SNAP object-mode" );
    await sleep( 1500 );

    // ---- Terrain Mode: the same at the top; the brush's ring gone while Select Box is the tool; a brush lets it go
    st().setTool( "sculpt" );
    await sleep( 400 );
    check( st().designPick === null && !!button( "Select Box" ), "Terrain Mode: Select Box at the top too; picking another tool let it go" );
    button( "Select Box" )!.click();
    await sleep( 200 );
    await io.glide( ...io.scr( [0, g( 0, 0 ), 0] ), 300 );
    await sleep( 300 );
    check( brushLook.visible.value === 0 && st().tool === "sculpt", "no brush ring while Select Box is the tool, still in Terrain Mode" );
    button( "Smooth (2)" )?.click() ?? [...document.querySelectorAll<HTMLButtonElement>( ".tool-column button" )].find( ( b ) => b.title.startsWith( "Smooth" ) )?.click();
    await sleep( 300 );
    await io.glide( ...io.scr( [2, g( 2, 2 ), 2] ), 300 );
    await sleep( 300 );
    check( st().designPick === null && brushLook.visible.value === 1, "a brush picked: Select Box let go, the ring back" );
    log( "SNAP terrain-mode" );
    await sleep( 1200 );
    io.stop();

    // ---- the splash screen: Import, above Real Mountain
    useEditor.setState( { splash: true } );
    await sleep( 800 );
    const items = [...document.querySelectorAll<HTMLElement>( ".bsplash-item .name" )].map( ( x ) => x.textContent?.trim() ?? "" );
    const imp   = items.indexOf( "Import…" ), real = items.indexOf( "Real Mountain…" );
    check( imp >= 0 && real === imp + 1, `the splash screen: ${items.slice( 0, 4 ).join( " · " )}` );
    log( "SNAP splash" );
    await sleep( 1500 );
    useEditor.setState( { splash: false } );
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
