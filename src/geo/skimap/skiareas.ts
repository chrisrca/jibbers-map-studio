// The world's operating downhill ski areas, shipped with the studio ( public/skiareas.json.gz, ~230 kB, built by
// tools/build_skimap.py from OpenSkiMap: © OpenStreetMap contributors, ODbL ): pins on the import map, and what its
// search finds as you type.

export interface SkiArea {
  name:     string;
  lon:      number;
  lat:      number;
  // where its runs and lifts are: west, south, east, north
  box:      [number, number, number, number];
  country:  string;
  region:   string;
  runs:     number;
  // metres from its lowest to its highest run
  vertical: number;
}

let loading: Promise<SkiArea[]> | null = null;

/**
 * All of them, biggest ( most runs ) first.
**/
export function skiAreas(): Promise<SkiArea[]> {
  loading ??= ( async () => {
    const r = await fetch( "/skiareas.json.gz" );
    if ( !r.ok ) throw new Error( `the ski area list is missing (${r.status})` );
    let bytes = new Uint8Array( await r.arrayBuffer() );
    if ( bytes[0] === 0x1f && bytes[1] === 0x8b ) bytes = new Uint8Array( await new Response( new Blob( [bytes] ).stream().pipeThrough( new DecompressionStream( "gzip" ) ) ).arrayBuffer() );
    return skiAreasFrom( new TextDecoder().decode( bytes ) );
  } )();
  loading.catch( () => ( loading = null ) );
  return loading;
}

type Row = [string, number, number, number, number, number, number, string, string, number, number];

export function skiAreasFrom( json: string ): SkiArea[] {
  return ( JSON.parse( json ) as Row[] ).map( ( [name, lon, lat, w, s, e, n, country, region, runs, vertical] ) => ( {
    name, lon, lat, box: [w, s, e, n], country, region, runs, vertical,
  } ) );
}

/**
 * lower case, accents off ( "Méribel" finds "meribel" )
**/
const fold = ( t: string ) => t.normalize( "NFD" ).replace( /[̀-ͯ]/g, "" ).toLowerCase();

/**
 * The ski areas a search means, best first: every word typed must be in its name, region or country; a name that
 * starts with what's typed beats one that has it at a word's start, beats one that has it anywhere; then bigger first.
**/
export function searchSkiAreas( all: SkiArea[], query: string, limit = 8 ): SkiArea[] {
  const q = fold( query.trim() );
  if ( q.length < 2 ) return [];
  const words = q.split( /[\s,]+/ ).filter( Boolean );
  const scored: { a: SkiArea; score: number }[] = [];
  for ( const a of all ) {
    const name = fold( a.name ), place = fold( `${a.region} ${a.country}` );
    if ( !words.every( ( w ) => name.includes( w ) || place.includes( w ) ) ) continue;
    let score = name === q ? 400 : name.startsWith( q ) ? 300 : new RegExp( `(^|[^a-z0-9])${q.replace( /[.*+?^${}()|[\]\\]/g, "\\$&" )}` ).test( name ) ? 200 : name.includes( q ) ? 100 : 0;
    score    += Math.min( 99, Math.log2( 1 + a.runs ) * 10 );
    scored.push( { a, score } );
  }
  return scored.sort( ( p, q2 ) => q2.score - p.score ).slice( 0, limit ).map( ( s ) => s.a );
}
