import { ipc, joinPath } from "../../core/ipc";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, sleep, waitFor } from "../harness";

// ( written by the Rust tests: src-tauri/src/unity/fixture.rs )
const ROOT = "C:/Users/goali/AppData/Local/Temp/jibbers-unity-full";

type Probe = { name: string; at: [number, number]; base: number };

/**
 * Focused run ( STUDIO_SELFTEST=<...>/unityfull ): a Unity project with everything Map-Tools makes imported as a
 * person does, and checked against what it says should come in ( expect.json ). Then the inserts and the ski line,
 * worked into the ground as Map-Tools leaves them: each moved away, the ground where it was is the ground from before
 * again ( known to the scene ), the shape where it's gone; the ski line moved, the same, its stripes gone with it. Saved and opened again, the
 * shapes' changes kept, not worked out again.
**/
export async function unityFullSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    const want                 = JSON.parse( await ipc.readText( `${ROOT}/expect.json` ) ) as { name: string; chunks: number; objects: number; lifts: number; spawns: number; pieces: number; gameTrees: number; meshTrees: number; shapes: Record<string, number>; skiLines: number; lineFeatures: number; probes: Probe[] };
    const { importUnityScene } = await import( "../../map/project" );
    const { newEmptyProject }  = await import( "../../map/project/sessions" );
    await newEmptyProject( joinPath( dir, `start-${Date.now()}.jbrproj` ), "Untitled" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    const st   = () => useEditor.getState();
    const proj = joinPath( dir, "full.jbrproj" );
    await importUnityScene( `${ROOT}/Assets/Full.unity`, proj );
    await waitFor( () => ( st().map?.name === want.name && terrain.chunks.length ? true : null ), "the import", 120000 );
    await sleep( 2000 );

    // ---- what came in
    const s = st();
    check( terrain.chunks.length === want.chunks, `${terrain.chunks.length} chunks ( ${want.chunks} )` );
    const features = s.objects.filter( ( o ) => !o.tree ), gameTrees = s.objects.filter( ( o ) => o.tree ), meshTrees = s.customObjects.filter( ( o ) => o.tree );
    check( features.length === want.objects && features.filter( ( o ) => o.lift ).length === want.lifts, `${features.length} features ( ${want.objects} ), ${features.filter( ( o ) => o.lift ).length} lift ( ${want.lifts} )` );
    check( features.some( ( o ) => o.id === "picnic_table" && o.params?.color?.type === "String" && o.params.color.value === "red" ), "the prefab instance's feature, its colour" );
    check( s.spawns.length === want.spawns, `${s.spawns.length} spawns ( ${want.spawns} )` );
    check( s.customObjects.length - meshTrees.length === want.pieces, `${s.customObjects.length - meshTrees.length} pieces ( ${want.pieces} )` );
    check( gameTrees.length === want.gameTrees && meshTrees.length === want.meshTrees, `trees: ${gameTrees.length} the game's ( ${want.gameTrees} ), ${meshTrees.length} of the map's own ( ${want.meshTrees} )` );
    const kinds = Object.fromEntries( Object.keys( want.shapes ).map( ( k ) => [k, s.shapes.filter( ( x ) => x.kind === k ).length] ) );
    check( Object.keys( want.shapes ).every( ( k ) => kinds[k] === want.shapes[k] ), `shapes ${JSON.stringify( kinds )}` );
    const lines = s.shapes.filter( ( x ) => x.kind === "skiline" );
    const line0 = lines[0]?.kind === "skiline" ? lines[0] : null;
    check( lines.length === want.skiLines && line0?.features.length === want.lineFeatures && line0?.features[0].stripes.length === 3, `the ski line a ski line: ${lines.length} ( ${want.skiLines} ), ${line0?.features.map( ( f ) => f.name ).join( ", " )}; the kicker's stripes ${line0?.features[0].stripes.length}` );

    // ---- as Unity left it: the inserts up, the ski line down
    const probes = new Map( want.probes.map( ( p ) => [p.name, p] ) );
    const lift   = ( p: Probe ) => terrain.heightAt( p.at[0], p.at[1] ) - p.base;
    const left   = want.probes.map( ( p ) => `${p.name} ${lift( p ).toFixed( 2 )}` ).join( ", " );
    check( want.probes.every( ( p ) => ( p.name === "Line" ? lift( p ) < -1 : lift( p ) > 1 ) ), `the ground as Unity left it ( m over the ground from before ): ${left}` );

    // ---- each insert moved 300 m along x ( off to the side, in the third chunk ): the ground from before where it was
    const { liveShape, commitShape } = await import( "../../terrain/shapes/edits" );
    const { whenShapesSettled }      = await import( "../../terrain/shapes/shapes" );
    for ( const name of ["Jump", "Mound", "Copy", "Box"] ) {
      const p  = probes.get( name )!;
      const sh = st().shapes.find( ( x ) => x.name === name );
      if ( !sh ) { check( false, `${name}: no shape` ); continue; }
      const by = ( v: [number, number] ): [number, number] => [v[0] + 300, v[1]];
      const was = terrain.heightAt( p.at[0] + 300, p.at[1] );
      const moved = sh.kind === "curve" ? { ...sh, start: by( sh.start ), end: by( sh.end ) } : sh.kind === "circle" || sh.kind === "stamp" ? { ...sh, center: by( sh.center ) } : sh;
      liveShape( moved, `Move ${name}` );
      commitShape();
      await new Promise<void>( ( r ) => whenShapesSettled( r ) );
      await sleep( 200 );
      const back = lift( p ), there = terrain.heightAt( p.at[0] + 300, p.at[1] ) - was;
      check( Math.abs( back ) < 0.6 && Math.abs( there ) > 0.5, `${name} moved: where it was, ${back.toFixed( 2 )} m off the ground from before; where it's gone, ${there.toFixed( 2 )} m` );
    }
    // ---- saved and opened again: the inserts' changes kept ( not worked out again )
    const { saveProject, openProject } = await import( "../../map/project" );
    await saveProject();
    const saved = JSON.parse( await ipc.readText( joinPath( proj, "project.json" ) ) ) as { editor?: { unbake?: unknown; shapePatches?: string[] } };
    await openProject( proj );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "opened again", 60000 );
    await sleep( 1500 );
    const jump = probes.get( "Jump" )!;
    check( !saved.editor?.unbake && ( saved.editor?.shapePatches?.length ?? 0 ) >= 6 && Math.abs( lift( jump ) ) < 0.6, `saved: ${saved.editor?.shapePatches?.length} shapes' changes kept, none left to work out; opened again, the moved jump's old place ${lift( jump ).toFixed( 2 )} m off` );
    // ---- the ski line ( opened again ) moved 300 m along x: the ground from before where it was, its stripes gone with it
    const ski = st().shapes.find( ( x ) => x.kind === "skiline" );
    if ( ski?.kind === "skiline" ) {
      const { ensureLayer, layerOf } = await import( "../../paint/ground" );
      const { skiLineStripes }      = await import( "../../terrain/shapes/shapes/skiline" );
      const c  = terrain.chunks[terrain.chunkAt( ski.nodes[1].p[0], ski.nodes[1].p[2] )];
      await ensureLayer( c );
      const L  = layerOf( c.key )!;
      const px = [...skiLineStripes( ski, c.position[0], c.position[2], c.size[0], L.m )].filter( ( [, v] ) => v.cov > 0.5 );
      const k  = px[Math.floor( px.length / 2 )]?.[0] ?? -1;
      const painted = k >= 0 ? L.rgba[k * 4 + 2] : -1, hue = k >= 0 ? L.rgba[k * 4 + 1] : -1;
      liveShape( { ...ski, nodes: ski.nodes.map( ( n ) => ( { ...n, p: [n.p[0] + 300, n.p[1], n.p[2]] as [number, number, number] } ) ) }, "Move ski line" );
      commitShape();
      await new Promise<void>( ( r ) => whenShapesSettled( r ) );
      await sleep( 300 );
      const line = probes.get( "Line" )!, after = k >= 0 ? layerOf( c.key )!.rgba[k * 4 + 2] : -1;
      check( Math.abs( lift( line ) ) < 0.6 && painted > 100 && after < painted / 4, `the ski line moved: where it was, ${lift( line ).toFixed( 2 )} m off the ground from before; its stripe there ${painted} ( hue ${hue} ) → ${after}` );
    }

    const sh = st().shapes.find( ( x ) => x.name === "Jump" );
    if ( sh?.kind === "curve" ) {
      liveShape( { ...sh, start: [sh.start[0] - 300, sh.start[1]], end: [sh.end[0] - 300, sh.end[1]] }, "Move back" );
      commitShape();
      await new Promise<void>( ( r ) => whenShapesSettled( r ) );
      await sleep( 200 );
      const up = lift( jump );
      ( await import( "../../map/history" ) ).history.undo();
      await new Promise<void>( ( r ) => whenShapesSettled( r ) );
      await sleep( 200 );
      check( Math.abs( up ) > 0.5 && Math.abs( lift( jump ) ) < 0.6, `opened again, moved back: the ground changed ${up.toFixed( 2 )} m where it started; undone, ${lift( jump ).toFixed( 2 )} m off the ground from before` );
    }
    eng.nav.frameAll();
    log( "SNAP full" );
    await sleep( 2500 );
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
