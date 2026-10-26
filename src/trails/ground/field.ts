// The bend: the ground beneath bent to meet the runs, out to `blend` metres, solved on a coarse field and read
// between its cells smoothly.

import { type FillGrid, distanceToRuns, fbm } from "../groundGrid";
import { type TrailNet, netBounds } from "../trails";
import { baseSampler } from "./base";
import { type Placed, type Raster, place, rasterRuns, smooth } from "./runs";
import { type Field, type GroundSettings, type Rect, sameSettings } from "./types";

/**
 * Catmull-Rom weights at t for the cells before, at, after and two after.
**/
function cr( t: number, w: Float32Array | number[], o: number ) {
  const t2 = t * t, t3 = t2 * t;
  w[o]     = ( -t3 + 2 * t2 - t ) / 2;
  w[o + 1] = ( 3  * t3 - 5 * t2 + 2 ) / 2;
  w[o + 2] = ( -3 * t3 + 4 * t2 + t ) / 2;
  w[o + 3] = ( t3 - t2 ) / 2;
}

export function fieldAt( f: Field | null, x: number, z: number ) {
  if ( !f ) return 0;
  const fx = ( x - f.x0 ) / f.sp, fz = ( z - f.z0 ) / f.sp;
  if ( fx < 0 || fz < 0 || fx > f.w - 1 || fz > f.h - 1 ) return 0;
  if ( f.v === 2 ) {
    const i = Math.floor( fx ), j = Math.floor( fz ), wx = [0, 0, 0, 0], wz = [0, 0, 0, 0];
    cr( fx - i, wx, 0 );
    cr( fz - j, wz, 0 );
    let v = 0;
    for ( let b = 0; b < 4; b++ ) {
      const jj = Math.min( f.h - 1, Math.max( 0, j - 1 + b ) ) * f.w;
      let r    = 0;
      for ( let a = 0; a < 4; a++ ) r += wx[a] * f.c[jj + Math.min( f.w - 1, Math.max( 0, i - 1 + a ) )];
      v += wz[b] * r;
    }
    return v;
  }
  const i = Math.min( f.w - 2, Math.floor( fx ) ), j = Math.min( f.h - 2, Math.floor( fz ) ), tx = fx - i, tz = fz - j, k = j * f.w + i, C = f.c;
  const a = C[k] + ( C[k + 1] - C[k] ) * tx, b = C[k + f.w] + ( C[k + f.w + 1] - C[k + f.w] ) * tx;
  return a + ( b - a ) * tz;
}

// Per 8 × 8 cells of a field: 1 where any is other than nothing ( worked out once per field ).
const someMasks = new WeakMap<Field, Uint8Array>();

const SOME = 8;

/**
 * Whether the field is anything but nothing anywhere over [x0, x1] × [z0, z1].
**/
function fieldSome( f: Field, x0: number, z0: number, x1: number, z1: number ) {
  const mw = Math.ceil( f.w / SOME ), mh = Math.ceil( f.h / SOME );
  let m    = someMasks.get( f );
  if ( !m ) {
    m = new Uint8Array( mw * mh );
    for ( let j = 0; j < f.h; j++ ) for ( let i = 0; i < f.w; i++ ) if ( f.c[j * f.w + i] !== 0 ) m[Math.floor( j / SOME ) * mw + Math.floor( i / SOME )] = 1;
    someMasks.set( f, m );
  }
  // ( two cells either side: samples read their neighbours )
  const i0 = Math.max( 0, Math.floor( ( x0 - f.x0 ) / f.sp ) - 2 ), i1 = Math.min( f.w - 1, Math.ceil( ( x1 - f.x0 ) / f.sp ) + 2 );
  const j0 = Math.max( 0, Math.floor( ( z0 - f.z0 ) / f.sp ) - 2 ), j1 = Math.min( f.h - 1, Math.ceil( ( z1 - f.z0 ) / f.sp ) + 2 );
  if ( i1 < i0 || j1 < j0 ) return false;
  for ( let b = Math.floor( j0 / SOME ); b <= Math.floor( j1 / SOME ); b++ ) for ( let a = Math.floor( i0 / SOME ); a <= Math.floor( i1 / SOME ); a++ ) if ( m[b * mw + a] ) return true;
  return false;
}

