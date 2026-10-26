import * as THREE from "three/webgpu";
import { getEngine } from "../../ui/Viewport";
import { ipc, joinPath } from "../../core/ipc";
import { log, sleep, waitFor } from "../harness";
import { openProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { toThree } from "../../core/coords";
import { useEditor } from "../../map/store";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/mountain ): import Crotched Mountain for real and look at it.
**/
export async function mountainSelftest( dir: string ) {
  try {
    const { bestLevels }                  = await import( "../../geo/elevation/sources" );
    const { chunkShapes, importMountain } = await import( "../../geo/importMountain"    );
    const { groundRes }                   = await import( "../../terrain/generate"      );
    const area                            = { center: { lon: -71.8788, lat: 43.0074 }, chunksX: 2, chunksZ: 2 };
    const t0                              = performance.now();
    const levels                          = await bestLevels( chunkShapes( area ).map( ( c ) => c.tests ) );
    log( `coverage: ${levels.map( ( l ) => l?.label ).join( ", " )} in ${( performance.now() - t0 ).toFixed( 0 )} ms` );
    const lv      = levels.reduce( ( a, b ) => ( b!.res > a!.res ? b : a ) )!;
    const proj    = joinPath( dir, `crotched-${Date.now()}.jbrproj` );
    const t1      = performance.now();
    let lastStage = "";
    const r       = await importMountain( { dir: proj, name: "Crotched", area, level: lv, res: groundRes( 1000 ), trails: true, surroundings: 8000, onProgress: ( st ) => { if ( st !== lastStage ) log( `stage: ${st} at ${( performance.now() - t1 ).toFixed( 0 )} ms` ); lastStage = st; } } );
    log( `import: ${( performance.now() - t1 ).toFixed( 0 )} ms, trails ${r.trails}${r.trailsError ? ` (${r.trailsError})` : ""}, filled ${r.filled}` );
    await openProject( proj );
    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    await sleep( 2500 );
    const g = ( x: number, z: number ) => terrain.heightAt( x, z );
    log( `chunks ${terrain.chunks.length}, height at centre ${g( 0, 0 ).toFixed( 1 )}, spawn ${JSON.stringify( useEditor.getState().spawns[0]?.position )}` );
    const shot = async ( name: string ) => {
      await sleep( 600 );
      const png = await eng.pictures.capture();
      await ipc.writeBinary( joinPath( dir, `${name}.png` ), png );
      log( `screenshot ${name}.png` );
    };
    eng.nav.lookAtUnity( [0, g( 0, -950 ) + 500, -950], [0, g( 0, 0 ), 0] );
    await shot( "m1-from-south" );
    eng.nav.lookAtUnity( [900, g( 900, 900 ) + 450, 900], [0, g( 0, -100 ), -100] );
    await shot( "m2-from-ne" );
    log( `custom objects: ${useEditor.getState().customObjects.length}, background mountains ${useEditor.getState().map?.allowBackgroundMountains}` );
    for ( const [x, z] of [[300, -999.5], [999.5, 0], [-999.5, 200], [0, 999.5]] ) log( `terrain at ${x},${z}: ${g( x, z ).toFixed( 2 )}` );
    {
      const sc = useEditor.getState().customObjects[0];
      log( `scenery parts ${sc?.parts.length}, first part pos ${JSON.stringify( sc?.parts[0]?.local_position )} rot ${JSON.stringify( sc?.parts[0]?.local_rotation )} scale ${JSON.stringify( sc?.parts[0]?.local_scale )}` );
      await sleep( 4000 );
      const grp = sc ? eng.customR.objectGroup( sc.uid ) : null;
      if ( grp ) {
        grp.updateMatrixWorld( true );
        const rc = new THREE.Raycaster();
        for ( const [x, z] of [[1010, 0], [1100, 0], [-1010, 200], [300, -1010], [0, 1010], [2000, 2000], [-3000, 500], [300, -900], [950, 0], [0, 0], [300, -990]] ) {
          const o = toThree( [x, 5000, z] );
          rc.set( new THREE.Vector3( o.x, o.y, o.z ), new THREE.Vector3( 0, -1, 0 ) );
          const hit = rc.intersectObject( grp, true )[0];
          log( `scenery drawn at ${x},${z}: ${hit ? hit.point.y.toFixed( 2 ) : "no hit"} (terrain edge nearby ${g( Math.max( -999.5, Math.min( 999.5, x ) ), Math.max( -999.5, Math.min( 999.5, z ) ) ).toFixed( 2 )})` );
        }
      } else log( "scenery not shown" );
    }
    await sleep( 3000 );
    eng.nav.lookAtUnity( [0, g( 0, 0 ) + 2200, -9000], [0, g( 0, 0 ), 0] );
    await shot( "m3-surroundings" );
    {
      const y = g( 300, -940 );
      eng.nav.lookAtUnity( [300, y + 25, -900], [300, y - 40, -1300] );
      await shot( "m4-edge" );
      const y2 = g( 940, 0 );
      eng.nav.lookAtUnity( [900, y2 + 60, -250], [1150, y2 - 20, 150] );
      await shot( "m5-edge-east" );
      const y3 = g( 300, -995 );
      eng.nav.lookAtUnity( [300, y3 + 120, -880], [300, y3, -1010] );
      await shot( "m6-seam-above" );
    }
    // the dialog: search, pick the first hit ( sets a 3x3 km area ), let coverage come in
    useEditor.setState( { mountainImport: true } );
    const input = await waitFor( () => document.querySelector<HTMLInputElement>( ".mtnw-search input" ), "dialog" );
    Object.getOwnPropertyDescriptor( HTMLInputElement.prototype, "value" )!.set!.call( input, "Crotched Mountain" );
    input.dispatchEvent( new Event( "input", { bubbles: true } ) );
    await sleep( 200 );
    input.dispatchEvent( new KeyboardEvent( "keydown", { key: "Enter", bubbles: true } ) );
    const hit = await waitFor( () => document.querySelector<HTMLElement>( ".mtnw-hits .bmenu-item" ), "search results" );
    log( `search: ${hit.textContent}` );
    hit.click();
    await waitFor( () => document.querySelector( ".mtnw-legend" ), "coverage", 40000 );
    await sleep( 6000 );
    log( `dialog: ${document.querySelector( ".mtnw-side" )?.textContent?.slice( 0, 400 )}` );
    log( "DIALOG READY" );
    await sleep( 15000 );
    log( "SELFTEST OK" );
  } catch ( e ) {
    log( `SELFTEST FAILED: ${e}` );
  }
}
