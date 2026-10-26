// Brush tips and texture patterns for the paint engine: the round tip's falloff, generated tip shapes ( chalk,
// charcoal, spatter, bristle, sponge ) and tileable patterns ( noise, paper, canvas, dots ), and how a pattern masks a
// dab. After PhotoCraft's paint crate ( github.com/storytold/photocraft, Apache-2.0 / MIT: see THIRD_PARTY.md ): the
// round tip's measured core and shoulder, the generated tips and patterns, and the texture modes.

// A square greyscale bitmap, 1 = full paint.
export interface GrayTile {
  n:    number;
  data: Float32Array;
}

/**
 * Deterministic hash of an integer pair to 0..1.
**/
export function hash2( x: number, y: number, salt: number ) {
  let h = Math.imul( x | 0, 0x27d4eb2d ) ^ Math.imul( y | 0, 0x165667b1 ) ^ Math.imul( salt | 0, 0x9e3779b1 );
  h     = Math.imul( h ^ ( h >>> 15 ), 0x85ebca6b );
  h     = Math.imul( h ^ ( h >>> 13 ), 0xc2b2ae35 );
  return ( ( h ^ ( h >>> 16 ) ) >>> 0 ) / 4294967296;
}

const smooth  = ( t: number ) => t * t * ( 3 - 2 * t );
const clamp01 = ( v: number ) => ( v < 0 ? 0 : v > 1 ? 1 : v );

/**
 * Tileable value noise with `period` lattice cells.
**/
function valueNoise( x: number, y: number, period: number, salt: number ) {
  const x0 = Math.floor( x ), y0 = Math.floor( y );
  const tx = smooth( x - x0 ), ty = smooth( y - y0 );
  const h  = ( i: number, j: number ) => hash2( ( ( i % period ) + period ) % period, ( ( j % period ) + period ) % period, salt );
  const a  = h( x0, y0 ) + ( h( x0 + 1, y0 ) - h( x0, y0 ) ) * tx;
  const b  = h( x0, y0 + 1 ) + ( h( x0 + 1, y0 + 1 ) - h( x0, y0 + 1 ) ) * tx;
  return a + ( b - a ) * ty;
}

