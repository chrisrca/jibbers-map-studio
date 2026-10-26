// Weathering a modelled piece's paint, as features get it: edge wear ( the paint worn off outward edges and scuffed on
// top, the metal underneath showing ), scratches ( thin strokes across the faces, mostly the ones riders land on,
// cut into the height ) and dirt ( gathered in inside corners and low down, streaking down the sides ). Each writes the
// piece's colour and its metallic, roughness and height maps as it says, in one undo step; a seed makes it repeatable.

import type { CustomObjectEntry } from "../core/types";
import type { ModelData } from "../model/build";
import { add, dot, edgesOf, faceCenter, faceNormal, len, mul, sub, type Mesh, type V3 } from "../model/mesh";
import { editChannels, prepare, texelsNear, type Channel, type TexelMap } from "./meshPaint";

type Piece = CustomObjectEntry & { model: ModelData };

export interface EdgeWear {
  // what's underneath ( sRGB 0..1 )
  colour: [number, number, number];
  // how far in from an edge it wears ( m )
  width:  number;
  // 0..1
  amount: number;
  // 0..1: scuffs on upward faces
  top:    number;
  // across the blotches ( m )
  scale:  number;
  // 0..1: how metal what's underneath is ( 0: the metallic map's left alone )
  metal:  number;
  // 0..1: how rough what's underneath is ( null: the roughness map's left alone )
  rough:  number | null;
  seed:   number;
}

export interface Scratches {
  colour: [number, number, number];
  // how many
  count:  number;
  // about how long each is ( m )
  length: number;
  // about how wide ( m )
  width:  number;
  // 0..1: how deep they cut into the height ( 0: the height's left alone )
  depth:  number;
  // 0..1: how much more on upward faces than others
  top:    number;
  metal:  number;
  rough:  number | null;
  seed:   number;
}

export interface Dirt {
  colour:  [number, number, number];
  // 0..1
  amount:  number;
  // how far out of an inside corner it reaches ( m )
  crevice: number;
  // 0..1: of the piece's height, from the bottom, that gets it
  bottom:  number;
  // 0..1: streaks down the sides
  streaks: number;
  // across its patches ( m )
  scale:   number;
  rough:   number | null;
  seed:    number;
}

export const DEFAULT_EDGE_WEAR: EdgeWear = {
  colour: [0.66, 0.67, 0.69],
  width:  0.05,
  amount: 0.8,
  top:    0.3,
  scale:  0.12,
  metal:  1,
  rough:  0.35,
  seed:   1,
};

export const DEFAULT_SCRATCHES: Scratches = {
  colour: [0.78, 0.79, 0.8],
  count:  120,
  length: 0.25,
  width:  0.006,
  depth:  0.4,
  top:    0.7,
  metal:  1,
  rough:  0.25,
  seed:   1,
};

export const DEFAULT_DIRT: Dirt = {
  colour:  [0.24, 0.2, 0.16],
  amount:  0.7,
  crevice: 0.08,
  bottom:  0.25,
  streaks: 0.4,
  scale:   0.2,
  rough:   0.9,
  seed:    1,
};

// ---------------------------------------------------------------- helpers

/**
 * Smooth 3D value noise in 0..1.
**/
function noise3( x: number, y: number, z: number ) {
  const h = ( i: number, j: number, k: number ) => {
    let a = Math.imul( i, 0x27d4eb2d ) ^ Math.imul( j, 0x165667b1 ) ^ Math.imul( k, 0x9e3779b1 );
    a     = Math.imul( a ^ ( a >>> 15 ), 0x85ebca6b );
    return ( ( a ^ ( a >>> 13 ) ) >>> 0 ) / 4294967296;
  };
  const xi = Math.floor( x ), yi = Math.floor( y ), zi = Math.floor( z );
  const s  = ( t: number ) => t * t * ( 3 - 2 * t );
  const fx = s( x - xi ), fy = s( y - yi ), fz = s( z - zi );
  const l  = ( a: number, b: number, t: number ) => a + ( b - a ) * t;
  return l(
    l( l( h( xi, yi, zi ), h( xi + 1, yi, zi ), fx ), l( h( xi, yi + 1, zi ), h( xi + 1, yi + 1, zi ), fx ), fy ),
    l( l( h( xi, yi, zi + 1 ), h( xi + 1, yi, zi + 1 ), fx ), l( h( xi, yi + 1, zi + 1 ), h( xi + 1, yi + 1, zi + 1 ), fx ), fy ),
    fz,
  );
}
const fbm3 = ( x: number, y: number, z: number ) => noise3( x, y, z ) * 0.55 + noise3( x * 2.1, y * 2.1, z * 2.1 ) * 0.3 + noise3( x * 4.3, y * 4.3, z * 4.3 ) * 0.15;

