// A run's surface as a strip of points ( rows along it, columns across: the skirt each side, then the run ), easing
// into the runs it meets; the pads where runs meet; the handles on it; its triangles.

import { evalCurve } from "../../core/curve";
import { bez, bezD, bezDD, controls, runLength } from "./line";
import { type TrailNet, type TrailNode, type TrailRun, type V3, nodeOf, runsAt } from "./net";

export const smooth = ( u: number ) => ( u <= 0 ? 0 : u >= 1 ? 1 : u * u * ( 3 - 2 * u ) );

/**
 * Smooth through 0, ½, 1 ( each key's neighbourhood eased into the next ).
**/
export const through3 = ( a: number, m: number, b: number, t: number ) => ( t < 0.5 ? a + ( m - a ) * smooth( t * 2 ) : m + ( b - m ) * smooth( t * 2 - 1 ) );

/**
 * The run's own height across it at fraction t along ( s: −1 left … 1 right ), above its centre line: roll,
 * cross-section and the corner / side handles ( each side's handles fading in from the middle ).
**/
function lateral( r: TrailRun, t: number, s: number, halfW: number ) {
  const roll  = -Math.tan( ( r.roll * Math.PI ) / 180 ) * s * halfW;
  const cross = r.crossDepth ? evalCurve( r.cross, ( s + 1 ) / 2 ) * r.crossDepth : 0;
  const side  = s < 0 ? through3( r.corners[0], r.mids[0], r.corners[2], t ) : through3( r.corners[1], r.mids[1], r.corners[3], t );
  return roll + cross + side * smooth( Math.abs( s ) );
}

// How far into a run ( fraction of it ) its ends ease into the run they meet at a point with just the two.
const MEET = 0.2;

/**
 * At a point with exactly two runs, the other one and which of its ends is there.
**/
function partner( net: TrailNet, r: TrailRun, end: "a" | "b" ) {
  const id = end === "a" ? r.a : r.b;
  const at = runsAt( net, id );
  if ( at.length !== 2 ) return null;
  const o = at[0] === r ? at[1] : at[0];
  if ( o === r ) return null;
  return { o, end: ( o.a === id ? "a" : "b" ) as "a" | "b" };
}

export interface Strip {
  run:   string;
  // rows along × cols across; each sample x, y, z, cover ( 1 on the run, falling to 0 over its skirt )
  rows:  number;
  cols:  number;
  pts:   Float32Array;
  // each sample's place across ( −1 one side … 1 the other; a pad's: out from its middle, 0 … 1 )
  lat:   Float32Array;
  // the run's own rows ( its ends' rows: the handles' rows ), and the rows it covers ( with rounded ends' caps )
  first: number;
  last:  number;
  in0:   number;
  in1:   number;
}

// steepest a skirt carries a run's slope on ( a half-pipe's walls aren't carried on up )
const SKIRT_SLOPE = 0.6;

/**
 * The first trails' edge blend ( runs without their own `edge` ).
**/
export const skirtOf = ( w: number ) => Math.max( 6, w * 0.3 );

