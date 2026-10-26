// Lifts ( Map-Tools 0.5: chairlift, tbar, ropetow ): an object of the game's whose base station is where it stands, its
// top station and masts in its `lift` ( in its own space ), the cable a loop through the points each piece holds it by.
// Worked out as Map-Tools' LiftSetup / LiftGeometry do ( Unity space throughout ): the stations and masts face along
// the line, the cable sags slack × ( span / 50 )² at the middle of a span, and a mast's slots let it ride up to meet it.

import type { V3 } from "../core/coords";
import type { LiftCablePoint, LiftInfo, LiftPartInfo, ObjectEntry } from "../core/types";

// Where a piece of a lift is: its base, and its turn about the vertical ( radians; 0 faces Unity +Z ).
export interface LiftPiece {
  at:  V3;
  yaw: number;
}

const sub  = ( a: V3, b: V3     ): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add  = ( a: V3, b: V3     ): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul  = ( a: V3, k: number ): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot  = ( a: V3, b: V3 ) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len  = ( a: V3 ) => Math.hypot( a[0], a[1], a[2] );
const lerp = ( a: V3, b: V3, t: number ): V3 => [a[0] + ( b[0] - a[0] ) * t, a[1] + ( b[1] - a[1] ) * t, a[2] + ( b[2] - a[2] ) * t];

/**
 * Rotates `v` by `deg` about unit `axis` ( the numbers as Unity's Quaternion.AngleAxis gives them ).
**/
function about( v: V3, axis: V3, deg: number ): V3 {
  const a         = ( deg * Math.PI ) / 180, c = Math.cos( a ), s = Math.sin( a ), k = axis;
  const cross: V3 = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return add( add( mul( v, c ), mul( cross, s ) ), mul( k, dot( k, v ) * ( 1 - c ) ) );
}

/**
 * The object's rotation ( Unity euler degrees, applied Z, X, then Y ) applied to `v`.
**/
function rotate( v: V3, e: V3 ): V3 {
  return about( about( about( v, [0, 0, 1], e[2] ), [1, 0, 0], e[0] ), [0, 1, 0], e[1] );
}

/**
 * A point in the lift's own space, in the world ( Unity's TransformPoint ).
**/
export function liftPoint( o: Pick<ObjectEntry, "position" | "rotation" | "scale">, p: V3 ): V3 {
  return add( o.position, rotate( [p[0] * o.scale[0], p[1] * o.scale[1], p[2] * o.scale[2]], o.rotation ) );
}

/**
 * A world point in the lift's own space ( Unity's InverseTransformPoint ).
**/
export function liftLocal( o: Pick<ObjectEntry, "position" | "rotation" | "scale">, w: V3 ): V3 {
  const back = about( about( about( sub( w, o.position ), [0, 1, 0], -o.rotation[1] ), [1, 0, 0], -o.rotation[0] ), [0, 0, 1], -o.rotation[2] );
  return [back[0] / ( o.scale[0] || 1 ), back[1] / ( o.scale[1] || 1 ), back[2] / ( o.scale[2] || 1 )];
}

/**
 * The way `d` faces about the vertical ( radians ), or `keep` when it's straight up or down.
**/
const yawOf = ( d: V3, keep: number ) => ( Math.hypot( d[0], d[2] ) < 1e-3 ? keep : Math.atan2( d[0], d[2] ) );

/**
 * The lift's stations and masts: where each stands, facing along the line ( LiftGeometry.OrientPieces ).
**/
export function liftPieces( o: ObjectEntry ): { base: LiftPiece; top: LiftPiece; masts: LiftPiece[] } | null {
  if ( !o.lift ) return null;
  const base  = o.position, top = liftPoint( o, [o.lift.endPosition.x, o.lift.endPosition.y, o.lift.endPosition.z] );
  const masts = o.lift.masts.map( ( m ) => liftPoint( o, [m.x, m.y, m.z] ) );
  const first = masts[0] ?? top, last = masts[masts.length - 1] ?? base;
  return {
    base:  { at: base, yaw: yawOf( sub( first, base ), 0 ) },
    top:   { at: top,  yaw: yawOf( sub( last,  top  ), Math.PI ) },
    masts: masts.map( ( at, i ) => ( { at, yaw: yawOf( sub( masts[i + 1] ?? top, masts[i - 1] ?? base ), 0 ) } ) ),
  };
}

/**
 * A piece's own point ( its template's space ) in the world: at the piece, turned, at the lift's scale.
**/
function piecePoint( piece: LiftPiece, scale: V3, p: V3 ): V3 {
  return add( piece.at, about( [p[0] * scale[0], p[1] * scale[1], p[2] * scale[2]], [0, 1, 0], ( piece.yaw * 180 ) / Math.PI ) );
}
const pieceDir = ( piece: LiftPiece, d: V3 ): V3 => about( d, [0, 1, 0], ( piece.yaw * 180 ) / Math.PI );

