// The runs on a grid: each run's strip worked out once, and their surfaces drawn into a block of samples.

import { type Surface, evalSurfaces, surfaceOf } from "../surface";
import { type Strip, type TrailNet, junctionPad, runStrip, runsAt, stripTriangles } from "../trails";

export interface Placed {
  strip:    Strip;
  box:      [number, number, number, number];
  // each band between two rows' bounds ( x0, z0, x1, z1 ), so a grid visits only the bands that reach it
  bands:    Float32Array;
  // how much of the ground's detail the run keeps ( 0..1 )
  detail:   number;
  // ( v4 nets ) weighed smoothly, most along its middle, where runs overlap
  soft:     boolean;
  // ( v7 nets ) its surface, worked out from distances to it
  surface?: Surface;
}

const placedOf = new WeakMap<TrailNet, Placed[]>();

/**
 * The net's runs as strips ( worked out once per net: a net is never changed, only replaced ).
**/
export function place( net: TrailNet ): Placed[] {
  let p = placedOf.get( net );
  if ( !p ) placedOf.set( net, ( p = placeNow( net ) ) );
  return p;
}

// Strips by what they're made from ( a run, its points, the runs at them ): an edit leaves most runs as they were.
const stripCache = new Map<string, Placed>();

function placeNow( net: TrailNet ): Placed[] {
  const at  = ( id: string ) => [net.nodes.find( ( n ) => n.id === id ), runsAt( net, id )];
  const out = net.runs.map( ( r ) => {
    const key = JSON.stringify( [r, at( r.a ), at( r.b ), net.v] );
    let p     = stripCache.get( key );
    if ( !p ) stripCache.set( key, ( p = placeRun( net, r ) ) );
    return p;
  } );
  // round pads where three or more runs meet ( v4 to v6 )
  if ( ( net.v ?? 1 ) >= 4 && ( net.v ?? 1 ) < 7 )
    for ( const n of net.nodes ) {
      const runs = runsAt( net, n.id );
      if ( runs.length < 3 ) continue;
      const key = JSON.stringify( ["pad", at( n.id ), net.v] );
      let p     = stripCache.get( key );
      if ( !p ) {
        const strip = junctionPad( net, n.id )!;
        p           = placeStrip( strip, runs.reduce( ( s, r ) => s + ( r.detail ?? 0 ), 0 ) / runs.length, true );
        stripCache.set( key, p );
      }
      out.push( p );
    }
  // ( kept to a few nets' worth )
  if ( stripCache.size > 4 * net.runs.length + 64 ) {
    const keep = new Set( out );
    for ( const [k, v] of stripCache ) if ( !keep.has( v ) ) stripCache.delete( k );
  }
  return out;
}

function placeRun( net: TrailNet, r: TrailNet["runs"][number] ): Placed {
  const strip = runStrip( net, r, 1 );
  const p     = placeStrip( strip, r.detail ?? 0, ( net.v ?? 1 ) >= 4 );
  if ( ( net.v ?? 1 ) < 7 ) return p;
  const surface = surfaceOf( strip, p.detail );
  return { ...p, surface, box: surface.box };
}

function placeStrip( strip: Strip, detail: number, soft: boolean ): Placed {
  {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for ( let o = 0; o < strip.pts.length; o += 4 ) { x0 = Math.min( x0, strip.pts[o] ); x1 = Math.max( x1, strip.pts[o] ); z0 = Math.min( z0, strip.pts[o + 2] ); z1 = Math.max( z1, strip.pts[o + 2] ); }
    const bands = new Float32Array( ( strip.rows - 1 ) * 4 ), P = strip.pts, C = strip.cols;
    for ( let k = 0; k < strip.rows - 1; k++ ) {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for ( let q = k * C * 4; q < ( k + 2 ) * C * 4; q += 4 ) { a = Math.min( a, P[q] ); c = Math.max( c, P[q] ); b = Math.min( b, P[q + 2] ); d = Math.max( d, P[q + 2] ); }
      bands.set( [a, b, c, d], k * 4 );
    }
    return { strip, box: [x0, z0, x1, z1], bands, detail: Math.min( 1, Math.max( 0, detail ) ), soft };
  }
}

export type Raster = ReturnType<typeof rasterRuns>;

