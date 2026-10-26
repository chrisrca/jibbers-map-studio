// The sculpt brushes: what each one is, and every setting a brush ( or all brushes ) can have.
//
// Brushes and their options are modelled on the good terrain/sculpt tools out there:
//  - Blender sculpt mode: Draw, Layer, Clay/Clay Strips, Smooth/Enhance, Flatten/Fill/Scrape, Crease, Pinch/Magnify,
//    Nudge ( our Smudge ), Mask; falloff presets, hardness, tip roundness, stroke methods ( Space, Airbrush, Line,
//    Anchored, Drag Dot ), Stabilize Stroke, jitter, symmetry, F / Shift+F resizing.
//  - Unity Terrain Tools: Terrace, Noise, Slope Flatten, Smudge, Pinch, brush rotation/jitter/scatter, brush mask
//    filters ( height, slope, concavity ).
//  - Unreal Landscape: Flatten modes ( both/raise/lower ), slope flatten, pick value per apply, exact target height.
//  - Godot Terrain3D ( MIT ): lift floors / flatten peaks, gamma-shaped falloff, Ctrl inverts, Shift smooths.
// Everything here is our own implementation of those behaviours.

import type { Curve } from "../core/curve";
import type { IconName } from "../ui/widgets/icons";

export type BrushId = "draw" | "layer" | "clay" | "smooth" | "flatten" | "terrace" | "noise" | "crease" | "pinch" | "smudge" | "mask";

export type FalloffPreset = "smooth" | "smoother" | "sphere" | "root"     | "sharp" | "linear" | "sharper" | "constant" | "custom";
export type StrokeMethod  = "space"  | "airbrush" | "line"   | "anchored" | "dragdot";
export type AlphaId       = "none"   | "crater"   | "rocks"  | "ridges"   | "dunes" | "peaks" | "cliffs" | "mogul";

export interface BrushSettings {
  // 0..1
  strength:       number;
  // the brush's direction flipped ( Ctrl flips it while held )
  invert:         boolean;
  falloff:        FalloffPreset;
  // fraction of the radius at full strength before the falloff starts
  hardness:       number;
  // custom falloff, t = 0 centre … 1 edge
  curve:          Curve;
  // 1 = round, 0 = square ( Blender's tip roundness / Clay Strips )
  roundness:      number;
  alpha:          AlphaId;
  // degrees
  rotation:       number;
  // the tip turns to the direction of the stroke
  rotationFollow: boolean;
  // 0..1 of a full turn, random per dab
  rotationJitter: number;
  stroke:         StrokeMethod;
  // between dabs, as a fraction of the radius
  spacing:        number;
  // airbrush dabs per second while held still
  rate:           number;
  // random offset of each dab, fraction of the radius
  jitter:         number;
  sizeJitter:     number;
  strengthJitter: number;

  // ---- per brush
  // Layer: metres above ( or below ) the ground as it was when the stroke started
  layerHeight:      number;
  // Clay: metres the clay plane sits above the ground under the brush
  clayHeight:       number;
  // Flatten: what it flattens to
  flattenTarget:    "start" | "follow" | "exact";
  // Flatten: both ways, only fill hollows ( Fill ), or only cut bumps ( Scrape )
  flattenDir:       "both" | "raise" | "lower";
  // Flatten: keep the slope of the ground ( Slope Flatten ) rather than a level plane
  flattenSlope:     boolean;
  // Flatten "exact": absolute height ( Ctrl+click picks it )
  targetHeight:     number;
  terraceStep:      number;
  // 0 = smooth steps, 1 = sharp vertical risers
  terraceSharpness: number;
  terraceOffset:    number;
  noiseScale:       number;
  noiseHeight:      number;
  noiseType:        "smooth" | "ridged" | "billow";
  noiseOctaves:     number;
  // Smooth: size of the features worked on, fraction of the radius
  featureSize:      number;
  // Crease: how much it pulls the ground in towards the crease line
  pinch:            number;
}

export interface BrushInfo {
  id:        BrushId;
  label:     string;
  icon:      IconName;
  group:     "Build" | "Shape" | "Deform" | "Natural" | "Utility";
  tip:       string;
  // what Ctrl does ( null: nothing )
  ctrl:      string | null;
  // brush-specific defaults on top of DEFAULT_BRUSH
  defaults?: Partial<BrushSettings>;
  // brush moves things around and can't use alphas or stroke methods meaningfully
  deform?:   boolean;
}

const linearCurve: Curve = [{ t: 0, v: 1 }, { t: 0.5, v: 0.6 }, { t: 1, v: 0 }];

export const DEFAULT_BRUSH: BrushSettings = {
  strength:         0.5,
  invert:           false,
  falloff:          "smooth",
  hardness:         0.25,
  curve:            linearCurve,
  roundness:        1,
  alpha:            "none",
  rotation:         0,
  rotationFollow:   false,
  rotationJitter:   0,
  stroke:           "space",
  spacing:          0.12,
  rate:             15,
  jitter:           0,
  sizeJitter:       0,
  strengthJitter:   0,
  // ---- per brush
  layerHeight:      1,
  clayHeight:       0.4,
  flattenTarget:    "start",
  flattenDir:       "both",
  flattenSlope:     false,
  targetHeight:     0,
  terraceStep:      2,
  terraceSharpness: 0.7,
  terraceOffset:    0,
  noiseScale:       8,
  noiseHeight:      1.5,
  noiseType:        "smooth",
  noiseOctaves:     4,
  featureSize:      0.2,
  pinch:            0.5,
};

