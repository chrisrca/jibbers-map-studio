// Terrain shapes — the studio's version of Map-Tools' terrain inserts ( TerrainEdit.compute ): a curve run ( jumps,
// rollers, banked turns, pipes ) or a circle ( mounds, bowls, tilted pads ), described by parameters and applied to the
// heights. Everything is in metres and Unity XZ.
//
// A shape remembers what it changed ( per height sample: the value it wrote minus the value underneath ), so editing
// it takes its own change back out and applies the new one. Sculpting done over a shape afterwards is kept, and
// undo/redo are exact.

export { type EdgeMode, type CurveShape, type CircleShape, type StampShape, type StampGrid, type FormationShape, type PaintShape, type Shape, newCurve, newCircle, newStamp, newFormation, easeInOut } from "./types";
export { formationGrid, formationChunk, insideBy, peakPoint, simulates } from "./formation";
export { FORMATION_PRESETS, applyPreset, fitFormation, formationSettings, migrateFormation, type FormationSettings } from "./presets";
export { captureStamp, imprintOf } from "./stamp";
export { shapeBounds, kickerArc, lipAngleFor, kickerHeight, shapeHeightAt } from "./height";
export { bakeShapeIn, packShape, unpackShape, shapeChanges, previewShape, previewShapeSoon, settleShapes, shapesBusy, setRockLayers, whenShapesSettled, type ShapeEdit, beginShapeEdit, commitShapeEdit, removeShape, resetShapes, groundWithout } from "./apply";

