// The paint engine's stroke, over any tiled RGBA image ( the snow's colour layer now; a piece's texture later ). Units
// are the image's pixels. After PhotoCraft's stroke model ( github.com/storytold/photocraft, see THIRD_PARTY.md ):
//
//  * Paint and Clone build a stroke layer: each dab adds `flow` of the way to the stroke's strength ( c ← c + k( top −
//    c ) ), so going over a spot again in one stroke deepens it up to the strength and never past; the layer is blended
//    over what was there before the stroke in the blend mode.
//  * Smudge, Blur and Sharpen work dab after dab on the pixels as they are ( each dab sees the last one's work ).

import type { PaintBrush } from "../brush";
import { hash2, patternAt, patternTile, sampleTile, textureCombine, tipFalloff, tipReach, tipTile, wetFactor } from "../tips";
import { type BlendMode, type RGB, blendColour, hsvOf, rgbOfHsv } from "./blend";

export { type BlendMode, BLEND_MODES, blendColour } from "./blend";

// Square RGBA8 tiles ( straight alpha ), addressed by tile column and row.
export interface TileStore {
  readonly size: number;
  get(  tx: number, ty: number ): Uint8Array | null;
  // the tile, made ( all clear ) if there isn't one
  make( tx: number, ty: number ): Uint8Array;
  // pixels x0..x1, y0..y1 ( inclusive, the tile's own ) changed
  changed( tx: number, ty: number, rect: [number, number, number, number] ): void;
}

export type StrokeKind = "paint" | "smudge" | "blur" | "sharpen" | "clone";

export interface StrokeOptions {
  kind:         StrokeKind;
  brush:        PaintBrush;
  // pixels
  radius:       number;
  hardness:     number;
  // the stroke's opacity ( Paint, Clone ) or the effect's strength
  strength:     number;
  mode:         BlendMode;
  colour:       RGB;
  colour2:      RGB;
  // Clone: the source is this many pixels from where it paints
  cloneOffset?: [number, number];
  // Paint: each pixel's own colour and cover ( a stencil's ), null where nothing goes
  source?:      ( gx: number, gy: number ) => [number, number, number, number] | null;
  // pixels across one repeat of the brush's pattern
  patternPx:    number;
  // what's under a pixel nothing is painted on ( the snow ), for the blend modes
  base:         RGB;
  seed?:        number;
  // Which of the image's pixels a dab covers, when they aren't simply the ones round it: given the dab ( its centre
  // and radius in the units the stroke moves in ), how far its tip reaches, and its coverage at an offset from its
  // centre for a pixel, calls `f` for each pixel it covers.
  cover?:       ( d: DabInfo, reach: number, at: ( dx: number, dy: number, gx: number, gy: number ) => number, f: ( gx: number, gy: number, cov: number ) => void ) => void;
}

// A dab as `cover` sees it.
export interface DabInfo {
  x: number;
  y: number;
  r: number;
}

// A point of the pointer's path: pixels, pen pressure 0..1.
export interface StrokePoint {
  x:        number;
  y:        number;
  pressure: number;
}

interface Dab {
  x:         number;
  y:         number;
  r:         number;
  angle:     number;
  roundness: number;
  // the stroke's opacity at this dab
  top:       number;
  colour:    RGB;
  // worked out once for the dab ( coverAt )
  k?:        { ro: number; rm: number; cs: number; sn: number; reach: number };
}

const clamp01 = ( v: number ) => ( v < 0 ? 0 : v > 1 ? 1 : v );

const NOISE_SALT = 0x6e6f;

/**
 * A tile's key by its column and row ( from −4096 ).
**/
const tileKey = ( tx: number, ty: number ) => ( tx + 4096 ) * 16384 + ( ty + 4096 );

