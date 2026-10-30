// Curve pieces ( Blender's curve objects with a bevel ): splines through control points, swept into a tube — round
// ( a rail, a pipe ), square ( a box rail ) or a flat bar — following the curve with a turning-free frame. A point is
// smooth ( the curve flows through it ) or sharp ( a kink, as on a kinked rail ), and has its own size ( Alt+S ).

import { add, cross, dot, len, mul, norm, sub, type Mesh, type V3 } from "./mesh";

export interface CurvePoint {
  p:     V3;
  // the profile's size here, × the curve's radius
  r:     number;
  sharp: boolean;
}
export type Profile = "round" | "square" | "flat";
// A spline's own tube, when it isn't the curve's ( a joined rail's legs keep theirs ).
export interface SplineStyle {
  profile:   Profile;
  radius:    number;
  thickness: number;
  sides:     number;
}
export interface Spline {
  points: CurvePoint[];
  closed: boolean;
  style?: SplineStyle;
}
export interface CurveData {
  splines:    Spline[];
  profile:    Profile;
  // metres: a round or square tube's radius; a flat bar's half width
  radius:     number;
  // a flat bar's half thickness ( metres )
  thickness:  number;
  // around a round tube
  sides:      number;
  // steps between two points
  resolution: number;
  // close the open ends
  caps:       boolean;
}

export const newCurve = ( points: V3[] ): CurveData => ( {
  splines: [{ points: points.map( ( p ) => ( { p, r: 1, sharp: false } ) ), closed: false }],
  profile: "round", radius: 0.025, thickness: 0.006, sides: 16, resolution: 12, caps: true,
} );

// A curve piece the Add menus make ( Blender's Add › Curve, as the game's jibs ).
export interface CurvePreset {
  label:  string;
  points: V3[];
  look?:  Partial<CurveData>;
  // the points that are sharp ( a kink )
  sharp?: number[];
  // grinds ( a leg doesn't )
  jib:    boolean;
}

export const CURVE_PRESETS: CurvePreset[] = [
  { label: "Rail",        points: [[-2,   0,   0 ], [2,  0,   0  ]],              jib: true                                                   },
  { label: "Kinked Rail", points: [[-3,   0.6, 0 ], [-1, 0.6, 0  ], [3, -0.6, 0]], jib: true,  sharp: [1]                                      },
  { label: "Curved Rail", points: [[-2.5, 0,   -1], [0,  0,   0.6], [2.5, 0, -1]], jib: true                                                   },
  { label: "Box Rail",    points: [[-2,   0,   0 ], [2,  0,   0  ]],              jib: true,  look: { profile: "square", radius: 0.08 }       },
  { label: "Flat Bar",    points: [[-2,   0,   0 ], [2,  0,   0  ]],              jib: true,  look: { profile: "flat", radius: 0.04, thickness: 0.004 } },
  { label: "Pipe Leg",    points: [[0,    0,   0 ], [0,  0.6, 0  ]],              jib: false, look: { radius: 0.03 }                          },
];

/**
 * A preset's curve.
**/
export function presetCurve( p: CurvePreset ): CurveData {
  const c = { ...newCurve( p.points ), ...p.look };
  for ( const i of p.sharp ?? [] ) c.splines[0].points[i].sharp = true;
  return c;
}

/**
 * Where a spline goes: points along it ( and the size there ), a corner kept at every sharp point.
**/
export function samplePath( s: Spline, resolution: number ): { p: V3; r: number }[] {
  const pts = s.points, n = pts.length;
  if ( n < 2 ) return pts.map( ( q ) => ( { p: q.p, r: q.r } ) );
  const at      = ( i: number ) => pts[s.closed ? ( i + n ) % n : Math.max( 0, Math.min( n - 1, i ) )];
  // a smooth point's tangent runs between its neighbours; a sharp point has none ( the curve turns there )
  const tangent = ( i: number ): V3 => {
    const q = at( i );
    if ( q.sharp || ( !s.closed && ( i === 0 || i === n - 1 ) ) ) {
      if ( !s.closed && i === 0 ) return mul( sub( at( 1 ).p, q.p ), 0.5 );
      if ( !s.closed && i === n - 1 ) return mul( sub( q.p, at( n - 2 ).p ), 0.5 );
      return [0, 0, 0];
    }
    return mul( sub( at( i + 1 ).p, at( i - 1 ).p ), 0.5 );
  };
  const out: { p: V3; r: number }[] = [];
  const segs                        = s.closed ? n : n - 1;
  for ( let i = 0; i < segs; i++ ) {
    const a     = at( i ), b = at( i + 1 ), ta = tangent( i ), tb = tangent( i + 1 );
    // a straight piece ( between sharp points, or with its tangents along it ) needs no steps between its ends
    const d     = norm( sub( b.p, a.p ) );
    const along = ( t: V3 ) => len( t ) < 1e-9 || len( cross( norm( t ), d ) ) < 1e-4;
    const steps = along( ta ) && along( tb ) ? 1 : Math.max( 1, resolution );
    for ( let k = 0; k < steps; k++ ) {
      const t   = k / steps, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      out.push( { p: add( add( mul( a.p, h00 ), mul( ta, h10 ) ), add( mul( b.p, h01 ), mul( tb, h11 ) ) ), r: a.r + ( b.r - a.r ) * t } );
    }
  }
  if ( !s.closed ) out.push( { p: pts[n - 1].p, r: pts[n - 1].r } );
  // ( two samples in the same place would give no direction )
  return out.filter( ( q, i ) => i === 0 || len( sub( q.p, out[i - 1].p ) ) > 1e-6 );
}

