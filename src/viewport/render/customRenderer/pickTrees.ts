// Picking pieces fast: each library mesh given a bounds tree ( three-mesh-bvh ) in the page's idle time once it's
// loaded, so a click tries the few triangles near the ray rather than every one of every piece it passes ( 40 ms a
// click on a busy park, more when it missed and the rings round it were tried ). A mesh without one yet is tried as
// before. Library meshes are never changed in place ( a moving piece's are copies ), so a tree stays true.

import * as THREE from "three/webgpu";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";

type Treed = THREE.BufferGeometry & { boundsTree?: unknown; computeBoundsTree: typeof computeBoundsTree; disposeBoundsTree: typeof disposeBoundsTree };

const proto                = THREE.BufferGeometry.prototype as unknown as Treed;
proto.computeBoundsTree    = computeBoundsTree;
proto.disposeBoundsTree    = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast as typeof THREE.Mesh.prototype.raycast;

// ( bigger than this, a tree would hold the page up too long in one go: left as it is )
const MOST_TRIANGLES = 300_000;

const waiting: THREE.BufferGeometry[] = [];
let asked                             = false;

const idle = ( f: () => void ) => ( "requestIdleCallback" in window ? requestIdleCallback( f, { timeout: 2000 } ) : setTimeout( f, 50 ) );

function work() {
  asked   = false;
  const t = performance.now();
  // ( a few at a time, then the page let be )
  while ( waiting.length && performance.now() - t < 6 ) {
    const g = waiting.shift() as Treed;
    if ( g.boundsTree || !g.attributes.position ) continue;
    const tris = ( g.index?.count ?? g.attributes.position.count ) / 3;
    if ( tris > MOST_TRIANGLES ) continue;
    // ( indirect: the mesh's own triangle order left as it is, its draw groups too )
    g.computeBoundsTree( { indirect: true } );
  }
  if ( waiting.length ) later();
}

function later() {
  if ( asked ) return;
  asked = true;
  idle( work );
}

/**
 * A loaded library mesh: given its bounds tree when the page is next idle.
**/
export function treeLater( g: THREE.BufferGeometry | null ) {
  if ( !g ) return;
  waiting.push( g );
  later();
}

/**
 * A mesh let go of: its tree too.
**/
export function dropTree( g: THREE.BufferGeometry | null | undefined ) {
  ( g as Treed | null | undefined )?.disposeBoundsTree?.();
}