export class EngineStroke {
  // each touched tile as it was before the stroke ( null: the stroke made it )
  readonly before = new Map<number, Uint8Array | null>();
  // the stroke layer per tile ( Paint, Clone ): premultiplied RGB and alpha
  private layer   = new Map<number, Float32Array>();
  private o:    StrokeOptions;
  private seed: number;
  private index = 0;
  // the brush ( the pulled string's end ) and the pointer
  private at: StrokePoint | null      = null;
  private pointer: StrokePoint | null = null;
  // distance along the path since the last dab
  private since   = 0;
  private dir     = 0;
  private airTime = 0;
  // Smudge's carried paint: premultiplied, centred on the dab
  private carry: Float32Array | null = null;
  private carryR = 0;
  changedAny     = false;

  constructor( private store: TileStore, opts: StrokeOptions ) {
    this.o    = { ...opts, radius: Math.max( 0.5, opts.radius ) };
    this.seed = opts.seed ?? Math.floor( Math.random() * 1e9 );
  }

  /**
   * Follows the pointer: dabs every `spacing` of the brush's path ( behind the pointer with smoothing ).
  **/
  move( p: StrokePoint ) {
    this.pointer = p;
    if ( !this.at ) {
      this.at = { ...p };
      this.dabAt( this.at );
      return;
    }
    const L  = this.o.brush.smoothing * this.o.radius;
    const dx = p.x - this.at.x, dy = p.y - this.at.y, d = Math.hypot( dx, dy );
    if ( d <= L || d < 1e-6 ) return;
    // the string pulled taut: the brush moves up to L behind the pointer
    this.travel( { x: this.at.x + ( dx * ( d - L ) ) / d, y: this.at.y + ( dy * ( d - L ) ) / d, pressure: p.pressure } );
  }

  /**
   * The pointer has rested for `ms`: the airbrush keeps painting.
  **/
  hold( ms: number ) {
    const rate = this.o.brush.airbrush;
    if ( !rate || !this.at || this.o.kind !== "paint" ) return;
    this.airTime += ( ms / 1000 ) * rate;
    for ( ; this.airTime >= 1; this.airTime-- ) this.dabAt( this.at );
  }

  /**
   * The stroke's end: the brush catches up with the pointer.
  **/
  end() {
    if ( this.at && this.pointer && ( this.pointer.x !== this.at.x || this.pointer.y !== this.at.y ) ) this.travel( this.pointer );
  }

  private travel( to: StrokePoint ) {
    const from = this.at!;
    const dx   = to.x - from.x, dy = to.y - from.y, d = Math.hypot( dx, dy );
    if ( d < 1e-6 ) return;
    this.dir   = Math.atan2( dy, dx );
    const step = Math.max( 0.5, this.o.brush.spacing * 2 * this.o.radius );
    let t      = step - this.since;
    while ( t <= d ) {
      const f = t / d;
      this.dabAt( { x: from.x + dx * f, y: from.y + dy * f, pressure: from.pressure + ( to.pressure - from.pressure ) * f } );
      t += step;
    }
    this.since = d - ( t - step );
    this.at    = { ...to };
  }

