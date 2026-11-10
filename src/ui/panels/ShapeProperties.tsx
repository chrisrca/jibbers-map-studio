// Properties for a selected terrain shape. Every change applies live; the edit becomes one undo step when a field
// or curve point is let go.

import { CROSS_SECTIONS, PROFILES, RADIALS, type Curve } from "../../core/curve";
import { useState } from "react";
import { ask } from "../../app/ask";
import { bakeShape, commitShape, deleteShape, liveErosion, liveShape, setLiveErosion, simulateShape } from "../../terrain/shapes/edits";
import { applyPreset, fitFormation, FORMATION_PRESETS, groundWithout, kickerHeight, lipAngleFor, simulates, type CircleShape, type CurveShape, type EdgeMode, type FormationShape, type PaintShape, type Shape, type StampShape } from "../../terrain/shapes/shapes";
import { MARKING_COLOURS } from "../../paint/settings";
import { deletePreset, savedPresets, savePreset, withSettings } from "../../terrain/shapes/shapes/presets";
import { terrain } from "../../terrain/terrain";
import { NumberField, Panel } from "../widgets/controls";
import { CurveEditor } from "../widgets/CurveEditor";
import { Dropdown } from "../widgets/widgets";
import { rampBent, rampLength } from "../../terrain/shapes/shapes/rampPath";
import { SKI_LINE_PRESETS } from "../../terrain/shapes/shapes/skiline";
import { newStripe, SkiLineProps, SkiLineStripeRows } from "./SkiLineProperties";

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
  if ( s.kind === "paint" ) return <PaintProps s={s} />;
  if ( s.kind === "skiline" ) return <SkiLineProps s={s} />;
  return <CircleProps s={s} />;
}

// A formation's ways of meeting the ground and its noise's.
const BLENDS: [FormationShape["mode"], string, string][] = [
  ["add",   "Add",   "Offset on top of the ground"],
  ["raise", "Raise", "Keeps whichever is higher"],
  ["carve", "Carve", "Keeps whichever is lower ( use a negative height )"],
  ["set",   "Set",   "Replaces the ground"],
];
const STYLES: [FormationShape["style"], string, string][] = [["smooth", "Smooth", "Rolling hills"], ["ridged", "Ridged", "Sharp crests"], ["billow", "Billow", "Lumpy blobs"]];

