// The Import Real Mountain sidebar: the area ( its size and centre ), its elevation data chunk by chunk, and the import's
// options ( the surroundings, runs and lifts ) with what it'll download and make.

import type { DemLevel } from "../../../geo/elevation/dem";
import { areaBox, CHUNK, type ImportArea } from "../../../geo/importMountain";
import { estimateExportBytes } from "../../../terrain/generate";
import { NumberField, Panel } from "../../widgets/controls";
import { Icon } from "../../widgets/icons";
import { Dropdown } from "../../widgets/widgets";
import { lonLatText, MAX_CHUNKS, resColor } from "./mapLook";

export function Sidebar( p: {
  area:            ImportArea | null;
  setArea:         ( a: ImportArea ) => void;
  // the chunks to import ( the area's, less those left out )
  n:               number;
  skipped:         number;
  // each kept chunk's elevation data ( null where there's none ), and the finest every one of them has
  keptLevels:      ( DemLevel | null )[] | null;
  levels:          ( DemLevel | null )[] | null;
  common:          DemLevel | null;
  // the samples a side of each chunk
  ground:          number;
  checking:        boolean;
  recheck:         () => void;
  surroundings:    number;
  setSurroundings: ( m: number ) => void;
  trails:          boolean;
  setTrails:       ( on: boolean ) => void;
} ) {
  const { area, n, common } = p;
  const box                 = area ? areaBox( area, 0 ) : null;
  const counts              = new Map<string, { color: string; n: number }>();
  for ( const l of p.keptLevels ?? [] ) {
    const k = l ? `${l.source.name} ${l.label}` : "No data";
    counts.set( k, { color: resColor( l?.res ?? null ), n: ( counts.get( k )?.n ?? 0 ) + 1 } );
  }
  if ( p.skipped ) counts.set( "Left out", { color: "#6b7280", n: p.skipped } );
  // ( fetched no finer than the detail chosen )
  const spacing    = common ? Math.max( common.res, CHUNK / ( p.ground - 1 ) ) : 0;
  const downloadMb = area && spacing ? ( area.chunksX * area.chunksZ * CHUNK * CHUNK * 4 ) / ( spacing * spacing ) / 1e6 : 0;
  const mb         = common ? estimateExportBytes( Array.from( { length: n }, () => ( { res: p.ground } ) ) ) / 1e6 : 0;
  return (
    <div className="area mtnw-side">
      <Panel icon="mountain" title={area ? `${area.chunksX} × ${area.chunksZ} km · ${n} chunk${n > 1 ? "s" : ""}` : "No area"}>
        <div className="props">
          <div className="section">Area</div>
          { area ? (
            <>
              <label>Width</label>
              <NumberField value={area.chunksX} step={1} min={1} max={MAX_CHUNKS} digits={0} unit="km" onChange={( v ) => p.setArea( { ...area, chunksX: Math.round( v ) } )} />
              <label>Length</label>
              <NumberField value={area.chunksZ} step={1} min={1} max={MAX_CHUNKS} digits={0} unit="km" onChange={( v ) => p.setArea( { ...area, chunksZ: Math.round( v ) } )} />
              <label>Centre</label>
              <span className="mtnw-value">{box && lonLatText( { lon: ( box[0] + box[2] ) / 2, lat: ( box[1] + box[3] ) / 2 } )}</span>
            </>
          ) : (
            <>
              <label />
              <span className="mtnw-value muted">Click a ski area's pin, search, or draw one on the map</span>
            </>
          ) }

          {area && <div className="section">Elevation Data</div>}
          { area && (
            <>
              <label />
              <button className="btn mtnw-refresh" disabled={p.checking} onClick={p.recheck}>
                <Icon name="refresh" size={14} className={p.checking ? "spin" : ""} /> Refresh
              </button>
              { [...counts.entries()].map( ( [k, v] ) => (
                <div key={k} className="mtnw-legend">
                  <i style={{ background: v.color }} />
                  <span className="nm">{k}</span>
                  <span className="muted">{v.n}</span>
                </div>
              ) ) }
              { p.levels && !common && (
                <div className="mtnw-legend warn">
                  <Icon name="warning" size={14} />
                  <span className="nm">Part of the area has no data: move it or make it smaller</span>
                </div>
              ) }
            </>
          ) }

          {common && <div className="section">Import</div>}
          { common && (
            <>
              <label>Source</label>
              <span className="mtnw-value wrap">{common.source.name} {common.label}</span>
              <label>Detail</label>
              <span className="mtnw-value">{( CHUNK / ( p.ground - 1 ) ).toFixed( 2 )} m</span>
              <label>Surroundings</label>
              <Dropdown
                className="wide"
                value={p.surroundings}
                menuTitle="Surroundings"
                options={[
                  { value: 0,     label: "None" },
                  { value: 4000,  label: "4 km around" },
                  { value: 8000,  label: "8 km around" },
                  { value: 15000, label: "15 km around" },
                ]}
                onChange={p.setSurroundings}
              />
              <label />
              <label className="mtnw-check">
                <input type="checkbox" checked={p.trails} onChange={( e ) => p.setTrails( e.target.checked )} /> Runs and lifts
              </label>
              <label>Download</label>
              <span className="mtnw-value">~{downloadMb < 1 ? "<1" : downloadMb.toFixed( 0 )} MB</span>
              <label>Map file</label>
              <span className="mtnw-value">~{mb.toFixed( 0 )} MB</span>
            </>
          ) }
        </div>
      </Panel>
    </div>
  );
}
