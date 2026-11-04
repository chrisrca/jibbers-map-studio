// Properties for a selected terrain shape. Every change applies live; the edit becomes one undo step when a field
// or curve point is let go.

import { CROSS_SECTIONS, PROFILES, RADIALS, type Curve } from "../../core/curve";
import { commitShape, deleteShape, liveShape } from "../../terrain/shapes/edits";
import { groundWithout, kickerHeight, lipAngleFor, type CircleShape, type CurveShape, type EdgeMode, type FormationShape, type Shape, type StampShape } from "../../terrain/shapes/shapes";
import { terrain } from "../../terrain/terrain";
import { NumberField, Panel } from "../widgets/controls";
import { CurveEditor } from "../widgets/CurveEditor";

const ground = ( p: [number, number] ) => {
  const h = terrain.heightAt( p[0], p[1] );
  return Number.isNaN( h ) ? 0 : h;
};

function Field( { label, children, tip }: { label: string; children: React.ReactNode; tip?: string } ) {
  return (
    <>
      <label title={tip}>{label}</label>
      <div>{children}</div>
    </>
  );
}

function Num( p: { value: number; onChange: ( v: number ) => void; step?: number; min?: number; max?: number; digits?: number; unit?: string } ) {
  return <NumberField {...p} onCommit={commitShape} />;
}

function Presets<T extends string>( { items, onPick }: { items: Record<T, { label: string; curve: Curve }>; onPick: ( c: Curve, id: T ) => void } ) {
  return (
    <div className="seg wrap">
      { ( Object.keys( items ) as T[] ).map( ( id ) => (
        <button key={id} onClick={() => { onPick( structuredClone( items[id].curve ), id ); commitShape(); }}>
          {items[id].label}
        </button>
      ) ) }
    </div>
  );
}

/**
 * A height that's either "the ground there" ( null ) or a fixed value.
**/
function HeightField( { value, at, onChange }: { value: number | null; at: [number, number]; onChange: ( v: number | null ) => void } ) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <label style={{ color: "var(--text)", whiteSpace: "nowrap" }}>
        <input type="checkbox" checked={value === null} onChange={( e ) => { onChange( e.target.checked ? null : ground( at ) ); commitShape(); }} /> Ground
      </label>
      {value !== null && <Num value={value} step={0.1} onChange={onChange} />}
    </div>
  );
}

export function ShapeProperties( { s }: { s: Shape } ) {
  if ( s.kind === "curve" ) return <CurveProps s={s} />;
  if ( s.kind === "stamp" ) return <StampProps s={s} />;
  if ( s.kind === "formation" ) return <FormationProps s={s} />;
  return <CircleProps s={s} />;
}

// A formation's ways of meeting the ground and its noise's.
const BLENDS: [FormationShape["mode"], string, string][] = [
  ["add",   "Add",   "On top of the ground"],
  ["raise", "Raise", "Keeps whichever is higher: the formation grows out of the ground"],
  ["carve", "Carve", "Keeps whichever is lower: the formation digs into it"],
  ["set",   "Set",   "The formation's height, from the ground round its outline"],
];
const STYLES: [FormationShape["style"], string][] = [["smooth", "Smooth"], ["ridged", "Ridged"], ["billow", "Billow"]];