/**
 * The bend on a block of samples ( corner gx, gz; spacing sp ), or null where it's nothing.
**/
export function fieldBlock( f: Field | null, gx: number, gz: number, sp: number, w: number, h: number ): Float32Array | null {
  if ( !f ) return null;
  const X1 = f.x0 + ( f.w - 1 ) * f.sp, Z1 = f.z0 + ( f.h - 1 ) * f.sp;
  if ( gx > X1 || gz > Z1 || gx + ( w - 1 ) * sp < f.x0 || gz + ( h - 1 ) * sp < f.z0 ) return null;
  if ( !fieldSome( f, gx, gz, gx + ( w - 1 ) * sp, gz + ( h - 1 ) * sp ) ) return null;
  if ( f.v === 2 ) return fieldBlockSmooth( f, f.c, gx, gz, sp, w, h );
  const out = new Float32Array( w * h ), C = f.c, fw = f.w;
  // the coarse rows the block reads, each first worked out at every column of the block; then a blend of two per row
  const ci  = new Int32Array( w ), ct = new Float32Array( w ), cin = new Uint8Array( w );
  for ( let i = 0; i < w; i++ ) {
    const fx = ( gx + i * sp - f.x0 ) / f.sp;
    cin[i]   = fx >= 0 && fx <= f.w - 1 ? 1 : 0;
    const a  = Math.min( f.w - 2, Math.max( 0, Math.floor( fx ) ) );
    ci[i]    = a;
    ct[i]    = fx - a;
  }
  const rows  = new Map<number, Float32Array>();
  const rowAt = ( b: number ) => {
    let r = rows.get( b );
    if ( !r ) {
      r          = new Float32Array( w );
      const base = b * fw;
      for ( let i = 0; i < w; i++ ) if ( cin[i] ) r[i] = C[base + ci[i]] + ( C[base + ci[i] + 1] - C[base + ci[i]] ) * ct[i];
      rows.set( b, r );
    }
    return r;
  };
  for ( let j = 0; j < h; j++ ) {
    const fz = ( gz + j * sp - f.z0 ) / f.sp;
    if ( fz < 0 || fz > f.h - 1 ) continue;
    const b  = Math.min( f.h - 2, Math.floor( fz ) ), tz = fz - b;
    const r0 = rowAt( b ), r1 = rowAt( b + 1 ), o = j * w;
    for ( let i = 0; i < w; i++ ) out[o + i] = r0[i] + ( r1[i] - r0[i] ) * tz;
  }
  return out;
}

