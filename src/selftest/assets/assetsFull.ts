import { LAYOUTS } from "../../terrain/generate";
import * as THREE from "three/webgpu";
import type { V3 } from "../../core/coords";
import { domShot, log, realInput, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { newProject } from "../../map/project";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/assetsfull ): the Assets workspace driven through its UI, end to end — the Material
 * tab ( slots, names, Assign / Select / Deselect in Edit Mode, a material shared by two pieces, Settings and Effects,
 * Specials ), and what the exported map holds for it.
**/
export async function assetsFullSelftest( dir: string ) {
  try {
    const P    = await import( "../../map/project" );
    const proj = joinPath( dir, `assets-${Date.now()}.jbrproj` );
    // ( a small flat map: one with no ground doesn't export )
    await newProject( proj, "Assets", { layout: LAYOUTS[0], base: "flat", slopeDeg: 0, heightRange: 100, seed: 1 } );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 1000 );
    const st      = () => useEditor.getState();
    let phase     = "start";
    const io      = realInput( eng, () => phase );
    const $       = <T extends Element = HTMLElement>( q: string ) => document.querySelector<T & HTMLElement>( q );
    const $$      = <T extends Element = HTMLElement>( q: string ) => [...document.querySelectorAll<T & HTMLElement>( q )];
    const byTitle = ( t: string ) => $$( "button" ).find( ( b ) => b.title === t ) ?? null;
    // ( a press, then a release, then the click: menus open as the mouse goes down )
    const click   = async ( el: HTMLElement | null, what: string ) => {
      if ( !el ) return log( `  (no ${what}: FAIL)` ), false;
      el.dispatchEvent( new MouseEvent( "mousedown", { bubbles: true, button: 0 } ) );
      el.dispatchEvent( new MouseEvent( "mouseup",   { bubbles: true, button: 0 } ) );
      el.click();
      await sleep( 250 );
      return true;
    };
    /**
     * a Blender number field or slider typed into, as a person does: a click, the number, Enter
    **/
    const typeNumber = async ( el: HTMLElement | null, v: number, what: string ) => {
      if ( !el ) return log( `  (no ${what}: FAIL)` );
      el.dispatchEvent( new PointerEvent( "pointerdown", { bubbles: true, button: 0, buttons: 1, clientX: 5, clientY: 5 } ) );
      window.dispatchEvent( new PointerEvent( "pointerup", { bubbles: true, button: 0, clientX: 5, clientY: 5 } ) );
      el.dispatchEvent( new MouseEvent( "click", { bubbles: true } ) );
      await sleep( 200 );
      const inp = document.activeElement as HTMLInputElement | null;
      if ( !inp || inp.tagName !== "INPUT" ) return log( `  (${what} didn't open for typing: FAIL; focus on ${document.activeElement?.tagName}.${( document.activeElement as HTMLElement | null )?.className})` );
      Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, "value" )!.set!.call( inp, String( v ) );
      inp.dispatchEvent( new Event( "input", { bubbles: true } ) );
      // ( React's onBlur listens for focusout: sent itself, as a window behind another gets no blur events )
      inp.dispatchEvent( new FocusEvent( "focusout", { bubbles: true } ) );
      inp.blur();
      await sleep( 250 );
    };
    const row = ( label: string ) => {
      const l = $$( ".bpanel label, .props label" ).find( ( x ) => x.textContent?.trim() === label );
      return ( l?.nextElementSibling as HTMLElement | null ) ?? null;
    };
    // ---- a cube in the Assets workspace, its Material tab
    phase = "set up";
    await click( $$( ".workspaces button" ).find( ( b ) => b.textContent === "Assets" ) ?? null, "Assets tab" );
    await sleep( 800 );
    const addCube = async () => {
      eng.menus.addMenu( new DOMRect( 10, 10, 1, 1 ) );
      await sleep( 300 );
      await click( $$( ".bmenu-item" ).find( ( x ) => x.textContent?.trim() === "Cube" ) ?? null, "Add > Cube" );
      await sleep( 500 );
      return st().customObjects[st().customObjects.length - 1];
    };
    const cube = await addCube();
    st().setSelection( [{ kind: "custom", uid: cube.uid }] );
    await sleep( 300 );
    await click( $$( ".props-tabs button" ).find( ( b ) => b.title === "Material" ) ?? null, "Material tab" );
    const piece = () => st().customObjects.find( ( o ) => o.uid === cube.uid )!;
    const mats  = () => piece().parts[0].materials as Record<string, unknown>[];
    await sleep( 1500 );
    const pv = $<HTMLImageElement>( ".bl-preview img" );
    log( `Material tab: ${$$( ".bl-list-item" ).length} slot(s) listed ("${$( ".bl-list-item .name" )?.textContent}"), preview ${pv ? `${pv.naturalWidth}×${pv.naturalHeight}` : "missing (FAIL)"}, panels ${$$( ".bpanel > header .ttl" ).map( ( h ) => h.textContent ).join( " / " )}` );
    await domShot( $( ".props-editor" )?.closest( ".area" ) ?? null, joinPath( dir, "material-tab.png" ) );
    log( "SHOT material-tab.png" );
    // ( every change to the cube's materials, as it happens )
    let lastMats = JSON.stringify( mats() );
    const unsub  = useEditor.subscribe( ( s2 ) => {
      const c   = s2.customObjects.find( ( x ) => x.uid === cube.uid );
      const now = c ? JSON.stringify( c.parts[0].materials.map( ( x ) => [x.name, x.metallic, x.extra_props] ) ) : "gone";
      if ( now !== lastMats ) log( `  (materials now ${now.slice( 0, 160 )})` );
      lastMats = now;
    } );
    // ---- slots
    phase = "slots";
    await click( byTitle( "Add Material Slot" ), "+" );
    log( `+: ${mats().length} slots, the new one "${mats()[1]?.name}"; list ${$$( ".bl-list-item" ).length} rows, active ${$$( ".bl-list-item" ).findIndex( ( r ) => r.classList.contains( "on" ) )}` );
    const name = $( ".bl-datablock .txt" ) as HTMLInputElement | null;
    if ( name ) {
      name.focus();
      const focused = document.activeElement === name;
      name.value    = "Red Paint";
      name.dispatchEvent( new Event( "input", { bubbles: true } )         );
      name.dispatchEvent( new FocusEvent( "focusout", { bubbles: true } ) );
      await sleep( 100 );
      await sleep( 250 );
      log( `  (name field: focused ${focused}, value then "${name.value}", still in the page ${document.contains( name )})` );
    }
    log( `renamed: slot 2 "${mats()[1]?.name}" (slots: ${mats().map( ( x ) => x.name ?? "(none)" ).join( ", " )}; active row ${$$( ".bl-list-item" ).findIndex( ( r ) => r.classList.contains( "on" ) )})` );
    await typeNumber( row( "Metallic"  ), 0.8,  "Metallic"  );
    await typeNumber( row( "Roughness" ), 0.25, "Roughness" );
    log( `Metallic / Roughness typed: ${mats()[1]?.metallic} / ${( 1 - Number( mats()[1]?.smoothness ) ).toFixed( 2 )} (smoothness ${mats()[1]?.smoothness})` );
    unsub();
    // ---- Edit Mode: a face given the slot, then selected and deselected by it
    phase = "assign";
    eng.modelEd.enter( cube.uid );
    await sleep( 500 );
    const ed    = eng.modelEd as unknown as { mode: string; sel: { f: Set<number> } };
    ed.mode     = "face";
    const faces = ( piece() as unknown as { model: { mesh: { f: number[][] } } } ).model.mesh.f.length;
    ( eng.modelEd as unknown as { sel: unknown } ).sel = { v: new Set(), e: new Set(), f: new Set( [0] ) };
    await sleep( 300 );
    log( `Edit Mode: ${st().modelEdit ? "on" : "off (FAIL)"}, Assign/Select/Deselect ${$( ".bl-row3" ) ? "shown" : "missing (FAIL)"}` );
    await click( $$( ".bl-row3 button" ).find( ( b ) => b.textContent === "Assign" ) ?? null, "Assign" );
    const m = () => ( piece() as unknown as { model: { mesh: { m: number[] } } } ).model.mesh.m;
    log( `Assign: face 0 in slot ${m()[0]} (others ${[...new Set( m().slice( 1 ) )].join( "," )}); undo step "${history.nextUndo}"` );
    ( eng.modelEd as unknown as { sel: unknown } ).sel = { v: new Set(), e: new Set(), f: new Set() };
    await click( $$( ".bl-row3 button" ).find( ( b ) => b.textContent === "Select" ) ?? null, "Select" );
    const sel1 = ed.sel.f.size;
    await click( $$( ".bl-row3 button" ).find( ( b ) => b.textContent === "Deselect" ) ?? null, "Deselect" );
    log( `Select by slot 2: ${sel1} face(s) selected; Deselect: ${ed.sel.f.size} (of ${faces})` );
    eng.modelEd.exit();
    await sleep( 300 );
    // ---- Settings and Effects
    phase       = "settings";
    const blend = row( "Blend Mode" );
    await click( blend?.querySelector( "button" ) ?? blend, "Blend Mode" );
    await click( $$( ".bmenu-item" ).find( ( x ) => x.textContent?.includes( "Alpha Clip" ) ) ?? null, "Alpha Clip" );
    log( `Blend Mode: render mode ${mats()[1]?.render_mode}; Clip Threshold row ${row( "Clip Threshold" ) ? "shown" : "missing (FAIL)"}` );
    const scroll = row( "UV Scroll" );
    await typeNumber( ( scroll?.querySelectorAll( ".num, .numfield, [class*=num]" )[0] as HTMLElement ) ?? null, 0.5, "UV Scroll X" );
    await typeNumber( row( "Glow Pulse" ),  0.6, "Glow Pulse"  );
    await typeNumber( row( "Pulse Speed" ), 2,   "Pulse Speed" );
    const ex = mats()[1]?.extra_props as Record<string, unknown> | undefined;
    log( `Effects: ${JSON.stringify( { scroll: ex?._UvScroll, pulse: ex?._EmissionPulse, speed: ex?._EmissionPulseSpeed } )}` );
    // ---- a second cube sharing the material: an edit through one shows on both
    phase       = "shared";
    const cube2 = await addCube();
    st().setSelection( [{ kind: "custom", uid: cube2.uid }] );
    await sleep( 400 );
    const browse = byTitle( "Browse Material to be linked" );
    await click( browse, "browse" );
    await click( $$( ".bmenu-item" ).find( ( x ) => x.textContent?.includes( "Red Paint" ) ) ?? null, "Red Paint in browse" );
    const users = $( ".bl-ibtn.users" );
    log( `browse: cube 2's slot "${( st().customObjects.find( ( o ) => o.uid === cube2.uid )!.parts[0].materials[0] as Record<string, unknown> ).name}"; users button ${users ? users.textContent : "missing (FAIL)"}` );
    await typeNumber( row( "Metallic" ), 0.3, "Metallic (cube 2)" );
    log( `edited through cube 2: cube 1's Red Paint metallic ${mats()[1]?.metallic} (cube 2's ${( st().customObjects.find( ( o ) => o.uid === cube2.uid )!.parts[0].materials[0] as Record<string, unknown> ).metallic})` );
    await click( users, "users" );
    log( `made single user: cube 2's material "${( st().customObjects.find( ( o ) => o.uid === cube2.uid )!.parts[0].materials[0] as Record<string, unknown> ).name}", users button ${$( ".bl-ibtn.users" ) ? "still there (FAIL)" : "gone"}` );
    // ---- removing a slot: its faces go to the one before
    phase = "remove";
    st().setSelection( [{ kind: "custom", uid: cube.uid }] );
    await sleep( 400 );
    await click( $$( ".bl-list-item" )[1] ?? null,  "slot 2" );
    await click( byTitle( "Remove Material Slot" ), "−"      );
    log( `−: ${mats().length} slot(s); face 0 now in slot ${m()[0]}` );
    // ---- weathering: each panel's Generate, as clicked
    phase = "weathering";
    {
      const MP = await import( "../../texture/meshPaint" );
      eng.nav.lookAtUnity( [cube.position.x + 3.2, cube.position.y + 3, cube.position.z - 3.2], [cube.position.x, cube.position.y, cube.position.z] );
      await sleep( 500 );
      const panel = ( title: string ) => $$( ".bpanel" ).find( ( p ) => p.querySelector( ".ttl" )?.textContent === title ) ?? null;
      log( `weathering panels: ${["Edge Wear", "Scratches", "Dirt"].map( ( t ) => `${t} ${panel( t ) ? "there" : "missing (FAIL)"}` ).join( ", " )}` );
      const sum = ( px: Uint8Array | undefined ) => ( px ? px.reduce( ( acc, v, i ) => ( i % 4 === 3 ? acc : acc + v ), 0 ) : -1 );
      for ( const t of ["Edge Wear", "Scratches", "Dirt"] ) {
        const T0     = MP.pieceTexture( cube.uid );
        const before = { c: sum( T0?.rgba ), m: sum( T0?.ch.metallic ), r: sum( T0?.ch.roughness ), h: sum( T0?.ch.height ) };
        const btn    = [...( panel( t )?.querySelectorAll<HTMLButtonElement>( "button" ) ?? [] )].find( ( b ) => b.textContent === "Generate" ) ?? null;
        const t0     = performance.now();
        await click( btn, `${t} Generate` );
        await waitFor( () => ( st().busy ? null : true ), `${t} to finish`, 60000 );
        const ms              = performance.now() - t0;
        const T               = MP.pieceTexture( cube.uid );
        const after           = { c: sum( T?.rgba ), m: sum( T?.ch.metallic ), r: sum( T?.ch.roughness ), h: sum( T?.ch.height ) };
        const moved: string[] = ( Object.keys( after ) as ( keyof typeof after )[] ).filter( ( k ) => after[k] !== before[k] );
        const want            = t === "Edge Wear" ? ["c", "m", "r"] : t === "Scratches" ? ["c", "m", "r", "h"] : ["c", "r"];
        log( `${t}: ${ms.toFixed( 0 )} ms (veil included); changed ${moved.join( "," ) || "nothing"}${want.every( ( k ) => moved.includes( k ) ) ? "" : ` (FAIL: want ${want.join( "," )})`}; undo step "${history.nextUndo}"` );
      }
      // ( Material Preview: the paint shows, as in Blender's )
      await click( byTitle( "Viewport Shading: Material Preview" ), "Material Preview shading" );
      await sleep( 900 );
      await ipc.writeBinary( joinPath( dir, "weathered.png" ), await eng.pictures.capture() );
      log( "SHOT weathered.png" );
      // undone, one step each
      for ( const t of ["Dirt", "Scratches", "Edge Wear"] ) {
        const label = history.nextUndo;
        history.undo();
        await sleep( 100 );
        log( `undo: "${label}"${label === t ? "" : ` (FAIL: want "${t}")`}` );
      }
      for ( let k = 0; k < 3; k++ ) history.redo();
    }
    // ---- a decal: the Decal tool, its image, the mouse over the piece, a click
    phase = "decal";
    {
      const MP                      = await import( "../../texture/meshPaint" );
      const { loadDecal, useDecal } = await import( "../../texture/stencil"   );
      st().setSelection( [{ kind: "custom", uid: cube.uid }] );
      await sleep( 200 );
      // the header's mode menu: Texture Paint
      await click( $( ".mode-pull" ), "mode menu" );
      await click( $$( ".bmenu-item" ).find( ( x ) => x.textContent?.includes( "Texture Paint" ) ) ?? null, "Texture Paint" );
      await waitFor( () => ( st().busy ? null : true ), "Texture Paint", 30000 );
      await sleep( 400 );
      log( `mode: ${st().tool === "material" && st().materialMode === "paint" ? "Texture Paint" : `${st().tool}/${st().materialMode} (FAIL)`}` );
      await click( byTitle( "Decal" ), "Decal tool" );
      log( `Decal tool: ${st().paint.texTool === "decal" ? "picked" : `not picked (FAIL: ${st().paint.texTool})`}; header ${$( ".decal-pick" ) ? "shows its image button" : "missing (FAIL)"}` );
      await loadDecal( "C:\\Projects\\jibbers-map\\studio\\public\\splash.png" );
      useDecal.setState( { size: 0.8, angle: 0 } );
      st().setPaint( { channel: "colour", strength: 1 } );
      await sleep( 300 );
      const c      = cube.position, top: V3 = [c.x, c.y + 1, c.z];
      const [x, y] = io.scr( top );
      await io.glide( x, y, 300 );
      await sleep( 200 );
      const cur  = $( ".decal-cursor" );
      const cw   = cur ? cur.getBoundingClientRect().width : 0;
      const mpp  = ( eng.meshPainter as unknown as { mpp( p: THREE.Vector3 ): number } ).mpp( new THREE.Vector3( top[0], top[1], -top[2] ) );
      const want = eng.meshPainter.decalAt( x, y );
      log( `decal under the mouse: ${cur ? `${cw.toFixed( 0 )} px across, styled ${cur.style.width} (0.8 m on the top there is ${( 0.8 / mpp ).toFixed( 0 )} px; stamped as ${want ? ( want.img!.w * want.scale ).toFixed( 0 ) : "?"} px)` : "not shown (FAIL)"}${cur && want && Math.abs( cw - want.img!.w * want.scale ) < 2 ? "" : " (FAIL: not as it's stamped)"}` );
      const before = MP.pieceTexture( cube.uid )!.rgba.slice();
      await io.click( x, y, 200 );
      await sleep( 300 );
      const after = MP.pieceTexture( cube.uid )!.rgba;
      let changed = 0;
      for ( let k = 0; k < after.length; k += 4 ) if ( Math.abs( after[k] - before[k] ) + Math.abs( after[k + 1] - before[k + 1] ) + Math.abs( after[k + 2] - before[k + 2] ) > 30 ) changed++;
      log( `decal stamped: ${changed} texels changed${changed > 200 ? "" : " (FAIL)"}; undo step "${history.nextUndo}"${history.nextUndo === "Decal" ? "" : " (FAIL)"}` );
      await sleep( 500 );
      await ipc.writeBinary( joinPath( dir, "decal.png" ), await eng.pictures.capture() );
      log( "SHOT decal.png" );
      // off the piece: nothing under the mouse, nothing stamped
      await io.glide( 8, 8, 200 );
      await sleep( 150 );
      log( `decal off the piece: ${$( ".decal-cursor" ) ? "still shown (FAIL)" : "not shown"}` );
    }
    io.stop();
    for ( const line of io.report() ) log( line );
    // ---- what the map gets: cube 2 ( its Red Paint.001 has the effects ) put in the map, as a placed copy is
    phase                                   = "export";
    const { setMapCustomObjects, mapState } = await import( "../../pieces/assetScene" );
    const two                               = st().customObjects.find( ( o ) => o.uid === cube2.uid )!;
    setMapCustomObjects( [...mapState().customObjects, { ...structuredClone( two ), uid: "assets-test-cube" }] );
    await P.saveProject();
    const out = joinPath( dir, "assets.jbrmap" );
    await ipc.exportProject( proj, out );
    const text = await ipc.readText( out );
    log( `exported: ${text.length} chars; a "name" key in its materials: ${/"base-tex"[^}]*"name"/.test( text ) ? "yes (FAIL)" : "no"}; _UvScroll ${text.includes( "_UvScroll" ) ? "there" : "missing"}; _EmissionPulse ${text.includes( "_EmissionPulse" ) ? "there" : "missing"}` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
