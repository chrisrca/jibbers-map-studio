// A ski line in Properties, as Map-Tools' Ski Line Builder shows one: its shape and blending, its points ( each one's
// roll and width ), and its features ( Map-Tools' presets, or one saved ) with their stripes. Every change applies
// live; one undo step when a field or curve point is let go.

import { useState } from "react";
import { CROSS_SECTIONS, type Curve } from "../../core/curve";
import { MARKING_COLOURS } from "../../paint/settings";
import { commitShape, liveShape } from "../../terrain/shapes/edits";
import { groundWithout, type SkiLineFeature, type SkiLineShape, type SkiLineStripe } from "../../terrain/shapes/shapes";
import { SKI_LINE_PRESETS, newSkiLineFeature, skiLineBake, withPreset } from "../../terrain/shapes/shapes/skiline";
import { NumberField, Panel } from "../widgets/controls";
import { CurveEditor } from "../widgets/CurveEditor";
import { Dropdown } from "../widgets/widgets";

// ( features saved to use again: Map-Tools' Ski Line Feature Preset assets )
const SAVED = "jibbers.skiline.features";
const savedFeatures = (): SkiLineFeature[] => {
  try {
    return JSON.parse( localStorage.getItem( SAVED ) ?? "[]" ) as SkiLineFeature[];
  } catch {
    return [];
  }
};
const keepFeatures = ( list: SkiLineFeature[] ) => {
  try {
    localStorage.setItem( SAVED, JSON.stringify( list ) );
  } catch {
    // ( kept for this run only )
  }
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

const check = ( value: boolean, onChange: ( v: boolean ) => void, label: string ) => (
  <>
    <label />
    <label style={{ color: "var(--text)" }}><input type="checkbox" checked={value} onChange={( e ) => { onChange( e.target.checked ); commitShape(); }} /> {label}</label>
  </>
);

export function SkiLineProps( { s }: { s: SkiLineShape } ) {
  const [saved, setSaved] = useState( savedFeatures );
  const set  = ( p: Partial<SkiLineShape> ) => liveShape( { ...s, ...p } );
  const once = ( next: SkiLineShape, label: string ) => { liveShape( next, label ); commitShape(); };
  const num  = ( label: string, value: number, onChange: ( v: number ) => void, step: number, min: number, max: number, unit?: string, digits = 2, tip?: string ) => (
    <Field label={label} tip={tip}><Num value={value} step={step} min={min} max={max} unit={unit} digits={digits} onChange={onChange} /></Field>
  );
  const node    = ( i: number, p: Partial<SkiLineShape["nodes"][number]> ) => set( { nodes: s.nodes.map( ( n, k ) => ( k === i ? { ...n, ...p } : n ) ) } );
  const feature = ( i: number, p: Partial<SkiLineFeature> ) => set( { features: s.features.map( ( f, k ) => ( k === i ? { ...f, ...p } : f ) ) } );
  const stripe  = ( i: number, j: number, p: Partial<SkiLineStripe> ) => feature( i, { stripes: s.features[i].stripes.map( ( st, k ) => ( k === j ? { ...st, ...p } : st ) ) } );
  const length  = skiLineBake( s )?.total ?? 0;
  // ( Map-Tools' Drape Nodes To Ground: each point on the ground under the line )
  const drape   = () => {
    const under = groundWithout( s.uid );
    once( { ...s, nodes: s.nodes.map( ( n ) => { const g = under( n.p[0], n.p[2] ); return Number.isNaN( g ) ? n : { ...n, p: [n.p[0], g, n.p[2]] as [number, number, number] }; } ) }, "Drape ski line" );
  };
  return (
    <Panel icon="skiLine" title={`Shape · ${s.name}`}>
      <div className="props">
        <div className="section">Ski Line</div>
        {check( s.enabled, ( enabled ) => set( { enabled } ), "On" )}
        <Field label="Name">
          <input className="txt" key={s.uid + s.name} defaultValue={s.name} onBlur={( e ) => { if ( e.target.value !== s.name ) once( { ...s, name: e.target.value }, "Rename ski line" ); }} />
        </Field>
        <Field label="Length"><span className="muted">{length.toFixed( 1 )} m · {s.nodes.length} points</span></Field>

        <div className="section">Shape</div>
        {num( "Width", s.width, ( width ) => set( { width } ), 0.5, 0.2, 200, "m", 2, "Width of the line surface. Points can override it." )}
        {num( "Depth", s.crossDepth, ( crossDepth ) => set( { crossDepth } ), 0.1, -20, 20, "m", 2, "How deep the cross-section shapes the surface. 0 = flat." )}
        <Field label="Cross-section">
          <div className="seg wrap">
            { Object.entries( CROSS_SECTIONS ).map( ( [id, c] ) => (
              <button key={id} onClick={() => once( { ...s, cross: structuredClone( c.curve ) }, "Cross-section" )}>{c.label}</button>
            ) ) }
          </div>
        </Field>
        <div style={{ gridColumn: "1 / -1" }}>
          <CurveEditor value={s.cross} min={-1} max={1} label={["left", "right"]} onChange={( cross: Curve ) => set( { cross } )} onCommit={commitShape} />
        </div>
        {num( "Flatten", s.sideFlatten, ( sideFlatten ) => set( { sideFlatten } ), 0.01, 0, 0.5, undefined, 2, "Fraction of each side the cross-section and roll fade out over." )}
        {num( "Auto Bank", s.autoBank, ( autoBank ) => set( { autoBank } ), 1, 0, 60, "°", 0, "Banking in a 20 m turn; more in tighter turns, none on straights. Points' roll adds to it." )}

        <div className="section">Blending</div>
        {num( "Edge Blend", s.edgeBlend, ( edgeBlend ) => set( { edgeBlend } ), 0.01, 0, 0.5, undefined, 2, "Fraction of each side blended into the ground round it." )}
        {num( "Edge Curve", s.edgeFalloff, ( edgeFalloff ) => set( { edgeFalloff } ), 0.05, 0.25, 4, undefined, 2, "Higher = sharper shoulder." )}
        {num( "End Blend", s.endBlend, ( endBlend ) => set( { endBlend } ), 0.5, 0, 200, "m", 1, "Distance the line fades in and out at its ends." )}
        <Field label="Detail" tip="Samples along the line. Raise for very long or twisty lines."><Num value={s.detail} step={16} min={16} max={4096} digits={0} onChange={( detail ) => set( { detail: Math.round( detail ) } )} /></Field>

        <div className="section">Points</div>
        <Field label=""><button className="btn small" title="Each point's height onto the ground under the line" onClick={drape}>Drape to Ground</button></Field>
        { s.nodes.map( ( n, i ) => (
          <SkiLinePoint key={i} i={i} n={n} line={s.width} onChange={( p ) => node( i, p )} />
        ) ) }

        <div className="section">Features</div>
        { s.features.map( ( f, i ) => (
          <SkiLineFeatureRows
            key={i}
            f={f}
            length={length}
            saved={saved}
            onChange={( p ) => feature( i, p )}
            onStripe={( j, p ) => stripe( i, j, p )}
            onOnce={( next, label ) => once( { ...s, features: s.features.map( ( q, k ) => ( k === i ? next : q ) ) }, label )}
            onRemove={() => once( { ...s, features: s.features.filter( ( _, k ) => k !== i ) }, "Remove feature" )}
            onSave={() => { const list = [...savedFeatures().filter( ( q ) => q.name !== f.name ), f]; keepFeatures( list ); setSaved( list ); }}
          />
        ) ) }
        <Field label="">
          <button className="btn small" onClick={() => once( { ...s, features: [...s.features, newSkiLineFeature( Math.min( 20, length / 2 ) )] }, "Add feature" )}>Add Feature</button>
        </Field>
      </div>
    </Panel>
  );
}

function SkiLinePoint( { i, n, line, onChange }: { i: number; n: SkiLineShape["nodes"][number]; line: number; onChange: ( p: Partial<SkiLineShape["nodes"][number]> ) => void } ) {
  const at = ( k: 0 | 1 | 2, v: number ) => onChange( { p: n.p.map( ( q, j ) => ( j === k ? v : q ) ) as [number, number, number] } );
  return (
    <>
      <label>Point {i}</label>
      <div style={{ display: "flex", gap: 3 }}>
        <Num value={n.p[0]} step={0.5} digits={1} onChange={( v ) => at( 0, v )} />
        <Num value={n.p[1]} step={0.1} digits={1} onChange={( v ) => at( 1, v )} />
        <Num value={n.p[2]} step={0.5} digits={1} onChange={( v ) => at( 2, v )} />
      </div>
      <label />
      <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
        <span className="muted">Roll</span>
        <Num value={n.roll} step={1} min={-60} max={60} digits={0} unit="°" onChange={( roll ) => onChange( { roll } )} />
        <label style={{ color: "var(--text)", whiteSpace: "nowrap" }} title="The line's width here">
          <input type="checkbox" checked={n.width === null} onChange={( e ) => { onChange( { width: e.target.checked ? null : line } ); commitShape(); }} /> Line's width
        </label>
        {n.width !== null && <Num value={n.width} step={0.5} min={0.2} digits={1} unit="m" onChange={( width ) => onChange( { width } )} />}
      </div>
    </>
  );
}

function SkiLineFeatureRows( p: {
  f:        SkiLineFeature;
  length:   number;
  saved:    SkiLineFeature[];
  onChange: ( p: Partial<SkiLineFeature> ) => void;
  onStripe: ( j: number, p: Partial<SkiLineStripe> ) => void;
  onOnce:   ( next: SkiLineFeature, label: string ) => void;
  onRemove: () => void;
  onSave:   () => void;
} ) {
  const { f } = p;
  const [pick, setPick] = useState( "" );
  const chosen = p.saved.find( ( q ) => q.name === pick );
  const num    = ( label: string, value: number, onChange: ( v: number ) => void, step: number, min: number, max: number, unit?: string, tip?: string ) => (
    <Field label={label} tip={tip}><Num value={value} step={step} min={min} max={max} unit={unit} digits={2} onChange={onChange} /></Field>
  );
  return (
    <>
      <label>{f.name}</label>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <label style={{ color: "var(--text)" }}><input type="checkbox" checked={f.enabled} onChange={( e ) => { p.onChange( { enabled: e.target.checked } ); commitShape(); }} /> On</label>
        <button className="btn small" onClick={p.onRemove}>Remove</button>
      </div>
      <Field label="Name">
        <input className="txt" key={f.name} defaultValue={f.name} onBlur={( e ) => { if ( e.target.value !== f.name ) p.onOnce( { ...f, name: e.target.value }, "Rename feature" ); }} />
      </Field>
      <div className="seg wrap" style={{ gridColumn: "1 / -1" }}>
        {SKI_LINE_PRESETS.map( ( q ) => <button key={q.name} title={`The ${q.name} preset's shape and stripes ( kept where it is )`} onClick={() => p.onOnce( withPreset( f, q ), `${q.name} preset` )}>{q.name}</button> )}
      </div>
      <Field label="Saved">
        <div style={{ display: "flex", gap: 4 }}>
          <Dropdown value={pick} options={[{ value: "", label: p.saved.length ? "Choose…" : "None" }, ...p.saved.map( ( q ) => ( { value: q.name, label: q.name } ) )]} onChange={setPick} />
          <button className="btn small" disabled={!chosen} title="Its shape and stripes ( kept where it is )" onClick={() => chosen && p.onOnce( { ...structuredClone( chosen ), start: f.start, lateral: f.lateral }, "Load feature" )}>Load</button>
          <button className="btn small" title="Saved under its name" onClick={p.onSave}>Save</button>
        </div>
      </Field>
      {num( "Start", f.start, ( start ) => p.onChange( { start } ), 0.5, 0, Math.max( 0, p.length ), "m", "Distance along the line it begins. Drag its cone in the view." )}
      {num( "Offset", f.lateral, ( lateral ) => p.onChange( { lateral } ), 0.25, -100, 100, "m", "Off the line's middle. Drag its cube in the view." )}
      {num( "Length", f.length, ( length ) => p.onChange( { length } ), 0.5, 0, 500, "m" )}
      {num( "Height", f.height, ( height ) => p.onChange( { height } ), 0.1, -50, 50, "m" )}
      {num( "Width", f.width, ( width ) => p.onChange( { width } ), 0.25, 0, 200, "m", "0 = the line's whole width." )}
      {num( "Side Blend", f.sideBlend, ( sideBlend ) => p.onChange( { sideBlend } ), 0.01, 0, 1, undefined, "Fraction of its half-width blended in at its sides ( with a width )." )}
      <div style={{ gridColumn: "1 / -1" }}>
        <CurveEditor value={f.profile} min={-0.25} max={1.25} label={["start", "end"]} onChange={( profile: Curve ) => p.onChange( { profile } )} onCommit={commitShape} />
      </div>
      { f.stripes.map( ( st, j ) => (
        <SkiLineStripeRows key={j} st={st} onChange={( q ) => p.onStripe( j, q )} onRemove={() => p.onOnce( { ...f, stripes: f.stripes.filter( ( _, k ) => k !== j ) }, "Remove stripe" )} />
      ) ) }
      <Field label="">
        <button className="btn small" onClick={() => p.onOnce( { ...f, stripes: [...f.stripes, { across: false, position: 0.5, width: 0.6, softness: 0.4, opacity: 0.7, inset: 0, colour: 11 }] }, "Add stripe" )}>Add Stripe</button>
      </Field>
    </>
  );
}

function SkiLineStripeRows( { st, onChange, onRemove }: { st: SkiLineStripe; onChange: ( p: Partial<SkiLineStripe> ) => void; onRemove: () => void } ) {
  return (
    <>
      <label>Stripe</label>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <div className="seg">
          <button className={!st.across ? "on" : ""} title="Runs along the feature" onClick={() => { onChange( { across: false } ); commitShape(); }}>Along</button>
          <button className={st.across ? "on" : ""} title="Runs across the line at one point of the feature" onClick={() => { onChange( { across: true } ); commitShape(); }}>Across</button>
        </div>
        <button className="btn small" onClick={onRemove}>Remove</button>
      </div>
      <Field label="Colour">
        <Dropdown value={st.colour} options={MARKING_COLOURS.map( ( c, i ) => ( { value: i, label: c.name } ) )} onChange={( colour ) => { onChange( { colour } ); commitShape(); }} />
      </Field>
      <Field label="Position" tip="Along stripes: where across the width. Across stripes: where along the feature ( 0 start, 1 end )."><Num value={st.position} step={0.01} min={0} max={1} onChange={( position ) => onChange( { position } )} /></Field>
      <Field label="Width"><Num value={st.width} step={0.05} min={0.05} max={20} unit="m" onChange={( width ) => onChange( { width } )} /></Field>
      <Field label="Softness"><Num value={st.softness} step={0.01} min={0} max={1} onChange={( softness ) => onChange( { softness } )} /></Field>
      <Field label="Opacity"><Num value={st.opacity} step={0.01} min={0} max={1} onChange={( opacity ) => onChange( { opacity } )} /></Field>
      {st.across && <Field label="Inset" tip="Pulled in from the line's edges ( a fraction of the width )."><Num value={st.inset} step={0.01} min={0} max={0.45} onChange={( inset ) => onChange( { inset } )} /></Field>}
    </>
  );
}