/**
 * A spline's tube: its own style, else the curve's.
**/
export const styleOf = ( c: CurveData, s: Spline ): SplineStyle => s.style ?? { profile: c.profile, radius: c.radius, thickness: c.thickness, sides: c.sides };

/**
 * The profile's corners round the tube ( in its frame: x across, y up ), for a size of 1.
**/
function profileOf( c: SplineStyle ): [number, number][] {
  if ( c.profile === "flat"   ) return [[-1, -c.thickness / c.radius], [1, -c.thickness / c.radius], [1, c.thickness / c.radius], [-1, c.thickness / c.radius]];
  if ( c.profile === "square" ) return [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const n = Math.max( 3, Math.round( c.sides ) );
  return Array.from( { length: n }, ( _, i ) => {
    const a = ( i / n ) * Math.PI * 2;
    return [Math.cos( a ), Math.sin( a )];
  } );
}

/**
 * The curve as a mesh: each spline swept along its path ( round tubes shaded smooth ), the open ends capped.
**/
export function curveMesh( c: CurveData ): Mesh {
  const g: Mesh = { v: [], f: [], m: [], s: [], w: [] };
  for ( const s of c.splines ) {
    const st   = styleOf( c, s ), prof = profileOf( st ), m = prof.length, smooth = st.profile === "round";
    const path = samplePath( s, c.resolution );
    if ( path.length < 2 ) continue;
    const closed = s.closed && path.length > 2;
    const T      = path.map( ( _, i ) => {
      const prev = path[Math.max( 0, i - 1 )].p, next = path[Math.min( path.length - 1, i + 1 )].p;
      const d    = closed ? sub( path[( i + 1 ) % path.length].p, path[( i - 1 + path.length ) % path.length].p ) : sub( next, prev );
      return norm( d );
    } );
    // a frame that doesn't twist ( double reflection ), starting level: its "up" as near world up as it can be
    let up: V3      = Math.abs( T[0][1] ) < 0.95 ? norm( sub( [0, 1, 0], mul( T[0], T[0][1] ) ) ) : norm( cross( T[0], [1, 0, 0] ) );
    const ups: V3[] = [up];
    for ( let i = 1; i < path.length; i++ ) {
      const v1 = sub( path[i].p, path[i - 1].p ), c1 = dot( v1, v1 );
      if ( c1 < 1e-12 ) {
        ups.push( up );
        continue;
      }
      const rL = sub( up,       mul( v1, ( 2 / c1 ) * dot( v1, up       ) ) );
      const tL = sub( T[i - 1], mul( v1, ( 2 / c1 ) * dot( v1, T[i - 1] ) ) );
      const v2 = sub( T[i], tL ), c2 = dot( v2, v2 );
      up       = c2 < 1e-12 ? rL : sub( rL, mul( v2, ( 2 / c2 ) * dot( v2, rL ) ) );
      ups.push( norm( up ) );
    }
    // at a sharp corner, the ring lies on the plane between the two directions ( a mitre ), widened to keep its size
    const base = g.v.length;
    path.forEach( ( q, i ) => {
      const t   = T[i], u = ups[i], side = norm( cross( u, t ) );
      let scale = 1;
      if ( i > 0 && i < path.length - 1 ) {
        const a  = norm( sub( q.p, path[i - 1].p ) ), b = norm( sub( path[i + 1].p, q.p ) );
        const ca = dot( a, t );
        if ( dot( a, b ) < 0.999 ) scale = 1 / Math.max( 0.3, ca );
      }
      for ( const [x, y] of prof ) {
        const rx    = x * st.radius * q.r, ry = y * st.radius * q.r;
        // across the turn, the ring stretches by the mitre ( only in the turn's own plane )
        const along = sub( path[Math.min( path.length - 1, i + 1 )].p, path[Math.max( 0, i - 1 )].p );
        const bend  = norm( sub( along, mul( t, dot( along, t ) ) ) );
        const off   = add( mul( side, rx ), mul( u, ry ) );
        const k     = len( bend ) > 0.5 ? dot( off, bend ) * ( scale - 1 ) : 0;
        g.v.push( add( add( q.p, off ), mul( bend, k ) ) );
      }
    } );
    const rings = path.length, seg = closed ? rings : rings - 1;
    for ( let i = 0; i < seg; i++ ) {
      const a = base + i * m, b = base + ( ( i + 1 ) % rings ) * m;
      for ( let j = 0; j < m; j++ ) {
        const j1 = ( j + 1 ) % m;
        // round the outside: the profile turns counter-clockwise seen down the tube
        g.f.push( [a + j, a + j1, b + j1, b + j] );
        g.m.push( 0 );
        g.s.push( smooth );
      }
    }
    if ( !closed && c.caps ) {
      g.f.push( Array.from( { length: m }, ( _, j ) => base + j                     ).reverse() );
      g.f.push( Array.from( { length: m }, ( _, j ) => base + ( rings - 1 ) * m + j ) );
      g.m.push( 0,     0     );
      g.s.push( false, false );
    }
  }
  return g;
}
