// Whole-map fills: all snow, rock on the steep, snowfall, powder ( everywhere or off the pistes ), the corduroy downhill or along
// the trails, markings, powder or grip cleared ( each one undo step ).

import { history } from "../../map/history";
import { type TerrainChunk, terrain } from "../../terrain/terrain";
import { currentNet } from "../../trails/ground";
import { place, rasterRuns } from "../../trails/ground/runs";
import { pointOnRun, type TrailNet } from "../../trails/trails";
import { MARKING_COLOURS } from "../settings";
import { spreadHue } from "./channels";
import { blendAngle, encodeAngle } from "./channels";
import { type PaintLayer, changed, ensureLayer, makeFour } from "./layers";

/**
 * Runs `f` on every chunk's layer as one undo step.
**/
async function fill( label: string, f: ( L: PaintLayer, c: TerrainChunk ) => void ) {
  const all    = await Promise.all( terrain.chunks.map( ( c ) => ensureLayer( c ) ) );
  const before = all.map( ( L ) => ( { L, rgba: L.rgba.slice(), flow: L.flow?.slice() ?? null, four: L.four } ) );
  terrain.chunks.forEach( ( c, k ) => f( all[k], c ) );
  const after = all.map( ( L ) => ( { L, rgba: L.rgba.slice(), flow: L.flow?.slice() ?? null, four: L.four } ) );
  all.forEach( ( L ) => changed( L ) );
  const put = ( list: typeof before ) =>
    list.forEach( ( b ) => {
      b.L.rgba.set( b.rgba );
      b.L.flow = b.flow ? b.flow.slice() : null;
      b.L.four = b.four;
      changed( b.L );
    } );
  const bytes = [...before, ...after].reduce( ( n, b ) => n + b.rgba.byteLength + ( b.flow?.byteLength ?? 0 ), 0 );
  history.push( { label, undo: () => put( before ), redo: () => put( after ), bytes } );
}

/**
 * A chunk's layer changed by `f`: how to undo and redo it ( for an edit that does something else too, as one step ).
**/
export async function layerEdit( c: TerrainChunk, f: ( L: PaintLayer ) => void ) {
  const L      = await ensureLayer( c );
  const before = { rgba: L.rgba.slice(), flow: L.flow?.slice() ?? null };
  f( L );
  const after = { rgba: L.rgba.slice(), flow: L.flow?.slice() ?? null };
  changed( L );
  const put = ( s: typeof before ) => {
    L.rgba.set( s.rgba );
    L.flow = s.flow ? s.flow.slice() : null;
    changed( L );
  };
  return { undo: () => put( before ), redo: () => put( after ), bytes: before.rgba.byteLength * 2 + ( before.flow?.byteLength ?? 0 ) * 2 };
}

/**
 * Ground height at a mask pixel, with the gradient over `d` metres.
**/
function slopeAt( c: TerrainChunk, x: number, z: number, d: number ): [number, number] {
  const h = ( ux: number, uz: number ) => {
    const [fx, fz] = c.toSample( Math.min( c.position[0] + c.size[0], Math.max( c.position[0], ux ) ), Math.min( c.position[2] + c.size[2], Math.max( c.position[2], uz ) ) );
    return c.sampleBilinear( fx, fz );
  };
  return [( h( x + d, z ) - h( x - d, z ) ) / ( 2 * d ), ( h( x, z + d ) - h( x, z - d ) ) / ( 2 * d )];
}

/**
 * Rock where the ground is steeper than `minDeg` ( fading in over `softDeg` ), snow elsewhere stays as painted.
**/
export function rockOnSteep( minDeg: number, softDeg = 6 ) {
  return fill( `Rock on slopes over ${minDeg}°`, ( L, c ) => {
    const m = L.m, px = c.size[0] / m, d = Math.max( px, c.spacing );
    for ( let j = 0; j < m; j++ )
      for ( let i = 0; i < m; i++ ) {
        const [gx, gz] = slopeAt( c, c.position[0] + ( i + 0.5 ) * px, c.position[2] + ( j + 0.5 ) * px, d );
        const deg      = ( Math.atan( Math.hypot( gx, gz ) ) * 180 ) / Math.PI;
        const t        = Math.min( 1, Math.max( 0, ( deg - minDeg ) / softDeg ) );
        const o        = ( j * m + i ) * 4;
        L.rgba[o]      = Math.min( L.rgba[o], Math.round( 255 * ( 1 - t * t * ( 3 - 2 * t ) ) ) );
      }
  } );
}

