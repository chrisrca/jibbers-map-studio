// The Import Real Mountain map's look: the terrain in 3D with its shading, the runs and lifts, the selection's layers,
// the ski areas' pins, a sky; and the colours and text it shows.

import maplibregl from "maplibre-gl";
import { addTrailLayers, TERRARIUM_TILES } from "../../../geo/mapLayers";
import type { LonLat } from "../../../geo/proj";

// The most chunks an area may have each way.
export const MAX_CHUNKS = 20;

// A place from the online search ( Enter ): a town, a peak, anything that isn't a ski area.
export interface SearchHit {
  name: string;
  lat:  number;
  lon:  number;
  box?: [number, number, number, number];
}

export const lonLatText = ( p: LonLat ) => `${Math.abs( p.lat ).toFixed( 4 )}° ${p.lat >= 0 ? "N" : "S"}, ${Math.abs( p.lon ).toFixed( 4 )}° ${p.lon >= 0 ? "E" : "W"}`;

/**
 * Colour for a resolution in metres ( finer = greener ).
**/
export function resColor( res: number | null ) {
  if ( res === null ) return "#9ca3af";
  if ( res <= 1 ) return "#22c55e";
  if ( res <= 3 ) return "#a3e635";
  if ( res <= 10 ) return "#f59e0b";
  return "#ef4444";
}

/**
 * A little map pin ( drawn here: the style's own icons are a different set ), twice size for sharp edges.
**/
function pinImage(): ImageData {
  const c  = document.createElement( "canvas" );
  c.width  = 40;
  c.height = 52;
  const g  = c.getContext( "2d" )!;
  g.beginPath();
  g.moveTo( 20, 50 );
  g.bezierCurveTo( 16, 40, 4, 30, 4, 19 );
  g.arc( 20, 19, 16, Math.PI, 0 );
  g.bezierCurveTo( 36, 30, 24, 40, 20, 50 );
  g.closePath();
  g.fillStyle = "#4772b3";
  g.fill();
  g.lineWidth   = 3;
  g.strokeStyle = "#ffffff";
  g.stroke();
  g.beginPath();
  g.arc( 20, 19, 6, 0, Math.PI * 2 );
  g.fillStyle = "#ffffff";
  g.fill();
  return g.getImageData( 0, 0, c.width, c.height );
}

/**
 * A pin and name for every ski area, over everything; bigger ones win where names would overlap. Gone once zoomed in
 * enough to see the runs themselves.
**/
function addSkiAreaLayers( m: maplibregl.Map ) {
  if ( !m.hasImage( "ski-pin" ) ) m.addImage( "ski-pin", pinImage(), { pixelRatio: 2 } );
  if ( !m.getSource( "skiareas" ) ) m.addSource( "skiareas", { type: "geojson", data: { type: "FeatureCollection", features: [] } } );
  if ( m.getLayer( "skiarea-pins" ) ) return;
  m.addLayer( {
    id: "skiarea-pins", type: "symbol", source: "skiareas", minzoom: 4, maxzoom: 12.5,
    layout: {
      "symbol-sort-key": ["-", ["get", "runs"]],
      "icon-image":      "ski-pin",
      "icon-anchor":     "bottom",
      "text-field":      ["get", "name"],
      "text-font":       ["Noto Sans Bold"],
      "text-size":       11,
      "text-anchor":     "top",
      "text-offset":     [0, 0.2],
      "text-optional":   true,
      "text-max-width":  9,
    },
    paint: { "text-color": "#1f3a66", "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
  } );
}

/**
 * The terrain in 3D with its shading, the runs and lifts, the selection and the ski areas' pins, over the street map
 * ( their data is set by the dialog ).
**/
export function addMapLayers( m: maplibregl.Map ) {
  // the street map as it comes, but for the wetland pattern ( rows of little reeds over ponds and marshes )
  if ( m.getLayer( "landcover_wetland" ) ) m.removeLayer( "landcover_wetland" );
  if ( !m.getSource( "dem"       ) ) m.addSource( "dem",       { type: "raster-dem", tiles: [TERRARIUM_TILES], encoding: "terrarium", tileSize: 256, maxzoom: 14 } );
  if ( !m.getSource( "dem-shade" ) ) m.addSource( "dem-shade", { type: "raster-dem", tiles: [TERRARIUM_TILES], encoding: "terrarium", tileSize: 256, maxzoom: 14 } );
  if ( !m.getLayer( "hillshade" ) ) m.addLayer( { id: "hillshade", type: "hillshade", source: "dem-shade", paint: { "hillshade-exaggeration": 0.35 } } );
  addTrailLayers( m );
  if ( !m.getSource( "sel" ) ) m.addSource( "sel", { type: "geojson", data: { type: "FeatureCollection", features: [] } } );
  if ( !m.getLayer( "sel-fill" ) )
    m.addLayer( { id: "sel-fill", type: "fill", source: "sel", paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "opacity"] } } );
  if ( !m.getLayer( "sel-line" ) )
    m.addLayer( { id: "sel-line", type: "line", source: "sel", paint: { "line-color": "#ffffff", "line-width": 1, "line-opacity": ["case", ["get", "out"], 0.4, 0.85] } } );
  addSkiAreaLayers( m );
  m.setTerrain( { source: "dem", exaggeration: 1.2 } );
  // the far distance fades into haze under a sky ( just towards the horizon )
  m.setSky( {
    "sky-color":         "#a9cbea",
    "horizon-color":     "#eef2f5",
    "fog-color":         "#eef2f5",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.8,
    "fog-ground-blend":  0.8,
    "atmosphere-blend":  0,
  } );
  // detail further into the distance than the map's default, which coarsens tiles quickly away from the middle
  // ( measured: default 92 fps, this 81, twice as sharp again 67 )
  m.setSourceTileLodParams( 6, 3 );
}
