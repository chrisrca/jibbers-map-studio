// Map-Tools' Ski Line Builder, as it lays a line ( SkiLineSpline.cs, SkiLineBuilder.Carve and RasterizeStripe,
// SkiLineEdit.compute's CarveLine ): a centripetal Catmull-Rom spline through the line's points, sampled evenly along
// it with its width, roll and Auto Bank; each ground sample set towards the line's surface there ( its height, the
// cross-section and roll faded at its sides, the features' bumps ), blended in at its edges and ends; the features'
// stripes painted into the snow mask. In world space, metres ( Map-Tools works in its terrain's pixels: the same ).

import { type Curve, evalCurve } from "../../../core/curve";
import { rampAt, rampPath, rampRights } from "./rampPath";
import type { CurveShape, SkiLineFeature, SkiLineShape, SkiLineStripe } from "./types";

type V3 = [number, number, number];

// ( spline points worked out a segment, before it's sampled evenly )
const DENSE = 48;

export interface SkiLineBake {
  pos:       V3[];
  cum:       Float64Array;
  half:      Float32Array;
  roll:      Float32Array;
  nodeParam: Float32Array;
  total:     number;
}

const lerp      = ( a: number, b: number, t: number ) => a + ( b - a ) * Math.min( 1, Math.max( 0, t ) );
const saturate  = ( x: number ) => ( x < 0 ? 0 : x > 1 ? 1 : x );
const smooth    = ( x: number ) => x * x * ( 3 - 2 * x );
const dist3     = ( a: V3, b: V3 ) => Math.hypot( a[0] - b[0], a[1] - b[1], a[2] - b[2] );
// ( a curve with no keys: none, as Unity's empty AnimationCurve )
const evaluated = ( c: Curve | undefined, t: number ) => ( c?.length ? evalCurve( c, t ) : 0 );

const knot  = ( a: V3, b: V3 ) => Math.max( Math.sqrt( dist3( a, b ) ), 1e-4 );
const remap = ( a: V3, b: V3, ta: number, tb: number, t: number ): V3 => {
  if ( tb - ta <= 1e-6 ) return a;
  const k = ( t - ta ) / ( tb - ta );
  return [a[0] + ( b[0] - a[0] ) * k, a[1] + ( b[1] - a[1] ) * k, a[2] + ( b[2] - a[2] ) * k];
};

/**
 * The spline's point `u` ( 0..1 ) along segment `seg` ( centripetal Catmull-Rom; its ends carried straight on ).
**/
export function splinePoint( nodes: { p: V3 }[], seg: number, u: number ): V3 {
  const p1 = nodes[seg].p, p2 = nodes[seg + 1].p;
  const p0 = seg > 0 ? nodes[seg - 1].p : ( [p1[0] * 2 - p2[0], p1[1] * 2 - p2[1], p1[2] * 2 - p2[2]] as V3 );
  const p3 = seg + 2 < nodes.length ? nodes[seg + 2].p : ( [p2[0] * 2 - p1[0], p2[1] * 2 - p1[1], p2[2] * 2 - p1[2]] as V3 );
  const t0 = 0, t1 = t0 + knot( p0, p1 ), t2 = t1 + knot( p1, p2 ), t3 = t2 + knot( p2, p3 );
  const t  = t1 + ( t2 - t1 ) * u;
  const a1 = remap( p0, p1, t0, t1, t ), a2 = remap( p1, p2, t1, t2, t ), a3 = remap( p2, p3, t2, t3, t );
  const b1 = remap( a1, a2, t0, t2, t ), b2 = remap( a2, a3, t1, t3, t );
  return remap( b1, b2, t1, t2, t );
}

