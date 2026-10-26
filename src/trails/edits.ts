// Changing the trails: each change one undo step, the ground following ( trails/ground/ ). While a point or handle
// is dragged only the drawn trails follow ( previewNet ); letting go commits it.

import { ipc, joinPath } from "../core/ipc";
import { useEditor } from "../map/store";
import { terrain } from "../terrain/terrain";
import { baseSampler, commitNet, currentField, currentNet, loadTrails, NEW_GROUND, REAL_GROUND, sameSettings, trailSaveData, type Field, type GroundSettings } from "./ground";
import { emptyNet, fitToGround, mergePoints, nearestOnRun, NET_VERSION, newRun, nodeOf, runsAt, splitRun, tiltToGround, trailId, type TrailNet, type TrailRun } from "./trails";

type V3 = [number, number, number];

const show = ( net: TrailNet ) => useEditor.setState( { trails: net, dirty: true } );

/**
 * Makes `net` the trails ( the ground following ), one undo step. Returns the milliseconds it took.
**/
export function commitTrails( net: TrailNet, label: string ): number {
  return commitNet( net, useEditor.getState().trailGround, label, show );
}

/**
 * The trails drawn as `net` while something's dragged ( the ground waits for commitTrails ).
**/
export function previewNet( net: TrailNet ) {
  useEditor.setState( { trails: net } );
}

/**
 * The trails as committed ( a drag let go of without a change, or cancelled ).
**/
export function cancelPreview() {
  useEditor.setState( { trails: currentNet() } );
}

const copy = (): TrailNet => structuredClone( currentNet() );

/**
 * A new point at `p`; joined to point `from` by a new run when given. The first point on a map with ground already
 * picks the settings for an imported mountain ( a narrow blend, no noise ), on an empty one those for new ground.
**/
export function addPoint( p: V3, from?: string | null ): { node: string; run: string | null } {
  const net = copy();
  if ( !net.nodes.length ) {
    useEditor.setState( { trailGround: terrain.chunks.length ? REAL_GROUND : NEW_GROUND } );
    net.grow = !terrain.chunks.length;
  }
  const node = { id: trailId( "pt" ), p };
  net.nodes.push( node );
  let run: TrailRun | null = null;
  if ( from && net.nodes.some( ( n ) => n.id === from ) ) {
    // ( as wide as the run it carries on from )
    const prev = runsAt( net, from )[0];
    run        = newRun( net, from, node.id, prev ? ( prev.a === from ? prev.wa : prev.wb ) : useEditor.getState().trailTool.width );
    run.detail = keepDetail( net );
    net.runs.push( run );
    flowAt( net, from );
    // ( the run it carries on from turned at its end to flow on: fitted again too, if it still was )
    follow( net, [run.id, ...runsAt( net, from ).filter( ( r ) => r.id !== run!.id && r.fit ).map( ( r ) => r.id )] );
  }
  commitTrails( net, run ? "Add run" : "Add point" );
  return { node: node.id, run: run?.id ?? null };
}

/**
 * A run between two points already there ( none if they're joined already ).
**/
export function connect( a: string, b: string ): string | null {
  const net = copy();
  if ( a === b || net.runs.some( ( r ) => ( r.a === a && r.b === b ) || ( r.a === b && r.b === a ) ) ) return null;
  const prev = runsAt( net, a )[0];
  const run  = newRun( net, a, b, prev ? ( prev.a === a ? prev.wa : prev.wb ) : useEditor.getState().trailTool.width );
  run.detail = keepDetail( net );
  net.runs.push( run );
  flowAt( net, a );
  flowAt( net, b );
  follow( net, [run.id, ...[...runsAt( net, a ), ...runsAt( net, b )].filter( ( r ) => r.id !== run.id && r.fit ).map( ( r ) => r.id )] );
  commitTrails( net, "Join points" );
  return run.id;
}

/**
 * How much of the ground's own relief new runs keep: all of it on a real mountain; nothing on trails begun from
 * nothing ( there's none ).
**/
export const keepDetail = ( net: TrailNet ) => ( net.grow ? 0 : 1 );

/**
 * The width at point `node` of every run there ( their other ends as they were ).
**/
export function withWidthAt( net: TrailNet, node: string, width: number ): TrailNet {
  const n = structuredClone( net );
  for ( const r of n.runs ) {
    if ( r.a === node ) r.wa = width;
    if ( r.b === node ) r.wb = width;
  }
  return n;
}

