// Reading elevation from the web through the studio itself ( src-tauri http_fetch ): most national and global elevation
// servers don't let a web page read them ( no CORS ). Cloud-optimised GeoTIFFs are read a piece at a time ( geotiff.js,
// asking for just the byte ranges it needs ), and points are moved into each source's own map projection ( proj4 ).

import { fromCustomClient, type BaseClient, type GeoTIFF, type GeoTIFFImage } from "geotiff";
import proj4 from "proj4";
import { ipc } from "../../core/ipc";
import type { LonLat } from "../proj";

/**
 * A web address fetched by the studio: status, headers ( lower case ), body.
**/
export async function httpFetch( url: string, range?: string ) {
  const raw     = await ipc.httpFetch( url, range );
  const v       = new DataView( raw );
  const status  = v.getUint16( 0, true ), headLen = v.getUint32( 2, true );
  const headers = JSON.parse( new TextDecoder().decode( new Uint8Array( raw, 6, headLen ) ) ) as Record<string, string>;
  return { status, headers, body: raw.slice( 6 + headLen ) };
}

/**
 * What geotiff.js asks of a web client ( its own type definitions say less than it uses ).
**/
function studioClient( url: string ) {
  return {
    url,
    async request( { headers }: { headers?: HeadersInit; signal?: AbortSignal } = {} ) {
      const range = headers ? ( new Headers( headers ).get( "Range" ) ?? undefined ) : undefined;
      const r     = await httpFetch( url, range );
      return {
        ok:        r.status >= 200 && r.status < 300,
        status:    r.status,
        getHeader: ( name: string ) => r.headers[name.toLowerCase()],
        getData:   async () => r.body,
      };
    },
  } as unknown as BaseClient;
}

const opened = new Map<string, Promise<GeoTIFF>>();

/**
 * A cloud-optimised GeoTIFF on the web ( opened once per session ).
**/
export function openCog( url: string ): Promise<GeoTIFF> {
  let t = opened.get( url );
  if ( !t ) {
    t = fromCustomClient( studioClient( url ), { allowFullFile: false, blockSize: 1 << 16 } );
    t.catch( () => opened.delete( url ) );
    opened.set( url, t );
  }
  return t;
}

// A piece of a raster read from a GeoTIFF: heights ( NaN where it has none ) and where its pixels are.
export interface Window {
  data: Float32Array;
  W:    number;
  H:    number;
  // native coordinates of pixel ( 0, 0 )'s centre, and the step between pixels ( y usually negative )
  x0:   number;
  y0:   number;
  dx:   number;
  dy:   number;
}

/**
 * The part of `tiff` over `box` ( its own coordinates: xmin, ymin, xmax, ymax ), from its coarsest picture still at
 * least as fine as `spacing` ( cloud GeoTIFFs keep smaller copies of themselves ), or null when the box misses it.
**/
export async function readWindow( tiff: GeoTIFF, box: [number, number, number, number], spacing: number ): Promise<Window | null> {
  const base            = await tiff.getImage( 0 );
  const [ox, oy]        = base.getOrigin();
  const [rx, ry]        = base.getResolution();
  const count           = await tiff.getImageCount();
  let img: GeoTIFFImage = base, scale = 1;
  for ( let k = 1; k < count; k++ ) {
    const o = await tiff.getImage( k );
    // ( masks are images too: only the elevation's own smaller copies, one band of the same kind )
    if ( o.getSamplesPerPixel() !== base.getSamplesPerPixel() || o.getBitsPerSample() !== base.getBitsPerSample() ) continue;
    const s = base.getWidth() / o.getWidth();
    if ( s > scale && Math.abs( rx ) * s <= spacing * 1.01 ) { img = o; scale = s; }
  }
  const px = rx * scale, py = ry * scale;
  // pixels whose area touches the box, one to spare all round ( for bilinear at the edges )
  const c0 = Math.max( 0, Math.floor( ( box[0] - ox ) / px ) - 1 ), c1 = Math.min( img.getWidth() - 1,  Math.ceil( ( box[2] - ox ) / px ) + 1 );
  const r0 = Math.max( 0, Math.floor( ( box[3] - oy ) / py ) - 1 ), r1 = Math.min( img.getHeight() - 1, Math.ceil( ( box[1] - oy ) / py ) + 1 );
  if ( c1 < c0 || r1 < r0 ) return null;
  const nodata = base.getGDALNoData();
  const [band] = ( await img.readRasters( { window: [c0, r0, c1 + 1, r1 + 1], fillValue: NaN } ) ) as unknown as ArrayLike<number>[];
  const data   = Float32Array.from( band, ( v ) => ( v === nodata || !( v > -1e4 && v < 1e5 ) ? NaN : v ) );
  return { data, W: c1 - c0 + 1, H: r1 - r0 + 1, x0: ox + ( c0 + 0.5 ) * px, y0: oy + ( r0 + 0.5 ) * py, dx: px, dy: py };
}

/**
 * Height at native ( x, y ) in a window: bilinear, NaN outside it or where it has no data.
**/
export function windowAt( w: Window, x: number, y: number ) {
  const fx = ( x - w.x0 ) / w.dx, fy = ( y - w.y0 ) / w.dy;
  if ( !( fx >= 0 && fy >= 0 && fx <= w.W - 1 && fy <= w.H - 1 ) ) return NaN;
  if ( w.W < 2 || w.H < 2 ) return w.data[Math.round( fy ) * w.W + Math.round( fx )];
  const i = Math.min( w.W - 2, Math.floor( fx ) ), j = Math.min( w.H - 2, Math.floor( fy ) );
  const a = fx - i, b = fy - j, p = j * w.W + i;
  return ( w.data[p] * ( 1 - a ) + w.data[p + 1] * a ) * ( 1 - b ) + ( w.data[p + w.W] * ( 1 - a ) + w.data[p + w.W + 1] * a ) * b;
}

