// Colliders drawn on a piece with the Collider tool ( viewport/tools/colliderTool.ts ): a stroke along its surface made a
// chain of boxes or capsules, each from one point of it to the next, their tops on the surface ( as a rail's capsules
// are laid along a jib's top ), so a piece collides in whatever shape is drawn. Unity's coordinates throughout, the map's
// ( a piece's colliders are kept where they are in the map, as its parts are ).

import * as THREE from "three/webgpu";
import { arr3, xyz, type CustomCollider, type SurfaceType } from "../core/types";
import { unityEuler } from "./rail/colliders";

// What drawn colliders carry as their mesh_ref ( a box or a capsule has no mesh ): told apart from the piece's own, and
// kept when a modelled piece's are made again from its shape.
export const BRUSH_MARK = "studio-brush";

export const isBrushCollider = ( c: CustomCollider ) => c.mesh_ref === BRUSH_MARK;

export type BrushShape = "Box" | "Capsule";

// A point of a stroke: where on the surface ( Unity ), and the surface's way out there.
export interface StrokePoint { p: [number, number, number]; n: [number, number, number] }

const v3 = ( a: [number, number, number] ) => new THREE.Vector3( a[0], a[1], a[2] );

/**
 * How far apart a stroke's points are kept for a brush `radius` across: a collider each that long.
**/
export const strokeSpacing = ( radius: number ) => Math.max( 0.05, radius * 1.5 );

/**
 * A stroke's colliders: one from each point to the next ( `radius` its half width and half height, its top on the
 * surface; `onTop`, its bottom: a collider of its own on the ground ), or, a single point, one there as wide as long.
 * Each overlaps the next a little, so the joins are smooth.
**/
export function strokeColliders( pts: StrokePoint[], radius: number, shape: BrushShape, surface: SurfaceType, onTop = false ): CustomCollider[] {
  if ( !pts.length ) return [];
  const r = Math.max( 0.01, radius );
  if ( pts.length === 1 ) return [segment( pts[0], pts[0], r, shape, surface, onTop )];
  const out: CustomCollider[] = [];
  for ( let i = 0; i + 1 < pts.length; i++ ) out.push( segment( pts[i], pts[i + 1], r, shape, surface, onTop ) );
  return out;
}

/**
 * One collider from `a` to `b`: its Y along the way between them, its Z the surfaces' way out ( square to it ), sunk
 * by its half height so its top's on the surface ( `onTop`: raised by it, sitting on it ).
**/
function segment( a: StrokePoint, b: StrokePoint, r: number, shape: BrushShape, surface: SurfaceType, onTop = false ): CustomCollider {
  const pa    = v3( a.p ), pb = v3( b.p );
  let along   = pb.clone().sub( pa );
  const len   = along.length();
  const n     = v3( a.n ).add( v3( b.n ) ).normalize();
  if ( n.lengthSq() < 1e-6 ) n.set( 0, 1, 0 );
  // ( a single point: along whatever's square to the way out )
  if ( len < 1e-6 ) along = Math.abs( n.y ) < 0.9 ? new THREE.Vector3( 0, 1, 0 ).cross( n ) : new THREE.Vector3( 1, 0, 0 ).cross( n );
  along.normalize();
  const up = n.clone().addScaledVector( along, -n.dot( along ) );
  if ( up.lengthSq() < 1e-6 ) up.set( 0, 1, 0 ).addScaledVector( along, -along.y );
  up.normalize();
  const x    = new THREE.Vector3().crossVectors( along, up ).normalize();
  const mid  = pa.clone().add( pb ).multiplyScalar( 0.5 ).addScaledVector( up, onTop ? r : -r );
  // ( a little past each end, into its neighbours: no gap at a bend )
  const long = Math.max( 2 * r, len + r * 0.5 );
  const place = { local_position: xyz( [mid.x, mid.y, mid.z] ), local_rotation: xyz( unityEuler( x, along, up ) ), local_scale: xyz( [1, 1, 1] ), center: xyz( [0, 0, 0] ) };
  if ( shape === "Box" ) return { shape: "Box", surface_type: surface, ...place, size: xyz( [2 * r, long, 2 * r] ), radius: 0.5, height: 1, direction: 1, mesh_ref: BRUSH_MARK };
  return { shape: "Capsule", surface_type: surface, ...place, size: xyz( [0, 0, 0] ), radius: r, height: long + 2 * r, direction: 1, mesh_ref: BRUSH_MARK };
}

/**
 * The colliders with the drawn ones whose middle is within `radius` of `at` ( Unity ) taken out ( the brush's other
 * way, erasing ). Only drawn ones: the piece's own, and a rail's, aren't the brush's to take.
**/
export function eraseNear( colliders: CustomCollider[], at: [number, number, number], radius: number ): CustomCollider[] {
  const p = v3( at );
  return colliders.filter( ( c ) => !isBrushCollider( c ) || v3( arr3( c.local_position ) ).distanceTo( p ) > radius + colliderReach( c ) * 0.5 );
}

/**
 * About how far a collider reaches from its middle.
**/
function colliderReach( c: CustomCollider ) {
  const s = arr3( c.local_scale );
  if ( c.shape === "Box" ) return 0.5 * Math.hypot( c.size.x * s[0], c.size.y * s[1], c.size.z * s[2] );
  return Math.max( c.radius, c.height / 2 ) * Math.max( ...s.map( Math.abs ) );
}
