// The ground on and round the runs, worked out from how far each spot is from each run ( from v7 trails ): no strips
// with edges to meet, so nothing to fold, step or leave a wedge. Each run is a table of its surface ( rows along it,
// columns across, from runStrip ) and its centre line; a spot takes the run's points about as near as its nearest
// ( more of them inside a bend ), the run's height there for how far across it is, and how much it covers ( fading past
// the run's ends: round ends, corners and junctions flow into each other ); the runs' heights are blended by how near their
// middles the spot is.

import type { Strip } from "./trails";

type Box = [number, number, number, number];

// rows of centre line to a piece ( pieces, overlapping by a row, are only for finding the runs near a spot )
const PIECE = 8;
// how much further than the nearest point a run's other points still count ( m )
const BAND  = 2;

export interface Surface {
  run:      string;
  rows:     number;
  cols:     number;
  // heights, rows × cols ( the strip's own: edge columns at ±1 across, skirt columns past them )
  y:        Float32Array;
  // per row: centre, the way along ( unit ), half width, skirt
  cx:       Float32Array;
  cz:       Float32Array;
  tx:       Float32Array;
  tz:       Float32Array;
  half:     Float32Array;
  skirt:    Float32Array;
  // ( box: the centre line's, padded by how far the run's cover reaches; bow: how far its centre line strays from the
  // straight line between its ends )
  pieces:   { k0: number; k1: number; box: Box; bow: number; half: number }[];
  box:      Box;
  // the furthest its cover reaches from its centre line, squared
  reach2:   number;
  // how the ground carries on past its start and end: half the run's slope there, outwards ( at most 1 in 8 )
  endSlope: [number, number];
  detail:   number;
}

const smooth = ( u: number ) => ( u <= 0 ? 0 : u >= 1 ? 1 : u * u * ( 3 - 2 * u ) );

/**
 * How far ( x, z ) is from the line from ( ax, az ) to ( bx, bz ).
**/
function segDist( x: number, z: number, ax: number, az: number, bx: number, bz: number ) {
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1e-9;
  const u  = Math.max( 0, Math.min( 1, ( ( x - ax ) * vx + ( z - az ) * vz ) / l2 ) );
  return Math.hypot( x - ax - vx * u, z - az - vz * u );
}

