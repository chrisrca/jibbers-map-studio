// Properties editor › Brush: every setting of the current sculpt brush, plus the settings all brushes share
// ( stroke stabilizer, pen pressure, symmetry, "affect only" filters, the mask ).

import { useMemo, type ReactNode } from "react";
import { useEditor } from "../../map/store";
import { BRUSHES, brushInfo, defaultSettings, type AlphaId, type BrushSettings, type StrokeMethod } from "../../sculpt/brushes";
import { clearMask, invertMask, maskBy } from "../../sculpt/mask";
import { ALPHA_N, ALPHAS, alphaGrid, FALLOFFS, falloffAt } from "../../sculpt/tip";
import { NumberField, Panel } from "../widgets/controls";
import { CurveEditor } from "../widgets/CurveEditor";
import { getEngine } from "../Viewport";
import { Dropdown, NumSlider } from "../widgets/widgets";

function Field( { label, tip, children }: { label: string; tip?: string; children: ReactNode } ) {
  return (
    <>
      <label title={tip}>{label}</label>
      <div title={tip}>{children}</div>
    </>
  );
}

function Seg<T extends string>( { value, options, onChange }: { value: T; options: [T, string, string?][]; onChange: ( v: T ) => void } ) {
  return (
    <div className="seg wrap">
      { options.map( ( [id, label, tip] ) => (
        <button key={id} title={tip} className={value === id ? "on" : ""} onClick={() => onChange( id )}>
          {label}
        </button>
      ) ) }
    </div>
  );
}

const Check = ( { value, onChange, label }: { value: boolean; onChange: ( v: boolean ) => void; label: string } ) => (
  <label className="check">
    <input type="checkbox" checked={value} onChange={( e ) => onChange( e.target.checked )} /> {label}
  </label>
);

const STROKES: [StrokeMethod, string, string][] = [
  ["space",    "Space",    "Dabs evenly spaced along the stroke"                         ],
  ["airbrush", "Airbrush", "Keeps applying while held still"                             ],
  ["line",     "Line",     "Drag a straight line; it's applied along it (live preview)"  ],
  ["anchored", "Anchored", "One dab where you click; drag to size it (great with alphas)"],
  ["dragdot",  "Drag dot", "One dab you drag around to place"                            ],
];

