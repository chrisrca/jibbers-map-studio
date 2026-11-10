import { getEngine } from "../../ui/Viewport";
import { joinPath } from "../../core/ipc";
import { history } from "../../map/history";
import { log, realInput, sleep, waitFor } from "../harness";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/formation ): Map-Tools' Formation Builder as brought over, driven as a person
 * does on a new 1 km map: an outline clicked on the ground and closed; the Mountain preset pressed in the panel ( its
 * erosion and snow worked out on the graphics card once it's in, rock painted into the snow mask ); the same worked
 * out here and on the card side by side ( Rocks, no droplets: the same to a few millimetres ); a change undone while
 * the card's still at it; its settings saved as a preset and loaded back; Live Erosion off and Simulate. Shots logged
 * "SNAP <name>" for a capture from outside.
**/
export async function formationPortSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const { newProject }                                   = await import( "../../map/project" );
    const { LAYOUTS }                                      = await import( "../../terrain/generate" );
    const { shapesBusy, whenShapesSettled, applyPreset }   = await import( "../../terrain/shapes/shapes" );
    const { simInput, simulateCpu, formationFrame }        = await import( "../../terrain/shapes/shapes/formation" );
    const { simulateGpu }                                  = await import( "../../terrain/shapes/shapes/formationGpu" );
    const { computeDevice }                                = await import( "../../core/gpu" );
    const { groundWithout }                                = await import( "../../terrain/shapes/shapes" );
    const { layerOf }                                      = await import( "../../paint/ground" );
    const { savedPresets, deletePreset }                   = await import( "../../terrain/shapes/shapes/presets" );
    const { setLiveErosion }                               = await import( "../../terrain/shapes/edits" );
    const proj                                             = joinPath( dir, `formation-${Date.now()}.jbrproj` );
    await newProject( proj, "Formation", { layout: LAYOUTS[0], base: "slope", slopeDeg: 6, heightRange: 1200, seed: 3 } );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    await sleep( 2000 );
    useEditor.setState( { splash: false } );
    setLiveErosion( true );
    const st      = () => useEditor.getState();
    const io      = realInput( eng, () => "formation" );
    const button  = ( text: string ) => [...document.querySelectorAll<HTMLButtonElement>( ".props button" )].find( ( b ) => b.textContent?.trim() === text );
    const settled = () => new Promise<void>( ( r ) => whenShapesSettled( r ) );
    const look    = async ( x: number, z: number, far: number ) => {
      const g = terrain.heightAt( x, z );
      eng.nav.lookAtUnity( [x - far * 0.6, g + far * 0.8, z - far * 0.6], [x, g, z] );
      await sleep( 250 );
    };
    check( !!computeDevice(), "the view's graphics card is there to work formations out on" );

    // ---- an outline clicked on the ground ( 70 m round ), closed with Enter
    const c0 = terrain.chunks[0], fc = [c0.position[0] + c0.size[0] / 2, c0.position[2] + c0.size[2] / 2];
    const before = terrain.heightAt( fc[0], fc[1] );
    useEditor.setState( { tool: "shape", shapeKind: "formation" } );
    await sleep( 300 );
    await look( fc[0], fc[1], 160 );
    for ( let k = 0; k < 7; k++ ) {
      const a = ( k / 7 ) * Math.PI * 2, x = fc[0] + Math.cos( a ) * 70, z = fc[1] + Math.sin( a ) * 60;
      const [sx, sy] = io.scr( [x, terrain.heightAt( x, z ), z] );
      await io.click( sx, sy, 200 );
      await sleep( 300 );
    }
    await io.key( "Enter" );
    await settled();
    await sleep( 800 );
    const form = () => st().shapes.find( ( s ) => s.kind === "formation" );
    const f1   = form();
    check( !!f1 && f1.kind === "formation" && f1.points.length === 7 && !!f1.fitted, `formation drawn: ${f1 && f1.kind === "formation" ? f1.points.length : 0} points, fitted to its outline ${f1?.kind === "formation" && f1.fitted}` );
    check( terrain.heightAt( fc[0], fc[1] ) - before > 10, `the ground raised ${( terrain.heightAt( fc[0], fc[1] ) - before ).toFixed( 1 )} m in its middle` );
    st().setSelection( [{ kind: "shape", uid: f1!.uid }] );
    await sleep( 500 );

    // ---- Mountain, pressed in the panel: erosion and snow on the card once it's in
    const mountain = await waitFor( () => button( "Mountain" ) ?? null, "the panel's presets", 10000 );
    const t0       = performance.now();
    mountain.click();
    await sleep( 50 );
    const busy = shapesBusy();
    await settled();
    const took = performance.now() - t0;
    const fm   = form();
    const top  = Math.max( ...Array.from( { length: 41 }, ( _, k ) => terrain.heightAt( fc[0] + ( k - 20 ) * 3, fc[1] ) ) );
    check( fm?.kind === "formation" && fm.name === "Mountain" && fm.hydraulic.on && fm.snow.on && history.top?.label === "Mountain preset", `Mountain preset: ${fm?.name}, droplets ${fm?.kind === "formation" && fm.hydraulic.on}, snow ${fm?.kind === "formation" && fm.snow.on}; the step "${history.top?.label}"` );
    check( busy && took < 20000, `worked out in full on the card in ${( took / 1000 ).toFixed( 2 )} s ( still under way just after: ${busy} )` );
    check( top - before > 30, `a mountain: ${( top - before ).toFixed( 1 )} m over the ground` );
    const L    = layerOf( c0.key );
    let rocky  = 0;
    if ( L ) for ( let k = 0; k < L.m * L.m; k++ ) if ( L.rgba[k * 4] < 128 ) rocky++;
    check( rocky > 1000, `rock painted into the snow mask where the snow can't hold: ${rocky} pixels` );
    await look( fc[0], fc[1], 220 );
    log( "SNAP mountain" );
    await sleep( 2500 );

    // ---- the card and here side by side: Rocks ( thermal, snow; no droplets, so the same bar rounding )
    if ( fm?.kind === "formation" ) {
      const rocks  = applyPreset( fm, "Rocks" );
      const ground = groundWithout( fm.uid );
      const drive  = <T, >( g: Generator<void, T, void> ) => { for ( ;; ) { const r = g.next(); if ( r.done ) return r.value; } };
      const I      = drive( simInput( rocks, ground, true, formationFrame( rocks ) ) );
      const g0     = performance.now();
      const gpu    = await simulateGpu( computeDevice()!, I );
      const gt     = performance.now() - g0, c1 = performance.now();
      const cpu    = drive( simulateCpu( I ) );
      const ct     = performance.now() - c1;
      let dh       = 0, dr = 0, dk = 0;
      for ( let q = 0; q < gpu.h.length; q++ ) {
        dh = Math.max( dh, Math.abs( gpu.h[q] - cpu.h[q] ) * I.sizeY );
        dr = Math.max( dr, Math.abs( gpu.rock[q] - cpu.rock[q] ) );
        dk = Math.max( dk, Math.abs( gpu.k[q] - cpu.k[q] ) );
      }
      check( dh < 0.05 && dk < 1e-4 && dr < 0.05, `Rocks on the card as here: ${I.w}×${I.h} samples, heights within ${( dh * 1000 ).toFixed( 1 )} mm, blend ${dk.toExponential( 1 )}, rock ${dr.toFixed( 3 )} ( card ${gt.toFixed( 0 )} ms, here ${ct.toFixed( 0 )} ms )` );
      // ( and Mountain, droplets and all: the card's droplets run together, so only alike )
      const M  = drive( simInput( fm, ground, true, formationFrame( fm ) ) );
      const m0 = performance.now();
      const mg = await simulateGpu( computeDevice()!, M );
      log( `     Mountain on the card: ${M.w}×${M.h} samples, ${M.hydraulic?.droplets} droplets of ${M.hydraulic?.lifetime} steps, ${( performance.now() - m0 ).toFixed( 0 )} ms` );
      let finite = true;
      for ( const v of mg.h ) if ( !Number.isFinite( v ) ) finite = false;
      check( finite, "Mountain on the card: every height a number" );
      // ( the droplets' wear, on the card and here: how far they moved the ground, all told )
      const dry  = { ...M, hydraulic: null };
      const mg0  = await simulateGpu( computeDevice()!, dry );
      const mc   = drive( simulateCpu( M ) ), mc0 = drive( simulateCpu( dry ) );
      let wg     = 0, wc = 0;
      for ( let q = 0; q < mg.h.length; q++ ) {
        wg += Math.abs( mg.h[q] - mg0.h[q] ) * mg.k[q];
        wc += Math.abs( mc.h[q] - mc0.h[q] ) * mc.k[q];
      }
      const per = ( v: number ) => ( ( v * M.sizeY ) / Math.max( 1, mg.k.reduce( ( a, b ) => a + b, 0 ) ) ) * 1000;
      check( wg > 0 && wc > 0 && wg / wc > 0.5 && wg / wc < 2, `the droplets' wear on the card as here: ${per( wg ).toFixed( 1 )} mm a sample on average, here ${per( wc ).toFixed( 1 )} mm` );
    }

    // ---- a change undone while the card's at it: the undo waits, then takes it back
    const f2    = form()!;
    const hBack = terrain.heightAt( fc[0] + 20, fc[1] + 10 );
    if ( f2.kind === "formation" ) {
      const { liveShape, commitShape } = await import( "../../terrain/shapes/edits" );
      liveShape( { ...f2, height: f2.height + 25 } );
      commitShape();
      await sleep( 30 );
      const waited = shapesBusy();
      history.undo();
      await settled();
      await sleep( 300 );
      const back = form();
      check( back?.kind === "formation" && back.height === f2.height && Math.abs( terrain.heightAt( fc[0] + 20, fc[1] + 10 ) - hBack ) < 0.01, `a change undone while the card was at it ( busy ${waited} ): height ${back?.kind === "formation" ? back.height.toFixed( 1 ) : "?"}, the ground back within ${Math.abs( terrain.heightAt( fc[0] + 20, fc[1] + 10 ) - hBack ).toFixed( 3 )} m` );
    }

    // ---- its settings saved as a preset ( the panel's Save ), Hill pressed, the saved one loaded back
    deletePreset( "Mountain" );
    button( "Save" )?.click();
    await sleep( 200 );
    check( savedPresets().some( ( p ) => p.name === "Mountain" && p.settings.hydraulic.on ), `saved as a preset: ${savedPresets().map( ( p ) => p.name ).join( ", " )}` );
    button( "Hill" )?.click();
    await settled();
    await sleep( 300 );
    check( form()?.name === "Hill", `Hill pressed: ${form()?.name}` );
    const pickBtn = document.querySelector<HTMLButtonElement>( ".props .bdrop" );
    pickBtn?.dispatchEvent( new MouseEvent( "mousedown", { bubbles: true, button: 0 } ) );
    await sleep( 300 );
    const item = [...document.querySelectorAll<HTMLButtonElement>( ".bmenu-item" )].find( ( e ) => e.querySelector( ".lbl" )?.textContent?.trim() === "Mountain" );
    item?.click();
    await sleep( 300 );
    button( "Load" )?.click();
    await settled();
    await sleep( 300 );
    const fl = form();
    check( fl?.kind === "formation" && fl.name === "Mountain" && fl.hydraulic.on, `the saved preset loaded back: ${fl?.name} ( menu item found ${!!item} )` );
    deletePreset( "Mountain" );

    // ---- Live Erosion off: a change worked out quickly, Simulate works it out in full
    setLiveErosion( false );
    if ( fl?.kind === "formation" ) {
      const { liveShape, commitShape, simulateShape } = await import( "../../terrain/shapes/edits" );
      const quick = { ...fl, seed: fl.seed + 1 };
      liveShape( quick );
      commitShape();
      await settled();
      const hq = terrain.heightAt( fc[0] + 15, fc[1] - 12 );
      simulateShape( form()! );
      await settled();
      const hf = terrain.heightAt( fc[0] + 15, fc[1] - 12 );
      check( Math.abs( hf - hq ) > 0.001 && history.top?.label === "Simulate formation", `Live Erosion off: Simulate erodes it ( ${( hf - hq ).toFixed( 3 )} m at a spot ), its own step "${history.top?.label}"` );
    }
    setLiveErosion( true );
    await look( fc[0], fc[1], 220 );
    log( "SNAP mountain-again" );
    await sleep( 2500 );
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
