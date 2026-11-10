import { toThree, type V3 } from "../../core/coords";
import { joinPath } from "../../core/ipc";
import type { Rail } from "../../core/types";
import { isBrushCollider } from "../../pieces/brushColliders";
import { newEmptyProject } from "../../map/project/sessions";
import { history } from "../../map/history";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/colliderswitch ): a colliders-only jib's Surface changed and changed back, as a
 * person does on a new map: the Colliders tool, a click on the ground ( a jib ); then its panel's Surface buttons —
 * Generic ( its rail laid as colliders along it ), Jib ( the same rail back ), Snow, Jib again; undone and redone;
 * saved and opened again.
**/
export async function colliderSwitchSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const proj = joinPath( dir, `switch-${Date.now()}.jbrproj` );
    await newEmptyProject( proj, "Collider switch" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the ground", 60000 );
    await waitFor( () => !eng.veil.loading, "the veil", 120000 );
    await sleep( 1000 );
    const st  = () => useEditor.getState();
    const g   = ( x: number, z: number ) => terrain.heightAt( x, z );
    eng.nav.lookAtUnity( [0, g( 0, 0 ) + 12, -16], [0, g( 0, 0 ), 0] );
    await sleep( 800 );
    const io  = realInput( eng, () => "colliders" );
    const scr = ( p: V3 ) => eng.screenOf( toThree( p ) ).slice( 0, 2 ) as [number, number];
    document.querySelector<HTMLButtonElement>( ".tool-column button[title='Colliders']" )?.click();
    await sleep( 300 );
    const n0 = st().customObjects.length;
    await io.click( ...scr( [0, g( 0, 0 ), 0] ) );
    await sleep( 600 );
    const uid  = st().customObjects.slice( n0 )[0]?.uid;
    const now  = () => st().customObjects.find( ( o ) => o.uid === uid )!;
    const made = now();
    check( !!made?.rail && made.surface_type === "Jib", `a click on the ground: a jib, its rail of ${made?.rail?.points.length} points` );
    if ( !made?.rail ) throw new Error( "no jib made" );
    st().setSelection( [{ kind: "custom", uid }] );
    await sleep( 500 );
    const surface = ( id: string ) => [...document.querySelectorAll<HTMLButtonElement>( ".seg button" )].find( ( b ) => b.textContent?.trim() === id && b.closest( ".bpanel" )?.querySelector( "header .ttl" )?.textContent === "Riding" );
    const sameRail = ( a: Rail | undefined, b: Rail | undefined ) => !!a && !!b && a.points.length === b.points.length && a.points.every( ( p, i ) => p.every( ( v, k ) => Math.abs( v - b.points[i][k] ) < 1e-3 ) ) && Math.abs( a.radius - b.radius ) < 1e-4;
    const where = () => {
      const o = now();
      return `${o.surface_type}, rail ${o.rail ? `${o.rail.points.length} points` : "none"}, ${o.colliders.length} colliders ( ${o.colliders.filter( isBrushCollider ).length} laid ), surfaces ${[...new Set( o.colliders.map( ( c ) => c.surface_type ) )].join( "/" )}`;
    };
    check( !!surface( "Generic" ), "its panel's Surface buttons, under Riding" );
    // ---- Generic: its rail laid as colliders along it
    surface( "Generic" )?.click();
    await sleep( 500 );
    let o = now();
    check( o.surface_type === "Generic" && !o.rail && o.colliders.filter( isBrushCollider ).length > 0 && o.colliders.every( ( c ) => c.surface_type === "Generic" ), `Generic: ${where()}` );
    // ---- Jib: the same rail back
    surface( "Jib" )?.click();
    await sleep( 500 );
    o = now();
    check( o.surface_type === "Jib" && sameRail( o.rail, made.rail ) && o.colliders.length > 0 && !o.colliders.some( isBrushCollider ), `Jib again: ${where()}; the same rail ${sameRail( o.rail, made.rail )}` );
    // ---- Snow, then Jib
    surface( "Snow" )?.click();
    await sleep( 500 );
    check( now().surface_type === "Snow" && now().colliders.length > 0 && !now().rail, `Snow: ${where()}` );
    surface( "Jib" )?.click();
    await sleep( 500 );
    check( now().surface_type === "Jib" && sameRail( now().rail, made.rail ), `Jib again: ${where()}` );
    // ---- undone ( back to Snow ), redone
    history.undo();
    await sleep( 400 );
    check( now().surface_type === "Snow" && !now().rail, `undone: ${where()}` );
    history.redo();
    await sleep( 400 );
    check( now().surface_type === "Jib" && sameRail( now().rail, made.rail ), `redone: ${where()}` );
    // ---- left Generic, saved and opened again
    surface( "Generic" )?.click();
    await sleep( 400 );
    const { saveProject, openProject } = await import( "../../map/project" );
    await saveProject();
    await openProject( proj );
    await waitFor( () => ( st().customObjects.some( ( x ) => x.uid === uid ) ? true : null ), "the map again", 60000 );
    await sleep( 1500 );
    o = now();
    check( o.surface_type === "Generic" && o.colliders.filter( isBrushCollider ).length > 0, `saved and opened again: ${where()}` );
    st().setSelection( [{ kind: "custom", uid }] );
    await sleep( 500 );
    surface( "Jib" )?.click();
    await sleep( 500 );
    check( now().surface_type === "Jib" && sameRail( now().rail, made.rail ), `and made a jib again after: ${where()}` );
    log( fails.length ? `SELFTEST FAILED: ${fails.length} checks — ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