/**
 * The run as a grid of surface points ( about every `step` metres along, 11 across plus a skirt each side ): what's
 * drawn, and what the ground is made from. Where it meets one other run, its width and cross-section ease into
 * that run's, so the two join without a step.
**/
export function runStrip( net: TrailNet, r: TrailRun, step = 1, alone = false ): Strip {
  const c          = controls( net, r );
  const len        = runLength( net, r );
  const rows       = Math.max( 2, Math.ceil( len / step ) + 1 );
  const ACROSS     = 11, cols = ACROSS + 2;
  // ( an end with no other run there gets a row of skirt beyond it )
  const openA      = runsAt( net, r.a ).length === 1, openB = runsAt( net, r.b ).length === 1;
  const v4         = ( net.v ?? 1 ) >= 4;
  const v2         = ( net.v ?? 1 ) >= 2, v3 = ( net.v ?? 1 ) >= 3, v5 = ( net.v ?? 1 ) >= 5;
  const skirtSlope = v5 ? 0.25 : SKIRT_SLOPE;
  // ( v5: a junction's pad and the run's fade into it reach no more than 0.4 of the run )
  const padR       = ( n: TrailNode ) => Math.min( Math.max( ...runsAt( net, n.id ).map( ( x ) => ( x.a === n.id ? x.wa : x.wb ) ) ) / 2, v5 ? 0.4 * len : Infinity );
  // ( rounded ends: the caps are added after )
  const skirtRows  = !v4;
  const total      = rows + ( openA && skirtRows ? 1 : 0 ) + ( openB && skirtRows ? 1 : 0 ), first = openA && skirtRows ? 1 : 0;
  const lat        = new Float32Array( total * cols );
  const ends       = [{ halfW: 0, rx: 0, rz: 0 }, { halfW: 0, rx: 0, rz: 0 }];
  const pts        = new Float32Array( total * cols * 4 );
  const endSkirt   = [0, 0];
  // ( alone: the run as it is by itself, not eased into what it meets )
  const pa         = alone ? null : partner( net, r, "a" ), pb = alone ? null : partner( net, r, "b" );
  // ends at a point three or more runs meet: eased into the plane through the point at its tilt, so they all meet
  const junction   = ( id: string ) => ( ( net.v ?? 1 ) >= 2 && runsAt( net, id ).length >= 3 ? nodeOf( net, id ) : null );
  const ja         = alone ? null : junction( r.a ), jb = alone ? null : junction( r.b );
  // ( v4: eased in over the junction's pad and half as far again, so the runs and the pad agree where they meet )
  const padEase    = ( n: TrailNode | null ) => {
    if ( !n || ( net.v ?? 1 ) < 4 ) return MEET;
    const R = padR( n );
    return Math.min( 0.5, Math.max( MEET, ( 1.5 * R ) / Math.max( 1, len ) ) );
  };
  const meetA   = padEase( ja ), meetB = padEase( jb );
  // ( v5: two runs at a point ease into each other over half the run's width at least, half the run at most: over a
  // fifth of a short run, the change across the point was a step )
  const meetTwo = v5 ? Math.min( 0.5, Math.max( MEET, ( Math.max( r.wa, r.wb ) / 2 ) / Math.max( 1, len ) ) ) : MEET;
  const plane   = ( n: TrailNode, x: number, z: number ) => n.p[1] + ( n.tilt ? n.tilt[0] * ( x - n.p[0] ) + n.tilt[1] * ( z - n.p[2] ) : 0 );
  const widthAt = ( run: TrailRun, end: "a" | "b" ) => ( end === "a" ? run.wa : run.wb );
  const dirs    = [0, 0, 0, 0];
  for ( let k = 0; k < rows; k++ ) {
    const t    = k / ( rows - 1 );
    const x    = bez( c[0][0], c[1][0], c[2][0], c[3][0], t ), z = bez( c[0][2], c[1][2], c[2][2], c[3][2], t );
    const y    = bez( c[0][1], c[1][1], c[2][1], c[3][1], t ) + ( r.bump ? evalCurve( r.profile, t ) * r.bump : 0 );
    let dx     = bezD( c[0][0], c[1][0], c[2][0], c[3][0], t ), dz = bezD( c[0][2], c[1][2], c[2][2], c[3][2], t );
    const dl   = Math.hypot( dx, dz ) || 1;
    dx        /= dl;
    dz        /= dl;
    // right of the way it runs ( Unity: +Z forward → +X right )
    const rx   = dz, rz = -dx;
    // ( v6: how far each side may reach before the curve's centre, on a curve tighter than the run is wide )
    let reachR = Infinity, reachL = Infinity;
    if ( ( net.v ?? 1 ) === 6 ) {
      const across = bezDD( c[0][0], c[1][0], c[2][0], c[3][0], t ) * rx + bezDD( c[0][2], c[1][2], c[2][2], c[3][2], t ) * rz;
      if ( Math.abs( across ) > 1e-9 ) {
        const R = ( 0.9 * dl * dl ) / Math.abs( across );
        if ( across > 0 ) reachR = R;
        else reachL = R;
      }
    }
    let w      = r.wa + ( r.wb - r.wa ) * smooth( t );
    // easing into the run met at each end: towards the average of the two there
    const ease = ( p: { o: TrailRun; end: "a" | "b" } | null, f: number, mine: "a" | "b" ) => {
      if ( !p || f >= 1 ) return null;
      return { p, k: 1 - smooth( f ), mine };
    };
    const ea = ease( pa, t / meetTwo, "a" ), eb = ease( pb, ( 1 - t ) / meetTwo, "b" );
    for ( const e of [ea, eb] ) if ( e ) w += ( ( widthAt( e.p.o, e.p.end ) - widthAt( r, e.mine ) ) / 2 ) * e.k;
    const halfW = w / 2, skirt = r.edge ?? skirtOf( w );
    if ( k === 0    ) { endSkirt[0] = skirt; dirs[0] = dx; dirs[1] = dz; ends[0] = { halfW, rx, rz }; }
    if ( k === rows - 1 ) { endSkirt[1] = skirt; dirs[2] = dx; dirs[3] = dz; ends[1] = { halfW, rx, rz }; }
    for ( let q = 0; q < cols; q++ ) {
      // across: the skirt column each side, then 11 on the run
      const s   = q === 0 ? -1 : q === cols - 1 ? 1 : -1 + ( 2 * ( q - 1 ) ) / ( ACROSS - 1 );
      const out = q === 0 || q === cols - 1 ? skirt : 0;
      let h     = lateral( r, t, s, halfW );
      for ( const e of [ea, eb] ) {
        if ( !e ) continue;
        // the other run's side that's on our left is its right when it points the other way
        const flip   = ( e.mine === "a" ) === ( e.p.end === "a" );
        const theirs = lateral( e.p.o, e.p.end === "a" ? 0 : 1, flip ? -s : s, halfW );
        const mine   = lateral( r,     e.mine === "a" ? 0 : 1,  s,             halfW );
        h           += ( ( theirs - mine ) / 2 ) * e.k;
      }
      // ( across from the line, edge and skirt included, no further than this side reaches )
      const off = Math.sign( s ) * Math.min( Math.abs( s ) * halfW + out, s > 0 ? reachR : reachL );
      const sx  = x + rx * Math.sign( s ) * Math.min( Math.abs( s ) * halfW, s > 0 ? reachR : reachL ), sz = z + rz * Math.sign( s ) * Math.min( Math.abs( s ) * halfW, s > 0 ? reachR : reachL );
      if ( ja && t < meetA ) {
        const k = smooth( t / meetA );
        h       = h * k + ( plane( ja, sx, sz ) - y ) * ( 1 - k );
      }
      if ( jb && t > 1 - meetB ) {
        const k = smooth( ( 1 - t ) / meetB );
        h       = h * k + ( plane( jb, sx, sz ) - y ) * ( 1 - k );
      }
      const o                       = ( ( k + first ) * cols + q ) * 4;
      lat[( k + first ) * cols + q] = s;
      pts[o]                        = x + rx * off;
      pts[o + 1]                    = y + h;
      pts[o + 2]                    = z + rz * off;
      pts[o + 3]                    = out ? 0 : 1;
    }
    // ( the skirt carries on the run's slope across, not level: on a side slope it lies on the hill )
    if ( v2 ) {
      const gap = ( 2 * halfW ) / ( ACROSS - 1 ), row = ( k + first ) * cols * 4;
      for ( const [sk, e1, e2] of [[0, 1, 2], [cols - 1, cols - 2, cols - 3]] ) {
        const y1              = pts[row + e1 * 4 + 1], y2 = pts[row + e2 * 4 + 1];
        pts[row + sk * 4 + 1] = y1 + Math.max( -skirtSlope, Math.min( skirtSlope, ( y1 - y2 ) / gap ) ) * skirt;
      }
    }
  }
  // the open ends' skirt rows: the end row again, pushed out along the run, cover 0
  const copyRow = ( from: number, to: number, dx: number, dz: number, d: number ) => {
    // ( beyond the end: carrying on half the run's slope along it, from the row before; all of it on v2 nets )
    const prev = from + ( from > to ? 1 : -1 );
    for ( let q = 0; q < cols; q++ ) {
      const a    = ( from * cols + q ) * 4, b = ( to * cols + q ) * 4, c = ( prev * cols + q ) * 4;
      const step = Math.hypot( pts[a] - pts[c], pts[a + 2] - pts[c + 2] ) || 1;
      pts[b]     = pts[a] + dx * d;
      pts[b + 1] = pts[a + 1] + ( v2 ? Math.max( -skirtSlope, Math.min( skirtSlope, ( pts[a + 1] - pts[c + 1] ) / step ) ) * d * ( v3 ? 0.5 : 1 ) : 0 );
      pts[b + 2] = pts[a + 2] + dz * d;
      pts[b + 3] = 0;
    }
  };
  // ( v7: just the run's own rows; its ends are worked out from distances )
  if ( ( net.v ?? 1 ) >= 7 ) return { run: r.id, rows: total, cols, pts, lat, first: 0, last: total - 1, in0: 0, in1: total - 1 };
  if ( !v4 ) {
    if ( openA ) copyRow( 1, 0, -dirs[0], -dirs[1], endSkirt[0] );
    if ( openB ) copyRow( total - 2, total - 1, dirs[2], dirs[3], endSkirt[1] );
    for ( const row of [openA ? 0 : -1, openB ? total - 1 : -1] ) if ( row >= 0 ) for ( let q = 0; q < cols; q++ ) lat[row * cols + q] = lat[( row === 0 ? 1 : total - 2 ) * cols + q];
    const last = total - 1 - ( openB ? 1 : 0 );
    return { run: r.id, rows: total, cols, pts, lat, first, last, in0: first, in1: last };
  }
  // rounded open ends: a half circle past the end, as wide as the run there, each row of it the end's own heights
  // across ( carrying on half its slope along ), fading out towards the rim ( as the run itself would only stand
  // proud of or dig into a hill past its point ), its skirt out round the curve; then a row of skirt at the tip
  type CapRow = { p: number[]; l: number[] };
  const CAP   = 6;
  const cap   = ( endRow: number, prevRow: number, out: [number, number], e: { halfW: number; rx: number; rz: number }, skirt: number, carry: number, size = 1 ) => {
    const rowsOut: CapRow[] = [];
    const c0                = ( endRow * cols + ( cols - 1 ) / 2 ) * 4, cp = ( prevRow * cols + ( cols - 1 ) / 2 ) * 4;
    const cx                = pts[c0], cz = pts[c0 + 2];
    const step              = Math.hypot( pts[c0] - pts[cp], pts[c0 + 2] - pts[cp + 2] ) || 1;
    const slope             = Math.max( -skirtSlope, Math.min( skirtSlope, ( pts[c0 + 1] - pts[cp + 1] ) / step ) ) * carry;
    const R                 = e.halfW * size;
    for ( let i = 1; i <= CAP + 1; i++ ) {
      const tip         = i > CAP, phi = ( Math.min( i, CAP ) / CAP ) * ( Math.PI / 2 );
      const d           = R * Math.sin( phi ), hw = R * Math.cos( phi );
      const p: number[] = [], l: number[] = [];
      for ( let q = 0; q < cols; q++ ) {
        const s    = q === 0 ? -1 : q === cols - 1 ? 1 : -1 + ( 2 * ( q - 1 ) ) / ( ACROSS - 1 );
        const edge = q === 0 || q === cols - 1;
        const h    = pts[( endRow * cols + q ) * 4 + 1] + slope * d;
        let x      = cx + out[0] * d + e.rx * s * hw, z = cz + out[1] * d + e.rz * s * hw, cover = R > 0 ? 1 - d / R : 0;
        if ( edge || tip ) {
          // out round the curve ( at the tip, straight on )
          let ox = out[0] * Math.sin( phi ) + e.rx * Math.sign( s ) * Math.cos( phi ), oz = out[1] * Math.sin( phi ) + e.rz * Math.sign( s ) * Math.cos( phi );
          if ( tip ) { ox = out[0]; oz = out[1]; }
          const ol = Math.hypot( ox, oz ) || 1;
          x       += ( ox / ol ) * skirt;
          z       += ( oz / ol ) * skirt;
          cover    = 0;
        }
        p.push( x, h, z, cover );
        l.push( s );
      }
      rowsOut.push( { p, l } );
    }
    return rowsOut;
  };
  // ends where three or more runs meet: fading out towards the point, its round pad taking over ( stopping dead
  // there, the runs left thin wedges between them that none covered, and the ground jumped across them )
  for ( const [n, atStart] of [[ja, true], [jb, false]] as const ) {
    if ( !n ) continue;
    const R = padR( n );
    for ( let k = 0; k < rows; k++ ) {
      const dist = ( atStart ? k / ( rows - 1 ) : 1 - k / ( rows - 1 ) ) * len;
      if ( dist >= R ) continue;
      const f = smooth( dist / R );
      for ( let q = 0; q < cols; q++ ) pts[( k * cols + q ) * 4 + 3] *= f;
    }
  }
  // ends at a point with one other run ( a bend ): a fading round end too, level ( carrying the slope on, at a peak it
  // rose past it while the next run came down ), so the outside of a bend is filled and its kink rounded
  // ( v5: only as much as the bend turns: a trail running straight through its point has no outside to fill )
  const bendSize = ( p: { o: TrailRun; end: "a" | "b" } | null, mine: [number, number] ) => {
    if ( !p || !v5 ) return p ? 1 : 0;
    const h    = p.end === "a" ? p.o.ha : p.o.hb, hl = Math.hypot( h[0], h[2] ) || 1;
    // the other run leaving the point, against carrying straight on
    const turn = Math.acos( Math.max( -1, Math.min( 1, ( h[0] * mine[0] + h[2] * mine[1] ) / hl ) ) );
    return Math.min( 1, ( turn * 180 ) / Math.PI / 60, ( 0.4 * len ) / Math.max( 1e-6, ends[0].halfW ) );
  };
  const sizeA = !openA ? bendSize( pa, [-dirs[0], -dirs[1]] ) : 1, sizeB = !openB ? bendSize( pb, [dirs[2], dirs[3]] ) : 1;
  const twoA  = !openA && !!pa && sizeA > 0.08, twoB = !openB && !!pb && sizeB > 0.08;
  const capA  = openA || twoA ? cap( 0, 1, [-dirs[0], -dirs[1]], ends[0], endSkirt[0], openA ? 0.5 : 0, openA ? 1 : sizeA ).reverse() : [];
  const capB  = openB || twoB ? cap( rows - 1, rows - 2, [dirs[2], dirs[3]], ends[1], endSkirt[1], openB ? 0.5 : 0, openB ? 1 : sizeB ) : [];
  const all   = capA.length + rows + capB.length;
  const P     = new Float32Array( all * cols * 4 ), L = new Float32Array( all * cols );
  let at      = 0;
  for ( const c of capA ) { P.set( c.p, at * cols * 4 ); L.set( c.l, at * cols ); at++; }
  P.set( pts.subarray( 0, rows * cols * 4 ), at * cols * 4 );
  L.set( lat.subarray( 0, rows * cols ), at * cols );
  at += rows;
  for ( const c of capB ) { P.set( c.p, at * cols * 4 ); L.set( c.l, at * cols ); at++; }
  const f = capA.length, l = capA.length + rows - 1;
  return { run: r.id, rows: all, cols, pts: P, lat: L, first: f, last: l, in0: openA ? 1 : f, in1: openB ? all - 2 : l };
}

