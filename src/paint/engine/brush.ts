// The paint engine's brush ( Photoshop's Brush Settings, as PhotoCraft models them ): the tip, its dynamics, scatter,
// texture, colour variation and the stroke's feel; and the built-in presets. Sizes in the engine are pixels; the
// radius, strength ( the stroke's opacity ) and hardness come from the tool's own settings.

import type { PatternId, TextureMode, TipId } from "./tips";

export interface PaintBrush {
  tip:              TipId;
  // dab spacing, a fraction of the diameter
  spacing:          number;
  // degrees
  angle:            number;
  // 1 = round … 0.05 = a thin slit
  roundness:        number;
  // how much each dab adds ( the stroke builds up to its strength )
  flow:             number;
  // ---- shape dynamics
  sizeJitter:       number;
  // the smallest jitter or pressure can make a dab, a fraction of the radius
  minSize:          number;
  // fraction of ±180°
  angleJitter:      number;
  roundnessJitter:  number;
  // the tip turns with the stroke
  followStroke:     boolean;
  pressureSize:     boolean;
  pressureOpacity:  boolean;
  // ---- scattering
  // up to this many diameters off the stroke
  scatter:          number;
  scatterBothAxes:  boolean;
  // dabs at each spacing step
  count:            number;
  // ---- texture
  pattern:          PatternId | "none";
  // metres across one repeat of the pattern ( it stays put on the ground as you paint )
  patternScale:     number;
  patternDepth:     number;
  patternMode:      TextureMode;
  patternInvert:    boolean;
  // ---- colour dynamics ( each dab )
  hueJitter:        number;
  saturationJitter: number;
  valueJitter:      number;
  // each dab between the colour and the second colour
  secondJitter:     number;
  // ---- options
  wetEdges:         boolean;
  noise:            boolean;
  // keeps painting while the pointer rests ( dabs a second )
  airbrush:         number;
  // a pulled string: the brush follows the pointer this many radii behind ( 0 = off )
  smoothing:        number;
}

export const DEFAULT_BRUSH: PaintBrush = {
  tip:              "round",
  spacing:          0.1,
  angle:            0,
  roundness:        1,
  flow:             1,
  // ---- shape dynamics
  sizeJitter:       0,
  minSize:          0.2,
  angleJitter:      0,
  roundnessJitter:  0,
  followStroke:     false,
  pressureSize:     true,
  pressureOpacity:  false,
  // ---- scattering
  scatter:          0,
  scatterBothAxes:  false,
  count:            1,
  // ---- texture
  pattern:          "none",
  patternScale:     0.5,
  patternDepth:     1,
  patternMode:      "multiply",
  patternInvert:    false,
  // ---- colour dynamics
  hueJitter:        0,
  saturationJitter: 0,
  valueJitter:      0,
  secondJitter:     0,
  // ---- options
  wetEdges:         false,
  noise:            false,
  airbrush:         0,
  smoothing:        0,
};

export interface PaintPreset {
  name:     string;
  // the tool's hardness and strength with it
  hardness: number;
  strength: number;
  brush:    Partial<PaintBrush>;
}

// The built-in presets ( PhotoCraft's General, Dry and Wet media and effects, plus spray paint for parks ).
export const PAINT_PRESETS: PaintPreset[] = [
  { name: "Hard Round",  hardness: 1,    strength: 1,   brush: {} },
  { name: "Soft Round",  hardness: 0,    strength: 1,   brush: {} },
  { name: "Airbrush",    hardness: 0,    strength: 0.8, brush: { flow: 0.08, airbrush: 30, spacing: 0.05 } },
  { name: "Marker",      hardness: 0.85, strength: 0.9, brush: { wetEdges: true, flow: 0.6 } },
  { name: "Calligraphy", hardness: 1,    strength: 1,   brush: { roundness: 0.22, angle: 45, spacing: 0.03 } },
  { name: "Pencil",      hardness: 1,    strength: 1,   brush: { noise: true, flow: 0.8, pattern: "paper", patternScale: 0.3, patternDepth: 0.5 } },
  { name: "Chalk",       hardness: 0.6,  strength: 1,   brush: { tip: "chalk", spacing: 0.15, angleJitter: 1, pattern: "paper", patternScale: 0.6, patternDepth: 0.8 } },
  { name: "Charcoal",    hardness: 0.6,  strength: 0.9, brush: { tip: "charcoal", spacing: 0.08, followStroke: true, sizeJitter: 0.15, pattern: "paper", patternScale: 0.5, patternDepth: 0.6 } },
  { name: "Bristle",     hardness: 0.6,  strength: 0.9, brush: { tip: "bristle", spacing: 0.04, followStroke: true, flow: 0.5 } },
  { name: "Sponge",      hardness: 0.6,  strength: 0.8, brush: { tip: "sponge", spacing: 0.4, angleJitter: 1, sizeJitter: 0.2, flow: 0.7 } },
  { name: "Spatter",     hardness: 1,    strength: 1,   brush: { tip: "spatter", spacing: 0.6, angleJitter: 1, sizeJitter: 0.4, scatter: 0.6, scatterBothAxes: true } },
  { name: "Spray Paint", hardness: 0,    strength: 0.9, brush: { flow: 0.15, noise: true, airbrush: 40, spacing: 0.05, scatter: 0.12, scatterBothAxes: true, count: 2 } },
  { name: "Confetti",    hardness: 0.9,  strength: 1,   brush: { spacing: 1.2, sizeJitter: 0.7, scatter: 1.5, scatterBothAxes: true, count: 3, hueJitter: 1, saturationJitter: 0.3 } },
];

/**
 * The settings remembered from before ( or none ), filled in with the defaults.
**/
export const mergeBrush = ( b: Partial<PaintBrush> | undefined ): PaintBrush => ( { ...DEFAULT_BRUSH, ...b } );
