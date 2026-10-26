// Elevation sources for importing real terrain, best first. Each has levels ( resolutions ) with a coverage test, and
// can fetch heights over an area as a sampler ( lon/lat -> metres above sea level, NaN where it has no data ).
//
// - USGS 3DEP ( The National Map ), US only: 1 m lidar where flown, else 1/9 arc-second ( ~3 m ), else 1/3 ( ~10 m ).
//   Coverage per level comes from the 3DEP elevation index; heights from the 3DEPElevation image service.
// - AWS Terrain Tiles ( Terrarium PNGs, from Mapzen's merge of SRTM, GMTED, national datasets... ): worldwide, ~30 m
//   ( better in a few countries, but which areas cannot be asked, so it counts as 30 m ).
// More national sources ( e.g. swissALTI3D 0.5 m, IGN France 1 m ) slot in as further entries.

import { mercator, indexPolygon, type LonLat } from "../proj";

export type Sampler = ( p: LonLat ) => number;

export interface DemLevel {
  source: DemSource;
  // index into `source.levels`
  index:  number;
  // metres between samples
  res:    number;
  label:  string;
}

export interface DemSource {
  id:          string;
  name:        string;
  attribution: string;
  // levels best first; `covered` gets every chunk's test points and says which chunks the level fully covers
  levels:      { res: number; label: string; covered: ( chunks: LonLat[][] ) => Promise<boolean[]> }[];
  // heights at `level` over the lon/lat box ( west, south, east, north )
  // `spacing`: metres between the samples wanted, when coarser than the level's own ( a big area at less detail )
  fetch( level: number, box: [number, number, number, number], onProgress?: ( f: number ) => void, signal?: AbortSignal, spacing?: number ): Promise<Sampler>;
}

async function getJson( url: string, signal?: AbortSignal ) {
  const r = await fetch( url, { signal } );
  if ( !r.ok ) throw new Error( `${new URL( url ).host} answered ${r.status}` );
  return r.json();
}

// ---------------------------------------------------------------- USGS 3DEP

const USGS_IMAGE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer";

/**
 * The elevation service's own tiles over a box ( west, south, east, north ): each one's ground resolution and its outline
 * ( lon/lat rings, simplified to ~20 m ). From the image service's catalogue — what the heights are actually fetched
 * from. ( USGS's separate coverage index now holds each resolution as one nationwide polygon, and since October 2026
 * answers every query about a place with "Failed to execute query". )
**/
async function usgsTiles( box: [number, number, number, number] ): Promise<{ res: number; rings: number[][][] }[]> {
  const out: { res: number; rings: number[][][] }[] = [];
  for ( let offset = 0; offset < 20000; ) {
    const q = new URLSearchParams( {
      geometry:           box.join( "," ),
      geometryType:       "esriGeometryEnvelope",
      inSR:               "4326",
      spatialRel:         "esriSpatialRelIntersects",
      outSR:              "4326",
      returnGeometry:     "true",
      maxAllowableOffset: "0.0002",
      geometryPrecision:  "6",
      // primary rasters only ( category 1; the rest are the service's own overviews )
      where:              "Category = 1",
      outFields:          "LowPS",
      resultOffset:       String( offset ),
      f:                  "json",
    } );
    const d = await getJson( `${USGS_IMAGE}/query?${q}` );
    if ( d.error ) throw new Error( `USGS elevation catalogue: ${d.error.message}` );
    const feats = ( d.features ?? [] ) as { attributes?: { LowPS?: number }; geometry?: { rings?: number[][][] } }[];
    for ( const f of feats ) if ( f.attributes?.LowPS && f.geometry?.rings ) out.push( { res: f.attributes.LowPS, rings: f.geometry.rings } );
    if ( !d.exceededTransferLimit || !feats.length ) break;
    offset += feats.length;
  }
  return out;
}

// The catalogue last fetched ( shared by the levels ), over a box a little bigger than asked for: moving or resizing
// the area within it needs no new request.
let usgsCache: { box: [number, number, number, number]; tiles: Promise<{ res: number; poly: ReturnType<typeof indexPolygon> }[]> } | null = null;

