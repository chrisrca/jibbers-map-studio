import { LAYOUTS } from "../../terrain/generate";
import { feature, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { joinPath } from "../../core/ipc";
import { newProject } from "../../map/project";
import { placeEntry } from "../../pieces/library";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/uifixes ): clicked through as a person meets them: the View and Terrain menus ( an
 * icon by every item ), the Assets workspace's Properties tabs in Modeling and Material mode ( each tab opening its
 * own ), the Decal tool's image button, a new run's width.
**/
export async function uiFixesSelftest( dir: string ) {
  try {
    const st = () => useEditor.getState();
    await newProject( joinPath( dir, `ui-${Date.now()}.jbrproj` ), "UI", { layout: LAYOUTS[0], base: "flat", slopeDeg: 0, heightRange: 100, seed: 1 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await sleep( 1500 );
    const press = ( el: Element | undefined | null ) => el?.dispatchEvent( new MouseEvent( "mousedown", { bubbles: true, button: 0 } ) );
    const menu  = async ( label: string ) => {
      const b = [...document.querySelectorAll<HTMLElement>( ".vp-header .bpull" )].find( ( x ) => x.textContent?.trim() === label );
      if ( !b ) return log( `${label} menu: missing (FAIL)` );
      press( b );
      await sleep( 300 );
      const items          = [...document.querySelectorAll<HTMLElement>( ".bmenu .bmenu-item" )];
      const bare           = items.filter( ( it ) => !it.querySelector( ".ico" )?.children.length ).map( ( it ) => it.textContent?.trim() );
      // ( a submenu's items too: a click on its row opens it )
      const subs: string[] = [];
      for ( const it of items.filter( ( x ) => x.querySelector( ".more" ) ) ) {
        it.click();
        await sleep( 300 );
        const menus = document.querySelectorAll( ".bmenu" );
        if ( menus.length > 1 ) for ( const x of menus[menus.length - 1].querySelectorAll<HTMLElement>( ".bmenu-item" ) ) if ( !x.querySelector( ".ico" )?.children.length ) subs.push( x.textContent!.trim() );
      }
      log( `${label} menu: ${items.length} items, without an icon: ${[...bare, ...subs].join( ", " ) || "none"}${bare.length || subs.length ? " (FAIL)" : ""}` );
      document.body.dispatchEvent( new MouseEvent( "mousedown", { bubbles: true, button: 0 } ) );
      await sleep( 200 );
    };
    await menu( "View" );
    st().setTool( "trail" );
    await sleep( 500 );
    await menu( "Terrain" );
    log( `a new run's width: ${st().trailTool.width} m${st().trailTool.width === 15 ? "" : " (FAIL)"}; Ground Detail slider ${[...document.querySelectorAll( "label, span" )].some( ( x ) => x.textContent?.trim() === "Ground Detail" ) ? "still there (FAIL)" : "gone"}` );
    // the Assets workspace: a piece on the stage, Modeling's tabs, then Material mode's
    st().setTool( "model" );
    await sleep( 600 );
    await placeEntry( feature( "banana_box" ), [0, 0, 0] );
    await sleep( 1500 );
    const uid = st().customObjects[0]?.uid;
    if ( uid ) st().setSelection( [{ kind: "custom", uid }] );
    await eng.modelling.convertToModel( uid ? [uid] : [] );
    await sleep( 600 );
    const tabs   = () => [...document.querySelectorAll<HTMLButtonElement>( ".props-tabs button" )];
    const titles = () => tabs().map( ( b ) => b.title ).join( ", " );
    log( `Modeling tabs: ${titles()}` );
    st().setTool( "material" );
    await sleep( 600 );
    log( `Material mode tabs: ${titles()}${titles() === "Material" ? "" : " (FAIL)"}; shown: ${document.querySelector( ".ctx-path" )?.textContent}` );
    const { enterTexturePaint } = await import( "../../ui/blender/AssetsUI" );
    st().setSelection( [{ kind: "custom", uid: st().customObjects[0].uid }] );
    await enterTexturePaint();
    await sleep( 800 );
    log( `Texture Paint tabs: ${titles()}${titles() === "Tool, Material" ? "" : " (FAIL)"}` );
    for ( const want of ["Material", "Tool"] ) {
      tabs().find( ( b ) => b.title === want )?.click();
      await sleep( 300 );
      const on = tabs().find( ( b ) => b.classList.contains( "on" ) )?.title;
      log( `  clicked ${want}: ${on === want ? "opens it" : `opens ${on} (FAIL)`}` );
    }
    st().setPaint( { texTool: "decal" } );
    await sleep( 300 );
    const pick = document.querySelector<HTMLElement>( ".decal-pick" );
    log( `Decal tool: image button ${pick ? `"${pick.textContent?.trim()}"` : "missing (FAIL)"}${pick?.textContent?.includes( "Image" ) ? "" : " (FAIL)"}` );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