  /**
   * The dabs at one spacing step ( count of them, scattered ), with their dynamics.
  **/
  private dabAt( p: StrokePoint ) {
    const b        = this.o.brush, R = this.o.radius;
    const rnd      = ( k: number ) => hash2( this.index, k, this.seed );
    const pressure = clamp01( p.pressure );
    for ( let c = 0; c < Math.max( 1, Math.round( b.count ) ); c++, this.index++ ) {
      let size = b.pressureSize ? b.minSize + ( 1 - b.minSize ) * pressure : 1;
      size    *= 1 - b.sizeJitter * rnd( 1 );
      if ( b.pressureSize || b.sizeJitter ) size = Math.max( b.minSize, size );
      let x = p.x, y = p.y;
      if ( b.scatter > 0 ) {
        const amount = b.scatter * 2 * R;
        if ( b.scatterBothAxes ) {
          const a = rnd( 4 ) * Math.PI * 2, r = Math.sqrt( rnd( 5 ) ) * amount;
          x      += Math.cos( a ) * r;
          y      += Math.sin( a ) * r;
        } else {
          const off = ( rnd( 4 ) * 2 - 1 ) * amount;
          x        += -Math.sin( this.dir ) * off;
          y        += Math.cos( this.dir ) * off;
        }
      }
      let colour = this.o.colour;
      if ( b.secondJitter > 0 ) {
        const t = rnd( 6 ) * b.secondJitter;
        colour  = colour.map( ( v, k ) => v + ( this.o.colour2[k] - v ) * t ) as RGB;
      }
      if ( b.hueJitter || b.saturationJitter || b.valueJitter ) {
        const [h, s, v] = hsvOf( ...colour );
        colour          = rgbOfHsv( h + ( rnd( 7 ) * 2 - 1 ) * b.hueJitter * 0.5, clamp01( s * ( 1 + ( rnd( 8 ) * 2 - 1 ) * b.saturationJitter ) ), clamp01( v * ( 1 + ( rnd( 9 ) * 2 - 1 ) * b.valueJitter ) ) );
      }
      this.dab( {
        x, y,
        r:         R * size,
        angle:     ( ( b.angle + ( rnd( 2 ) * 2 - 1 ) * b.angleJitter * 180 ) * Math.PI ) / 180 + ( b.followStroke ? this.dir : 0 ),
        roundness: Math.max( 0.05, b.roundness * ( 1 - b.roundnessJitter * rnd( 3 ) ) ),
        top:       this.o.strength * ( b.pressureOpacity ? pressure : 1 ),
        colour,
      } );
    }
  }

  /**
   * How far from a dab's centre its tip can reach ( in the dab's units ).
  **/
  private reachOf( d: Dab ) {
    const ro = d.roundness, rm = Math.max( 0.5, d.r * ro );
    return ( this.o.brush.tip === "round" ? tipReach( rm, this.o.hardness ) : rm ) / ro + 1;
  }

  /**
   * A dab's coverage at an offset ( dx, dy ) from its centre, for the image's pixel ( gx, gy ): tip × noise ×
   * texture × wet edges × flow.
  **/
  private coverAt( d: Dab, dx: number, dy: number, gx: number, gy: number ) {
    const b  = this.o.brush, hard = this.o.hardness;
    // ( worked out once a dab: this runs for every pixel under it )
    const k  = ( d.k ??= { ro: d.roundness, rm: Math.max( 0.5, d.r * d.roundness ), cs: Math.cos( d.angle ), sn: Math.sin( d.angle ), reach: this.reachOf( d ) * d.roundness } );
    const ro = k.ro, rm = k.rm, cs = k.cs, sn = k.sn;
    // in the tip's own frame: turned by its angle
    const u  = dx * cs + dy * sn, v = -dx * sn + dy * cs;
    let val: number, rn: number;
    if ( b.tip !== "round" ) {
      const s = sampleTile( tipTile( b.tip ), u / ( 2 * d.r ) + 0.5, v / ro / ( 2 * d.r ) + 0.5 );
      val     = s;
      rn      = 1 - s;
    } else {
      const dd = Math.hypot( u * ro, v );
      if ( dd > k.reach ) return 0;
      val = tipFalloff( dd, rm, hard );
      rn  = dd / rm;
    }
    if ( val <= 0.001 ) return 0;
    if ( b.noise && val < 1 ) val += ( ( hash2( gx, gy, NOISE_SALT ) < val ? 1 : 0 ) - val ) * 0.7;
    if ( b.pattern !== "none" ) {
      const t = patternAt( patternTile( b.pattern ), gx, gy, this.o.patternPx );
      val     = textureCombine( b.patternMode, val, b.patternInvert ? 1 - t : t, b.patternDepth );
    }
    if ( b.wetEdges ) val *= wetFactor( rn );
    const cov = val * b.flow;
    return cov > 0.0005 ? cov : 0;
  }