function usgsLevel( res: number, label: string ) {
  // the catalogue's tiles that count as this level ( pixel size ~1 m, ~3 m ( 1/9″ ), ~10 m ( 1/3″ ) )
  const ofLevel = ( r: number ) => ( res === 1 ? r <= 1.5 : res === 3 ? r > 1.5 && r <= 5 : r > 5 && r <= 15 );
  return {
    res,
    label,
    covered: async ( chunks: LonLat[][] ) => {
      const pts = chunks.flat();
      const w   = Math.min( ...pts.map( ( p ) => p.lon ) ), e = Math.max( ...pts.map( ( p ) => p.lon ) );
      const s   = Math.min( ...pts.map( ( p ) => p.lat ) ), n = Math.max( ...pts.map( ( p ) => p.lat ) );
      // ( nothing outside the US and its territories: no request )
      if ( e < -180 || w > -64 || n < 17 || s > 72 ) return chunks.map( () => false );
      if ( !usgsCache || w < usgsCache.box[0] || s < usgsCache.box[1] || e > usgsCache.box[2] || n > usgsCache.box[3] ) {
        const px    = Math.max( 0.02, ( e - w ) * 0.5 ), py = Math.max( 0.015, ( n - s ) * 0.5 );
        const box: [number, number, number, number] = [w - px, s - py, e + px, n + py];
        const tiles = usgsTiles( box ).then( ( t ) => t.map( ( { res: r, rings } ) => ( { res: r, poly: indexPolygon( rings ) } ) ) );
        tiles.catch( () => ( usgsCache = null ) );
        usgsCache = { box, tiles };
      }
      const polys = ( await usgsCache.tiles ).filter( ( t ) => ofLevel( t.res ) ).map( ( t ) => t.poly );
      // a chunk is covered when every test point is inside some tile ( tiles may overlap: test each )
      return chunks.map( ( cp ) => cp.every( ( p ) => polys.some( ( f ) => f.contains( p.lon, p.lat ) ) ) );
    },
  };
}

/**
 * A height grid over a lon/lat box at `res` ground metres, fetched as Web Mercator images in tiles of 1024 px ( a
 * service may allow more, but big ones time out, and smaller ones download in parallel ); each tile retried, then
 * split in four if the service keeps failing on it. `piece` gets a tile's Mercator box ( x0, y0, x1, y1: pixel-centred
 * edges ) and size, and gives back its little-endian float32 rows, north first. A sampler over it.
**/
export async function mercatorGrid(
  box:         [number, number, number, number],
  res:         number,
  piece:       ( b: [number, number, number, number], w: number, h: number, signal: AbortSignal ) => Promise<ArrayBuffer>,
  what:        string,
  onProgress?: ( f: number ) => void,
  signal?:     AbortSignal,
): Promise<Sampler> {
  const [x0, y0] = mercator.forward( { lon: box[0], lat: box[1] } );
  const [x1, y1] = mercator.forward( { lon: box[2], lat: box[3] } );
  const k        = 1 / Math.cos( ( ( ( box[1] + box[3] ) / 2 ) * Math.PI ) / 180 ); // Mercator metres per ground metre
  const px       = res * k;
  const W        = Math.ceil( ( x1 - x0 ) / px ) + 1, H = Math.ceil( ( y1 - y0 ) / px ) + 1;
  const T        = 1024;
  const grid     = new Float32Array( W * H ).fill( NaN );
  const jobs: [number, number, number, number][] = [];
  for ( let ty = 0; ty < H; ty += T ) for ( let tx = 0; tx < W; tx += T ) jobs.push( [tx, ty, Math.min( T, W - tx ), Math.min( T, H - ty )] );
  let done  = 0;
  const one = async ( tx: number, ty: number, w: number, h: number, depth = 0 ): Promise<void> => {
    // pixel ( i, j ) of the grid: x = x0 + i*px, y = y1 - j*px ( rows north to south ); ask for pixel-centred edges
    const bx0                   = x0 + ( tx - 0.5 ) * px, bx1 = bx0 + w * px;
    const by1                   = y1 - ( ty - 0.5 ) * px, by0 = by1 - h * px;
    let buf: ArrayBuffer | null = null, err = "";
    for ( let attempt = 0; attempt < 3 && !buf; attempt++ ) {
      if ( attempt ) await new Promise( ( r ) => setTimeout( r, 1500 * attempt ) );
      try {
        const limit = AbortSignal.timeout( 90000 ); // a stuck request would otherwise hang the import
        const b     = await piece( [bx0, by0, bx1, by1], w, h, signal ? AbortSignal.any( [signal, limit] ) : limit );
        if ( b.byteLength < w * h * 4 ) throw new Error( `${what} sent a short image` );
        buf = b;
      } catch ( e ) {
        if ( signal?.aborted ) throw e;
        err = String( e );
      }
    }
    if ( !buf ) {
      if ( depth >= 2 || ( w < 128 && h < 128 ) ) throw new Error( err );
      const hw = Math.ceil( w / 2 ), hh = Math.ceil( h / 2 );
      await one( tx, ty, hw, hh, depth + 1 );
      if ( w > hw ) await one( tx + hw, ty, w - hw, hh, depth + 1 );
      if ( h > hh ) await one( tx, ty + hh, hw, h - hh, depth + 1 );
      if ( w > hw && h > hh ) await one( tx + hw, ty + hh, w - hw, h - hh, depth + 1 );
      return;
    }
    const v = new Float32Array( buf, 0, w * h );
    for ( let j = 0; j < h; j++ )
      for ( let i = 0; i < w; i++ ) {
        const z                       = v[j * w + i];
        grid[( ty + j ) * W + tx + i] = z > -1e4 && z < 1e5 ? z : NaN;
      }
  };
  await pool( jobs, 4, async ( [tx, ty, w, h] ) => {
    await one( tx, ty, w, h );
    onProgress?.( ++done / jobs.length );
  } );
  return ( p ) => {
    const [x, y] = mercator.forward( p );
    return bilinear( grid, W, H, ( x - x0 ) / px, ( y1 - y ) / px );
  };
}

