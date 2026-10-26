// Terrain shapes: a curve ( a kicker, a berm ), a circle, a stamp ( a copy of ground or a piece pressed in ), made new.

import { CROSS_SECTIONS, type Curve, PROFILES, RADIALS } from "../../../core/curve";

export type EdgeMode = "all" | "sides" | "ends";

export interface CurveShape {
  uid:           string;
  kind:          "curve";
  name:          string;
  start:         [number, number];
  end:           [number, number];
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

export type Shape = CurveShape | CircleShape | StampShape;

let counter = 0;

const uid = () => `shape-${Date.now().toString( 36 )}-${( counter++ ).toString( 36 )}`;

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