/**
 * Height at native ( x, y ) over several windows ( a file each ): the first that has it, else, between two files, bilinear
 * over the pixels of whichever has each. Two tiles side by side leave a pixel's width between their last pixel centres
 * that neither covers on its own ( a 2 m strip along every swissALTI3D tile's edge ): filled from coarser data, it stood
 * as a trench or a wall along the tile lines. Files on another pixel grid don't count for that; NaN where no file has
 * any of the four pixels.
**/
export function windowsAt( windows: Window[], x: number, y: number ) {
  for ( const w of windows ) {
    const v = windowAt( w, x, y );
    if ( !Number.isNaN( v ) ) return v;
  }
  const g = windows[0];
  if ( !g ) return NaN;
  const fx = ( x - g.x0 ) / g.dx, fy = ( y - g.y0 ) / g.dy;
  const i  = Math.floor( fx ), j = Math.floor( fy ), a = fx - i, b = fy - j;
  // pixel ( gi, gj ) of the first window's grid, from any window on the same grid that has it
  const pixel = ( gi: number, gj: number ) => {
    const px = g.x0 + gi * g.dx, py = g.y0 + gj * g.dy;
    for ( const w of windows ) {
      if ( Math.abs( w.dx - g.dx ) > 1e-6 * Math.abs( g.dx ) || Math.abs( w.dy - g.dy ) > 1e-6 * Math.abs( g.dy ) ) continue;
      const ci = ( px - w.x0 ) / w.dx, cj = ( py - w.y0 ) / w.dy, ri = Math.round( ci ), rj = Math.round( cj );
      if ( Math.abs( ci - ri ) > 1e-3 || Math.abs( cj - rj ) > 1e-3 || ri < 0 || rj < 0 || ri >= w.W || rj >= w.H ) continue;
      const v = w.data[rj * w.W + ri];
      if ( !Number.isNaN( v ) ) return v;
    }
    return NaN;
  };
  let sum = 0, weight = 0;
  for ( const [di, dj, k] of [[0, 0, ( 1 - a ) * ( 1 - b )], [1, 0, a * ( 1 - b )], [0, 1, ( 1 - a ) * b], [1, 1, a * b]] ) {
    const v = pixel( i + di, j + dj );
    if ( Number.isNaN( v ) || k === 0 ) continue;
    sum    += v * k;
    weight += k;
  }
  return weight > 0 ? sum / weight : NaN;
}

const DEFS: Record<string, string> = {
  "EPSG:3979": "+proj=lcc +lat_0=49 +lon_0=-95 +lat_1=49 +lat_2=77 +x_0=0 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
  "EPSG:2056": "+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k_0=1 +x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs",
  "EPSG:3035": "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",
};
for ( const [k, v] of Object.entries( DEFS ) ) proj4.defs( k, v );

/**
 * lon/lat -> a projection's coordinates, quickly over a box ( west, south, east, north ): exact at a 65 x 65 lattice,
 * bilinear between ( an import asks for ~100 million points; over a few tens of km the projections are smooth enough
 * that this is off by well under a millimetre ).
**/
export function fastProjection( crs: string, box: [number, number, number, number] ) {
  const N    = 64;
  const fwd  = proj4( "EPSG:4326", crs );
  const gx   = new Float64Array( ( N + 1 ) * ( N + 1 ) ), gy = new Float64Array( ( N + 1 ) * ( N + 1 ) );
  const dlon = ( box[2] - box[0] ) / N || 1e-9, dlat = ( box[3] - box[1] ) / N || 1e-9;
  for ( let j = 0; j <= N; j++ )
    for ( let i = 0; i <= N; i++ ) {
      const [x, y]          = fwd.forward( [box[0] + i * dlon, box[1] + j * dlat] );
      gx[j * ( N + 1 ) + i] = x;
      gy[j * ( N + 1 ) + i] = y;
    }
  return ( p: LonLat ): [number, number] => {
    const fi = ( p.lon - box[0] ) / dlon, fj = ( p.lat - box[1] ) / dlat;
    if ( !( fi >= 0 && fj >= 0 && fi <= N && fj <= N ) ) return fwd.forward( [p.lon, p.lat] ) as [number, number];
    const i    = Math.min( N - 1, Math.floor( fi ) ), j = Math.min( N - 1, Math.floor( fj ) ), a = fi - i, b = fj - j;
    const k    = j * ( N + 1 ) + i;
    const lerp = ( g: Float64Array ) => ( g[k] * ( 1 - a ) + g[k + 1] * a ) * ( 1 - b ) + ( g[k + N + 1] * ( 1 - a ) + g[k + N + 2] * a ) * b;
    return [lerp( gx ), lerp( gy )];
  };
}

/**
 * A box ( west, south, east, north ) in a projection's coordinates: the bounds of its edges there.
**/
export function projectBox( crs: string, box: [number, number, number, number] ): [number, number, number, number] {
  const fwd          = proj4( "EPSG:4326", crs );
  const xs: number[] = [], ys: number[] = [];
  for ( let k = 0; k <= 8; k++ ) {
    const lon = box[0] + ( ( box[2] - box[0] ) * k ) / 8, lat = box[1] + ( ( box[3] - box[1] ) * k ) / 8;
    for ( const [a, b] of [[lon, box[1]], [lon, box[3]], [box[0], lat], [box[2], lat]] ) {
      const [x, y] = fwd.forward( [a, b] );
      xs.push( x );
      ys.push( y );
    }
  }
  return [Math.min( ...xs ), Math.min( ...ys ), Math.max( ...xs ), Math.max( ...ys )];
}