function FormationProps( { s }: { s: FormationShape } ) {
  const set  = ( p: Partial<FormationShape> ) => liveShape( { ...s, ...p } );
  const th   = ( p: Partial<FormationShape["thermal"]> ) => set( { thermal: { ...s.thermal, ...p } } );
  const hy   = ( p: Partial<FormationShape["hydraulic"]> ) => set( { hydraulic: { ...s.hydraulic, ...p } } );
  const num  = ( label: string, value: number, onChange: ( v: number ) => void, step: number, min: number, max: number, unit?: string, digits = 2 ) => (
    <Field label={label}><Num value={value} step={step} min={min} max={max} unit={unit} digits={digits} onChange={onChange} /></Field>
  );
  const on   = ( value: boolean, onChange: ( v: boolean ) => void, label: string ) => (
    <>
      <label />
      <label style={{ color: "var(--text)" }}><input type="checkbox" checked={value} onChange={( e ) => { onChange( e.target.checked ); commitShape(); }} /> {label}</label>
    </>
  );
  return (
    <Panel icon="shapeCurve" title={`Shape · ${s.name}`}>
      <div className="props">
        <div className="section">Formation</div>
        <Field label="Name">
          <input className="txt" key={s.uid} defaultValue={s.name} onBlur={( e ) => { set( { name: e.target.value } ); commitShape(); }} />
        </Field>
        <Field label="Mode">
          <div className="seg">{BLENDS.map( ( [id, label, tip] ) => <button key={id} title={tip} className={s.mode === id ? "on" : ""} onClick={() => { set( { mode: id } ); commitShape(); }}>{label}</button> )}</div>
        </Field>
        <Field label="Style">
          <div className="seg">{STYLES.map( ( [id, label] ) => <button key={id} className={s.style === id ? "on" : ""} onClick={() => { set( { style: id } ); commitShape(); }}>{label}</button> )}</div>
        </Field>
        {num( "Height",       s.height,      ( height ) => set( { height } ),           0.5, -500, 1000, "m" )}
        {num( "Base Y",       s.baseY,       ( baseY ) => set( { baseY } ),             0.5, -500, 500,  "m" )}
        {num( "Feature size", s.featureSize, ( featureSize ) => set( { featureSize } ), 1,   2,    2000, "m" )}
        {num( "Roughness",    s.roughness,   ( roughness ) => set( { roughness } ),     0.5, 0,    500,  "m" )}
        {num( "Detail",       s.detail,      ( detail ) => set( { detail: Math.round( detail ) } ), 1, 1, 8, undefined, 0 )}
        {num( "Edge blend",   s.edgeBlend,   ( edgeBlend ) => set( { edgeBlend } ),     1,   0,    500,  "m" )}
        {num( "Smoothing",    s.smooth,      ( smooth ) => set( { smooth } ),           0.25, 0,   50,   "m" )}
        <div className="section">Advanced</div>
        {num( "Peak width",   s.peakWidth,   ( peakWidth ) => set( { peakWidth } ),     1,    0,    2000, "m" )}
        {num( "On peak",      s.onPeak,      ( onPeak ) => set( { onPeak } ),           0.05, 0,    1                )}
        {num( "Warp",         s.warp,        ( warp ) => set( { warp } ),               0.05, 0,    3                )}
        {num( "Lacunarity",   s.lacunarity,  ( lacunarity ) => set( { lacunarity } ),   0.1,  1.2,  4                )}
        {num( "Gain",         s.gain,        ( gain ) => set( { gain } ),               0.05, 0.1,  0.9              )}
        {num( "Smooth steps", s.smoothSteps, ( smoothSteps ) => set( { smoothSteps: Math.round( smoothSteps ) } ), 1, 1, 10, undefined, 0 )}
        {num( "Seed",         s.seed,        ( seed ) => set( { seed: Math.round( seed ) } ), 1, 0, 99999, undefined, 0 )}
        <div className="section">Thermal erosion</div>
        {on( s.thermal.on, ( v ) => th( { on: v } ), "On" )}
        { s.thermal.on && (
          <>
            {num( "Amount",      s.thermal.amount,     ( amount ) => th( { amount } ),         0.05, 0,  1                 )}
            {num( "Steps",       s.thermal.iterations, ( iterations ) => th( { iterations: Math.round( iterations ) } ), 1, 1, 300, undefined, 0 )}
            {num( "Slope angle", s.thermal.repose,     ( repose ) => th( { repose } ),         1,    5,  80, "°", 0       )}
          </>
        ) }
        <div className="section">Hydraulic erosion</div>
        {on( s.hydraulic.on, ( v ) => hy( { on: v } ), "On" )}
        { s.hydraulic.on && (
          <>
            {num( "Droplets",  s.hydraulic.droplets,  ( droplets ) => hy( { droplets } ),   0.05,  0,    5                 )}
            {num( "Lifetime",  s.hydraulic.lifetime,  ( lifetime ) => hy( { lifetime: Math.round( lifetime ) } ), 1, 1, 500, undefined, 0 )}
            {num( "Inertia",   s.hydraulic.inertia,   ( inertia ) => hy( { inertia } ),     0.05,  0,    0.95              )}
            {num( "Capacity",  s.hydraulic.capacity,  ( capacity ) => hy( { capacity } ),   0.5,   0.1,  50                )}
            {num( "Erode",     s.hydraulic.erode,     ( erode ) => hy( { erode } ),         0.05,  0,    1                 )}
            {num( "Deposit",   s.hydraulic.deposit,   ( deposit ) => hy( { deposit } ),     0.05,  0,    1                 )}
            {num( "Evaporate", s.hydraulic.evaporate, ( evaporate ) => hy( { evaporate } ), 0.005, 0,    0.5, undefined, 3 )}
            {num( "Radius",    s.hydraulic.radius,    ( radius ) => hy( { radius: Math.round( radius ) } ), 1, 1, 8, undefined, 0 )}
          </>
        ) }
        <Field label=""><button className="btn small" onClick={() => deleteShape( s.uid )}>Delete shape</button></Field>
      </div>
    </Panel>
  );
}