export interface Snowfall {
  // slopes steeper than `rockFrom` degrees start to show rock, steeper than `rockFull` are bare
  rockFrom:  number;
  rockFull:  number;
  // 0..1: hollows and gullies hold more snow, ridges and cliff brows shed it
  crevices:  number;
  // below `lineLow` metres up no snow lies, above `lineHigh` all of it ( both null: snow at every height )
  lineLow:   number | null;
  lineHigh:  number | null;
}

/**
 * Snow lying as it falls: rock on the steep ( more on ridges, less in hollows ) and below the snow line. It only ever
 * adds rock, so rock painted by hand stays.
**/
export function snowfall( o: Snowfall ) {
  const lo = Math.min( o.rockFrom, o.rockFull - 0.5 ), span = Math.max( 0.5, o.rockFull - lo );
  return fill( "Snowfall", ( L, c ) => {
    const m = L.m, px = c.size[0] / m, d = Math.max( px, c.spacing ), D = Math.max( 3, 2 * d );
    const h = ( x: number, z: number ) => {
      const [fx, fz] = c.toSample( Math.min( c.position[0] + c.size[0], Math.max( c.position[0], x ) ), Math.min( c.position[2] + c.size[2], Math.max( c.position[2], z ) ) );
      return c.sampleBilinear( fx, fz );
    };
    for ( let j = 0; j < m; j++ )
      for ( let i = 0; i < m; i++ ) {
        const x        = c.position[0] + ( i + 0.5 ) * px, z = c.position[2] + ( j + 0.5 ) * px;
        const [gx, gz] = slopeAt( c, x, z, d );
        const deg      = ( Math.atan( Math.hypot( gx, gz ) ) * 180 ) / Math.PI;
        let t          = Math.min( 1, Math.max( 0, ( deg - lo ) / span ) );
        t              = t * t * ( 3 - 2 * t );
        if ( o.crevices > 0 ) {
          // ( how much a hollow, +, or a ridge, −, the ground is over a few metres )
          const y    = h( x, z ), lap = ( h( x + D, z ) + h( x - D, z ) + h( x, z + D ) + h( x, z - D ) - 4 * y ) / D;
          const bend = Math.max( -1, Math.min( 1, lap * 2 ) );
          t          = Math.min( 1, Math.max( 0, t - o.crevices * bend * ( bend > 0 ? 1 : 0.6 ) ) );
        }
        if ( o.lineLow !== null || o.lineHigh !== null ) {
          const y  = c.position[1] + h( x, z ), a = o.lineLow ?? o.lineHigh!, b = Math.max( a + 0.1, o.lineHigh ?? a + 0.1 );
          const s  = Math.min( 1, Math.max( 0, ( y - a ) / ( b - a ) ) );
          t        = Math.max( t, 1 - s * s * ( 3 - 2 * s ) );
        }
        const o4  = ( j * m + i ) * 4;
        L.rgba[o4] = Math.min( L.rgba[o4], Math.round( 255 * ( 1 - t ) ) );
      }
  } );
}

/**
 * Powder `depth` deep ( 0..1 ) over the whole map, or with `offPiste` only off the pistes: the trails' runs ( the
 * powder fading out across their edges ) and whatever's marked ( an imported mountain's pistes are its markings ) keep
 * the powder they had.
**/
export function allPowder( depth: number, offPiste = false ) {
  const runs = offPiste ? place( currentNet() ) : [];
  const t    = Math.round( Math.min( 1, Math.max( 0, depth ) ) * 255 );
  return fill( offPiste ? "Powder off the pistes" : "All powder", ( L, c ) => {
    makeFour( L );
    const m = L.m, px = c.size[0] / m, P = L.rgba;
    const r = runs.length ? rasterRuns( runs, c.position[0] + px / 2, c.position[2] + px / 2, px, m, m ) : null;
    for ( let k = 0; k < m * m; k++ ) {
      const on = offPiste ? Math.min( 1, Math.max( r ? r.cover[k] : 0, P[k * 4 + 2] / 255 ) ) : 0;
      const w  = 1 - on * on * ( 3 - 2 * on );
      P[k * 4 + 3] = Math.round( t * w + P[k * 4 + 3] * ( 1 - w ) );
    }
  } );
}

