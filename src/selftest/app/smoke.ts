import type { BrushId, BrushSettings } from "../../sculpt/brushes";
import { BrushStroke } from "../../sculpt/stroke/stroke";
import { LAYOUTS } from "../../terrain/generate";
import { PROFILES } from "../../core/curve";
import * as THREE from "three/webgpu";
import { applyMaterial, loadLibrary, placeEntry } from "../../pieces/library";
import { arr3, customName } from "../../core/types";
import { captureStamp, newCurve, newStamp } from "../../terrain/shapes/shapes";
import { commitShape, liveShape } from "../../terrain/shapes/edits";
import { deleteUserAsset, importAssetFiles } from "../../pieces/userAssets";
import { deltaBetween, transformCustom } from "../../core/transform";
import { entryPreview } from "../../ui/previews";
import { feature, log, sleep, waitFor } from "../harness";
import { getEngine } from "../../ui/Viewport";
import { history } from "../../map/history";
import { ipc, joinPath } from "../../core/ipc";
import { newProject, openProject, saveProject } from "../../map/project";
import { terrain } from "../../terrain/terrain";
import { toThree } from "../../core/coords";
import { useEditor } from "../../map/store";

/**
 * The default run ( STUDIO_SELFTEST=<dir> with no route ): a new map, pieces, paint, export and the library, end to end.
**/
export async function smokeSelftest( dir: string ) {
  try {
    await waitFor( () => useEditor.getState().placeholders.length > 0, "asset library" );
    log( `library: ${useEditor.getState().placeholders.length} placeholders` );

    const proj = joinPath( dir, `selftest-${Date.now()}.jbrproj` );
    const t0   = performance.now();
    await newProject( proj, "Selftest", { layout: LAYOUTS[2], base: "mountain", slopeDeg: 14, heightRange: 1200, seed: 7 } );
    log( `new 5x5 km project in ${( performance.now() - t0 ).toFixed( 0 )} ms, chunks=${terrain.chunks.length}` );

    const eng = await waitFor( () => getEngine(), "engine" );
    await eng.ready;
    const backend = ( eng.renderer as unknown as { backend: { isWebGPUBackend?: boolean } } ).backend;
    log( `renderer backend: ${backend.isWebGPUBackend ? "WebGPU" : "WebGL2 fallback"}` );
    let stats: Parameters<NonNullable<typeof eng.onStats>>[0] | null = null;
    const prev  = eng.onStats;
    eng.onStats = ( s ) => { stats = s; prev?.( s ); };
    await waitFor( () => stats, "first stats", 30000 );
    await sleep( 1500 );
    log( `render: ${JSON.stringify( stats )}` );

    // sculpt a raise stroke in the middle of the centre chunk
    const h0         = terrain.heightAt( 0, 0 );
    const sculptWith = ( brush: BrushId, radius: number, p: Partial<BrushSettings> = {} ) => {
      const sc          = structuredClone( useEditor.getState().sculpt );
      sc.brush          = brush;
      sc.radius         = radius;
      sc.brushes[brush] = { ...sc.brushes[brush], ...p };
      return sc;
    };
    const st = new BrushStroke( terrain, sculptWith( "draw", 20, { strength: 1 } ), [0, 0] );
    st.move( { x: 0, z: 0 } );
    for ( let k = 0; k < 20; k++ ) st.dab( 0, 0 );
    st.end();
    const h1 = terrain.heightAt( 0, 0 );
    log( `sculpt: height ${h0.toFixed( 2 )} -> ${h1.toFixed( 2 )}` );

    // sculpt speed: a long stroke with a big brush per mode ( dabs + one frame's upload )
    for ( const mode of ["draw", "smooth", "flatten", "layer", "crease"] as const ) {
      const bench = new BrushStroke( terrain, sculptWith( mode, 40, { strength: 0.5 } ), [-200, -100] );
      const tb    = performance.now();
      for ( let k = 0; k <= 60; k++ ) bench.move( { x: -200 + k * 5, z: -100 } );
      const tDabs = performance.now() - tb;
      terrain.flush();
      log( `sculpt bench ${mode}: 300 m stroke, r=40 → ${tDabs.toFixed( 0 )} ms of brush work, ${( performance.now() - tb - tDabs ).toFixed( 0 )} ms upload` );
      bench.end();
      history.undo();
    }
    if ( !( h1 > h0 ) ) throw new Error( "sculpt did not raise terrain" );
    history.undo();
    log( `undo: height ${terrain.heightAt( 0, 0 ).toFixed( 2 )}` );
    history.redo();

    // place a few features on the run
    for ( const [id, z] of [["rail_long", -100], ["flat_box", -60], ["rainbow_box", -20], ["floodlight", 40]] as const ) {
      const hit = toThree( [5, terrain.heightAt( 5, z ), z] );
      eng.placing.placeObject( id, new THREE.Vector3( hit.x, hit.y, hit.z ) );
    }
    log( `objects placed: ${useEditor.getState().objects.length}, spawns: ${useEditor.getState().spawns.length}` );

    // raycast from the camera at the screen centre
    const ray = eng.pickTerrain( eng.renderer.domElement.clientWidth / 2, eng.renderer.domElement.clientHeight / 2 );
    log( `centre raycast: ${ray ? ray.toArray().map( ( v ) => v.toFixed( 1 ) ).join( "," ) : "miss"}` );

    await saveProject();
    const r = await ipc.exportProject( proj, joinPath( dir, "selftest.jbrmap" ) );
    log( `export: ${JSON.stringify( r )}` );

    await openProject( proj );
    log( `reopened: objects=${useEditor.getState().objects.length} chunks=${terrain.chunks.length} h(0,0)=${terrain.heightAt( 0, 0 ).toFixed( 2 )}` );
    await sleep( 1500 );
    log( `render after reopen: ${JSON.stringify( stats )}` );

    const shot = async ( name: string ) => {
      await sleep( 400 );
      const png = await eng.pictures.capture();
      await ipc.writeBinary( joinPath( dir, `${name}.png` ), png );
      log( `screenshot ${name}.png (${png.length} bytes)` );
    };
    const g = ( x: number, z: number ) => terrain.heightAt( x, z );
    eng.nav.lookAtUnity( [0, g( 0, -400 ) + 60, -420], [0, g( 0, 0 ), 0] );
    await shot( "01-generated-run" );
    eng.nav.lookAtUnity( [12, g( 12, -130 ) + 6, -130], [5, g( 5, -60 ), -60] );
    await shot( "02-features-close" );

    // map size: grow the far side ( content-aware ground ), look at the join
    {
      const { growMap, previewGrow, cancelGrow, DEFAULT_GROW } = await import( "../../terrain/mapSize" );
      const tp = performance.now();
      previewGrow( "north", DEFAULT_GROW );
      const tp2 = performance.now();
      previewGrow( "north", { ...DEFAULT_GROW, hills: 2 } );
      log( `grow preview: first ${( tp2 - tp ).toFixed( 0 )} ms, adjust ${( performance.now() - tp2 ).toFixed( 0 )} ms` );
      cancelGrow();
      const before = terrain.chunks.length;
      const t0     = performance.now();
      growMap( "north", 1025 );
      await sleep( 1500 );
      const zMax = Math.max( ...terrain.chunks.map( ( c ) => c.position[2] + c.size[2] ) );
      log( `grow north: ${before} -> ${terrain.chunks.length} chunks in ${( performance.now() - t0 ).toFixed( 0 )} ms (map now reaches z=${zMax})` );
      const edgeZ = zMax - terrain.chunks[0].size[2];
      // roughness either side of the join: should be alike
      const rough = ( z0: number, z1: number ) => {
        let lap = 0, sl = 0, n = 0;
        for ( let z = z0; z < z1; z += 7 )
          for ( let x = -400; x < 400; x += 7 ) {
            const c = g( x, z );
            lap    += Math.abs( g( x + 2, z ) + g( x - 2, z ) - 2 * c );
            sl     += Math.abs( g( x + 4, z ) - c ) / 4;
            n++;
          }
        return `bumpiness ${( lap / n ).toFixed( 3 )}, slope ${( sl / n ).toFixed( 3 )}`;
      };
      log( `roughness old: ${rough( edgeZ - 300, edgeZ - 20 )} | new: ${rough( edgeZ + 100, edgeZ + 400 )}` );
      eng.nav.lookAtUnity( [300, g( 300, edgeZ - 400 ) + 250, edgeZ - 500], [0, g( 0, edgeZ + 300 ), edgeZ + 300] );
      await sleep( 800 );
      await shot( "02c-grown-north" );
      eng.nav.lookAtUnity( [150, g( 150, edgeZ - 120 ) + 45, edgeZ - 120], [0, g( 0, edgeZ + 60 ), edgeZ + 60] );
      await sleep( 800 );
      await shot( "02d-join-close" );
      history.undo();
      await sleep( 500 );
    }

    // terrain shapes: a kicker drawn down the slope, then edited, undone and redone
    {
      const ax     = 40, az = -40, bx = 40, bz = -10;
      const before = g( bx, bz );
      const kicker = { ...newCurve( [ax, az], [bx, bz] ), name: "Kicker", width: 6, heightMode: "bump" as const, bump: 2, profile: structuredClone( PROFILES.kicker.curve ) };
      const t0     = performance.now();
      liveShape( kicker, "Add kicker" );
      commitShape();
      const lip = g( bx, bz - 0.5 );
      log( `shape kicker: lip ${( lip - before ).toFixed( 2 )} m above the slope (applied in ${( performance.now() - t0 ).toFixed( 1 )} ms)` );
      liveShape( { ...kicker, bump: 3 } );
      commitShape();
      log( `shape edit: lip now ${( g( bx, bz - 0.5 ) - before ).toFixed( 2 )} m` );
      history.undo();
      log( `shape undo: lip ${( g( bx, bz - 0.5 ) - before ).toFixed( 2 )} m` );
      history.redo();
      // copy the kicker 40 m across the slope
      const grid = captureStamp( ax - 5, az - 2, bx + 5, bz + 2 );
      const copy = newStamp( [ax + 40, ( az + bz ) / 2], grid, true );
      liveShape( copy, "Copy terrain" );
      commitShape();
      log( `shape copy: lip ${( g( bx + 40, bz - 0.5 ) - g( bx + 40, bz + 3 ) ).toFixed( 2 )} m above the ground beyond it (original ${( g( bx, bz - 0.5 ) - g( bx, bz + 3 ) ).toFixed( 2 )} m), ${grid.w}x${grid.h} samples` );
      useEditor.setState( { tool: "shape", selection: [{ kind: "shape", uid: kicker.uid }] } );
      eng.nav.lookAtUnity( [ax + 14, g( ax, az ) + 5, az - 6], [bx, g( bx, bz ), bz - 8] );
      await shot( "02b-shape-kicker" );
    }
    eng.nav.lookAtUnity( [2400, g( 2400, -2400 ) + 900, -2400], [0, g( 0, 0 ), 0] );
    await shot( "03-whole-map" );
    eng.nav.lookAtUnity( [0, 7000, -1], [0, 0, 0] );
    await shot( "03b-top-down" );
    eng.nav.lookAtUnity( [0, g( 0, -2300 ) + 250, -2300], [0, g( 0, 600 ), 600] );
    await shot( "03c-down-the-mountain" );
    log( `terrain stats at 03c: ${JSON.stringify( eng.terrainR.stats )}` );

    // MLNZ Park: compare with the Unity screenshot taken from the same spot earlier
    const mlnz = "C:/Projects/jibbers-map/Jibbers_Template/MLNZ Park.jbrmap";
    if ( await ipc.pathExists( mlnz ) ) {
      const t1   = performance.now();
      const mdir = joinPath( dir, `mlnz-${Date.now()}.jbrproj` );
      await ipc.importJbrmap( mlnz, mdir );
      await openProject( mdir );
      log( `MLNZ imported+opened in ${( performance.now() - t1 ).toFixed( 0 )} ms: objects=${useEditor.getState().objects.length} spawns=${useEditor.getState().spawns.length} custom=${useEditor.getState().customObjects.length}` );
      const t2 = performance.now();
      await waitFor( () => eng.customR.partCount > 0, "custom objects", 120000 );
      await eng.customR.settled;
      log( `custom objects shown in ${( performance.now() - t2 ).toFixed( 0 )} ms: ${eng.customR.partCount} parts` );
      await sleep( 3000 );
      eng.nav.lookAtUnity( [20.9, -161.5, -195], [18.15, -180.42, -78.46] );
      await shot( "04-mlnz-stairset-view" );
      eng.nav.lookAtUnity( [2, -167.5, -158], [21.2, -173.5, -137.6] );
      await shot( "05-mlnz-logs-view" );

      // the asset library: features and Melon's pieces alike, placed by dragging; materials onto surfaces
      await loadLibrary();
      const lib     = useEditor.getState().assetLibrary;
      const folders = new Map<string, number>();
      for ( const e of lib ) folders.set( `${e.kind}:${e.folder.split( "/" )[0]}`, ( folders.get( `${e.kind}:${e.folder.split( "/" )[0]}` ) ?? 0 ) + 1 );
      log( `library: ${lib.length} items · ${[...folders].map( ( [k, n] ) => `${k} ${n}` ).join( ", " )}` );
      const banana = lib.find( ( e ) => e.id   === feature( "banana_box" ) );
      const lift   = lib.find( ( e ) => e.kind === "mesh" && e.folder.endsWith( "Vehicles & lifts" ) );
      const red    = lib.find( ( e ) => e.kind === "material" && e.folder === "Features/Colours" && e.name === "Red" );
      if ( !banana || !red ) throw new Error( "default library items missing" );
      const at: [number, number, number] = [20, terrain.heightAt( 20, -185 ), -185];
      const customBefore                 = useEditor.getState().customObjects.length;
      const partsBefore                  = eng.customR.partCount;
      await placeEntry( banana.id, at );
      await waitFor( () => eng.customR.partCount > partsBefore, "placed banana box", 60000 );
      await eng.customR.settled;
      const placed = useEditor.getState().customObjects[useEditor.getState().customObjects.length - 1];
      log( `placed banana box: custom ${customBefore} -> ${useEditor.getState().customObjects.length}, surface ${placed.surface_type}, colliders ${placed.colliders.map( ( c ) => c.shape ).join( "," )}` );
      await applyMaterial( { kind: "library", entryId: red.id }, { uid: placed.uid, partIndex: 0, slot: 0 }, true );
      const recoloured = useEditor.getState().customObjects.find( ( o ) => o.uid === placed.uid )!;
      const c          = recoloured.parts[0].materials[0].base_color;
      log( `red material applied: base colour ${c.r.toFixed( 2 )},${c.g.toFixed( 2 )},${c.b.toFixed( 2 )}` );
      const snowy = lib.find( ( e ) => e.kind === "material" && ( ( e.material?.keywords as string[] | undefined ) ?? [] ).includes( "_OVERLAY" ) );
      if ( snowy ) {
        await applyMaterial( { kind: "library", entryId: snowy.id }, { uid: placed.uid, partIndex: 0, slot: 0 }, true );
        const m = useEditor.getState().customObjects.find( ( o ) => o.uid === placed.uid )!.parts[0].materials[0];
        log( `snow-overlay material "${snowy.name}" applied without snow: ${!( ( m.keywords as string[] ) ?? [] ).includes( "_OVERLAY" )}` );
        history.undo();
      }
      const imp = eng.imprintGrid( placed.uid );
      if ( imp ) {
        const hits   = imp.grid.heights.filter( ( h ) => h !== null ).length;
        const before = terrain.heightAt( imp.center[0], imp.center[1] );
        liveShape( newStamp( imp.center, imp.grid, false, "Imprint" ), "Imprint object" );
        commitShape();
        log( `imprint: ${hits}/${imp.grid.heights.length} samples hit, ground at centre ${before.toFixed( 2 )} -> ${terrain.heightAt( imp.center[0], imp.center[1] ).toFixed( 2 )}` );
        history.undo();
      }
      if ( lift ) {
        await placeEntry( lift.id, [at[0] + 12, terrain.heightAt( at[0] + 12, at[2] ), at[2]] );
        log( `placed ${lift.name} from ${lift.folder}` );
      }

      // an imported mesh goes into My imports and places the same way
      const st    = useEditor.getState();
      const glb   = joinPath( st.libraryDir, "placeholders", st.placeholders.find( ( p ) => p.id.includes( "picnic" ) )?.file ?? st.placeholders[0].file );
      const asset = await importAssetFiles( [glb] );
      if ( !asset ) throw new Error( "import returned nothing" );
      await loadLibrary();
      const mine = useEditor.getState().assetLibrary.find( ( e ) => e.id === `user:${asset.path}` );
      log( `imported ${asset.name} into ${mine?.folder ?? "MISSING"}` );
      if ( mine ) await placeEntry( mine.id, [at[0] - 12, terrain.heightAt( at[0] - 12, at[2] ), at[2]] );

      // moving one of Melon's objects moves its parts with it
      const first = useEditor.getState().customObjects[0];
      const cur   = { pos: arr3( first.position ), rot: arr3( first.rotation ), scl: arr3( first.scale ) };
      useEditor.getState().updateCustom( "move", [first.uid], ( o ) => transformCustom( o, deltaBetween( cur, { ...cur, pos: [cur.pos[0], cur.pos[1] + 2, cur.pos[2]] } ) ) );
      const moved = useEditor.getState().customObjects[0];
      log( `moved ${customName( first )}: root y ${first.position.y.toFixed( 2 )} -> ${moved.position.y.toFixed( 2 )}, part0 y ${first.parts[0].local_position.y.toFixed( 2 )} -> ${moved.parts[0].local_position.y.toFixed( 2 )}` );
      history.undo();

      await eng.customR.settled;
      const savePreview = async ( name: string, url: string | null ) => {
        if ( !url ) return log( `preview ${name}: none` );
        const bytes = new Uint8Array( await ( await fetch( url ) ).arrayBuffer() );
        await ipc.writeBinary( joinPath( dir, `${name}.png` ), bytes );
        log( `preview ${name}: ${bytes.length} bytes` );
      };
      await savePreview( "07-preview-banana-box", await entryPreview( banana ) );
      if ( lift ) await savePreview( "08-preview-lift", await entryPreview( lift ) );
      const melonMat = useEditor.getState().assetLibrary.find( ( e ) => e.kind === "material" && e.folder === "Melon's park" && e.material?.base_tex );
      if ( melonMat ) await savePreview( "09-preview-melon-material", await entryPreview( melonMat ) );

      eng.nav.lookAtUnity( [at[0] - 8, at[1] + 5, at[2] - 14], at );
      await sleep( 2500 );
      await shot( "06-library-pieces" );

      await saveProject();
      const ex = await ipc.exportProject( mdir, joinPath( dir, "mlnz-with-asset.jbrmap" ) );
      log( `export: objects=${ex.objects} (custom ${useEditor.getState().customObjects.length} + features ${useEditor.getState().objects.length})` );
      if ( mine ) await deleteUserAsset( { path: asset.path, name: asset.name, parts: 0, textures: 0, size: [0, 0, 0], surfaceType: "Generic" } );
    }
    log( "SELFTEST OK" );
  } catch ( e ) {
    log( `SELFTEST FAILED: ${e instanceof Error ? e.stack ?? e.message : String( e )}` );
  }
}
