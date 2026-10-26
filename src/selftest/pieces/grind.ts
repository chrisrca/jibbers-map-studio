import { LAYOUTS } from "../../terrain/generate";
import type { V3 } from "../../core/coords";
import { arr3 } from "../../core/types";
import { deltaBetween, transformCustom } from "../../core/transform";
import { feature, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { joinPath } from "../../core/ipc";
import { loadLibrary, placeEntry } from "../../pieces/library";
import { newProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/grind ): the grind line on jibs set up right and wrong — tube_long upright and
 * upside down, c_tube_narrow along its X ( 2, the library's setting ), across ( 0 ) and per body ( 4 ) — logged, plus a SHOT.
**/
export async function grindSelftest( dir: string ) {
  try {
    const proj = joinPath( dir, `grind-${Date.now()}.jbrproj` );
    await newProject( proj, "Grind Test", { layout: LAYOUTS[0], base: "slope", slopeDeg: 6, heightRange: 1200, seed: 5 } );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await loadLibrary();
    const st = useEditor.getState;
    const g  = ( x: number, z: number ) => terrain.heightAt( x, z );
    await placeEntry( feature( "tube_long"     ), [-4.5, g( -4.5, 0 ) + 0.5, 0], [0, 0, 0] );
    await placeEntry( feature( "c_tube_narrow" ), [1,    g( 1,    0 ) + 0.3, 0], [0, 0, 0] );
    // ( placed pieces get grind rails now: this is about the guide on pieces without one )
    const { withoutRail } = await import( "../../pieces/rail" );
    useEditor.setState( { customObjects: st().customObjects.map( ( o ) => withoutRail( o ) ) } );
    const [tube, ctube] = st().customObjects;
    log( `library settings: tube_long ${tube.intended_up_method}, c_tube_narrow ${ctube.intended_up_method}` );
    const variant = ( o: typeof tube, uid: string, dx: number, rotZ: number, method: number ) => {
      const cur = { pos: arr3( o.position ), rot: arr3( o.rotation ), scl: arr3( o.scale ) };
      const to  = { ...cur, pos: [cur.pos[0] + dx, cur.pos[1], cur.pos[2]] as V3, rot: [cur.rot[0], cur.rot[1], rotZ] as V3 };
      return { ...transformCustom( o, deltaBetween( cur, to ) ), uid, intended_up_method: method };
    };
    st().addCustom( variant( tube,  "tubeFlipped",  2.5, 180, 0 ) );
    st().addCustom( variant( ctube, "ctubeAcross",  3.5, 0,   0 ) );
    st().addCustom( variant( ctube, "ctubePerBody", 7,   0,   4 ) );
    st().setSelection( st().customObjects.map( ( o ) => ( { kind: "custom" as const, uid: o.uid } ) ) );
    await waitFor( () => st().customObjects.every( ( o ) => eng.customR.guides.of( o.uid ) ), "grind guides", 30000 );
    for ( const o of st().customObjects ) {
      const gd = eng.customR.guides.of( o.uid )!;
      log( `${o.parts[0].mesh.split( "/" )[1]} ${o.uid.length < 16 ? o.uid : ""} on ${o.intended_up_method}: ${gd.ok ? "ok" : gd.problem}${gd.suggest !== null ? `, suggests ${gd.suggest}` : ""}` );
    }
    // every jib's line, nothing selected ( no gizmo in the way )
    st().setSelection( [] );
    eng.customR.guides.setAll( true );
    eng.nav.lookAtUnity( [1.8, g( 1.8, -5.5 ) + 2.6, -5.5], [1.8, g( 1.8, 0 ) + 0.2, 0] );
    await sleep( 1500 );
    log( "SHOT grind" );
    await sleep( 4500 );
    // one picked: Properties says what's wrong and offers the fix
    eng.customR.guides.setAll( false );
    st().setSelection( [{ kind: "custom", uid: "ctubeAcross" }] );
    await sleep( 1500 );
    log( "SHOT grindprops" );
    await sleep( 4500 );
    log( "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err}` );
  }
}
