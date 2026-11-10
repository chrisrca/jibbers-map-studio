import { ipc, joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";
import type { ToolId } from "../../map/store/types";
import { newCircle, newCurve, newFormation, newSkiLine, type Shape } from "../../terrain/shapes/shapes";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/uifit ): nothing in the editor's panels and bars squeezed. A real map opened ( MLNZ
 * Park, the folder's map.txt otherwise ), a shape of every kind added; the side panel dragged to its narrowest; then
 * every tool out in turn, one of everything picked in turn ( a feature, a piece, a spawn, each kind of shape ), every
 * Properties tab, every folded panel opened, the Assets workspace's tabs too. At each: every word in a button, label or
 * field that doesn't fit its box ( spilling over the next, or cut off without an ellipsis ), and every row that runs
 * past its panel's side.
**/
export async function uiFitSelftest( dir: string ) {
  const found = new Map<string, string>();
  try {
    const P   = await import( "../../map/project" );
    const src = ( await ipc.readText( joinPath( dir, "map.txt" ) ).catch( () => "" ) ).trim() || "C:/Projects/jibbers-map/Jibbers_Template/MLNZ Park.jbrmap";
    const proj = joinPath( dir, `fit-${Date.now()}.jbrproj` );
    await ipc.importJbrmap( src, proj );
    await P.openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the ground", 60000 );
    await waitFor( () => ( eng.veil.loading ? null : true ), "the map", 300000 );
    await sleep( 1500 );
    const st = () => useEditor.getState();

    // ---- a shape of every kind, near the first spawn
    const c   = st().spawns[0]?.position ?? [0, 0, 0];
    const x   = c[0], z = c[2];
    const g   = ( a: number, b: number ) => terrain.heightAt( a, b );
    const { SKI_LINE_PRESETS, newSkiLineFeature, withPreset } = await import( "../../terrain/shapes/shapes/skiline" );
    const ramp: Shape = { ...newCurve( [x + 20, z], [x + 20, z + 25] ), startArm: [6, 8], stripes: SKI_LINE_PRESETS[0].stripes() };
    const line        = { ...newSkiLine( [0, 30, 60].map( ( d ) => ( { p: [x - 20, g( x - 20, z + d ), z + d] as [number, number, number], width: null, roll: 0 } ) ) ) };
    line.features     = [withPreset( newSkiLineFeature( 20 ), SKI_LINE_PRESETS[0] )];
    const shapes: Shape[] = [ramp, newCircle( [x + 40, z], 8 ), newFormation( [[x - 60, z], [x - 40, z + 10], [x - 50, z + 30]] ), line];
    const { liveShape, commitShape } = await import( "../../terrain/shapes/edits" );
    for ( const s of shapes ) {
      liveShape( s, "Add" );
      commitShape();
    }
    await sleep( 1500 );

    // ---- the side panel at its narrowest ( its splitter dragged right, as far as it goes )
    const split = [...document.querySelectorAll<HTMLElement>( ".areas > .split-h" )].pop();
    if ( split ) {
      const r = split.getBoundingClientRect(), y = r.top + r.height / 2;
      split.dispatchEvent( new PointerEvent( "pointerdown", { clientX: r.left + 2, clientY: y, bubbles: true } ) );
      for ( let k = 1; k <= 20; k++ ) window.dispatchEvent( new PointerEvent( "pointermove", { clientX: r.left + 2 + k * 30, clientY: y, bubbles: true } ) );
      window.dispatchEvent( new PointerEvent( "pointerup", { bubbles: true } ) );
    }
    await sleep( 500 );
    const side = document.querySelector<HTMLElement>( ".props-editor" );
    log( `side panel ${side ? Math.round( side.getBoundingClientRect().width ) : "?"} px wide` );

    // ---- what doesn't fit, here
    const textOf = ( el: Element ) => [...el.childNodes].filter( ( n ) => n.nodeType === 3 ).map( ( n ) => n.textContent ?? "" ).join( "" ).trim();
    const where  = ( el: Element ) => {
      const sec = el.closest( ".bpanel" )?.querySelector( "header .ttl" )?.textContent ?? "";
      const pan = el.closest( ".panel" )?.querySelector( ".ctx .ttl" )?.textContent ?? el.closest( ".area" )?.className.replace( /\s+/g, "." ) ?? "";
      return [pan, sec].filter( Boolean ).join( " › " );
    };
    const scan = async ( scene: string ) => {
      await sleep( 450 );
      // ( every folded panel opened )
      for ( let k = 0; k < 3; k++ ) {
        const shut = [...document.querySelectorAll<HTMLElement>( ".bpanel.folded > header" )];
        if ( !shut.length ) break;
        shut.forEach( ( h ) => h.click() );
        await sleep( 250 );
      }
      for ( const el of document.querySelectorAll<HTMLElement>( "button, label, span, .ttl, .num, .bdrop, option, a, h1, h2, h3, div" ) ) {
        const r = el.getBoundingClientRect();
        if ( r.width < 2 || r.height < 2 || !el.offsetParent ) continue;
        if ( el.closest( ".modal-back, .bmenu, canvas, .statusbar, .outliner, .assets-grid, .toast, .tip" ) ) continue;
        const cs   = getComputedStyle( el );
        const text = textOf( el );
        let what   = "";
        // ( its own words wider than it, not cut off with an ellipsis: they spill, or are cut mid-letter )
        if ( text && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis" && cs.overflowX !== "auto" && cs.overflowX !== "scroll" ) what = `"${text}" ${el.scrollWidth} px in ${el.clientWidth}`;
        // ( a button's contents past its edge )
        else if ( el.tagName === "BUTTON" && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== "auto" ) what = `button "${el.textContent?.trim()}" ${el.scrollWidth} px in ${el.clientWidth}`;
        // ( a row in a Properties page past its side )
        else if ( el.parentElement?.classList.contains( "props" ) ) {
          const p = el.parentElement.getBoundingClientRect();
          if ( r.right > p.right + 1.5 ) what = `"${el.textContent?.trim().slice( 0, 40 )}" ${Math.round( r.right - p.right )} px past its panel`;
        }
        if ( !what ) continue;
        const key = `${where( el )} | ${what}`;
        if ( !found.has( key ) ) {
          found.set( key, scene );
          log( `  SQUEEZED ( ${scene} ) ${key}` );
        }
      }
    };
    const tab = async ( scene: string ) => {
      const tabs = [...document.querySelectorAll<HTMLButtonElement>( ".props-tabs button" )];
      if ( !tabs.length ) return scan( scene );
      for ( const b of tabs ) {
        b.click();
        await scan( `${scene}, ${b.title}` );
      }
    };

    // ---- every tool, nothing picked
    st().setSelection( [] );
    const tools: [string, ToolId, Record<string, unknown>?][] = [
      ["Select", "select"], ["Sculpt", "sculpt"], ["Ramp", "shape", { shapeKind: "curve" }], ["Circle", "shape", { shapeKind: "circle" }], ["Copy", "shape", { shapeKind: "stamp" }],
      ["Formation", "shape", { shapeKind: "formation" }], ["Paint stroke", "shape", { shapeKind: "paint" }], ["Ski Line", "shape", { shapeKind: "skiline" }], ["Trails", "trail"],
      ["Paint", "paint"], ["Place", "place"], ["Spawn", "spawn"], ["Scatter", "scatter"], ["Collider", "collider"],
    ];
    for ( const [name, tool, extra] of tools ) {
      useEditor.setState( { tool, ...extra } );
      await tab( `${name} tool` );
    }
    // ---- one of everything picked
    useEditor.setState( { tool: "select" } );
    const picks: [string, { kind: "object" | "spawn" | "custom" | "shape"; uid: string } | null][] = [
      ["a feature", st().objects[0] ? { kind: "object", uid: st().objects[0].uid } : null],
      ["a piece", st().customObjects[0] ? { kind: "custom", uid: st().customObjects[0].uid } : null],
      ["a spawn", st().spawns[0] ? { kind: "spawn", uid: st().spawns[0].uid } : null],
      ...st().shapes.map( ( s ) => [`a ${s.kind} shape`, { kind: "shape" as const, uid: s.uid }] as [string, { kind: "shape"; uid: string }] ),
    ];
    for ( const [name, sel] of picks ) {
      if ( !sel ) continue;
      st().setSelection( [sel] );
      await tab( `${name} picked` );
    }
    // ---- the Assets workspace, a piece picked
    if ( st().customObjects[0] ) {
      st().setSelection( [{ kind: "custom", uid: st().customObjects[0].uid }] );
      for ( const tool of ["model", "material"] as ToolId[] ) {
        useEditor.setState( { tool } );
        await tab( `Assets, ${tool}` );
      }
    }
    useEditor.setState( { tool: "select" } );
    log( `${found.size} squeezed` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