const smooth = ( a: number, b: number, x: number ) => {
  const t = Math.max( 0, Math.min( 1, ( x - a ) / ( b - a ) ) );
  return t * t * ( 3 - 2 * t );
};

/**
 * A small seeded random ( mulberry32 ).
**/
function random( seed: number ) {
  let a = Math.floor( seed * 2654435761 ) >>> 0 || 1;
  return () => {
    a     = ( a + 0x6d2b79f5 ) >>> 0;
    let t = a;
    t     = Math.imul( t ^ ( t >>> 15 ), t | 1 );
    t    ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );
    return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;
  };
}

/**
 * The edges where faces meet outward ( `convex` ) or inward, and open borders ( as outward ).
**/
function edgesBy( g: Mesh, convex: boolean ): [V3, V3][] {
  const out: [V3, V3][] = [];
  for ( const e of edgesOf( g ).values() ) {
    if ( e.faces.length !== 2 ) {
      if ( convex ) out.push( [g.v[e.a], g.v[e.b]] );
      continue;
    }
    const [f1, f2] = e.faces, n1 = faceNormal( g, f1 ), n2 = faceNormal( g, f2 );
    // ( near flat: no edge to speak of )
    if ( dot( n1, n2 ) > Math.cos( Math.PI / 9 ) ) continue;
    // the other face behind this one's plane: they meet outward
    const out1 = dot( n1, sub( faceCenter( g, f2 ), faceCenter( g, f1 ) ) ) < 0;
    if ( out1 === convex ) out.push( [g.v[e.a], g.v[e.b]] );
  }
  return out;
}

/**
 * Each texel's distance to the nearest of `segs` ( Infinity beyond `reach` ).
**/
function distanceTo( map: TexelMap, segs: [V3, V3][], reach: number ) {
  const n = map.n, d = new Float32Array( n * n ).fill( Infinity );
  for ( const [a, b] of segs ) {
    const ab  = sub( b, a ), l2 = Math.max( 1e-12, dot( ab, ab ) );
    const mid = mul( add( a, b ), 0.5 ), half = Math.sqrt( l2 ) / 2;
    texelsNear( map, mid, half + reach, ( k ) => {
      const p: V3 = [map.pos[k * 3], map.pos[k * 3 + 1], map.pos[k * 3 + 2]];
      const t     = Math.max( 0, Math.min( 1, dot( sub( p, a ), ab ) / l2 ) );
      const dd    = len( sub( p, add( a, mul( ab, t ) ) ) );
      if ( dd < d[k] ) d[k] = dd;
    } );
  }
  return d;
}

/**
 * The channels a weathering writes.
**/
function channelsFor( w: { metal?: number; rough: number | null; depth?: number } ): Channel[] {
  const chs: Channel[] = ["colour"];
  if ( w.metal !== undefined && w.metal > 0 ) chs.push( "metallic" );
  if ( w.rough !== null ) chs.push( "roughness" );
  if ( w.depth !== undefined && w.depth > 0 ) chs.push( "height" );
  return chs;
}

