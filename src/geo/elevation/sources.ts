// Elevation for the whole world: the best open data each place has, best first, ending with Copernicus GLO-30 ( the
// best open global model ) and the old terrain tiles as a last resort. Each level says which chunks it covers ( quick
// "not here" for places outside its country, then a coarse look at the data itself ), and fetches heights over an area
// as a sampler. All read straight from their publishers ( see `attribution` ), most through the studio ( src-tauri
// http_fetch ): their servers don't let a web page read them.

import { arcgisPiece, decodePng, mercatorGrid, pool, terrarium, usgs3dep, type DemLevel, type DemSource, type Sampler } from "./dem";
import { mercator, type LonLat } from "../proj";
import { fastProjection, httpFetch, openCog, projectBox, readWindow, windowAt, type Window } from "./remote";

type Box = [number, number, number, number];

// How fine the coverage check looks ( metres ): enough to see holes in the data, cheap to fetch.
const COARSE = 60;

/**
 * The box round some points, with `pad` degrees to spare.
**/
function boundsOf( pts: LonLat[], pad = 0.002 ): Box {
  return [
    Math.min( ...pts.map( ( p ) => p.lon ) ) - pad, Math.min( ...pts.map( ( p ) => p.lat ) ) - pad,
    Math.max( ...pts.map( ( p ) => p.lon ) ) + pad, Math.max( ...pts.map( ( p ) => p.lat ) ) + pad,
  ];
}
const overlaps = ( a: Box, b: Box ) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/**
 * A level's coverage from the data itself: the chunks whose test points all have heights in a coarse fetch. Nothing
 * fetched for places outside `region` ( west, south, east, north ).
**/
function coarseCoverage( region: Box, fetchCoarse: ( box: Box ) => Promise<Sampler> ) {
  return async ( chunks: LonLat[][] ) => {
    const box = boundsOf( chunks.flat() );
    if ( !overlaps( box, region ) ) return chunks.map( () => false );
    const s = await fetchCoarse( box );
    return chunks.map( ( pts ) => pts.every( ( p ) => !Number.isNaN( s( p ) ) ) );
  };
}

/**
 * The first height any of `samplers` has at a point.
**/
const firstOf = ( samplers: Sampler[] ): Sampler => ( p ) => {
  for ( const s of samplers ) {
    const v = s( p );
    if ( !Number.isNaN( v ) ) return v;
  }
  return NaN;
};

/**
 * Heights from cloud GeoTIFFs in projection `crs` over a lon/lat box, at `spacing` metres ( or the files' own ).
**/
async function cogSampler( urls: string[], crs: string, box: Box, spacing: number, onProgress?: ( f: number ) => void ): Promise<Sampler> {
  const native            = projectBox( crs, box );
  const windows: Window[] = [];
  let done                = 0;
  await pool( urls, 4, async ( url ) => {
    const w = await readWindow( await openCog( url ), native, spacing ).catch( ( e ) => {
      console.warn( `elevation ${url}:`, e );
      return null;
    } );
    if ( w ) windows.push( w );
    onProgress?.( ++done / urls.length );
  } );
  const to = fastProjection( crs, box );
  return ( p ) => {
    const [x, y] = to( p );
    for ( const w of windows ) {
      const v = windowAt( w, x, y );
      if ( !Number.isNaN( v ) ) return v;
    }
    return NaN;
  };
}

// ---------------------------------------------------------------- Copernicus GLO-30 ( the whole world, ~30 m )

/**
 * One 1-degree tile's address, by its south-west corner.
**/
function copernicusTile( lon: number, lat: number ) {
  const ns   = lat >= 0 ? "N" : "S", ew = lon >= 0 ? "E" : "W";
  const name = `Copernicus_DSM_COG_10_${ns}${String( Math.abs( lat ) ).padStart( 2, "0" )}_00_${ew}${String( Math.abs( lon ) ).padStart( 3, "0" )}_00_DEM`;
  return `https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`;
}

