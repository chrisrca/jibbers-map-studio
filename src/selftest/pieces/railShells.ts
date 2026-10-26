import * as THREE from "three/webgpu";
import { arr3 } from "../../core/types";
import { unityEulerToQuat } from "../../core/coords";

/**
 * The most a piece's rail capsules' tops ( their Z ) lean from straight up, in degrees.
**/
export function railShellsUp( o: { colliders: { mesh_ref?: string | null; local_rotation: { x: number; y: number; z: number } }[] } ) {
  let most = 0;
  for ( const c of o.colliders ) {
    if ( c.mesh_ref !== "studio-rail" ) continue;
    const top = new THREE.Vector3( 0, 0, -1 ).applyQuaternion( unityEulerToQuat( arr3( c.local_rotation ) ) );
    most      = Math.max( most, THREE.MathUtils.radToDeg( top.angleTo( new THREE.Vector3( 0, 1, 0 ) ) ) );
  }
  return most;
}