function StampProps( { s }: { s: StampShape } ) {
  const set   = ( p: Partial<StampShape> ) => liveShape( { ...s, ...p } );
  const check = ( k: "mirrorX" | "mirrorZ" | "relative", label: string, tip?: string ) => (
    <>
      <label />
      <label style={{ color: "var(--text)" }} title={tip}>
        <input type="checkbox" checked={s[k]} onChange={( e ) => { set( { [k]: e.target.checked } ); commitShape(); }} /> {label}
      </label>
    </>
  );
  const size = [( s.grid.w - 1 ) * s.grid.spacing, ( s.grid.h - 1 ) * s.grid.spacing];
  return (
    <Panel icon="shapeCopy" title={`Shape · ${s.name}`}>
      <div className="props">
        <div className="section">{s.relative ? "Copied terrain" : "Imprint"}</div>
        <Field label="Name">
          <input className="txt" key={s.uid} defaultValue={s.name} onBlur={( e ) => { set( { name: e.target.value } ); commitShape(); }} />
        </Field>
        <Field label="Size">
          <span style={{ color: "var(--muted)" }}>{size[0].toFixed( 1 )} × {size[1].toFixed( 1 )} m</span>
        </Field>
        <Field label="Rotation"><Num value={s.rotation} step={1} digits={1} unit="°" onChange={( rotation ) => set( { rotation } )} /></Field>
        {check( "mirrorX", "Mirror left/right" )}
        {check( "mirrorZ", "Mirror front/back" )}
        <Field label="Raise by"><Num value={s.heightOffset} step={0.1} onChange={( heightOffset ) => set( { heightOffset } )} /></Field>
        {check( "relative", "Move to the ground height where it's placed", "Off: stays at exactly the height it was copied from" )}
        <Field label="Blend edges">
          <Num value={s.blend} step={0.25} min={0} max={s.grid.margin ?? Math.min( size[0], size[1] ) / 2} onChange={( blend ) => set( { blend } )} />
        </Field>
        <Field label=""><button className="btn small" onClick={() => deleteShape( s.uid )}>Delete shape</button></Field>
      </div>
    </Panel>
  );
}