export const copernicus: DemSource = {
  id:          "copernicus-glo30",
  name:        "Copernicus GLO-30",
  attribution: "Elevation: Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA",
  // ( open sea has no tiles: those holes are filled from the terrain tiles )
  levels:      [{ res: 30, label: "30 m (worldwide)", covered: async ( chunks ) => chunks.map( () => true ) }],
  async fetch( _level, box, onProgress, _signal, spacing ) {
    const urls: string[] = [];
    for ( let lat = Math.floor( box[1] ); lat <= Math.floor( box[3] ); lat++ ) for ( let lon = Math.floor( box[0] ); lon <= Math.floor( box[2] ); lon++ ) urls.push( copernicusTile( lon, lat ) );
    // tiles are in plain lon/lat degrees: the spacing asked for, in degrees of latitude
    return cogSampler( urls, "EPSG:4326", box, ( spacing ?? 0 ) / 111320, onProgress );
  },
};

// ---------------------------------------------------------------- Canada: HRDEM mosaic ( 1 m / 2 m, where flown )

const CANADA: Box = [-141.1, 41.6, -52.5, 83.2];
const STAC_CA     = "https://datacube.services.geo.ca/stac/api/search";

async function canadaFiles( collection: string, box: Box ): Promise<string[]> {
  const r = await httpFetch( `${STAC_CA}?collections=${collection}&bbox=${box.join( "," )}&limit=50` );
  if ( r.status !== 200 ) throw new Error( `NRCan's catalogue answered ${r.status}` );
  const d = JSON.parse( new TextDecoder().decode( r.body ) ) as { features?: { assets?: { dtm?: { href?: string } } }[] };
  return ( d.features ?? [] ).map( ( f ) => f.assets?.dtm?.href ).filter( ( u ): u is string => !!u );
}

function canadaLevel( collection: string, res: number, label: string ) {
  const fetchAt = async ( box: Box, spacing: number, onProgress?: ( f: number ) => void ) =>
    box[0] < CANADA[2] && overlaps( box, CANADA ) ? cogSampler( await canadaFiles( collection, box ), "EPSG:3979", box, spacing, onProgress ) : () => NaN;
  return { res, label, covered: coarseCoverage( CANADA, ( box ) => fetchAt( box, COARSE ) ), fetchAt };
}

const canadaLevels             = [canadaLevel( "hrdem-mosaic-1m", 1, "1 m lidar" ), canadaLevel( "hrdem-mosaic-2m", 2, "2 m" )];
export const canada: DemSource = {
  id:          "nrcan-hrdem",
  name:        "NRCan HRDEM",
  attribution: "Elevation: High Resolution Digital Elevation Model, Natural Resources Canada (Open Government Licence – Canada)",
  levels:      canadaLevels,
  fetch:       ( level, box, onProgress, _signal, spacing ) => canadaLevels[level].fetchAt( box, Math.max( canadaLevels[level].res, spacing ?? 0 ), onProgress ),
};

// ---------------------------------------------------------------- Switzerland: swissALTI3D ( 2 m )

const SWISS: Box = [5.9, 45.8, 10.5, 47.85];
const STAC_CH    = "https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items";

/**
 * The 2 m tiles ( 1 km each, Swiss grid ) over a box: their addresses, by the tile's "east-north" km name.
**/
async function swissTiles( box: Box ): Promise<Map<string, string>> {
  const out               = new Map<string, { year: number; url: string }>();
  let next: string | null = `${STAC_CH}?bbox=${box.join( "," )}&limit=100`;
  for ( let page = 0; next && page < 20; page++ ) {
    const r = await httpFetch( next );
    if ( r.status !== 200 ) throw new Error( `swisstopo's catalogue answered ${r.status}` );
    const d = JSON.parse( new TextDecoder().decode( r.body ) ) as {
      features?: { id: string; assets: Record<string, { href: string }> }[];
      links?:    { rel: string; href: string }[];
    };
    for ( const f of d.features ?? [] ) {
      const m   = /swissalti3d_(\d{4})_(\d+-\d+)/.exec( f.id );
      const url = Object.values( f.assets ).find( ( a ) => /_2_2056_\d+\.tif$/.test( a.href ) )?.href;
      if ( !m || !url ) continue;
      const year = +m[1], key = m[2];
      if ( !out.has( key ) || out.get( key )!.year < year ) out.set( key, { year, url } );
    }
    next = d.links?.find( ( l ) => l.rel === "next" )?.href ?? null;
  }
  return new Map( [...out].map( ( [k, v] ) => [k, v.url] ) );
}