/**
 * One tile from an ArcGIS image service's exportImage ( USGS 3DEP, Norway's height data ): raw float32, little-endian
 * rows ( then a 1-bit validity mask, not needed: no data is a huge negative ). `viaStudio`: fetched by the studio, for
 * services that don't let a web page read them.
**/
export async function arcgisPiece( service: string, b: [number, number, number, number], w: number, h: number, signal: AbortSignal, viaStudio: boolean ) {
  const q = new URLSearchParams( {
    bbox:          b.join( "," ),
    bboxSR:        "3857",
    imageSR:       "3857",
    size:          `${w},${h}`,
    format:        "bsq",
    pixelType:     "F32",
    interpolation: "RSP_BilinearInterpolation",
    f:             "image",
  } );
  const url = `${service}/exportImage?${q}`;
  if ( viaStudio ) {
    const { httpFetch } = await import( "./remote" );
    const r             = await httpFetch( url );
    if ( signal.aborted ) throw new DOMException( "cancelled", "AbortError" );
    if ( r.status !== 200 ) throw new Error( `${new URL( service ).host} answered ${r.status}` );
    return r.body;
  }
  const r = await fetch( url, { signal } );
  if ( !r.ok ) throw new Error( `${new URL( service ).host} answered ${r.status}` );
  return r.arrayBuffer();
}

export const usgs3dep: DemSource = {
  id:          "usgs-3dep",
  name:        "USGS 3DEP",
  attribution: "Elevation: USGS 3D Elevation Program",
  levels:      [usgsLevel( 1, "1 m lidar" ), usgsLevel( 3, "3 m (1/9″)" ), usgsLevel( 10, "10 m (1/3″)" )],
  async fetch( level, box, onProgress, signal, spacing ) {
    // the service picks the best data for the pixel size asked for; ask in Web Mercator, which it stores
    return mercatorGrid( box, Math.max( this.levels[level].res, spacing ?? 0 ), ( b, w, h, stop ) => arcgisPiece( USGS_IMAGE, b, w, h, stop, false ), "USGS elevation", onProgress, signal );
  },
};

// ---------------------------------------------------------------- AWS Terrain Tiles ( global )

const TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const TILE      = 256, MERC_HALF = 20037508.342789244;

