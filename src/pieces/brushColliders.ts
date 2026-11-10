// Colliders drawn on a piece with the Collider tool ( viewport/tools/colliderTool.ts ): a stroke along its surface made a
// chain of boxes or capsules, each from one point of it to the next, their tops on the surface ( as a rail's capsules
// are laid along a jib's top ), so a piece collides in whatever shape is drawn. Unity's coordinates throughout, the map's
// ( a piece's colliders are kept where they are in the map, as its parts are ).

import * as THREE from "three/webgpu";
import { arr3, xyz, type CustomCollider, type Rail, type SurfaceType } from "../core/types";
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

// Where a piece is: its place, turn ( Unity's Euler degrees ) and size.
type Placed = { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } };

// A turn as Unity's Euler degrees give it, in Unity's own frame ( Z, then X, then Y ): for its coordinates as they are
// ( coords.ts unityEulerToQuat gives three.js's, its Z mirrored )
const unityTurn = ( e: [number, number, number] ) => {
  const d = Math.PI / 180;
  return new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), e[1] * d )
    .multiply( new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), e[0] * d ) )
    .multiply( new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 0, 1 ), e[2] * d ) );
};

/**
 * A colliders-only jib's rail laid as drawn colliders of `surface` along the same line, as the Colliders tool lays a
 * solid one between two points ( a box rail's as boxes, else capsules ): what it becomes as it stops being a jib.
**/
export function railAsColliders( rail: Rail, at: Placed, surface: SurfaceType ): CustomCollider[] {
  const q     = unityTurn( arr3( at.rotation ) ), k = arr3( at.scale ), p = v3( arr3( at.position ) );
  const up    = v3( rail.up ?? [0, 1, 0] ).applyQuaternion( q ).normalize();
  const r     = Math.max( 0.01, rail.radius * Math.abs( k[0] ) );
  // ( the rail's line is the colliders' middles: the surface they'd sit on a radius under it )
  const world = ( v: [number, number, number] ) => new THREE.Vector3( v[0] * k[0], v[1] * k[1], v[2] * k[2] ).applyQuaternion( q ).add( p ).addScaledVector( up, -r );
  const pts   = rail.points.map( ( v ): StrokePoint => {
    const w = world( v );
    return { p: [w.x, w.y, w.z], n: [up.x, up.y, up.z] };
  } );
  return strokeColliders( pts, r, rail.box ? "Box" : "Capsule", surface, true );
}

/**
 * The rail through a colliders-only piece's drawn colliders, end to end ( in the piece's own coordinates ): what it
 * becomes as it's made a jib again. Null without any.
**/
export function collidersAsRail( colliders: CustomCollider[], at: Placed ): Rail | null {
  const drawn = colliders.filter( isBrushCollider );
  if ( !drawn.length ) return null;
  const turn  = unityTurn( arr3( at.rotation ) ), q = turn.clone().invert(), k = arr3( at.scale ), p = v3( arr3( at.position ) );
  // ( the way out of the surface they were laid on: the piece's up )
  const n     = new THREE.Vector3( 0, 1, 0 ).applyQuaternion( turn );
  const own   = ( w: THREE.Vector3 ): [number, number, number] => {
    const v = w.clone().sub( p ).applyQuaternion( q );
    return [v.x / ( k[0] || 1 ), v.y / ( k[1] || 1 ), v.z / ( k[2] || 1 )];
  };
  const points: [number, number, number][] = [];
  let r = 0, box = false;
  drawn.forEach( ( c, i ) => {
    const cq    = unityTurn( arr3( c.local_rotation ) );
    const along = new THREE.Vector3( 0, 1, 0 ).applyQuaternion( cq ), out = new THREE.Vector3( 0, 0, 1 ).applyQuaternion( cq );
    const rr    = c.shape === "Box" ? arr3( c.size )[0] / 2 : c.radius;
    const long  = c.shape === "Box" ? arr3( c.size )[1] : c.height - 2 * c.radius;
    // ( laid a quarter of its radius past each end: strokeColliders )
    const half  = Math.max( 0, long - rr * 0.5 ) / 2;
    // ( its middle raised square to its slope, not straight out: the rail's line a radius out along the surface's way )
    const mid   = v3( arr3( c.local_position ) ).addScaledVector( out, -rr ).addScaledVector( n, rr );
    if ( i === 0 ) points.push( own( mid.clone().addScaledVector( along, -half ) ) );
    points.push( own( mid.clone().addScaledVector( along, half ) ) );
    r   = Math.max( r, rr );
    box = box || c.shape === "Box";
  } );
  const radius = r / ( Math.abs( k[0] ) || 1 );
  return { points, radius, ...( box ? { box: [radius, radius] as [number, number] } : {} ) };
}