function CurveProps( { s }: { s: CurveShape } ) {
  const set         = ( p: Partial<CurveShape> ) => liveShape( { ...s, ...p } );
  const len         = Math.hypot( s.end[0] - s.start[0], s.end[1] - s.start[1] );
  // a kicker's height and lip angle go together: setting one sets the other
  const under       = groundWithout( s.uid );
  const height      = s.lipAngle != null ? kickerHeight( s, under ) : s.bump;
  const pickProfile = ( profile: Curve, id: string ) =>
    set( id === "kicker" && s.heightMode === "bump" ? { profile, lipAngle: lipAngleFor( s, height, under ) } : { profile, lipAngle: null, bump: +height.toFixed( 2 ) } );
  return (
    <Panel icon="shapeCurve" title={`Shape · ${s.name}`}>
      <div className="props">
        <div className="section">Run</div>
        <Field label="Name">
          <input className="txt" key={s.uid} defaultValue={s.name} onBlur={( e ) => { set( { name: e.target.value } ); commitShape(); }} />
        </Field>
        <Field label="Length">
          <span style={{ color: "var(--muted)" }}>{len.toFixed( 1 )} m · drag the orange handles to move the ends</span>
        </Field>
        <Field label="Width"><Num value={s.width} step={0.25} min={0.5} onChange={( width ) => set( { width } )} /></Field>

        <div className="section">Height</div>
        <Field label="Mode" tip="Bump: the profile rises above the slope between the ends. Between: the profile goes from the start height to the end height.">
          <div className="seg">
            <button className={s.heightMode === "bump" ? "on" : ""} onClick={() => { set( { heightMode: "bump" } ); commitShape(); }}>Bump on slope</button>
            <button className={s.heightMode === "between" ? "on" : ""} onClick={() => { set( { heightMode: "between" } ); commitShape(); }}>Start → end</button>
          </div>
        </Field>
        { s.heightMode === "bump" && s.lipAngle != null && (
          <Field label="Lip angle">
            <Num value={s.lipAngle} step={1} min={0} max={80} digits={1} unit="°" onChange={( lipAngle ) => set( { lipAngle } )} />
          </Field>
        ) }
        { s.heightMode === "bump" && (
          <Field label="Height">
            <Num value={height} step={0.05} onChange={( h ) => set( s.lipAngle != null ? { lipAngle: lipAngleFor( s, h, under ) } : { bump: h } )} />
          </Field>
        ) }
        <Field label="Start height"><HeightField value={s.startHeight} at={s.start} onChange={( startHeight ) => set( { startHeight } )} /></Field>
        <Field label="End height"><HeightField value={s.endHeight} at={s.end} onChange={( endHeight ) => set( { endHeight } )} /></Field>

        <div className="section">Profile along the run</div>
        <div style={{ gridColumn: "1 / -1" }}>
          <Presets items={PROFILES} onPick={pickProfile} />
          { !( s.heightMode === "bump" && s.lipAngle != null ) && (
            <CurveEditor value={s.profile} min={-0.25} max={1.25} label={["start", "end"]} onChange={( profile ) => set( { profile } )} onCommit={commitShape} />
          ) }
        </div>
        <Field label="Repeats" tip="Repeat the profile along the run (e.g. a set of rollers)"><Num value={s.repeats} step={1} min={1} max={20} digits={0} onChange={( v ) => set( { repeats: Math.round( v ) } )} /></Field>
        { s.repeats > 1 && (
          <>
            <Field label="Each repeat" tip="Length of each repeat relative to the one before (0.8 = getting shorter)"><Num value={s.repeatScaling} step={0.05} min={0.1} max={4} onChange={( repeatScaling ) => set( { repeatScaling } )} /></Field>
            <Field label="Blend repeats"><Num value={s.repeatFade} step={0.05} min={0} max={0.5} onChange={( repeatFade ) => set( { repeatFade } )} /></Field>
          </>
        ) }

        <div className="section">Cross-section</div>
        <div style={{ gridColumn: "1 / -1" }}>
          <Presets items={CROSS_SECTIONS} onPick={( cross ) => set( { cross } )} />
          <CurveEditor value={s.cross} min={-1} max={1} label={["left", "right"]} onChange={( cross ) => set( { cross } )} onCommit={commitShape} />
        </div>
        <Field label="Depth" tip="Metres the cross-section adds at 1"><Num value={s.crossDepth} step={0.1} onChange={( crossDepth ) => set( { crossDepth } )} /></Field>
        <Field label="Side flatten" tip="Fraction of the width at each side that fades back to the plain run"><Num value={s.sideFlatten} step={0.02} min={0} max={0.5} onChange={( sideFlatten ) => set( { sideFlatten } )} /></Field>

        <div className="section">Banking</div>
        <div style={{ gridColumn: "1 / -1" }}>
          <CurveEditor value={s.tilt} min={-1} max={1} label={["start", "end"]} onChange={( tilt ) => set( { tilt } )} onCommit={commitShape} />
        </div>
        <Field label="Bank height" tip="Height difference across the width where the banking curve is at 1"><Num value={s.tiltDepth} step={0.1} onChange={( tiltDepth ) => set( { tiltDepth } )} /></Field>

        <div className="section">Edges</div>
        <Field label="Blend" tip="How much of the shape blends into the ground around it"><Num value={s.edgeBlend} step={0.02} min={0} max={0.5} onChange={( edgeBlend ) => set( { edgeBlend } )} /></Field>
        <Field label="Falloff"><Num value={s.edgeFalloff} step={0.05} min={0.25} max={4} onChange={( edgeFalloff ) => set( { edgeFalloff } )} /></Field>
        <Field label="Blend at">
          <div className="seg">
            { ( ["sides", "ends", "all"] as EdgeMode[] ).map( ( m ) => (
              <button key={m} className={s.edgeMode === m ? "on" : ""} onClick={() => { set( { edgeMode: m } ); commitShape(); }}>
                {m === "sides" ? "Sides" : m === "ends" ? "Ends" : "All"}
              </button>
            ) ) }
          </div>
        </Field>
        <Field label=""><button className="btn small" onClick={() => deleteShape( s.uid )}>Delete shape</button></Field>
      </div>
    </Panel>
  );
}

