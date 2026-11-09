// The colliders made from a rail: short capsules along it, each its Y along the rail and its Z up ( "Per Body" ).

import * as THREE from "three/webgpu";
import { deltaBetween, transformCustom } from "../../core/transform";
import { type CustomCollider, type CustomObjectEntry, type Rail, type RailTweak, arr3, xyz } from "../../core/types";
import { type P3, PROUD, RAIL_MARK, clamp, vec } from "./common";
import { railScaled, scaleOf } from "./frame";

/**
 * The rail's curve, sampled ( piece units ): a smooth curve through its points.
**/
export function railPath( rail: Rail, perSpan = 12 ): THREE.Vector3[] {
  const pts = rail.points.map( vec );
  if ( pts.length < 3 ) return pts;
  return new THREE.CatmullRomCurve3( pts, false, "centripetal" ).getPoints( ( pts.length - 1 ) * perSpan );
}

/**
 * Where each of `n` samples of the rail's path is along it ( RailTweak's `at`: by its points, or a curve's own ).
**/
export function coordsOf( rail: Rail, n: number ): number[] {
  const m = rail.points.length;
  return Array.from( { length: n }, ( _, k ) => {
    const u = n > 1 && m > 1 ? ( k * ( m - 1 ) ) / ( n - 1 ) : 0;
    if ( rail.knots?.length !== m || m < 2 ) return u;
    const i = Math.min( m - 2, Math.floor( u ) );
    return rail.knots[i] + ( rail.knots[i + 1] - rail.knots[i] ) * ( u - i );
  } );
}

/**
 * Short straight runs along the path ( the indices of their ends ): none longer than `maxLen`, none bending more than
 * ~6° within. A run at either end shorter than `minEnd` joins its neighbour ( its end gets rounded off: it would be
 * left with no length ).
**/
function runs( path: THREE.Vector3[], maxLen: number, minEnd: number ): [number, number][] {
  const pts = path.flatMap( ( p, i ) => ( i === 0 || p.distanceTo( path[i - 1] ) > 1e-6 ? [i] : [] ) );
  const out: [number, number][] = [];
  let start = 0;
  for ( let i = 1; i < pts.length; i++ ) {
    const first = path[pts[start + 1]].clone().sub( path[pts[start]] ).normalize();
    const here  = path[pts[i]].clone().sub( path[pts[i - 1]] ).normalize();
    if ( i === pts.length - 1 || path[pts[i]].distanceTo( path[pts[start]] ) >= maxLen || first.angleTo( here ) > 0.1 ) {
      out.push( [pts[start], pts[i]] );
      start = i;
    }
  }
  const len = ( r: [number, number] ) => path[r[0]].distanceTo( path[r[1]] );
  if ( out.length > 1 && len( out[out.length - 1] ) < minEnd ) out.splice( -2, 2, [out[out.length - 2][0], out[out.length - 1][1]] );
  if ( out.length > 1 && len( out[0] ) < minEnd ) out.splice( 0, 2, [out[0][0], out[1][1]] );
  return out;
}

/**
 * Which tweak each run gets ( `spans`: where along the rail each runs ): the one within it, nearest its middle if
 * more are ( points taken away can bring two together ).
**/
function tweaksFor( spans: [number, number][], tweaks: RailTweak[] ): ( RailTweak | null )[] {
  const got: ( RailTweak | null )[] = spans.map( () => null );
  if ( !spans.length ) return got;
  for ( const t of tweaks ) {
    const found = spans.findIndex( ( [, hi] ) => t.at < hi );
    const i     = found < 0 ? spans.length - 1 : found;
    const mid   = ( spans[i][0] + spans[i][1] ) / 2, was = got[i];
    if ( !was || Math.abs( t.at - mid ) < Math.abs( was.at - mid ) ) got[i] = t;
  }
  return got;
}

// The shortest straight part a capsule gets ( the game's physics needs it longer than nothing ).
const MIN_LENGTH = 0.01;

/**
 * Unity's Euler angles ( degrees: Z, then X, then Y ) of the rotation whose axes are x, y, z.
**/
export function unityEuler( x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3 ): P3 {
  const deg = THREE.MathUtils.RAD2DEG;
  if ( Math.abs( z.y ) > 0.99999 ) {
    // straight up or down: Y and Z turn about the same axis then, so Z = 0
    return [z.y < 0 ? 90 : -90, Math.atan2( z.y < 0 ? y.x : -y.x, x.x ) * deg, 0];
  }
  return [Math.asin( -z.y ) * deg, Math.atan2( z.x, z.z ) * deg, Math.atan2( x.y, y.y ) * deg];
}

// One collider along a rail: where along the rail it runs ( `lo` to `hi`, as RailTweak's `at` ), as the rail makes it
// ( `auto` ) and as it is ( `made`: its tweak, if any, applied ), both placed where the piece is.
export type RailRun = { lo: number; hi: number; auto: CustomCollider; made: CustomCollider; tweak: RailTweak | null };

/**
 * The capsules along a rail ( boxes, for a box rail ), placed where the piece is now.
**/
export function railColliders( o: CustomObjectEntry, rail: Rail ): CustomCollider[] {
  return railRuns( o, rail ).map( ( r ) => r.made );
}