export const swiss: DemSource = {
  id:          "swisstopo-swissalti3d",
  name:        "swissALTI3D",
  attribution: "Elevation: swissALTI3D © swisstopo",
  levels: [
    {
      res:   2,
      label: "2 m lidar",
      // covered where there's a tile under every test point ( the tiles are named by their km in the Swiss grid )
      covered: async ( chunks ) => {
        const box = boundsOf( chunks.flat() );
        if ( !overlaps( box, SWISS ) ) return chunks.map( () => false );
        const tiles = await swissTiles( box );
        const to    = fastProjection( "EPSG:2056", box );
        return chunks.map( ( pts ) =>
          pts.every( ( p ) => {
            const [x, y] = to( p );
            return tiles.has( `${Math.floor( x / 1000 )}-${Math.floor( y / 1000 )}` );
          } ),
        );
      },
    },
  ],
  async fetch( _level, box, onProgress, _signal, spacing ) {
    const tiles = await swissTiles( box );
    return cogSampler( [...tiles.values()], "EPSG:2056", box, Math.max( 2, spacing ?? 0 ), onProgress );
  },
};

// ---------------------------------------------------------------- Austria: BEV ALS DTM ( 1 m )

const AUSTRIA: Box = [9.4, 46.3, 17.2, 49.1];
// The 55 tiles ( 50 km, ETRS89-LAEA ), by their south-west corner's northing and easting, and the edition's folder.
// New editions move to new folders: a tile that's gone is looked up in BEV's catalogue instead.
const AUSTRIA_TILES =
  "2550000,4650000,20250915 2600000,4300000,20240915 2600000,4350000,20250915 2600000,4400000,20250915 2600000,4450000,20250915 2600000,4500000,20240915 2600000,4550000,20250915 2600000,4600000,20250915 2600000,4650000,20240915 2600000,4700000,20240915 2600000,4750000,20250915 2650000,4250000,20240915 2650000,4300000,20240915 2650000,4350000,20240915 2650000,4400000,20250915 2650000,4450000,20250915 2650000,4500000,20240915 2650000,4550000,20240915 2650000,4600000,20220915 2650000,4650000,20250915 2650000,4700000,20250915 2650000,4750000,20240915 2650000,4800000,20240915 2700000,4250000,20250915 2700000,4300000,20240915 2700000,4350000,20220915 2700000,4400000,20240915 2700000,4450000,20250915 2700000,4500000,20240915 2700000,4550000,20230915 2700000,4600000,20250915 2700000,4650000,20240915 2700000,4700000,20250915 2700000,4750000,20240915 2700000,4800000,20240915 2750000,4500000,20250915 2750000,4550000,20240915 2750000,4600000,20240915 2750000,4650000,20250915 2750000,4700000,20240915 2750000,4750000,20240915 2750000,4800000,20240915 2750000,4850000,20250915 2800000,4500000,20240915 2800000,4550000,20250915 2800000,4600000,20250915 2800000,4650000,20240915 2800000,4700000,20230915 2800000,4750000,20250915 2800000,4800000,20250915 2850000,4600000,20250915 2850000,4650000,20250915 2850000,4700000,20250915 2850000,4750000,20240915 2850000,4800000,20250915";
