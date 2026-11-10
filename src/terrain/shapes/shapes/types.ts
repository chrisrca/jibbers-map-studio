// Terrain shapes: a curve ( a kicker, a berm ), a circle, a stamp ( a copy of ground or a piece pressed in ), made new.

import { CROSS_SECTIONS, type Curve, PROFILES, RADIALS } from "../../../core/curve";

export type EdgeMode = "all" | "sides" | "ends";

export interface CurveShape {
  uid:           string;
  kind:          "curve";
  name:          string;
  start:         [number, number];
  end:           [number, number];
  // arms at the ends, bending the run between ( offsets from them, as a trail run's turning handles: rampPath.ts );
  // without, it runs straight
  startArm?:     [number, number];
  endArm?:       [number, number];
  width:         number;
  // absolute heights; null = the ground there
  startHeight:   number | null;
  endHeight:     number | null;
  // "between": the profile goes from the start height ( 0 ) to the end height ( 1 ), as Map-Tools' curve inserts do.
  // "bump": the profile adds `bump` metres on top of the straight line between the two ends — a jump that follows
  // the slope it sits on.
  heightMode:    "between" | "bump";
  bump:          number;
  // A kicker set by its lip: degrees above level at the lip ( bump mode only; null/absent = use `bump` and `profile` ).
  // The face is then a circular transition that starts parallel to the slope and turns up to this angle, so the
  // height follows from the angle and the length — on a steep run a kicker of a given height can otherwise still
  // point downhill at its lip.
  lipAngle?:     number | null;
  // along the run, 0..1 ( see heightMode )
  profile:       Curve;
  repeats:       number;
  repeatScaling: number;
  repeatFade:    number;
  // across the run, × crossDepth metres added
  cross:         Curve;
  crossDepth:    number;
  // fraction of the width at each side that fades back to the plain ramp
  sideFlatten:   number;
  // banking along the run: tilt( t ) × tiltDepth metres from one side to the other
  tilt:          Curve;
  tiltDepth:     number;
  // fraction of the shape ( from its edges ) blended into the surrounding ground
  edgeBlend:     number;
  edgeFalloff:   number;
  edgeMode:      EdgeMode;
  // lines painted into the snow mask, as a ski line's feature has them ( along: across the width; across: along the
  // run, 0 start, 1 end )
  stripes?:      SkiLineStripe[];
}

export interface CircleShape {
  uid:           string;
  kind:          "circle";
  name:          string;
  center:        [number, number];
  radius:        number;
  // absolute base height; null = the ground at the centre
  height:        number | null;
  // radial( t ) × depth metres added, t = 0 centre … 1 edge
  radial:        Curve;
  depth:         number;
  // tilt of the base plane: degrees, and the compass direction it rises towards ( 0 = +Z )
  tiltAngle:     number;
  tiltDirection: number;
  edgeBlend:     number;
  edgeFalloff:   number;
}

// A copied piece of terrain ( Map-Tools' copy insert ) or an object pressed into it ( mesh insert ): a small height
// grid placed, turned and mirrored anywhere.
export interface StampShape {
  uid:          string;
  kind:         "stamp";
  name:         string;
  center:       [number, number];
  // degrees, clockwise seen from above
  rotation:     number;
  mirrorX:      boolean;
  mirrorZ:      boolean;
  // metres added on top
  heightOffset: number;
  // metres in from the edge of the footprint over which it blends into the ground
  blend:        number;
  // relative: the copy sits at the height of the ground under its centre. Otherwise it keeps the exact heights it
  // was copied with ( an imprinted object stays exactly where it is ).
  relative:     boolean;
  grid:         StampGrid;
}

export interface StampGrid {
  // samples across X and Z, spaced `spacing` metres, centred on the stamp
  w:       number;
  h:       number;
  spacing: number;
  // row-major ( Z rows ); null where the stamp doesn't touch the ground ( imprints )
  heights: ( number | null )[];
  // the absolute height the values are measured from: the ground level around the copied area ( 0 for imprints )
  origin:  number;
  // Imprints: metres from the object at each sample ( 0 under it ), the heights beyond it being its nearest edge's, so
  // the ground slopes up to it over the shape's blend; up to `margin` metres out.
  dist?:   ( number | null )[];
  margin?: number;
}

