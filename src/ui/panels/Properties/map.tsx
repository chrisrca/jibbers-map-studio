// The map's own settings in Properties ( nothing selected ).

import { useEditor } from "../../../map/store";
import { mapClockHour } from "../../../viewport/render/gameSky";
import { NumberField, Panel } from "../../widgets/controls";
import { plainText } from "../../widgets/RichText";
import { MapSizeEditor } from "../MapSize";

export function MapProperties() {
  const map    = useEditor( ( s ) => s.map    );
  const setMap = useEditor( ( s ) => s.setMap );
  if ( !map ) return null;
  return (
    <Panel icon="mountain" title={plainText( map.name ) || "Map"}>
      <div className="props">
        <div className="section">Map</div>
        <label>Name</label>
        <input className="txt" key={map.id} defaultValue={map.name} onBlur={( e ) => e.target.value !== map.name && setMap( "Rename map", { name: e.target.value } )} />
        <label>Map id</label>
        <span style={{ fontSize: 11, color: "var(--muted)", wordBreak: "break-all" }}>{map.id}</span>
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
