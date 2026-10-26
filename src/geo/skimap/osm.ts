// Ski runs and lifts from OpenStreetMap ( Overpass API ), drawn into snow-mask markings.
// Ported from the Crotched Mountain test ( osm_ski_trails.py ): runs by difficulty, glades dashed, lifts as lines,
// closed areas ( area=yes ) filled.

import { ipc } from "../../core/ipc";
import type { LonLat } from "../proj";

export type TrailKind = "easy" | "intermediate" | "advanced" | "freeride" | "unknown" | "lift";

export interface Trail {
  kind:   TrailKind;
  glade:  boolean;
  // closed area to fill rather than a line
  area:   boolean;
  name:   string;
  points: LonLat[];
}

// Marking hues ( the game's palette: hue snapped to 1/20, drawn as a saturated tint, so there is no black or grey ).
// North American colours where possible; black runs use magenta.
export const TRAIL_HUES: Record<TrailKind, number> = {
  easy:         0.4,  // green
  intermediate: 0.6,  // blue
  advanced:     0.8,  // magenta ( stands in for black )
  freeride:     0.1,  // orange ( parks, freeride )
  unknown:      0.2,  // yellow
  lift:         0.05, // red
};

// Drawn widths in metres ( OSM has centrelines only ).
export const TRAIL_WIDTH: Record<TrailKind, number> = { easy: 14, intermediate: 14, advanced: 14, freeride: 14, unknown: 12, lift: 3 };

function classify( tags: Record<string, string> ): { kind: TrailKind; glade: boolean } | null {
  if ( tags.aerialway ) return ["pylon", "station", "goods"].includes( tags.aerialway ) ? null : { kind: "lift", glade: false };
  const type = tags["piste:type"];
  if ( !type || !["downhill", "skitour", "playground", "sled"].includes( type ) ) return null;
  const d     = ( tags["piste:difficulty"] ?? "" ).toLowerCase();
  const glade = /glade/i.test( tags.name ?? "" ) || tags["piste:grooming"] === "backcountry";
  const kind: TrailKind =
    d === "novice" || d === "easy" ? "easy"
    : d === "intermediate" ? "intermediate"
    : d === "advanced" || d === "expert" || d === "extreme" ? "advanced"
    : d === "freeride" || tags["piste:type"] === "playground" ? "freeride"
    : "unknown";
  return { kind, glade };
}

/**
 * The query for runs and lifts inside the lon/lat box ( west, south, east, north ).
**/
function trailQuery( box: [number, number, number, number] ) {
  const bb = `${box[1]},${box[0]},${box[3]},${box[2]}`;
  return `[out:json][timeout:25];(way["piste:type"](${bb});relation["piste:type"](${bb});way["aerialway"](${bb}););out geom;`;
}

/**
 * One go at it ( the studio asks the public servers, naming itself, as they ask: src-tauri overpass_query ).
**/
async function ask( box: [number, number, number, number], signal?: AbortSignal ) {
  const text = await ipc.overpassQuery( trailQuery( box ) );
  if ( signal?.aborted ) throw new DOMException( "cancelled", "AbortError" );
  return parse( JSON.parse( text ) );
}

/**
 * Runs and lifts inside the lon/lat box ( west, south, east, north ), for an import: asked twice, a pause between.
**/
export async function fetchTrails( box: [number, number, number, number], signal?: AbortSignal ): Promise<Trail[]> {
  try {
    return await ask( box, signal );
  } catch ( e ) {
    if ( signal?.aborted ) throw e;
    await new Promise( ( r ) => setTimeout( r, 4000 ) );
    return ask( box, signal );
  }
}

interface OsmElement {
  type:      "way" | "relation";
  tags?:     Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  members?:  { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
}

function parse( d: { elements?: OsmElement[] } ): Trail[] {
  const out: Trail[] = [];
  for ( const e of d.elements ?? [] ) {
    const tags = e.tags ?? {};
    const c    = classify( tags );
    if ( !c ) continue;
    const name = tags.name ?? "";
    const lines =
      e.type === "way"
        ? [e.geometry ?? []]
        : ( e.members ?? [] ).filter( ( m ) => m.type === "way" && m.geometry ).map( ( m ) => m.geometry! );
    for ( const g of lines ) {
      if ( g.length < 2 ) continue;
      const pts    = g.map( ( p ) => ( { lon: p.lon, lat: p.lat } ) );
      const closed = pts.length > 3 && pts[0].lon === pts[pts.length - 1].lon && pts[0].lat === pts[pts.length - 1].lat;
      out.push( { ...c, name, area: closed && ( tags.area === "yes" || e.type === "relation" ), points: pts } );
    }
  }
  return out;
}