/**
 * A round pad where three or more runs meet ( from v4 nets ): as wide as the widest run there, on the plane through
 * the point at its tilt ( the runs ease into it ), so the runs meet in a round junction, not with notches between.
**/
export function junctionPad( net: TrailNet, id: string ): Strip | null {
  const at = runsAt( net, id );
  if ( ( net.v ?? 1 ) < 4 || ( net.v ?? 1 ) >= 7 || at.length < 3 ) return null;
  const n     = nodeOf( net, id );
  // ( v5: no more than 0.4 of the shortest run there )
  const R     = Math.min( Math.max( ...at.map( ( r ) => ( r.a === id ? r.wa : r.wb ) ) ) / 2, ( net.v ?? 1 ) >= 5 ? 0.4 * Math.min( ...at.map( ( r ) => runLength( net, r ) ) ) : Infinity );
  const skirt = Math.max( ...at.map( ( r ) => r.edge ?? skirtOf( r.a === id ? r.wa : r.wb ) ) );
  const RINGS = 6, AROUND = 32, rows = RINGS + 2, cols = AROUND + 1;
  const pts   = new Float32Array( rows * cols * 4 ), lat = new Float32Array( rows * cols );
  const plane = ( x: number, z: number ) => n.p[1] + ( n.tilt ? n.tilt[0] * ( x - n.p[0] ) + n.tilt[1] * ( z - n.p[2] ) : 0 );
  for ( let k = 0; k < rows; k++ ) {
    const rad = k <= RINGS ? ( R * k ) / RINGS : R + skirt;
    for ( let q = 0; q < cols; q++ ) {
      const a           = ( q / AROUND ) * Math.PI * 2, x = n.p[0] + Math.sin( a ) * rad, z = n.p[2] + Math.cos( a ) * rad;
      const o           = ( k * cols + q ) * 4;
      pts[o]            = x;
      pts[o + 1]        = plane( x, z );
      pts[o + 2]        = z;
      pts[o + 3]        = k <= RINGS ? 1 : 0;
      lat[k * cols + q] = Math.min( 1, rad / Math.max( 1e-6, R ) );
    }
  }
  return { run: `pad:${id}`, rows, cols, pts, lat, first: 0, last: RINGS, in0: 0, in1: RINGS };
}

