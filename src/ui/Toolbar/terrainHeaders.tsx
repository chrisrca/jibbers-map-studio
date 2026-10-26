// Terrain Mode's headers: the Trails tool's, the Shapes tool's and the brushes', and the terrain view's overlays.

import { useState } from "react";
import { PROFILES } from "../../core/curve";
import { realTerrainOf } from "../../map/project";
import { useEditor } from "../../map/store";
import { type BrushId, brushInfo } from "../../sculpt/brushes";
import { clearMask, invertMask } from "../../sculpt/mask";
import { FALLOFFS } from "../../sculpt/tip";
import { shapeToolSettings } from "../../viewport/tools/shapeTool";
import { NumberField, Slider } from "../widgets/controls";
import { Icon } from "../widgets/icons";
import { Dropdown, NumSlider } from "../widgets/widgets";
import { showBrushSettings } from "./tools";

/**
 * The terrain view's settings ( Blender's overlay popover ): slope colours, hillshade, contour lines.
**/
export function TerrainViewPanel() {
  const v   = useEditor( ( s ) => s.terrainView );
  const set = ( p: Partial<typeof v> ) => useEditor.setState( { terrainView: { ...useEditor.getState().terrainView, ...p } } );
  const deg = ( x: number ) => `${Math.round( x )}°`;
  return (
    <div className="pop-panel">
      <label className="pop-check">
        <input type="checkbox" checked={v.slope} onChange={( e ) => set( { slope: e.target.checked } )} /> Slope Colours
      </label>
      <NumSlider label="From" value={v.slopeMin} min={0} max={60} step={1} fmt={deg} onChange={( slopeMin ) => set( { slopeMin } )} />
      <NumSlider label="To" value={v.slopeMax} min={5} max={80} step={1} fmt={deg} onChange={( slopeMax ) => set( { slopeMax } )} />
      <NumSlider label="Bands" value={v.slopeStep} min={0} max={15} step={1} fmt={( x ) => ( x ? deg( x ) : "Smooth" )} onChange={( slopeStep ) => set( { slopeStep } )} />
      <NumSlider label="Opacity" value={v.slopeOpacity} min={0.1} max={1} step={0.05} fmt={( x ) => `${Math.round( x * 100 )}%`} onChange={( slopeOpacity ) => set( { slopeOpacity } )} />
      <div className="pop-sep" />
      <NumSlider label="Hillshade" value={v.hillshade} min={0} max={1} step={0.05} fmt={( x ) => ( x ? `${Math.round( x * 100 )}%` : "Off" )} onChange={( hillshade ) => set( { hillshade } )} />
      <NumSlider label="Exaggeration" value={v.exaggeration} min={1} max={8} step={0.25} fmt={( x ) => `${x.toFixed( 2 )}×`} onChange={( exaggeration ) => set( { exaggeration } )} />
      <NumSlider label="Sun Direction" value={v.sunDir} min={0} max={359} step={1} fmt={deg} onChange={( sunDir ) => set( { sunDir } )} />
      <NumSlider label="Sun Height" value={v.sunHeight} min={5} max={85} step={1} fmt={deg} onChange={( sunHeight ) => set( { sunHeight } )} />
      <div className="pop-sep" />
      <NumSlider label="Contours" value={v.contours} min={0} max={50} step={0.5} fmt={( x ) => ( x ? `${x} m` : "Off" )} onChange={( contours ) => set( { contours } )} />
      <NumSlider label="Opacity" value={v.contourOpacity} min={0.1} max={1} step={0.05} fmt={( x ) => `${Math.round( x * 100 )}%`} onChange={( contourOpacity ) => set( { contourOpacity } )} />
    </div>
  );
}

/**
 * The real mountain's runs laid as trails ( Terrain menu ).
**/
export async function layRuns() {
  const st = useEditor.getState();
  st.setBusy( "Laying trails…" );
  await new Promise( ( r ) => requestAnimationFrame( () => requestAnimationFrame( r ) ) );
  try {
    const { trailsFromRuns } = await import( "../../trails/fromRuns" );
    const r                  = await trailsFromRuns( realTerrainOf() );
    if ( typeof r === "string" ) st.toast( r, "info" );
    else st.setTool( "trail" );
  } finally {
    st.setBusy( null );
  }
}