function FormationProps( { s }: { s: FormationShape } ) {
  const [live, setLive]   = useState( liveErosion );
  const [saved, setSaved] = useState( savedPresets );
  const [pick, setPick]   = useState( "" );
  const set  = ( p: Partial<FormationShape> ) => liveShape( { ...s, ...p } );
  const once = ( next: FormationShape, label: string ) => { liveShape( next, label ); commitShape(); };
  const th   = ( p: Partial<FormationShape["thermal"]> ) => set( { thermal: { ...s.thermal, ...p } } );
  const hy   = ( p: Partial<FormationShape["hydraulic"]> ) => set( { hydraulic: { ...s.hydraulic, ...p } } );
  const sn   = ( p: Partial<FormationShape["snow"]> ) => set( { snow: { ...s.snow, ...p } } );
  const num  = ( label: string, value: number, onChange: ( v: number ) => void, step: number, min: number, max: number, unit?: string, digits = 2, tip?: string ) => (
    <Field label={label} tip={tip}><Num value={value} step={step} min={min} max={max} unit={unit} digits={digits} onChange={onChange} /></Field>
  );
  const int  = ( label: string, value: number, onChange: ( v: number ) => void, min: number, max: number, tip?: string ) => num( label, value, ( v ) => onChange( Math.round( v ) ), 1, min, max, undefined, 0, tip );
  const on   = ( value: boolean, onChange: ( v: boolean ) => void, label: string ) => (
    <>
      <label />
      <label style={{ color: "var(--text)" }}><input type="checkbox" checked={value} onChange={( e ) => { onChange( e.target.checked ); commitShape(); }} /> {label}</label>
    </>
  );
  const chosen = saved.find( ( p ) => p.name === pick );
  return (
    <Panel icon="mountain" title={`Shape · ${s.name}`}>
      <div className="props">
        <div className="section">Formation</div>
        {on( s.enabled !== false, ( enabled ) => set( { enabled } ), "On" )}
        <Field label="Name">
          <input className="txt" key={s.uid + s.name} defaultValue={s.name} onBlur={( e ) => { if ( e.target.value !== s.name ) once( { ...s, name: e.target.value }, "Rename formation" ); }} />
        </Field>
        <div className="seg" style={{ gridColumn: "1 / -1" }}>{FORMATION_PRESETS.map( ( p ) => <button key={p.name} title={`${p.name}, fitted to the outline`} onClick={() => once( applyPreset( s, p.name ), `${p.name} preset` )}>{p.name}</button> )}</div>
        <Field label="Saved">
          <Dropdown value={pick} options={[{ value: "", label: saved.length ? "Choose…" : "None" }, ...saved.map( ( p ) => ( { value: p.name, label: p.name } ) )]} onChange={setPick} />
        </Field>
        <Field label="">
          <div style={{ display: "flex", gap: 4 }}>
            <button className="btn small" disabled={!chosen} title="Load its settings ( keeps the outline )" onClick={() => chosen && once( withSettings( s, chosen.settings ), "Load preset" )}>Load</button>
            <button className="btn small" title="Save these settings under the formation's name" onClick={() => { savePreset( s ); setSaved( savedPresets() ); setPick( s.name.trim() || "Formation" ); }}>Save</button>
            <button className="btn small" disabled={!chosen} onClick={() => { deletePreset( pick ); setSaved( savedPresets() ); setPick( "" ); }}>Delete</button>
          </div>
        </Field>
        <Field label="Outline">
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span>{s.points.length} point{s.points.length === 1 ? "" : "s"}</span>
            <button className="btn small" disabled={s.points.length < 3} title="Height, feature size, peak width and edge blend scaled to the outline" onClick={() => once( fitFormation( s ), "Fit formation" )}>Fit to outline</button>
          </div>
        </Field>
        <div className="section">Shape</div>
        <Field label="Mode">
          <div className="seg">{BLENDS.map( ( [id, label, tip] ) => <button key={id} title={tip} className={s.mode === id ? "on" : ""} onClick={() => once( { ...s, mode: id }, "Edit shape" )}>{label}</button> )}</div>
        </Field>
        {num( "Base Y",       s.baseY,       ( baseY ) => set( { baseY } ),             0.5,  -500, 500,  "m", 2, "Moves the whole formation up or down" )}
        <Field label="Style">
          <div className="seg">{STYLES.map( ( [id, label, tip] ) => <button key={id} title={tip} className={s.style === id ? "on" : ""} onClick={() => once( { ...s, style: id }, "Edit shape" )}>{label}</button> )}</div>
        </Field>
        {num( "Height",       s.height,      ( height ) => set( { height } ),           0.5,  -1000, 1000, "m", 2, "Peak height above the ground" )}
        {num( "Feature size", s.featureSize, ( featureSize ) => set( { featureSize } ), 1,    1,    4000, "m", 2, "Size of the largest noise features" )}
        {num( "Roughness",    s.roughness,   ( roughness ) => set( { roughness } ),     0.5,  0,    1000, "m", 2, "Noise added on top of the dome" )}
        {int( "Detail",       s.detail,      ( detail ) => set( { detail } ),           1,    9,    "Noise octaves ( limited by the ground's resolution )" )}
        {num( "Edge blend",   s.edgeBlend,   ( edgeBlend ) => set( { edgeBlend } ),     0.5,  0,    1000, "m", 2, "Fade into the ground at the outline" )}
        {num( "Smoothing",    s.smooth,      ( smooth ) => set( { smooth } ),           0.05, 0,    1,    undefined, 2, "Rounds off hard edges" )}
        {int( "Smooth steps", s.smoothSteps, ( smoothSteps ) => set( { smoothSteps } ), 0,    64 )}
        <div className="section">Advanced</div>
        <Field label="Profile" tip="Cross-section, edge to peak">
          <CurveEditor value={s.profile} min={0} max={1} label={["edge", "peak"]} onChange={( profile ) => set( { profile } )} onCommit={commitShape} />
        </Field>
        {num( "Peak width",   s.peakWidth,   ( peakWidth ) => set( { peakWidth } ),     1,    0,    4000, "m", 2, "From the outline to full height" )}
        {num( "Lacunarity",   s.lacunarity,  ( lacunarity ) => set( { lacunarity } ),   0.1,  1.2,  4,    undefined, 2, "Frequency step between octaves" )}
        {num( "Gain",         s.gain,        ( gain ) => set( { gain } ),               0.05, 0.1,  0.9,  undefined, 2, "Amplitude step between octaves" )}
        {num( "Warp",         s.warp,        ( warp ) => set( { warp } ),               0.05, 0,    2,    undefined, 2, "Distorts the noise" )}
        {num( "On peak",      s.onPeak,      ( onPeak ) => set( { onPeak } ),           0.05, 0,    1,    undefined, 2, "Noise towards the peak ( 1 ) or all over ( 0 )" )}
        {int( "Seed",         s.seed,        ( seed ) => set( { seed } ),               0,    99999 )}
        <div className="section">Thermal erosion</div>
        {on( s.thermal.on, ( v ) => th( { on: v } ), "On" )}
        { s.thermal.on && (
          <>
            {num( "Amount",      s.thermal.amount,     ( amount ) => th( { amount } ),         0.05, 0, 1  )}
            {int( "Iterations",  s.thermal.iterations, ( iterations ) => th( { iterations } ), 1,    512 )}
            {num( "Slope angle", s.thermal.repose,     ( repose ) => th( { repose } ),         1,    5, 80, "°", 0, "Angle of repose" )}
          </>
        ) }
        <div className="section">Hydraulic erosion</div>
        {on( s.hydraulic.on, ( v ) => hy( { on: v } ), "On" )}
        { s.hydraulic.on && (
          <>
            {num( "Droplets",  s.hydraulic.droplets,  ( droplets ) => hy( { droplets } ),   0.05,  0.02, 4, undefined, 2, "Per height sample" )}
            {int( "Lifetime",  s.hydraulic.lifetime,  ( lifetime ) => hy( { lifetime } ),   8,     4000, "Height samples a droplet travels" )}
            {num( "Inertia",   s.hydraulic.inertia,   ( inertia ) => hy( { inertia } ),     0.05,  0,    1 )}
            {num( "Capacity",  s.hydraulic.capacity,  ( capacity ) => hy( { capacity } ),   0.5,   0.01, 50 )}
            {num( "Erode",     s.hydraulic.erode,     ( erode ) => hy( { erode } ),         0.05,  0,    1 )}
            {num( "Deposit",   s.hydraulic.deposit,   ( deposit ) => hy( { deposit } ),     0.05,  0,    1 )}
            {num( "Evaporate", s.hydraulic.evaporate, ( evaporate ) => hy( { evaporate } ), 0.005, 0,    1, undefined, 3 )}
            {int( "Radius",    s.hydraulic.radius,    ( radius ) => hy( { radius } ),       1,     4,    "Height samples" )}
          </>
        ) }
        <div className="section">Snowfall</div>
        {on( s.snow.on, ( v ) => sn( { on: v } ), "On" )}
        { s.snow.on && (
          <>
            {num( "Rock starts",  s.snow.rockFrom,   ( rockFrom ) => sn( { rockFrom } ),     1,    0,  90, "°", 0 )}
            {num( "Full rock",    s.snow.rockFull,   ( rockFull ) => sn( { rockFull } ),     1,    0,  90, "°", 0 )}
            {num( "Rock amount",  s.snow.rock,       ( rock ) => sn( { rock } ),             0.05, 0,  1 )}
            {num( "Crevices",     s.snow.crevices,   ( crevices ) => sn( { crevices } ),     0.05, 0,  1, undefined, 2, "Hollows hold snow, crests shed it" )}
            {num( "Snow line lo", s.snow.lineLow,    ( lineLow ) => sn( { lineLow } ),       1,    -1, 10000, "m", 1, "World height below which no snow lies ( −1 off )" )}
            {num( "Snow line hi", s.snow.lineHigh,   ( lineHigh ) => sn( { lineHigh } ),     1,    -1, 10000, "m", 1, "World height above which snow fully lies ( −1 off )" )}
            {num( "Snow depth",   s.snow.depth,      ( depth ) => sn( { depth } ),           0.1,  0,  50, "m" )}
            {num( "Adds height",  s.snow.addsHeight, ( addsHeight ) => sn( { addsHeight } ), 0.05, 0,  1, undefined, 2, "How much the snow raises the ground" )}
            {int( "Soften",       s.snow.soften,     ( soften ) => sn( { soften } ),         0,    64, "Blur passes on the snow's edge" )}
          </>
        ) }
        <div className="section">Simulation</div>
        <label />
        <label style={{ color: "var(--text)" }} title="Erosion and snow worked out after every edit">
          <input type="checkbox" checked={live} onChange={( e ) => { setLiveErosion( e.target.checked ); setLive( e.target.checked ); }} /> Live erosion
        </label>
        { !live && <Field label=""><button className="btn small" disabled={!simulates( s )} onClick={() => simulateShape( s )}>Simulate</button></Field> }
        <Field label="">
          <div style={{ display: "flex", gap: 4 }}>
            <button className="btn small" title="Keeps its ground, takes the formation off the list" disabled={s.enabled === false} onClick={() => void ask( { title: `Bake ${s.name} into the terrain?`, answers: [{ id: "bake", label: "Bake", primary: true }] } ).then( ( a ) => a?.id === "bake" && bakeShape( s.uid ) )}>Bake into terrain</button>
            <button className="btn small" onClick={() => deleteShape( s.uid )}>Delete shape</button>
          </div>
        </Field>
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
  const stripes     = s.stripes ?? [];
  const setStripes  = ( next: CurveShape["stripes"], label: string ) => { liveShape( { ...s, stripes: next }, label ); commitShape(); };
  const len         = rampLength( s );
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
          <span style={{ color: "var(--muted)" }}>{len.toFixed( 1 )} m · drag the ends to move it, the arms to bend it</span>
        </Field>
        { rampBent( s ) && (
          <Field label=""><button className="btn small" onClick={() => { set( { startArm: undefined, endArm: undefined } ); commitShape(); }}>Straighten</button></Field>
        ) }
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

        <div className="section">Stripes</div>
        <div className="seg wrap" style={{ gridColumn: "1 / -1" }}>
          {SKI_LINE_PRESETS.filter( ( q ) => q.stripes().length ).map( ( q ) => (
            <button key={q.name} title={`The ski line ${q.name} preset's stripes`} onClick={() => setStripes( q.stripes(), `${q.name} stripes` )}>{q.name}</button>
          ) )}
        </div>
        { stripes.map( ( st, j ) => (
          <SkiLineStripeRows key={j} st={st} onChange={( q ) => set( { stripes: stripes.map( ( x, k ) => ( k === j ? { ...x, ...q } : x ) ) } )} onRemove={() => setStripes( stripes.filter( ( _, k ) => k !== j ), "Remove stripe" )} />
        ) ) }
        <Field label="">
          <button className="btn small" onClick={() => setStripes( [...stripes, newStripe()], "Add stripe" )}>Add Stripe</button>
        </Field>

        <Field label=""><button className="btn small" onClick={() => deleteShape( s.uid )}>Delete shape</button></Field>
      </div>
    </Panel>
  );
}