  /**
   * Calls `f` for every pixel the dab covers, with its coverage: the image's pixels round the dab, or ( with a
   * `cover` of the options' ) whichever pixels it finds, such as a piece's texture under a dab on the screen.
  **/
  private cover( d: Dab, f: ( gx: number, gy: number, cov: number ) => void ) {
    if ( this.o.cover ) return this.o.cover( d, this.reachOf( d ), ( dx, dy, gx, gy ) => this.coverAt( d, dx, dy, gx, gy ), f );
    const reach = this.reachOf( d );
    for ( let gy = Math.floor( d.y - reach ); gy <= Math.ceil( d.y + reach ); gy++ )
      for ( let gx = Math.floor( d.x - reach ); gx <= Math.ceil( d.x + reach ); gx++ ) {
        const cov = this.coverAt( d, gx + 0.5 - d.x, gy + 0.5 - d.y, gx, gy );
        if ( cov ) f( gx, gy, cov );
      }
  }

  private dab( d: Dab ) {
    switch ( this.o.kind ) {
      case "smudge":  return this.smudge( d );
      case "blur":
      case "sharpen": return this.filter( d );
      default:        return this.paint( d );
    }
  }

  // the tile the last pixel was in ( a dab's pixels are mostly in one )
  private lastTile: { key: number; tx: number; ty: number; px: Uint8Array; i: number; j: number } | null = null;
  private tileOf( gx: number, gy: number, make: boolean ) {
    const S    = this.store.size, tx = Math.floor( gx / S ), ty = Math.floor( gy / S ), key = tileKey( tx, ty );
    const last = this.lastTile;
    if ( last && last.key === key ) return ( ( last.i = gx - tx * S ), ( last.j = gy - ty * S ), last );
    let px = this.store.get( tx, ty );
    if ( !this.before.has( key ) ) {
      if ( !px && !make ) return null;
      this.before.set( key, px ? px.slice() : null );
    }
    if ( !px ) {
      if ( !make ) return null;
      px = this.store.make( tx, ty );
    }
    return ( this.lastTile = { key, tx, ty, px, i: gx - tx * S, j: gy - ty * S } );
  }
  /**
   * The pixel as it was before the stroke ( straight RGBA 0..1; clear where nothing was ).
  **/
  private original( gx: number, gy: number ): [number, number, number, number] {
    const S  = this.store.size, tx = Math.floor( gx / S ), ty = Math.floor( gy / S ), key = tileKey( tx, ty );
    const px = this.before.has( key ) ? this.before.get( key ) : this.store.get( tx, ty );
    if ( !px ) return [0, 0, 0, 0];
    const o = ( ( gy - ty * S ) * S + gx - tx * S ) * 4;
    return [px[o] / 255, px[o + 1] / 255, px[o + 2] / 255, px[o + 3] / 255];
  }

  // Collects the changed rectangle of each tile a dab touched, and reports them.
  private touched = new Map<number, { tx: number; ty: number; r: [number, number, number, number] }>();
  private mark( key: number, tx: number, ty: number, i: number, j: number ) {
    const t = this.touched.get( key );
    if ( !t ) this.touched.set( key, { tx, ty, r: [i, j, i, j] } );
    else {
      if ( i < t.r[0] ) t.r[0] = i;
      if ( j < t.r[1] ) t.r[1] = j;
      if ( i > t.r[2] ) t.r[2] = i;
      if ( j > t.r[3] ) t.r[3] = j;
    }
  }
  private report() {
    for ( const t of this.touched.values() ) this.store.changed( t.tx, t.ty, t.r );
    if ( this.touched.size ) this.changedAny = true;
    this.touched.clear();
  }