/**
 * The features' bumps `d` metres along the line, `lateral` metres off its middle ( FeatureOffsetAt ).
**/
export function featureOffsetAt( features: SkiLineFeature[], d: number, lateral: number ): number {
  let h = 0;
  for ( const f of features ) {
    if ( !f.enabled || f.length <= 0.01 || !f.profile?.length ) continue;
    const t = ( d - f.start ) / f.length;
    if ( t < 0 || t > 1 ) continue;
    let v = evalCurve( f.profile, t ) * f.height;
    if ( f.width > 0.01 ) {
      const half = f.width * 0.5, rel = Math.abs( lateral - f.lateral );
      if ( rel >= half ) continue;
      const blend = Math.max( f.sideBlend, 0.01 ) * half;
      v *= smooth( saturate( ( half - rel ) / blend ) );
    }
    h += v;
  }
  return h;
}

/**
 * The line's half-width `d` metres along it: widened where a feature reaches past it ( FeatureHalfWidth ).
**/
function featureHalfWidth( features: SkiLineFeature[], d: number, base: number ): number {
  let half = base;
  for ( const f of features ) {
    if ( !f.enabled || f.length <= 0.01 || f.width <= 0.01 ) continue;
    const t = ( d - f.start ) / f.length;
    if ( t < 0 || t > 1 ) continue;
    const want = Math.abs( f.lateral ) + f.width * 0.5;
    if ( want <= base ) continue;
    const e = smooth( saturate( Math.min( t, 1 - t ) / 0.25 ) );
    half    = Math.max( half, lerp( base, want, e ) );
  }
  return half;
}

const bakes = new WeakMap<SkiLineShape, SkiLineBake | null>();

/**
 * The line sampled evenly along it ( SkiLineSpline.Bake ): each sample's place, distance along, half-width and roll;
 * null with under two points or under a metre long.
**/
export function skiLineBake( s: SkiLineShape ): SkiLineBake | null {
  if ( bakes.has( s ) ) return bakes.get( s )!;
  const b = bakeNow( s );
  bakes.set( s, b );
  return b;
}

function bakeNow( s: SkiLineShape ): SkiLineBake | null {
  const nodes = s.nodes;
  if ( nodes.length < 2 ) return null;
  const segs  = nodes.length - 1, n0 = segs * DENSE + 1;
  const dense: V3[] = Array.from( { length: n0 }, (): V3 => [0, 0, 0] ), param = new Float64Array( n0 );
  for ( let g = 0; g < segs; g++ )
    for ( let i = 0; i < DENSE; i++ ) {
      dense[g * DENSE + i] = splinePoint( nodes, g, i / DENSE );
      param[g * DENSE + i] = g + i / DENSE;
    }
  dense[n0 - 1] = nodes[segs].p;
  param[n0 - 1] = segs;
  const cum0 = new Float64Array( n0 );
  for ( let i = 1; i < n0; i++ ) cum0[i] = cum0[i - 1] + dist3( dense[i - 1], dense[i] );
  const total = cum0[n0 - 1];
  if ( total < 1 ) return null;
  const n = Math.min( 4096, Math.max( 16, Math.round( s.detail ) ) );
  const b: SkiLineBake = { pos: Array.from( { length: n }, (): V3 => [0, 0, 0] ), cum: new Float64Array( n ), half: new Float32Array( n ), roll: new Float32Array( n ), nodeParam: new Float32Array( n ), total };
  let cursor = 0;
  for ( let i = 0; i < n; i++ ) {
    const d = ( total * i ) / ( n - 1 );
    while ( cursor < n0 - 2 && cum0[cursor + 1] < d ) cursor++;
    const span = cum0[cursor + 1] - cum0[cursor];
    const u    = span > 1e-6 ? ( d - cum0[cursor] ) / span : 0;
    const np   = lerp( param[cursor], param[cursor + 1], u );
    const seg  = Math.min( segs - 1, Math.max( 0, Math.trunc( np ) ) );
    const su   = saturate( np - seg );
    const a = nodes[seg], c = nodes[seg + 1];
    const w0   = a.width !== null && a.width > 0 ? a.width : s.width, w1 = c.width !== null && c.width > 0 ? c.width : s.width;
    const sm   = smooth( su );
    const base = Math.max( lerp( w0, w1, sm ), 0.1 ) * 0.5;
    b.pos[i]       = splinePoint( nodes, seg, su );
    b.cum[i]       = d;
    b.half[i]      = featureHalfWidth( s.features, d, base );
    b.roll[i]      = lerp( a.roll, c.roll, sm );
    b.nodeParam[i] = np;
  }
  // Auto Bank: banked into the turns, by how sharply it turns ( smoothed over a few metres )
  if ( Math.abs( s.autoBank ) > 0.01 && n >= 3 ) {
    let bank   = new Float64Array( n );
    const ds   = Math.max( total / ( n - 1 ), 1e-4 );
    for ( let i = 1; i < n - 1; i++ ) {
      let ax = b.pos[i][0] - b.pos[i - 1][0], az = b.pos[i][2] - b.pos[i - 1][2];
      let bx = b.pos[i + 1][0] - b.pos[i][0], bz = b.pos[i + 1][2] - b.pos[i][2];
      const la = Math.hypot( ax, az ), lb = Math.hypot( bx, bz );
      if ( la * la < 1e-10 || lb * lb < 1e-10 ) continue;
      ax /= la; az /= la; bx /= lb; bz /= lb;
      const turn = Math.atan2( ax * bz - az * bx, Math.min( 1, Math.max( -1, ax * bx + az * bz ) ) );
      bank[i]    = Math.min( 60, Math.max( -60, ( -s.autoBank * 20 * turn ) / ds ) );
    }
    const w  = Math.min( 64, Math.max( 1, Math.round( 3 / ds ) ) );
    let sm2  = new Float64Array( n );
    for ( let pass = 0; pass < 2; pass++ ) {
      for ( let i = 0; i < n; i++ ) {
        let sum = 0;
        const lo = Math.max( 0, i - w ), hi = Math.min( n - 1, i + w );
        for ( let j = lo; j <= hi; j++ ) sum += bank[j];
        sm2[i] = sum / ( hi - lo + 1 );
      }
      [bank, sm2] = [sm2, bank];
    }
    for ( let i = 0; i < n; i++ ) b.roll[i] = Math.min( 75, Math.max( -75, b.roll[i] + bank[i] ) );
  }
  return b;
}

