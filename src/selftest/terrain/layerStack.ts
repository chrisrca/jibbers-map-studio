import { joinPath } from "../../core/ipc";
import { history } from "../../map/history";
import { newEmptyProject } from "../../map/project/sessions";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { getEngine } from "../../ui/Viewport";
import { log, sleep, waitFor } from "../harness";

/**
 * Focused run ( STUDIO_SELFTEST=<...>/layerstack ): the ground in layers as a person builds it on a new map — a run,
 * a formation on it, a ski line over the formation — then the run raised: the formation and the line on it go up with
 * it, the line's points still on the ground; undone, all as it was. Before and after shown.
**/
export async function layerStackSelftest( dir: string ) {
  const fails: string[] = [];
  const check           = ( ok: boolean, what: string ) => { if ( !ok ) fails.push( what ); log( `${ok ? "ok  " : "FAIL"} ${what}` ); };
  try {
    await newEmptyProject( joinPath( dir, `layers-${Date.now()}.jbrproj` ), "Layers" );
    const eng = await waitFor( () => getEngine(), "engine", 60000 );
    await eng.ready;
    useEditor.setState( { splash: false } );
    await waitFor( () => ( terrain.chunks.length ? true : null ), "the ground", 60000 );
    await sleep( 800 );
    const st                          = () => useEditor.getState();
    const { commitTrails }            = await import( "../../trails/edits" );
    const { flushTrails }             = await import( "../../trails/ground" );
    const { newRun }                  = await import( "../../trails/trails" );
    const { liveShape, commitShape }  = await import( "../../terrain/shapes/edits" );
    const { newFormation, newSkiLine, whenShapesSettled, groundWithout } = await import( "../../terrain/shapes/shapes" );
    const settled = async () => {
      flushTrails();
      for ( let k = 0; k < 3; k++ ) {
        await new Promise<void>( ( r ) => whenShapesSettled( r ) );
        await sleep( 200 );
      }
    };
    const h0 = terrain.heightAt( 0, 0 );
    log( `ground at the middle: ${h0.toFixed( 2 )} m` );
    // a run along Z through the middle, 40 m wide, on the ground
    const net = ( y: number ) => {
      const a = { id: "lay-a", p: [0, y, -160] as [number, number, number] }, b = { id: "lay-b", p: [0, y, 160] as [number, number, number] };
      const n = { nodes: [a, b], runs: [] as ReturnType<typeof newRun>[] };
      n.runs.push( { ...newRun( n, a.id, b.id, 40 ), id: "lay-run" } );
      return n;
    };
    commitTrails( net( h0 ), "Add run" );
    await settled();
    // a formation on it, round the middle
    const ring = Array.from( { length: 16 }, ( _, k ) => [Math.cos( ( k / 16 ) * Math.PI * 2 ) * 45, Math.sin( ( k / 16 ) * Math.PI * 2 ) * 45] as [number, number] );
    const f    = { ...newFormation( ring ), height: 18, peakWidth: 20, edgeBlend: 10 };
    liveShape( f, "Add formation" );
    commitShape();
    await settled();
    const peak0 = terrain.heightAt( 0, 0 );
    check( peak0 > h0 + 10, `the formation on the run: ${( peak0 - h0 ).toFixed( 2 )} m up at its middle` );
    // a ski line over it, its points on the ground
    const line = newSkiLine( [-80, -30, 30, 80].map( ( z ) => ( { p: [0, terrain.heightAt( 0, z ), z] as [number, number, number], width: 10, roll: 0 } ) ) );
    liveShape( line, "Add ski line" );
    commitShape();
    await settled();
    const ys0 = line.nodes.map( ( n ) => n.p[1] );
    eng.nav.lookAtUnity( [-110, h0 + 70, -120], [0, h0 + 10, 0] );
    await sleep( 1500 );
    const before = Float32Array.from( terrain.chunks[terrain.chunkAt( 0, 0 )].heights );
    const side0  = terrain.heightAt( 20, 0 );
    log( "SNAP layers-before" );
    await sleep( 1200 );
    // the run raised 8 m
    commitTrails( net( h0 + 8 ), "Raise run" );
    await settled();
    // ( beside the line, on the formation )
    const side1 = terrain.heightAt( 20, 0 );
    check( Math.abs( side1 - side0 - 8 ) < 0.5, `the run raised 8 m: the formation beside the line ${( side1 - side0 ).toFixed( 2 )} m up` );
    const now = st().shapes.find( ( s ) => s.uid === line.uid );
    const ys1 = now?.kind === "skiline" ? now.nodes.map( ( n ) => n.p[1] ) : [];
    check( ys1.length === ys0.length && ys1.every( ( y, k ) => Math.abs( y - ys0[k] - 8 ) < 1 ), `the ski line's points up with it: ${ys1.map( ( y, k ) => ( y - ys0[k] ).toFixed( 2 ) ).join( ", " )} m` );
    const g = groundWithout( line.uid );
    check( now?.kind === "skiline" && now.nodes.every( ( n ) => Math.abs( n.p[1] - g( n.p[0], n.p[2] ) ) < 0.05 ), "its points still on the ground beneath it" );
    check( now?.kind === "skiline" && now.nodes.slice( 1, -1 ).every( ( n ) => Math.abs( terrain.heightAt( n.p[0], n.p[2] ) - n.p[1] ) < 0.2 ), "the line carved through them" );
    log( "SNAP layers-after" );
    await sleep( 1200 );
    // undone: the run back down, and all on it
    history.undo();
    await settled();
    const back = terrain.chunks[terrain.chunkAt( 0, 0 )].heights;
    let most   = 0;
    for ( let k = 0; k < back.length; k++ ) most = Math.max( most, Math.abs( back[k] - before[k] ) );
    check( most < 0.05, `undone: the ground as it was, at most ${most.toFixed( 4 )} m off` );
    log( fails.length ? `SELFTEST FAILED: ${fails.join( "; " )}` : "SELFTEST OK" );
  } catch ( err ) {
    log( `SELFTEST FAILED: ${err instanceof Error ? err.stack ?? err.message : err}` );
  }
}