export const terrarium: DemSource = {
  id:          "aws-terrain",
  name:        "AWS Terrain Tiles",
  attribution: "Elevation: Mapzen / AWS Terrain Tiles (SRTM, GMTED, USGS, and others)",
  levels:      [{ res: 30, label: "30 m (global)", covered: async ( chunks ) => chunks.map( () => true ) }],
  async fetch( _level, box, onProgress, signal ) {
    // zoom where a tile pixel is ~10-20 m on the ground ( the data is ~30 m ), at most 14
    const lat = ( box[1] + box[3] ) / 2;
    let z     = 14;
    while ( z > 8 && ( ( 2 * MERC_HALF ) / ( TILE * 2 ** z ) ) * Math.cos( ( lat * Math.PI ) / 180 ) < 10 ) z--;
    const n                        = 2 ** z, tm = ( 2 * MERC_HALF ) / n; // tile size in Mercator metres
    const [mx0, my0]               = mercator.forward( { lon: box[0], lat: box[1] } );
    const [mx1, my1]               = mercator.forward( { lon: box[2], lat: box[3] } );
    const tx0                      = Math.floor( ( mx0 + MERC_HALF ) / tm ), tx1 = Math.floor( ( mx1 + MERC_HALF ) / tm );
    const ty0                      = Math.floor( ( MERC_HALF - my1 ) / tm ), ty1 = Math.floor( ( MERC_HALF - my0 ) / tm );
    const cols                     = tx1 - tx0 + 1, rows = ty1 - ty0 + 1;
    const W                        = cols * TILE, H = rows * TILE;
    const grid                     = new Float32Array( W * H ).fill( NaN );
    const jobs: [number, number][] = [];
    for ( let ty = ty0; ty <= ty1; ty++ ) for ( let tx = tx0; tx <= tx1; tx++ ) jobs.push( [tx, ty] );
    let done = 0;
    await pool( jobs, 6, async ( [tx, ty] ) => {
      const r = await fetch( `${TERRARIUM}/${z}/${( ( tx % n ) + n ) % n}/${ty}.png`, { signal } );
      if ( !r.ok ) throw new Error( `terrain tiles answered ${r.status}` );
      const px = await decodePng( await r.blob() );
      const ox = ( tx - tx0 ) * TILE, oy = ( ty - ty0 ) * TILE;
      for ( let j = 0; j < TILE; j++ )
        for ( let i = 0; i < TILE; i++ ) {
          const k                       = ( j * TILE + i ) * 4;
          grid[( oy + j ) * W + ox + i] = px[k] * 256 + px[k + 1] + px[k + 2] / 256 - 32768;
        }
      onProgress?.( ++done / jobs.length );
    } );
    // pixel centres: tile pixel i covers [i, i+1) -> sample at -0.5
    return ( p ) => {
      const [x, y] = mercator.forward( p );
      const fx     = ( ( x + MERC_HALF ) / tm - tx0 ) * TILE - 0.5, fy = ( ( MERC_HALF - y ) / tm - ty0 ) * TILE - 0.5;
      return bilinear( grid, W, H, fx, fy );
    };
  },
};

// ( all the sources, and choosing between them: demSources.ts )

// ---------------------------------------------------------------- helpers

export function bilinear( g: Float32Array, W: number, H: number, fx: number, fy: number ) {
  if ( fx < 0 || fy < 0 || fx > W - 1 || fy > H - 1 ) return NaN;
  const i = Math.min( W - 2, Math.floor( fx ) ), j = Math.min( H - 2, Math.floor( fy ) );
  const a = fx - i, b = fy - j;
  const p = j * W + i;
  return ( g[p] * ( 1 - a ) + g[p + 1] * a ) * ( 1 - b ) + ( g[p + W] * ( 1 - a ) + g[p + W + 1] * a ) * b;
}

/**
 * Runs `fn` over `items` with at most `n` at a time.
**/
export async function pool<T>( items: T[], n: number, fn: ( t: T ) => Promise<void> ) {
  let next = 0;
  await Promise.all(
    Array.from( { length: Math.min( n, items.length ) }, async () => {
      while ( next < items.length ) await fn( items[next++] );
    } ),
  );
}

/**
 * PNG -> RGBA bytes, exactly ( no colour management or premultiplying, which would change the encoded heights ).
**/
export async function decodePng( blob: Blob ): Promise<Uint8ClampedArray> {
  const bmp = await createImageBitmap( blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" } );
  const c   = new OffscreenCanvas( bmp.width, bmp.height );
  const ctx = c.getContext( "2d", { willReadFrequently: true } )!;
  ctx.drawImage( bmp, 0, 0 );
  return ctx.getImageData( 0, 0, bmp.width, bmp.height ).data;
}