/**
 * New runs shaped to the ground as it is ( they haven't changed it yet ), when the tool says so ( and their points
 * tilted to it ).
**/
function follow( net: TrailNet, runs: string[] ) {
  if ( !useEditor.getState().trailTool.follow ) return;
  fitRuns( net, runs, net.grow ? ( x, z ) => terrain.heightAt( x, z ) : baseSampler() );
}

/**
 * The ground a dragged point sits on: a real mountain's beneath the trails; on trails begun from nothing, as shown.
**/
export function snapGround( net: TrailNet ): ( ( x: number, z: number ) => number ) | null {
  if ( !useEditor.getState().trailTool.follow ) return null;
  return net.grow ? ( x, z ) => terrain.heightAt( x, z ) : baseSampler();
}

/**
 * Points ( or handles ) moved: the runs at them still in their fitted shape fitted again ( Follow Ground on, on a real
 * mountain: on trails begun from nothing the ground is theirs, and fitting would flatten it ), then committed.
**/
export function commitMoved( net: TrailNet, nodes: string[], label: string ) {
  if ( useEditor.getState().trailTool.follow && !net.grow ) {
    const at   = new Set( nodes );
    const runs = net.runs.filter( ( r ) => r.fit && ( at.has( r.a ) || at.has( r.b ) ) ).map( ( r ) => r.id );
    if ( runs.length ) {
      net = structuredClone( net );
      fitRuns( net, runs );
    }
  }
  commitTrails( net, label );
}

/**
 * Runs ( in `net`, a copy being edited ) shaped to `ground` ( the ground beneath the trails ), their points tilted to it.
**/
function fitRuns( net: TrailNet, runs: string[], ground: ( x: number, z: number ) => number = baseSampler() ) {
  const ids = new Set( runs );
  const pts = new Set<string>();
  for ( const r of net.runs ) if ( ids.has( r.id ) ) { pts.add( r.a ); pts.add( r.b ); }
  tiltToGround( net, pts, ground );
  for ( const r of net.runs ) if ( ids.has( r.id ) ) fitToGround( net, r, ground );
}

/**
 * The picked runs ( or the picked points' runs; or all of them ) shaped to the ground beneath ( a real mountain's: on
 * trails begun on a map with no ground, there's none but the floor ).
**/
export function fitToGroundPicked() {
  const st   = useEditor.getState();
  const net  = copy();
  const runs = new Set( st.selection.filter( ( s ) => s.kind === "trailRun" ).map( ( s ) => s.uid ) );
  for ( const s of st.selection ) if ( s.kind === "trailNode" ) for ( const r of runsAt( net, s.uid ) ) runs.add( r.id );
  fitRuns( net, runs.size ? [...runs] : net.runs.map( ( r ) => r.id ) );
  commitTrails( net, "Fit to ground" );
}

/**
 * At a point with two runs, `changed`'s handle there sets the other's: straight through ( the other's length kept ),
 * so a trail flows through its points instead of kinking.
**/
function alignAt( net: TrailNet, node: string, changed: string ) {
  const at = runsAt( net, node );
  if ( at.length !== 2 ) return;
  const r        = at.find( ( x ) => x.id === changed )!, o = at.find( ( x ) => x.id !== changed )!;
  const h        = r.a === node ? r.ha : r.hb;
  const oh       = o.a === node ? o.ha : o.hb;
  const len      = Math.hypot( h[0], h[1], h[2] ) || 1, olen = Math.hypot( oh[0], oh[1], oh[2] );
  const next: V3 = [( -h[0] / len ) * olen, ( -h[1] / len ) * olen, ( -h[2] / len ) * olen];
  if ( o.a === node ) o.ha = next;
  else o.hb = next;
}

/**
 * At a point with two runs, both aimed to flow through it, sharing the turn; each turns at most 45° off straight at its
 * own other end ( sharper, a wide run would curl back over itself ), past that the rest left a corner.
**/
function flowAt( net: TrailNet, node: string ) {
  const at = runsAt( net, node );
  if ( at.length !== 2 ) return;
  const p   = nodeOf( net, node ).p;
  const out = at.map( ( r ) => {
    const q = nodeOf( net, r.a === node ? r.b : r.a ).p, d: V3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const l = Math.hypot( d[0], d[1], d[2] ) || 1;
    return { r, l, d: [d[0] / l, d[1] / l, d[2] / l] as V3 };
  } );
  const [A, B] = out;
  // ( the way through: the turn shared )
  const t: V3  = [A.d[0] - B.d[0], A.d[1] - B.d[1], A.d[2] - B.d[2]];
  const tl     = Math.hypot( t[0], t[1], t[2] ) || 1;
  for ( const [o, sign] of [[A, 1], [B, -1]] as const ) {
    const w: V3 = [( sign * t[0] ) / tl, ( sign * t[1] ) / tl, ( sign * t[2] ) / tl];
    const c     = Math.max( -1, Math.min( 1, w[0] * o.d[0] + w[1] * o.d[1] + w[2] * o.d[2] ) );
    const phi   = Math.min( Math.acos( c ), MOST_TURN );
    // ( turned from straight at the other end towards the way through )
    const q: V3 = [w[0] - c * o.d[0], w[1] - c * o.d[1], w[2] - c * o.d[2]];
    const ql    = Math.hypot( q[0], q[1], q[2] );
    const h: V3 = ql < 1e-6 ? o.d : [0, 1, 2].map( ( i ) => Math.cos( phi ) * o.d[i] + ( Math.sin( phi ) * q[i] ) / ql ) as V3;
    const len   = o.l / 3;
    const v: V3 = [h[0] * len, h[1] * len, h[2] * len];
    if ( o.r.a === node ) o.r.ha = v;
    else o.r.hb = v;
  }
}

