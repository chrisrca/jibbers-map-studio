// A real map's runs as trails: each run from the ski map shipped with the studio ( geo/skimap/skimap.ts ) laid as points about
// every 60 m on the ground, joined where runs meet, curving smoothly through its points, with its corners and sides
// set to the ground's, so it starts out on the mountain as it is.

import { LocalProjection, type LonLat } from "../geo/proj";
import { skiMap } from "../geo/skimap/skimap";
import { useEditor } from "../map/store";
import { terrain } from "../terrain/terrain";
import { commitTrails } from "./edits";
import { currentNet, REAL_GROUND } from "./ground";
import { fitToGround, nearestOnRun, newRun, splitRun, tiltToGround, trailId, type TrailNet } from "./trails";

type V3 = [number, number, number];

// metres between a run's points
const SPACING  = 60;
// a run's end this close to a point already laid joins it; any other point, this close
const JOIN_END = 30, JOIN = 12;
const WIDTH    = 25;

/**
 * A line resampled to points about `step` apart ( its ends kept ).
**/
function resample( line: [number, number][], step: number ): [number, number][] {
  let len = 0;
  for ( let k = 1; k < line.length; k++ ) len += Math.hypot( line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1] );
  const n                       = Math.max( 1, Math.round( len / step ) );
  const out: [number, number][] = [line[0]];
  let seg                       = 0, along = 0;
  for ( let q = 1; q < n; q++ ) {
    const want = ( q * len ) / n;
    while ( seg < line.length - 1 ) {
      const d = Math.hypot( line[seg + 1][0] - line[seg][0], line[seg + 1][1] - line[seg][1] );
      if ( along + d >= want ) {
        const t = d > 0 ? ( want - along ) / d : 0;
        out.push( [line[seg][0] + ( line[seg + 1][0] - line[seg][0] ) * t, line[seg][1] + ( line[seg + 1][1] - line[seg][1] ) * t] );
        break;
      }
      along += d;
      seg++;
    }
  }
  out.push( line[line.length - 1] );
  return out;
}

/**
 * Trails for lines on the ground ( Unity XZ, each a run ), added to `net`: points shared where runs meet, a run
 * already laid between two points not laid again. `ground` gives the height at a point.
**/
export function addRunsAsTrails( net: TrailNet, lines: [number, number][][], ground: ( x: number, z: number ) => number ): TrailNet {
  const out: TrailNet = structuredClone( net );
  const near          = ( x: number, z: number, r: number ) => {
    let best: string | null = null, bd = r;
    for ( const n of out.nodes ) {
      const d = Math.hypot( n.p[0] - x, n.p[2] - z );
      if ( d < bd ) { bd = d; best = n.id; }
    }
    return best;
  };
  const joined = ( a: string, b: string ) => out.runs.some( ( r ) => ( r.a === a && r.b === b ) || ( r.a === b && r.b === a ) );
  // the longest first: the main runs lay the points the others join
  const sorted = [...lines].filter( ( l ) => l.length >= 2 ).sort( ( a, b ) => lineLength( b ) - lineLength( a ) );
  for ( const line of sorted ) {
    const pts = resample( line, SPACING );
    if ( lineLength( pts ) < SPACING * 0.5 ) continue;
    const ids = pts.map( ( [x, z], k ) => {
      const end = k === 0 || k === pts.length - 1;
      const id  = near( x, z, end ? JOIN_END : JOIN );
      if ( id ) return id;
      // an end beside a run already laid ( a T ): that run cut there, and joined
      if ( end ) {
        let best: { run: string; t: number; d: number } | null = null;
        for ( const r of out.runs ) {
          const q = nearestOnRun( out, r, x, z );
          if ( q.d < JOIN_END && q.t > 0.05 && q.t < 0.95 && ( !best || q.d < best.d ) ) best = { run: r.id, ...q };
        }
        if ( best ) return splitRun( out, best.run, best.t );
      }
      const n = { id: trailId( "pt" ), p: [x, ground( x, z ), z] as V3 };
      out.nodes.push( n );
      return n.id;
    } );
    const at = ( k: number ) => out.nodes.find( ( n ) => n.id === ids[k] )!.p;
    for ( let k = 0; k < ids.length - 1; k++ ) {
      if ( ids[k] === ids[k + 1] || joined( ids[k], ids[k + 1] ) ) continue;
      const r     = newRun( out, ids[k], ids[k + 1], WIDTH );
      // ( the mountain's own relief kept on them: the real runs aren't groomed flat )
      r.detail    = 1;
      // smooth through the points ( each end's handle a third of the way, along the line through its neighbours )
      const p0    = at( Math.max( 0, k - 1 ) ), p1 = at( k ), p2 = at( k + 1 ), p3 = at( Math.min( ids.length - 1, k + 2 ) );
      const third = ( a: V3, b: V3, f: number ): V3 => [( b[0] - a[0] ) * f, ( b[1] - a[1] ) * f, ( b[2] - a[2] ) * f];
      r.ha        = k > 0 ? third( p0, p2, 1 / 6 ) : third( p1, p2, 1 / 3 );
      r.hb        = k + 2 < ids.length ? third( p3, p1, 1 / 6 ) : third( p2, p1, 1 / 3 );
      out.runs.push( r );
    }
  }
  // each new run on the ground: along it and across it
  const fresh = new Set( out.runs.filter( ( r ) => !net.runs.some( ( o ) => o.id === r.id ) ).map( ( r ) => r.id ) );
  tiltToGround( out, out.nodes.filter( ( n ) => !net.nodes.some( ( o ) => o.id === n.id ) ).map( ( n ) => n.id ), ground );
  for ( const r of out.runs ) if ( fresh.has( r.id ) ) fitToGround( out, r, ground );
  return out;
}