// A landform in an outline ( Map-Tools' Formation Builder, terrain/shapes/shapes/formation.ts ), its settings as
// Map-Tools has them.
export interface FormationShape {
  uid:         string;
  kind:        "formation";
  name:        string;
  // the outline ( world XZ ), closed
  points:      [number, number][];
  // fitted to its outline already ( after that only adding or taking out a point fits it again )
  fitted?:     boolean;
  // ( false: kept, but not laid on the ground )
  enabled?:    boolean;
  // laid over the ground: added on top, only raising it, only carving it, or set ( from the ground round the outline )
  mode:        "add" | "raise" | "carve" | "set";
  style:       "smooth" | "ridged" | "billow";
  // the dome's height over the ground, and the whole formation moved up or down ( metres )
  height:      number;
  baseY:       number;
  // metres in from the outline to the dome's full height, and over which it fades into the ground
  peakWidth:   number;
  edgeBlend:   number;
  // the dome's cross-section, edge ( 0 ) to peak ( 1 )
  profile:     Curve;
  // the noise: its biggest features' size and how tall they are ( metres ), its octaves, between them, and how much of
  // it is on the peak rather than all over ( 0..1 ); its pattern bent about ( warp ); its seed
  featureSize: number;
  roughness:   number;
  detail:      number;
  lacunarity:  number;
  gain:        number;
  warp:        number;
  seed:        number;
  onPeak:      number;
  // rounding off ( 0..1 ) and how many passes
  smooth:      number;
  smoothSteps: number;
  thermal:     { on: boolean; amount: number; iterations: number; repose: number };
  // ( droplets: per height sample; lifetime: samples a droplet runs; radius: samples )
  hydraulic:   { on: boolean; droplets: number; lifetime: number; inertia: number; capacity: number; erode: number; deposit: number; evaporate: number; radius: number };
  // snow by height, slope and shape; rock painted where it can't hold ( rockFrom..rockFull degrees; the snow line's
  // heights world Y, −1 off ); depth in metres, soften in passes
  snow:        { on: boolean; rockFrom: number; rockFull: number; rock: number; crevices: number; lineLow: number; lineHigh: number; depth: number; addsHeight: number; soften: number };
  // ( mirrored with the map: the noise read from the other side of these lines, x = it − x, z = it − z )
  noiseMirror?: { x: number | null; z: number | null };
  // ( brought over from Map-Tools: its noise read from this corner, as Map-Tools reads it from its terrain's )
  noiseOffset?: [number, number];
  // ( 2: Map-Tools' settings; before, the studio's own )
  v?:          2;
}

// A stroke painted into the snow mask ( Map-Tools' paint insert ): from start to end, `width` metres across, how much
// it paints along it ( repeated ) and across it ( 0..1 ), times `coverage`; snow ( or rock, erased ), a marking colour
// ( MARKING_COLOURS ), or powder `depth` deep ( 0..1 ).
export interface PaintShape {
  uid:           string;
  kind:          "paint";
  name:          string;
  start:         [number, number];
  end:           [number, number];
  width:         number;
  along:         Curve;
  repeats:       number;
  repeatScaling: number;
  cross:         Curve;
  target:        "snow" | "marking" | "powder";
  colour:        number;
  depth:         number;
  erase:         boolean;
  coverage:      number;
}

// A ski line ( Map-Tools' Ski Line Builder, terrain/shapes/shapes/skiline.ts ): a run carved along a spline through its
// points, a feature's bumps along it and its stripes painted into the snow mask, its settings as Map-Tools has them.
export interface SkiLineNode {
  // where it is ( world ); the line runs at its height
  p:     [number, number, number];
  // its width ( metres ); null: the line's
  width: number | null;
  // banked here ( degrees ), on top of the line's Auto Bank
  roll:  number;
}

export interface SkiLineStripe {
  // across the line at one place along the feature, or along it at one place across
  across:   boolean;
  // along stripes: where across the width ( 0..1 ); across stripes: where along the feature ( 0 start, 1 end )
  position: number;
  width:    number;
  softness: number;
  opacity:  number;
  // across stripes pulled in from the line's edges ( a fraction of the width )
  inset:    number;
  colour:   number;
}

export interface SkiLineFeature {
  name:      string;
  enabled:   boolean;
  // metres along the line it starts, and how long
  start:     number;
  length:    number;
  height:    number;
  // metres off the line's middle, and how wide ( 0: the line's width )
  lateral:   number;
  width:     number;
  // the fraction of its half-width blended in at its sides
  sideBlend: number;
  // its height along it ( 0..1 × height )
  profile:   Curve;
  stripes:   SkiLineStripe[];
}

