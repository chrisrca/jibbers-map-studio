// The map's own settings in Properties ( nothing selected ).

import { MAP_ID_MAX, mapIdFrom } from "../../../map/mapId";
import { useEditor } from "../../../map/store";
import { mapClockHour } from "../../../viewport/render/gameSky";
import { NumberField, Panel } from "../../widgets/controls";
import { plainText } from "../../widgets/RichText";
import { MapSizeEditor } from "../MapSize";

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
        <label>Scale</label>
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
        <div className="note">Select a feature or spawn to edit it. Nothing selected shows these map settings.</div>
      </div>
    </Panel>
  );
}
