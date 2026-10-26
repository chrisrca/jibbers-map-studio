// A sculpt stroke's brushes: each brush's maths on a window of the ground, its weights ( the tip, height and
// slope limits, cavity ), how much of each point the stroke has covered, the noise and the flatten plane.

import { fbm } from "../../terrain/generate";
import { type Tip } from "../tip";
import { gaussianish, HeightWindow, Lattice, type Box } from "../window";
import type { BrushStroke } from "./stroke";
import { SMOOTH_DEFAULT_SPACING, BLOCK, Dab } from "./stroke";

// The brushes' maths.
export class StrokeOps {
  constructor( private stroke: BrushStroke ) {}

  plane: { a: number; bx: number; bz: number; cx: number; cz: number } | null = null;
  // the most each lattice point has been covered by this stroke ( weight × strength ), in blocks by lattice spacing
  private covered     = new Map<string, Float32Array>();
  // the Noise brush's noise at each lattice point, worked out once a stroke ( NaN: not yet )
  private noiseBlocks = new Map<string, Float32Array>();

  /**
   * A field of the lattice's at every sample, held back where the mask protects the ground ( the mask is painted at
   * every sample; with f = 1 the weights have it already ).
  **/
  fine( g: Lattice, C: Float32Array, box: Box ): Float32Array {
    if ( g.f === 1 ) return C;
    const F = g.up( C, box ), win = g.win;
    if ( win.hasMask )
      for ( let j = box[2]; j <= box[3]; j++ ) for ( let k = j * win.w + box[0], e = j * win.w + box[1]; k <= e; k++ ) if ( F[k] ) F[k] *= 1 - win.mask[k];
    return F;
  }

  /**
   * Brush weight ( 0..1 ) at every lattice point: tip × filters ( × ( 1 − mask ) on a lattice of every sample ).
  **/
  weights( win: HeightWindow, tip: Tip, g: Lattice, box: Box ): Float32Array {
    const f        = this.stroke.sc.filters;
    const gw       = g.cw, gh = g.ch, gsp = win.sp * g.f;
    // ( the ground round the tip, as far as the filters look: the slope beside a point, the cavity's blur )
    const e        = f.cavity !== "all" ? Math.ceil( tip.r / 4 / win.sp ) + 2 * g.f : 2 * g.f;
    const H        = g.down( win.H, [box[0] - e, box[1] + e, box[2] - e, box[3] + e] );
    const slopeOn  = f.slope.on, heightOn = f.height.on, cavOn = f.cavity !== "all";
    const cav      = cavOn ? gaussianish( H, gw, gh, Math.max( 2, Math.round( tip.r / 4 / gsp ) ) ) : null;
    const cavScale = Math.max( 0.05, tip.r * 0.02 );
    const band     = ( v: number, lo: number, hi: number, soft: number ) =>
      v < lo - soft || v > hi + soft ? 0 : v < lo ? ( v - lo + soft ) / soft : v > hi ? ( hi + soft - v ) / soft : 1;
    const masked   = g.f === 1 && win.hasMask;
    return g.make( ( i, j, k ) => {
      let wt = tip.weight( win.wx( i ), win.wz( j ) );
      if ( wt <= 0 ) return 0;
      if ( heightOn ) wt *= band( H[k], f.height.min, f.height.max, Math.max( 0.25, ( f.height.max - f.height.min ) * 0.03 ) );
      if ( slopeOn && wt > 0 ) {
        const I  = k % gw, J = ( k - I ) / gw;
        const gx = ( H[J * gw + Math.min( gw - 1, I + 1 )] - H[J * gw + Math.max( 0, I - 1 )] ) / ( 2 * gsp );
        const gz = ( H[Math.min( gh - 1, J + 1 ) * gw + I] - H[Math.max( 0, J - 1 ) * gw + I] ) / ( 2 * gsp );
        wt      *= band( ( Math.atan( Math.hypot( gx, gz ) ) * 180 ) / Math.PI, f.slope.min, f.slope.max, 2 );
      }
      if ( cav && wt > 0 ) {
        const c = H[k] - cav[k]; // > 0 sticking out, < 0 hollow
        const v = f.cavity === "concave" ? -c : c;
        wt     *= Math.max( 0, Math.min( 1, v / cavScale ) );
      }
      if ( masked ) wt *= 1 - win.mask[k];
      return wt;
    }, box );
  }