/**
 * A run's surface from its strip ( its own rows: first..last ).
**/
export function surfaceOf( strip: Strip, detail: number ): Surface {
  const rows = strip.last - strip.first + 1, cols = strip.cols, mid = ( cols - 1 ) / 2, P = strip.pts;
  const at   = ( k: number, q: number ) => ( ( k + strip.first ) * cols + q ) * 4;
  const y    = new Float32Array( rows * cols ), cx = new Float32Array( rows ), cz = new Float32Array( rows ), tx = new Float32Array( rows ), tz = new Float32Array( rows );
  const half = new Float32Array( rows ), skirt = new Float32Array( rows );
  for ( let k = 0; k < rows; k++ ) {
    for ( let q = 0; q < cols; q++ ) y[k * cols + q] = P[at( k, q ) + 1];
    const c  = at( k, mid );
    cx[k]    = P[c];
    cz[k]    = P[c + 2];
    const e1 = at( k, 1 ), e2 = at( k, cols - 2 ), s1 = at( k, 0 ), s2 = at( k, cols - 1 );
    half[k]  = ( Math.hypot( P[e1] - P[c], P[e1 + 2] - P[c + 2] ) + Math.hypot( P[e2] - P[c], P[e2 + 2] - P[c + 2] ) ) / 2;
    skirt[k] = Math.max( 0.5, ( Math.hypot( P[s1] - P[e1], P[s1 + 2] - P[e1 + 2] ) + Math.hypot( P[s2] - P[e2], P[s2 + 2] - P[e2 + 2] ) ) / 2 );
  }
  for ( let k = 0; k < rows; k++ ) {
    const a  = Math.max( 0, k - 1 ), b = Math.min( rows - 1, k + 1 );
    const dx = cx[b] - cx[a], dz = cz[b] - cz[a], l = Math.hypot( dx, dz ) || 1;
    tx[k]    = dx / l;
    tz[k]    = dz / l;
  }
  const pieces: Surface["pieces"] = [];
  let X0                          = Infinity, Z0 = Infinity, X1 = -Infinity, Z1 = -Infinity, most = 0;
  for ( let k0 = 0; k0 < rows - 1; k0 += PIECE ) {
    const k1 = Math.min( rows - 1, k0 + PIECE );
    let x0   = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, reach = 0, widest = 0;
    for ( let k = k0; k <= k1; k++ ) {
      x0     = Math.min( x0, cx[k] );
      x1     = Math.max( x1, cx[k] );
      z0     = Math.min( z0, cz[k] );
      z1     = Math.max( z1, cz[k] );
      reach  = Math.max( reach,  half[k] + skirt[k] );
      widest = Math.max( widest, half[k]            );
    }
    most           = Math.max( most, reach );
    const box: Box = [x0 - reach, z0 - reach, x1 + reach, z1 + reach];
    let bow        = 0;
    for ( let k = k0 + 1; k < k1; k++ ) bow = Math.max( bow, segDist( cx[k], cz[k], cx[k0], cz[k0], cx[k1], cz[k1] ) );
    pieces.push( { k0, k1, box, bow: bow + 1e-3, half: widest } );
    X0 = Math.min( X0, box[0] );
    Z0 = Math.min( Z0, box[1] );
    X1 = Math.max( X1, box[2] );
    Z1 = Math.max( Z1, box[3] );
  }
  const slope = ( e1: number, e2: number ) => {
    const s = ( y[e1 * cols + mid] - y[e2 * cols + mid] ) / ( Math.hypot( cx[e1] - cx[e2], cz[e1] - cz[e2] ) || 1 );
    return Math.max( -0.25, Math.min( 0.25, s ) ) * 0.5;
  };
  const endSlope: [number, number] = [slope( 0, Math.min( 1, rows - 1 ) ), slope( rows - 1, Math.max( 0, rows - 2 ) )];
  return { run: strip.run, rows, cols, y, cx, cz, tx, tz, half, skirt, pieces, box: [X0, Z0, X1, Z1], reach2: most * most, endSlope, detail };
}

/**
 * The surface's height at row r ( fractional ) and `across` metres from its centre line ( − left, + right ).
**/
function heightAt( S: Surface, r: number, across: number ) {
  const k    = Math.min( S.rows - 2, Math.max( 0, Math.floor( r ) ) ), f = Math.min( 1, Math.max( 0, r - k ) );
  const half = S.half[k] + ( S.half[k + 1] - S.half[k] ) * f, skirt = S.skirt[k] + ( S.skirt[k + 1] - S.skirt[k] ) * f;
  const cols = S.cols, inner = cols - 2;
  const a    = Math.abs( across );
  let col: number;
  if ( a <= half ) col = 1 + ( ( across / Math.max( 1e-6, half ) + 1 ) / 2 ) * ( inner - 1 );
  else {
    const g = Math.min( 1, ( a - half ) / Math.max( 1e-6, skirt ) );
    col     = across < 0 ? 1 - g : inner + g;
  }
  const c0 = Math.min( cols - 2, Math.max( 0, Math.floor( col ) ) ), cf = col - c0;
  const o  = k * cols + c0, Y = S.y;
  const y0 = Y[o] + ( Y[o + 1] - Y[o] ) * cf, y1 = Y[o + cols] + ( Y[o + cols + 1] - Y[o + cols] ) * cf;
  return y0 + ( y1 - y0 ) * f;
}