// Where the cable meets a piece: fixed, or ( a slot ) free to move along `axis` between min and max.
interface Anchor {
  origin: V3;
  axis:   V3;
  min:    number;
  max:    number;
  offset: number;
}
const fixed    = ( p: V3 ): Anchor => ( { origin: p, axis: [0, 1, 0], min: 0, max: 0, offset: 0 } );
const anchorAt = ( a: Anchor ) => add( a.origin, mul( a.axis, a.offset ) );

/**
 * The anchors along one of a piece's cable paths ( LiftGeometry.AppendChain ): a wheel's arc, slots, fixed points.
**/
function chain( points: LiftCablePoint[], piece: LiftPiece, scale: V3 ): Anchor[] {
  const out: Anchor[] = [];
  for ( const c of points ) {
    const p = piecePoint( piece, scale, c.p );
    if ( c.kind === "wheel" ) {
      const up    = pieceDir( piece, c.up! ), start = mul( pieceDir( piece, c.fwd! ), c.radius! );
      const steps = Math.min( 64, Math.max( 1, Math.ceil( Math.abs( c.arc! ) / 12 ) ) );
      for ( let s = 0; s <= steps; s++ ) out.push( fixed( add( p, about( start, up, ( c.arc! * s ) / steps ) ) ) );
    } else if ( c.kind === "slot" ) {
      const lo = Math.min( c.min!, c.max! ), hi = Math.max( c.min!, c.max! );
      out.push( { origin: p, axis: pieceDir( piece, c.up! ), min: lo, max: hi, offset: Math.min( hi, Math.max( lo, 0 ) ) } );
    } else out.push( fixed( p ) );
  }
  return out;
}

/**
 * How far a span of `length` metres sags at its middle.
**/
const dipOf = ( slack: number, length: number ) => slack * ( length / 50 ) * ( length / 50 );

/**
 * A strand's slots settled where the sagging cable runs through them ( LiftGeometry.SolveStrand ).
**/
function solveStrand( anchors: Anchor[], slack: number ): V3[] {
  for ( let it = 0; it < 256; it++ ) {
    let moved = 0;
    for ( let i = 1; i < anchors.length - 1; i++ ) {
      const a = anchors[i];
      if ( a.max - a.min < 1e-4 ) continue;
      const prev  = anchorAt( anchors[i - 1] ), next = anchorAt( anchors[i + 1] );
      const chord = sub( next, prev ), flat = sub( chord, mul( a.axis, dot( chord, a.axis ) ) );
      const f2    = dot( flat, flat );
      if ( f2 < 1e-6 ) continue;
      const rel    = sub( a.origin, prev ), relFlat = sub( rel, mul( a.axis, dot( rel, a.axis ) ) );
      const t      = Math.min( 1, Math.max( 0, dot( relFlat, flat ) / f2 ) );
      const dip    = dipOf( slack, len( chord ) );
      const target = add( add( prev, mul( chord, t ) ), [0, -( 4 * dip * t * ( 1 - t ) ), 0] );
      const offset = Math.min( a.max, Math.max( a.min, dot( sub( target, a.origin ), a.axis ) ) );
      moved        = Math.max( moved, Math.abs( offset - a.offset ) );
      a.offset     = offset;
    }
    if ( moved < 1e-4 ) break;
  }
  return anchors.map( anchorAt );
}

/**
 * The points of each span between anchors, sagging ( LiftGeometry.AddSpans ): two metres apart at most.
**/
function spans( out: V3[], anchors: V3[], slack: number ) {
  for ( let i = 0; i < anchors.length - 1; i++ ) {
    const a = anchors[i], b = anchors[i + 1], l = len( sub( b, a ) );
    if ( l < 0.01 ) continue;
    const dip = dipOf( slack, l ), steps = Math.min( 64, Math.max( 1, Math.ceil( l / 2 ) ) );
    for ( let s = 1; s <= steps; s++ ) {
      const t = s / steps, p = lerp( a, b, t );
      p[1]   -= 4 * dip * t * ( 1 - t );
      out.push( p );
    }
  }
}

// The lift's pieces as its info has them ( the base and top stations, the mast if it has masts ).
type Parts = Pick<LiftInfo, "base" | "top"> & { mast?: LiftPartInfo };

