// "Import a real mountain", laid out like Blender's import file browser: a header with the search, the map as the main
// editor ( its own header for the map style and 3D, a tool column: navigate or draw an area ), the options in a sidebar
// of folding panels, the name and the Import / Cancel buttons along the bottom, and the mouse hints in the status bar.
// Drag out an area and each 1 km chunk is tinted by the best elevation data there; Import makes it a new map ( heights
// at 0.24 m from the best data all chunks share, plus runs and lifts from OpenStreetMap as snow markings ).

import type { Feature } from "geojson";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DemLevel } from "../../../geo/elevation/dem";
import { bestLevels } from "../../../geo/elevation/sources";
import { CHUNK, chunkShapes, importMountain, type ImportArea } from "../../../geo/importMountain";
import { MAP_STYLE, trailFeature } from "../../../geo/mapLayers";
import { LocalProjection } from "../../../geo/proj";
import { skiAreas, type SkiArea } from "../../../geo/skimap/skiareas";
import { skiMap } from "../../../geo/skimap/skimap";
import { keepMapChanges, openProject, realTerrainOf, untitledDir } from "../../../map/project";
import { useEditor } from "../../../map/store";
import { groundRes } from "../../../terrain/generate";
import { getEngine } from "../../Viewport";
import { Icon, type IconName } from "../../widgets/icons";
import { addMapLayers, MAX_CHUNKS, resColor, type SearchHit } from "./mapLook";
import { SearchBox } from "./SearchBox";
import { Sidebar } from "./Sidebar";
import { useAreaDrag } from "./useAreaDrag";
import { useGrowButtons } from "./useGrowButtons";

// The open dialog's map ( for the self-test's measurements ).
let openMap: maplibregl.Map | null = null;
export const mountainMap           = () => openMap;

