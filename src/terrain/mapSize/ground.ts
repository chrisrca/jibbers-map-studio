// The ground grown from an edge: the edge read ( its slope, roughness, hills ), and new ground quilted from it.

import { terrain } from "../terrain";
import { type EdgeCell, type Side, bounds } from "./edges";
import { type GrowParams, blur, rng } from "./grow";

// What the terrain along one edge is like; everything new ground for that edge is made from.
export interface EdgeAnalysis {
  edge:     EdgeCell[];
  alongX:   boolean;
  out:      number;
  uMin:     number;
  along:    number;
  line:     number;
  dir:      number;
  // the band along the edge used for the broad shape and the join: heights, row k = k*bs metres in
  bs:       number;
  nu:       number;
  nd:       number;
  S:        Float32Array;
  edgeH:    Float32Array;
  slope:    Float32Array;
  curve:    Float32Array;
  maxSlope: number;
  hstep:    number;
  // the source for new detail: up to ~1 km of existing ground, detail only ( broad shape removed ), every gs metres;
  // rows run outwards ( the last row is the edge ), so pieces copied from it keep their orientation in the world
  gs:       number;
  nuS:      number;
  ndS:      number;
  Dg:       Float32Array;
  seed:     number;
  // generated detail per variation
  cache:    Map<string, Float32Array>;
}

/**
 * Looks at the terrain along the `side` edge:
 *  - the broad shape's height, slope and bend at the edge ( how the ground curves on its way up to it );
 *  - the detail ( ridges, gullies, lumps: the ground minus its broad shape ) of up to ~1 km of ground inside the edge,
 *    which new ground is pieced together from.
**/
export function analyzeEdge( side: Side, edge: EdgeCell[] ): EdgeAnalysis {
  const alongX     = side === "north" || side === "south";
  const c0         = edge[0];
  const out        = alongX ? c0.size[2] : c0.size[0];
  const uMin       = Math.min( ...edge.map( ( c ) => ( alongX ? c.position[0] : c.position[2] ) ) );
  const uMax       = Math.max( ...edge.map( ( c ) => ( alongX ? c.position[0] + c.size[0] : c.position[2] + c.size[2] ) ) );
  const b          = bounds();
  const line       = side === "east" ? b.maxx : side === "west" ? b.minx : side === "north" ? b.maxz : b.minz;
  const dir        = side === "east" || side === "north" ? 1 : -1;
  const inward     = alongX ? b.maxz - b.minz : b.maxx - b.minx; // how deep the map is from this edge
  const along      = uMax - uMin;
  const world      = ( u: number, d: number ): [number, number] => ( alongX ? [uMin + u, line + dir * d] : [line + dir * d, uMin + u] );
  const sampleGrid = ( w: number, h: number, sp: number, depthOf: ( row: number ) => number ) => {
    const g = new Float32Array( w * h );
    for ( let r = 0; r < h; r++ )
      for ( let i = 0; i < w; i++ ) {
        const [x, z] = world( i * sp, -depthOf( r ) );
        const v      = terrain.heightAt( x, z );
        g[r * w + i] = Number.isNaN( v ) ? ( i > 0 ? g[r * w + i - 1] : r > 0 ? g[( r - 1 ) * w] : 0 ) : v;
      }
    return g;
  };
  /**
   * Smooths over ~2*radius metres, the edge side continued by point reflection first ( 2*edge - ground as far in ),
   * so a slope down to the edge keeps its height there instead of being pulled towards the ground further in.
  **/
  const smoothFromEdge = ( g: Float32Array, w: number, h: number, sp: number, edgeRow: 0 | "last", radius: number ) => {
    const row = ( k: number ) => ( edgeRow === 0 ? k : h - 1 - k ); // k rows in from the edge
    const np  = Math.min( h - 1, Math.round( ( radius * 2.5 ) / sp ) );
    const E   = blur( g.slice( row( 0 ) * w, row( 0 ) * w + w ), w, 1, Math.max( 1, Math.round( 10 / sp ) ) );
    const X   = new Float32Array( w * ( h + np ) );
    for ( let k = 0; k < h;  k++ ) X.set( g.subarray( row( k ) * w, row( k ) * w + w ), ( np + k ) * w );
    for ( let r = 0; r < np; r++ ) for ( let i = 0; i < w; i++ ) X[r * w + i] = 2 * E[i] - g[row( np - r ) * w + i];
    const rr   = Math.max( 1, Math.round( radius / sp ) );
    const sm   = blur( blur( X, w, h + np, rr ), w, h + np, rr );
    const outG = new Float32Array( w * h );
    for ( let k = 0; k < h; k++ ) outG.set( sm.subarray( ( np + k ) * w, ( np + k + 1 ) * w ), row( k ) * w );
    return outG;
  };

  // the band: broad shape and the join
  const band   = Math.min( out, 400, inward );
  const bs     = Math.max( 1, Math.min( ...edge.map( ( c ) => c.spacing ) ) );
  const nu     = Math.round( along / bs ) + 1, nd = Math.max( 3, Math.round( band / bs ) + 1 );
  const S      = sampleGrid( nu, nd, bs, ( k ) => k * bs );
  const broad  = smoothFromEdge( S, nu, nd, bs, 0, 120 );
  const smooth = blur( broad, nu, nd, Math.max( 1, Math.round( 40 / bs ) ) );
  const step   = Math.max( 1, Math.min( Math.floor( ( nd - 1 ) / 2 ), Math.round( 80 / bs ) ) );
  const hstep  = step * bs;
  const edgeH  = new Float32Array( nu ), slope = new Float32Array( nu ), curve = new Float32Array( nu );
  let maxSlope = 0.05;
  for ( let i = 0; i < nu; i++ ) {
    const h0 = smooth[i], h1 = smooth[step * nu + i], h2 = smooth[2 * step * nu + i];
    edgeH[i] = broad[i];
    slope[i] = ( 3 * h0 - 4 * h1 + h2 ) / ( 2 * hstep );
    curve[i] = ( h0 - 2 * h1 + h2 ) / ( hstep * hstep );
    maxSlope = Math.max( maxSlope, Math.abs( ( h0 - h2 ) / ( 2 * hstep ) ) );
  }
  maxSlope     = Math.min( 1.2, maxSlope * 1.25 );
  // carried a long way out, any wiggle along the edge in the slope or bend would be drawn out into stripes
  const alongR = Math.max( 1, Math.round( 100 / bs ) );
  const slopeS = blur( blur( slope, nu, 1, alongR ), nu, 1, alongR ), curveS = blur( blur( curve, nu, 1, alongR ), nu, 1, alongR );

  // the source of detail
  const gs  = Math.max( 2, bs );
  const nuS = Math.round( along / gs ) + 1, ndS = Math.max( 8, Math.round( Math.min( 1000, inward ) / gs ) + 1 );
  const G   = sampleGrid( nuS, ndS, gs, ( r ) => ( ndS - 1 - r ) * gs );
  const Gb  = smoothFromEdge( G, nuS, ndS, gs, "last", 120 );
  const Dg  = new Float32Array( G.length );
  for ( let k = 0; k < G.length; k++ ) Dg[k] = G[k] - Gb[k];

  const seed = ( Math.round( line * 7919 + uMin * 104729 ) | 0 ) >>> 0;
  return { edge, alongX, out, uMin, along, line, dir, bs, nu, nd, S, edgeH, slope: slopeS, curve: curveS, maxSlope, hstep, gs, nuS, ndS, Dg, seed, cache: new Map() };
}