/**
 * The Trails tool's header.
**/
export function TrailHeader() {
  const grown = useEditor( ( s ) => !!s.trails.grow );
  return (
    <>
      <span className="tool-name"><Icon name="trail" size={14} /> Trails</span>
      <span className="spacer" />
      {!grown && <button className="btn small" title="Shape the picked runs (or all) to the ground" onClick={() => void import( "../../trails/edits" ).then( ( m ) => m.fitToGroundPicked() )}><Icon name="mountain" size={12} /> Fit to Ground</button>}
    </>
  );
}

/**
 * Shapes tool options: what a drag on the terrain draws.
**/
export function ShapeHeader() {
  const kind          = useEditor( ( s ) => s.shapeKind );
  const [set, setSet] = useState( { ...shapeToolSettings } );
  const update        = ( p: Partial<typeof set> ) => {
    Object.assign( shapeToolSettings, p );
    setSet( { ...shapeToolSettings } );
  };
  return (
    <>
      <b><Icon name={kind === "curve" ? "shapeCurve" : kind === "circle" ? "shapeCircle" : "shapeCopy"} size={14} /> {kind === "curve" ? "Curve" : kind === "circle" ? "Circle" : "Copy"}</b>
      { kind === "curve" && (
        <div className="seg">
          { Object.entries( PROFILES ).map( ( [id, p] ) => (
            <button key={id} title={p.tip} className={set.preset === id ? "on" : ""} onClick={() => update( { preset: id as typeof set.preset } )}>
              {p.label}
            </button>
          ) ) }
        </div>
      ) }
      { kind === "curve" && set.preset === "kicker" ? (
        <div className="group" title="Angle of the lip above level; the kicker's height follows from it and how long you drag it">
          <label>Lip</label>
          <div style={{ width: 70 }}>
            <NumberField value={set.lipAngle} step={1} min={0} max={60} digits={0} unit="°" onChange={( lipAngle ) => update( { lipAngle } )} />
          </div>
        </div>
      ) : kind !== "stamp" && <div className="group">
        <label>{kind === "curve" ? "Height" : "Depth"}</label>
        <div style={{ width: 70 }}>
          <NumberField value={set.height} step={0.1} onChange={( height ) => update( { height } )} />
        </div>
      </div> }
      { kind === "curve" && (
        <div className="group">
          <label>Width</label>
          <div style={{ width: 70 }}>
            <NumberField value={set.width} step={0.5} min={0.5} onChange={( width ) => update( { width } )} />
          </div>
        </div>
      ) }
      <span style={{ color: "var(--muted)" }}>
        {kind === "curve" ? "Drag along the run, from the start to the lip/end" : kind === "circle" ? "Drag from the centre out" : "Drag a box over the terrain to copy, then drag the copy's centre handle to place it"} · click a shape to edit it · Del removes
      </span>
    </>
  );
}

// What a brush's two ways are called ( Ctrl switches while held ).
type BrushDirections = Partial<Record<BrushId, [string, string]>>;