/**
 * fieldBlock for a smooth field: each coarse row read across the block ( 4 cells a sample ), then 4 rows a sample.
**/
export function fieldBlockSmooth( f: Field, C: Float32Array, gx: number, gz: number, sp: number, w: number, h: number ): Float32Array {
  const out = new Float32Array( w * h ), fw = f.w;
  const ci  = new Int32Array( w * 4 ), cw = new Float32Array( w * 4 ), cin = new Uint8Array( w );
  for ( let i = 0; i < w; i++ ) {
    const fx = ( gx + i * sp - f.x0 ) / f.sp;
    cin[i]   = fx >= 0 && fx <= f.w - 1 ? 1 : 0;
    const a  = Math.floor( fx );
    cr( fx - a, cw, i * 4 );
    for ( let q = 0; q < 4; q++ ) ci[i * 4 + q] = Math.min( fw - 1, Math.max( 0, a - 1 + q ) );
  }
  const rows  = new Map<number, Float32Array>();
  const rowAt = ( b: number ) => {
    const bb = Math.min( f.h - 1, Math.max( 0, b ) );
    let r    = rows.get( bb );
    if ( !r ) {
      r          = new Float32Array( w );
      const base = bb * fw;
      for ( let i = 0; i < w; i++ ) {
        if ( !cin[i] ) continue;
        const o = i * 4;
        r[i]    = cw[o] * C[base + ci[o]] + cw[o + 1] * C[base + ci[o + 1]] + cw[o + 2] * C[base + ci[o + 2]] + cw[o + 3] * C[base + ci[o + 3]];
      }
      rows.set( bb, r );
    }
    return r;
  };
  const wz = new Float32Array( 4 );
  for ( let j = 0; j < h; j++ ) {
    const fz = ( gz + j * sp - f.z0 ) / f.sp;
    if ( fz < 0 || fz > f.h - 1 ) continue;
    const b = Math.floor( fz );
    cr( fz - b, wz, 0 );
    const r0 = rowAt( b - 1 ), r1 = rowAt( b ), r2 = rowAt( b + 1 ), r3 = rowAt( b + 2 ), o = j * w;
    for ( let i = 0; i < w; i++ ) out[o + i] = wz[0] * r0[i] + wz[1] * r1[i] + wz[2] * r2[i] + wz[3] * r3[i];
  }
  return out;
}

// The runs' heights where they fully cover on the last field's grid ( the part of it worked out ), so the next field
// works them out again only round the runs that changed ( a spot's height comes from the runs that reach it ).
let fieldRuns: { field: Field; x0: number; z0: number; sp: number; w: number; h: number; r: Raster } | null = null;

/**
 * rasterRuns ( where runs fully cover ) on a field's grid: with `changed` ( the last field's runs since changed ),
 * the last one's kept but within those and where it didn't reach.
**/
function fieldRaster( placed: Placed[], x0: number, z0: number, sp: number, w: number, h: number, changed: Rect[] | null ): Raster {
  const last = changed && fieldRuns && fieldRuns.sp === sp ? fieldRuns : null;
  if ( !last ) return rasterRuns( placed, x0, z0, sp, w, h, true );
  const y  = new Float32Array( w * h ), cover = new Float32Array( w * h );
  const k  = last.r?.k || placed.some( ( p ) => p.detail > 0 ) ? new Float32Array( w * h ) : null;
  const ox = Math.round( ( x0 - last.x0 ) / sp ), oz = Math.round( ( z0 - last.z0 ) / sp );
  if ( last.r )
    for ( let j = 0; j < h; j++ ) {
      const lj = j + oz;
      if ( lj < 0 || lj >= last.h ) continue;
      for ( let i = 0; i < w; i++ ) {
        const li = i + ox;
        if ( li < 0 || li >= last.w ) continue;
        const a  = j * w + i, b = lj * last.w + li;
        y[a]     = last.r.y[b];
        cover[a] = last.r.cover[b];
        if ( k && last.r.k ) k[a] = last.r.k[b];
      }
    }
  // worked out again: round the runs that changed ( their boxes reach as far as they do ), and where the last didn't
  const redo: [number, number, number, number][] = [];
  for ( const r of changed! ) redo.push( [Math.floor( ( r[0] - x0 ) / sp ) - 1, Math.floor( ( r[1] - z0 ) / sp ) - 1, Math.ceil( ( r[2] - x0 ) / sp ) + 1, Math.ceil( ( r[3] - z0 ) / sp ) + 1] );
  if ( ox < 0 ) redo.push( [0, 0, -ox - 1, h   - 1] );
  if ( oz < 0 ) redo.push( [0, 0, w   - 1, -oz - 1] );
  if ( ox + w > last.w ) redo.push( [last.w - ox, 0, w - 1, h - 1] );
  if ( oz + h > last.h ) redo.push( [0, last.h - oz, w - 1, h - 1] );
  for ( const [a0, b0, a1, b1] of redo ) {
    const i0 = Math.max( 0, a0 ), j0 = Math.max( 0, b0 ), i1 = Math.min( w - 1, a1 ), j1 = Math.min( h - 1, b1 );
    if ( i1 < i0 || j1 < j0 ) continue;
    const rw = i1 - i0 + 1, rh = j1 - j0 + 1, sub = rasterRuns( placed, x0 + i0 * sp, z0 + j0 * sp, sp, rw, rh, true );
    for ( let j = 0; j < rh; j++ )
      for ( let i = 0; i < rw; i++ ) {
        const a  = ( j0 + j ) * w + i0 + i, b = j * rw + i;
        y[a]     = sub ? sub.y[b]     : 0;
        cover[a] = sub ? sub.cover[b] : 0;
        if ( k ) k[a] = sub?.k ? sub.k[b] : 0;
      }
  }
  return { y, cover, k };
}

