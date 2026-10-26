// Every downhill run, terrain park and ski lift in the world, shipped with the studio ( public/skimap.bin.gz, ~6 MB,
// built by tools/build_skimap.py from OpenSkiMap's exports of OpenStreetMap: © OpenStreetMap contributors, ODbL ).
// Read once, then decoded a 1-degree cell at a time as the map looks there: a mountain's runs show at once, and an
// import gets them without asking a server.

import type { LonLat } from "../proj";
import type { Trail, TrailKind } from "./osm";

// difficulty by the file's kind byte ( 9 = lift )
const DIFFICULTY          = ["novice", "easy", "intermediate", "advanced", "expert", "extreme", "freeride", "unknown", "park", "lift"] as const;
export type SkiDifficulty = ( typeof DIFFICULTY )[number];
// how a region colours its runs
export type Convention    = "northAmerica" | "europe" | "japan";

export interface SkiLine {
  difficulty: SkiDifficulty;
  convention: Convention;
  glade:      boolean;
  // a closed area ( a run drawn as a polygon ) rather than a line
  area:       boolean;
  name:       string;
  points:     [number, number][];
}

/**
 * The colour a run has on the region's own piste maps; lifts dark grey.
**/
export function pisteColor( l: Pick<SkiLine, "difficulty" | "convention"> ): string {
  const GREEN = "#2f9e44", BLUE = "#1c6ed6", RED = "#d62828", BLACK = "#1b1b1b", ORANGE = "#e8590c", GREY = "#868e96";
  switch ( l.difficulty ) {
    case "lift":         return "#3a3a3a";
    case "freeride":
    case "park":         return ORANGE;
    case "unknown":      return GREY;
    case "novice":       return GREEN;
    case "easy":         return l.convention === "europe" ? BLUE : GREEN;
    case "intermediate": return l.convention === "northAmerica" ? BLUE : RED;
    default:             return BLACK; // advanced, expert, extreme
  }
}

// For an import's snow markings ( the game's palette, geo/skimap/osm.ts ).
const TRAIL_KIND: Record<SkiDifficulty, TrailKind> = {
  novice:   "easy",     easy: "easy",     intermediate: "intermediate", advanced: "advanced", expert: "advanced", extreme: "advanced",
  freeride: "freeride", park: "freeride", unknown:      "unknown",      lift:     "lift",
};

class SkiMap {
  private cells = new Map<string, { offset: number; length: number }>();
  private names: string[] = [];
  private decoded = new Map<string, SkiLine[]>();

  constructor( private bytes: Uint8Array ) {
    const v = new DataView( bytes.buffer, bytes.byteOffset, bytes.byteLength );
    if ( String.fromCharCode( ...bytes.subarray( 0, 4 ) ) !== "JSKI" ) throw new Error( "not a ski map file" );
    const cells = v.getUint32( 8, true ), names = v.getUint32( 12, true );
    let p       = 16;
    for ( let i = 0; i < cells; i++, p += 12 )
      this.cells.set( `${v.getInt16( p, true )},${v.getInt16( p + 2, true )}`, { offset: v.getUint32( p + 4, true ), length: v.getUint32( p + 8, true ) } );
    const text = new TextDecoder();
    const r    = { p };
    for ( let i = 0; i < names; i++ ) {
      const n = varint( bytes, r );
      this.names.push( text.decode( bytes.subarray( r.p, r.p + n ) ) );
      r.p += n;
    }
  }

  /**
   * The runs and lifts in 1-degree cell ( x, y ) ( its south-west corner, in degrees ).
  **/
  cell( x: number, y: number ): SkiLine[] {
    const key  = `${x},${y}`;
    const done = this.decoded.get( key );
    if ( done ) return done;
    const at             = this.cells.get( key );
    const out: SkiLine[] = [];
    if ( at ) {
      const b     = this.bytes, r = { p: at.offset };
      const count = varint( b, r );
      for ( let f = 0; f < count; f++ ) {
        const kind                       = b[r.p++], flags = b[r.p++];
        const name                       = this.names[varint( b, r )] ?? "";
        const n                          = varint( b, r );
        let qx                           = x * 1e5, qy = y * 1e5;
        const points: [number, number][] = [];
        for ( let k = 0; k < n; k++ ) {
          qx += unzig( varint( b, r ) );
          qy += unzig( varint( b, r ) );
          points.push( [qx / 1e5, qy / 1e5] );
        }
        out.push( {
          difficulty: DIFFICULTY[kind] ?? "unknown",
          convention: flags & 4 ? "europe" : flags & 8 ? "japan" : "northAmerica",
          glade:      !!( flags & 1 ),
          area:       !!( flags & 2 ),
          name,
          points,
        } );
      }
    }
    this.decoded.set( key, out );
    return out;
  }

  /**
   * The 1-degree cells touching the box ( west, south, east, north ), as [x, y].
  **/
  cellsIn( box: [number, number, number, number] ): [number, number][] {
    const out: [number, number][] = [];
    for ( let x = Math.floor( box[0] ); x <= Math.floor( box[2] ); x++ ) for ( let y = Math.floor( box[1] ); y <= Math.floor( box[3] ); y++ ) out.push( [x, y] );
    return out;
  }

  /**
   * Runs and lifts with a point inside the box, as an import's trails.
  **/
  trails( box: [number, number, number, number] ): Trail[] {
    const inside = ( p: [number, number] ) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3];
    // a feature belongs to the cell its middle is in, so it may reach in from a neighbouring cell
    const pad: [number, number, number, number] = [box[0] - 0.5, box[1] - 0.5, box[2] + 0.5, box[3] + 0.5];
    return this.cellsIn( pad ).flatMap( ( [x, y] ) => this.cell( x, y ) )
      .filter( ( l ) => l.points.some( inside ) )
      .map( ( l ) => ( {
        kind:   TRAIL_KIND[l.difficulty],
        glade:  l.glade,
        area:   l.area,
        name:   l.name,
        points: l.points.map( ( [lon, lat] ): LonLat => ( { lon, lat } ) ),
      } ) );
  }
}

function varint( b: Uint8Array, r: { p: number } ) {
  let n = 0, shift = 0, byte: number;
  do {
    byte   = b[r.p++];
    n     += ( byte & 0x7f ) * 2 ** shift;
    shift += 7;
  } while ( byte & 0x80 );
  return n;
}

const unzig = ( n: number ) => ( n % 2 === 0 ? n / 2 : -( n + 1 ) / 2 );

let loading: Promise<SkiMap> | null = null;

/**
 * The world's runs and lifts ( loaded once; ~0.1 s ).
**/
export function skiMap(): Promise<SkiMap> {
  loading ??= ( async () => {
    const r = await fetch( "/skimap.bin.gz" );
    if ( !r.ok ) throw new Error( `the ski map data is missing (${r.status})` );
    let bytes = new Uint8Array( await r.arrayBuffer() );
    // gzipped as shipped ( unless whatever served it unpacked it already )
    if ( bytes[0] === 0x1f && bytes[1] === 0x8b ) bytes = new Uint8Array( await new Response( new Blob( [bytes] ).stream().pipeThrough( new DecompressionStream( "gzip" ) ) ).arrayBuffer() );
    return skiMapFrom( bytes );
  } )();
  loading.catch( () => ( loading = null ) );
  return loading;
}

/**
 * From the file's ( unpacked ) bytes.
**/
export const skiMapFrom = ( bytes: Uint8Array ) => new SkiMap( bytes );

export type { SkiMap };
