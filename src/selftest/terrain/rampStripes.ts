import { joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";
import type { CurveShape } from "../../terrain/shapes/shapes";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, realInput, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/rampstripes ): a ramp's stripes as a person gives it them, on a new map. The Ramp
 * tool picked; a ramp dragged out; the Kicker stripes picked in its panel ( painted along its edges and across its
 * end ); one stripe's colour changed; a stripe added and taken off; undone; the ramp's end dragged ( the stripes go
 * with it ); its start arm dragged sideways ( bent, the ground and stripes round the bend ); saved and opened again;
 * deleted ( the stripes gone with it ).
**/
export async function rampStripesSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const { newEmptyProject } = await import( "../../map/project/sessions" );
    const proj                = joinPath( dir, `ramp-${Date.now()}.jbrproj` );
    await newEmptyProject( proj, "Untitled" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the ground", 60000 );
    // ( the new map framed once it's in: looked about only after )
    await waitFor( () => ( eng.veil.loading ? null : true ), "the map", 120000 );
    await sleep( 1500 );
    const st     = () => useEditor.getState();
    const g      = ( x: number, z: number ) => terrain.heightAt( x, z );
    const ramps  = () => st().shapes.filter( ( s ): s is CurveShape => s.kind === "curve" );
    const { whenShapesSettled } = await import( "../../terrain/shapes/shapes" );
    const settled = () => new Promise<void>( ( r ) => whenShapesSettled( r ) );
    const g0 = g( 0, 50 );
    eng.nav.lookAtUnity( [-45, g0 + 40, 50], [0, g0, 50] );
    await sleep( 1500 );
    const io     = realInput( eng, () => "ramp" );
    const scr    = ( x: number, z: number ) => io.scr( [x, g( x, z ), z] );
    const button = ( title: string ) => [...document.querySelectorAll<HTMLButtonElement>( "button" )].find( ( b ) => b.title === title );
    const text   = ( t: string ) => [...document.querySelectorAll<HTMLButtonElement>( "button" )].filter( ( b ) => b.textContent?.trim() === t );
    const { ensureLayer, layerOf } = await import( "../../paint/ground" );
    // ( the chunks' snow masks loaded, as the view loads them when it shows them )
    const loadMasks = () => Promise.all( terrain.chunks.map( ( c ) => ensureLayer( c ) ) );
    const { MARKING_VALUES } = await import( "../../terrain/shapes/shapes/skiline" );
    // the snow mask where a ramp's stripe would be: across ( 0 left edge … 1 right ), along ( 0 start … 1 end )
    const { rampAt, rampArms, rampPath } = await import( "../../terrain/shapes/shapes/rampPath" );
    const mask = ( s: CurveShape, across: number, along: number ) => {
      const p  = rampPath( s )!, at = rampAt( p, along * p.len ), o = ( across - 0.5 ) * s.width;
      const x  = at.x + at.rx * o, z = at.z + at.rz * o;
      const c  = terrain.chunks[terrain.chunkAt( x, z )], L = layerOf( c.key );
      if ( !L ) return { cover: -1, hue: -1 };
      const px = c.size[0] / L.m, k = Math.floor( ( z - c.position[2] ) / px ) * L.m + Math.floor( ( x - c.position[0] ) / px );
      return { cover: L.rgba[k * 4 + 2], hue: L.rgba[k * 4 + 1] };
    };
    const hue = ( colour: number ) => Math.round( MARKING_VALUES[colour] * 255 );

    // ---- the Ramp tool; a ramp dragged out
    st().setTool( "sculpt" );
    await sleep( 300 );
    document.querySelector<HTMLButtonElement>( '.tool-column button[title="Ramp (H)"]' )?.click();
    await sleep( 300 );
    check( st().tool === "shape" && st().shapeKind === "curve", "the Ramp tool, from Terrain Mode's toolbar" );
    await io.drag( ...scr( 0, 35 ), ...scr( 0, 60 ), 500 );
    await settled();
    await sleep( 600 );
    let s = ramps()[0];
    check( ramps().length === 1 && !!s && !s.stripes?.length, `a ramp dragged out: ${ramps().length} ramp, ${s ? Math.hypot( s.end[0] - s.start[0], s.end[1] - s.start[1] ).toFixed( 1 ) : "?"} m, ${s?.width} m wide, no stripes` );
    if ( !s ) throw new Error( "no ramp" );
    check( text( "Add Stripe" ).length === 1 && !!button( "The ski line Kicker preset's stripes" ), "its panel has Stripes: the presets and Add Stripe" );
    const before = mask( s, 0.06, 0.5 );

    // ---- the Kicker stripes: along both edges, across its end
    button( "The ski line Kicker preset's stripes" )?.click();
    await settled();
    await sleep( 500 );
    s = ramps()[0];
    const left = mask( s, 0.06, 0.5 ), right = mask( s, 0.94, 0.5 ), mid = mask( s, 0.5, 0.5 ), lip = mask( s, 0.5, 0.995 );
    check( s.stripes?.length === 3, `Kicker: ${s.stripes?.length} stripes` );
    check( before.cover < 20 && left.cover > 100 && left.hue === hue( 11 ) && right.cover > 100, `painted along its edges: left ${left.cover} ( hue ${left.hue} ), right ${right.cover}, before ${before.cover}` );
    check( mid.cover < 20, `not down its middle: ${mid.cover}` );
    check( lip.cover > 100 && lip.hue === hue( 0 ), `across its end: ${lip.cover} ( hue ${lip.hue}, red ${hue( 0 )} )` );
    // ( seen from behind its start, the panel at its stripes )
    const look = ( r: CurveShape ) => eng.nav.lookAtUnity( [r.start[0] - 10, g( r.start[0], r.start[1] ) + 14, r.start[1] - 16], [r.end[0], g( r.end[0], r.end[1] ), r.end[1]] );
    look( s );
    [...document.querySelectorAll<HTMLElement>( ".props *" )].find( ( x ) => x.children.length === 0 && x.textContent?.trim() === "Stripes" )?.scrollIntoView( { block: "start" } );
    await sleep( 800 );
    log( "SNAP kicker" );
    await sleep( 1500 );

    // ---- a stripe's colour changed in the panel ( the first: along its left edge )
    const { MARKING_COLOURS } = await import( "../../paint/settings" );
    const green               = MARKING_COLOURS.findIndex( ( c ) => /green/i.test( c.name ) );
    const { liveShape, commitShape } = await import( "../../terrain/shapes/edits" );
    liveShape( { ...s, stripes: s.stripes!.map( ( x, k ) => ( k === 0 ? { ...x, colour: green } : x ) ) } );
    commitShape();
    await settled();
    await sleep( 300 );
    s = ramps()[0];
    check( mask( s, 0.06, 0.5 ).hue === hue( green ) && mask( s, 0.94, 0.5 ).hue === hue( 11 ), `the left one made ${MARKING_COLOURS[green]?.name}: hue ${mask( s, 0.06, 0.5 ).hue}, the right one still ${mask( s, 0.94, 0.5 ).hue}` );

    // ---- Add Stripe ( along the middle ), then Remove it
    text( "Add Stripe" )[0]?.click();
    await settled();
    await sleep( 300 );
    s = ramps()[0];
    check( s.stripes?.length === 4 && mask( s, 0.5, 0.5 ).cover > 100, `Add Stripe: ${s.stripes?.length} stripes, the middle now ${mask( s, 0.5, 0.5 ).cover}` );
    text( "Remove" ).at( -1 )?.click();
    await settled();
    await sleep( 300 );
    s = ramps()[0];
    check( s.stripes?.length === 3 && mask( s, 0.5, 0.5 ).cover < 20, `Remove: ${s.stripes?.length} stripes, the middle ${mask( s, 0.5, 0.5 ).cover}` );

    // ---- undone: the colour back
    await io.key( "z", { ctrl: true } );
    await io.key( "z", { ctrl: true } );
    await io.key( "z", { ctrl: true } );
    await settled();
    await sleep( 400 );
    s = ramps()[0];
    check( mask( s, 0.06, 0.5 ).hue === hue( 11 ), `undone three times ( remove, add, colour ): the left one blue again, hue ${mask( s, 0.06, 0.5 ).hue}` );

    // ---- its end handle dragged 12 m on: the lip's stripe with it, none left where it was
    const was = { ...s };
    check( st().selection.some( ( x ) => x.kind === "shape" && x.uid === s.uid ), "the ramp still picked, its handles out" );
    await io.drag( ...scr( s.end[0], s.end[1] ), ...scr( s.end[0], s.end[1] + 12 ), 500 );
    await settled();
    await sleep( 500 );
    s = ramps()[0];
    const moved = Math.hypot( s.end[0] - was.end[0], s.end[1] - was.end[1] );
    check( moved > 8 && mask( s, 0.5, 0.995 ).cover > 100 && mask( was, 0.5, 0.995 ).cover < 20, `its end dragged ${moved.toFixed( 1 )} m: the lip's stripe there ( ${mask( s, 0.5, 0.995 ).cover} ), gone from where it was ( ${mask( was, 0.5, 0.995 ).cover} )` );
    look( s );
    await sleep( 800 );
    log( "SNAP moved" );
    await sleep( 1500 );

    // ---- its start arm dragged 12 m sideways: bent, the ground and stripes round the bend, none where it ran
    const straight = { ...s };
    const tip      = [s.start[0] + rampArms( s )[0][0], s.start[1] + rampArms( s )[0][1]] as const;
    // ( pressed where its handle is drawn, as a person would )
    const { toUnity } = await import( "../../core/coords" );
    const handle = ( eng.shapeTool as unknown as { handles: { children: { userData: { handle: unknown }; position: import( "three" ).Vector3 }[] } } ).handles.children.find( ( h ) => h.userData.handle === "startArm" );
    const grab   = handle ? toUnity( handle.position ) : [tip[0], g( tip[0], tip[1] ), tip[1]];
    check( !!handle, "the picked ramp shows its start arm's handle" );
    {
      const hs  = ( eng.shapeTool as unknown as { handles: { children: { userData: { handle: unknown }; position: import( "three" ).Vector3 }[] } } ).handles.children;
      const y   = ( h: string ) => hs.find( ( m ) => m.userData.handle === h )?.position.y ?? NaN;
      check( Math.abs( y( "startArm" ) - y( "start" ) ) < 1e-6 && Math.abs( y( "endArm" ) - y( "end" ) ) < 1e-6, `its arms' handles level with their ends': start ${y( "start" ).toFixed( 2 )} / ${y( "startArm" ).toFixed( 2 )}, end ${y( "end" ).toFixed( 2 )} / ${y( "endArm" ).toFixed( 2 )}` );
    }
    // ( across the level it's at )
    await io.drag( ...io.scr( [grab[0], grab[1], grab[2]] ), ...io.scr( [grab[0] + 12, grab[1], grab[2]] ), 500 );
    await settled();
    await sleep( 500 );
    s = ramps()[0];
    const bentMid = rampAt( rampPath( s )!, rampPath( s )!.len * 0.5 ), oldMid = rampAt( rampPath( straight )!, rampPath( straight )!.len * 0.5 );
    const off     = Math.hypot( bentMid.x - oldMid.x, bentMid.z - oldMid.z );
    check( !!s.startArm && off > 4, `its start arm dragged: bent, its middle ${off.toFixed( 1 )} m over ( ⅜ of the 12 m )` );
    check( g( bentMid.x, bentMid.z ) - g0 > 0.3 && Math.abs( g( oldMid.x, oldMid.z ) - g0 ) < 0.05, `the ground up along the bend ( ${( g( bentMid.x, bentMid.z ) - g0 ).toFixed( 2 )} m at its middle ), flat where it ran ( ${( g( oldMid.x, oldMid.z ) - g0 ).toFixed( 3 )} m )` );
    check( mask( s, 0.06, 0.5 ).cover > 100 && mask( s, 0.94, 0.5 ).cover > 100 && mask( straight, 0.06, 0.5 ).cover < 20, `its stripes round the bend ( ${mask( s, 0.06, 0.5 ).cover}, ${mask( s, 0.94, 0.5 ).cover} ), gone from where it ran ( ${mask( straight, 0.06, 0.5 ).cover} )` );
    look( s );
    await sleep( 800 );
    log( "SNAP bent" );
    await sleep( 1500 );

    // ---- saved, opened again
    const { saveProject, openProject } = await import( "../../map/project" );
    await saveProject();
    await openProject( proj );
    await waitFor( () => ( terrain.chunks.length && ramps().length ? true : null ), "the map again", 60000 );
    await sleep( 2500 );
    await loadMasks();
    s = ramps()[0];
    check( !!s.startArm && s.stripes?.length === 3 && mask( s, 0.06, 0.5 ).cover > 100 && mask( s, 0.5, 0.995 ).cover > 100, `saved and opened again: bent ${!!s.startArm}, ${s.stripes?.length} stripes, painted ( ${mask( s, 0.06, 0.5 ).cover}, ${mask( s, 0.5, 0.995 ).cover} )` );

    // ---- deleted: its stripes gone with it
    const { deleteShape } = await import( "../../terrain/shapes/edits" );
    const gone            = { ...s };
    deleteShape( s.uid );
    await settled();
    await sleep( 500 );
    check( !ramps().length && mask( gone, 0.06, 0.5 ).cover >= 0 && mask( gone, 0.06, 0.5 ).cover < 20 && mask( gone, 0.5, 0.995 ).cover < 20, `deleted: its stripes gone ( ${mask( gone, 0.06, 0.5 ).cover}, ${mask( gone, 0.5, 0.995 ).cover} )` );
    log( fails.length ? `SELFTEST FAILED: ${fails.length} checks — ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