/**
 * The surfaces' heights and how much they cover on a grid ( corner x0, z0; spacing sp; w × h ), and the detail they keep.
 * Fine grids are worked out on a lattice half a metre to a metre apart and filled in between ( the surfaces are smooth
 * at that size ). `onlyOn`: just where the runs fully cover ( tiles of the grid with no run's own width in them left
 * out, covering nothing ). `want` ( on a grid as coarse as the lattice ): just its spots that are set.
**/
export function evalSurfaces( surfs: Surface[], x0: number, z0: number, sp: number, w: number, h: number, onlyOn = false, want?: Uint8Array ): { y: Float32Array; cover: Float32Array; k: Float32Array | null } | null {
  const X1 = x0 + ( w - 1 ) * sp, Z1 = z0 + ( h - 1 ) * sp;
  const on = surfs.filter( ( { box } ) => !( box[2] < x0 || box[0] > X1 || box[3] < z0 || box[1] > Z1 ) );
  if ( !on.length ) return null;
  // the lattice: a quarter of the narrowest run's half width apart, between half a metre and a metre ( the grid itself
  // when it's coarser )
  let narrowest = Infinity;
  for ( const S of on ) for ( let k = 0; k < S.rows; k++ ) narrowest = Math.min( narrowest, S.half[k] );
  const apart      = Math.max( 0.5, Math.min( 1, narrowest / 4 ) ), step = sp >= apart ? 1 : Math.max( 1, Math.floor( apart / sp + 1e-6 ) );
  const lw         = Math.ceil( ( w - 1 ) / step ) + 1, lh = Math.ceil( ( h - 1 ) / step ) + 1, ls = sp * step;
  const ly         = new Float32Array( lw * lh ), lc = new Float32Array( lw * lh ), lk = on.some( ( s ) => s.detail > 0 ) ? new Float32Array( lw * lh ) : null;
  let any          = false;
  const most       = Math.max( ...on.map( ( S ) => S.rows ) );
  const dist2      = new Float64Array( most ), projU = new Float64Array( most );
  const mostPieces = Math.max( ...on.map( ( S ) => S.pieces.length ) ), lb = new Float64Array( mostPieces ), done = new Int32Array( mostPieces );
  const B2         = BAND * BAND;
  // in tiles of 8 × 8 spots ( 4 × 4 for onlyOn, left out finer ): first, each run's pieces that might hold the
  // nearest point to some spot in the tile ( none further than the nearest could be by more than BAND, nor beyond the furthest the cover reaches )
  const TILE       = onlyOn ? 4 : 8, cand = new Int32Array( on.length * mostPieces ), candN = new Int32Array( on.length );
  for ( let tj = 0; tj < lh; tj += TILE )
    for ( let ti = 0; ti < lw; ti += TILE ) {
      const tw  = Math.min( TILE, lw - ti ) - 1, th = Math.min( TILE, lh - tj ) - 1;
      const ux0 = x0 + ti * ls, uz0 = z0 + tj * ls, ux1 = ux0 + tw * ls, uz1 = uz0 + th * ls;
      const mx  = ( ux0 + ux1 ) / 2, mz = ( uz0 + uz1 ) / 2, rad = Math.hypot( ux1 - ux0, uz1 - uz0 ) / 2;
      let anyOn = !onlyOn;
      for ( let si = 0; si < on.length; si++ ) {
        const S   = on[si], cb = si * mostPieces;
        candN[si] = 0;
        if ( ux1 < S.box[0] || ux0 > S.box[2] || uz1 < S.box[1] || uz0 > S.box[3] ) continue;
        let ubMin = Infinity;
        for ( let q = 0; q < S.pieces.length; q++ ) {
          const pc = S.pieces[q];
          if ( ux1 < pc.box[0] || ux0 > pc.box[2] || uz1 < pc.box[1] || uz0 > pc.box[3] ) {
            lb[q] = Infinity;
            continue;
          }
          const d = segDist( mx, mz, S.cx[pc.k0], S.cz[pc.k0], S.cx[pc.k1], S.cz[pc.k1] );
          lb[q]   = d - rad - pc.bow;
          ubMin   = Math.min( ubMin, d + rad + pc.bow );
          if ( lb[q] < pc.half ) anyOn = true;
        }
        const reach = Math.sqrt( S.reach2 );
        let n       = 0;
        for ( let q = 0; q < S.pieces.length; q++ ) {
          const l = lb[q];
          if ( l === Infinity || l >= reach || ( l > 0 && l * l >= ubMin * ubMin + B2 ) ) continue;
          cand[cb + n++] = q;
        }
        candN[si] = n;
      }
      if ( !anyOn ) continue;
      // then each spot
      for ( let j = tj; j <= tj + th; j++ )
        for ( let i = ti; i <= ti + tw; i++ ) {
          if ( want && step === 1 && !want[j * lw + i] ) continue;
          const px = x0 + i * ls, pz = z0 + j * ls;
          let sy   = 0, sw = 0, sk = 0, open = 1;
          for ( let si = 0; si < on.length; si++ ) {
            const nC = candN[si];
            if ( !nC ) continue;
            const S   = on[si], cb = si * mostPieces;
            // each segment's distance, and the nearest: the pieces nearest first, those that can't come within BAND of it
            // skipped
            let first = -1, firstLb = Infinity, nIn = 0;
            for ( let n = 0; n < nC; n++ ) {
              const q = cand[cb + n], pc = S.pieces[q];
              if ( px < pc.box[0] || px > pc.box[2] || pz < pc.box[1] || pz > pc.box[3] ) {
                lb[q] = Infinity;
                continue;
              }
              // ( at least as far as the straight line between its ends, less how far it strays from it )
              const ax = S.cx[pc.k0], az = S.cz[pc.k0], vx = S.cx[pc.k1] - ax, vz = S.cz[pc.k1] - az, l2 = vx * vx + vz * vz || 1e-9;
              const uu = ( ( px - ax ) * vx + ( pz - az ) * vz ) / l2, u = uu < 0 ? 0 : uu > 1 ? 1 : uu;
              const dx = px - ax - vx * u, dz = pz - az - vz * u, d = Math.sqrt( dx * dx + dz * dz ) - pc.bow;
              lb[q]    = d > 0 ? d * d : 0;
              nIn++;
              if ( lb[q] < firstLb ) { firstLb = lb[q]; first = q; }
            }
            if ( !nIn ) continue;
            let d2min = Infinity, nDone = 0;
            for ( let qi = -1; qi < nC; qi++ ) {
              const q = qi < 0 ? first : cand[cb + qi];
              if ( qi >= 0 && ( q === first || lb[q] >= d2min + B2 ) ) continue;
              const pc      = S.pieces[q];
              done[nDone++] = q;
              for ( let k = pc.k0; k < pc.k1; k++ ) {
                const ax = S.cx[k], az = S.cz[k], vx = S.cx[k + 1] - ax, vz = S.cz[k + 1] - az, l2 = vx * vx + vz * vz || 1e-9;
                const uu = ( ( px - ax ) * vx + ( pz - az ) * vz ) / l2, u = uu < 0 ? 0 : uu > 1 ? 1 : uu;
                const dx = px - ( ax + vx * u ), dz = pz - ( az + vz * u ), d2 = dx * dx + dz * dz;
                dist2[k] = d2;
                projU[k] = uu;
                if ( d2 < d2min ) d2min = d2;
              }
            }
            // ( beyond the furthest its cover reaches )
            if ( d2min >= S.reach2 ) continue;
            // the run there: every segment nearly as near as the nearest, blended ( inside a tight bend the nearest point
            // jumps along the run; blended, the ground doesn't step )
            let ry = 0, rc = 0, rs = 0, rk = 0;
            for ( let n = 0; n < nDone; n++ ) {
              const pc = S.pieces[done[n]];
              if ( lb[done[n]] >= d2min + B2 ) continue;
              for ( let k = pc.k0; k < pc.k1; k++ ) {
                // ( by squared distance: a straight run's points count within BAND of the nearest along it, however far
                // across the spot is; nearing a bend's centre, ever more of it )
                const e = ( dist2[k] - d2min ) / B2;
                if ( e >= 1 ) continue;
                const dk     = Math.sqrt( dist2[k] );
                const g      = smooth( 1 - e );
                const raw    = projU[k], f = raw < 0 ? 0 : raw > 1 ? 1 : raw, r = k + f;
                const qx     = S.cx[k] + ( S.cx[k + 1] - S.cx[k] ) * f, qz = S.cz[k] + ( S.cz[k + 1] - S.cz[k] ) * f;
                const tx     = S.tx[k] + ( S.tx[k + 1] - S.tx[k] ) * f, tz = S.tz[k] + ( S.tz[k + 1] - S.tz[k] ) * f;
                const half   = S.half[k] + ( S.half[k + 1] - S.half[k] ) * f, skirt = S.skirt[k] + ( S.skirt[k + 1] - S.skirt[k] ) * f;
                // across ( + right of the way along ) and, past the run's own ends, how far past
                const across = ( px - qx ) * tz - ( pz - qz ) * tx;
                let along    = 0;
                if ( k === 0 && raw < 0 ) along = -( ( px - qx ) * tx + ( pz - qz ) * tz );
                else if ( k === S.rows - 2 && raw > 1 ) along = ( px - qx ) * tx + ( pz - qz ) * tz;
                const coverL = dk <= half ? 1 : Math.max( 0, 1 - ( dk - half ) / skirt );
                // ( past an end: fading out within half the run's width, carrying on half its slope along )
                const c      = coverL * ( along > 0 ? Math.max( 0, 1 - along / Math.max( 1e-6, half ) ) : 1 );
                let yy       = heightAt( S, r, across );
                if ( along > 0 ) yy += ( k === 0 ? S.endSlope[0] : S.endSlope[1] ) * along;
                // ( its say where runs meet: most along its middle, falling smoothly to nothing where its cover ends )
                const t   = Math.min( 1, dk / Math.max( 1e-6, half + skirt ) ), q = 1 - t * t;
                const say = q * q * q * ( along > 0 ? smooth( 1 - along / Math.max( 1e-6, half ) ) : 1 );
                ry       += yy  * g;
                rc       += c   * g;
                rs       += say * g;
                rk       += g;
              }
            }
            if ( rk <= 0 ) continue;
            const c = rc / rk;
            if ( c <= 0 ) continue;
            const wt = rs / rk + 1e-6;
            sy      += ( ry / rk ) * wt;
            sw      += wt;
            if ( lk ) sk += S.detail * wt;
            // ( cover: theirs together, smoothly; the most of them would crease where two runs' meet )
            open *= 1 - c;
          }
          if ( sw > 0 ) {
            const o = j * lw + i;
            ly[o]   = sy / sw;
            lc[o]   = 1 - open;
            if ( lk ) lk[o] = sk / sw;
            any = true;
          }
        }
    }
  if ( !any ) return null;
  if ( step === 1 ) return { y: ly, cover: lc, k: lk };
  // filled in between
  const y = new Float32Array( w * h ), cover = new Float32Array( w * h ), kk = lk ? new Float32Array( w * h ) : null;
  for ( let j = 0; j < h; j++ ) {
    const fj = j / step, b = Math.min( lh - 2, Math.floor( fj ) ), tj = fj - b;
    for ( let i = 0; i < w; i++ ) {
      const fi   = i / step, a = Math.min( lw - 2, Math.floor( fi ) ), ti = fi - a, o = b * lw + a, k = j * w + i;
      const lerp = ( A: Float32Array ) => {
        const p = A[o] + ( A[o + 1] - A[o] ) * ti, q = A[o + lw] + ( A[o + lw + 1] - A[o + lw] ) * ti;
        return p + ( q - p ) * tj;
      };
      // ( heights only between lattice points that have them: where cover falls to nothing, the one that does )
      const c00 = lc[o], c10 = lc[o + 1], c01 = lc[o + lw], c11 = lc[o + lw + 1];
      cover[k]  = lerp( lc );
      if ( cover[k] <= 0 ) continue;
      if ( c00 > 0 && c10 > 0 && c01 > 0 && c11 > 0 ) y[k] = lerp( ly );
      else {
        let s     = 0, n = 0;
        const add = ( c: number, v: number, wgt: number ) => c > 0 && ( ( s += v * wgt ), ( n += wgt ) );
        add( c00, ly[o],          ( 1 - ti ) * ( 1 - tj ) );
        add( c10, ly[o + 1],      ti * ( 1 - tj )         );
        add( c01, ly[o + lw],     ( 1 - ti ) * tj         );
        add( c11, ly[o + lw + 1], ti * tj                 );
        y[k] = n > 0 ? s / n : 0;
      }
      if ( kk && lk ) kk[k] = lerp( lk );
    }
  }
  return { y, cover, k: kk };
}