/**
 * The first sample at or past `d` metres along ( IndexAtDistance ).
**/
export function indexAt( b: SkiLineBake, d: number ): number {
  let lo = 0, hi = b.pos.length - 1;
  while ( lo < hi ) {
    const mid = ( lo + hi ) >> 1;
    if ( b.cum[mid] < d ) lo = mid + 1;
    else hi = mid;
  }
  return Math.min( b.pos.length - 1, Math.max( 0, lo ) );
}

/**
 * The line's place `d` metres along ( PointAtDistance ).
**/
export function pointAt( b: SkiLineBake, d: number ): V3 {
  d       = Math.min( b.total, Math.max( 0, d ) );
  const i = Math.min( b.pos.length - 1, Math.max( 1, indexAt( b, d ) ) );
  const span = b.cum[i] - b.cum[i - 1], u = span > 1e-6 ? ( d - b.cum[i - 1] ) / span : 0;
  const p = b.pos[i - 1], q = b.pos[i];
  return [p[0] + ( q[0] - p[0] ) * u, p[1] + ( q[1] - p[1] ) * u, p[2] + ( q[2] - p[2] ) * u];
}

/**
 * The way the line runs at sample `i` ( TangentAt ), and to its right ( RightAt: across it, level ).
**/
export function tangentAt( b: SkiLineBake, i: number ): V3 {
  const n = b.pos.length;
  const p = i < n - 1 ? b.pos[i + 1] : b.pos[i], q = i < n - 1 ? b.pos[i] : b.pos[i - 1];
  const t: V3 = [p[0] - q[0], p[1] - q[1], p[2] - q[2]], l = Math.hypot( ...t );
  return l * l > 1e-8 ? [t[0] / l, t[1] / l, t[2] / l] : [0, 0, 1];
}

export function rightAt( b: SkiLineBake, i: number ): V3 {
  const t = tangentAt( b, i ), l = Math.hypot( t[2], t[0] );
  // ( Vector3.Cross( tangent, up ) )
  return l * l > 1e-8 ? [-t[2] / l, 0, t[0] / l] : [1, 0, 0];
}