/**
 * The corduroy straight down the slope everywhere ( the slope over a few metres, so it runs smoothly ); where the ground
 * is all but flat, left as it was.
**/
export function flowDownhill() {
  return fill( "Corduroy downhill", ( L, c ) => {
    const m = L.m, px = c.size[0] / m, d = Math.max( 2, px, c.spacing ), F = ( L.flow ??= new Uint8Array( m * m ) );
    for ( let j = 0; j < m; j++ )
      for ( let i = 0; i < m; i++ ) {
        const [gx, gz] = slopeAt( c, c.position[0] + ( i + 0.5 ) * px, c.position[2] + ( j + 0.5 ) * px, d );
        if ( Math.hypot( gx, gz ) > 0.02 ) F[j * m + i] = encodeAngle( -gx, -gz );
      }
  } );
}

/**
 * The corduroy along the trails: on each run the way it goes, down it ( a run climbing from its first point to its
 * last runs the other way ), fading into what's there across its edges.
**/
export function flowAlongTrails() {
  const net  = currentNet(), runs = place( net ), CELL = 16;
  // each run's centre line in short pieces ( a metre or so ), the way down, filed by where they are
  const segs: number[][] = [], cells = new Map<string, number[]>();
  for ( const r of net.runs ) {
    const a    = pointOnRun( net, r, 0 ), b = pointOnRun( net, r, 1 ), n = Math.max( 8, Math.ceil( Math.hypot( b[0] - a[0], b[2] - a[2] ) * 1.5 ) );
    const down = a[1] >= b[1];
    let prev   = a;
    for ( let k = 1; k <= n; k++ ) {
      const p = pointOnRun( net, r, k / n ), s = down ? [prev[0], prev[2], p[0], p[2]] : [p[0], p[2], prev[0], prev[2]];
      const q = segs.push( s ) - 1, cx = Math.floor( ( prev[0] + p[0] ) / 2 / CELL ), cz = Math.floor( ( prev[2] + p[2] ) / 2 / CELL );
      ( cells.get( `${cx},${cz}` ) ?? cells.set( `${cx},${cz}`, [] ).get( `${cx},${cz}` )! ).push( q );
      prev = p;
    }
  }
  return fill( "Corduroy along the trails", ( L, c ) => {
    if ( !runs.length ) return;
    const m = L.m, px = c.size[0] / m, x0 = c.position[0] + px / 2, z0 = c.position[2] + px / 2;
    const r = rasterRuns( runs, x0, z0, px, m, m );
    if ( !r ) return;
    const F = ( L.flow ??= new Uint8Array( m * m ) );
    for ( let j = 0; j < m; j++ )
      for ( let i = 0; i < m; i++ ) {
        const k = j * m + i, on = Math.min( 1, r.cover[k] );
        if ( on < 0.02 ) continue;
        const x  = x0 + i * px, z = z0 + j * px, cx = Math.floor( x / CELL ), cz = Math.floor( z / CELL );
        let best = Infinity, dir: number[] | null = null;
        for ( let dz = -2; dz <= 2; dz++ )
          for ( let dx = -2; dx <= 2; dx++ )
            for ( const q of cells.get( `${cx + dx},${cz + dz}` ) ?? [] ) {
              const [ax, az, bx, bz] = segs[q], ux = bx - ax, uz = bz - az, l2 = ux * ux + uz * uz || 1;
              const t                = Math.max( 0, Math.min( 1, ( ( x - ax ) * ux + ( z - az ) * uz ) / l2 ) ), d = Math.hypot( x - ax - ux * t, z - az - uz * t );
              if ( d < best ) { best = d; dir = [ux, uz]; }
            }
        if ( dir ) F[k] = blendAngle( F[k], encodeAngle( dir[0], dir[1] ), on * on * ( 3 - 2 * on ) );
      }
  } );
}