/**
 * Tileable fractal noise in 0..1 over a tile `size` across, `cells` lattice cells at the base octave.
**/
function fbm( x: number, y: number, size: number, cells: number, octaves: number, salt: number ) {
  let sum = 0, amp = 1, norm = 0, c = cells;
  for ( let o = 0; o < octaves; o++ ) {
    sum  += valueNoise( ( x / size ) * c, ( y / size ) * c, c, salt + o * 7919 ) * amp;
    norm += amp;
    amp  *= 0.5;
    c    *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------- the round tip

// Photoshop's round tip, as PhotoCraft measured it: a solid core of radius r0·R, then a Gaussian shoulder of width
// s·R, both by hardness 0, 0.1 … 1. A soft tip reaches past its radius.
const TIP_SHAPE: [number, number][] = [
  [0.0, 0.664], [0.14, 0.58], [0.28, 0.5], [0.4, 0.44], [0.52, 0.36], [0.63, 0.29], [0.7, 0.24], [0.78, 0.19], [0.84, 0.15], [0.89, 0.11], [1.0, 0.0],
];
// The edge never narrows below this many pixels ( a hard tip is a disc with a ~1 px soft edge ).
const EDGE_PX = 1.2;

/**
 * Core radius and shoulder width ( pixels ) of a round tip.
**/
export function tipShape( radius: number, hardness: number ): [number, number] {
  const h      = clamp01( Number.isNaN( hardness ) ? 0 : hardness ) * 10;
  const i      = Math.min( 9, Math.floor( h ) ), t = h - i;
  const [a, b] = [TIP_SHAPE[i], TIP_SHAPE[i + 1]];
  const r0     = a[0] + ( b[0] - a[0] ) * t, s = a[1] + ( b[1] - a[1] ) * t;
  const edge   = Math.max( 0.25, Math.min( EDGE_PX, 0.3 * radius ) );
  return [Math.max( 0, Math.min( r0 * radius, radius - edge ) ), Math.max( s * radius, edge, 1e-3 )];
}

/**
 * exp( -u ) as ( 1 - u/64 )^64: exactly 0 from u = 64.
**/
function softExp( u: number ) {
  let g = clamp01( 1 - u / 64 );
  for ( let k = 0; k < 6; k++ ) g *= g;
  return g;
}

/**
 * Coverage of a round tip `d` pixels from its centre.
**/
export function tipFalloff( d: number, radius: number, hardness: number ) {
  const [r0, s] = tipShape( radius, hardness );
  if ( d <= r0 ) return 1;
  const x = ( d - r0 ) / s;
  return softExp( x * x );
}

/**
 * How far a round tip still paints ( pixels ).
**/
export function tipReach( radius: number, hardness: number ) {
  const [r0, s] = tipShape( radius, hardness );
  return r0 + 2.6 * s;
}

/**
 * Wet Edges: lighter inside, the full colour at the rim ( `rn` = distance / radius ).
**/
export const wetFactor = ( rn: number ) => 0.5 + 0.5 * smooth( clamp01( ( rn - 0.5 ) / 0.5 ) );

// ---------------------------------------------------------------- generated tips

export type TipId = "round" | "chalk" | "charcoal" | "spatter" | "bristle" | "sponge";
export const TIPS: { id: TipId; label: string }[] = [
  { id: "round",    label: "Round"    },
  { id: "chalk",    label: "Chalk"    },
  { id: "charcoal", label: "Charcoal" },
  { id: "spatter",  label: "Spatter"  },
  { id: "bristle",  label: "Bristle"  },
  { id: "sponge",   label: "Sponge"   },
];

const TIP_N    = 128;
const tipCache = new Map<TipId, GrayTile>();

function tile( n: number, f: ( x: number, y: number ) => number ): GrayTile {
  const data = new Float32Array( n * n );
  for ( let y = 0; y < n; y++ ) for ( let x = 0; x < n; x++ ) data[y * n + x] = clamp01( f( x, y ) );
  return { n, data };
}

function makeTip( id: TipId, seed = 1 ): GrayTile {
  const n = TIP_N, c = n / 2;
  switch ( id ) {
    case "chalk": {
      const salt = seed + 101;
      return tile( n, ( x, y ) => {
        const dx     = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot( dx, dy ) / c;
        const edge   = 0.8 + 0.15 * valueNoise( ( Math.atan2( dy, dx ) + Math.PI ) * 3, 0.5, 19, salt );
        const inside = clamp01( ( edge - r ) * 8 );
        const grain  = hash2( x, y, salt );
        return inside * ( grain < 0.2 ? 0.2 : 0.7 + 0.3 * grain );
      } );
    }
    case "charcoal": {
      const salt = seed + 404;
      return tile( n, ( x, y ) => {
        const dx   = ( x + 0.5 - c ) / c, dy = ( y + 0.5 - c ) / c, r = Math.hypot( dx, dy * 1.6 );
        const edge = 0.85 + 0.15 * valueNoise( dx * 6 + 9, dy * 6 + 9, 64, salt );
        if ( r > edge ) return 0;
        const row = hash2( 0, y, salt ), along = valueNoise( x / 6, y / 1.5, 1 << 12, salt ^ 0x77 ), grit = hash2( x, y, salt ^ 0x13 );
        return ( 0.35 + 0.65 * row ) * ( 0.4 + 0.6 * along ) * ( grit < 0.15 ? 0.2 : 1 ) * clamp01( ( edge - r ) * 6 );
      } );
    }
    case "spatter": {
      const salt  = seed + 202, drops = 26;
      const blobs = Array.from( { length: drops }, ( _, i ) => {
        const a = hash2( i, 0, salt ) * Math.PI * 2, d = Math.sqrt( hash2( i, 1, salt ) ) * 0.38 * n, r = ( 0.03 + 0.09 * hash2( i, 2, salt ) ** 2 ) * n;
        return [n / 2 + Math.cos( a ) * d, n / 2 + Math.sin( a ) * d, r];
      } );
      return tile( n, ( x, y ) => blobs.reduce( ( acc, [bx, by, r] ) => Math.max( acc, clamp01( r + 0.5 - Math.hypot( x + 0.5 - bx, y + 0.5 - by ) ) ), 0 ) );
    }
    case "bristle": {
      const salt = seed + 303;
      return tile( n, ( x, y ) => {
        const dx = ( x + 0.5 - c ) / c, dy = ( y + 0.5 - c ) / c, r = Math.hypot( dx, dy * 1.8 );
        if ( r > 1 ) return 0;
        const hair = hash2( 0, Math.floor( y / 1.5 ), salt );
        return ( hair < 0.25 ? 0 : 0.5 + 0.5 * hair ) * ( 1 - r ** 4 );
      } );
    }
    case "sponge": {
      const salt = seed + 606;
      return tile( n, ( x, y ) => {
        const dx    = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot( dx, dy ) / c;
        const edge  = 0.78 + 0.2 * valueNoise( ( Math.atan2( dy, dx ) + Math.PI ) * 2.5, 0.5, 16, salt );
        const disc  = clamp01( ( edge - r ) * 6 );
        const pores = fbm( x, y, n, 6, 3, salt );
        return disc * clamp01( ( pores - 0.38 ) * 5 );
      } );
    }
    default:
      return tile( n, ( x, y ) => ( Math.hypot( x + 0.5 - c, y + 0.5 - c ) <= c ? 1 : 0 ) );
  }
}

/**
 * A generated tip ( made once ).
**/
export function tipTile( id: TipId ): GrayTile {
  let t = tipCache.get( id );
  if ( !t ) tipCache.set( id, ( t = makeTip( id ) ) );
  return t;
}

/**
 * A tile sampled at ( u, v ) in 0..1, bilinear; 0 outside.
**/
export function sampleTile( t: GrayTile, u: number, v: number ) {
  const fx = u * t.n - 0.5, fy = v * t.n - 0.5;
  if ( fx < -1 || fy < -1 || fx > t.n || fy > t.n ) return 0;
  const x0 = Math.floor( fx ), y0 = Math.floor( fy ), ax = fx - x0, ay = fy - y0;
  const at = ( x: number, y: number ) => ( x < 0 || y < 0 || x >= t.n || y >= t.n ? 0 : t.data[y * t.n + x] );
  return ( at( x0, y0 ) * ( 1 - ax ) + at( x0 + 1, y0 ) * ax ) * ( 1 - ay ) + ( at( x0, y0 + 1 ) * ( 1 - ax ) + at( x0 + 1, y0 + 1 ) * ax ) * ay;
}

// ---------------------------------------------------------------- patterns

export type PatternId = "noise" | "paper" | "canvas" | "dots";
export const PATTERNS: { id: PatternId; label: string }[] = [
  { id: "paper",  label: "Paper"  },
  { id: "noise",  label: "Noise"  },
  { id: "canvas", label: "Canvas" },
  { id: "dots",   label: "Dots"   },
];
const PATTERN_N    = 128;
const patternCache = new Map<PatternId, GrayTile>();

/**
 * A seamless pattern tile ( made once ).
**/
export function patternTile( id: PatternId, seed = 1 ): GrayTile {
  let t = patternCache.get( id );
  if ( t ) return t;
  const n = PATTERN_N, salt = seed * 0x01b3 + 17;
  t       = tile( n, ( x, y ) => {
    const fx = x + 0.5, fy = y + 0.5;
    switch ( id ) {
      case "noise":
        return fbm( fx, fy, n, 8, 4, salt );
      case "paper": {
        const base = fbm( fx, fy, n, 16, 4, salt );
        return ( base - 0.5 ) * 2.2 + 0.5 + ( hash2( x, y, salt ^ 0x55 ) - 0.5 ) * 0.35;
      }
      case "canvas": {
        const p    = 8, cx = Math.floor( fx / p ), cy = Math.floor( fy / p );
        const warp = Math.sin( Math.PI * ( ( fx / p ) % 1 ) ), weft = Math.sin( Math.PI * ( ( fy / p ) % 1 ) );
        return 0.25 + 0.65 * ( ( cx + cy ) % 2 === 0 ? warp : weft ) + ( hash2( x, y, salt ) - 0.5 ) * 0.15;
      }
      case "dots": {
        const p = 8, u = ( ( fx / p ) % 1 ) - 0.5, v = ( ( fy / p ) % 1 ) - 0.5;
        return 1 - smooth( clamp01( ( 0.35 - Math.hypot( u, v ) ) / 0.1 + 0.5 ) );
      }
    }
  } );
  patternCache.set( id, t );
  return t;
}

/**
 * A tiled pattern's value at pixel ( x, y ), its tile `scale` pixels across.
**/
export function patternAt( t: GrayTile, x: number, y: number, scale: number ) {
  const s  = t.n / Math.max( 1e-3, scale );
  const px = ( ( ( Math.floor( x * s ) % t.n ) + t.n ) % t.n ), py = ( ( ( Math.floor( y * s ) % t.n ) + t.n ) % t.n );
  return t.data[py * t.n + px];
}

export type TextureMode = "multiply" | "subtract" | "height";
export const TEXTURE_MODES: { value: TextureMode; label: string }[] = [
  { value: "multiply", label: "Multiply" },
  { value: "subtract", label: "Subtract" },
  { value: "height",   label: "Height"   },
];

/**
 * A dab's coverage `v` masked by a pattern value `t` at `depth` ( never paint where the dab has none ).
**/
export function textureCombine( mode: TextureMode, v: number, t: number, depth: number ) {
  if ( v <= 0 ) return 0;
  const r = mode === "multiply" ? v * ( 1 - depth + depth * t ) : mode === "subtract" ? v - depth * t : t >= 1 - depth * v ? v : 0;
  return clamp01( r );
}