  private paint( d: Dab ) {
    const S   = this.store.size, mode = this.o.mode, erase = mode === "erase", base = this.o.base;
    const off = this.o.kind === "clone" ? this.o.cloneOffset ?? [0, 0] : null;
    this.cover( d, ( gx, gy, cov ) => {
      const T = this.tileOf( gx, gy, !erase );
      if ( !T ) return;
      let L = this.layer.get( T.key );
      if ( !L ) this.layer.set( T.key, ( L = new Float32Array( S * S * 4 ) ) );
      const q = ( T.j * S + T.i ) * 4;
      // what this dab lays down: the brush's colour, or ( Clone ) the source's pixel
      let r   = d.colour[0], g = d.colour[1], b = d.colour[2], a = 1;
      if ( off ) [r, g, b, a] = this.original( gx + off[0], gy + off[1] );
      else if ( this.o.source && !erase ) {
        const s = this.o.source( gx, gy );
        if ( !s ) return;
        [r, g, b, a] = s;
      }
      const k   = cov;
      L[q]     += k * ( d.top * a * r - L[q] );
      L[q + 1] += k * ( d.top * a * g - L[q + 1] );
      L[q + 2] += k * ( d.top * a * b - L[q + 2] );
      L[q + 3] += k * ( d.top * a - L[q + 3] );
      // the layer over the pixel as it was
      const A   = L[q + 3], [or, og, ob, oa] = this.original( gx, gy ), o = q;
      if ( erase ) {
        T.px[o + 3] = Math.round( oa * ( 1 - A ) * 255 );
        T.px[o]     = Math.round( or * 255 );
        T.px[o + 1] = Math.round( og * 255 );
        T.px[o + 2] = Math.round( ob * 255 );
      } else {
        const s:     RGB = A > 1e-6 ? [L[q] / A, L[q + 1] / A, L[q + 2] / A] : [0, 0, 0];
        const under: RGB = [or * oa + base[0] * ( 1 - oa ), og * oa + base[1] * ( 1 - oa ), ob * oa + base[2] * ( 1 - oa )];
        const c          = mode === "mix" ? s : blendColour( mode, under, s );
        const outA       = A + oa * ( 1 - A );
        if ( outA > 0 ) {
          T.px[o]     = Math.round( clamp01( ( c[0] * A + or * oa * ( 1 - A ) ) / outA ) * 255 );
          T.px[o + 1] = Math.round( clamp01( ( c[1] * A + og * oa * ( 1 - A ) ) / outA ) * 255 );
          T.px[o + 2] = Math.round( clamp01( ( c[2] * A + ob * oa * ( 1 - A ) ) / outA ) * 255 );
        }
        T.px[o + 3] = Math.round( outA * 255 );
      }
      this.mark( T.key, T.tx, T.ty, T.i, T.j );
    } );
    this.report();
  }

  /**
   * The pixel now, premultiplied ( clear where there's no tile ).
  **/
  private now( gx: number, gy: number ): [number, number, number, number] {
    const S = this.store.size, tx = Math.floor( gx / S ), ty = Math.floor( gy / S ), px = this.store.get( tx, ty );
    if ( !px ) return [0, 0, 0, 0];
    const o = ( ( gy - ty * S ) * S + gx - tx * S ) * 4, a = px[o + 3] / 255;
    return [( px[o] / 255 ) * a, ( px[o + 1] / 255 ) * a, ( px[o + 2] / 255 ) * a, a];
  }
  private put( gx: number, gy: number, c: [number, number, number, number] ) {
    const T = this.tileOf( gx, gy, c[3] > 0.002 );
    if ( !T ) return;
    const o = ( T.j * this.store.size + T.i ) * 4, a = clamp01( c[3] );
    if ( a > 0.002 ) for ( let k = 0; k < 3; k++ ) T.px[o + k] = Math.round( clamp01( c[k] / a ) * 255 );
    T.px[o + 3] = Math.round( a * 255 );
    this.mark( T.key, T.tx, T.ty, T.i, T.j );
  }