const MOST_TURN = ( 45 * Math.PI ) / 180;

/**
 * A point moved to `p` ( in `net`, a copy being edited ).
**/
export function withPointAt( net: TrailNet, id: string, p: V3 ): TrailNet {
  const n = structuredClone( net );
  nodeOf( n, id ).p = p;
  return n;
}

/**
 * A run's handle at one end set ( the run through that point, if it has one, following ).
**/
export function withHandle( net: TrailNet, run: string, end: "a" | "b", h: V3 ): TrailNet {
  const n = structuredClone( net );
  const r = n.runs.find( ( x ) => x.id === run )!;
  if ( end === "a" ) r.ha = h;
  else r.hb = h;
  alignAt( n, end === "a" ? r.a : r.b, run );
  return n;
}

/**
 * A run ( not one of point `id`'s own ) whose surface point `id` lies on, and where along it ( away from its ends ).
**/
export function runUnder( net: TrailNet, id: string ): { run: string; t: number } | null {
  const n = nodeOf( net, id );
  let best: { run: string; t: number; d: number } | null = null;
  for ( const r of net.runs ) {
    if ( r.a === id || r.b === id ) continue;
    const q    = nearestOnRun( net, r, n.p[0], n.p[2] );
    const half = ( r.wa + ( r.wb - r.wa ) * q.t ) / 2;
    if ( q.d <= half && q.t > 0.05 && q.t < 0.95 && ( !best || q.d < best.d ) ) best = { run: r.id, t: q.t, d: q.d };
  }
  return best && { run: best.run, t: best.t };
}

/**
 * Point `id` let go of: on point `onto` ( or on a run: cut there for it ), joined into it. Returns the trails so,
 * and the point it's now, or null when it landed on neither.
**/
export function joinDropped( net: TrailNet, id: string, onto: string | null, on?: { run: string; t: number } | null ): { net: TrailNet; node: string } | null {
  if ( onto ) return { net: mergePoints( net, id, onto ), node: onto };
  const under = on === undefined ? runUnder( net, id ) : on;
  if ( !under ) return null;
  const n   = structuredClone( net );
  const cut = splitRun( n, under.run, under.t );
  return { net: mergePoints( n, id, cut ), node: cut };
}

/**
 * A new point on run `run` ( where `at` is on it ), joined on from point `from`: a trail laid into another.
**/
export function layInto( from: string, run: string, at: V3 ): string | null {
  const net = copy();
  const r   = net.runs.find( ( x ) => x.id === run );
  if ( !r || r.a === from || r.b === from ) return null;
  const cut  = splitRun( net, run, Math.min( 0.95, Math.max( 0.05, nearestOnRun( net, r, at[0], at[2] ).t ) ) );
  const prev = runsAt( net, from )[0];
  const nr   = newRun( net, from, cut, prev ? ( prev.a === from ? prev.wa : prev.wb ) : useEditor.getState().trailTool.width );
  nr.detail  = keepDetail( net );
  net.runs.push( nr );
  flowAt( net, from );
  follow( net, [nr.id] );
  commitTrails( net, "Join runs" );
  return cut;
}

/**
 * Points ( with their runs ) and runs taken away.
**/
export function deleteTrails( nodes: string[], runs: string[] ) {
  const net  = copy();
  const gone = new Set( nodes );
  net.runs   = net.runs.filter( ( r ) => !runs.includes( r.id ) && !gone.has( r.a ) && !gone.has( r.b ) );
  // ( points left with no run go too, unless they were all that was asked about )
  net.nodes  = net.nodes.filter( ( n ) => !gone.has( n.id ) );
  if ( !nodes.length && !runs.length ) return;
  commitTrails( net, "Delete trails" );
  const st = useEditor.getState();
  st.setSelection( st.selection.filter( ( s ) => ( s.kind !== "trailNode" || net.nodes.some( ( n ) => n.id === s.uid ) ) && ( s.kind !== "trailRun" || net.runs.some( ( r ) => r.id === s.uid ) ) ) );
}

