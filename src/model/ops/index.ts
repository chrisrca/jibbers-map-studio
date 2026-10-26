// Blender's edit-mode operators on a modelling mesh ( model/mesh.ts ): each returns the new mesh and what's selected
// after it ( as Blender leaves it: the new geometry ). Vertex indices may change: selections come back in the new
// numbering. One file per family of operators; this one gathers them.

export { type SelectMode, type Sel, emptySel, selFromFaces, selFromEdges, selFromVerts, type OpResult, linked, selectedGroups } from "./selection";
export { regionBorder, regionNormal, extrudeFaces, extrudeEdges, spin, extrudeVerts, inset } from "./extrude";
export { smoothVerts, shrinkFatten } from "./verts";
export { type KnifePoint, knifeCut, edgeLoop, edgeRing, loopCut, subdivide } from "./cut";
export { type DeleteKind, remove, type MergeKind, merge } from "./delete";
export { fill, edgeChains, bridge } from "./fill";
export { flip, duplicate, setSmooth } from "./faces";

