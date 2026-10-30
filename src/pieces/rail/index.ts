// Grind rails: a curve along a jib piece that the game grinds exactly.
//
// The game grabs a rider onto a jib by the piece's colliders and its "Intended up" setting ( viewport/tools/grindGuide.ts ).
// One collider over a whole piece can only say "the rail runs along your X" ( or Z ): fine for a straight rail through
// the middle of the piece, wrong for anything curved or off-centre — on a C-shaped rail riders ground the air in
// front of it. A rail here is a curve through control points in the piece's own coordinates ( so it moves, turns and
// scales with the piece ), made into a chain of short capsules along it, each with its local Y along the rail and its
// Z up: "Per Body ( Z up, Y forward )", how the game builds its own curved rails. The capsules sit a little proud of the
// rail so a rider meets them first.
//
// The piece's own collider is set aside while it has a rail ( kept in the rail, given back if the rail goes ): the game
// makes a mesh collider its convex hull — shrink-wrapped, so a C or a spiral becomes a solid slab filling the curve,
// the "air" riders were grinding on, and a fence an invisible wall between its posts ( Player.log: "Couldn't create a
// Convex Mesh … The partial hull will be used" ). Instead ( "Mesh collidable", on unless switched off ) each visible
// part of the piece — a post, a pole, a board, a panel; the rail's own tube left to the rail — gets a plain solid
// collider fitted to it: a capsule for something long and round, a box otherwise, a chain of boxes for something
// curved. How the game builds its own features: a cylinder for each post.
//
// Every capsule needs some length: the game's physics ( MuJoCo ) refuses a capsule whose straight part is zero long and
// then builds no physics at all — riders spawn under the map ( Player.log: "size 1 must be positive in geom" ).

import * as THREE from "three/webgpu";
import { toThree, unityEulerToQuat } from "../../core/coords";
import { type CustomCollider, type CustomObjectEntry, type Rail, arr3, xyz } from "../../core/types";
import { placeWith, railColliders } from "./colliders";
import { type P3, PER_BODY_Z_UP, PROUD, isRailCollider, isStudioCollider, vec } from "./common";
import { keepClear } from "./fit";
import { toPiece } from "./frame";
import { simplify } from "./shape";

export { RAIL_MARK, type P3, PART_MARK, isRailCollider, isStudioCollider } from "./common";
export { toView, toPiece, dirToView, dirToPiece } from "./frame";
export { surfacePoints, autoRail, straightRail } from "./shape";
export { railPath, unityEuler, railColliders } from "./colliders";
export { keepClear, fitParts } from "./fit";

/**
 * The piece's own colliders: set aside in its rail, or still among its colliders ( no rail yet — or a rail from before
 * they were set aside, which kept them there made plain solid: back to the piece's surface ).
**/
const ownColliders = ( o: CustomObjectEntry ): CustomCollider[] =>
  o.rail?.body ?? o.colliders.filter( ( c ) => !isStudioCollider( c ) ).map( ( c ) => ( o.rail ? { ...c, surface_type: o.surface_type } : c ) );

/**
 * The piece with `rail` and the colliders made from it: the rail's capsules, and ( if `solid`, "Mesh collidable", on by
 * default ) the colliders fitted to its visible parts ( `rail.parts`, see fitParts ), kept out of the top of the rail
 * wherever it is now ( keepClear; until they're fitted, its own collider made plain solid ). Its own colliders are kept
 * in the rail for when it goes.
**/
export function withRail( o: CustomObjectEntry, rail: Rail ): CustomObjectEntry {
  const own     = ownColliders( o );
  const solid   = rail.solid ?? o.rail?.solid ?? true;
  const parts   = rail.parts ?? o.rail?.parts;
  const whole   = rail.whole ?? o.rail?.whole ?? false;
  const r: Rail = {
    points:     rail.points,
    radius:     rail.radius,
    ...( rail.box ? { box: rail.box } : {} ),
    ...( rail.up ? { up: rail.up } : {} ),
    prevMethod: o.rail?.prevMethod ?? rail.prevMethod ?? o.intended_up_method,
    solid,
    ...( parts ? { parts } : {} ),
    ...( whole ? { whole } : {} ),
    ...( own.length ? { body: own } : {} ),
  };
  const body = !solid ? [] : parts && !whole ? placeWith( o, keepClear( parts, r ) ) : own.map( ( c ) => ( { ...c, surface_type: "Generic" as const } ) );
  return { ...o, rail: r, intended_up_method: PER_BODY_Z_UP, colliders: [...body, ...railColliders( o, r )] };
}