  /**
   * The brush itself, on the window's heights ( changed where it works ). False when it did nothing.
  **/
  op( win: HeightWindow, W: Float32Array, d: Dab, g: Lattice, Wc: Float32Array, box: Box, orig: () => Float32Array ): boolean {
    const s                    = this.stroke.s, sign = this.stroke.sign, str = d.strength;
    const { w, h, H, sp }      = win;
    // ( each point read and then written: in place )
    const out                  = H;
    const [bi0, bi1, bj0, bj1] = box;
    // per-dab amounts are scaled with the spacing, so a stroke builds up the same however dense its dabs are
    const per                  = Math.min( 4, Math.max( 0.25, s.spacing / SMOOTH_DEFAULT_SPACING ) );
    const cells                = ( metres: number ) => Math.max( 1, Math.round( metres / sp ) );
    // ( a blur on the lattice: its radius in lattice steps )
    const blur                 = ( F: Float32Array, metres: number ) => {
      const c = cells( metres );
      return g.up( gaussianish( g.down( F, [box[0] - c - g.f, box[1] + c + g.f, box[2] - c - g.f, box[3] + c + g.f] ), g.cw, g.ch, Math.max( 1, Math.round( c / g.f ) ) ), box );
    };
    switch ( this.stroke.id ) {
      case "draw": {
        const O   = orig(), C = this.coverage( g, Wc, str, box );
        const amt = sign * d.r * 0.3;
        for ( let j = bj0; j <= bj1; j++ ) for ( let k = j * w + bi0, e = j * w + bi1; k <= e; k++ ) if ( W[k] ) out[k] = O[k] + amt * C[k];
        return true;
      }
      case "layer": {
        const O  = orig();
        const k1 = Math.min( 1, str * 1.5 );
        for ( let j = bj0; j <= bj1; j++ ) for ( let k = j * w + bi0, e = j * w + bi1; k <= e; k++ ) {
          if ( !W[k] ) continue;
          const dd = O[k] + sign * s.layerHeight * W[k] - H[k];
          if ( sign * dd > 0 ) out[k] = H[k] + dd * k1;
        }
        return true;
      }
      case "clay": {
        // each dab lays clay on the ground as the stroke found it; a point keeps the most any dab gave it
        const O  = orig();
        const pl = fitPlaneOn( g, Wc, d.x, d.z, g.down( O, box ), box );
        for ( let j = bj0; j <= bj1; j++ )
          for ( let i = bi0; i <= bi1; i++ ) {
            const k = j * w + i;
            if ( !W[k] ) continue;
            const target = pl.a + pl.bx * ( win.wx( i ) - d.x ) + pl.bz * ( win.wz( j ) - d.z ) + sign * s.clayHeight;
            const dd     = target - O[k];
            if ( sign * dd <= 0 ) continue;
            const v = O[k] + dd * Math.min( 1, W[k] * str * 0.6 * per );
            out[k]  = sign > 0 ? Math.max( H[k], v ) : Math.min( H[k], v );
          }
        return true;
      }
      case "smooth": {
        if ( sign > 0 ) {
          const B = blur( H, s.featureSize * d.r );
          for ( let j = bj0; j <= bj1; j++ ) for ( let k = j * w + bi0, e = j * w + bi1; k <= e; k++ ) if ( W[k] ) out[k] = H[k] + ( B[k] - H[k] ) * Math.min( 1, W[k] * str );
          return true;
        }
        // enhance: the stroke's ground's detail, made stronger once
        const O = orig(), C = this.coverage( g, Wc, str, box );
        const B = blur( O, s.featureSize * d.r );
        for ( let j = bj0; j <= bj1; j++ ) for ( let k = j * w + bi0, e = j * w + bi1; k <= e; k++ ) if ( W[k] ) out[k] = O[k] + ( O[k] - B[k] ) * C[k];
        return true;
      }
      case "flatten": {
        const pl = this.flattenPlane( win, g, Wc, d, box );
        for ( let j = bj0; j <= bj1; j++ )
          for ( let i = bi0; i <= bi1; i++ ) {
            const k = j * w + i;
            if ( !W[k] ) continue;
            const target = pl.a + pl.bx * ( win.wx( i ) - pl.cx ) + pl.bz * ( win.wz( j ) - pl.cz );
            const dd     = target - H[k];
            if ( ( s.flattenDir === "raise" && dd < 0 ) || ( s.flattenDir === "lower" && dd > 0 ) ) continue;
            out[k] = H[k] + dd * Math.min( 1, W[k] * str );
          }
        return true;
      }
      case "terrace": {
        const step = Math.max( 0.05, s.terraceStep ), off = s.terraceOffset;
        const e0   = 0.3 + 0.69 * Math.min( 1, Math.max( 0, s.terraceSharpness ) );
        for ( let j = bj0; j <= bj1; j++ ) for ( let k = j * w + bi0, e = j * w + bi1; k <= e; k++ ) {
          if ( !W[k] ) continue;
          const f      = ( H[k] - off ) / step, lo = Math.floor( f ), fr = f - lo;
          const t      = fr <= e0 ? 0 : ( fr - e0 ) / ( 1 - e0 );
          const shaped = off + step * ( lo + t * t * ( 3 - 2 * t ) );
          out[k]       = H[k] + ( shaped - H[k] ) * Math.min( 1, W[k] * str * 0.5 );
        }
        return true;
      }
      case "noise": {
        // like Layer: within one stroke the noise grows to its height and no further, however often it's painted
        // over ( so "Height" means metres ); the next stroke builds on top
        const sc  = Math.max( 0.1, s.noiseScale );
        // no finer detail than the height samples can show ( it would only alias into spikes )
        const oct = Math.max( 1, Math.min( Math.round( s.noiseOctaves ), Math.floor( Math.log2( sc / ( 2 * sp ) ) ) + 1 ) );
        const O   = orig();
        const k1  = Math.min( 1, str * 0.6 * per );
        const V   = this.noise( win, W, box, ( x, z ) => {
          // ridged: sharp crests along the noise's zero lines; billow: the opposite ( rounded lumps, sharp creases )
          const f = fbm( x / sc, z / sc, oct, 77 );
          return s.noiseType === "ridged" ? ( 1 - Math.abs( f ) * 2.2 ) ** 2 - 0.3 : s.noiseType === "billow" ? Math.abs( f ) * 1.5 - 0.2 : f * 0.7;
        } );
        for ( let j = bj0; j <= bj1; j++ ) for ( let k = j * w + bi0, e = j * w + bi1; k <= e; k++ ) {
          if ( !W[k] ) continue;
          const target = O[k] + sign * s.noiseHeight * V[k] * W[k];
          out[k]       = H[k] + ( target - H[k] ) * k1;
        }
        return true;
      }
      case "crease": {
        // the stroke's ground pulled in towards the centre, then carved ( or raised ) along a sharp line
        const O     = orig(), C = this.coverage( g, Wc, str, box );
        const depth = sign * d.r * 0.15;
        // ( pulled in about the dab's centre: in window steps )
        const ci    = ( d.x - win.x0 ) / sp, cj = ( d.z - win.z0 ) / sp;
        for ( let j = bj0; j <= bj1; j++ )
          for ( let i = bi0; i <= bi1; i++ ) {
            const k = j * w + i;
            if ( !W[k] ) continue;
            const f = 1 + s.pinch * 0.5 * C[k];
            out[k]  = bilinear( O, w, h, ci + ( i - ci ) * f, cj + ( j - cj ) * f ) - depth * C[k];
          }
        return true;
      }
      case "pinch": {
        const O  = orig(), C = this.coverage( g, Wc, str, box );
        const ci = ( d.x - win.x0 ) / sp, cj = ( d.z - win.z0 ) / sp;
        for ( let j = bj0; j <= bj1; j++ )
          for ( let i = bi0; i <= bi1; i++ ) {
            const k = j * w + i;
            if ( !W[k] ) continue;
            const f = 1 + sign * 0.5 * C[k];
            out[k]  = bilinear( O, w, h, ci + ( i - ci ) * f, cj + ( j - cj ) * f );
          }
        return true;
      }
      case "smudge": {
        if ( !d.dx && !d.dz ) return false;
        const reach = this.stroke.moves.spacingMetres() * 1.5;
        const vi    = ( d.dx * reach ) / sp, vj = ( d.dz * reach ) / sp;
        // ( read from the ground before this dab: the window changes as it goes )
        const src0  = H.slice();
        for ( let j = bj0; j <= bj1; j++ )
          for ( let i = bi0; i <= bi1; i++ ) {
            const k = j * w + i;
            if ( !W[k] ) continue;
            const src = bilinear( src0, w, h, i - vi, j - vj );
            out[k]    = H[k] + ( src - H[k] ) * Math.min( 1, W[k] * str );
          }
        return true;
      }
      default:
        return false;
    }
  }