/**
 * How far along the line the point nearest ( x, z ) is, and how far off it ( NearestDistance ).
**/
export function nearestAlong( b: SkiLineBake, x: number, z: number ): { d: number; off: number } {
  let best = Infinity, bi = 0, bt = 0;
  for ( let i = 0; i < b.pos.length - 1; i++ ) {
    const ax = b.pos[i][0], az = b.pos[i][2], abx = b.pos[i + 1][0] - ax, abz = b.pos[i + 1][2] - az;
    const t  = saturate( ( ( x - ax ) * abx + ( z - az ) * abz ) / Math.max( abx * abx + abz * abz, 1e-6 ) );
    const d2 = ( x - ax - abx * t ) ** 2 + ( z - az - abz * t ) ** 2;
    if ( d2 < best ) { best = d2; bi = i; bt = t; }
  }
  return { d: b.cum[bi] + ( b.cum[bi + 1] - b.cum[bi] ) * bt, off: Math.sqrt( best ) };
}

/**
 * The line's surface at sample `i`, `crossT` across it ( 0 left edge, 1 right; SurfacePoint ).
**/
export function surfaceAt( s: SkiLineShape, b: SkiLineBake, i: number, crossT: number ): V3 {
  const p = b.pos[i], r = rightAt( b, i );
  const lateral = ( crossT - 0.5 ) * 2 * b.half[i];
  const cross   = evaluated( s.cross, crossT ) * s.crossDepth;
  const roll    = Math.tan( ( b.roll[i] * Math.PI ) / 180 ) * lateral;
  const edge    = Math.min( crossT, 1 - crossT );
  const fade    = smooth( s.sideFlatten > 0 ? saturate( edge / s.sideFlatten ) : 1 );
  const bump    = featureOffsetAt( s.features, b.cum[i], lateral );
  return [p[0] + r[0] * lateral, p[1] + ( cross + roll ) * fade + bump, p[2] + r[2] * lateral];
}

// ---------------------------------------------------------------- the carve ( CarveLine )

interface Carve {
  b:      SkiLineBake;
  // ( each sample: x, z, height, half-width, roll's rise across the whole width, distance along )
  rollBy: Float32Array;
  cross:  Float32Array;
  strip:  Float32Array;
  box:    [number, number, number, number];
  // ( the segments within reach of each cell of a grid over the line, to find the nearest quickly )
  cell:   number;
  gx:     number;
  gz:     number;
  gw:     number;
  grid:   Map<number, number[]>;
}

const CROSS_RES = 256, LAT_RES = 32;
const carves    = new WeakMap<SkiLineShape, Carve | null>();