export const BRUSHES: BrushInfo[] = [
  { id: "draw",    label: "Draw",    icon: "draw",    group: "Build",   tip: "Raise the ground (Ctrl lowers). With an alpha it stamps shapes.", ctrl: "lower" },
  { id: "layer",   label: "Layer",   icon: "layer",   group: "Build",   tip: "Raise to a fixed height over the ground as it was — a pad or berm that follows the terrain, never piling up", ctrl: "dig down", defaults: { hardness: 0.6, strength: 0.7 } },
  { id: "clay",    label: "Clay",    icon: "clay",    group: "Build",   tip: "Build up like clay: adds while flattening, so shapes stay clean. Square tip = Clay Strips", ctrl: "carve", defaults: { hardness: 0.4, strength: 0.4 } },
  { id: "smooth",  label: "Smooth",  icon: "smooth",  group: "Build",   tip: "Even out bumps (Ctrl enhances details). Hold Shift with any brush to smooth", ctrl: "enhance details", defaults: { strength: 0.5 } },
  { id: "flatten", label: "Flatten", icon: "flatten", group: "Build",   tip: "Flatten to a height or along the slope; Fill only raises, Scrape only cuts. Ctrl+click picks a height", ctrl: null, defaults: { hardness: 0.5, strength: 0.6 } },
  { id: "terrace", label: "Terrace", icon: "terrace", group: "Build",   tip: "Step the ground into terraces", ctrl: null, defaults: { strength: 0.4 } },
  { id: "noise",   label: "Noise",   icon: "noise",   group: "Build",   tip: "Add natural bumps, ridges or lumps (fixed in the world, so strokes join up)", ctrl: "remove", defaults: { strength: 0.3 } },
  { id: "crease",  label: "Crease",  icon: "crease",  group: "Shape",   tip: "Carve a sharp gully and pull the sides in (Ctrl: a sharp ridge)", ctrl: "ridge", defaults: { falloff: "sharper", hardness: 0, strength: 0.4 } },
  { id: "pinch",   label: "Pinch",   icon: "pinch",   group: "Shape",   tip: "Pull features towards the centre, sharpening them (Ctrl: magnify, pushing them out)", ctrl: "magnify", defaults: { strength: 0.4 } },
  { id: "smudge",  label: "Smudge",  icon: "smudge",  group: "Deform",  tip: "Push features along the stroke", ctrl: null, deform: true, defaults: { strength: 0.6, spacing: 0.08 } },
  { id: "mask",    label: "Mask",    icon: "mask",    group: "Utility", tip: "Paint a mask: masked ground isn't touched by any brush (Ctrl erases)", ctrl: "erase", defaults: { strength: 1, hardness: 0.5 } },
];

export const brushInfo = ( id: BrushId ) => BRUSHES.find( ( b ) => b.id === id )!;

export function defaultSettings( id: BrushId ): BrushSettings {
  return { ...structuredClone( DEFAULT_BRUSH ), ...structuredClone( brushInfo( id ).defaults ?? {} ) };
}

// Settings shared by every brush.
export interface SculptState {
  brush:    BrushId;
  // metres; one size for all brushes, as Blender does by default
  radius:   number;
  brushes:  Record<BrushId, BrushSettings>;
  symmetry: { x: boolean; z: boolean; radial: number; pivot: [number, number] | null };
  // "affect only" filters ( Unity's brush mask filters )
  filters: {
    height: { on: boolean; min: number; max: number };
    slope:  { on: boolean; min: number; max: number };
    cavity: "all" | "concave" | "convex";
  };
  // lazy mouse: the brush trails the cursor by this fraction of its radius
  stabilize:        number;
  pressureSize:     boolean;
  pressureStrength: boolean;
  showMask:         boolean;
}

export function defaultSculpt(): SculptState {
  return {
    brush:            "draw",
    radius:           12,
    brushes:          Object.fromEntries( BRUSHES.map( ( b ) => [b.id, defaultSettings( b.id )] ) ) as Record<BrushId, BrushSettings>,
    symmetry:         { x: false, z: false, radial: 1, pivot: null },
    filters:          { height: { on: false, min: 0, max: 1000 }, slope: { on: false, min: 0, max: 45 }, cavity: "all" },
    stabilize:        0,
    pressureSize:     false,
    pressureStrength: true,
    showMask:         true,
  };
}

/**
 * Saved settings merged over the defaults ( new settings keep their defaults ).
**/
export function mergeSculpt( saved: Partial<SculptState> | null ): SculptState {
  const d = defaultSculpt();
  if ( !saved || typeof saved !== "object" ) return d;
  const brushes = { ...d.brushes };
  for ( const b of BRUSHES ) if ( saved.brushes?.[b.id] ) brushes[b.id] = { ...d.brushes[b.id], ...saved.brushes[b.id] };
  return {
    ...d,
    ...saved,
    brush:    BRUSHES.some( ( b ) => b.id === saved.brush ) ? saved.brush! : d.brush,
    brushes,
    symmetry: { ...d.symmetry, ...saved.symmetry },
    filters: {
      height: { ...d.filters.height, ...saved.filters?.height },
      slope:  { ...d.filters.slope,  ...saved.filters?.slope  },
      cavity: saved.filters?.cavity ?? d.filters.cavity,
    },
  };
}