/**
 * The stripes of the runs given ( their `stripes` ) painted into the snow mask as markings ( one undo step ). Painted
 * once: moving the run afterwards leaves them where they were, as any painting is.
**/
export function paintRunStripes( net: TrailNet, runIds: string[] ) {
  // each stripe as a line of points ( world XZ ) with its half width, softness, hue and strength
  const lines: { pts: [number, number][]; half: number; soft: number; hue: number; opacity: number }[] = [];
  for ( const r of net.runs.filter( ( x ) => runIds.includes( x.id ) ) ) {
    const n   = 64, at = ( t: number ) => pointOnRun( net, r, Math.max( 0, Math.min( 1, t ) ) );
    const dir = ( t: number ): [number, number] => { const a = at( t - 0.005 ), b = at( t + 0.005 ), l = Math.hypot( b[0] - a[0], b[2] - a[2] ) || 1; return [( b[0] - a[0] ) / l, ( b[2] - a[2] ) / l]; };
    const hw  = ( t: number ) => ( r.wa + ( r.wb - r.wa ) * t ) / 2;
    for ( const s of r.stripes ?? [] ) {
      const pts: [number, number][] = [];
      if ( s.along )
        for ( let k = 0; k <= n; k++ ) {
          const t = k / n, p = at( t ), [dx, dz] = dir( t ), o = s.pos * hw( t );
          // ( right of the way it runs )
          pts.push( [p[0] + dz * o, p[2] - dx * o] );
        }
      else {
        const p = at( s.pos ), [dx, dz] = dir( s.pos ), h = hw( s.pos );
        pts.push( [p[0] - dz * h, p[2] + dx * h], [p[0] + dz * h, p[2] - dx * h] );
      }
      lines.push( { pts, half: s.width / 2, soft: Math.max( 0, Math.min( 1, s.softness ) ) * ( s.width / 2 ), hue: Math.round( ( MARKING_COLOURS[s.colour]?.hue ?? 0 ) * 255 ), opacity: Math.max( 0, Math.min( 1, s.opacity ) ) } );
    }
  }
  return fill( "Paint stripes", ( L, c ) => {
    const m = L.m, px = c.size[0] / m, x0 = c.position[0], z0 = c.position[2], P = L.rgba;
    let any = false;
    for ( const ln of lines ) {
      const reach = ln.half + px;
      const xs    = ln.pts.map( ( p ) => p[0] ), zs = ln.pts.map( ( p ) => p[1] );
      const i0    = Math.max( 0, Math.floor( ( Math.min( ...xs ) - reach - x0 ) / px ) ), i1 = Math.min( m - 1, Math.ceil( ( Math.max( ...xs ) + reach - x0 ) / px ) );
      const j0    = Math.max( 0, Math.floor( ( Math.min( ...zs ) - reach - z0 ) / px ) ), j1 = Math.min( m - 1, Math.ceil( ( Math.max( ...zs ) + reach - z0 ) / px ) );
      if ( i0 > i1 || j0 > j1 ) continue;
      if ( !any ) { makeFour( L ); any = true; }
      for ( let j = j0; j <= j1; j++ )
        for ( let i = i0; i <= i1; i++ ) {
          const x = x0 + ( i + 0.5 ) * px, z = z0 + ( j + 0.5 ) * px;
          let d   = Infinity;
          for ( let k = 0; k + 1 < ln.pts.length; k++ ) {
            const [ax, az] = ln.pts[k], [bx, bz] = ln.pts[k + 1], ux = bx - ax, uz = bz - az, l2 = ux * ux + uz * uz || 1;
            const t        = Math.max( 0, Math.min( 1, ( ( x - ax ) * ux + ( z - az ) * uz ) / l2 ) );
            d       = Math.min( d, Math.hypot( x - ax - ux * t, z - az - uz * t ) );
          }
          if ( d > ln.half ) continue;
          const w = ln.soft > 0 ? Math.min( 1, ( ln.half - d ) / ln.soft ) : 1, cov = Math.round( 255 * ln.opacity * w ), o = ( j * m + i ) * 4;
          if ( cov > P[o + 2] ) { P[o + 2] = cov; P[o + 1] = ln.hue; }
        }
      spreadHue( P, m, i0, j0, i1, j1 );
    }
  } );
}

export const allSnow = () => fill( "All snow", ( L ) => { for ( let k = 0; k < L.m * L.m; k++ ) L.rgba[k * 4] = 255; } );

export const clearMarkings = () => fill( "Clear markings", ( L ) => { if ( L.four ) for ( let k = 0; k < L.m * L.m; k++ ) L.rgba[k * 4 + 2] = 0; } );

export const clearPowder = () => fill( "Clear powder", ( L ) => { if ( L.four ) for ( let k = 0; k < L.m * L.m; k++ ) L.rgba[k * 4 + 3] = 0; } );

export const clearGrip = () => fill( "Clear grip", ( L ) => { if ( !L.four ) for ( let k = 0; k < L.m * L.m; k++ ) L.rgba[k * 4 + 3] = 0; } );