// ---------------------------------------------------------------- saved with the map

interface SavedTrails {
  net:    TrailNet;
  ground: GroundSettings;
  field:  { x0: number; z0: number; sp: number; w: number; h: number; settings?: GroundSettings; v?: number } | null;
  // remembered ground: blocks in files ( trails/base/… ), and the ones that are one height
  blocks: string[];
  flat:   Record<string, number>;
}

const blockFile = ( dir: string, key: string ) => joinPath( dir, "trails", "base", `${key.replace( /:/g, "~" )}.f32` );

/**
 * The trails' part of project.json.
**/
export function trailEditorData(): SavedTrails | undefined {
  const net = currentNet();
  if ( !net.nodes.length ) return undefined;
  const f = currentField();
  const d = trailSaveData();
  return { net, ground: useEditor.getState().trailGround, field: f && { x0: f.x0, z0: f.z0, sp: f.sp, w: f.w, h: f.h, settings: f.settings, v: f.v }, blocks: d.all, flat: d.flat };
}

/**
 * Writes the trails' files ( the bend, and the remembered ground not written yet ).
**/
export async function saveTrailFiles( dir: string ) {
  const f = currentField();
  if ( !currentNet().nodes.length ) return;
  if ( f ) {
    await ipc.writeBinary( joinPath( dir, "trails", "field.f32"  ), new Uint8Array( f.c.buffer, f.c.byteOffset, f.c.byteLength ) );
    await ipc.writeBinary( joinPath( dir, "trails", "spread.f32" ), new Uint8Array( f.s.buffer, f.s.byteOffset, f.s.byteLength ) );
    if ( f.b ) await ipc.writeBinary( joinPath( dir, "trails", "smooth.f32" ), new Uint8Array( f.b.buffer, f.b.byteOffset, f.b.byteLength ) );
  }
  const d = trailSaveData();
  for ( const [key, a] of d.files ) await ipc.writeBinary( blockFile( dir, key ), new Uint8Array( a.buffer, a.byteOffset, a.byteLength ) );
  d.markSaved();
}

/**
 * A map opened: its trails, and what they need to change again.
**/
export async function loadTrailData( dir: string, saved: SavedTrails | undefined ) {
  if ( !saved?.net ) {
    loadTrails( emptyNet(), null, new Map() );
    useEditor.setState( { trails: emptyNet(), trailGround: NEW_GROUND } );
    return;
  }
  let field: Field | null = null;
  if ( saved.field ) {
    const c      = new Float32Array( await ipc.readBinary( joinPath( dir, "trails", "field.f32" ) ) );
    // ( no spread saved: the next change works the bend out everywhere )
    const spread = await ipc.readBinary( joinPath( dir, "trails", "spread.f32" ) ).then( ( b ) => new Float32Array( b ), () => new Float32Array( 0 ) );
    // ( and the smoothed ground under the runs, when it was made with one )
    const smooth = await ipc.readBinary( joinPath( dir, "trails", "smooth.f32" ) ).then( ( b ) => new Float32Array( b ), () => null );
    field        = { ...saved.field, c, s: spread, settings: saved.field.settings ?? saved.ground ?? NEW_GROUND, b: smooth?.length === c.length ? smooth : undefined };
  }
  const blocks = new Map<string, Float32Array | number>( Object.entries( saved.flat ?? {} ) );
  for ( const key of saved.blocks ?? [] ) blocks.set( key, new Float32Array( await ipc.readBinary( blockFile( dir, key ) ) ) );
  loadTrails( saved.net, field, blocks );
  useEditor.setState( { trails: saved.net, trailGround: saved.ground ?? NEW_GROUND } );
  // trails from before: shaped as new ones are now, with the ground settings tuned ( no longer set by hand ). One
  // change, exact as any other: the old shapes' ground taken out, the new ones' put in.
  const kind = saved.net.grow || ( saved.ground?.amount ?? 0 ) > 0 ? NEW_GROUND : REAL_GROUND;
  if ( ( saved.net.v ?? 1 ) < NET_VERSION || !sameSettings( saved.ground, kind ) ) {
    useEditor.setState( { trailGround: kind } );
    commitNet( { ...saved.net, v: NET_VERSION }, kind, "Update trails", show );
  }
}