/**
 * The bend for a net: on the runs, the run's height less the ground beneath. Off them, the runs' offsets spread
 * smoothly ( each free cell the average of its neighbours, so runs side by side at different heights grade into each
 * other ), fading to nothing `blend` metres away with 1 − 3t² + 2t³ of the way there: level beside a run, steepest
 * half way, easing into the ground beneath. Plus the noise away from the runs.
 *
 * With the last bend and where runs changed ( `changed` ), the spread is worked out again only within three blends
 * of those; elsewhere it's kept.
**/
export function solveField( net: TrailNet, s: GroundSettings, prev: Field | null, changed: Rect[] | null ): Field | null {
  const placed = place( net );
  const nb     = netBounds( net );
  if ( !nb || !placed.length ) {
    fieldRuns = null;
    return null;
  }
  const pad   = s.blend + 4;
  const bx0   = nb[0] - pad, bz0 = nb[1] - pad, bx1 = nb[2] + pad, bz1 = nb[3] + pad;
  // ( a smooth field: its grid as fine as the blend needs, never under 2 m )
  const sp    = Math.max( 2, Math.round( s.blend / 40 ), Math.max( bx1 - bx0, bz1 - bz0 ) / 2000 );
  // ( on a grid of `sp` from the world's origin, so fields of different nets line up )
  const x0    = Math.floor( bx0 / sp ) * sp, z0 = Math.floor( bz0 / sp ) * sp;
  const w     = Math.ceil( ( bx1 - x0 ) / sp ) + 1, h = Math.ceil( ( bz1 - z0 ) / sp ) + 1;
  const keep  = prev && prev.v === 2 && prev.b?.length === prev.w * prev.h && prev.s?.length === prev.w * prev.h && prev.sp === sp && changed && sameSettings( prev.settings, s ) ? prev : null;
  // the part worked out again ( W ): all of it, or within three blends of what changed and wherever the last field
  // didn't reach; worked on with a blend more round it ( R ), so runs just outside still count for distances
  const ox    = keep ? Math.round( ( x0 - keep.x0 ) / sp ) : 0, oz = keep ? Math.round( ( z0 - keep.z0 ) / sp ) : 0;
  let W: Rect = [0, 0, w - 1, h - 1];
  if ( keep ) {
    const M   = s.blend * 3 + sp * 2;
    let a     = w, b = h, c = -1, d = -1;
    const add = ( i0: number, j0: number, i1: number, j1: number ) => ( ( a = Math.min( a, i0 ) ), ( b = Math.min( b, j0 ) ), ( c = Math.max( c, i1 ) ), ( d = Math.max( d, j1 ) ) );
    for ( const r of changed! ) add( Math.floor( ( r[0] - M - x0 ) / sp ), Math.floor( ( r[1] - M - z0 ) / sp ), Math.ceil( ( r[2] + M - x0 ) / sp ), Math.ceil( ( r[3] + M - z0 ) / sp ) );
    // ( cells the last field didn't have: the grid grew )
    if ( -ox > 0 ) add( 0, 0, -ox - 1, h   - 1 );
    if ( -oz > 0 ) add( 0, 0, w   - 1, -oz - 1 );
    if ( w + ox > keep.w ) add( keep.w - ox, 0, w - 1, h - 1 );
    if ( h + oz > keep.h ) add( 0, keep.h - oz, w - 1, h - 1 );
    W = [Math.max( 0, a ), Math.max( 0, b ), Math.min( w - 1, c ), Math.min( h - 1, d )];
    // ( nothing to work out again: no run's ground changed, on the same grid — a run split where it is )
    if ( W[2] < W[0] || W[3] < W[1] ) return keep;
  }
  const m      = Math.ceil( s.blend / sp ) + 2;
  const R      = [Math.max( 0, W[0] - m ), Math.max( 0, W[1] - m ), Math.min( w - 1, W[2] + m ), Math.min( h - 1, W[3] + m )];
  const rw     = R[2] - R[0] + 1, rh = R[3] - R[1] + 1, rx0 = x0 + R[0] * sp, rz0 = z0 + R[1] * sp;
  // the last field's values, by this grid's cell ( NaN where it had none )
  const prevAt = ( S: Float32Array, i: number, j: number ) => {
    const pi = i + ox, pj = j + oz;
    return keep && pi >= 0 && pj >= 0 && pi < keep.w && pj < keep.h ? S[pj * keep.w + pi] : NaN;
  };
  const inW = ( i: number, j: number ) => i >= W[0] && i <= W[2] && j >= W[1] && j <= W[3];

  const ras         = fieldRaster( placed, rx0, rz0, sp, rw, rh, keep && fieldRuns?.field === prev ? changed : null );
  const g: FillGrid = { x0: rx0, z0: rz0, sp, w: rw, h: rh, fixed: new Uint8Array( rw * rh ), run: new Uint8Array( rw * rh ), value: new Float32Array( rw * rh ) };
  const base        = baseSampler();
  let sum           = 0, n = 0;
  if ( ras )
    for ( let j = 0; j < rh; j++ )
      for ( let i = 0; i < rw; i++ ) {
        const k = j * rw + i;
        if ( ras.cover[k] < 0.999 ) continue;
        const b = base( rx0 + i * sp, rz0 + j * sp );
        // ( off the map's ground: nothing there to bend )
        if ( Number.isNaN( b ) ) continue;
        g.run[k]   = 1;
        g.fixed[k] = 1;
        g.value[k] = ras.y[k] - b;
        sum       += g.value[k];
        n++;
      }
  const D = distanceToRuns( g );
  // the ground beneath smoothed ( ~8 m ), within 40 m of the runs: runs keeping its detail lay their shape on this
  const B = new Float32Array( rw * rh );
  {
    const mask = new Float32Array( rw * rh );
    for ( let j = 0; j < rh; j++ )
      for ( let i = 0; i < rw; i++ ) {
        const k = j * rw + i;
        if ( D[k] > 40 ) continue;
        const b = base( rx0 + i * sp, rz0 + j * sp );
        if ( Number.isNaN( b ) ) continue;
        B[k]    = b;
        mask[k] = 1;
      }
    const r = Math.max( 1, Math.round( 4 / sp ) );
    for ( let p = 0; p < 3; p++ ) {
      boxBlur( B,    rw, rh, r );
      boxBlur( mask, rw, rh, r );
    }
    for ( let k = 0; k < rw * rh; k++ ) B[k] = mask[k] > 1e-3 ? B[k] / mask[k] : 0;
  }
  // a run keeping the ground's detail: its offset taken from the smoothed ground where it does
  if ( ras?.k )
    for ( let k = 0; k < rw * rh; k++ ) {
      if ( !g.run[k] || !ras.k[k] ) continue;
      // ( so far the run's height less the ground beneath )
      const beneath = ras.y[k] - g.value[k];
      g.value[k]    = ras.y[k] - ( ( 1 - ras.k[k] ) * beneath + ras.k[k] * B[k] );
    }
  // the runs' offsets spread out from the nearest run ( beside a run's low end, the low end's: an average of the
  // runs round about lifted the ground there above the run ), then smoothed where runs side by side meet
  const near   = nearestValues( g );
  const pinned = new Uint8Array( rw * rh );
  for ( let j = 0; j < rh; j++ )
    for ( let i = 0; i < rw; i++ ) {
      const k = j * rw + i;
      if ( g.run[k] ) {
        pinned[k] = 1;
        continue;
      }
      if ( inW( R[0] + i, R[1] + j ) ) g.value[k] = n ? near[k] : 0;
      else {
        // ( outside what's worked out again: as it was )
        pinned[k]  = 1;
        g.value[k] = prevAt( keep!.s, R[0] + i, R[1] + j );
      }
    }
  {
    const r = Math.max( 1, Math.round( 6 / sp ) ), ones = new Float32Array( rw * rh ).fill( 1 ), keepV = g.value.slice();
    boxBlur( ones, rw, rh, r );
    for ( let p = 0; p < 3; p++ ) {
      boxBlur( g.value, rw, rh, r );
      for ( let k = 0; k < rw * rh; k++ ) g.value[k] = pinned[k] ? keepV[k] : g.value[k] / ones[k];
    }
  }
  const spreadR = g.value.slice();
  for ( let k = 0; k < rw * rh; k++ ) {
    if ( g.run[k] ) continue;
    const t     = Math.min( 1, D[k] / s.blend );
    g.value[k] *= 1 - t * t * ( 3 - 2 * t );
  }
  if ( s.amount > 0 ) {
    const rough = Math.min( 0.9, Math.max( 0.05, s.roughness ) );
    for ( let k = 0; k < rw * rh; k++ ) {
      if ( g.run[k] || D[k] >= s.blend ) continue;
      const t     = s.edge > 0 ? smooth( D[k] / s.edge ) : 1;
      // ( fading out again towards the blend's edge, where it meets the ground beneath )
      const u     = smooth( ( s.blend - D[k] ) / Math.max( 1, s.blend * 0.3 ) );
      g.value[k] += fbm( rx0 + ( k % rw ) * sp, rz0 + Math.floor( k / rw ) * sp, s.size, rough, s.seed ) * s.amount * t * u;
    }
  }
  // softened a little ( the grid's cells and the runs' stepped edges on it don't show )
  soften( g.value, rw, rh, 3 );
  // the whole field: the last one's where kept, the part worked out again over it
  const c = new Float32Array( w * h ), spread = new Float32Array( w * h ), smoothBase = new Float32Array( w * h );
  if ( keep )
    for ( let j = 0; j < h; j++ )
      for ( let i = 0; i < w; i++ ) {
        const pc = prevAt( keep.c, i, j );
        if ( Number.isNaN( pc ) ) continue;
        c[j          * w + i] = pc;
        spread[j     * w + i] = prevAt( keep.s, i, j );
        smoothBase[j * w + i] = prevAt( keep.b!, i, j );
      }
  for ( let j = W[1]; j <= W[3]; j++ )
    for ( let i = W[0]; i <= W[2]; i++ ) {
      const k               = ( j - R[1] ) * rw + i - R[0];
      c[j          * w + i] = g.value[k];
      spread[j     * w + i] = spreadR[k];
      smoothBase[j * w + i] = B[k];
    }
  const field: Field = { x0, z0, sp, w, h, c, s: spread, settings: { ...s }, v: 2, b: smoothBase };
  fieldRuns          = { field, x0: rx0, z0: rz0, sp, w: rw, h: rh, r: ras };
  return field;
}