const austriaFolder = new Map( AUSTRIA_TILES.split( " " ).map( ( t ) => t.split( "," ) ).map( ( [n, e, d] ) => [`${n},${e}`, d] ) );
const austriaName   = ( n: number, e: number ) => `ALS_DTM_CRS3035RES50000mN${n}E${e}.tif`;

/**
 * A tile's address: the known edition, or ( gone ) the newest BEV's catalogue lists.
**/
async function austriaUrl( n: number, e: number ): Promise<string | null> {
  const folder = austriaFolder.get( `${n},${e}` );
  if ( !folder ) return null;
  const known = `https://data.bev.gv.at/download/ALS/DTM/${folder}/${austriaName( n, e )}`;
  const head  = await httpFetch( known, "bytes=0-15" ).catch( () => null );
  if ( head && ( head.status === 200 || head.status === 206 ) ) return known;
  const body  = JSON.stringify( { from: 0, size: 50, query: { multi_match: { query: austriaName( n, e ).replace( ".tif", "" ), fields: ["resourceTitleObject.default", "anytext"] } } } );
  const found = await fetch( "https://data.bev.gv.at/geonetwork/srv/api/search/records/_search", { method: "POST", headers: { "Content-Type": "application/json" }, body } )
    .then( ( x ) => x.text() )
    .catch( () => "" );
  const urls = [...found.matchAll( /https:\/\/data\.bev\.gv\.at\/download\/ALS\/DTM\/(\d+)\/ALS_DTM_CRS3035RES50000mN(\d+)E(\d+)\.tif/g )].filter( ( m ) => +m[2] === n && +m[3] === e );
  return urls.sort( ( a, b ) => +b[1] - +a[1] )[0]?.[0] ?? null;
}

async function austriaSampler( box: Box, spacing: number, onProgress?: ( f: number ) => void ): Promise<Sampler> {
  if ( !overlaps( box, AUSTRIA ) ) return () => NaN;
  const native         = projectBox( "EPSG:3035", box );
  const urls: string[] = [];
  for ( let n = Math.floor( native[1] / 50000 ) * 50000; n <= native[3]; n += 50000 )
    for ( let e = Math.floor( native[0] / 50000 ) * 50000; e <= native[2]; e += 50000 ) {
      const u = await austriaUrl( n, e );
      if ( u ) urls.push( u );
    }
  return cogSampler( urls, "EPSG:3035", box, spacing, onProgress );
}

export const austria: DemSource = {
  id:          "bev-als-dtm",
  name:        "BEV ALS DTM",
  attribution: "Elevation: ALS DTM Austria © BEV (CC BY 4.0)",
  levels:      [{ res: 1, label: "1 m lidar", covered: coarseCoverage( AUSTRIA, ( box ) => austriaSampler( box, COARSE ) ) }],
  fetch:       ( _level, box, onProgress, _signal, spacing ) => austriaSampler( box, Math.max( 1, spacing ?? 0 ), onProgress ),
};

// ---------------------------------------------------------------- France: IGN RGE ALTI ( 1 m )

const FRANCE: Box = [-5.3, 41.3, 9.7, 51.2];
const IGN_WMS     = "https://data.geopf.fr/wms-r";

async function franceSampler( box: Box, spacing: number, onProgress?: ( f: number ) => void, signal?: AbortSignal ): Promise<Sampler> {
  if ( !overlaps( box, FRANCE ) ) return () => NaN;
  return mercatorGrid(
    box,
    spacing,
    async ( b, w, h ) => {
      const q = new URLSearchParams( {
        SERVICE: "WMS",       VERSION: "1.3.0", REQUEST: "GetMap", LAYERS: "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES", STYLES: "",
        CRS:     "EPSG:3857", BBOX:    b.join( "," ), WIDTH: String( w ), HEIGHT: String( h ), FORMAT: "image/x-bil;bits=32",
      } );
      const r = await httpFetch( `${IGN_WMS}?${q}` );
      if ( r.status !== 200 ) throw new Error( `IGN answered ${r.status}` );
      return r.body;
    },
    "IGN elevation",
    onProgress,
    signal,
  );
}

