// Map pieces shared by the real-mountain import and the home screen's backdrop: the street map, the 3D terrain under
// it, and runs and lifts drawn from the ones shipped with the studio ( geo/skimap/skimap.ts ).

import type { Feature } from "geojson";
import type maplibregl from "maplibre-gl";
import { pisteColor, type SkiLine } from "./skimap/skimap";

export const MAP_STYLE       = "https://tiles.openfreemap.org/styles/liberty";
export const TERRARIUM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

// ---------------------------------------------------------------- runs and lifts drawn on the map

export const TRAIL_COLOR: maplibregl.ExpressionSpecification = ["get", "color"];
export const isRun:       maplibregl.ExpressionSpecification = ["all", ["!=", ["get", "lift"], true], ["!", ["get", "area"]]];

export function trailFeature( l: SkiLine ): Feature {
  return {
    type:       "Feature",
    properties: { color: pisteColor( l ), lift: l.difficulty === "lift", glade: l.glade, area: l.area, name: l.name },
    geometry:   l.area ? { type: "Polygon", coordinates: [l.points] } : { type: "LineString", coordinates: l.points },
  };
}

/**
 * The runs-and-lifts layers, under the selection.
**/
export function addTrailLayers( m: maplibregl.Map ) {
  if ( !m.getSource( "trails" ) )
    m.addSource( "trails", { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: "Runs and lifts: <a href='https://openskimap.org'>OpenSkiMap</a>, © OpenStreetMap contributors" } );
  if ( m.getLayer( "trails-run" ) ) return;
  const visibility = "visible";
  const width      = ( a: number, b: number, c: number ): maplibregl.ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], 10, a, 13, b, 16, c];
  m.addLayer( { id: "trails-area", type: "fill", source: "trails", filter: ["==", ["get", "area"], true], layout: { visibility }, paint: { "fill-color": TRAIL_COLOR, "fill-opacity": 0.14 } } );
  m.addLayer( {
    id:     "trails-casing", type: "line", source: "trails", filter: isRun,
    layout: { visibility, "line-join": "round", "line-cap": "round" },
    paint:  { "line-color": "#ffffff", "line-width": width( 2.2, 3.6, 6.5 ), "line-opacity": 0.85 },
  } );
  m.addLayer( {
    id:     "trails-run", type: "line", source: "trails", filter: ["all", isRun, ["!", ["get", "glade"]]],
    layout: { visibility, "line-join": "round", "line-cap": "round" },
    paint:  { "line-color": TRAIL_COLOR, "line-width": width( 1, 2, 4 ) },
  } );
  m.addLayer( {
    id:     "trails-glade", type: "line", source: "trails", filter: ["all", isRun, ["get", "glade"]],
    layout: { visibility, "line-join": "round" },
    paint:  { "line-color": TRAIL_COLOR, "line-width": width( 1, 2, 4 ), "line-dasharray": [2, 1.5] },
  } );
  m.addLayer( {
    id:     "trails-lift", type: "line", source: "trails", filter: ["==", ["get", "lift"], true],
    layout: { visibility },
    paint:  { "line-color": TRAIL_COLOR, "line-width": width( 0.8, 1.3, 2.2 ) },
  } );
  m.addLayer( {
    id:     "trails-label", type: "symbol", source: "trails", minzoom: 13, filter: ["all", ["!", ["get", "area"]], ["!=", ["get", "name"], ""]],
    layout: { visibility, "symbol-placement": "line", "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11 },
    paint:  { "text-color": TRAIL_COLOR, "text-halo-color": "#ffffff", "text-halo-width": 1.4 },
  } );
}