/**
 * `cover` ( 0..1 per texel ) laid on: the colour ( and metal, roughness, height ) taken towards what it says.
**/
function lay( px: Partial<Record<Channel, Uint8Array>>, map: TexelMap, cover: Float32Array, w: { colour: [number, number, number]; metal?: number; rough: number | null; depth?: number } ) {
  const n = map.n;
  for ( let k = 0; k < n * n; k++ ) {
    const c = cover[k];
    if ( !map.used[k] || c <= 0.004 ) continue;
    const to = ( arr: Uint8Array, v: number ) => {
      for ( let i = 0; i < 3; i++ ) arr[k * 4 + i] = Math.round( arr[k * 4 + i] + ( v * 255 - arr[k * 4 + i] ) * c );
    };
    const rgb = px.colour!;
    for ( let i = 0; i < 3; i++ ) rgb[k * 4 + i] = Math.round( rgb[k * 4 + i] + ( w.colour[i] * 255 - rgb[k * 4 + i] ) * c );
    if ( px.metallic  && w.metal ) to( px.metallic, w.metal );
    if ( px.roughness && w.rough !== null ) to( px.roughness, w.rough );
    if ( px.height && w.depth ) {
      const h = px.height, v = Math.max( 0, h[k * 4] - w.depth * 120 * c );
      for ( let i = 0; i < 3; i++ ) h[k * 4 + i] = Math.round( v );
    }
  }
}

/**
 * About how wide one texel is on the piece ( m ).
**/
function texelSize( g: Mesh, map: TexelMap ) {
  let area = 0;
  g.f.forEach( ( f ) => {
    for ( let i = 1; i + 1 < f.length; i++ ) {
      const a = g.v[f[0]], b = sub( g.v[f[i]], a ), c = sub( g.v[f[i + 1]], a );
      area   += len( [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]] ) / 2;
    }
  } );
  let used = 0;
  for ( let k = 0; k < map.n * map.n; k++ ) if ( map.used[k] === 1 ) used++;
  return Math.sqrt( area / Math.max( 1, used ) );
}

// ---------------------------------------------------------------- the three

/**
 * Paint worn off the outward edges, in ragged blotches, and scuffed on the faces that face up.
**/
export function edgeWear( o: Piece, w: EdgeWear ) {
  const { g, map } = prepare( o );
  const n          = map.n, edge = distanceTo( map, edgesBy( g, true ), w.width * 2 );
  const s          = 1 / Math.max( 0.01, w.scale ), off = w.seed * 17.31;
  const cover      = new Float32Array( n * n );
  for ( let k = 0; k < n * n; k++ ) {
    if ( !map.used[k] ) continue;
    const x    = map.pos[k * 3] + off, y = map.pos[k * 3 + 1], z = map.pos[k * 3 + 2];
    const nz   = fbm3( x * s, y * s, z * s );
    const near = edge[k] === Infinity ? 0 : 1 - Math.min( 1, edge[k] / Math.max( 1e-4, w.width ) );
    let c      = smooth( 0.45, 0.6, near * 0.9 + ( nz - 0.5 ) * 0.9 ) * w.amount;
    const up   = map.nrm[k * 3 + 1];
    if ( up > 0.6 && w.top > 0 ) c = Math.max( c, smooth( 0.62, 0.7, fbm3( x * s * 2.5, y * s * 2.5, z * s * 2.5 ) + ( w.top - 0.5 ) * 0.4 ) * w.top * smooth( 0.6, 0.9, up ) );
    cover[k] = c;
  }
  editChannels( o, "Edge Wear", channelsFor( w ), ( px ) => lay( px, map, cover, w ) );
}