/**
 * New detail for the strip, pieced together from the existing ground's detail like a "content-aware fill" ( image
 * quilting ): square pieces ( ~256 m ) are laid out from the edge outwards, each picked from many random spots in the
 * source ( mostly near the edge: how far in is exponential with mean `reach` metres ) for how well it fits what is
 * already laid down where they overlap ( the first row overlaps the real ground at the edge, so ridges and gullies
 * carry across ), randomly among the good fits, avoiding pieces used recently. The overlaps are blended. Rows run
 * outwards from the edge ( row 0 = the edge ), every gs metres.
**/
function quilt( an: EdgeAnalysis, variation: number, reach: number ): Float32Array {
  const key = `${variation}:${reach}`;
  const hit = an.cache.get( key );
  if ( hit ) return hit;
  const { gs, nuS: W, ndS, Dg, out } = an;
  const R                            = Math.ceil( out / gs ) + 1; // canvas row r = r*gs metres out from the edge
  const B                            = Math.max( 8, Math.min( Math.round( 256 / gs ), ndS - 1, W ) );
  const O                            = Math.max( 3, Math.round( B / 4 )                            );
  const step                         = B - O;
  const canvas                       = new Float32Array( W * R );
  const filled                       = new Uint8Array( W * R );
  // the first rows: the existing detail continued past the edge by point reflection ( 2*edge - as far in ), which keeps
  // its height and slope; the first pieces are matched to it and cut in beyond its first few metres
  const keep                         = Math.max( 1, Math.round( O / 4 ) );
  for ( let r = 0; r < Math.min( O, R, ndS ); r++ )
    for ( let i = 0; i < W; i++ ) {
      canvas[r * W + i] = 2 * Dg[( ndS - 1 ) * W + i] - Dg[( ndS - 1 - r ) * W + i];
      filled[r * W + i] = 1;
    }
  const rand                             = rng( an.seed ^ Math.imul( variation + 1, 0x9e3779b9 ) );
  const sub                              = Math.max( 1, Math.round( O / 8 ) );
  const used: [number, number, number][] = []; // source spot and orientation of every piece laid so far
  const starts                           = ( n: number ) => {
    const s2: number[] = [];
    for ( let q = 0; ; q += step ) {
      if ( q + B >= n ) {
        s2.push( Math.max( 0, n - B ) );
        break;
      }
      s2.push( q );
    }
    return s2;
  };
  const K            = 300;
  const cj: number[] = [], ci: number[] = [], cv: number[] = [];
  const err          = new Float32Array( B * B ), cost = new Float32Array( B * B ), mask = new Float32Array( B * B );
  const piece        = new Float32Array( B * B );
  const cut          = new Int32Array( B );
  // a source cell of a piece at ( sr, su ), optionally mirrored ( orientation bit 1: left/right, bit 2: front/back ), which
  // gives four times as many different pieces when only a little ground near the edge is used
  const src          = ( sr: number, su: number, o: number, j: number, i: number, bh: number, bw: number ) =>
    Dg[( sr + ( o & 2 ? bh - 1 - j : j ) ) * W + su + ( o & 1 ? bw - 1 - i : i )];
  for ( const pr of starts( R ) )
    for ( const pu of starts( W ) ) {
      const bh  = Math.min( B, R - pr ), bw = Math.min( B, W - pu );
      // what is already laid down under this piece ( sampled )
      cj.length = ci.length = cv.length = 0;
      for ( let j = 0; j < bh; j += sub )
        for ( let i = 0; i < bw; i += sub ) {
          const k = ( pr + j ) * W + pu + i;
          if ( filled[k] ) {
            cj.push( j );
            ci.push( i );
            cv.push( canvas[k] );
          }
        }
      // try random pieces of the source
      let best                                        = Infinity;
      const cands: [number, number, number, number][] = [];
      for ( let c = 0; c < K; c++ ) {
        // how far in the piece starts: exponential, so mostly from near the edge
        const depth = Math.floor( ( -Math.log( 1 - rand() ) * reach ) / gs );
        const su    = Math.floor( rand() * ( W - bw + 1 ) ), sr = Math.max( 0, ndS - bh - depth );
        const o     = Math.floor( rand() * 4 );
        // matched after removing the average difference ( a piece is shifted to fit anyway, see below )
        let e       = 0, mean = 0;
        for ( let q = 0; q < ci.length; q++ ) mean += src( sr, su, o, cj[q], ci[q], bh, bw ) - cv[q];
        mean = ci.length ? mean / ci.length : 0;
        for ( let q = 0; q < ci.length; q++ ) e += ( src( sr, su, o, cj[q], ci[q], bh, bw ) - mean - cv[q] ) ** 2;
        e = ci.length ? e / ci.length : 0;
        // spread the choice: every earlier use of ( nearly ) the same piece makes it cost more, and so does coming
        // from far along the edge
        for ( const [uu, rr, oo] of used ) if ( oo === o && Math.abs( uu - su ) < B * 0.75 && Math.abs( rr - sr ) < B * 0.75 ) e = e * 2 + 0.02;
        e *= 1 + ( 0.3 * Math.abs( su - pu ) ) / W;
        cands.push( [e, su, sr, o] );
        if ( e < best ) best = e;
      }
      const good          = cands.filter( ( c ) => c[0] <= best * 1.15 + 1e-4 );
      const [, su, sr, o] = good[Math.floor( rand() * good.length )];
      used.push( [su, sr, o] );

      // the piece, shifted and tilted to meet what is already there across the overlap ( least-squares plane through
      // the differences ), the correction fading out over the piece so it does not tilt the rest of it: no steps
      for ( let j = 0; j < bh; j++ ) for ( let i = 0; i < bw; i++ ) piece[j * B + i] = src( sr, su, o, j, i, bh, bw );
      {
        let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sd = 0, sxd = 0, syd = 0;
        for ( let q = 0; q < ci.length; q++ ) {
          const x = ci[q] / B - 0.5, y = cj[q] / B - 0.5, d = cv[q] - piece[cj[q] * B + ci[q]];
          n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sd += d; sxd += x * d; syd += y * d;
        }
        if ( n > 3 ) {
          // solve [n sx sy; sx sxx sxy; sy sxy syy] [c a b] = [sd sxd syd]
          const m = [[n, sx, sy, sd], [sx, sxx, sxy, sxd], [sy, sxy, syy, syd]];
          for ( let c = 0; c < 3; c++ ) {
            let piv = c;
            for ( let r = c + 1; r < 3; r++ ) if ( Math.abs( m[r][c] ) > Math.abs( m[piv][c] ) ) piv = r;
            [m[c], m[piv]] = [m[piv], m[c]];
            if ( Math.abs( m[c][c] ) < 1e-9 ) continue;
            for ( let r = 0; r < 3; r++ ) {
              if ( r === c ) continue;
              const f = m[r][c] / m[c][c];
              for ( let k = c; k < 4; k++ ) m[r][k] -= f * m[c][k];
            }
          }
          const c0    = Math.abs( m[0][0] ) > 1e-9 ? m[0][3] / m[0][0] : 0;
          const ca    = Math.abs( m[1][1] ) > 1e-9 ? m[1][3] / m[1][1] : 0;
          const cb    = Math.abs( m[2][2] ) > 1e-9 ? m[2][3] / m[2][2] : 0;
          const leftF = pu > 0 && filled[( pr + Math.floor( bh / 2 ) ) * W + pu];
          const topF  = filled[pr * W + pu + Math.floor( bw / 2 )];
          for ( let j = 0; j < bh; j++ )
            for ( let i = 0; i < bw; i++ ) {
              // full strength across the overlaps, easing to none at the far sides
              const fx          = leftF ? Math.max( 0, Math.min( 1, 1 - ( i - O ) / ( bw - O ) ) ) : 0;
              const fy          = topF  ? Math.max( 0, Math.min( 1, 1 - ( j - O ) / ( bh - O ) ) ) : 0;
              const t           = Math.max( fx, fy ), w = t * t * ( 3 - 2 * t );
              piece[j * B + i] += ( c0 + ca * ( i / B - 0.5 ) + cb * ( j / B - 0.5 ) ) * w;
            }
        }
      }

      // where the piece takes over: along the cheapest path through each overlap ( where piece and ground agree most )
      for ( let j = 0; j < bh; j++ )
        for ( let i = 0; i < bw; i++ ) {
          const k         = ( pr + j ) * W + pu + i;
          err[j * B + i]  = filled[k] ? ( piece[j * B + i] - canvas[k] ) ** 2 : 0;
          mask[j * B + i] = 1;
        }
      const leftFilled = pu > 0 && filled[( pr + Math.floor( bh / 2 ) ) * W + pu];
      const topFilled  = filled[pr * W + pu + Math.floor( bw / 2 )];
      const ow         = Math.min( O, bw ), oh = Math.min( O, bh );
      // the cut stays clear of the overlap's outer edges, so the softened step fits inside the overlap ( a cut right at
      // the piece's border would leave a hard step there )
      const sr2        = Math.max( 2, Math.round( O / 6 ) );
      const mg         = Math.min( sr2 * 2, Math.floor( ( O - 1 ) / 2 ) );
      const c0         = mg, c1 = Math.max( c0 + 1, ow - mg ); // columns [c0, c1) for the vertical cut
      if ( leftFilled ) {
        // vertical seam in columns 0..ow-1, top to bottom
        for ( let i = c0; i < c1; i++ ) cost[i] = err[i];
        for ( let j = 1;  j < bh; j++ )
          for ( let i = c0; i < c1; i++ ) {
            let m = cost[( j - 1 ) * B + i];
            if ( i > c0 ) m = Math.min( m, cost[( j - 1 ) * B + i - 1] );
            if ( i < c1 - 1 ) m = Math.min( m, cost[( j - 1 ) * B + i + 1] );
            cost[j * B + i] = err[j * B + i] + m;
          }
        let bi = c0;
        for ( let i = c0 + 1; i < c1; i++ ) if ( cost[( bh - 1 ) * B + i] < cost[( bh - 1 ) * B + bi] ) bi = i;
        for ( let j = bh - 1; j >= 0; j-- ) {
          cut[j] = bi;
          if ( j > 0 ) {
            let nb = bi;
            for ( const d of [-1, 1] ) {
              const ii = bi + d;
              if ( ii >= c0 && ii < c1 && cost[( j - 1 ) * B + ii] < cost[( j - 1 ) * B + nb] ) nb = ii;
            }
            bi = nb;
          }
        }
        for ( let j = 0; j < bh; j++ ) for ( let i = 0; i < cut[j]; i++ ) mask[j * B + i] = 0;
      }
      if ( topFilled ) {
        // horizontal seam in rows lo..oh-1, left to right ( the first row of pieces keeps the edge's first metres )
        const lo = Math.max( mg, pr === 0 ? keep : 0 ), hiRow = Math.max( lo + 1, oh - mg );
        for ( let j = lo; j < hiRow; j++ ) cost[j * B] = err[j * B];
        for ( let i = 1;  i < bw;    i++ )
          for ( let j = lo; j < hiRow; j++ ) {
            let m = cost[j * B + i - 1];
            if ( j > lo ) m = Math.min( m, cost[( j - 1 ) * B + i - 1] );
            if ( j < hiRow - 1 ) m = Math.min( m, cost[( j + 1 ) * B + i - 1] );
            cost[j * B + i] = err[j * B + i] + m;
          }
        let bj = lo;
        for ( let j = lo + 1; j < hiRow; j++ ) if ( cost[j * B + bw - 1] < cost[bj * B + bw - 1] ) bj = j;
        for ( let i = bw - 1; i >= 0; i-- ) {
          cut[i] = bj;
          if ( i > 0 ) {
            let nb = bj;
            for ( const d of [-1, 1] ) {
              const jj = bj + d;
              if ( jj >= lo && jj < hiRow && cost[jj * B + i - 1] < cost[nb * B + i - 1] ) nb = jj;
            }
            bj = nb;
          }
        }
        for ( let i = 0; i < bw; i++ ) for ( let j = 0; j < cut[i]; j++ ) mask[j * B + i] = 0;
      }
      // soften the cut a little ( a hard step would show as a line ), then lay the piece down
      const soft = blur( blur( mask, B, B, sr2 ), B, B, sr2 );
      for ( let j = 0; j < bh; j++ )
        for ( let i = 0; i < bw; i++ ) {
          const k   = ( pr + j ) * W + pu + i;
          const m   = filled[k] ? soft[j * B + i] : 1;
          canvas[k] = canvas[k] * ( 1 - m ) + piece[j * B + i] * m;
          filled[k] = 1;
        }
    }
  const res = canvas;
  an.cache.set( key, res );
  return res;
}