export function MountainImportDialog( { onClose }: { onClose: () => void } ) {
  const mapEl                           = useRef<HTMLDivElement>(        null );
  const map                             = useRef<maplibregl.Map | null>( null );
  const [drawing,      setDrawing     ] = useState( false );
  const [area,         setArea        ] = useState<ImportArea | null>( null );
  const [levels,       setLevels      ] = useState<( DemLevel | null )[] | null>( null );
  const [checking,     setChecking    ] = useState( false );
  // bumped by Refresh: the elevation data asked for again
  const [recheck,      setRecheck     ] = useState( 0 );
  const [query,        setQuery       ] = useState( "" );
  const [listOpen,     setListOpen    ] = useState( false );
  const [areasAll,     setAreasAll    ] = useState<SkiArea[]>( [] );
  const [name,         setName        ] = useState( "" );
  const [trails,       setTrails      ] = useState( true );
  const [surroundings, setSurroundings] = useState( 8000 );
  const [progress,     setProgress    ] = useState<{ stage: string; f: number } | null>( null );
  // the status bar's coordinates under the mouse: written straight in ( a re-render a frame while panning cost )
  const cursorEl                        = useRef<HTMLSpanElement>( null );
  const compassEl                       = useRef<SVGSVGElement>(   null );
  const scaleBar                        = useRef<HTMLDivElement>(  null );
  const scaleText                       = useRef<HTMLSpanElement>( null );
  // chunks left out of the import ( "i,j" ), clicked off: ones with poorer data, so the rest import at better detail
  const [skip, setSkip]                 = useState<Set<string>>( new Set() );
  const abort                           = useRef<AbortController | null>( null );
  const areaRef                         = useRef<ImportArea      | null>( null );
  areaRef.current                       = area;
  const drawingRef                      = useRef( drawing );
  drawingRef.current                    = drawing;

  // the studio's own 3D view stops drawing while this covers it ( it would share the GPU with the map )
  useEffect( () => {
    getEngine()?.setPaused( "mountain import", true );
    return () => getEngine()?.setPaused( "mountain import", false );
  }, [] );

  const close = () => {
    abort.current?.abort();
    onClose();
  };
  useEffect( () => {
    const key = ( e: KeyboardEvent ) => {
      if ( e.key !== "Escape" || progress ) return;
      if ( ( e.target as HTMLElement )?.closest?.( "input" ) ) return;
      if ( listOpen ) setListOpen( false );
      else if ( drawingRef.current ) setDrawing( false );
      else close();
    };
    window.addEventListener( "keydown", key );
    return () => window.removeEventListener( "keydown", key );
  } );

  // ---------------------------------------------------------------- map setup
  useEffect( () => {
    const m = new maplibregl.Map( {
      container:          mapEl.current!,
      style:              MAP_STYLE,
      center:             [-71.88, 43.0],
      zoom:               3,
      pitch:              50,
      // credits go in the status bar, zoom / compass / scale are the studio's own ( below )
      attributionControl: false,
      // tilted further, it reaches to the horizon: far more to load and draw for every move
      maxPitch:           60,
      // the screen's full pixel density costs a lot in 3D for little gain on a map
      pixelRatio:         Math.min( window.devicePixelRatio, 1.5 ),
      // turning and tilting with the right button: a steady amount per pixel the mouse moves, across the map ( its
      // default turns by the angle swept round the map's centre, which spins fast near the middle )
      ...( { aroundCenter: false, rotateDegreesPerPixelMoved: 0.3, pitchDegreesPerPixelMoved: -0.3 } as object ),
    } );
    const follow = () => followViewRef.current();
    m.on( "move", follow );
    m.once( "load", follow );
    map.current = m;
    openMap     = m;
    m.on( "style.load", () => addOverlaysRef.current( m ) );
    return () => {
      m.remove();
      map.current = null;
      openMap     = null;
    };
  }, [] );

  /**
   * The compass needle and the scale bar, kept up with the view ( straight into the page: this runs every frame ).
  **/
  function followView() {
    const m = map.current;
    if ( !m ) return;
    if ( compassEl.current ) compassEl.current.style.transform = `rotateX(${m.getPitch() * 0.5}deg) rotateZ(${-m.getBearing()}deg)`; // ( half the tilt: fully tilted it's a sliver )
    if ( scaleBar.current && scaleText.current ) {
      // metres per pixel in the middle of the view, then the roundest length up to ~90 px
      const mpp                     = ( 40075016.686 * Math.cos( ( m.getCenter().lat * Math.PI ) / 180 ) ) / ( 512 * 2 ** m.getZoom() );
      const most                    = mpp * 90, p10 = 10 ** Math.floor( Math.log10( most ) );
      const len                     = [5, 2, 1].map( ( k ) => k * p10 ).find( ( v ) => v <= most ) ?? p10;
      scaleBar.current.style.width  = `${len / mpp}px`;
      scaleText.current.textContent = len >= 1000 ? `${len / 1000} km` : `${len} m`;
    }
  }
  const followViewRef   = useRef( followView );
  followViewRef.current = followView;

  /**
   * The map's layers ( mapLook.ts ), and their data: the ski areas' pins, the selection, the runs and lifts.
  **/
  function addOverlays( m: maplibregl.Map ) {
    addMapLayers( m );
    setAreaPinsRef.current();
    drawSelectionRef.current();
    setTrailDataRef.current();
  }
  const addOverlaysRef   = useRef( addOverlays );
  addOverlaysRef.current = addOverlays;

  // ---------------------------------------------------------------- runs and lifts on the mountains in view
  // the 1-degree cells of runs and lifts on the map now, from the world's shipped with the studio ( geo/skimap/skimap.ts )
  const trailCells = useRef( new Map<string, Feature[]>() );
  function setTrailData() {
    const src = map.current?.getSource( "trails" ) as maplibregl.GeoJSONSource | undefined;
    src?.setData( { type: "FeatureCollection", features: [...trailCells.current.values()].flat() } );
  }
  const setTrailDataRef   = useRef( setTrailData );
  setTrailDataRef.current = setTrailData;
  useEffect( () => {
    const m = map.current;
    if ( !m ) return;
    let gone   = false;
    // the cells in view ( and round it ), whenever the map stops moving; the ones well out of view let go
    const show = async () => {
      const ski = await skiMap().catch( ( e ) => {
        console.warn( "ski map:", e );
        return null;
      } );
      if ( !ski || gone ) return;
      if ( m.getZoom() < 7 ) return;
      const b     = m.getBounds();
      const want  = new Set( ski.cellsIn( [b.getWest() - 0.5, b.getSouth() - 0.5, b.getEast() + 0.5, b.getNorth() + 0.5] ).slice( 0, 64 ).map( ( [x, y] ) => `${x},${y}` ) );
      let changed = false;
      for ( const k of [...trailCells.current.keys()] ) if ( !want.has( k ) ) { trailCells.current.delete( k ); changed = true; }
      for ( const k of want ) {
        if ( trailCells.current.has( k ) ) continue;
        const [x, y] = k.split( "," ).map( Number );
        trailCells.current.set( k, ski.cell( x, y ).map( trailFeature ) );
        changed = true;
      }
      if ( changed ) setTrailData();
    };
    m.on( "moveend", show );
    void show();
    return () => {
      gone = true;
      m.off( "moveend", show );
    };
  }, [] );

  // ---------------------------------------------------------------- selection: draw or move by dragging
  useAreaDrag( { map, areaRef, drawingRef, cursorEl, setArea, setSkip, setDrawing } );

  // ---------------------------------------------------------------- coverage per chunk
  const shapes = useMemo( () => ( area ? chunkShapes( area ) : [] ), [area] );
  useEffect( () => {
    setLevels( null );
    if ( !area ) return;
    const ctl = new AbortController();
    setChecking( true );
    const t = setTimeout( () => {
      bestLevels( shapes.map( ( s ) => s.tests ), ctl.signal )
        .then( ( lv ) => !ctl.signal.aborted && setLevels( lv ) )
        .catch( ( e ) => !ctl.signal.aborted && useEditor.getState().toast( `Couldn't check elevation data: ${e}`, "error" ) )
        .finally( () => !ctl.signal.aborted && setChecking( false ) );
    }, 350 );
    return () => {
      clearTimeout( t );
      ctl.abort();
    };
  }, [shapes, area, recheck] );

  // The kept chunks' data levels ( the left-out ones don't count ).
  const keptLevels = useMemo( () => ( levels ? levels.filter( ( _, k ) => shapes[k] && !skip.has( `${shapes[k].i},${shapes[k].j}` ) ) : null ), [levels, shapes, skip] );
  // The finest level every kept chunk has ( they must all match ).
  const common     = useMemo( () => {
    if ( !keptLevels || !keptLevels.length || keptLevels.some( ( l ) => !l ) ) return null;
    return keptLevels.reduce( ( a, b ) => ( b!.res > a!.res ? b : a ) )!;
  }, [keptLevels] );
  const n      = area ? area.chunksX * area.chunksZ - skip.size : 0;
  // every chunk at the detail all maps have
  const ground = groundRes( CHUNK );
  const res    = common ? ground : null;

  function drawSelection() {
    const m   = map.current;
    const src = m?.getSource( "sel" ) as maplibregl.GeoJSONSource | undefined;
    if ( !src ) return;
    src.setData( {
      type: "FeatureCollection",
      features: shapes.map( ( s, k ) => ( {
        type:       "Feature",
        properties: skip.has( `${s.i},${s.j}` )
          ? { color: "#6b7280", opacity: 0.12, out: true }
          : { color: levels ? resColor( levels[k]?.res ?? null ) : "#4772b3", opacity: 0.32, out: false },
        geometry: { type: "Polygon", coordinates: [s.outline.map( ( p ) => [p.lon, p.lat] )] },
      } ) ),
    } );
  }
  const drawSelectionRef   = useRef( drawSelection );
  drawSelectionRef.current = drawSelection;
  useEffect( drawSelection, [shapes, levels, skip] );
  // a different size: the chunks are different ones
  useEffect( () => setSkip( new Set() ), [area?.chunksX, area?.chunksZ] );

  useGrowButtons( map, area, setArea );

  // ---------------------------------------------------------------- ski areas: pins, and the search
  useEffect( () => {
    skiAreas()
      .then( setAreasAll )
      .catch( ( e ) => console.warn( "ski areas:", e ) );
  }, [] );
  function setAreaPins() {
    const src = map.current?.getSource( "skiareas" ) as maplibregl.GeoJSONSource | undefined;
    src?.setData( {
      type:     "FeatureCollection",
      features: areasAll.map( ( a, i ) => ( { type: "Feature", properties: { i, name: a.name, runs: a.runs }, geometry: { type: "Point", coordinates: [a.lon, a.lat] } } ) ),
    } );
  }
  const setAreaPinsRef   = useRef( setAreaPins );
  setAreaPinsRef.current = setAreaPins;
  useEffect( setAreaPins, [areasAll] );
  // a pin clicked: that ski area
  const goAreaRef = useRef<( a: SkiArea ) => void>( () => {} );
  useEffect( () => {
    const m = map.current;
    if ( !m ) return;
    const click = ( e: maplibregl.MapLayerMouseEvent ) => {
      const i = e.features?.[0]?.properties?.i;
      if ( typeof i === "number" && !drawingRef.current && areasAll[i] ) goAreaRef.current( areasAll[i] );
    };
    const enter = () => ( m.getCanvas().style.cursor = "pointer" );
    const leave = () => ( m.getCanvas().style.cursor = ""        );
    m.on( "click",      "skiarea-pins", click );
    m.on( "mouseenter", "skiarea-pins", enter );
    m.on( "mouseleave", "skiarea-pins", leave );
    return () => {
      m.off( "click",      "skiarea-pins", click );
      m.off( "mouseenter", "skiarea-pins", enter );
      m.off( "mouseleave", "skiarea-pins", leave );
    };
  }, [areasAll] );

  /**
   * A place from the search: the map over it, and a starting area round it to adjust.
  **/
  function goPlace( h: SearchHit ) {
    if ( !name ) setName( h.name.split( "," )[0] );
    map.current?.flyTo( { center: [h.lon, h.lat], zoom: 13.2 } );
    setArea( { center: { lon: h.lon, lat: h.lat }, chunksX: 3, chunksZ: 3 } );
  }
  /**
   * A ski area: the map over its runs, and an area of whole chunks round them ( a little to spare ), named after it.
  **/
  function goArea( a: SkiArea ) {
    setQuery( a.name );
    setName( a.name );
    setListOpen( false );
    const [w, s, e, n] = a.box;
    const center       = { lon: ( w + e ) / 2, lat: ( s + n ) / 2 };
    const proj         = new LocalProjection( center );
    const [x0, z0]     = proj.forward( { lon: w, lat: s } ), [x1, z1] = proj.forward( { lon: e, lat: n } );
    const fit          = ( metres: number ) => Math.min( MAX_CHUNKS, Math.max( 1, Math.ceil( ( metres + 400 ) / CHUNK ) ) );
    setArea( { center, chunksX: fit( x1 - x0 ), chunksZ: fit( z1 - z0 ) } );
    map.current?.fitBounds( [[w, s], [e, n]], { padding: 140, maxZoom: 14.5, pitch: 55, duration: 1600 } );
  }
  goAreaRef.current = goArea;

  // ---------------------------------------------------------------- import
  async function doImport() {
    if ( !area || !common || !res ) return;
    const label = name.trim() || "Real mountain";
    if ( !( await keepMapChanges() ) ) return;
    const dir     = await untitledDir( label );
    abort.current = new AbortController();
    setProgress( { stage: "Starting…", f: 0 } );
    try {
      const r = await importMountain( {
        dir:   dir,
        name:  label,
        area:  { ...area, skip: [...skip] },
        level: common,
        res,
        trails,
        surroundings,
        signal:     abort.current.signal,
        onProgress: ( stage, f ) => setProgress( { stage, f } ),
      } );
      await openProject( dir );
      // the runs as trails, ready to work over ( one undo step: Ctrl+Z leaves the mountain as it came )
      if ( trails && r.trails ) {
        setProgress( { stage: "Laying trails…", f: 0 } );
        await new Promise( ( ok ) => requestAnimationFrame( () => requestAnimationFrame( ok ) ) );
        const { trailsFromRuns } = await import( "../../../trails/fromRuns" );
        await trailsFromRuns( realTerrainOf() );
      }
      const st = useEditor.getState();
      st.toast(
        `Imported ${label}: ${area.chunksX}×${area.chunksZ} km${skip.size ? ` (${n} chunks)` : ""} at ${common.label}` +
          ( trails ? `, ${r.trails} runs and lifts` : "" ) +
          ( r.filled ? ` (${r.filled} samples filled from the global data)` : "" ),
        "info",
      );
      if ( r.trailsError ) st.toast( `Runs and lifts were left out: ${r.trailsError}`, "error" );
      onClose();
    } catch ( e ) {
      if ( ( e as Error ).name !== "AbortError" ) useEditor.getState().toast( `Import failed: ${e}`, "error" );
      setProgress( null );
    }
  }

  // everyone whose data is on screen, in one line ( the status bar's right end )
  const credits = [
    "© OpenStreetMap contributors",
    "OpenMapTiles",
    "OpenFreeMap",
    "Runs and lifts: OpenSkiMap (ODbL)",
    "Terrain: Mapzen / AWS Terrain Tiles",
    ...( common && common.source.id !== "aws-terrain" ? [common.source.attribution] : [] ),
  ].join( " · " );
  const tool = ( key: string, icon: IconName, title: string, on: boolean, run: () => void ) => (
    <button key={key} className={`tool ${on ? "on" : ""}`} title={title} onClick={run}>
      <Icon name={icon} size={18} />
    </button>
  );
  const hint = ( icon: IconName, text: string ) => (
    <span className="hint-item">
      <Icon name={icon} size={14} /> {text}
    </span>
  );

  return (
    <div className="mtnw">
      {/* header: what this is, the search */}
      <div className="mtnw-top">
        <Icon name="mountain" />
        <b>Import Real Mountain</b>
        <span className="sep" />
        <SearchBox query={query} setQuery={setQuery} open={listOpen} setOpen={setListOpen} areas={areasAll} onArea={goArea} onPlace={goPlace} />
        <span className="spacer" />
        <button className="btn ghost" title="Close (Esc)" onClick={close}>
          <Icon name="close" />
        </button>
      </div>

      <div className="mtnw-body">
        {/* the map, with its own header and tool column */}
        <div className="area">
          <div className="area-header">
            <span className="editor-icon"><Icon name="view3d" /></span>

          </div>
          <div className="mtnw-map">
            <div ref={mapEl} className="mtnw-canvas" />
            <div className="tool-column">
              {tool( "nav", "cursor", "Navigate: drag to pan, drag inside the area to move it", !drawing, () => setDrawing( false ) )}
              {tool( "draw", "areaSelect", "Draw area: drag across the map", drawing, () => setDrawing( true ) )}
            </div>
            <div className="tool-column mtnw-nav">
              {tool( "in", "plus", "Zoom in", false, () => map.current?.zoomIn() )}
              {tool( "out", "minus", "Zoom out", false, () => map.current?.zoomOut() )}
              <button className="tool" title="Face north" onClick={() => map.current?.easeTo( { bearing: 0 } )}>
                <svg ref={compassEl} className="mtnw-compass" viewBox="0 0 20 20" width="22" height="22">
                  <path d="M10 1 L14 10 L6 10 Z" fill="#e5484d" />
                  <path d="M10 19 L14 10 L6 10 Z" fill="#e6e6e6" />
                </svg>
              </button>
            </div>
            <div className="mtnw-scale">
              <div ref={scaleBar} className="bar" />
              <span ref={scaleText} />
            </div>
          </div>
        </div>

        {/* the sidebar: the area, its elevation data, the options */}
        <Sidebar
          area={area}
          setArea={setArea}
          n={n}
          skipped={skip.size}
          keptLevels={keptLevels}
          levels={levels}
          common={common}
          ground={ground}
          checking={checking}
          recheck={() => setRecheck( ( k ) => k + 1 )}
          surroundings={surroundings}
          setSurroundings={setSurroundings}
          trails={trails}
          setTrails={setTrails}
        />
      </div>

      {/* the bottom bar: name, Cancel, Import */}
      <div className="mtnw-foot">
        <input className="inp mtnw-name" value={name} placeholder="Real mountain" onChange={( e ) => setName( e.target.value )} />
        <button className="btn" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={!common || !res || !!progress} onClick={doImport}>Import Real Mountain</button>
      </div>

      {/* the status bar: what the mouse does */}
      <div className="statusbar">
        <span className="hints">
          { drawing ? (
            hint( "mouseLeft", "Draw area" )
          ) : (
            <>
              {hint( "mouseLeft", area ? "Pan · move the area (drag inside it) · click a chunk to leave it out" : "Pan" )}
              {hint( "mouseRight", "Tilt and turn" )}
              {hint( "mouseMiddle", "Zoom" )}
            </>
          ) }
        </span>
        <span className="spacer" />
        <span className="stats" ref={cursorEl} />
        <span className="mtnw-credits" title={credits}>{credits}</span>
      </div>

      { progress && (
        <div className="mtn-progress">
          <div className="box">
            <div className="spinner" />
            {progress.stage}
            <div className="progress"><div style={{ width: `${Math.round( progress.f * 100 )}%` }} /></div>
            <button className="btn" style={{ marginTop: 12 }} onClick={() => { abort.current?.abort(); setProgress( null ); }}>Cancel</button>
          </div>
        </div>
      ) }
    </div>
  );
}