  /**
   * PhotoCraft's Smudge: a patch of paint carried from dab to dab, laid down at the strength, then topped up from
   * the pixels under the dab.
  **/
  private smudge( d: Dab ) {
    const R = Math.ceil( this.o.radius ) + 2, side = 2 * R + 1, cx = Math.floor( d.x ), cy = Math.floor( d.y ), str = clamp01( this.o.strength );
    if ( !this.carry || this.carryR !== R ) {
      this.carryR = R;
      this.carry  = new Float32Array( side * side * 4 );
      for ( let qy = 0; qy < side; qy++ ) for ( let qx = 0; qx < side; qx++ ) this.carry.set( this.now( cx + qx - R, cy + qy - R ), ( qy * side + qx ) * 4 );
    }
    const carry = this.carry, laid = new Map<number, [number, number, number, number]>();
    this.cover( d, ( gx, gy, cov ) => {
      const qx = gx - cx + R, qy = gy - cy + R;
      if ( qx < 0 || qy < 0 || qx >= side || qy >= side ) return;
      const k = cov * str, q = ( qy * side + qx ) * 4, p = this.now( gx, gy );
      laid.set( qy * side + qx, [p[0] + ( carry[q] - p[0] ) * k, p[1] + ( carry[q + 1] - p[1] ) * k, p[2] + ( carry[q + 2] - p[2] ) * k, p[3] + ( carry[q + 3] - p[3] ) * k] );
    } );
    for ( const [k, c] of laid ) this.put( cx + ( k % side ) - R, cy + Math.floor( k / side ) - R, c );
    for ( let qy = 0; qy < side; qy++ )
      for ( let qx = 0; qx < side; qx++ ) {
        const p = this.now( cx + qx - R, cy + qy - R ), q = ( qy * side + qx ) * 4;
        for ( let c = 0; c < 4; c++ ) carry[q + c] = carry[q + c] * str + p[c] * ( 1 - str );
      }
    this.report();
  }

  /**
   * Blur ( a box average over a few pixels, premultiplied ) or Sharpen ( away from it ), by the dab's coverage.
  **/
  private filter( d: Dab ) {
    const k     = Math.max( 1, Math.min( 10, Math.round( this.o.radius / 10 ) ) );
    const reach = Math.ceil( this.o.radius * 1.5 ) + k + 1;
    const x0    = Math.floor( d.x ) - reach, y0 = Math.floor( d.y ) - reach, W = 2 * reach + 1;
    // the area as it is, and its summed-area table
    const sat   = new Float64Array( ( W + 1 ) * ( W + 1 ) * 4 );
    for ( let j = 0; j < W; j++ )
      for ( let i = 0; i < W; i++ ) {
        const p = this.now( x0 + i, y0 + j );
        for ( let c = 0; c < 4; c++ ) {
          const s = ( ( j + 1 ) * ( W + 1 ) + i + 1 ) * 4 + c;
          sat[s]  = p[c] + sat[s - 4] + sat[s - ( W + 1 ) * 4] - sat[s - ( W + 1 ) * 4 - 4];
        }
      }
    const box = ( i: number, j: number, c: number ) => {
      const a  = Math.max( 0, i - k ), b = Math.max( 0, j - k ), e = Math.min( W, i + k + 1 ), f = Math.min( W, j + k + 1 );
      const at = ( x: number, y: number ) => sat[( y * ( W + 1 ) + x ) * 4 + c];
      return ( at( e, f ) - at( a, f ) - at( e, b ) + at( a, b ) ) / ( ( e - a ) * ( f - b ) );
    };
    const str                               = clamp01( this.o.strength ), sharpen = this.o.kind === "sharpen";
    const out: [number, number, number[]][] = [];
    this.cover( d, ( gx, gy, cov ) => {
      const i = gx - x0, j = gy - y0;
      if ( i < 0 || j < 0 || i >= W || j >= W ) return;
      const p = this.now( gx, gy ), w = cov * str;
      if ( p[3] < 0.002 && sharpen ) return;
      const n = [0, 1, 2, 3].map( ( c ) => {
        const m = box( i, j, c );
        return sharpen ? p[c] + ( p[c] - m ) * w * 1.5 : p[c] + ( m - p[c] ) * w;
      } );
      if ( sharpen ) n[3] = p[3];
      out.push( [gx, gy, n] );
    } );
    for ( const [gx, gy, n] of out ) this.put( gx, gy, [n[0], n[1], n[2], n[3]] );
    this.report();
  }
}