function carveOf( s: SkiLineShape ): Carve | null {
  if ( carves.has( s ) ) return carves.get( s )!;
  const b = skiLineBake( s );
  let c: Carve | null = null;
  if ( b ) {
    const n = b.pos.length;
    const rollBy = new Float32Array( n );
    let maxHalf  = 0, x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for ( let i = 0; i < n; i++ ) {
      rollBy[i] = b.half[i] * 2 * Math.tan( ( b.roll[i] * Math.PI ) / 180 );
      maxHalf   = Math.max( maxHalf, b.half[i] );
      x0 = Math.min( x0, b.pos[i][0] ); x1 = Math.max( x1, b.pos[i][0] );
      z0 = Math.min( z0, b.pos[i][2] ); z1 = Math.max( z1, b.pos[i][2] );
    }
    const cross = new Float32Array( CROSS_RES );
    if ( s.cross?.length ) for ( let i = 0; i < CROSS_RES; i++ ) cross[i] = evalCurve( s.cross, i / ( CROSS_RES - 1 ) );
    const strip = new Float32Array( n * LAT_RES );
    for ( let i = 0; i < n; i++ )
      for ( let k = 0; k < LAT_RES; k++ ) strip[i * LAT_RES + k] = featureOffsetAt( s.features, b.cum[i], ( k / ( LAT_RES - 1 ) - 0.5 ) * 2 * b.half[i] );
    // ( a segment is filed under every cell within the line's widest reach of it )
    const cell = Math.max( 4, maxHalf * 2 ), gx = x0 - maxHalf - cell, gz = z0 - maxHalf - cell;
    const gw   = Math.ceil( ( x1 - gx + maxHalf + cell ) / cell ) + 1;
    const grid = new Map<number, number[]>();
    for ( let i = 0; i < n - 1; i++ ) {
      const a = b.pos[i], q = b.pos[i + 1];
      const ci0 = Math.floor( ( Math.min( a[0], q[0] ) - maxHalf - gx ) / cell ), ci1 = Math.floor( ( Math.max( a[0], q[0] ) + maxHalf - gx ) / cell );
      const cj0 = Math.floor( ( Math.min( a[2], q[2] ) - maxHalf - gz ) / cell ), cj1 = Math.floor( ( Math.max( a[2], q[2] ) + maxHalf - gz ) / cell );
      for ( let cj = cj0; cj <= cj1; cj++ ) for ( let ci = ci0; ci <= ci1; ci++ ) ( grid.get( cj * gw + ci ) ?? grid.set( cj * gw + ci, [] ).get( cj * gw + ci )! ).push( i );
    }
    c = { b, rollBy, cross, strip, box: [x0 - maxHalf - 1, z0 - maxHalf - 1, x1 + maxHalf + 1, z1 + maxHalf + 1], cell, gx, gz, gw, grid };
  }
  carves.set( s, c );
  return c;
}

/**
 * The world rectangle a ski line can change ( its samples and its widest reach past them ).
**/
export function skiLineBounds( s: SkiLineShape ): [number, number, number, number] {
  const c = carveOf( s );
  if ( c ) return c.box;
  const xs = s.nodes.map( ( n ) => n.p[0] ), zs = s.nodes.map( ( n ) => n.p[2] );
  return xs.length ? [Math.min( ...xs ), Math.min( ...zs ), Math.max( ...xs ), Math.max( ...zs )] : [0, 0, 0, 0];
}

/**
 * The height a ski line sets the ground to at ( x, z ), and how much ( CarveLine ); null off it.
**/
export function skiLineAt( s: SkiLineShape, x: number, z: number ): { h: number; blend: number } | null {
  if ( !s.enabled ) return null;
  const c = carveOf( s );
  if ( !c ) return null;
  const segs = c.grid.get( Math.floor( ( z - c.gz ) / c.cell ) * c.gw + Math.floor( ( x - c.gx ) / c.cell ) );
  if ( !segs ) return null;
  const P = c.b.pos;
  let best = Infinity, bi = -1, bt = 0;
  for ( const i of segs ) {
    const ax = P[i][0], az = P[i][2], abx = P[i + 1][0] - ax, abz = P[i + 1][2] - az;
    const t  = saturate( ( ( x - ax ) * abx + ( z - az ) * abz ) / Math.max( abx * abx + abz * abz, 1e-6 ) );
    const d2 = ( x - ax - abx * t ) ** 2 + ( z - az - abz * t ) ** 2;
    if ( d2 < best || ( d2 === best && i < bi ) ) { best = d2; bi = i; bt = t; }
  }
  if ( bi < 0 ) return null;
  const b    = c.b;
  const half = b.half[bi] + ( b.half[bi + 1] - b.half[bi] ) * bt;
  const dist = Math.sqrt( best );
  if ( dist > half ) return null;
  const abx  = P[bi + 1][0] - P[bi][0], abz = P[bi + 1][2] - P[bi][2];
  const qx   = P[bi][0] + abx * bt, qz = P[bi][2] + abz * bt;
  const side = Math.sign( abx * ( z - qz ) - abz * ( x - qx ) );
  const crossT = saturate( 0.5 + ( 0.5 * side * dist ) / Math.max( half, 1e-4 ) );
  const centre = P[bi][1] + ( P[bi + 1][1] - P[bi][1] ) * bt;
  const fi     = crossT * ( CROSS_RES - 1 ), lo = Math.floor( fi ), hi = Math.ceil( fi );
  const cross  = ( c.cross[lo] + ( c.cross[hi] - c.cross[lo] ) * ( fi - lo ) ) * s.crossDepth;
  const roll   = ( c.rollBy[bi] + ( c.rollBy[bi + 1] - c.rollBy[bi] ) * bt ) * ( crossT - 0.5 );
  const edge   = Math.min( crossT, 1 - crossT );
  const fade   = smooth( s.sideFlatten > 0 ? saturate( edge / s.sideFlatten ) : 1 );
  // ( the features' bumps, looked up between the samples' as Map-Tools bakes them )
  const n    = b.pos.length, at = bi + bt;
  const i0   = Math.min( n - 1, Math.max( 0, Math.trunc( at ) ) ), i1 = Math.min( i0 + 1, n - 1 ), ft = saturate( at - i0 );
  const lb   = crossT * ( LAT_RES - 1 ), b0 = Math.min( LAT_RES - 1, Math.max( 0, Math.trunc( lb ) ) ), b1 = Math.min( b0 + 1, LAT_RES - 1 ), lt = saturate( lb - b0 );
  const S    = c.strip;
  const bump = ( S[i0 * LAT_RES + b0] * ( 1 - lt ) + S[i0 * LAT_RES + b1] * lt ) * ( 1 - ft ) + ( S[i1 * LAT_RES + b0] * ( 1 - lt ) + S[i1 * LAT_RES + b1] * lt ) * ft;
  const h    = centre + ( cross + roll ) * fade + bump;
  let blend  = 1;
  if ( s.edgeBlend > 0 ) blend = Math.pow( smooth( saturate( edge / s.edgeBlend ) ), s.edgeFalloff );
  if ( s.endBlend > 0 ) {
    const d = b.cum[bi] + ( b.cum[bi + 1] - b.cum[bi] ) * bt;
    blend  *= smooth( saturate( Math.min( d, b.total - d ) / s.endBlend ) );
  }
  return { h, blend };
}

