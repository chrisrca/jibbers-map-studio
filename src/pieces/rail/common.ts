// What a rail's parts share: the marks its colliders carry, and small helpers.

import * as THREE from "three/webgpu";
import type { CustomCollider } from "../../core/types";

// The generated capsules' mesh_ref ( capsules have no mesh ): how they're told apart from the piece's own colliders.
export const RAIL_MARK = "studio-rail";

// capsules this much proud of the rail ( piece units )
export const PROUD = 0.012;

// "Per Body ( Z up, Y forward )"
export const PER_BODY_Z_UP = 4;

export type P3 = [number, number, number];

export const vec = ( p: P3 ) => new THREE.Vector3( p[0], p[1], p[2] );

export const clamp = ( x: number, a: number, b: number ) => Math.min( b, Math.max( a, x ) );

export const median = ( xs: number[] ) => [...xs].sort( ( a, b ) => a - b )[xs.length >> 1];

// The fitted colliders' mesh_ref ( see fitParts ).
export const PART_MARK = "studio-part";

export const isRailCollider = ( c: CustomCollider ) => c.mesh_ref === RAIL_MARK;

/**
 * Colliders the studio makes ( rail capsules, fitted parts ), as opposed to the piece's own.
**/
export const isStudioCollider = ( c: CustomCollider ) => c.mesh_ref === RAIL_MARK || c.mesh_ref === PART_MARK;