/**
 * Where a run's height handles are ( corners, side middles ), for drawing and picking.
**/
export function handlePoints( net: TrailNet, r: TrailRun, alone = false ): { which: "corner" | "mid"; index: number; p: V3 }[] {
  const st = runStrip( net, r, Math.max( 1, runLength( net, r ) / 40 ), alone );
  const at = ( row: number, col: number ): V3 => {
    const o = ( row * st.cols + col ) * 4;
    return [st.pts[o], st.pts[o + 1], st.pts[o + 2]];
  };
  // ( on the run's own end rows: not its skirt or rounded ends past them )
  const first = st.first, last = st.last;
  const mid   = Math.round( ( first + last ) / 2 ), L = 1, R = st.cols - 2;
  return [
    { which: "corner", index: 0, p: at( first, L ) },
    { which: "corner", index: 1, p: at( first, R ) },
    { which: "corner", index: 2, p: at( last,  L ) },
    { which: "corner", index: 3, p: at( last,  R ) },
    { which: "mid",    index: 0, p: at( mid,   L ) },
    { which: "mid",    index: 1, p: at( mid,   R ) },
  ];
}

/**
 * The strip's triangles ( x, y, z, cover per corner ), for rasterizing; `band` picks the rows between k and k + 1 to visit.
**/
export function stripTriangles( s: Strip, each: ( a: number, b: number, c: number ) => void, band?: ( k: number ) => boolean ) {
  for ( let k = 0; k < s.rows - 1; k++ ) {
    if ( band && !band( k ) ) continue;
    for ( let q = 0; q < s.cols - 1; q++ ) {
      const i00 = ( k * s.cols + q ) * 4, i10 = ( k * s.cols + q + 1 ) * 4, i01 = ( ( k + 1 ) * s.cols + q ) * 4, i11 = ( ( k + 1 ) * s.cols + q + 1 ) * 4;
      each( i00, i10, i11 );
      each( i00, i11, i01 );
    }
  }
}