function CircleProps( { s }: { s: CircleShape } ) {
  const set = ( p: Partial<CircleShape> ) => liveShape( { ...s, ...p } );
  return (
    <Panel icon="shapeCircle" title={`Shape · ${s.name}`}>
      <div className="props">
        <div className="section">Circle</div>
        <Field label="Name">
          <input className="txt" key={s.uid} defaultValue={s.name} onBlur={( e ) => { set( { name: e.target.value } ); commitShape(); }} />
        </Field>
        <Field label="Radius"><Num value={s.radius} step={0.25} min={1} onChange={( radius ) => set( { radius } )} /></Field>
        <Field label="Base height"><HeightField value={s.height} at={s.center} onChange={( height ) => set( { height } )} /></Field>
        <Field label="Depth" tip="Metres the profile adds at 1 (negative digs)"><Num value={s.depth} step={0.1} onChange={( depth ) => set( { depth } )} /></Field>

        <div className="section">Profile from the centre out</div>
        <div style={{ gridColumn: "1 / -1" }}>
          <Presets items={RADIALS} onPick={( radial ) => set( { radial } )} />
          <CurveEditor value={s.radial} min={-1} max={1} label={["centre", "edge"]} onChange={( radial ) => set( { radial } )} onCommit={commitShape} />
        </div>

        <div className="section">Tilt</div>
        <Field label="Angle" tip="Tilts the base plane (a pad that leans)"><Num value={s.tiltAngle} step={0.5} min={-60} max={60} unit="°" onChange={( tiltAngle ) => set( { tiltAngle } )} /></Field>
        <Field label="Towards" tip="Compass direction the plane rises towards, degrees (0 = +Z)"><Num value={s.tiltDirection} step={5} onChange={( tiltDirection ) => set( { tiltDirection } )} /></Field>

        <div className="section">Edges</div>
        <Field label="Blend"><Num value={s.edgeBlend} step={0.02} min={0} max={0.5} onChange={( edgeBlend ) => set( { edgeBlend } )} /></Field>
        <Field label="Falloff"><Num value={s.edgeFalloff} step={0.05} min={0.25} max={4} onChange={( edgeFalloff ) => set( { edgeFalloff } )} /></Field>
        <Field label=""><button className="btn small" onClick={() => deleteShape( s.uid )}>Delete shape</button></Field>
      </div>
    </Panel>
  );
}