/**
 * Ground for the strip beside an analysed edge, as absolute height at any world point in it:
 *  - the broad shape carries on the way the ground was curving up to the edge ( a rise that is levelling off rolls
 *    over the top, a valley floor stays a floor ), slowly easing out;
 *  - detail pieced together from the existing ground ( see `quilt` ), so it looks like the ground beside it;
 *  - it is shifted to meet the existing ground at the edge in height and slope, the shift fading out, so no line.
**/
export function groundFrom( an: EdgeAnalysis, p: GrowParams ): ( x: number, z: number ) => number {
  const { alongX, out, uMin, along, line, dir, bs, nu, nd, S, edgeH, slope, curve, maxSlope, hstep, gs, nuS } = an;
  const at = ( g: Float32Array, u: number ) => {
    const f = Math.min( nu - 1.001, Math.max( 0, u / bs ) ), i = Math.floor( f ), a = f - i;
    return g[i] * ( 1 - a ) + g[i + 1] * a;
  };
  // broad shape outwards, integrated once into a table ( every Tu metres along, Tv metres out )
  const Tu       = 4, Tv = 2;
  const tnu      = Math.ceil( along / Tu ) + 1, tnv = Math.ceil( out / Tv ) + 2;
  const fade     = Math.max( 150, out * 0.6 ) * p.carry; // how far the slope keeps going
  const bendFade = Math.max( 60, hstep * 2 ) * p.carry;  // how far the bend keeps bending
  const table    = new Float32Array( tnu * tnv );
  for ( let i = 0; i < tnu; i++ ) {
    const u        = i * Tu, s0 = at( slope, u ), k0 = at( curve, u );
    let h          = at( edgeH, u );
    table[i * tnv] = h;
    for ( let j = 1; j < tnv; j++ ) {
      const v            = ( j - 0.5 ) * Tv;
      let sl             = fade > 0 ? s0 * Math.exp( -v / fade ) + k0 * bendFade * ( 1 - Math.exp( -v / bendFade ) ) * Math.exp( -v / fade ) : 0;
      sl                 = Math.max( -maxSlope, Math.min( maxSlope, sl ) );
      h                 += sl * Tv;
      table[i * tnv + j] = h;
    }
  }
  const trendAt = ( u: number, v: number ) => {
    const fu = Math.min( tnu - 1.001, Math.max( 0, u / Tu ) ), fv = Math.min( tnv - 1.001, Math.max( 0, v / Tv ) );
    const i  = Math.floor( fu ), j = Math.floor( fv ), a = fu - i, c = fv - j;
    const q  = i * tnv + j;
    return ( table[q] * ( 1 - c ) + table[q + 1] * c ) * ( 1 - a ) + ( table[q + tnv] * ( 1 - c ) + table[q + tnv + 1] * c ) * a;
  };
  // the pieced-together detail; "Hills" scales all of it, "Small bumps" the part finer than ~10 m
  const Dq     = quilt( an, p.seed, p.reach );
  const nvq    = Dq.length / nuS;
  const fineR  = Math.max( 1, Math.round( 4 / gs ) );
  const Ds     = blur( blur( Dq, nuS, nvq, fineR ), nuS, nvq, fineR );
  const detail = new Float32Array( Dq.length );
  for ( let k = 0; k < Dq.length; k++ ) detail[k] = ( Ds[k] * p.hills + ( Dq[k] - Ds[k] ) * p.roughness );
  const detailAt = ( u: number, v: number ) => {
    const fu = Math.min( nuS - 1.001, Math.max( 0, u / gs ) ), fv = Math.min( nvq - 1.001, Math.max( 0, v / gs ) );
    const i  = Math.floor( fu ), j = Math.floor( fv ), a = fu - i, c = fv - j;
    const q  = j * nuS + i;
    return ( detail[q] * ( 1 - a ) + detail[q + 1] * a ) * ( 1 - c ) + ( detail[q + nuS] * ( 1 - a ) + detail[q + nuS + 1] * a ) * c;
  };
  const far = ( u: number, v: number ) => trendAt( u, v ) + detailAt( u, v );
  // the new ground is shifted to meet the edge exactly in height and slope, the shift fading out over `join` metres:
  // ( d0 + a*v ) * e^( -v/L ), with a chosen so the slope matches too. No crease, no line.
  const L   = Math.max( 1, p.join );
  const d0  = new Float32Array( nu ), a1 = new Float32Array( nu );
  for ( let i = 0; i < nu; i++ ) {
    const u         = i * bs;
    const f0        = far( u, 0 ), f1 = far( u, bs );
    const realSlope = nd > 2 ? ( 3 * S[i] - 4 * S[nu + i] + S[2 * nu + i] ) / ( 2 * bs ) : 0;
    d0[i]           = S[i] - f0;
    a1[i]           = realSlope - ( f1 - f0 ) / bs;
  }
  // the broad part of the shift fades over L; the fine part ( bumps along the edge ) within a few metres, or it would be
  // drawn out into streaks
  const Lf  = Math.min( L, 12 );
  const sm  = ( g: Float32Array ) => blur( blur( g, nu, 1, Math.max( 1, Math.round( 15 / bs ) ) ), nu, 1, Math.max( 1, Math.round( 15 / bs ) ) );
  const d0s = sm( d0 ), a1s = sm( a1 );
  const d0f = new Float32Array( nu ), a1f = new Float32Array( nu );
  for ( let i = 0; i < nu; i++ ) {
    d0f[i]  = d0[i] - d0s[i];
    a1f[i]  = a1[i] - a1s[i] + d0f[i] / Lf;
    a1s[i] += d0s[i] / L;
  }
  return ( x: number, z: number ) => {
    const u   = ( alongX ? x : z ) - uMin;
    const v   = Math.max( 0, dir * ( ( alongX ? z : x ) - line ) );
    const r   = Math.min( 1, v / out ), raise = p.raise * r * r * ( 3 - 2 * r );
    const fit =
      ( v < L  * 12 ? ( at( d0s, u ) + at( a1s, u ) * v ) * Math.exp( -v / L  ) : 0 ) +
      ( v < Lf * 12 ? ( at( d0f, u ) + at( a1f, u ) * v ) * Math.exp( -v / Lf ) : 0 );
    return far( u, v ) + fit + raise;
  };
}