// ---------------------------------------------------------------- the stripes ( RasterizeStripe )

// ( a marking colour's value in the snow mask: MarkingColorValues )
export const MARKING_VALUES = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];

/**
 * The features' stripes on a snow mask of `m` pixels a side over the square from ( x0, z0 ), `size` metres a side:
 * each pixel they reach, the coverage they paint ( the most of any ) and the colour ( the last to reach it ), as
 * Map-Tools paints them ( coverage at least one 255th ).
**/
export function skiLineStripes( s: SkiLineShape, x0: number, z0: number, size: number, m: number ): Map<number, { cov: number; colour: number }> {
  const out = new Map<number, { cov: number; colour: number }>();
  const b   = s.enabled ? skiLineBake( s ) : null;
  if ( !b ) return out;
  const segment = stripeSegments( out, x0, z0, size, m );
  for ( const f of s.features ) {
    if ( !f.enabled || f.length <= 0.01 ) continue;
    for ( const st of f.stripes ) stripe( s, b, f, st, segment );
  }
  return out;
}

/**
 * A ramp's stripes ( CurveShape.stripes ), as `skiLineStripes` paints a feature's over its whole length and width:
 * along ones from its start to its end ( round its bend ), across ones from side to side. Position 0 is its left
 * edge, as its cross-section's.
**/
export function rampStripes( s: CurveShape, x0: number, z0: number, size: number, m: number ): Map<number, { cov: number; colour: number }> {
  const out = new Map<number, { cov: number; colour: number }>();
  const p   = s.stripes?.length ? rampPath( s ) : null;
  if ( !p ) return out;
  const segment = stripeSegments( out, x0, z0, size, m );
  const half    = s.width * 0.5, rights = rampRights( p );
  for ( const st of s.stripes! ) {
    const colour  = Math.min( 15, Math.max( 0, Math.round( st.colour ) ) );
    const radius  = Math.max( st.width * 0.5, 0.05 );
    const soft    = saturate( st.softness );
    const opacity = st.opacity <= 0 ? 1 : saturate( st.opacity );
    if ( st.across ) {
      const c     = rampAt( p, saturate( st.position ) * p.len ), inset = Math.min( 0.45, Math.max( 0, st.inset ) ) * half * 2;
      const a     = -half + inset, b = half - inset;
      segment( [c.x + c.rx * a, 0, c.z + c.rz * a], [c.x + c.rx * b, 0, c.z + c.rz * b], radius, soft, opacity, colour );
    } else {
      const across = ( saturate( st.position ) - 0.5 ) * 2 * half;
      for ( let i = 1; i < p.x.length; i++ ) {
        const r0 = rights[i - 1], r1 = rights[i];
        segment( [p.x[i - 1] + r0[0] * across, 0, p.z[i - 1] + r0[1] * across], [p.x[i] + r1[0] * across, 0, p.z[i] + r1[1] * across], radius, soft, opacity, colour );
      }
    }
  }
  return out;
}