/**
 * The cable: a closed loop up through the masts' up paths to the top station's route, back down their down paths
 * to the base's ( LiftGeometry.BuildLoop, for stations whose cable runs along a route ). Null when the pieces don't
 * have the routes for it.
**/
export function liftCable( o: ObjectEntry, parts: Parts, slack: number ): V3[] | null {
  const pieces = liftPieces( o );
  if ( !pieces ) return null;
  const route     = ( part: LiftPartInfo, piece: LiftPiece ) => chain( part.cable.route ?? [], piece, o.scale ).map( anchorAt );
  const baseRoute = route( parts.base, pieces.base ), topRoute = route( parts.top, pieces.top );
  if ( baseRoute.length < 2 || topRoute.length < 2 ) return null;
  const up: Anchor[] = [fixed( baseRoute[baseRoute.length - 1] )], down: Anchor[] = [fixed( topRoute[topRoute.length - 1] )];
  if ( parts.mast ) {
    for ( const m of pieces.masts ) up.push( ...chain( parts.mast.cable.up ?? [], m, o.scale ) );
    for ( let i = pieces.masts.length - 1; i >= 0; i-- ) down.push( ...chain( parts.mast.cable.down ?? [], pieces.masts[i], o.scale ) );
  }
  up.push( fixed( topRoute[0] ) );
  down.push( fixed( baseRoute[0] ) );
  const upPts      = solveStrand( up, slack ), downPts = solveStrand( down, slack );
  const loop: V3[] = [upPts[0]];
  spans( loop, upPts, slack );
  loop.push( ...topRoute.slice( 1 ) );
  spans( loop, downPts, slack );
  loop.push( ...baseRoute.slice( 1 ) );
  return loop;
}

/**
 * Where the cable comes into each station and leaves it ( its route's ends ), and the way it goes there: in towards the
 * station, out along the line. What the station's wheels roll with.
**/
export function liftStationEnds( o: ObjectEntry, parts: Parts ): Record<"base" | "top", { at: V3; dir: V3 }[]> | null {
  const pieces = liftPieces( o );
  if ( !pieces ) return null;
  const ends = ( part: LiftPartInfo, piece: LiftPiece ) => {
    const route = chain( part.cable.route ?? [], piece, o.scale ).map( anchorAt ), out = pieceDir( piece, [0, 0, 1] );
    return route.length < 2 ? [] : [{ at: route[0], dir: mul( out, -1 ) }, { at: route[route.length - 1], dir: out }];
  };
  return { base: ends( parts.base, pieces.base ), top: ends( parts.top, pieces.top ) };
}

/**
 * Masts spaced evenly up the line, about `interval` metres apart, on the ground ( LiftSetup.AutoPlaceMasts ): in the
 * lift's own space. `ground` gives the height at a world point ( NaN off the map ).
**/
export function autoMasts( o: ObjectEntry, ground: ( x: number, z: number ) => number, interval = 40 ): V3[] {
  if ( !o.lift ) return [];
  const start     = o.position, end = liftPoint( o, [o.lift.endPosition.x, o.lift.endPosition.y, o.lift.endPosition.z] );
  const count     = Math.floor( len( sub( end, start ) ) / Math.max( interval, 5 ) );
  const out: V3[] = [];
  for ( let i = 1; i <= count; i++ ) {
    const p = lerp( start, end, i / ( count + 1 ) ), g = ground( p[0], p[2] );
    if ( !Number.isNaN( g ) ) p[1] = g;
    out.push( liftLocal( o, p ) );
  }
  return out;
}

/**
 * The lift with its masts spaced afresh when it spaces them itself ( `liftAuto` ).
**/
export function withAutoMasts( o: ObjectEntry, ground: ( x: number, z: number ) => number ): ObjectEntry {
  if ( !o.lift || !o.liftAuto ) return o;
  return { ...o, lift: { ...o.lift, masts: autoMasts( o, ground, o.liftAuto ).map( ( m ) => ( { x: m[0], y: m[1], z: m[2] } ) ) } };
}

/**
 * The lift with its base station moved to `at` ( world ), its top station and masts staying where they are.
**/
export function withBaseAt( o: ObjectEntry, at: V3 ): ObjectEntry {
  if ( !o.lift ) return { ...o, position: at };
  const world = ( p: { x: number; y: number; z: number } ) => liftPoint( o, [p.x, p.y, p.z] );
  const top   = world( o.lift.endPosition ), masts = o.lift.masts.map( world );
  const moved = { ...o, position: at };
  const local = ( w: V3 ) => {
    const l = liftLocal( moved, w );
    return { x: l[0], y: l[1], z: l[2] };
  };
  return { ...moved, lift: { endPosition: local( top ), masts: masts.map( local ) } };
}

/**
 * Where a mast put at `local` ( the lift's own space ) goes in its list: in order up the line ( LiftSetup.InsertIndexFor ).
**/
export function mastIndexFor( o: ObjectEntry, local: V3 ): number {
  if ( !o.lift ) return 0;
  const line: V3 = [o.lift.endPosition.x, 0, o.lift.endPosition.z], l2 = dot( line, line );
  const T        = ( p: V3 ) => ( l2 > 1e-6 ? dot( [p[0], 0, p[2]], line ) / l2 : 0 );
  const t        = T( local );
  const i        = o.lift.masts.findIndex( ( m ) => T( [m.x, m.y, m.z] ) > t );
  return i < 0 ? o.lift.masts.length : i;
}