const TARGETS: [PaintShape["target"], string][] = [["snow", "Snow"], ["marking", "Marking"], ["powder", "Powder"]];

function PaintProps( { s }: { s: PaintShape } ) {
  const set  = ( p: Partial<PaintShape> ) => liveShape( { ...s, ...p } );
  const once = ( p: Partial<PaintShape> ) => { set( p ); commitShape(); };
  return (
    <Panel icon="shapeCurve" title={`Shape · ${s.name}`}>
      <div className="props">
        <div className="section">Paint</div>
        <Field label="Name">
          <input className="txt" key={s.uid + s.name} defaultValue={s.name} onBlur={( e ) => { if ( e.target.value !== s.name ) once( { name: e.target.value } ); }} />
        </Field>
        <Field label="Paints">
          <div className="seg">{TARGETS.map( ( [id, label] ) => <button key={id} className={s.target === id ? "on" : ""} onClick={() => once( { target: id } )}>{label}</button> )}</div>
        </Field>
        <label />
        <label style={{ color: "var(--text)" }}><input type="checkbox" checked={s.erase} onChange={( e ) => once( { erase: e.target.checked } )} /> {s.target === "snow" ? "Rock" : "Erase"}</label>
        { s.target === "marking" && !s.erase && (
          <Field label="Colour">
            <Dropdown value={s.colour} options={MARKING_COLOURS.map( ( c, i ) => ( { value: i, label: c.name } ) )} onChange={( colour ) => once( { colour } )} />
          </Field>
        ) }
        { s.target === "powder" && !s.erase && <Field label="Depth"><Num value={s.depth} step={0.05} min={0} max={1} onChange={( depth ) => set( { depth } )} /></Field> }
        <Field label="Width"><Num value={s.width} step={0.5} min={0.5} max={500} unit="m" onChange={( width ) => set( { width } )} /></Field>
        <Field label="Coverage"><Num value={s.coverage} step={0.05} min={0} max={1} onChange={( coverage ) => set( { coverage } )} /></Field>
        <div className="section">Along</div>
        <Field label="">
          <CurveEditor value={s.along} min={0} max={1} label={["start", "end"]} onChange={( along ) => set( { along } )} onCommit={commitShape} />
        </Field>
        <Field label="Repeats"><Num value={s.repeats} step={1} min={1} max={50} digits={0} onChange={( repeats ) => set( { repeats: Math.round( repeats ) } )} /></Field>
        <Field label="Repeat scale"><Num value={s.repeatScaling} step={0.05} min={0.1} max={10} onChange={( repeatScaling ) => set( { repeatScaling } )} /></Field>
        <div className="section">Across</div>
        <Field label="">
          <CurveEditor value={s.cross} min={0} max={1} label={["left", "right"]} onChange={( cross ) => set( { cross } )} onCommit={commitShape} />
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