/**
 * A small picture of the falloff, centre at the left, rim at the right.
**/
function FalloffGraph( { b }: { b: BrushSettings } ) {
  const pts = Array.from( { length: 41 }, ( _, k ) => {
    const t = k / 40;
    return `${( t * 160 ).toFixed( 1 )},${( 44 - falloffAt( t, b.falloff, b.hardness, b.curve ) * 40 ).toFixed( 1 )}`;
  } ).join( " " );
  return (
    <svg width="100%" height="48" viewBox="0 0 160 48" preserveAspectRatio="none" style={{ background: "var(--bg2)", borderRadius: 4 }}>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const alphaUrls = new Map<AlphaId, string>();
function alphaUrl( id: AlphaId ) {
  let u = alphaUrls.get( id );
  if ( u ) return u;
  const g   = alphaGrid( id );
  const c   = document.createElement( "canvas" );
  c.width   = c.height = ALPHA_N;
  const ctx = c.getContext( "2d" )!;
  const img = ctx.createImageData( ALPHA_N, ALPHA_N );
  for ( let k = 0; k < ALPHA_N * ALPHA_N; k++ ) {
    const v = g ? Math.round( g[k] * 255 ) : Math.round( Math.max( 0, 1 - Math.hypot( ( k % ALPHA_N ) / ( ALPHA_N / 2 ) - 1, Math.floor( k / ALPHA_N ) / ( ALPHA_N / 2 ) - 1 ) ) * 255 );
    img.data.set( [v, v, v, 255], k * 4 );
  }
  ctx.putImageData( img, 0, 0 );
  u = c.toDataURL();
  alphaUrls.set( id, u );
  return u;
}

export function BrushProperties() {
  const sc    = useEditor( ( s ) => s.sculpt );
  const st    = useEditor.getState();
  const set   = st.setBrush;
  const setSc = st.setSculpt;
  const b     = sc.brushes[sc.brush];
  const info  = brushInfo( sc.brush );
  // 0–1 settings are Blender sliders ( filled to the value ); the rest are number fields
  const num   = ( v: number, onChange: ( v: number ) => void, step: number, min?: number, max?: number, digits = 2, unit?: string ) =>
    min !== undefined && max !== undefined && max - min <= 1.0001 ? (
      <NumSlider value={v} min={min} max={max} digits={digits} onChange={onChange} />
    ) : (
      <NumberField value={v} step={step} min={min} max={max} digits={digits} unit={unit} onChange={onChange} />
    );
  const alphaIds = useMemo( () => ["none", ...Object.keys( ALPHAS )] as AlphaId[], [] );

  return (
    <Panel icon={info.icon} title={`Brush · ${info.label}`} extra={<button className="btn ghost small" title="Put this brush's settings back to how they started" onClick={() => set( defaultSettings( sc.brush ) )}>Reset</button>}>
      <div className="props">
        <div className="section">Brush</div>
        <Field label="Brush">
          <Dropdown value={sc.brush} menuTitle="Brush" options={BRUSHES.map( ( x ) => ( { value: x.id, label: `${x.group} › ${x.label}`, icon: x.icon } ) )} onChange={( brush ) => setSc( { brush } )} />
        </Field>
        <Field label="Radius" tip="Shared by all brushes · [ ] or F">{num( sc.radius, ( radius ) => setSc( { radius } ), 0.1, 0.25, 500 )}</Field>
        <Field label="Strength" tip="Shift+F">{num( b.strength, ( strength ) => set( { strength } ), 0.01, 0.001, 1, 3 )}</Field>
        {info.ctrl && <Field label="Direction"><Check value={b.invert} onChange={( invert ) => set( { invert } )} label={`Invert (${info.ctrl})`} /></Field>}
        {sc.brush === "layer" && <Field label="Height" tip="Metres above the ground as it was when the stroke started">{num( b.layerHeight, ( layerHeight ) => set( { layerHeight } ), 0.1, 0 )}</Field>}
        {sc.brush === "clay" && <Field label="Clay height" tip="How far above the ground under the brush the clay builds">{num( b.clayHeight, ( clayHeight ) => set( { clayHeight } ), 0.05, 0 )}</Field>}
        { sc.brush === "smooth" && (
          <Field label="Feature size" tip="Size of the bumps it works on, as a fraction of the radius">{num( b.featureSize, ( featureSize ) => set( { featureSize } ), 0.01, 0.02, 1 )}</Field>
        ) }
        { sc.brush === "flatten" && (
          <>
            <Field label="Flatten to">
              <Seg value={b.flattenTarget} onChange={( flattenTarget ) => set( { flattenTarget } )} options={[["start", "Start", "The height where the stroke starts"], ["follow", "Follow", "The height under the brush as it moves"], ["exact", "Exact", "An exact height (Ctrl+click on the ground picks it)"]]} />
            </Field>
            {b.flattenTarget === "exact" && <Field label="Height">{num( b.targetHeight, ( targetHeight ) => set( { targetHeight } ), 0.1 )}</Field>}
            <Field label="Mode">
              <Seg value={b.flattenDir} onChange={( flattenDir ) => set( { flattenDir } )} options={[["both", "Flatten"], ["raise", "Fill", "Only raises hollows"], ["lower", "Scrape", "Only cuts bumps down"]]} />
            </Field>
            <Field label=""><Check value={b.flattenSlope} onChange={( flattenSlope ) => set( { flattenSlope } )} label="Keep the slope (Slope Flatten)" /></Field>
          </>
        ) }
        { sc.brush === "terrace" && (
          <>
            <Field label="Step">{num( b.terraceStep, ( terraceStep ) => set( { terraceStep } ), 0.25, 0.05 )}</Field>
            <Field label="Sharpness" tip="0 = gentle steps, 1 = sharp risers">{num( b.terraceSharpness, ( terraceSharpness ) => set( { terraceSharpness } ), 0.01, 0, 1 )}</Field>
            <Field label="Offset" tip="Shifts the steps up or down">{num( b.terraceOffset, ( terraceOffset ) => set( { terraceOffset } ), 0.1 )}</Field>
          </>
        ) }
        { sc.brush === "noise" && (
          <>
            <Field label="Type">
              <Seg value={b.noiseType} onChange={( noiseType ) => set( { noiseType } )} options={[["smooth", "Smooth"], ["ridged", "Ridged"], ["billow", "Billow"]]} />
            </Field>
            <Field label="Size">{num( b.noiseScale, ( noiseScale ) => set( { noiseScale } ), 0.5, 0.5 )}</Field>
            <Field label="Height">{num( b.noiseHeight, ( noiseHeight ) => set( { noiseHeight } ), 0.1, 0 )}</Field>
            <Field label="Detail" tip="Octaves: more = more small detail">{num( b.noiseOctaves, ( noiseOctaves ) => set( { noiseOctaves: Math.round( noiseOctaves ) } ), 1, 1, 8, 0 )}</Field>
          </>
        ) }
        {sc.brush === "crease" && <Field label="Pinch" tip="How much the sides are pulled in">{num( b.pinch, ( pinch ) => set( { pinch } ), 0.01, 0, 1 )}</Field>}

        <div className="section">Falloff</div>
        <Field label="Curve">
          <Dropdown
            value={b.falloff}
            menuTitle="Falloff"
            options={[...Object.entries( FALLOFFS ).map( ( [id, f] ) => ( { value: id as typeof b.falloff, label: f.label } ) ), { value: "custom" as typeof b.falloff, label: "Custom" }]}
            onChange={( falloff ) => set( { falloff } )}
          />
        </Field>
        {b.falloff !== "custom" && <Field label="Hardness" tip="How much of the radius is at full strength">{num( b.hardness, ( hardness ) => set( { hardness } ), 0.01, 0, 1 )}</Field>}
        <div style={{ gridColumn: "1 / -1" }}>
          { b.falloff === "custom" ? (
            <CurveEditor value={b.curve} min={0} max={1} label={["centre", "edge"]} onChange={( curve ) => set( { curve } )} onCommit={() => {}} />
          ) : (
            <FalloffGraph b={b} />
          ) }
        </div>

        <div className="section">Tip</div>
        <Field label="Roundness" tip="1 = round, 0 = square (Clay Strips)">{num( b.roundness, ( roundness ) => set( { roundness } ), 0.01, 0, 1 )}</Field>
        <div style={{ gridColumn: "1 / -1" }} className="alpha-grid">
          { alphaIds.map( ( id ) => (
            <button key={id} className={b.alpha === id ? "on" : ""} title={id === "none" ? "No alpha: just the falloff" : `${ALPHAS[id as Exclude<AlphaId, "none">].label}: ${ALPHAS[id as Exclude<AlphaId, "none">].tip}`} onClick={() => set( { alpha: id } )}>
              <img src={alphaUrl( id )} alt="" />
              <span>{id === "none" ? "None" : ALPHAS[id as Exclude<AlphaId, "none">].label}</span>
            </button>
          ) ) }
        </div>
        <Field label="Rotation">{num( b.rotation, ( rotation ) => set( { rotation } ), 1, -360, 360, 0, "°" )}</Field>
        <Field label=""><Check value={b.rotationFollow} onChange={( rotationFollow ) => set( { rotationFollow } )} label="Follow the stroke" /></Field>
        <Field label="Rotation jitter">{num( b.rotationJitter, ( rotationJitter ) => set( { rotationJitter } ), 0.01, 0, 1 )}</Field>

        <div className="section">Stroke</div>
        <Field label="Method">
          <Dropdown value={b.stroke} menuTitle="Stroke method" options={STROKES.map( ( [id, label, tip] ) => ( { value: id as StrokeMethod, label, title: tip } ) )} onChange={( stroke ) => set( { stroke } )} />
        </Field>
        <div className="note">{STROKES.find( ( [id] ) => id === b.stroke )?.[2]}</div>
        { ( b.stroke === "space" || b.stroke === "airbrush" || b.stroke === "line" ) && (
          <Field label="Spacing" tip="Between dabs, as a fraction of the radius (strength is adjusted to match)">{num( b.spacing, ( spacing ) => set( { spacing } ), 0.01, 0.02, 2 )}</Field>
        ) }
        {b.stroke === "airbrush" && <Field label="Rate" tip="Dabs per second while held still">{num( b.rate, ( rate ) => set( { rate } ), 1, 1, 60, 0 )}</Field>}
        <Field label="Stabilize" tip="Lazy mouse: the brush trails the cursor by this much of its radius, smoothing the stroke (all brushes)">{num( sc.stabilize, ( stabilize ) => setSc( { stabilize } ), 0.05, 0, 5 )}</Field>
        <Field label="Jitter" tip="Random offset of each dab">{num( b.jitter, ( jitter ) => set( { jitter } ), 0.01, 0, 2 )}</Field>
        <Field label="Size jitter">{num( b.sizeJitter, ( sizeJitter ) => set( { sizeJitter } ), 0.01, 0, 1 )}</Field>
        <Field label="Strength jitter">{num( b.strengthJitter, ( strengthJitter ) => set( { strengthJitter } ), 0.01, 0, 1 )}</Field>
        <Field label="Pen pressure" tip="With a drawing tablet (all brushes)">
          <div style={{ display: "flex", gap: 10 }}>
            <Check value={sc.pressureSize} onChange={( pressureSize ) => setSc( { pressureSize } )} label="Size" />
            <Check value={sc.pressureStrength} onChange={( pressureStrength ) => setSc( { pressureStrength } )} label="Strength" />
          </div>
        </Field>

        <div className="section">Symmetry</div>
        <Field label="Mirror">
          <div style={{ display: "flex", gap: 10 }}>
            <Check value={sc.symmetry.x} onChange={( x ) => setSc( { symmetry: { ...sc.symmetry, x } } )} label="Left ↔ right" />
            <Check value={sc.symmetry.z} onChange={( z ) => setSc( { symmetry: { ...sc.symmetry, z } } )} label="Front ↔ back" />
          </div>
        </Field>
        <Field label="Radial" tip="Copies around the centre (1 = off)">{num( sc.symmetry.radial, ( radial ) => setSc( { symmetry: { ...sc.symmetry, radial: Math.round( radial ) } } ), 1, 1, 12, 0 )}</Field>
        <Field label="Centre">
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span className="muted">{sc.symmetry.pivot ? `${sc.symmetry.pivot[0].toFixed( 1 )}, ${sc.symmetry.pivot[1].toFixed( 1 )}` : "map centre"}</span>
            <button className="btn small" title="The ground in the middle of the view" onClick={() => { const p = getEngine()?.groundAtViewCentre(); if ( p ) setSc( { symmetry: { ...sc.symmetry, pivot: p } } ); }}>View centre</button>
            {sc.symmetry.pivot && <button className="btn small" onClick={() => setSc( { symmetry: { ...sc.symmetry, pivot: null } } )}>Map centre</button>}
          </div>
        </Field>

        <div className="section">Affect only</div>
        <Field label="Height" tip="Only ground between these heights (all brushes)">
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={sc.filters.height.on} onChange={( e ) => setSc( { filters: { ...sc.filters, height: { ...sc.filters.height, on: e.target.checked } } } )} />
            {num( sc.filters.height.min, ( min ) => setSc( { filters: { ...sc.filters, height: { ...sc.filters.height, min } } } ), 0.5 )}
            <span className="muted">to</span>
            {num( sc.filters.height.max, ( max ) => setSc( { filters: { ...sc.filters, height: { ...sc.filters.height, max } } } ), 0.5 )}
          </div>
        </Field>
        <Field label="Slope" tip="Only ground this steep, in degrees (all brushes)">
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={sc.filters.slope.on} onChange={( e ) => setSc( { filters: { ...sc.filters, slope: { ...sc.filters.slope, on: e.target.checked } } } )} />
            {num( sc.filters.slope.min, ( min ) => setSc( { filters: { ...sc.filters, slope: { ...sc.filters.slope, min } } } ), 1, 0, 90, 0, "°" )}
            <span className="muted">to</span>
            {num( sc.filters.slope.max, ( max ) => setSc( { filters: { ...sc.filters, slope: { ...sc.filters.slope, max } } } ), 1, 0, 90, 0, "°" )}
          </div>
        </Field>
        <Field label="Shape" tip="Only hollows (concave) or only bumps (convex)">
          <Seg value={sc.filters.cavity} onChange={( cavity ) => setSc( { filters: { ...sc.filters, cavity } } )} options={[["all", "All"], ["concave", "Hollows"], ["convex", "Bumps"]]} />
        </Field>

        <div className="section">Mask</div>
        <div className="note">Masked ground (darker) isn't touched by any brush. Paint it with the Mask brush (0); Ctrl erases. Not saved with the map.</div>
        <Field label=""><Check value={sc.showMask} onChange={( showMask ) => setSc( { showMask } )} label="Show the mask" /></Field>
        <Field label="">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn small" onClick={invertMask}>Invert</button>
            <button className="btn small" onClick={clearMask}>Clear</button>
            <button className="btn small" title="Mask ground in the Affect-only slope range" onClick={() => maskBy( "slope", sc.filters.slope.min, sc.filters.slope.max )}>By slope range</button>
            <button className="btn small" title="Mask ground in the Affect-only height range" onClick={() => maskBy( "height", sc.filters.height.min, sc.filters.height.max )}>By height range</button>
          </div>
        </Field>
      </div>
    </Panel>
  );
}
