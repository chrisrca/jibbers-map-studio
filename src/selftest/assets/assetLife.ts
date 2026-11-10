import { joinPath } from "../../core/ipc";
import { arr3 } from "../../core/types";
import { useEditor } from "../../map/store";
import { evaluate } from "../../model/build";
import { selFromFaces, selFromVerts } from "../../model/ops";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/assetlife ): an asset's life, as a person goes through it: made in Assets ( a cube,
 * its top up a metre, its edges creased, its UVs cube projected, Subdivision Surface on ), Shift+Ctrl+S as a new asset;
 * placed twice on the map ( one bigger ); opened again from its card ( all of that still there ), its top made smaller,
 * Ctrl+S over it: both placed copies made over, each where it was and as big; the map saved and opened again, the
 * same; the asset opened once more, as it was saved.
**/
export async function assetLifeSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const P    = await import( "../../map/project" );
    const proj = joinPath( dir, `life-${Date.now()}.jbrproj` );
    await P.newEmptyProject( proj, "Asset Life" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await sleep( 1000 );
    const st  = () => useEditor.getState();
    const tab = async ( name: string ) => {
      [...document.querySelectorAll<HTMLButtonElement>( ".workspaces button" )].find( ( b ) => b.textContent === name )?.click();
      await sleep( 1200 );
    };
    const io    = realInput( eng, () => "life" );
    const frame = () => new Promise<void>( ( r ) => requestAnimationFrame( () => r() ) );
    const key   = async ( k: string, m: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {} ) => {
      const init = { key: k, code: k.length === 1 ? ( /[0-9]/.test( k ) ? `Digit${k}` : `Key${k.toUpperCase()}` ) : k, ctrlKey: !!m.ctrl, shiftKey: !!m.shift, altKey: !!m.alt, bubbles: true, cancelable: true };
      window.dispatchEvent( new KeyboardEvent( "keydown", init ) );
      window.dispatchEvent( new KeyboardEvent( "keyup", init ) );
      await frame();
      await sleep( 60 );
    };
    const type = async ( s: string ) => { for ( const ch of s ) await key( ch ); };
    const menu = async ( label: string ) => {
      await sleep( 200 );
      const it = [...document.querySelectorAll<HTMLElement>( ".bmenu .bmenu-item" )].find( ( x ) => x.textContent?.trim().startsWith( label ) );
      it?.click();
      await sleep( 300 );
      return !!it;
    };
    await tab( "Assets" );
    await io.glide( io.rc.width / 2, io.rc.height / 2, 200 );

    // ---------------------------------------------------------------- made, and saved as a new asset
    await key( "A", { shift: true } );
    await menu( "Cube" );
    await sleep( 300 );
    const uid = st().selection[0]!.uid;
    const o   = () => st().customObjects.find( ( x ) => x.uid === uid )!;
    await key( "Tab" ); await key( "3" );
    const g   = () => o().model!.mesh;
    eng.modelEd.sel = selFromFaces( g(), g().f.flatMap( ( f, i ) => ( f.every( ( v ) => g().v[v][1] > 0.99 ) ? [i] : [] ) ) );
    eng.modelEd.sync();
    await key( "e" ); await type( "1" ); await key( "Enter" );
    await key( "2" ); await key( "a" );
    await key( "E", { shift: true } ); await type( "1" ); await key( "Enter" );
    await key( "3" ); await key( "a" );
    await key( "u" ); await menu( "Cube Projection" );
    await key( "Tab" );
    st().updateCustom( "Modifiers", [uid], ( x ) => ( { ...x, model: { ...x.model!, modifiers: [{ type: "subsurf", on: true, levels: 2 }] } } ) );
    await sleep( 200 );
    const made = { v: g().v.length, creases: Object.keys( g().c ?? {} ).length, uvs: ( g().u ?? [] ).filter( ( u ) => u.length ).length, mods: o().model!.modifiers.length };
    log( `made: ${made.v} vertices, ${made.creases} creased edges, ${made.uvs} faces with UVs, ${made.mods} modifier` );
    await key( "S", { ctrl: true, shift: true } );
    await sleep( 300 );
    const field = document.querySelector<HTMLInputElement>( ".ask-field input" );
    if ( field ) {
      Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, "value" )!.set!.call( field, "Life Box" );
      field.dispatchEvent( new Event( "input", { bubbles: true } ) );
      await sleep( 100 );
      [...document.querySelectorAll<HTMLButtonElement>( "button.btn.primary" )].find( ( b ) => b.textContent?.trim() === "Save" )?.click();
    }
    const entry = await waitFor( () => st().assetLibrary.find( ( e ) => e.name === "Life Box" ) ?? null, "the saved asset", 20000 ).catch( () => null );
    check( !!field && !!entry, `Shift+Ctrl+S as "Life Box": in the library ( ${entry?.id ?? "missing"} )` );
    if ( !entry ) throw new Error( "not saved" );

    // ---------------------------------------------------------------- placed twice on the map
    await tab( "Design" );
    const { placeEntry } = await import( "../../pieces/library" );
    await placeEntry( entry.id, [10, 0, 10] );
    await placeEntry( entry.id, [20, 0, 10] );
    await sleep( 500 );
    const placed = () => st().customObjects.filter( ( x ) => x.source?.id === entry.id );
    const [, p2] = placed();
    st().updateCustom( "Bigger", [p2.uid], ( x ) => ( { ...x, scale: { x: 2, y: 2, z: 2 }, parts: x.parts.map( ( q ) => ( { ...q, local_scale: { x: 2, y: 2, z: 2 } } ) ) } ) );
    await sleep( 200 );
    const where = placed().map( ( x ) => [arr3( x.position ), arr3( x.scale )] );
    const was   = placed().map( ( x ) => x.source!.stamp );
    check( placed().length === 2, `placed twice: ${placed().length} on the map` );

    // ---------------------------------------------------------------- opened from its card, made over, saved over
    await tab( "Assets" );
    const { openAsset, saveAsset } = await import( "../../pieces/assetFiles" );
    await openAsset( entry.id, entry.name );
    await sleep( 600 );
    const back = st().customObjects[0];
    const bm   = back?.model?.mesh;
    check( !!bm && bm.v.length === made.v && Object.keys( bm.c ?? {} ).length === made.creases && ( bm.u ?? [] ).filter( ( u ) => u.length ).length === made.uvs && back.model!.modifiers.length === made.mods,
      `opened from its card: ${bm?.v.length} vertices, ${Object.keys( bm?.c ?? {} ).length} creased, ${( bm?.u ?? [] ).filter( ( u ) => u.length ).length} with UVs, ${back?.model?.modifiers.length} modifier, as saved` );
    st().setSelection( [{ kind: "custom", uid: back.uid }] );
    await key( "Tab" ); await key( "1" );
    const m2 = back.model!.mesh;
    eng.modelEd.sel = selFromVerts( m2, m2.v.flatMap( ( p, i ) => ( p[1] > 1.5 ? [i] : [] ) ) );
    eng.modelEd.sync();
    await key( "s" ); await type( "0.5" ); await key( "Enter" );
    await key( "Tab" );
    const asset = st().customObjects[0].model!;
    const saved = await saveAsset();
    await sleep( 600 );
    await tab( "Design" );
    const want  = evaluate( asset ).v.length;
    const now   = placed();
    const same  = now.every( ( x, i ) => JSON.stringify( arr3( x.position ) ) === JSON.stringify( where[i][0] ) && JSON.stringify( arr3( x.scale ) ) === JSON.stringify( where[i][1] ) );
    // ( each made from the asset file as saved over: stamped with it since )
    const small = now.length === 2 && now.every( ( x, i ) => x.parts.length > 0 && x.source!.stamp > was[i] );
    check( saved && small && same, `Ctrl+S over it: both placed copies made over ( ${now.length} ), each where it was and as big ( ${same} )` );
    log( `( the asset now: ${want} vertices evaluated )` );

    // ---------------------------------------------------------------- saved, opened again
    await P.saveProject();
    await P.openProject( proj );
    await waitFor( () => ( st().customObjects.length ? true : null ), "opened again", 60000 );
    await sleep( 800 );
    const again = st().customObjects.filter( ( x ) => x.source?.id === entry.id );
    check( again.length === 2 && again.every( ( x, i ) => JSON.stringify( arr3( x.scale ) ) === JSON.stringify( where[i][1] ) ), `the map saved and opened again: ${again.length} placed, sizes kept` );
    await tab( "Assets" );
    await openAsset( entry.id, entry.name );
    await sleep( 600 );
    const last = st().customObjects[0]?.model;
    check( !!last && last.mesh.v.length === asset.mesh.v.length && last.mesh.v.every( ( p, i ) => p.every( ( x, k ) => Math.abs( x - asset.mesh.v[i][k] ) < 1e-5 ) ) && last.modifiers.length === 1, "the asset opened once more: as it was saved over" );
    io.stop();
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
