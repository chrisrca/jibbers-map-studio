// The map's own settings in Properties ( nothing selected ).

import { MAP_ID_MAX, mapIdFrom } from "../../../map/mapId";
import { useEditor } from "../../../map/store";
import { mapClockHour } from "../../../viewport/render/gameSky";
import { NumberField, Panel, Slider } from "../../widgets/controls";
import { plainText } from "../../widgets/RichText";
import { MapSizeEditor } from "../MapSize";
import { useRef, useState } from "react";
import { isScenery } from "../../../core/types";
import { landOf } from "../../../geo/land";
import { buildSurroundings, removeSurroundings } from "../../../geo/landGround";

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
 * The land round the map as scenery ( geo/scenery ): on or off, and how far out it reaches ( built again as that
 * changes, and whenever the map's ground does: Map Size ). The real land round a real mountain; round a made-up map,
 * land made up to match it.
**/
function SurroundingsRows() {
  const sc          = useEditor( ( s ) => s.customObjects.find( isScenery ) );
  const [km, setKm] = useState( ( sc?.scenery?.radius ?? 8000 ) / 1000 );
  const timer       = useRef<ReturnType<typeof setTimeout> | null>( null );
  const land        = landOf();
  if ( !land ) return null;
  const build = async ( reach: number ) => {
    const st = useEditor.getState();
    try {
      st.setBusy( "Building the surroundings…" );
      await buildSurroundings( reach * 1000, ( stage, f ) => st.setBusy( `${stage} ${Math.round( f * 100 )}%` ) );
    } catch ( e ) {
      st.toast( `Couldn't build the surroundings: ${e instanceof Error ? e.message : e}`, "error" );
    } finally {
      st.setBusy( null );
    }
  };
  return (
    <>
      <div className="section">Surroundings</div>
      <label />
      <label className="check"><input type="checkbox" checked={!!sc} onChange={( e ) => ( e.target.checked ? void build( km ) : removeSurroundings() )} /> Show surroundings</label>
      { sc && (
        <>
          <label />
          <Slider
            label="Reach"
            value={km}
            min={1}
            max={20}
            step={1}
            fmt={( v ) => `${v.toFixed( 0 )} km`}
            onChange={( v ) => {
              setKm( v );
              // ( built again once it's let be a moment, not on every step of a drag )
              if ( timer.current ) clearTimeout( timer.current );
              timer.current = setTimeout( () => void build( v ), 600 );
            }}
          />
        </>
      ) }
    </>
  );
}