  /**
   * This dab's weights ( × strength ) merged into what the stroke has covered: at each window point, the most any of
   * its dabs gave it so far. ( On the world lattice of the window's spacing, so it carries across dabs and chunks. )
  **/
  private coverage( g: Lattice, Wc: Float32Array, str: number, box: Box ): Float32Array {
    const win              = g.win, f = g.f, cw = g.cw, ch = g.ch;
    const C                = new Float32Array( cw * ch );
    const gi0              = g.gi0, gj0 = g.gj0, tag = ( win.sp * f ).toFixed( 6 );
    const [I0, I1, J0, J1] = g.range( box );
    for ( let j = J0; j <= J1; j++ ) {
      const gj = gj0 + j, bj = Math.floor( gj / BLOCK ), row = ( gj - bj * BLOCK ) * BLOCK;
      for ( let i = I0; i <= I1; ) {
        const gi  = gi0 + i, bi = Math.floor( gi / BLOCK ), run = Math.min( I1 + 1 - i, ( bi + 1 ) * BLOCK - gi );
        const key = `${tag}:${bi}:${bj}`;
        let b     = this.covered.get( key );
        for ( let q = 0; q < run; q++, i++ ) {
          const k = j * cw + i, v = Wc[k] * str;
          if ( v <= 0 ) {
            if ( b ) C[k] = b[row + gi0 + i - bi * BLOCK];
            continue;
          }
          if ( !b ) this.covered.set( key, ( b = new Float32Array( BLOCK * BLOCK ) ) );
          const at = row + gi0 + i - bi * BLOCK;
          if ( v > b[at] ) b[at] = v;
          C[k] = b[at];
        }
      }
    }
    return this.fine( g, C, box );
  }