/**
 * The ground's detail a run keeps: within 2.5 m ( real bumps and rolls are; a hole or spike in the data isn't ).
**/
export const detailOf = ( d: number ) => ( d < -2.5 ? -2.5 : d > 2.5 ? 2.5 : d );

/**
 * Each cell given the value of the nearest run cell ( an estimate: two passes over the grid, as distanceToRuns ).
**/
function nearestValues( g: FillGrid ) {
  const { w, h } = g, D = new Float32Array( w * h ).fill( 1e9 ), V = new Float32Array( w * h ), d1 = g.sp, d2 = g.sp * Math.SQRT2;
  for ( let k = 0; k < w * h; k++ ) if ( g.run[k] ) { D[k] = 0; V[k] = g.value[k]; }
  const take = ( k: number, q: number, d: number ) => {
    if ( D[q] + d < D[k] ) { D[k] = D[q] + d; V[k] = V[q]; }
  };
  for ( let j = 0; j < h; j++ )
    for ( let i = 0; i < w; i++ ) {
      const k = j * w + i;
      if ( i > 0 ) take( k, k - 1, d1 );
      if ( j > 0 ) {
        take( k, k - w, d1 );
        if ( i > 0 ) take( k, k - w - 1, d2 );
        if ( i < w - 1 ) take( k, k - w + 1, d2 );
      }
    }
  for ( let j = h - 1; j >= 0; j-- )
    for ( let i = w - 1; i >= 0; i-- ) {
      const k = j * w + i;
      if ( i < w - 1 ) take( k, k + 1, d1 );
      if ( j < h - 1 ) {
        take( k, k + w, d1 );
        if ( i < w - 1 ) take( k, k + w + 1, d2 );
        if ( i > 0 ) take( k, k + w - 1, d2 );
      }
    }
  return V;
}

