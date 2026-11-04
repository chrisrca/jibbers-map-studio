// Moving parts ( Map-Tools 0.5's ): parts of a piece that spin, swing or bob in the game, on the GPU — baked into its
// meshes at export ( src-tauri/src/project/motion.rs, the same sums ), turned here in the view by the same sums.
//
// What the game can do: each vertex one motion, about or along one axis — a steady spin, or a swing or a bob back and
// forth on a sine, its period and place in the cycle its own; the clock drives it ( no keyframes, nothing chained:
// a part riding on another can't add its own ), and it's only seen ( the colliders stay put ). A part is the piece's
// geometry inside a region ( a sphere, a cylinder or a box, in the piece's own space ): the loose parts of the mesh
// whose middles are in it ( Islands: a wheel modelled as its own shell ), or every vertex in it ( Vertices: a part
// welded to the rest ); regions it excludes taken out; no region, the whole piece.

import { create } from "zustand";
import type { V3 } from "../core/coords";

// The view's preview of moving parts: on or off, playing or held, and the time it shows ( seconds; the game's clock
// starts when the map loads, so where in a cycle a part is then is its phase ).
export const useMotionPreview = create<{ on: boolean; playing: boolean; t: number }>( () => ( { on: false, playing: true, t: 0 } ) );

export type MotionKind = "spin" | "swing" | "bob";

export interface MotionRegion {
  shape:  "sphere" | "cylinder" | "box";
  // the middle, in the piece's own space ( Unity's axes )
  center: V3;
  // a sphere's radius ( [0] ); a cylinder's radius and its length along the part's axis ( [0], [1] ); a box's sizes
  size:   V3;
}

export interface MovingPart {
  name:     string;
  kind:     MotionKind;
  // the piece's own axis it turns about or slides along
  axis:     "x" | "y" | "z";
  // what moves: the geometry in it ( null: the whole piece ), whole loose parts or single vertices, less what's in these
  region:   MotionRegion | null;
  capture:  "islands" | "vertices";
  exclude:  MotionRegion[];
  // where it turns from: the middle, top or bottom of what it captured, the piece's origin, or the region's middle
  pivot:    "center" | "top" | "bottom" | "origin" | "region";
  // spin: turns a second, and the other way
  speed:    number;
  reverse:  boolean;
  // swing: degrees to each side; bob: metres to each side; either: seconds for one back and forth
  angle:    number;
  distance: number;
  period:   number;
  // where in its cycle it starts ( 0..1 ); null: from where it is ( rows of them out of step )
  phase:    number | null;
}

// The game's limits ( MovingPartsBaker: a byte holds the swing's angle as a part of 180°, the bob's of 2.5 m ).
export const MAX_SWING = 180;
export const MAX_BOB   = 2.5;

export const newMovingPart = ( name = "Part" ): MovingPart => ( {
  name, kind: "spin", axis: "y", region: null, capture: "islands", exclude: [], pivot: "center",
  speed: 0.5, reverse: false, angle: 20, distance: 0.5, period: 4, phase: null,
} );

export const AXES: Record<MovingPart["axis"], V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/**
 * Cycles a second as the game runs them: a whole number per 1000 of drive ( drive is seconds at Auto Speed 1 ), signed
 * ( a spin the other way ).
**/
export function cyclesPerSecond( m: MovingPart ) {
  const per    = m.kind === "spin" ? 1 / Math.max( 1e-6, m.speed ) : Math.max( 1e-6, m.period );
  const cycles = Math.max( 1, Math.round( 1000 / per ) );
  return ( ( m.kind === "spin" && m.reverse ? -1 : 1 ) * cycles ) / 1000;
}

/**
 * The swing's angle or the bob's distance as the byte holds it ( 0..1 of the most ).
**/
export function amplitude( m: MovingPart ) {
  const a = m.kind === "swing" ? m.angle / MAX_SWING : m.kind === "bob" ? m.distance / MAX_BOB : 0;
  return Math.round( Math.max( 0, Math.min( 1, a ) ) * 255 ) / 255;
}