  /**
   * The Noise brush's noise `at( x, z )` at every window point under the brush, kept on the world's lattice for the
   * stroke ( it's the same wherever a dab is: worked out once a point, not once a dab ).
  **/
  private noise( win: HeightWindow, W: Float32Array, box: Box, at: ( x: number, z: number ) => number ): Float32Array {
    const V   = new Float32Array( win.w * win.h );
    const gi0 = Math.round( win.x0 / win.sp ), gj0 = Math.round( win.z0 / win.sp ), tag = win.sp.toFixed( 6 );
    for ( let j = box[2]; j <= box[3]; j++ ) {
      const gj = gj0 + j, bj = Math.floor( gj / BLOCK ), row = ( gj - bj * BLOCK ) * BLOCK;
      for ( let i = box[0]; i <= box[1]; ) {
        const gi  = gi0 + i, bi = Math.floor( gi / BLOCK ), run = Math.min( box[1] + 1 - i, ( bi + 1 ) * BLOCK - gi );
        const key = `${tag}:${bi}:${bj}`;
        let b     = this.noiseBlocks.get( key );
        for ( let q = 0; q < run; q++, i++ ) {
          const k = j * win.w + i;
          if ( !W[k] ) continue;
          if ( !b ) this.noiseBlocks.set( key, ( b = new Float32Array( BLOCK * BLOCK ).fill( NaN ) ) );
          const p = row + gi0 + i - bi * BLOCK;
          let v   = b[p];
          if ( v !== v ) b[p] = v = at( win.wx( i ), win.wz( j ) );
          V[k] = v;
        }
      }
    }
    return V;
  }