/**
 * The stripe painter ( RasterizeStripe's segment ) over a snow mask of `m` pixels a side from ( x0, z0 ), `size` metres
 * a side, into `out`.
**/
function stripeSegments( out: Map<number, { cov: number; colour: number }>, x0: number, z0: number, size: number, m: number ) {
  const px = size / m;
  return ( a: V3, q: V3, radius: number, soft: number, opacity: number, colour: number ) => {
    const reach = Math.max( radius * ( 1 + soft * 2 ), px * ( 0.75 + soft * 2.5 ) );
    const i0 = Math.max( 0, Math.floor( ( Math.min( a[0], q[0] ) - reach - x0 ) / px ) ), i1 = Math.min( m - 1, Math.ceil( ( Math.max( a[0], q[0] ) + reach - x0 ) / px ) );
    const j0 = Math.max( 0, Math.floor( ( Math.min( a[2], q[2] ) - reach - z0 ) / px ) ), j1 = Math.min( m - 1, Math.ceil( ( Math.max( a[2], q[2] ) + reach - z0 ) / px ) );
    const abx = q[0] - a[0], abz = q[2] - a[2], ab2 = Math.max( abx * abx + abz * abz, 1e-8 );
    for ( let j = j0; j <= j1; j++ ) {
      const mz = z0 + ( j + 0.5 ) * px;
      for ( let i = i0; i <= i1; i++ ) {
        const mx = x0 + ( i + 0.5 ) * px;
        const t  = saturate( ( ( mx - a[0] ) * abx + ( mz - a[2] ) * abz ) / ab2 );
        const d  = Math.hypot( mx - ( a[0] + abx * t ), mz - ( a[2] + abz * t ) );
        const v  = Math.round( saturate( saturate( ( 1 - d / reach ) / ( soft + 0.001 ) ) * opacity ) * 255 );
        if ( v === 0 ) continue;
        const k = j * m + i, was = out.get( k );
        out.set( k, { cov: Math.max( was?.cov ?? 0, v / 255 ), colour } );
      }
    }
  };
}

function stripe( _s: SkiLineShape, b: SkiLineBake, f: SkiLineFeature, st: SkiLineStripe, segment: ( a: V3, q: V3, r: number, soft: number, op: number, colour: number ) => void ) {
  const d0 = Math.min( b.total, Math.max( 0, f.start ) ), d1 = Math.min( b.total, Math.max( 0, f.start + f.length ) );
  if ( d1 - d0 < 0.01 ) return;
  const colour   = Math.min( 15, Math.max( 0, Math.round( st.colour ) ) );
  const radius   = Math.max( st.width * 0.5, 0.05 );
  const soft     = saturate( st.softness );
  const opacity  = st.opacity <= 0 ? 1 : saturate( st.opacity );
  const windowed = f.width > 0.01;
  const at = ( p: V3, r: V3, k: number ): V3 => [p[0] + r[0] * k, p[1], p[2] + r[2] * k];
  if ( st.across ) {
    const d    = lerp( d0, d1, saturate( st.position ) );
    const i    = indexAt( b, d ), c = pointAt( b, d ), r = rightAt( b, i );
    const half = windowed ? f.width * 0.5 : b.half[Math.min( b.pos.length - 1, Math.max( 0, i ) )];
    const mid  = windowed ? f.lateral : 0;
    const inset = Math.min( 0.45, Math.max( 0, st.inset ) ) * half * 2;
    segment( at( c, r, mid - half + inset ), at( c, r, mid + half - inset ), radius, soft, opacity, colour );
    return;
  }
  const i0 = indexAt( b, d0 ), i1 = indexAt( b, d1 );
  if ( i1 <= i0 ) return;
  let prev: V3 | null = null;
  for ( let i = i0; i <= i1; i++ ) {
    const r    = rightAt( b, i );
    const half = windowed ? f.width * 0.5 : b.half[i];
    const mid  = windowed ? f.lateral : 0;
    const pt   = at( b.pos[i], r, mid + ( saturate( st.position ) - 0.5 ) * 2 * half );
    if ( prev ) segment( prev, pt, radius, soft, opacity, colour );
    prev = pt;
  }
}