/**
 * The brush's quick settings ( everything else is in the Properties editor's Brush tab ).
**/
export function BrushHeader() {
  const sc                    = useEditor( ( s ) => s.sculpt );
  const set                   = useEditor.getState().setBrush;
  const b                     = sc.brushes[sc.brush];
  const info                  = brushInfo( sc.brush );
  const dirs: BrushDirections = {
    draw:  ["Raise", "Lower" ], layer:  ["Up",    "Down" ], clay:  ["Add",   "Carve"  ], smooth: ["Smooth", "Enhance"],
    noise: ["Add",   "Remove"], crease: ["Gully", "Ridge"], pinch: ["Pinch", "Magnify"], mask:   ["Mask",   "Erase"  ],
  };
  const dir = dirs[sc.brush];
  return (
    <>
      <b><Icon name={info.icon} size={14} /> {info.label}</b>
      { dir && (
        <div className="seg" title="Ctrl switches while held">
          <button className={!b.invert ? "on" : ""} onClick={() => set( { invert: false } )}>{dir[0]}</button>
          <button className={b.invert ? "on" : ""} onClick={() => set( { invert: true } )}>{dir[1]}</button>
        </div>
      ) }
      <Slider label="Radius" log value={sc.radius} min={0.25} max={300} step={0.05} onChange={( radius ) => useEditor.getState().setSculpt( { radius } )} fmt={( v ) => `${v < 10 ? v.toFixed( 2 ) : v.toFixed( 1 )} m`} />
      <Slider label="Strength" log value={b.strength} min={0.005} max={1} step={0.001} onChange={( strength ) => set( { strength } )} fmt={( v ) => ( v < 0.1 ? v.toFixed( 3 ) : v.toFixed( 2 ) )} />
      {sc.brush === "layer" && <Num label="Height" value={b.layerHeight} step={0.1} unit="m" onChange={( layerHeight ) => set( { layerHeight } )} />}
      {sc.brush === "clay" && <Num label="Height" value={b.clayHeight} step={0.05} unit="m" onChange={( clayHeight ) => set( { clayHeight } )} />}
      { sc.brush === "flatten" && (
        <>
          <div className="seg" title="What to flatten to">
            { ( ["start", "follow", "exact"] as const ).map( ( t ) => (
              <button key={t} className={b.flattenTarget === t ? "on" : ""} title={t === "start" ? "The height where the stroke starts" : t === "follow" ? "The height under the brush as it moves" : "An exact height (Ctrl+click picks one)"} onClick={() => set( { flattenTarget: t } )}>
                {t === "start" ? "Start" : t === "follow" ? "Follow" : "Exact"}
              </button>
            ) ) }
          </div>
          {b.flattenTarget === "exact" && <Num label="" value={b.targetHeight} step={0.1} unit="m" onChange={( targetHeight ) => set( { targetHeight } )} />}
          <div className="seg" title="Both ways, only fill hollows, or only cut bumps">
            { ( ["both", "raise", "lower"] as const ).map( ( t ) => (
              <button key={t} className={b.flattenDir === t ? "on" : ""} onClick={() => set( { flattenDir: t } )}>{t === "both" ? "Flatten" : t === "raise" ? "Fill" : "Scrape"}</button>
            ) ) }
          </div>
          <label className="check" title="Flatten along the slope of the ground instead of level"><input type="checkbox" checked={b.flattenSlope} onChange={( e ) => set( { flattenSlope: e.target.checked } )} /> Keep slope</label>
        </>
      ) }
      {sc.brush === "terrace" && <Num label="Step" value={b.terraceStep} step={0.25} unit="m" onChange={( terraceStep ) => set( { terraceStep } )} />}
      { sc.brush === "noise" && (
        <>
          <Num label="Size" value={b.noiseScale} step={0.5} unit="m" onChange={( noiseScale ) => set( { noiseScale } )} />
          <Num label="Height" value={b.noiseHeight} step={0.1} unit="m" onChange={( noiseHeight ) => set( { noiseHeight } )} />
        </>
      ) }
      { sc.brush === "mask" && (
        <>
          <button className="btn small" onClick={invertMask}>Invert</button>
          <button className="btn small" onClick={clearMask}>Clear</button>
        </>
      ) }
      <div className="group">
        <label>Falloff</label>
        <Dropdown
          value={b.falloff}
          menuTitle="Falloff"
          options={[...Object.entries( FALLOFFS ).map( ( [id, f] ) => ( { value: id as typeof b.falloff, label: f.label } ) ), { value: "custom" as typeof b.falloff, label: "Custom curve" }]}
          onChange={( falloff ) => set( { falloff } )}
        />
      </div>
      <button className="bdrop" title="All of this brush's settings: tip, stroke, symmetry, filters" onClick={showBrushSettings}>Brush <Icon name="chevronDown" size={12} className="chev" /></button>
    </>
  );
}

function Num( { label, value, onChange, step, unit }: { label: string; value: number; onChange: ( v: number ) => void; step: number; unit?: string } ) {
  return (
    <div className="group" style={{ width: label ? 130 : 84 }}>
      <NumberField label={label || undefined} value={value} step={step} unit={unit} onChange={onChange} />
    </div>
  );
}
