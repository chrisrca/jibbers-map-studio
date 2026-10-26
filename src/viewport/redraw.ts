// The view is drawn when something in it may have changed, not every frame: a still view costs nothing and holds
// its frame rate. Anything that changes what's drawn asks for a frame here ( the engine also asks on every edit,
// mouse move, key and camera move, and whenever something's put in or taken out of the scene ).

import * as THREE from "three/webgpu";

let wanted = true;

/**
 * The view is drawn again on the next frame.
**/
export function redraw() {
  wanted = true;
}

/**
 * Whether a frame was asked for since the last one drawn ( and the asking cleared ).
**/
export function takeRedraw() {
  const w = wanted;
  wanted  = false;
  return w;
}

// whatever is put in or taken out of the scene ( a piece that's finished loading, a tile built… ) shows
const add                    = THREE.Object3D.prototype.add, remove = THREE.Object3D.prototype.remove;
THREE.Object3D.prototype.add = function ( ...objects: THREE.Object3D[] ) {
  wanted = true;
  return add.apply( this, objects );
};
THREE.Object3D.prototype.remove = function ( ...objects: THREE.Object3D[] ) {
  wanted = true;
  return remove.apply( this, objects );
};