// ---------------------------------------------------------------- the features' presets ( SkiLineFeature.Presets )

const k = ( t: number, v: number, ti: number, to: number ) => ( { t, v, ti, to } );
const stripeOf = ( p: Partial<SkiLineStripe> ): SkiLineStripe => ( { across: false, position: 0.5, width: 0.6, softness: 0.4, opacity: 0.7, inset: 0, colour: 11, ...p } );

export const SKI_LINE_PRESETS: { name: string; length: number; height: number; profile: () => Curve; stripes: () => SkiLineStripe[] }[] = [
  {
    name: "Kicker", length: 12, height: 3, profile: () => [k( 0, 0, 0, 0 ), k( 0.5, 0.3, 1.1, 1.1 ), k( 1, 1, 2.4, 0 )],
    stripes: () => [stripeOf( { position: 0.06, width: 0.5 } ), stripeOf( { position: 0.94, width: 0.5 } ), stripeOf( { across: true, position: 1, inset: 0.06, width: 0.5, opacity: 0.85, colour: 0 } )],
  },
  {
    name: "Table", length: 18, height: 2.5, profile: () => [k( 0, 0, 0, 3 ), k( 0.25, 1, 0, 0 ), k( 0.75, 1, 0, 0 ), k( 1, 0, -3, 0 )],
    stripes: () => [stripeOf( { position: 0.06, width: 0.5 } ), stripeOf( { position: 0.94, width: 0.5 } )],
  },
  { name: "Roller", length: 10, height: 1.2, profile: () => [k( 0, 0, 0, 0 ), k( 0.5, 1, 0, 0 ), k( 1, 0, 0, 0 )], stripes: () => [] },
  { name: "Gap", length: 8, height: -3, profile: () => [k( 0, 0, 0, 0 ), k( 0.5, 1, 0, 0 ), k( 1, 0, 0, 0 )], stripes: () => [stripeOf( { across: true, position: 1, opacity: 0.85, colour: 0 } )] },
  {
    name: "Landing", length: 14, height: 0, profile: () => [k( 0, 0, 0, 0 ), k( 1, 0, 0, 0 )],
    stripes: () => [0.15, 0.5, 0.85].map( ( position ) => stripeOf( { across: true, position, inset: 0.08, opacity: 0.85, colour: 0 } ) ),
  },
];

/**
 * A new feature `start` metres along, as Map-Tools adds one ( a kicker's shape, no stripes ).
**/
export function newSkiLineFeature( start: number ): SkiLineFeature {
  return { name: "Feature", enabled: true, start, length: 12, height: 3, lateral: 0, width: 0, sideBlend: 0.5, profile: SKI_LINE_PRESETS[0].profile(), stripes: [] };
}

/**
 * A feature given a preset's shape and stripes, kept where it is on the line.
**/
export function withPreset( f: SkiLineFeature, p: ( typeof SKI_LINE_PRESETS )[number] ): SkiLineFeature {
  return { ...f, name: p.name, length: p.length, height: p.height, profile: p.profile(), stripes: p.stripes() };
}