/**
 * The piece as it was before its rail: its own colliders back ( grinding again ), its setting back.
**/
export function withoutRail( o: CustomObjectEntry ): CustomObjectEntry {
  const { rail, ...rest } = o;
  return {
    ...rest,
    intended_up_method: rail?.prevMethod ?? o.intended_up_method,
    colliders:          ownColliders( o ).map( ( c ) => ( { ...c, surface_type: o.surface_type } ) ),
  };
}

/**
 * A piece whose rail was lost — saving used to drop it, keeping only its capsules and losing the collider it had set
 * aside — with its rail rebuilt from the capsules ( edits and all ) and its own collider back, one per part ( what
 * library pieces come with ). Null when there's nothing to recover.
**/
export function recoverRail( o: CustomObjectEntry ): CustomObjectEntry | null {
  const caps = o.colliders.filter( isRailCollider );
  if ( o.rail || !caps.length ) return null;
  const ends: P3[] = [];
  caps.forEach( ( c, i ) => {
    const s        = Math.abs( c.local_scale.y ) || 1;
    const centre   = toThree( arr3( c.local_position ) );
    const axis     = new THREE.Vector3( 0, 1, 0 ).applyQuaternion( unityEulerToQuat( arr3( c.local_rotation ) ) );
    const straight = Math.max( 0, c.height / 2 - c.radius ) * s;
    // the first and last capsules' round tips reach the rail's ends ( see railColliders )
    const a        = centre.clone().addScaledVector( axis, -( straight + ( i === 0 ? c.radius * s : 0 ) )         );
    const b        = centre.clone().addScaledVector( axis, straight + ( i === caps.length - 1 ? c.radius * s : 0 ) );
    if ( i === 0 ) ends.push( toPiece( o, a ) );
    ends.push( toPiece( o, b ) );
  } );
  const length                 = ends.slice( 1 ).reduce( ( d, p, i ) => d + vec( p ).distanceTo( vec( ends[i] ) ), 0 );
  const own                    = o.colliders.filter( ( c ) => !isStudioCollider( c ) );
  const body: CustomCollider[] = own.length
    ? own
    : o.parts
        .filter( ( p ) => p.lod_index <= 0 && p.mesh )
        .map( ( p ) => ( {
          shape:       "Mesh", surface_type: o.surface_type, local_position: p.local_position, local_rotation: p.local_rotation,
          local_scale: xyz( [Math.abs( p.local_scale.x ), Math.abs( p.local_scale.y ), Math.abs( p.local_scale.z )] ),
          center:      xyz( [0, 0, 0] ), size: xyz( [1, 1, 1] ), radius: 0.5, height: 1, direction: 1, mesh_ref: p.mesh,
        } ) );
  const radius = Math.max( 0.005, caps[0].radius - PROUD );
  return withRail( { ...o, colliders: [...body, ...caps] }, { points: simplify( ends, Math.max( 0.01, length * 0.01 ) ), radius } );
}

/**
 * Where a new point goes in a rail: between the two points it's nearest the line between, or past an end.
**/
export function insertAt( points: P3[], p: P3 ): number {
  if ( points.length < 2 ) return points.length;
  const at = vec( p );
  const on = new THREE.Vector3();
  let best = points.length, dist = vec( points[points.length - 1] ).distanceTo( at );
  if ( vec( points[0] ).distanceTo( at ) < dist ) { best = 0; dist = vec( points[0] ).distanceTo( at ); }
  for ( let i = 0; i + 1 < points.length; i++ ) {
    const d = new THREE.Line3( vec( points[i] ), vec( points[i + 1] ) ).closestPointToPoint( at, true, on ).distanceTo( at );
    if ( d < dist - 1e-9 ) { best = i + 1; dist = d; }
  }
  return best;
}