export const france: DemSource = {
  id:          "ign-rgealti",
  name:        "IGN RGE ALTI",
  attribution: "Elevation: RGE ALTI® © IGN (Licence Ouverte)",
  levels:      [{ res: 1, label: "1 m", covered: coarseCoverage( FRANCE, ( box ) => franceSampler( box, COARSE ) ) }],
  fetch:       ( _level, box, onProgress, signal, spacing ) => franceSampler( box, Math.max( 1, spacing ?? 0 ), onProgress, signal ),
};

// ---------------------------------------------------------------- Norway: Kartverket DTM ( 1 m )

const NORWAY: Box = [4.0, 57.8, 31.5, 71.3];
const HOYDEDATA   = "https://hoydedata.no/arcgis/rest/services/DTM/ImageServer";

const norwaySampler = ( box: Box, spacing: number, onProgress?: ( f: number ) => void, signal?: AbortSignal ): Promise<Sampler> =>
  overlaps( box, NORWAY )
    ? mercatorGrid( box, spacing, ( b, w, h, stop ) => arcgisPiece( HOYDEDATA, b, w, h, stop, true ), "Kartverket elevation", onProgress, signal )
    : Promise.resolve( () => NaN );

export const norway: DemSource = {
  id:          "kartverket-dtm",
  name:        "Kartverket DTM",
  attribution: "Elevation: © Kartverket (CC BY 4.0)",
  levels:      [{ res: 1, label: "1 m lidar", covered: coarseCoverage( NORWAY, ( box ) => norwaySampler( box, COARSE ) ) }],
  fetch:       ( _level, box, onProgress, signal, spacing ) => norwaySampler( box, Math.max( 1, spacing ?? 0 ), onProgress, signal ),
};

// ---------------------------------------------------------------- Japan: GSI DEM ( 5 m where surveyed, 10 m )

const JAPAN: Box = [122.9, 24.0, 146.0, 45.6];
const MERC_HALF  = 20037508.342789244, TILE = 256;

/**
 * Heights from GSI's elevation tiles ( Web Mercator PNGs at zoom `z`: x = R·2¹⁶ + G·2⁸ + B, in centimetres, 2²³ =
 * none, above it negative ). Missing tiles are holes.
**/
async function gsiSampler( layer: string, z: number, box: Box, onProgress?: ( f: number ) => void ): Promise<Sampler> {
  if ( !overlaps( box, JAPAN ) ) return () => NaN;
  const n                        = 2 ** z, tm = ( 2 * MERC_HALF ) / n;
  const [mx0, my0]               = mercator.forward( { lon: box[0], lat: box[1] } );
  const [mx1, my1]               = mercator.forward( { lon: box[2], lat: box[3] } );
  const tx0                      = Math.floor( ( mx0 + MERC_HALF ) / tm ), tx1 = Math.floor( ( mx1 + MERC_HALF ) / tm );
  const ty0                      = Math.floor( ( MERC_HALF - my1 ) / tm ), ty1 = Math.floor( ( MERC_HALF - my0 ) / tm );
  const W                        = ( tx1 - tx0 + 1 ) * TILE, H = ( ty1 - ty0 + 1 ) * TILE;
  const grid                     = new Float32Array( W * H ).fill( NaN );
  const jobs: [number, number][] = [];
  for ( let ty = ty0; ty <= ty1; ty++ ) for ( let tx = tx0; tx <= tx1; tx++ ) jobs.push( [tx, ty] );
  let done = 0;
  await pool( jobs, 6, async ( [tx, ty] ) => {
    const r = await fetch( `https://cyberjapandata.gsi.go.jp/xyz/${layer}/${z}/${tx}/${ty}.png` );
    if ( r.ok ) {
      const px = await decodePng( await r.blob() );
      const ox = ( tx - tx0 ) * TILE, oy = ( ty - ty0 ) * TILE;
      for ( let j = 0; j < TILE; j++ )
        for ( let i = 0; i < TILE; i++ ) {
          const k                       = ( j * TILE + i ) * 4;
          const x                       = px[k] * 65536 + px[k + 1] * 256 + px[k + 2];
          grid[( oy + j ) * W + ox + i] = x === 8388608 ? NaN : ( x < 8388608 ? x : x - 16777216 ) * 0.01;
        }
    }
    onProgress?.( ++done / jobs.length );
  } );
  return ( p ) => {
    const [x, y] = mercator.forward( p );
    const fx     = ( ( x + MERC_HALF ) / tm - tx0 ) * TILE - 0.5, fy = ( ( MERC_HALF - y ) / tm - ty0 ) * TILE - 0.5;
    if ( !( fx >= 0 && fy >= 0 && fx <= W - 1 && fy <= H - 1 ) ) return NaN;
    const i = Math.min( W - 2, Math.floor( fx ) ), j = Math.min( H - 2, Math.floor( fy ) ), a = fx - i, b = fy - j, q = j * W + i;
    return ( grid[q] * ( 1 - a ) + grid[q + 1] * a ) * ( 1 - b ) + ( grid[q + W] * ( 1 - a ) + grid[q + W + 1] * a ) * b;
  };
}

