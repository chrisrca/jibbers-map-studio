// A modelled piece made ready to draw and to export: its modifiers applied ( Blender's Mirror, Array, Solidify,
// Bevel, Subdivision Surface ), its faces cut into triangles, normals ( flat, or smooth up to an angle ) and texture
// coordinates ( a box projection in metres, so a material's texture keeps its size ), one submesh per material slot;
// and the colliders the game rides on.

import type { CurveData } from "../curve";
import type { Mesh, V3 } from "../mesh";

export { joinMeshes, weld, evaluate } from "./modifiers";
export { triangulateFace, type Built, boxUv, buildMesh, packBuilt } from "./triangles";
export { type ModelCollider, modelColliders } from "./colliders";

export type Modifier =
  | { type: "mirror";   on: boolean; axes:      [boolean, boolean, boolean]; merge: number }
  | { type: "array";    on: boolean; count:     number; relative: V3; constant: V3; merge: boolean }
  | { type: "solidify"; on: boolean; thickness: number }
  | { type: "bevel";    on: boolean; width:     number; segments: number; angle: number }
  | { type: "subsurf";  on: boolean; levels:    number };

export type ModifierType = Modifier["type"];

export const MODIFIERS: { type: ModifierType; label: string; make: () => Modifier }[] = [
  { type: "mirror",   label: "Mirror",              make: () => ( { type: "mirror",   on: true, axes:      [true, false, false], merge: 0.001 } ) },
  { type: "array",    label: "Array",               make: () => ( { type: "array",    on: true, count:     2, relative: [1, 0, 0], constant: [0, 0, 0], merge: false } ) },
  { type: "solidify", label: "Solidify",            make: () => ( { type: "solidify", on: true, thickness: 0.05 } ) },
  { type: "bevel",    label: "Bevel",               make: () => ( { type: "bevel",    on: true, width:     0.05, segments: 2, angle: 30 } ) },
  { type: "subsurf",  label: "Subdivision Surface", make: () => ( { type: "subsurf",  on: true, levels:    1 } ) },
];

// A modelled piece's own data ( on its custom object; studio only ).
export interface ModelData {
  mesh:        Mesh;
  modifiers:   Modifier[];
  // smooth faces stay sharp across edges sharper than this ( degrees )
  smoothAngle: number;
  // how the game rides it: fitted colliders, or none
  colliders:   "auto" | "none";
  // painted ( texture/meshPaint.ts ): the texture's size, its layout ( which faces it's for, the UVs of their corners )
  paint?:      { size: number; sig: string; topo?: string; uv?: number[] };
  // a curve ( model/curve.ts ): its splines swept into tubes, along with `mesh` ( a rail and its legs, joined to
  // plates )
  curve?:      CurveData;
  // levels of detail: how many below the full one, and how much of the one before each keeps ( model/simplify.ts )
  lods?:       { levels: number; keep: number; crossFade?: boolean };
}

export const newModel = ( mesh: Mesh ): ModelData => ( { mesh, modifiers: [], smoothAngle: 30, colliders: "auto" } );