  /**
   * Flatten's target plane: level or along the slope; at the stroke start, the dab, or an exact height.
  **/
  private flattenPlane( win: HeightWindow, g: Lattice, Wc: Float32Array, d: Dab, box: Box ) {
    const s = this.stroke.s;
    if ( s.flattenTarget === "exact" ) return { a: s.targetHeight, bx: 0, bz: 0, cx: d.x, cz: d.z };
    if ( s.flattenTarget === "start" && this.plane ) return this.plane;
    const under = win.atWorld( d.x, d.z );
    let pl      = { a: s.flattenTarget === "start" ? this.stroke.startHeight : under, bx: 0, bz: 0, cx: d.x, cz: d.z };
    if ( s.flattenSlope ) {
      const f = fitPlaneOn( g, Wc, d.x, d.z, g.down( win.H, box ), box );
      pl      = { a: s.flattenTarget === "start" ? this.stroke.startHeight : under, bx: f.bx, bz: f.bz, cx: d.x, cz: d.z };
    }
    if ( s.flattenTarget === "start" ) this.plane = pl;
    return pl;
  }
}

/**
 * Weighted least-squares plane h = a + bx·( x − cx ) + bz·( z − cz ) through a lattice's points under the brush: `W`
 * and `H` its fields there ( the window's own when f = 1 ).
**/
export function fitPlaneOn( g: Lattice, W: Float32Array, cx: number, cz: number, H: Float32Array, box?: Box ) {
  let sw                 = 0, sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0, sh = 0, sxh = 0, szh = 0;
  const [I0, I1, J0, J1] = g.range( box );
  for ( let J = J0; J <= J1; J++ ) {
    const z = g.win.wz( g.fj( J ) ) - cz;
    for ( let I = I0; I <= I1; I++ ) {
      const k = J * g.cw + I, wt = W[k];
      if ( wt <= 0 ) continue;
      const x = g.win.wx( g.fi( I ) ) - cx, hh = H[k];
      sw     += wt; sx += wt * x; sz += wt * z; sxx += wt * x * x; szz += wt * z * z; sxz += wt * x * z;
      sh     += wt * hh; sxh += wt * x * hh; szh += wt * z * hh;
    }
  }
  if ( sw <= 0 ) {
    // ( nothing under the brush: the height at its nearest point )
    const I = Math.min( g.cw - 1, Math.max( 0, Math.round( ( cx - g.win.wx( g.fi( 0 ) ) ) / ( g.win.sp * g.f ) ) ) );
    const J = Math.min( g.ch - 1, Math.max( 0, Math.round( ( cz - g.win.wz( g.fj( 0 ) ) ) / ( g.win.sp * g.f ) ) ) );
    return { a: H[J * g.cw + I], bx: 0, bz: 0 };
  }
  const mx  = sx  / sw, mz = sz / sw, mh = sh / sw;
  const cxx = sxx / sw - mx * mx, czz = szz / sw - mz * mz, cxz = sxz / sw - mx * mz;
  const cxh = sxh / sw - mx * mh, czh = szh / sw - mz * mh;
  const det = cxx * czz - cxz * cxz;
  if ( Math.abs( det ) < 1e-9 ) return { a: mh, bx: 0, bz: 0 };
  const bx = ( cxh * czz - czh * cxz ) / det, bz = ( czh * cxx - cxh * cxz ) / det;
  return { a: mh - bx * mx - bz * mz, bx, bz };
}

/**
 * Bilinear value of grid `g` ( w × h ) at fractional ( fi, fj ), clamped to it.
**/
function bilinear( g: Float32Array, w: number, h: number, fi: number, fj: number ) {
  if ( fi < 0 ) fi = 0; else if ( fi > w - 1 ) fi = w - 1;
  if ( fj < 0 ) fj = 0; else if ( fj > h - 1 ) fj = h - 1;
  if ( w < 2 || h < 2 ) return g[0];
  const i = fi >= w - 1 ? w - 2 : fi | 0, j = fj >= h - 1 ? h - 2 : fj | 0;
  const a = fi - i, b = fj - j, p = j * w + i;
  return ( g[p] * ( 1 - a ) + g[p + 1] * a ) * ( 1 - b ) + ( g[p + w] * ( 1 - a ) + g[p + w + 1] * a ) * b;
}