/**
 * The runs' heights and how much they cover ( 0..1 ) on a grid ( corner x0, z0; spacing sp; w × h samples ). Where runs
 * overlap, their heights are averaged by how much each covers. `onlyOn` ( v7 nets ): only where they fully cover is
 * wanted.
**/
export function rasterRuns( placed: Placed[], x0: number, z0: number, sp: number, w: number, h: number, onlyOn = false ): { y: Float32Array; cover: Float32Array; k: Float32Array | null } | null {
  const X1 = x0 + ( w - 1 ) * sp, Z1 = z0 + ( h - 1 ) * sp;
  const on = placed.filter( ( { box } ) => !( box[2] < x0 || box[0] > X1 || box[3] < z0 || box[1] > Z1 ) );
  if ( !on.length ) return null;
  // ( v7: from distances to the runs )
  if ( on[0].surface ) return evalSurfaces( on.map( ( p ) => p.surface! ), x0, z0, sp, w, h, onlyOn );
  const sumY = new Float32Array( w * h ), sumW = new Float32Array( w * h ), cover = new Float32Array( w * h );
  // ( the detail kept, averaged as the heights are; none at all: no array )
  const sumK = on.some( ( p ) => p.detail > 0 ) ? new Float32Array( w * h ) : null;
  // ( soft strips: each sample once per strip, though it lies on an edge two of its triangles share; counted twice,
  // a line of samples along a pad's spoke stood out )
  const seen = on.some( ( p ) => p.soft ) ? new Int32Array( w * h ) : null;
  let stamp  = 0;
  for ( const { strip, bands, detail, soft } of on ) {
    const P = strip.pts, LAT = strip.lat;
    stamp++;
    stripTriangles( strip, ( ia, ib, ic ) => {
      const ax   = ( P[ia] - x0 ) / sp, az = ( P[ia + 2] - z0 ) / sp, bx = ( P[ib] - x0 ) / sp, bz = ( P[ib + 2] - z0 ) / sp, cx = ( P[ic] - x0 ) / sp, cz = ( P[ic + 2] - z0 ) / sp;
      const area = ( bx - ax ) * ( cz - az ) - ( cx - ax ) * ( bz - az );
      if ( Math.abs( area ) < 1e-12 ) return;
      const i0 = Math.max( 0, Math.ceil( Math.min( ax, bx, cx ) - 1e-9 ) ), i1 = Math.min( w - 1, Math.floor( Math.max( ax, bx, cx ) + 1e-9 ) );
      const j0 = Math.max( 0, Math.ceil( Math.min( az, bz, cz ) - 1e-9 ) ), j1 = Math.min( h - 1, Math.floor( Math.max( az, bz, cz ) + 1e-9 ) );
      for ( let j = j0; j <= j1; j++ )
        for ( let i = i0; i <= i1; i++ ) {
          const u = ( ( bx - i ) * ( cz - j ) - ( cx - i ) * ( bz - j ) ) / area;
          const v = ( ( cx - i ) * ( az - j ) - ( ax - i ) * ( cz - j ) ) / area;
          const t = 1 - u - v;
          if ( u < -1e-7 || v < -1e-7 || t < -1e-7 ) continue;
          const k = j * w + i;
          if ( soft && seen ) {
            if ( seen[k] === stamp ) continue;
            seen[k] = stamp;
          }
          const y  = u * P[ia + 1] + v * P[ib + 1] + t * P[ic + 1];
          const cv = u * P[ia + 3] + v * P[ib + 3] + t * P[ic + 3];
          // ( a sample on a triangle edge is visited twice: the same answer either way )
          let wt: number;
          if ( soft ) {
            // most along its middle, falling smoothly to its edges and over its skirt: overlapping runs grade into
            // each other instead of a run's edge showing as a line across the other
            const s = u * LAT[ia / 4] + v * LAT[ib / 4] + t * LAT[ic / 4], c = cv < 0 ? 0 : cv > 1 ? 1 : cv;
            wt      = c * c * ( 3 - 2 * c ) * ( 1 - 0.8 * s * s ) + 1e-4;
          } else wt = Math.max( 1e-4, cv * cv );
          sumY[k] += y * wt;
          sumW[k] += wt;
          if ( sumK ) sumK[k] += detail * wt;
          if ( cv > cover[k] ) cover[k] = cv;
        }
    }, ( k ) => !( bands[k * 4 + 2] < x0 || bands[k * 4] > X1 || bands[k * 4 + 3] < z0 || bands[k * 4 + 1] > Z1 ) );
  }
  const y = sumY;
  for ( let k = 0; k < w * h; k++ ) {
    y[k] = sumW[k] > 0 ? sumY[k] / sumW[k] : 0;
    if ( sumK ) sumK[k] = sumW[k] > 0 ? sumK[k] / sumW[k] : 0;
  }
  return { y, cover, k: sumK };
}

export const smooth = ( u: number ) => ( u <= 0 ? 0 : u >= 1 ? 1 : u * u * ( 3 - 2 * u ) );