/**
 * The runs as one shape on a grid ( corner x0, z0; spacing sp; w × h ): how far each spot is outside the nearest run's
 * own width ( negative inside; worked out only up to `cut` away, `cut` beyond ), and which run that is ( its index in
 * `surfs`, -1 none ). Runs that meet or overlap are one shape, round where they meet and at their ends.
**/
export function outlineField( surfs: Surface[], x0: number, z0: number, sp: number, w: number, h: number, cut: number ): { f: Float32Array; near: Int16Array } {
  const f = new Float32Array( w * h ).fill( cut ), near = new Int16Array( w * h ).fill( -1 );
  for ( let si = 0; si < surfs.length; si++ ) {
    const S = surfs[si];
    for ( const pc of S.pieces ) {
      // ( the spots the piece can reach: its centre line's box, padded by its width and `cut` )
      const pad = pc.half + pc.bow + cut;
      let bx0   = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
      for ( let k = pc.k0; k <= pc.k1; k++ ) {
        bx0 = Math.min( bx0, S.cx[k] );
        bx1 = Math.max( bx1, S.cx[k] );
        bz0 = Math.min( bz0, S.cz[k] );
        bz1 = Math.max( bz1, S.cz[k] );
      }
      const i0 = Math.max( 0, Math.floor( ( bx0 - pad - x0 ) / sp ) ), i1 = Math.min( w - 1, Math.ceil( ( bx1 + pad - x0 ) / sp ) );
      const j0 = Math.max( 0, Math.floor( ( bz0 - pad - z0 ) / sp ) ), j1 = Math.min( h - 1, Math.ceil( ( bz1 + pad - z0 ) / sp ) );
      for ( let j = j0; j <= j1; j++ )
        for ( let i = i0; i <= i1; i++ ) {
          const px = x0 + i * sp, pz = z0 + j * sp, o = j * w + i;
          let best = f[o];
          for ( let k = pc.k0; k < pc.k1; k++ ) {
            const ax = S.cx[k], az = S.cz[k], vx = S.cx[k + 1] - ax, vz = S.cz[k + 1] - az, l2 = vx * vx + vz * vz || 1e-9;
            const uu = ( ( px - ax ) * vx + ( pz - az ) * vz ) / l2, u = uu < 0 ? 0 : uu > 1 ? 1 : uu;
            const dx = px - ax - vx * u, dz = pz - az - vz * u;
            const v  = Math.sqrt( dx * dx + dz * dz ) - ( S.half[k] + ( S.half[k + 1] - S.half[k] ) * u );
            if ( v < best ) {
              best    = v;
              near[o] = si;
            }
          }
          f[o] = best;
        }
    }
  }
  return { f, near };
}