const japanLevels = [
  { res: 5,  label: "5 m",  layer: "dem5a_png", z: 15 },
  { res: 10, label: "10 m", layer: "dem_png",   z: 14 },
].map( ( l ) => ( { ...l, covered: coarseCoverage( JAPAN, ( box ) => gsiSampler( l.layer, l.z, box ) ) } ) );

export const japan: DemSource = {
  id:          "gsi-dem",
  name:        "GSI DEM",
  attribution: "Elevation: 国土地理院 Geospatial Information Authority of Japan",
  levels:      japanLevels,
  fetch:       ( level, box, onProgress ) => gsiSampler( japanLevels[level].layer, japanLevels[level].z, box, onProgress ),
};

// ---------------------------------------------------------------- all of them

// All sources, the finest first: national lidar, then the whole world.
export const SOURCES: DemSource[] = [usgs3dep, swiss, austria, canada, france, norway, japan, copernicus, terrarium];

/**
 * For each chunk ( its test points ), the finest level that covers all of it, or null. Every level is asked at once
 * ( most answer "not here" straight away; the rest each look at their own data ), then the finest that has a chunk wins.
**/
export async function bestLevels( chunks: LonLat[][], signal?: AbortSignal ): Promise<( DemLevel | null )[]> {
  const levels  = SOURCES.flatMap( ( source ) => source.levels.map( ( lv, index ) => ( { source, lv, index } ) ) ).sort( ( a, b ) => a.lv.res - b.lv.res );
  const answers = await Promise.all(
    levels.map( ( { source, lv } ) =>
      lv.covered( chunks ).catch( ( e ) => {
        if ( !signal?.aborted ) console.warn( `${source.name} ${lv.label}:`, e );
        return chunks.map( () => false );
      } ),
    ),
  );
  if ( signal?.aborted ) throw new DOMException( "cancelled", "AbortError" );
  return chunks.map( ( _, i ) => {
    const k = answers.findIndex( ( ok ) => ok[i] );
    if ( k < 0 ) return null;
    const { source, lv, index } = levels[k];
    return { source, index, res: lv.res, label: lv.label };
  } );
}

/**
 * Where the main data has holes ( open sea, a gap in the lidar ): Copernicus, then the terrain tiles.
**/
export async function fillSampler( box: Box, spacing: number, signal?: AbortSignal ): Promise<Sampler> {
  const none: Sampler = () => NaN;
  const cop           = await copernicus.fetch( 0, box, undefined, signal, spacing ).catch( () => none );
  const tiles         = await terrarium.fetch( 0, box, undefined, signal ).catch( () => none );
  return firstOf( [cop, tiles] );
}
