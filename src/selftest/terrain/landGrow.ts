import { getEngine } from "../../ui/Viewport";
import { joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/landgrow ): ground added from the land round a map, as a person does it in Map
 * Size, and the surroundings built round it. A made-up map: its greyed squares shown round the ground seen from above;
 * two clicked, previewed and added ( an L ), each met by its neighbour without a step; the surroundings switched on
 * from the Map tab; a third added with them there ( faint while it's previewed, built again after ); one taken away.
 * Then a real mountain ( imported small ): a square comes in from real elevation, and its surroundings from the real
 * land. Shots logged "SNAP <name>" for a capture from outside.
**/
export async function landGrowSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const { newEmptyProject } = await import( "../../map/project/sessions" );
    const { openProject }     = await import( "../../map/project" );
    const { isScenery }       = await import( "../../core/types" );
    await newEmptyProject( joinPath( dir, `made-${Date.now()}.jbrproj` ), "Untitled" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await sleep( 2000 );
    const st      = () => useEditor.getState();
    const squares = () => [...document.querySelectorAll<SVGGElement>( ".mapsize-map g.cell.add" )];
    const button  = ( text: string, within = document.body ) => [...within.querySelectorAll<HTMLButtonElement>( "button" )].find( ( b ) => b.textContent?.trim() === text );
    // ( a square clicked, as it's laid out on the little map: the one furthest along `dx, dz` from the middle )
    const click   = async ( dx: number, dz: number ) => {
      const n  = terrain.chunks.length;
      const rs = squares().map( ( r ) => ( { r, x: +r.querySelector( "rect" )!.getAttribute( "x" )!, y: +r.querySelector( "rect" )!.getAttribute( "y" )! } ) );
      const mx = rs.reduce( ( s, q ) => s + q.x, 0 ) / rs.length, my = rs.reduce( ( s, q ) => s + q.y, 0 ) / rs.length;
      // ( furthest that way, the one most in line with it of those )
      const score = ( q: { x: number; y: number } ) => dx * ( q.x - mx ) + dz * ( my - q.y ) - 0.01 * ( dx ? Math.abs( my - q.y ) : Math.abs( q.x - mx ) );
      const pick  = [...rs].sort( ( p, q ) => score( q ) - score( p ) )[0];
      pick?.r.dispatchEvent( new MouseEvent( "click", { bubbles: true } ) );
      // ( previewed in the view, its settings shown, the surroundings faint meanwhile; then Add )
      await waitFor( () => ( eng.growPreview.group.children.length && document.querySelector( ".chunk-add" ) ? true : null ), "the new chunk's preview", 60000 );
      const sc = st().customObjects.find( isScenery ), g = sc && eng.customR.objectGroup( sc.uid );
      let faint = !sc;
      g?.traverse( ( m ) => {
        // ( a little see-through, and left out over the new square )
        const mat = ( m as { material?: { opacity?: number; maskNode?: unknown } | { opacity?: number; maskNode?: unknown }[] } ).material;
        for ( const x of Array.isArray( mat ) ? mat : mat ? [mat] : [] ) if ( ( x.opacity ?? 1 ) < 1 && x.maskNode ) faint = true;
      } );
      if ( sc ) {
        const at = eng.growPreview.group.children[0] as unknown as { geometry: { boundingSphere: { center: { x: number; y: number; z: number } } | null; computeBoundingSphere(): void } };
        at.geometry.computeBoundingSphere();
        const c = at.geometry.boundingSphere!.center;
        eng.nav.lookAtUnity( [c.x - 900, c.y + 700, -c.z - 900], [c.x, c.y, -c.z] );
        log( "SNAP previewing" );
        await sleep( 2500 );
      }
      previewed.push( faint );
      await sleep( 600 );
      button( "Add", document.querySelector( ".chunk-add" ) as HTMLElement )?.click();
      const t0 = performance.now();
      let said = 0;
      await waitFor( () => {
        if ( performance.now() - t0 > said + 10000 ) { said += 10000; log( `  waiting ${( said / 1000 ).toFixed( 0 )} s: ${st().busy} ${JSON.stringify( st().toasts.map( ( t ) => t.text ) )}` ); }
        return terrain.chunks.length > n && !st().busy ? true : null;
      }, "the ground added", 300000 );
      await sleep( 800 );
      previewed.push( eng.growPreview.group.children.length === 0 );
    };
    // ( each add: previewed with the surroundings faint ( or none ), and the preview gone after )
    const previewed: boolean[] = [];
    // the step where two chunks meet: the biggest difference between their own samples along the edge they share
    const step = ( a: string, b: string ) => {
      let A = terrain.chunks[terrain.indexOf( a )], B = terrain.chunks[terrain.indexOf( b )];
      const along = Math.abs( A.position[2] - B.position[2] ) < 0.01 ? "x" : Math.abs( A.position[0] - B.position[0] ) < 0.01 ? "z" : null;
      if ( !along || A.res !== B.res ) return NaN;
      // ( A the west or south one )
      if ( ( along === "x" && A.position[0] > B.position[0] ) || ( along === "z" && A.position[2] > B.position[2] ) ) [A, B] = [B, A];
      const n = A.res;
      let worst = 0;
      for ( let t = 0; t < n; t++ ) {
        const [ka, kb] = along === "x" ? [t * n + n - 1, t * n] : [( n - 1 ) * n + t, t];
        worst = Math.max( worst, Math.abs( A.position[1] + A.heights[ka] - ( B.position[1] + B.heights[kb] ) ) );
      }
      return worst;
    };

    // the surroundings as drawn: how many vertices, and how many of them inside a chunk ( more than a metre in )
    const drawn = () => {
      const sc = st().customObjects.find( isScenery );
      const g  = sc && eng.customR.objectGroup( sc.uid );
      let all  = 0, inside = 0;
      g?.updateMatrixWorld( true );
      g?.traverse( ( m ) => {
        const geo = ( m as { geometry?: { getAttribute( n: string ): { count: number; getX( i: number ): number; getZ( i: number ): number } | undefined } } ).geometry;
        const pos = geo?.getAttribute( "position" );
        if ( !pos ) return;
        for ( let k = 0; k < pos.count; k++ ) {
          all++;
          const x = pos.getX( k ), z = -pos.getZ( k );
          if ( terrain.chunks.some( ( c ) => x > c.position[0] + 1 && x < c.position[0] + c.size[0] - 1 && z > c.position[2] + 1 && z < c.position[2] + c.size[2] - 1 ) ) inside++;
        }
      } );
      return { all, inside };
    };

    // ---- a made-up map ( only.txt "real": the real mountain alone )
    const only = ( await ( await import( "../../core/ipc" ) ).ipc.readText( joinPath( dir, "only.txt" ) ).catch( () => "" ) ).trim();
    if ( only !== "real" ) {
    await waitFor( () => ( squares().length ? true : null ), "the empty squares", 20000 );
    await waitFor( () => ( document.querySelector( ".mapsize-map image" ) ? true : null ), "the land's relief", 20000 );
    check( squares().length === 8, `made-up map: ${squares().length} empty squares round its one chunk (want 8), the land's relief behind them` );
    const first = terrain.chunks[0].key;
    await click( 1, 0 );
    const east  = terrain.chunks[terrain.chunks.length - 1].key;
    await click( 0, 1 );
    const keys  = terrain.chunks.map( ( c ) => c.key );
    const north = keys[keys.length - 1];
    const s1    = step( first, east );
    check( terrain.chunks.length === 3 && s1 < 0.05, `two squares added (an L): ${terrain.chunks.length} chunks; where the first meets its neighbour, a step of ${s1.toFixed( 3 )} m` );
    let rough = 0;
    for ( let t = 0.1; t < 1; t += 0.1 ) rough = Math.max( rough, Math.abs( terrain.heightAt( terrain.chunks[1].position[0] + t * 1000, terrain.chunks[1].position[2] + 900 ) - terrain.heightAt( terrain.chunks[1].position[0] + 500, terrain.chunks[1].position[2] + 100 ) ) );
    check( rough > 0.5, `the added ground isn't flat (up to ${rough.toFixed( 1 )} m of rise and fall), made to match the map (${north})` );
    // the surroundings, switched on from the Map tab
    const show = [...document.querySelectorAll<HTMLLabelElement>( "label.check" )].find( ( l ) => l.textContent?.includes( "Show surroundings" ) )?.querySelector( "input" );
    check( !!show, "the Map tab has the surroundings to switch on" );
    show?.click();
    await waitFor( () => ( st().customObjects.some( isScenery ) && !st().busy ? true : null ), "the surroundings", 300000 );
    await waitFor( () => ( drawn().all > 1000 ? true : null ), "the surroundings drawn", 60000 ).catch( () => null );
    await sleep( 1000 );
    const sc = st().customObjects.find( isScenery )!;
    const d1 = drawn();
    check( !!sc && !!st().locked[sc.uid] && sc.parts.length >= 2 && d1.all > 1000 && d1.inside === 0, `surroundings built round the L: ${sc?.parts.length} parts, locked ${!!st().locked[sc?.uid]}; drawn ${d1.all} vertices, ${d1.inside} of them inside the ground` );
    // ( two rings: a fine one close by with a texture of its own, a coarse one beyond; no detail or texture to pick )
    // ( rings: each with a texture of its own, finer close in; the detail curve, the rocks' angle and what it comes to in
    // the Map tab; no old detail / texture picks )
    const ringOf    = ( m: string ) => /\/(ring\d+|strip)-\d+$/.exec( m )?.[1] ?? null;
    const ringNames = [...new Set( sc.parts.map( ( p ) => ringOf( p.mesh ) ).filter( ( r ): r is string => !!r ) )];
    const texOf     = ( r: string ) => new Set( sc.parts.filter( ( p ) => ringOf( p.mesh ) === r ).flatMap( ( p ) => p.materials.map( ( m ) => m.base_tex ) ) );
    const ownTex    = ringNames.every( ( r ) => texOf( r ).size === 1 ) && new Set( ringNames.map( ( r ) => [...texOf( r )][0] ) ).size === ringNames.length;
    const picks     = [...document.querySelectorAll<HTMLButtonElement>( ".seg button" )].filter( ( b ) => ["High", "4K"].includes( b.textContent ?? "" ) ).length;
    const curve     = !!document.querySelector( ".props .curve-editor" ), rocks = [...document.querySelectorAll( ".props .bslider, .props .slider" )].some( ( e ) => e.textContent?.includes( "Rocks from" ) );
    check( ringNames.length >= 2 && ownTex && picks === 0 && curve && rocks, `rings: ${ringNames.join( ", " )}, each its own texture ${ownTex}; the Map tab's detail curve ${curve}, rocks' angle ${rocks}; old picks shown: ${picks}` );
    // ( the Map Size map: the surroundings' rings outlined, zoomed out with the wheel to all of them )
    const mini      = document.querySelector<SVGSVGElement>( ".mapsize-map" );
    const outlines  = document.querySelectorAll( ".mapsize-map rect.surround" ).length;
    const before    = mini?.querySelector( "g.cell.chunk rect" )?.getAttribute( "width" );
    if ( mini ) {
      const r = mini.getBoundingClientRect();
      for ( let k = 0; k < 6; k++ ) mini.dispatchEvent( new WheelEvent( "wheel", { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, deltaY: 100, bubbles: true } ) );
    }
    await sleep( 800 );
    const after     = mini?.querySelector( "g.cell.chunk rect" )?.getAttribute( "width" );
    check( outlines === ringNames.length && !!before && !!after && Number( after ) < Number( before ), `Map Size: ${outlines} rings outlined; zoomed out, a chunk ${before} px → ${after} px` );
    log( "SNAP mapsize-zoomed" );
    await sleep( 1500 );
    mini?.dispatchEvent( new MouseEvent( "dblclick", { bubbles: true } ) );
    await sleep( 300 );
    // ( the detail curve's first point dragged down, as a person drags it: kept, and the surroundings built again to it,
    // coarser close in )
    const key0 = document.querySelector<SVGCircleElement>( ".props .curve-editor circle.key" );
    const was  = st().customObjects.find( isScenery )!.scenery?.detail;
    if ( key0 ) {
      const r = key0.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      key0.dispatchEvent( new PointerEvent( "pointerdown", { clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 91, bubbles: true } ) );
      for ( let k = 1; k <= 10; k++ ) window.dispatchEvent( new PointerEvent( "pointermove", { clientX: x, clientY: y + k * 3, buttons: 1, pointerId: 91, bubbles: true } ) );
      window.dispatchEvent( new PointerEvent( "pointerup", { clientX: x, clientY: y + 30, button: 0, buttons: 0, pointerId: 91, bubbles: true } ) );
    }
    await waitFor( () => ( st().busy ? true : null ), "the surroundings building to the curve", 5000 ).catch( () => null );
    await waitFor( () => ( !st().busy ? true : null ), "the surroundings built to the curve", 300000 );
    await sleep( 2000 );
    const now  = st().customObjects.find( isScenery )!.scenery?.detail;
    const v0   = ( c: unknown ) => ( Array.isArray( c ) ? ( c as { v: number }[] )[0]?.v : undefined );
    const kept = ( document.querySelector( ".props .curve-editor circle.key" )?.getAttribute( "cy" ) ?? "" ) === ( key0?.getAttribute( "cy" ) ?? "x" );
    check( !!key0 && v0( now ) !== undefined && v0( was ) !== undefined && v0( now )! < v0( was )! - 0.05, `the detail curve dragged: its first point ${v0( was )?.toFixed( 2 )} → ${v0( now )?.toFixed( 2 )}, built and kept ( the editor shows it: ${kept} )` );
    eng.nav.lookAtUnity( [-2500, 2200, -2500], [500, 0, 500] );
    log( "SNAP made-map" );
    await sleep( 3000 );
    // ( another square with surroundings there: they're built again to fit )
    const parts0 = sc.parts.map( ( p ) => p.mesh ).join( "," ), n0 = terrain.chunks.length;
    await click( -1, -1 );
    await waitFor( () => ( !st().busy ? true : null ), "the surroundings again", 300000 );
    let d2 = drawn();
    for ( let k = 0; k < 20 && d2.inside; k++ ) {
      await sleep( 1000 );
      d2 = drawn();
      log( `  ${k + 1} s: drawn ${d2.all}, ${d2.inside} inside` );
    }
    check( d2.all > 1000 && d2.inside === 0, `built again round the new square: drawn ${d2.all} vertices, ${d2.inside} of them inside the ground` );
    check( terrain.chunks.length === n0 + 1 && !!st().customObjects.find( isScenery ), `a square added beside surroundings: they were built again (${parts0 === st().customObjects.find( isScenery )!.parts.map( ( p ) => p.mesh ).join( "," ) ? "same parts" : "new parts"})` );
    log( "SNAP made-map-3" );
    await sleep( 3000 );
    check( previewed.every( Boolean ), `each new chunk previewed first (the surroundings faint while it was) and the preview gone after: ${previewed.join( "," )}` );
    // ( a chunk clicked: asked, then taken away, the surroundings built again round what's left )
    const gone = terrain.chunks[terrain.chunks.length - 1].key, n1 = terrain.chunks.length;
    // ( drawn in the map's order: the last is the last chunk )
    const cell = document.querySelectorAll<SVGGElement>( ".mapsize-map g.cell.chunk" )[n1 - 1];
    cell?.dispatchEvent( new MouseEvent( "click", { bubbles: true } ) );
    await waitFor( () => button( "Remove" ) ?? null, "the question", 10000 );
    button( "Remove" )!.click();
    await waitFor( () => ( terrain.chunks.length < n1 && !st().busy ? true : null ), "the chunk taken away", 300000 );
    await sleep( 3000 );
    const d4 = drawn();
    check( terrain.indexOf( gone ) < 0 && d4.inside === 0, `a chunk taken away (asked first): ${terrain.chunks.length} left; the surroundings built again, ${d4.inside} vertices inside the ground` );
    }

    if ( only === "made" ) return void log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );

    // ---- a real mountain ( Crotched, one small chunk at a low resolution ), a square added from real elevation
    const { bestLevels }                  = await import( "../../geo/elevation/sources" );
    const { chunkShapes, importMountain } = await import( "../../geo/importMountain" );
    const area                            = { center: { lon: -71.8788, lat: 43.0074 }, chunksX: 1, chunksZ: 1 };
    const [lv]                            = await bestLevels( chunkShapes( area ).map( ( c ) => c.tests ) );
    const proj                            = joinPath( dir, `real-${Date.now()}.jbrproj` );
    await importMountain( { dir: proj, name: "Real", area, level: lv!, res: 1025, trails: false, surroundings: 0 } );
    await openProject( proj );
    useEditor.setState( { splash: false } );
    await sleep( 2500 );
    await waitFor( () => ( squares().length ? true : null ), "the real map's empty squares", 20000 );
    await waitFor( () => ( document.querySelector( ".mapsize-map image" ) ? true : null ), "the real land's relief", 60000 );
    const home = terrain.chunks[0].key;
    await click( 1, 0 );
    const added = terrain.chunks[terrain.chunks.length - 1];
    let lo = Infinity, hi = -Infinity;
    for ( let t = 0.05; t < 1; t += 0.05 ) for ( let u = 0.05; u < 1; u += 0.05 ) {
      const h = terrain.heightAt( added.position[0] + t * 1000, added.position[2] + u * 1000 );
      lo = Math.min( lo, h ); hi = Math.max( hi, h );
    }
    const s2 = step( home, added.key );
    check( terrain.chunks.length === 2 && hi - lo > 20 && s2 < 0.05, `real map: a square added from real elevation (${added.res} a side), ${( hi - lo ).toFixed( 0 )} m from its lowest to its highest; where it meets the chunk beside, a step of ${s2.toFixed( 3 )} m` );
    eng.nav.lookAtUnity( [added.position[0] - 900, hi + 700, added.position[2] - 900], [added.position[0], ( lo + hi ) / 2, added.position[2] + 500] );
    log( "SNAP real-map" );
    await sleep( 3000 );
    // ( its surroundings, the real land round it, from the Map tab )
    const realReach = [...document.querySelectorAll<HTMLLabelElement>( "label.check" )].find( ( l ) => l.textContent?.includes( "Show surroundings" ) )?.querySelector( "input" );
    realReach?.click();
    await waitFor( () => ( st().customObjects.some( isScenery ) && !st().busy ? true : null ), "the real surroundings", 400000 );
    await waitFor( () => ( drawn().all > 1000 ? true : null ), "the real surroundings drawn", 60000 ).catch( () => null );
    await sleep( 1000 );
    const d3 = drawn();
    check( !!realReach && d3.all > 1000 && d3.inside === 0, `real map: surroundings from the real land round it, drawn ${d3.all} vertices, ${d3.inside} of them inside the ground` );
    eng.nav.lookAtUnity( [added.position[0] - 2500, hi + 1500, added.position[2] - 2500], [added.position[0], lo, added.position[2]] );
    log( "SNAP real-map-surroundings" );
    await sleep( 3000 );
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