const lineLength = ( l: [number, number][] ) => l.reduce( ( s, p, k ) => ( k ? s + Math.hypot( p[0] - l[k - 1][0], p[1] - l[k - 1][1] ) : 0 ), 0 );

// Where a real map is on the earth ( from its import ), if it is one.
export interface RealTerrain {
  center:         LonLat;
  seaLevelOffset: number;
}

/**
 * The map's runs ( from the ski map shipped with the studio ) laid as trails, one undo step. Returns how many runs
 * were laid, or why none could be.
**/
export async function trailsFromRuns( real: RealTerrain | undefined ): Promise<number | string> {
  if ( !real?.center ) return "Not a real mountain";
  if ( !terrain.chunks.length ) return "No ground";
  const b                                     = terrain.bounds();
  const proj                                  = new LocalProjection( real.center );
  const corners                               = [proj.inverse( b.x0, b.z0 ), proj.inverse( b.x1, b.z1 ), proj.inverse( b.x0, b.z1 ), proj.inverse( b.x1, b.z0 )];
  const box: [number, number, number, number] = [Math.min( ...corners.map( ( c ) => c.lon ) ), Math.min( ...corners.map( ( c ) => c.lat ) ), Math.max( ...corners.map( ( c ) => c.lon ) ), Math.max( ...corners.map( ( c ) => c.lat ) )];
  const ski                                   = await skiMap();
  const lines: [number, number][][]           = [];
  for ( const t of ski.trails( box ) ) {
    if ( t.kind === "lift" || t.area ) continue;
    // ( the parts of it on the map's ground )
    let cur: [number, number][] = [];
    for ( const p of t.points ) {
      const [x, z] = proj.forward( p );
      if ( terrain.chunkAt( x, z ) >= 0 ) cur.push( [x, z] );
      else if ( cur.length ) { lines.push( cur ); cur = []; }
    }
    if ( cur.length ) lines.push( cur );
  }
  if ( !lines.length ) return "No runs on this map";
  const before = currentNet();
  if ( !before.nodes.length ) useEditor.setState( { trailGround: REAL_GROUND } );
  const ground = ( x: number, z: number ) => terrain.heightAt( x, z );
  const net    = addRunsAsTrails( before, lines, ground );
  const added  = net.runs.length - before.runs.length;
  if ( !added ) return "These runs are trails already";
  commitTrails( net, "Trails from runs" );
  return lines.length;
}
