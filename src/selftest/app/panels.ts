import { commitShape, liveShape } from "../../terrain/shapes/edits";
import { feature, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { ipc } from "../../core/ipc";
import { openProject } from "../../map/project";
import { placeEntry } from "../../pieces/library";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/panels ): a project in the folder ( a copy ) opened, and the layout measured where
 * it went wrong before ( no pictures: a window capture copies whatever is on screen ): the tool column's gaps, rows'
 * labels against their controls, buttons whose text overflows, the Properties icon over its tabs; a kicker set by
 * lip angle, and a box pressed into the terrain.
**/
export async function panelsSelftest( dir: string ) {
  const mid = ( e: Element | null | undefined, axis: "x" | "y" ) => {
    const r = e?.getBoundingClientRect();
    return r ? ( axis === "x" ? r.left + r.width / 2 : r.top + r.height / 2 ) : NaN;
  };
  const hold = async ( name: string ) => {
    await sleep( 900 );
    const tools = [...document.querySelectorAll( ".tool-column .tool" )].map( ( e ) => e.getBoundingClientRect() );
    const gaps  = tools.slice( 1 ).map( ( r, i ) => r.top - tools[i].bottom );
    // each label in a properties grid against the control beside it ( a checkbox, or the field )
    const rows  = [...document.querySelectorAll( ".props > label" )].flatMap( ( l ) => {
      const next = l.nextElementSibling;
      const ctl  = next?.querySelector( "input[type=checkbox], .numfield, .seg, input, button" ) ?? next;
      return l.textContent?.trim() && ctl ? [Math.abs( mid( l, "y" ) - mid( ctl, "y" ) )] : [];
    } );
    const over = [...document.querySelectorAll( ".props button" )].filter( ( b ) => b.scrollWidth > b.clientWidth + 1 ).map( ( b ) => b.textContent?.trim() );
    const icon = mid( document.querySelector( ".props-hdr .editor-icon" ), "x" ) - mid( document.querySelector( ".props-tabs button" ), "x" );
    log( `${name}: ${tools.length} tools, gaps ${Math.min( ...gaps ).toFixed( 0 )}..${Math.max( ...gaps ).toFixed( 0 )} px; labels off their control by up to ${Math.max( 0, ...rows ).toFixed( 1 )} px over ${rows.length} rows; text overflowing: ${over.join( ", " ) || "none"}; Properties icon ${icon.toFixed( 1 )} px from its tabs` );
  };
  try {
    const { groundWithout, lipAngleFor, kickerHeight, newStamp } = await import( "../../terrain/shapes/shapes" );
    const proj = ( await ipc.findProjects( dir ) )[0]?.dir;
    if ( !proj ) throw new Error( `no project in ${dir}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await sleep( 1000 );
    await waitFor( () => !eng.veil.loading, "the veil", 600000 );
    const st = () => useEditor.getState();
    const g  = ( x: number, z: number ) => terrain.heightAt( x, z );
    st().setTool( "sculpt" );
    st().setSculpt( { brush: "crease" } );
    await hold( "sculpt" );
    // a kicker set by its lip angle
    st().setTool( "select" );
    const k = st().shapes.find( ( s ) => s.kind === "curve" );
    if ( k?.kind === "curve" ) {
      const under = groundWithout( k.uid );
      liveShape( { ...k, lipAngle: lipAngleFor( k, kickerHeight( k, under ), under ) }, "Kicker" );
      commitShape();
      st().setSelection( [{ kind: "shape", uid: k.uid }] );
      eng.nav.lookAtUnity( [k.start[0] - 15, g( k.start[0], k.start[1] ) + 10, k.start[1] - 15], [k.end[0], g( k.end[0], k.end[1] ), k.end[1]] );
      await hold( "kicker" );
    }
    // a box placed, its material, then pressed into the ground
    const at: [number, number] = k?.kind === "curve" ? [k.start[0] + 30, k.start[1] + 10] : [0, 0];
    await placeEntry( feature( "flat_box" ), [at[0], g( at[0], at[1] ) + 0.6, at[1]], [0, 30, 0] );
    const box = st().customObjects.at( -1 )!;
    st().setSelection( [{ kind: "custom", uid: box.uid }] );
    await waitFor( () => eng.customR.objectGroup( box.uid )?.children.length || null, "the box", 30000 );
    eng.nav.lookAtUnity( [at[0] - 9, g( at[0], at[1] ) + 6, at[1] - 9], [at[0], g( at[0], at[1] ), at[1]] );
    await sleep( 500 );
    [...document.querySelectorAll( ".props .section" )].find( ( e ) => e.textContent?.trim() === "Material" )?.scrollIntoView();
    await hold( "material" );
    const imp = eng.imprintGrid( box.uid );
    if ( !imp ) throw new Error( "no imprint" );
    const shape = newStamp( imp.center, imp.grid, false, "Imprint of the box" );
    liveShape( shape, "Imprint object" );
    commitShape();
    log( `imprint: ${imp.grid.w}x${imp.grid.h} at ${imp.grid.spacing.toFixed( 3 )} m, ${imp.grid.heights.filter( ( h ) => h !== null ).length} samples, blend ${shape.blend} m` );
    useEditor.setState( { customObjects: st().customObjects.filter( ( o ) => o.uid !== box.uid ), selection: [] } );
    await hold( "imprint" );
    // the Map tab
    document.querySelectorAll<HTMLButtonElement>( ".props-tabs button" )[2]?.click();
    await hold( "maptab" );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