/**
 * The rail's colliders, each with where along the rail it runs and as the rail makes it. Made in its own axes at the
 * size it is ( railScaled: a scaled piece's rail keeps to its top, as thick as it was ), then turned and moved with
 * it: made at its own size and scaled with it, they came out stretched, a box one skewed, on a piece scaled more one
 * way. A tweak moves, turns and sizes its collider in the collider's own axes.
**/
export function railRuns( o: CustomObjectEntry, rail: Rail ): RailRun[] {
  const s    = scaleOf( o );
  const path = railPath( rail ).map( ( p ) => railScaled( s, rail, [p.x, p.y, p.z] ) );
  if ( path.length < 2 ) return [];
  const at     = coordsOf( rail, path.length );
  const R      = rail.radius + PROUD;
  const box    = rail.box ? ( [rail.box[0] + PROUD, rail.box[1] + PROUD] as const ) : null;
  const all    = runs( path, clamp( rail.radius * 6, 0.2, 1 ), box ? MIN_LENGTH : 2 * R + MIN_LENGTH );
  const spans  = all.map( ( [i, j] ) => [at[i], at[j]] as [number, number] );
  const tweaks = tweaksFor( spans, rail.tweaks ?? [] );
  const up0    = vec( rail.up ?? [0, 1, 0] );
  const want   = new THREE.Vector3( up0.x * s.x, up0.y * s.y, up0.z * s.z ).normalize();
  const made   = all.map( ( [i0, j0], i ) => {
    const a0     = path[i0], b0 = path[j0];
    const along  = b0.clone().sub( a0 ).normalize();
    // a capsule's round ends reach past its ends: the rail's two end capsules are pulled in, as far as they have
    // room, so it stops where it does ( the ones between overlap their neighbours, so the joins are smooth ); a box
    // stops at its ends: the ones between reach on into their neighbours instead
    const room   = Math.max( 0, a0.distanceTo( b0 ) - MIN_LENGTH ) / ( all.length === 1 ? 2 : 1 );
    const over   = box ? Math.max( box[0], box[1] ) : 0;
    const a      = i === 0 ? a0.clone().addScaledVector( along, box ? 0 : Math.min( R, room ) ) : a0.clone().addScaledVector( along, -over );
    const b      = i === all.length - 1 ? b0.clone().addScaledVector( along, box ? 0 : -Math.min( R, room ) ) : b0.clone().addScaledVector( along, over );
    const length = Math.max( MIN_LENGTH, a.distanceTo( b ) );
    // its Z up ( as close to the rail's way up as its direction allows ), its Y along the rail
    const up     = want.clone().addScaledVector( along, -want.dot( along ) );
    if ( up.lengthSq() < 1e-6 ) up.set( 0, 1, 0 ).addScaledVector( along, -along.y );
    if ( up.lengthSq() < 1e-6 ) up.set( 0, 0, 1 ).addScaledVector( along, -along.z );
    up.normalize();
    const x    = new THREE.Vector3().crossVectors( along, up ).normalize();
    const mid  = a.clone().add( b ).multiplyScalar( 0.5 );
    const make = ( t: RailTweak | null ): CustomCollider => {
      // ( a tweak's in the collider's own axes )
      const own   = ( v: THREE.Vector3 ) => x.clone().multiplyScalar( v.x ).addScaledVector( along, v.y ).addScaledVector( up, v.z );
      const q     = t?.turn ? new THREE.Quaternion( ...t.turn ).normalize() : new THREE.Quaternion();
      const axis  = ( v: THREE.Vector3 ) => own( v.applyQuaternion( q ) ).normalize();
      const c     = t?.shift ? mid.clone().add( own( vec( t.shift ) ) ) : mid;
      const k     = t?.size ?? [1, 1, 1];
      const turn  = unityEuler( axis( new THREE.Vector3( 1, 0, 0 ) ), axis( new THREE.Vector3( 0, 1, 0 ) ), axis( new THREE.Vector3( 0, 0, 1 ) ) );
      const place = { local_position: xyz( [c.x, c.y, c.z] ), local_rotation: xyz( turn ), local_scale: xyz( [1, 1, 1] ), center: xyz( [0, 0, 0] ) };
      const long  = Math.max( MIN_LENGTH, length * k[1] );
      if ( box ) return { shape: "Box", surface_type: "Jib", ...place, size: xyz( [2 * box[0] * k[0], long, 2 * box[1] * k[2]] ), radius: 0.5, height: 1, direction: 1, mesh_ref: RAIL_MARK };
      const r = R * Math.max( k[0], k[2] );
      return { shape: "Capsule", surface_type: "Jib", ...place, size: xyz( [0, 0, 0] ), radius: r, height: long + 2 * r, direction: 1, mesh_ref: RAIL_MARK };
    };
    return { auto: make( null ), made: make( tweaks[i] ) };
  } );
  // ( at its size already: turned and moved with the piece, not scaled again )
  const sized = { ...o, scale: xyz( [1, 1, 1] ) };
  const auto  = placeWith( sized, made.map( ( m ) => m.auto ) ), done = placeWith( sized, made.map( ( m ) => m.made ) );
  return made.map( ( _, i ) => ( { lo: spans[i][0], hi: spans[i][1], auto: auto[i], made: done[i], tweak: tweaks[i] } ) );
}

/**
 * Colliders made in the piece's own coordinates, moved, turned and scaled to where the piece is.
**/
export function placeWith( o: CustomObjectEntry, local: CustomCollider[] ): CustomCollider[] {
  if ( !local.length ) return [];
  const atOrigin = { ...o, position: xyz( [0, 0, 0] ), rotation: xyz( [0, 0, 0] ), scale: xyz( [1, 1, 1] ), parts: [], lights: [], colliders: local };
  delete ( atOrigin as { rail?: Rail } ).rail;
  const to = { pos: arr3( o.position ), rot: arr3( o.rotation ), scl: arr3( o.scale ) };
  return transformCustom( atOrigin, deltaBetween( { pos: [0, 0, 0], rot: [0, 0, 0], scl: [1, 1, 1] }, to ) ).colliders;
}
