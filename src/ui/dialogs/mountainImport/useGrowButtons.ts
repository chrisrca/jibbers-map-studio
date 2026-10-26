// A + and a − on each side of the area: a row or column of chunks more or less on that side, the other sides staying
// put ( sitting on the ground in 3D ).

import maplibregl from "maplibre-gl";
import { useEffect, type RefObject } from "react";
import { CHUNK, type ImportArea } from "../../../geo/importMountain";
import { LocalProjection } from "../../../geo/proj";
import { MAX_CHUNKS } from "./mapLook";

// A side of the area: its middle, the way out, its name.
type GrowSide = { at: [number, number]; dir: [number, number]; name: string };

export function useGrowButtons( map: RefObject<maplibregl.Map | null>, area: ImportArea | null, setArea: ( a: ImportArea ) => void ) {
  useEffect( () => {
    const m = map.current;
    if ( !m || !area ) return;
    const proj              = new LocalProjection( area.center );
    const hx                = ( area.chunksX * CHUNK ) / 2, hz = ( area.chunksZ * CHUNK ) / 2;
    const sides: GrowSide[] = [
      { at: [hx,  0  ], dir: [1,  0 ], name: "east"  },
      { at: [-hx, 0  ], dir: [-1, 0 ], name: "west"  },
      { at: [0,   hz ], dir: [0,  1 ], name: "north" },
      { at: [0,   -hz], dir: [0,  -1], name: "south" },
    ];
    const markers = sides.map( ( sd ) => {
      const along  = sd.dir[0] ? area.chunksX : area.chunksZ;
      const what   = sd.dir[0] ? "column" : "row";
      const el     = document.createElement( "div" );
      el.className = "mtnw-grow";
      const button = ( label: string, title: string, by: number, on: boolean ) => {
        const b       = document.createElement( "button" );
        b.textContent = label;
        b.title       = title;
        b.disabled    = !on;
        // its own click: not the start of a drag on the map underneath
        b.addEventListener( "mousedown", ( e ) => e.stopPropagation() );
        b.addEventListener( "click", ( e ) => {
          e.stopPropagation();
          const c = proj.inverse( ( sd.dir[0] * by * CHUNK ) / 2, ( sd.dir[1] * by * CHUNK ) / 2 );
          setArea( { center: c, chunksX: area.chunksX + Math.abs( sd.dir[0] ) * by, chunksZ: area.chunksZ + Math.abs( sd.dir[1] ) * by } );
        } );
        el.appendChild( b );
      };
      button( "+", `A ${what} of chunks more to the ${sd.name}`, 1,  along < MAX_CHUNKS );
      button( "−", `A ${what} of chunks less on the ${sd.name}`, -1, along > 1          );
      const ll = proj.inverse( sd.at[0], sd.at[1] );
      return new maplibregl.Marker( { element: el, anchor: "center" } ).setLngLat( [ll.lon, ll.lat] ).addTo( m );
    } );
    return () => markers.forEach( ( mk ) => mk.remove() );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area] );
}
