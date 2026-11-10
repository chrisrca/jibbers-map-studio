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

// How many times what's drawn may have changed, more than the view of it ( an edit, a brush, something moving ): the
// sun's shadows are drawn again when it has, not as the camera alone moves
export let contentEdits = 0;

/**
 * What's drawn changed ( and is drawn again on the next frame ).
**/
export function contentChanged() {
  wanted = true;
  contentEdits++;
}

// How many times anything's been put in or taken out of a scene ( what keeps its matrices up itself, rather than
// every frame, works them out again when this has moved on: customRenderer's pieces ).
export let sceneEdits = 0;

// whatever is put in or taken out of the scene ( a piece that's finished loading, a tile built… ) shows
const add                    = THREE.Object3D.prototype.add, remove = THREE.Object3D.prototype.remove;
// ( nothing put in or taken out, nothing changed: a tool clearing its empty group on every change to the map, as a
// piece is dragged, had every piece's matrices worked out again each step )
THREE.Object3D.prototype.add = function ( ...objects: THREE.Object3D[] ) {
  if ( objects.length ) {
    wanted = true;
    sceneEdits++;
  }
  return add.apply( this, objects );
};
THREE.Object3D.prototype.remove = function ( ...objects: THREE.Object3D[] ) {
  if ( objects.length ) {
    wanted = true;
    sceneEdits++;
  }
  return remove.apply( this, objects );
};
