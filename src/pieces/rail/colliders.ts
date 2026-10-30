// The colliders made from a rail: short capsules along it, each its Y along the rail and its Z up ( "Per Body" ).

import * as THREE from "three/webgpu";
import { deltaBetween, transformCustom } from "../../core/transform";
import { type CustomCollider, type CustomObjectEntry, type Rail, arr3, xyz } from "../../core/types";
import { type P3, PROUD, RAIL_MARK, clamp, vec } from "./common";

/**
 * The rail's curve, sampled ( piece units ): a smooth curve through its points.
**/
export function railPath( rail: Rail, perSpan = 12 ): THREE.Vector3[] {
  const pts = rail.points.map( vec );
  if ( pts.length < 3 ) return pts;
  return new THREE.CatmullRomCurve3( pts, false, "centripetal" ).getPoints( ( pts.length - 1 ) * perSpan );
}

/**
 * Short straight runs along the path: none longer than `maxLen`, none bending more than ~6° within. A run at either
 * end shorter than `minEnd` joins its neighbour ( its end gets rounded off: it would be left with no length ).
**/
function runs( path: THREE.Vector3[], maxLen: number, minEnd: number ): [THREE.Vector3, THREE.Vector3][] {
  const pts = path.filter( ( p, i ) => i === 0 || p.distanceTo( path[i - 1] ) > 1e-6 );
  const out: [THREE.Vector3, THREE.Vector3][] = [];
  let start = 0;
  for ( let i = 1; i < pts.length; i++ ) {
    const first = pts[start + 1].clone().sub( pts[start] ).normalize();
    const here  = pts[i].clone().sub( pts[i - 1] ).normalize();
    if ( i === pts.length - 1 || pts[i].distanceTo( pts[start] ) >= maxLen || first.angleTo( here ) > 0.1 ) {
      out.push( [pts[start], pts[i]] );
      start = i;
    }
  }
  const len = ( r: [THREE.Vector3, THREE.Vector3] ) => r[0].distanceTo( r[1] );
  if ( out.length > 1 && len( out[out.length - 1] ) < minEnd ) out.splice( -2, 2, [out[out.length - 2][0], out[out.length - 1][1]] );
  if ( out.length > 1 && len( out[0] ) < minEnd ) out.splice( 0, 2, [out[0][0], out[1][1]] );
  return out;
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

/**
 * The capsules along a rail ( boxes, for a box rail ), placed where the piece is now.
**/
export function railColliders( o: CustomObjectEntry, rail: Rail ): CustomCollider[] {
  const path = railPath( rail );
  if ( path.length < 2 ) return [];
  const R                      = rail.radius + PROUD;
  const box                    = rail.box ? ( [rail.box[0] + PROUD, rail.box[1] + PROUD] as const ) : null;
  const all                    = runs( path, clamp( rail.radius * 6, 0.2, 1 ), box ? MIN_LENGTH : 2 * R + MIN_LENGTH );
  const want                   = vec( rail.up ?? [0, 1, 0] ).normalize();
  const caps: CustomCollider[] = all.map( ( [a0, b0], i ) => {
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
    const x     = new THREE.Vector3().crossVectors( along, up ).normalize();
    const mid   = a.clone().add( b ).multiplyScalar( 0.5 );
    const place = { local_position: xyz( [mid.x, mid.y, mid.z] ), local_rotation: xyz( unityEuler( x, along, up ) ), local_scale: xyz( [1, 1, 1] ), center: xyz( [0, 0, 0] ) };
    if ( box ) return { shape: "Box", surface_type: "Jib", ...place, size: xyz( [2 * box[0], length, 2 * box[1]] ), radius: 0.5, height: 1, direction: 1, mesh_ref: RAIL_MARK };
    return { shape: "Capsule", surface_type: "Jib", ...place, size: xyz( [0, 0, 0] ), radius: R, height: length + 2 * R, direction: 1, mesh_ref: RAIL_MARK };
  } );
  return placeWith( o, caps );
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