/**
 * A box blur `r` cells each way, across then down ( sums kept running; cells past the edges count as nothing ).
**/
function boxBlur( v: Float32Array, w: number, h: number, r: number ) {
  const t = new Float32Array( Math.max( w, h ) ), n = 2 * r + 1;
  for ( let j = 0; j < h; j++ ) {
    const o = j * w;
    let sum = 0;
    for ( let i = 0; i <= r && i < w; i++ ) sum += v[o + i];
    for ( let i = 0; i < w; i++ ) {
      t[i] = sum / n;
      if ( i + r + 1 < w ) sum += v[o + i + r + 1];
      if ( i - r >= 0 ) sum -= v[o + i - r];
    }
    v.set( t.subarray( 0, w ), o );
  }
  for ( let i = 0; i < w; i++ ) {
    let sum = 0;
    for ( let j = 0; j <= r && j < h; j++ ) sum += v[j * w + i];
    for ( let j = 0; j < h; j++ ) {
      t[j] = sum / n;
      if ( j + r + 1 < h ) sum += v[( j + r + 1 ) * w + i];
      if ( j - r >= 0 ) sum -= v[( j - r ) * w + i];
    }
    for ( let j = 0; j < h; j++ ) v[j * w + i] = t[j];
  }
}

/**
 * `passes` times a 1-2-1 blur across, then down ( edges held by repeating the last cell ).
**/
function soften( v: Float32Array, w: number, h: number, passes: number ) {
  const t = new Float32Array( Math.max( w, h ) );
  for ( let p = 0; p < passes; p++ ) {
    for ( let j = 0; j < h; j++ ) {
      const o = j * w;
      for ( let i = 0; i < w; i++ ) t[i] = ( v[o + Math.max( 0, i - 1 )] + 2 * v[o + i] + v[o + Math.min( w - 1, i + 1 )] ) / 4;
      v.set( t.subarray( 0, w ), o );
    }
    for ( let i = 0; i < w; i++ ) {
      for ( let j = 0; j < h; j++ ) t[j] = ( v[Math.max( 0, j - 1 ) * w + i] + 2 * v[j * w + i] + v[Math.min( h - 1, j + 1 ) * w + i] ) / 4;
      for ( let j = 0; j < h; j++ ) v[j * w + i] = t[j];
    }
  }
}

/**
 * For tests: the last field's runs forgotten.
**/
export function resetField() {
  fieldRuns = null;
}
