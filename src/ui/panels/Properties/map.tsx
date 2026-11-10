// The map's own settings in Properties ( nothing selected ).

import { MAP_ID_MAX, mapIdFrom } from "../../../map/mapId";
import { useEditor } from "../../../map/store";
import { mapClockHour } from "../../../viewport/render/gameSky";
import { NumberField, Panel, Slider } from "../../widgets/controls";
import { plainText } from "../../widgets/RichText";
import { MapSizeEditor } from "../MapSize";
import { useRef, useState } from "react";
import { isScenery, SCENERY_ROCK_ANGLE } from "../../../core/types";
import { landOf } from "../../../geo/land";
import { buildSurroundings, removeSurroundings, surroundingsLook, type SurroundingsLook } from "../../../geo/landGround";
import { CurveEditor } from "../../widgets/CurveEditor";

export function MapProperties() {
  const map    = useEditor( ( s ) => s.map    );
  const setMap = useEditor( ( s ) => s.setMap );
  if ( !map ) return null;
  // ( what can't be in an id becomes what can: "Ruka Park" → "ruka-park" )
  const setMapId = ( text: string, field?: HTMLInputElement ) => {
    const id = mapIdFrom( text );
    if ( field ) field.value = id || map.id;
    if ( id && id !== map.id ) setMap( "Map id", { id } );
  };
  return (
    <Panel icon="mountain" title={plainText( map.name ) || "Map"}>
      <div className="props">
        <div className="section">Map</div>
        <label>Name</label>
        <input className="txt" key={map.id} defaultValue={map.name} onBlur={( e ) => e.target.value !== map.name && setMap( "Rename map", { name: e.target.value } )} />
        <label>Map id</label>
        <div style={{ display: "flex", gap: 4 }}>
          <input
            className="txt"
            key={`i${map.id}`}
            defaultValue={map.id}
            maxLength={MAP_ID_MAX}
            spellCheck={false}
            title="The map's file name in the game"
            onBlur={( e ) => setMapId( e.target.value, e.target )}
            onKeyDown={( e ) => e.key === "Enter" && ( e.target as HTMLInputElement ).blur()}
          />
          <button className="btn small" title="Make the id from the map's name" disabled={!mapIdFrom( map.name ) || mapIdFrom( map.name ) === map.id} onClick={() => setMapId( map.name )}>
            From name
          </button>
        </div>
        <label>Author</label>
        <input className="txt" key={`a${map.id}`} defaultValue={map.author ?? ""} onBlur={( e ) => e.target.value !== ( map.author ?? "" ) && setMap( "Author", { author: e.target.value } )} />
        <label>Map version</label>
        <input className="txt" key={`v${map.id}`} defaultValue={map.modVersion ?? "1.0"} onBlur={( e ) => e.target.value !== ( map.modVersion ?? "1.0" ) && setMap( "Map version", { modVersion: e.target.value } )} />
        <label title="The whole map scaled by this in the game">World scale</label>
        <NumberField value={map.scale ?? 1} step={0.05} digits={2} min={0.1} max={3} onChange={( v ) => setMap( "Map scale", { scale: v } )} />
        <label>Mountains</label>
        <label style={{ color: "var(--text)" }}>
          <input type="checkbox" checked={map.allowBackgroundMountains} onChange={( e ) => setMap( "Background mountains", { allowBackgroundMountains: e.target.checked } )} /> Show background mountains
        </label>
        <div className="section">Time of day</div>
        <label>Override</label>
        <label style={{ color: "var(--text)" }}>
          <input type="checkbox" checked={map.overrideTime} onChange={( e ) => setMap( "Override time", { overrideTime: e.target.checked } )} /> Fixed time
        </label>
        <label>Hour</label>
        <NumberField value={mapClockHour( map )} step={0.25} min={0} max={24} onChange={( v ) => setMap( "Time of day", { dayTimeHours: v } )} />
        <label>Sun angle</label>
        <NumberField value={map.sunAngle} step={1} digits={0} unit="°" onChange={( v ) => setMap( "Sun angle", { sunAngle: v } )} />
        <div className="section">Map size</div>
        <div style={{ gridColumn: "1 / -1" }}>
          <MapSizeEditor />
        </div>
        <SurroundingsRows />
      </div>
    </Panel>
  );
}

/**
 * The land round the map as scenery ( geo/scenery ): on or off, how far out it reaches and how far its far edge drops
 * away ( built again as any changes, and whenever the map's ground does: Map Size ). The
 * real land round a real mountain; round a made-up map, land made up to match it.
**/
function SurroundingsRows() {
  const sc                = useEditor( ( s ) => s.customObjects.find( isScenery ) );
  const [look,  setLook ] = useState( surroundingsLook );
  // ( the look as it is now, for what's let go: a curve's drag ends with the handlers it began with, which saw the look
  // from before it, and built that, putting the curve back )
  const latest            = useRef( look );
  latest.current          = look;
  const [angle, setAngle] = useState( () => sc?.scenery?.rockAngle ?? SCENERY_ROCK_ANGLE );
  const timer             = useRef<ReturnType<typeof setTimeout> | null>( null );
  const land              = landOf();
  if ( !land ) return null;
  const build = async ( change: Partial<SurroundingsLook>, rocks = angle ) => {
    const st = useEditor.getState();
    try {
      st.setBusy( "Building the surroundings…" );
      await buildSurroundings( change, ( stage, f ) => st.setBusy( stage, f ), undefined, rocks );
    } catch ( e ) {
      st.toast( `Couldn't build the surroundings: ${e instanceof Error ? e.message : e}`, "error" );
    } finally {
      st.setBusy( null );
    }
  };
  // ( built again once it's let be a moment, not on every step of a drag; a button's pick at once )
  const change = ( p: Partial<SurroundingsLook>, now = false, rocks = angle ) => {
    const next = { ...latest.current, ...p };
    latest.current = next;
    setLook( next );
    if ( timer.current ) clearTimeout( timer.current );
    timer.current = setTimeout( () => void build( next, rocks ), now ? 0 : 600 );
  };
  return (
    <>
      <div className="section">Surroundings</div>
      <label />
      <label className="check"><input type="checkbox" checked={!!sc} onChange={( e ) => ( e.target.checked ? void build( look ) : removeSurroundings() )} /> Show surroundings</label>
      { sc && (
        <>
          <label />
          <Slider label="Distance" value={look.radius / 1000} min={1} max={20} step={1} fmt={( v ) => `${v.toFixed( 0 )} km`} onChange={( v ) => change( { radius: v * 1000 } )} />
          <label />
          <Slider label="Rocks from" value={angle} min={5} max={60} step={1} fmt={( v ) => `${Math.round( v )}°`} onChange={( v ) => { setAngle( v ); change( {}, false, v ); }} />
          <label title="Vertex spacing from the map's edge out: 1 m at the top, 200 m at the bottom">Detail</label>
          <div>
            <CurveEditor value={look.detail} min={0} max={1} label={["map edge", "far edge"]} onChange={( detail ) => { latest.current = { ...latest.current, detail }; setLook( latest.current ); }} onCommit={() => change( {} )} />
          </div>
        </>
      ) }
    </>
  );
}