/**
 * Where in its cycle it starts, as a byte holds it: given, or from where its pivot is ( FNV over millimetres, as the
 * game's baker does ).
**/
export function phaseOf( m: MovingPart, pivot: V3 ) {
  if ( m.phase !== null ) return Math.round( Math.max( 0, Math.min( 1, m.phase ) ) * 255 ) / 255;
  let h = 2166136261;
  for ( const f of pivot ) {
    h ^= Math.round( f * 1000 ) >>> 0;
    h  = Math.imul( h, 16777619 ) >>> 0;
  }
  return Math.round( ( ( h & 0xffffff ) / 16777216 ) * 255 ) / 255;
}

/**
 * Whether a point ( the piece's own space ) is in a region; a cylinder runs along `axis`.
**/
export function inRegion( r: MotionRegion, p: V3, axis: V3 ) {
  const d: V3 = [p[0] - r.center[0], p[1] - r.center[1], p[2] - r.center[2]];
  if ( r.shape === "box" ) return Math.abs( d[0] ) <= r.size[0] / 2 && Math.abs( d[1] ) <= r.size[1] / 2 && Math.abs( d[2] ) <= r.size[2] / 2;
  if ( r.shape === "cylinder" ) {
    const along = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
    const off   = Math.hypot( d[0] - axis[0] * along, d[1] - axis[1] * along, d[2] - axis[2] * along );
    return Math.abs( along ) <= r.size[1] / 2 && off <= r.size[0];
  }
  return Math.hypot( d[0], d[1], d[2] ) <= r.size[0];
}

// A mesh as the capture sees it: its vertices in the piece's own space, and its triangles ( vertex indices, 3 each ).
export interface CaptureMesh {
  points: V3[];
  tris:   ArrayLike<number>;
}

/**
 * Each mesh's loose parts: an island number per vertex ( vertices at the same place joined: a mesh split along its UV
 * seams is still one part ).
**/
function islands( meshes: CaptureMesh[] ) {
  const offsets = meshes.map( ( _, k ) => meshes.slice( 0, k ).reduce( ( n, m ) => n + m.points.length, 0 ) );
  const total   = meshes.reduce( ( n, m ) => n + m.points.length, 0 );
  const up      = Int32Array.from( { length: total }, ( _, i ) => i );
  const find    = ( i: number ): number => {
    while ( up[i] !== i ) i = up[i] = up[up[i]];
    return i;
  };
  const join    = ( a: number, b: number ) => { const x = find( a ), y = find( b ); if ( x !== y ) up[x] = y; };
  const at      = new Map<string, number>();
  meshes.forEach( ( m, k ) => {
    const o = offsets[k];
    for ( let t = 0; t + 2 < m.tris.length; t += 3 ) { join( o + m.tris[t], o + m.tris[t + 1] ); join( o + m.tris[t], o + m.tris[t + 2] ); }
    m.points.forEach( ( p, i ) => {
      const key = `${Math.round( p[0] * 1e4 )},${Math.round( p[1] * 1e4 )},${Math.round( p[2] * 1e4 )}`, was = at.get( key );
      if ( was === undefined ) at.set( key, o + i );
      else join( was, o + i );
    } );
  } );
  return { offsets, id: Int32Array.from( { length: total }, ( _, i ) => find( i ) ) };
}

