// A rail's colliders changed by hand ( RailTweak ): kept where they are along the rail as its points change, and made
// from what the gizmo did to one ( in the 3D view ).

import * as THREE from "three/webgpu";
import { toThree, unityEulerToQuat } from "../../core/coords";
import { type Rail, type RailTweak, arr3 } from "../../core/types";
import type { P3 } from "./common";
import { type RailRun, coordsOf, railPath } from "./colliders";

// ( how many spans a rail has along it: its points', or a curve's own points' )
const spansOf = ( r: Rail ) => ( r.knots?.length === r.points.length && r.knots.length ? r.knots[r.knots.length - 1] : r.points.length - 1 );

// ( the rail's path finely, each sample with where it is along it )
function along( r: Rail ) {
  const path = railPath( r, 24 );
  return { path, at: coordsOf( r, path.length ) };
}

/**
 * Where along the rail is at `at` ( piece coordinates ).
**/
function pointAt( r: Rail, at: number ): THREE.Vector3 {
  const { path, at: c } = along( r );
  const k               = c.findIndex( ( x ) => x >= at );
  if ( k <= 0 ) return ( k < 0 ? path[path.length - 1] : path[0] ).clone();
  const f = ( at - c[k - 1] ) / Math.max( 1e-9, c[k] - c[k - 1] );
  return path[k - 1].clone().lerp( path[k], f );
}

/**
 * Where along the rail comes nearest `p` ( piece coordinates ).
**/
function nearestAt( r: Rail, p: THREE.Vector3 ): number {
  const { path, at } = along( r );
  let best = 0, d = Infinity;
  const on = new THREE.Vector3();
  for ( let k = 0; k + 1 < path.length; k++ ) {
    const seg = new THREE.Line3( path[k], path[k + 1] ), e = seg.closestPointToPoint( p, true, on ).distanceTo( p );
    if ( e < d ) {
      d    = e;
      best = at[k] + ( at[k + 1] - at[k] ) * seg.closestPointToPointParameter( p, true );
    }
  }
  return best;
}

/**
 * The tweaks the rail made from `rail` keeps ( its own, if it says, even none; else the old rail's ): with points added
 * or taken away, each moved to where the new rail runs nearest where it was; moved, they keep their places along it.
**/
export function carryTweaks( old: Rail | undefined, rail: Rail ): RailTweak[] | undefined {
  const tweaks = "tweaks" in rail ? rail.tweaks : old?.tweaks;
  if ( !tweaks?.length ) return undefined;
  if ( !old || old.points.length < 2 || rail.points.length < 2 || spansOf( old ) === spansOf( rail ) ) return tweaks;
  return tweaks.map( ( t ) => ( { ...t, at: nearestAt( rail, pointAt( old, t.at ) ) } ) );
}

/**
 * The rail's tweaks with run `run`'s set to `t` ( none: as the rail makes it ).
**/
export function withTweak( tweaks: RailTweak[] | undefined, run: RailRun, t: Omit<RailTweak, "at"> | null ): RailTweak[] | undefined {
  const rest = ( tweaks ?? [] ).filter( ( x ) => x !== run.tweak && !( x.at >= run.lo && x.at < run.hi ) );
  return t && ( t.shift || t.turn || t.size ) ? [...rest, { at: ( run.lo + run.hi ) / 2, ...t }] : rest;
}

/**
 * A collider where it is in the 3D view: its middle and its turn.
**/
export function colliderInView( c: RailRun["made"] ) {
  return { at: toThree( arr3( c.local_position ) ), q: unityEulerToQuat( arr3( c.local_rotation ) ) };
}

/**
 * The tweak that puts run `run`'s collider with its middle at `at` and turned `q` ( the 3D view ), sized `size` ( to
 * the rail's own ): in its own axes from where the rail puts it.
**/
export function tweakFrom( run: RailRun, at: THREE.Vector3, q: THREE.Quaternion, size: P3 ): Omit<RailTweak, "at"> {
  const auto  = colliderInView( run.auto );
  const back  = auto.q.clone().invert();
  // ( the view's axes are Unity's with Z flipped: so's a collider's own frame in it )
  const l     = at.clone().sub( auto.at ).applyQuaternion( back );
  const r     = back.multiply( q );
  const shift = [l.x, l.y, -l.z] as P3;
  const turn  = [-r.x, -r.y, r.z, r.w] as [number, number, number, number];
  const near  = ( v: number[], to: number[], e: number ) => v.every( ( x, i ) => Math.abs( x - to[i] ) < e );
  return {
    ...( near( shift, [0, 0, 0], 1e-5 ) ? {} : { shift } ),
    ...( near( turn, [0, 0, 0, 1], 1e-6 ) || near( turn, [0, 0, 0, -1], 1e-6 ) ? {} : { turn } ),
    ...( near( size, [1, 1, 1], 1e-5 ) ? {} : { size } ),
  };
}