/**
 * Thin strokes across the faces, each tapering at its ends, more on those that face up.
**/
export function scratches( o: Piece, w: Scratches ) {
  const { g, map }     = prepare( o );
  const n              = map.n, rnd = random( w.seed ), cover = new Float32Array( n * n );
  // ( never thinner than a texel: it wouldn't show )
  const minW           = texelSize( g, map ) * 0.8;
  const used: number[] = [];
  for ( let k = 0; k < n * n; k++ ) if ( map.used[k] === 1 ) used.push( k );
  if ( !used.length ) return;
  for ( let i = 0; i < w.count; i++ ) {
    // where: any face, the upward ones more likely
    let k = used[Math.floor( rnd() * used.length )];
    for ( let tries = 0; tries < 8; tries++ ) {
      const up = Math.max( 0, map.nrm[k * 3 + 1] );
      if ( rnd() < 1 - w.top + w.top * up ) break;
      k = used[Math.floor( rnd() * used.length )];
    }
    const p: V3 = [map.pos[k * 3], map.pos[k * 3 + 1], map.pos[k * 3 + 2]], N: V3 = [map.nrm[k * 3], map.nrm[k * 3 + 1], map.nrm[k * 3 + 2]];
    // which way: across the face
    let d: V3   = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
    d           = sub( d, mul( N, dot( d, N ) ) );
    const dl    = len( d );
    if ( dl < 1e-6 ) continue;
    d       = mul( d, 1 / dl );
    const L = w.length * ( 0.4 + rnd() * 1.2 ), W = Math.max( minW, w.width * ( 0.5 + rnd() ) ), strength = 0.55 + rnd() * 0.45;
    const a = sub( p, mul( d, L / 2 ) );
    texelsNear( map, p, L / 2 + W, ( k2 ) => {
      if ( map.nrm[k2 * 3] * N[0] + map.nrm[k2 * 3 + 1] * N[1] + map.nrm[k2 * 3 + 2] * N[2] < 0.5 ) return;
      const q: V3  = [map.pos[k2 * 3], map.pos[k2 * 3 + 1], map.pos[k2 * 3 + 2]];
      const t      = Math.max( 0, Math.min( 1, dot( sub( q, a ), d ) / L ) );
      const across = len( sub( q, add( a, mul( d, t * L ) ) ) );
      // thinner to its ends
      const half   = W * Math.sqrt( Math.sin( Math.PI * t ) );
      if ( half <= 0 || across >= half ) return;
      const v = ( 1 - across / half ) * strength;
      if ( v > cover[k2] ) cover[k2] = v;
    } );
  }
  editChannels( o, "Scratches", channelsFor( w ), ( px ) => lay( px, map, cover, w ) );
}

/**
 * Grime in the inside corners and low down, in patches, streaking down the sides.
**/
export function dirt( o: Piece, w: Dirt ) {
  const { g, map } = prepare( o );
  const n          = map.n, corner = distanceTo( map, edgesBy( g, false ), w.crevice * 2 );
  let lo           = Infinity, hi = -Infinity;
  for ( const v of g.v ) { lo = Math.min( lo, v[1] ); hi = Math.max( hi, v[1] ); }
  const span  = Math.max( 1e-3, hi - lo ), s = 1 / Math.max( 0.01, w.scale ), off = w.seed * 23.7;
  const cover = new Float32Array( n * n );
  for ( let k = 0; k < n * n; k++ ) {
    if ( !map.used[k] ) continue;
    const x        = map.pos[k * 3] + off, y = map.pos[k * 3 + 1], z = map.pos[k * 3 + 2];
    const patch    = fbm3( x * s, y * s, z * s );
    // inside corners
    const inCorner = corner[k] === Infinity ? 0 : 1 - Math.min( 1, corner[k] / Math.max( 1e-4, w.crevice ) );
    let c          = smooth( 0.3, 0.75, inCorner * 0.85 + ( patch - 0.5 ) * 0.6 );
    // low down
    const h        = ( y - lo ) / span;
    if ( w.bottom > 0 ) c = Math.max( c, smooth( w.bottom, 0, h ) * smooth( 0.25, 0.65, patch + 0.15 ) );
    // streaks down the sides
    const side = 1 - Math.abs( map.nrm[k * 3 + 1] );
    if ( w.streaks > 0 && side > 0.5 ) {
      const st = fbm3( x * s * 6, y * s * 0.35, z * s * 6 );
      c        = Math.max( c, smooth( 0.62, 0.78, st ) * w.streaks * smooth( 0.5, 0.9, side ) * ( 0.4 + 0.6 * ( 1 - h ) ) );
    }
    cover[k] = Math.min( 1, c * w.amount );
  }
  editChannels( o, "Dirt", channelsFor( w ), ( px ) => lay( px, map, cover, w ) );
}
