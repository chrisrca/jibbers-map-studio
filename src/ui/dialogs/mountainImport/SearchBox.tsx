// The Import Real Mountain search: ski areas as you type ( from the list shipped with the studio ), places from
// OpenStreetMap's search on Enter ( towns, peaks, anything that isn't a ski area ).

import { useEffect, useMemo, useState } from "react";
import { searchSkiAreas, type SkiArea } from "../../../geo/skimap/skiareas";
import { useEditor } from "../../../map/store";
import { Icon } from "../../widgets/icons";
import type { SearchHit } from "./mapLook";

// what the list under the search shows: ski areas as you type, then the places Enter found, then "search places"
type ListItem = { kind: "area"; a: SkiArea } | { kind: "place"; h: SearchHit } | { kind: "more" };

export function SearchBox( p: {
  query:    string;
  setQuery: ( q: string ) => void;
  open:     boolean;
  setOpen:  ( on: boolean ) => void;
  areas:    SkiArea[];
  onArea:   ( a: SkiArea ) => void;
  onPlace:  ( h: SearchHit ) => void;
} ) {
  const { query, setQuery, open, setOpen } = p;
  const [places, setPlaces]                = useState<SearchHit[]>( [] );
  const [pick,   setPick  ]                = useState( 0 );
  const matches                            = useMemo( () => searchSkiAreas( p.areas, query ), [p.areas, query] );
  const items: ListItem[]                  = [
    ...matches.map( ( a ): ListItem => ( { kind: "area", a } ) ),
    ...places.map( ( h ): ListItem => ( { kind: "place", h } ) ),
    ...( query.trim().length >= 2 ? [{ kind: "more" } as ListItem] : [] ),
  ];
  useEffect( () => setPick( 0 ), [query, places] );

  /**
   * OpenStreetMap's place search ( Nominatim: one request when asked, as its rules want, not as you type )
  **/
  async function searchPlaces() {
    if ( !query.trim() ) return;
    try {
      const r = await fetch( `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent( query )}` );
      const d = ( await r.json() ) as { display_name: string; lat: string; lon: string; boundingbox?: string[] }[];
      setPlaces(
        d.map( ( h ) => ( {
          name: h.display_name,
          lat:  +h.lat,
          lon:  +h.lon,
          box:  h.boundingbox ? [+h.boundingbox[2], +h.boundingbox[0], +h.boundingbox[3], +h.boundingbox[1]] : undefined,
        } ) ),
      );
      setOpen( true );
      if ( !d.length ) useEditor.getState().toast( "No places found by that name", "info" );
    } catch ( e ) {
      useEditor.getState().toast( `Search failed: ${e}`, "error" );
    }
  }
  function choose( it: ListItem ) {
    if ( it.kind === "more" ) return void searchPlaces();
    setOpen( false );
    setPlaces( [] );
    if ( it.kind === "area" ) return p.onArea( it.a );
    setQuery( it.h.name.split( "," )[0] );
    p.onPlace( it.h );
  }

  return (
    <div className="search mtnw-search">
      <Icon name="search" size={14} />
      <input
        placeholder="Search a ski area, mountain or town"
        value={query}
        onChange={( e ) => {
          setQuery( e.target.value );
          setPlaces( [] );
          setOpen( true );
        }}
        onFocus={() => setOpen( true )}
        onKeyDown={( e ) => {
          if ( e.key === "ArrowDown" ) {
            e.preventDefault();
            setPick( ( k ) => Math.min( items.length - 1, k + 1 ) );
          } else if ( e.key === "ArrowUp" ) {
            e.preventDefault();
            setPick( ( k ) => Math.max( 0, k - 1 ) );
          } else if ( e.key === "Enter" && items[pick] ) choose( items[pick] );
          else if ( e.key === "Escape" ) setOpen( false );
        }}
        autoFocus
      />
      { open && items.length > 0 && (
        <div className="bmenu mtnw-hits" onMouseDown={( e ) => e.preventDefault()}>
          { items.map( ( it, k ) => (
            <button key={k} className={`bmenu-item ${k === pick ? "checked" : ""}`} onMouseEnter={() => setPick( k )} onClick={() => choose( it )}>
              { it.kind === "area" ? (
                <>
                  <span className="ico"><Icon name="mountain" /></span>
                  <span className="lbl">{it.a.name}</span>
                  <span className="keys">
                    {[it.a.region, it.a.country].filter( Boolean ).join( ", " )}
                    {it.a.runs ? ` · ${it.a.runs} runs` : ""}
                  </span>
                </>
              ) : it.kind === "place" ? (
                <>
                  <span className="ico"><Icon name="cursor" /></span>
                  <span className="lbl">{it.h.name}</span>
                </>
              ) : (
                <>
                  <span className="ico"><Icon name="search" /></span>
                  <span className="lbl">Search places for “{query.trim()}”</span>
                </>
              ) }
            </button>
          ) ) }
        </div>
      ) }
    </div>
  );
}
