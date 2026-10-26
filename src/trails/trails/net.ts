// The trail net: points joined by runs ( each run's width, corners, roll, profile across and along ), made and found.

import { CROSS_SECTIONS, type Curve, PROFILES } from "../../core/curve";

export type V3 = [number, number, number];

export interface TrailNode {
  id:    string;
  // where it is ( the run's centre line passes through it at this height )
  p:     V3;
  // the slope of the ground the runs meeting here ease into ( metres up per metre along X and along Z )
  tilt?: [number, number];
}

export interface TrailRun {
  id:         string;
  a:          string;
  b:          string;
  // the ends' handles: from the point, the way the run leaves it ( and how far that pulls )
  ha:         V3;
  hb:         V3;
  // width at the a end and the b end
  wa:         number;
  wb:         number;
  // degrees the run is tilted about its line ( +: its right side lower )
  roll:       number;
  // metres up at the corners: a left, a right, b left, b right
  corners:    [number, number, number, number];
  // metres up at the middles of the sides: left, right
  mids:       [number, number];
  // along the run, × bump metres on top of the line between its points ( 0 at both ends for the jump shapes )
  profile:    Curve;
  bump:       number;
  // across the run ( 0 left … 1 right ), × crossDepth metres
  cross:      Curve;
  crossDepth: number;
  // metres it blends into the ground round it at its sides and open ends ( missing: the first trails' 15% of the
  // width, at least 3 m )
  edge?:      number;
  // still the shape Follow Ground / Fit to Ground gave it ( fitted again when its points or handles move ); shaping
  // it by hand ends that
  fit?:       boolean;
  // how much of the ground's own small-scale relief ( bumps, rolls: the ground less its ~8 m smoothed shape ) rides
  // on the run's surface, 0..1 ( missing: none, a smooth groomed surface )
  detail?:    number;
}

export interface TrailNet {
  nodes: TrailNode[];
  runs:  TrailRun[];
  // how its runs are shaped ( older nets keep theirs: their saved ground was made so ): from 2, the ends of runs
  // meeting three or more at a point ease into the point's tilt and skirts carry a run's slope; from 3, the skirt
  // beyond an open end carries half the run's slope on ( all of it, a run going down dug into the snow where the
  // slope flattens out past its end; none, it stood proud where the slope goes on ); from 4, open ends are rounded
  // ( a half circle as wide as the run ), points where three or more runs meet get a round pad, and where runs
  // overlap each counts most along its middle ( a run's edge crossing another showed as a hard line ); from 5, a bend
  // gets its round end only as much as it turns ( points close together overlapped in a tangle ), pads and fades reach
  // no more than 0.4 of a run's length, and skirts carry a slope of at most 0.25 ( steeper, blades stood out ); from 6,
  // on a tight curve the inside edge stops short of the curve's centre ( past it, the run folded over itself ); from
  // 7, the ground is worked out from each spot's distance to the runs ( trails/surface.ts ): the strip is just the
  // run's heights, without rounded ends or pads
  v?:    number;
  // begun on a map with no ground: tiles are added as far as the ground round the trails bends
  grow?: boolean;
}

// How new trails are shaped ( see TrailNet.v ).
export const NET_VERSION = 7;

export const emptyNet = (): TrailNet => ( { nodes: [], runs: [], v: NET_VERSION } );

/**
 * A new run's edge blend: half its width, at least 8 m.
**/
export const defaultEdge = ( width: number ) => Math.max( 8, width * 0.5 );

let counter = 0;

export const trailId = ( p: string ) => `${p}-${Date.now().toString( 36 )}-${( counter++ ).toString( 36 )}`;

export const FLAT: Curve = [{ t: 0, v: 0 }, { t: 1, v: 0 }];

/**
 * A new run from `a` to `b` ( straight: its handles a third of the way along ).
**/
export function newRun( net: TrailNet, a: string, b: string, width = 30 ): TrailRun {
  const pa    = nodeOf( net, a ).p, pb = nodeOf( net, b ).p;
  const d: V3 = [( pb[0] - pa[0] ) / 3, ( pb[1] - pa[1] ) / 3, ( pb[2] - pa[2] ) / 3];
  return {
    id:         trailId( "run" ),
    a,
    b,
    ha:         d,
    hb:         [-d[0], -d[1], -d[2]],
    wa:         width,
    wb:         width,
    roll:       0,
    corners:    [0, 0, 0, 0],
    mids:       [0, 0],
    profile:    structuredClone( FLAT ),
    bump:       0,
    cross:      structuredClone( CROSS_SECTIONS.flat.curve ),
    crossDepth: 0,
    edge:       defaultEdge( width ),
  };
}

export const nodeOf = ( net: TrailNet, id: string ) => net.nodes.find( ( n ) => n.id === id )!;

export const runsAt = ( net: TrailNet, id: string ) => net.runs.filter( ( r ) => r.a === id || r.b === id );

// The profiles a run can take along it ( bump mode: 0 at both ends for the jump shapes ).
export const RUN_PROFILES: Record<string, { label: string; curve: Curve }> = {
  flat:     { label: "Even", curve: FLAT },
  roller:   PROFILES.roller,
  table:    PROFILES.table,
  kicker:   PROFILES.kicker,
  stepdown: PROFILES.stepdown,
};