export interface SkiLineShape {
  uid:         string;
  kind:        "skiline";
  name:        string;
  enabled:     boolean;
  width:       number;
  // the surface across the line, left edge to right, × crossDepth metres
  cross:       Curve;
  crossDepth:  number;
  // the fraction of each side the cross-section and roll fade out over
  sideFlatten: number;
  // degrees banked in a 20 m turn
  autoBank:    number;
  // the fraction of each side blended into the ground round it, how sharply, and metres faded in and out at the ends
  edgeBlend:   number;
  edgeFalloff: number;
  endBlend:    number;
  // samples along the line
  detail:      number;
  nodes:       SkiLineNode[];
  features:    SkiLineFeature[];
}

export type Shape = CurveShape | CircleShape | StampShape | FormationShape | PaintShape | SkiLineShape;

let counter = 0;

const uid = () => `shape-${Date.now().toString( 36 )}-${( counter++ ).toString( 36 )}`;

/**
 * A new formation round `points`, as Map-Tools makes one ( its Basic preset; fitted once it has an outline ).
**/
export function newFormation( points: [number, number][] ): FormationShape {
  return {
    uid: uid(), kind: "formation", name: "Formation", points, mode: "add", style: "smooth",
    height: 55, baseY: 0, peakWidth: 100, edgeBlend: 14, profile: easeInOut(),
    featureSize: 60, roughness: 12, detail: 4, lacunarity: 2, gain: 0.5, warp: 0.25, seed: 0, onPeak: 0.4,
    smooth: 0.2, smoothSteps: 2,
    thermal:   { on: false, amount: 0.5, iterations: 50, repose: 36 },
    hydraulic: { on: false, droplets: 0.5, lifetime: 250, inertia: 0.05, capacity: 4, erode: 0.3, deposit: 0.3, evaporate: 0.01, radius: 3 },
    snow:      { on: false, rockFrom: 30, rockFull: 54, rock: 1, crevices: 0.5, lineLow: -1, lineHigh: -1, depth: 1.2, addsHeight: 0.4, soften: 2 },
    v:         2,
  };
}

/**
 * A new ski line through `nodes`, as Map-Tools makes one ( SetLineDefaults ).
**/
export function newSkiLine( nodes: SkiLineNode[] ): SkiLineShape {
  return {
    uid: uid(), kind: "skiline", name: "New Line", enabled: true, width: 14, cross: [{ t: 0, v: 0, ti: 0, to: 0 }, { t: 1, v: 0, ti: 0, to: 0 }], crossDepth: 0,
    sideFlatten: 0.15, autoBank: 0, edgeBlend: 0.25, edgeFalloff: 1, endBlend: 10, detail: 1024, nodes, features: [],
  };
}

// Unity's AnimationCurve.EaseInOut( 0, 0, 1, 1 ): level at both ends.
export const easeInOut = (): Curve => [{ t: 0, v: 0, flat: true }, { t: 1, v: 1, flat: true }];

export function newCurve( start: [number, number], end: [number, number] ): CurveShape {
  return {
    uid:           uid(),
    kind:          "curve",
    name:          "Curve",
    start,
    end,
    width:         8,
    startHeight:   null,
    endHeight:     null,
    heightMode:    "between",
    bump:          1.5,
    profile:       structuredClone( PROFILES.ramp.curve ),
    repeats:       1,
    repeatScaling: 1,
    repeatFade:    0,
    cross:         structuredClone( CROSS_SECTIONS.flat.curve ),
    crossDepth:    0,
    sideFlatten:   0,
    tilt:          [{ t: 0, v: 0 }, { t: 1, v: 0 }],
    tiltDepth:     0,
    edgeBlend:     0.15,
    edgeFalloff:   1,
    edgeMode:      "sides",
  };
}

export function newCircle( center: [number, number], radius: number ): CircleShape {
  return {
    uid:           uid(),
    kind:          "circle",
    name:          "Circle",
    center,
    radius:        Math.max( 1, radius ),
    height:        null,
    radial:        structuredClone( RADIALS.mound.curve ),
    depth:         3,
    tiltAngle:     0,
    tiltDirection: 0,
    edgeBlend:     0.3,
    edgeFalloff:   1,
  };
}

export function newStamp( center: [number, number], grid: StampGrid, relative: boolean, name = "Copy" ): StampShape {
  const side  = Math.min( grid.w - 1, grid.h - 1 ) * grid.spacing;
  const blend = grid.margin != null ? Math.min( 1.5, grid.margin ) : relative ? Math.min( 3, side * 0.3 ) : Math.min( 1, side * 0.1 );
  return {
    uid:          uid(),
    kind:         "stamp",
    name,
    center,
    rotation:     0,
    mirrorX:      false,
    mirrorZ:      false,
    heightOffset: 0,
    blend,
    relative,
    grid,
  };
}