/**
 * Which part each vertex of each mesh moves with ( −1: none; the first part that takes it ), and each part's pivot ( the
 * piece's own space; null: it took nothing ).
**/
export function capture( parts: MovingPart[], meshes: CaptureMesh[], origin: V3 = [0, 0, 0] ) {
  const { offsets, id } = islands( meshes );
  const all             = meshes.flatMap( ( m ) => m.points );
  // each island's middle ( the mean of its vertices )
  const sum             = new Map<number, [number, number, number, number]>();
  all.forEach( ( p, i ) => {
    const s = sum.get( id[i] ) ?? [0, 0, 0, 0];
    sum.set( id[i], [s[0] + p[0], s[1] + p[1], s[2] + p[2], s[3] + 1] );
  } );
  const mid  = ( i: number ): V3 => { const s = sum.get( id[i] )!; return [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; };
  const part = new Int32Array( all.length ).fill( -1 );
  parts.forEach( ( m, k ) => {
    const axis = AXES[m.axis];
    // ( an excluded island: any of it in the region; an excluded vertex: in it )
    const out  = new Set<number>();
    if ( m.capture === "islands" ) all.forEach( ( p, i ) => { if ( m.exclude.some( ( r ) => inRegion( r, p, axis ) ) ) out.add( id[i] ); } );
    all.forEach( ( p, i ) => {
      if ( part[i] >= 0 ) return;
      if ( m.capture === "islands" ? out.has( id[i] ) : m.exclude.some( ( r ) => inRegion( r, p, axis ) ) ) return;
      if ( !m.region || inRegion( m.region, m.capture === "islands" ? mid( i ) : p, axis ) ) part[i] = k;
    } );
  } );
  const pivots = parts.map( ( m, k ): V3 | null => {
    let lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    all.forEach( ( p, i ) => {
      if ( part[i] !== k ) return;
      lo = [Math.min( lo[0], p[0] ), Math.min( lo[1], p[1] ), Math.min( lo[2], p[2] )];
      hi = [Math.max( hi[0], p[0] ), Math.max( hi[1], p[1] ), Math.max( hi[2], p[2] )];
    } );
    if ( lo[0] > hi[0] ) return null;
    const c: V3 = [( lo[0] + hi[0] ) / 2, ( lo[1] + hi[1] ) / 2, ( lo[2] + hi[2] ) / 2];
    switch ( m.pivot ) {
      case "top":    return [c[0], hi[1], c[2]];
      case "bottom": return [c[0], lo[1], c[2]];
      case "origin": return origin;
      case "region": return m.region ? m.region.center : c;
      default:       return c;
    }
  } );
  return { part: meshes.map( ( m, k ) => part.subarray( offsets[k], offsets[k] + m.points.length ) ), pivots };
}

/**
 * Where a point of a part ( the piece's own space ) is `t` seconds on: turned about its axis through the pivot, or slid
 * along it, as the game's shader does.
**/
export function moved( m: MovingPart, pivot: V3, t: number, p: V3 ): V3 {
  const axis = AXES[m.axis], cyc = cyclesPerSecond( m ), ph = m.kind === "spin" ? 0 : phaseOf( m, pivot );
  const f    = t * cyc + ph, a = ( f - Math.floor( f ) ) * Math.PI * 2;
  if ( m.kind === "bob" ) {
    const s = amplitude( m ) * MAX_BOB * Math.sin( a );
    return [p[0] + axis[0] * s, p[1] + axis[1] * s, p[2] + axis[2] * s];
  }
  return turned( m, a, pivot, p );
}

/**
 * A point turned about the part's axis through `pivot`, by its angle at cycle angle `a` ( Rodrigues' ). A direction
 * ( a normal ) turns the same way with the pivot at the origin.
**/
export function turned( m: MovingPart, a: number, pivot: V3, p: V3 ): V3 {
  const [x, y, z] = AXES[m.axis];
  const angle     = m.kind === "swing" ? amplitude( m ) * Math.PI * Math.sin( a ) : a;
  const c         = Math.cos( angle ), s = Math.sin( angle ), k = 1 - c;
  const v: V3     = [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]];
  const d         = x * v[0] + y * v[1] + z * v[2];
  return [
    pivot[0] + v[0] * c + ( y * v[2] - z * v[1] ) * s + x * d * k,
    pivot[1] + v[1] * c + ( z * v[0] - x * v[2] ) * s + y * d * k,
    pivot[2] + v[2] * c + ( x * v[1] - y * v[0] ) * s + z * d * k,
  ];
}

/**
 * The cycle angle a part is at `t` seconds on ( for turning its normals with it ).
**/
export function cycleAngle( m: MovingPart, pivot: V3, t: number ) {
  const f = t * cyclesPerSecond( m ) + ( m.kind === "spin" ? 0 : phaseOf( m, pivot ) );
  return ( f - Math.floor( f ) ) * Math.PI * 2;
}

export const movingPartsOf = ( o: object ): MovingPart[] => ( o as { motions?: MovingPart[] } ).motions ?? [];
