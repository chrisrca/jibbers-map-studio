// Properties editor › Brush tab in Paint mode: the paint brush's settings and the whole-map fills.

import { useState, type ReactNode } from "react";
import { allPowder, allSnow, clearGrip, clearMarkings, clearPowder, flowAlongTrails, flowDownhill, snowfall, type Snowfall } from "../../paint/ground";
import { useEditor } from "../../map/store";
import { mergeBrush, PAINT_PRESETS, type PaintBrush } from "../../paint/engine/brush";
import { FALLOFFS } from "../../sculpt/tip";
import { EngineStroke, type TileStore } from "../../paint/engine/stroke";
import { PATTERNS, TEXTURE_MODES, TIPS } from "../../paint/engine/tips";
import { ColourChip, ColourPicker } from "../widgets/ColourPicker";
import { MarkingSwatches } from "../widgets/MarkingSwatches";
import { NumberField, Panel } from "../widgets/controls";
import { BLENDS, PAINT_TOOLS } from "../Toolbar";
import { Dropdown, NumSlider } from "../widgets/widgets";
import { getEngine } from "../Viewport";

/**
 * Puts a preset's brush ( and its hardness and strength ) on the colour brushes.
**/
export function applyPaintPreset( name: string ) {
  const p = PAINT_PRESETS.find( ( x ) => x.name === name );
  if ( !p ) return;
  useEditor.getState().setPaint( { preset: p.name, hardness: p.hardness, strength: p.strength, brush: mergeBrush( p.brush ) } );
}

// A preset's look: an S-stroke in black on white ( made once, by the paint engine itself ).
const previews = new Map<string, string>();
function presetPreview( name: string ) {
  let url = previews.get( name );
  if ( url ) return url;
  const p                = PAINT_PRESETS.find( ( x ) => x.name === name )!;
  const W                = 96, H = 32;
  const px               = new Uint8Array( W * W * 4 );
  const store: TileStore = { size: W, get: ( tx, ty ) => ( tx === 0 && ty === 0 ? px : null ), make: () => px, changed: () => {} };
  const s                = new EngineStroke( store, {
    kind: "paint", brush:  { ...mergeBrush( p.brush ), patternScale: 1, airbrush: 0, pressureSize: false }, radius: 5, hardness: p.hardness, strength: p.strength,
    mode: "mix",   colour: [0.92, 0.92, 0.92], colour2: [0.4, 0.4, 0.4], patternPx: 24, base: [0, 0, 0], seed: 7,
  } );
  for ( let k = 0; k <= 40; k++ ) {
    const t = k / 40;
    s.move( { x: 8 + t * 80, y: H / 2 + Math.sin( t * Math.PI * 2 ) * 8, pressure: 1 } );
  }
  s.end();
  const canvas  = document.createElement( "canvas" );
  canvas.width  = W;
  canvas.height = H;
  const img     = new ImageData( W, H );
  for ( let y = 0; y < H; y++ ) img.data.set( px.subarray( y * W * 4, ( y + 1 ) * W * 4 ), y * W * 4 );
  canvas.getContext( "2d" )!.putImageData( img, 0, 0 );
  url = canvas.toDataURL();
  previews.set( name, url );
  return url;
}

const Field = ( { label, children }: { label: string; children: ReactNode } ) => (
  <>
    <label>{label}</label>
    <div>{children}</div>
  </>
);
// the corduroy brush's ways of setting the direction
const FLOW_DIRS: { value: "drag" | "lock" | "fixed" | "smooth"; label: string }[] = [
  { value: "drag",   label: "Along the drag" },
  { value: "lock",   label: "First drag, held" },
  { value: "fixed",  label: "Set angle" },
  { value: "smooth", label: "Smooth" },
];

const Check = ( { value, onChange, label }: { value: boolean; onChange: ( v: boolean ) => void; label: string } ) => (
  <label className="check">
    <input type="checkbox" checked={value} onChange={( e ) => onChange( e.target.checked )} /> {label}
  </label>
);

export function PaintProperties() {
  const p                 = useEditor( ( s ) => s.paint );
  const st                = useEditor.getState();
  const set               = st.setPaint;
  const b                 = p.brush;
  const setB              = ( x: Partial<PaintBrush> ) => set( { brush: { ...b, ...x } } );
  const [fall, setFall]   = useState<Snowfall>( { rockFrom: 35, rockFull: 50, crevices: 0.5, lineLow: null, lineHigh: null } );
  const setF              = ( x: Partial<Snowfall> ) => setFall( { ...fall, ...x } );
  const info              = PAINT_TOOLS.find( ( t ) => t.id === p.tool )!;
  const onPiece           = useEditor( ( s ) => s.tool === "material" );
  const colourTool        = onPiece;
  const run               = async ( what: string, f: () => Promise<void> | void ) => {
    st.setBusy( `${what}…` );
    await new Promise( ( r ) => requestAnimationFrame( () => requestAnimationFrame( r ) ) );
    try {
      await f();
    } catch ( e ) {
      st.toast( `Couldn't do that: ${e}`, "error" );
    } finally {
      st.setBusy( null );
    }
  };
  const slider = ( v: number, onChange: ( v: number ) => void, min = 0, max = 1, fmt?: ( v: number ) => string ) => (
    <NumSlider value={v} min={min} max={max} fmt={fmt} onChange={onChange} />
  );
  const pct = ( v: number ) => `${Math.round( v * 100 )}%`;
  return (
    <Panel icon={info.icon} title={`Paint · ${info.label}`}>
      <div className="props">
        { colourTool && (
          <>
            <div className="section">Brush</div>
            <div className="preset-grid">
              { PAINT_PRESETS.map( ( x ) => (
                <button key={x.name} className={p.preset === x.name ? "on" : ""} onClick={() => applyPaintPreset( x.name )}>
                  <img src={presetPreview( x.name )} alt="" />
                  <span>{x.name}</span>
                </button>
              ) ) }
            </div>
          </>
        ) }
        { p.tool === "marking" && !onPiece && (
          <>
            <div className="section">Colour</div>
            <MarkingSwatches />
          </>
        ) }
        { onPiece && (
          <>
            <div className="section">Colour</div>
            <ColourPicker value={p.rgb} recent={p.recent} onChange={( rgb ) => set( { rgb } )} />
            <Field label="Second colour">
              <ColourChip value={p.rgb2} recent={p.recent} onChange={( rgb2 ) => set( { rgb2 } )} />
            </Field>
            <Field label="Blend">
              <Dropdown value={p.blend} menuTitle="Blend" options={BLENDS} onChange={( blend ) => set( { blend } )} />
            </Field>
          </>
        ) }

        <div className="section">{colourTool ? "Size and strength" : "Brush"}</div>
        <Field label="Radius">
          <NumberField value={p.radius} step={0.05} min={0.03} max={500} unit="m" onChange={( radius ) => set( { radius } )} />
        </Field>
        <Field label={onPiece ? "Opacity" : "Strength"}>{slider( p.strength, ( strength ) => set( { strength } ), 0.01, 1 )}</Field>
        {colourTool && <Field label="Flow">{slider( b.flow, ( flow ) => setB( { flow } ), 0.01, 1 )}</Field>}
        { !colourTool && (
          <Field label="Falloff">
            <Dropdown value={p.falloff} menuTitle="Falloff" options={Object.entries( FALLOFFS ).map( ( [id, f] ) => ( { value: id as typeof p.falloff, label: f.label } ) )} onChange={( falloff ) => set( { falloff } )} />
          </Field>
        ) }
        <Field label="Hardness">{slider( p.hardness, ( hardness ) => set( { hardness } ) )}</Field>
        {( p.tool === "powder" || p.tool === "grip" ) && <Field label="Depth">{slider( p.powder, ( powder ) => set( { powder } ), 0, 1, ( v ) => `${( v * 100 ).toFixed( 0 )} cm` )}</Field>}
        { p.tool === "flow" && !onPiece && (
          <>
            <Field label="Direction">
              <Dropdown value={p.flowDir} menuTitle="Direction" options={FLOW_DIRS} onChange={( flowDir ) => set( { flowDir } )} />
            </Field>
            { p.flowDir === "fixed" && (
              <Field label="Angle">
                <NumberField value={p.flowAngle} step={1} min={0} max={359} digits={0} unit="°" onChange={( flowAngle ) => set( { flowAngle } )} />
              </Field>
            ) }
          </>
        ) }

        { !onPiece && (
          <>
            <div className="section">Stroke</div>
            <Field label="Stabilize">
              <NumberField value={p.stabilize} step={0.05} min={0} max={5} onChange={( stabilize ) => set( { stabilize } )} />
            </Field>
            <Field label="Stripes">
              <div style={{ display: "flex", gap: 6 }}>
                <NumberField value={p.stripes.count} step={1} min={1} max={12} digits={0} onChange={( count ) => set( { stripes: { ...p.stripes, count: Math.round( count ) } } )} />
                <NumberField value={p.stripes.spacing} step={0.5} min={0.1} max={100} unit="m" onChange={( spacing ) => set( { stripes: { ...p.stripes, spacing } } )} />
              </div>
            </Field>
            <div className="section">Symmetry</div>
            <Field label="Mirror">
              <div style={{ display: "flex", gap: 10 }}>
                <Check value={p.symmetry.x} onChange={( x ) => set( { symmetry: { ...p.symmetry, x } } )} label="Left ↔ right" />
                <Check value={p.symmetry.z} onChange={( z ) => set( { symmetry: { ...p.symmetry, z } } )} label="Front ↔ back" />
              </div>
            </Field>
            <Field label="Radial">
              <NumberField value={p.symmetry.radial} step={1} min={1} max={12} digits={0} onChange={( radial ) => set( { symmetry: { ...p.symmetry, radial: Math.round( radial ) } } )} />
            </Field>
            <Field label="Centre">
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span className="muted">{p.symmetry.pivot ? `${p.symmetry.pivot[0].toFixed( 1 )}, ${p.symmetry.pivot[1].toFixed( 1 )}` : "map centre"}</span>
                <button className="btn small" title="The ground in the middle of the view" onClick={() => { const c = getEngine()?.groundAtViewCentre(); if ( c ) set( { symmetry: { ...p.symmetry, pivot: c } } ); }}>View centre</button>
                {p.symmetry.pivot && <button className="btn small" onClick={() => set( { symmetry: { ...p.symmetry, pivot: null } } )}>Map centre</button>}
              </div>
            </Field>
          </>
        ) }

        { colourTool && (
          <>
            <div className="section">Tip</div>
            <Field label="Shape">
              <Dropdown value={b.tip} menuTitle="Tip" options={TIPS.map( ( t ) => ( { value: t.id, label: t.label } ) )} onChange={( tip ) => setB( { tip } )} />
            </Field>
            <Field label="Angle">
              <NumberField value={b.angle} step={1} min={-180} max={180} digits={0} unit="°" onChange={( angle ) => setB( { angle } )} />
            </Field>
            <Field label="Roundness">{slider( b.roundness, ( roundness ) => setB( { roundness } ), 0.05, 1, pct )}</Field>
            <Field label="Spacing">{slider( b.spacing, ( spacing ) => setB( { spacing } ), 0.01, 2, pct )}</Field>

            <div className="section">Dynamics</div>
            <Field label="Size jitter">{slider( b.sizeJitter, ( sizeJitter ) => setB( { sizeJitter } ), 0, 1, pct )}</Field>
            <Field label="Minimum size">{slider( b.minSize, ( minSize ) => setB( { minSize } ), 0, 1, pct )}</Field>
            <Field label="Angle jitter">{slider( b.angleJitter, ( angleJitter ) => setB( { angleJitter } ), 0, 1, pct )}</Field>
            <Field label="Roundness jitter">{slider( b.roundnessJitter, ( roundnessJitter ) => setB( { roundnessJitter } ), 0, 1, pct )}</Field>
            <Field label=""><Check value={b.followStroke} onChange={( followStroke ) => setB( { followStroke } )} label="Tip follows the stroke" /></Field>
            <Field label="Pen pressure">
              <div className="checks">
                <Check value={b.pressureSize} onChange={( pressureSize ) => setB( { pressureSize } )} label="Size" />
                <Check value={b.pressureOpacity} onChange={( pressureOpacity ) => setB( { pressureOpacity } )} label="Opacity" />
              </div>
            </Field>

            <div className="section">Scatter</div>
            <Field label="Scatter">{slider( b.scatter, ( scatter ) => setB( { scatter } ), 0, 3, pct )}</Field>
            <Field label=""><Check value={b.scatterBothAxes} onChange={( scatterBothAxes ) => setB( { scatterBothAxes } )} label="Both axes" /></Field>
            <Field label="Count">
              <NumberField value={b.count} step={1} min={1} max={16} digits={0} onChange={( count ) => setB( { count: Math.round( count ) } )} />
            </Field>

            <div className="section">Texture</div>
            <Field label="Pattern">
              <Dropdown value={b.pattern} menuTitle="Pattern" options={[{ value: "none" as const, label: "None" }, ...PATTERNS.map( ( x ) => ( { value: x.id, label: x.label } ) )]} onChange={( pattern ) => setB( { pattern } )} />
            </Field>
            { b.pattern !== "none" && (
              <>
                <Field label="Scale">
                  <NumberField value={b.patternScale} step={0.05} min={0.05} max={50} unit="m" onChange={( patternScale ) => setB( { patternScale } )} />
                </Field>
                <Field label="Depth">{slider( b.patternDepth, ( patternDepth ) => setB( { patternDepth } ), 0, 1, pct )}</Field>
                <Field label="Mode">
                  <Dropdown value={b.patternMode} menuTitle="Mode" options={TEXTURE_MODES} onChange={( patternMode ) => setB( { patternMode } )} />
                </Field>
                <Field label=""><Check value={b.patternInvert} onChange={( patternInvert ) => setB( { patternInvert } )} label="Invert" /></Field>
              </>
            ) }

            { onPiece && (
              <>
                <div className="section">Colour variation</div>
                <Field label="Second colour">{slider( b.secondJitter, ( secondJitter ) => setB( { secondJitter } ), 0, 1, pct )}</Field>
                <Field label="Hue">{slider( b.hueJitter, ( hueJitter ) => setB( { hueJitter } ), 0, 1, pct )}</Field>
                <Field label="Saturation">{slider( b.saturationJitter, ( saturationJitter ) => setB( { saturationJitter } ), 0, 1, pct )}</Field>
                <Field label="Value">{slider( b.valueJitter, ( valueJitter ) => setB( { valueJitter } ), 0, 1, pct )}</Field>
              </>
            ) }

            <div className="section">Stroke</div>
            <Field label="Smoothing">{slider( b.smoothing, ( smoothing ) => setB( { smoothing } ), 0, 3, pct )}</Field>
            <Field label="Airbrush">
              <NumberField value={b.airbrush} step={1} min={0} max={200} digits={0} unit="/s" onChange={( airbrush ) => setB( { airbrush: Math.round( airbrush ) } )} />
            </Field>
            <Field label="">
              <div className="checks">
                <Check value={b.wetEdges} onChange={( wetEdges ) => setB( { wetEdges } )} label="Wet edges" />
                <Check value={b.noise} onChange={( noise ) => setB( { noise } )} label="Noise" />
              </div>
            </Field>
          </>
        ) }

        {!onPiece && <div className="section">Fill the whole map</div>}
        { !onPiece && (
          <>
            <Field label="Rock from">
              <div style={{ display: "flex", gap: 6 }}>
                <NumberField value={fall.rockFrom} step={1} min={5} max={85} digits={0} unit="°" onChange={( rockFrom ) => setF( { rockFrom } )} />
                <NumberField value={fall.rockFull} step={1} min={5} max={89} digits={0} unit="°" onChange={( rockFull ) => setF( { rockFull } )} />
              </div>
            </Field>
            <Field label="Crevices">{slider( fall.crevices, ( crevices ) => setF( { crevices } ), 0, 1, pct )}</Field>
            <Field label="Snow line">
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Check value={fall.lineLow !== null} onChange={( on ) => setF( on ? { lineLow: 0, lineHigh: 20 } : { lineLow: null, lineHigh: null } )} label="" />
                { fall.lineLow !== null && (
                  <>
                    <NumberField value={fall.lineLow} step={1} unit="m" onChange={( lineLow ) => setF( { lineLow } )} />
                    <NumberField value={fall.lineHigh ?? fall.lineLow + 20} step={1} unit="m" onChange={( lineHigh ) => setF( { lineHigh } )} />
                  </>
                ) }
              </div>
            </Field>
            <Field label="Snowfall">
              <button className="btn small" onClick={() => run( "Letting the snow fall", () => snowfall( fall ) )}>Apply</button>
            </Field>
          </>
        ) }
        { !onPiece && <Field label="Corduroy">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn small" onClick={() => run( "Laying the corduroy downhill", flowDownhill )}>Downhill</button>
            <button className="btn small" onClick={() => run( "Laying the corduroy along the trails", flowAlongTrails )}>Along trails</button>
          </div>
        </Field> }
        { !onPiece && <Field label="Powder">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn small" title={`Powder ${Math.round( p.powder * 100 )} cm deep everywhere`} onClick={() => run( "Covering everything in powder", () => allPowder( p.powder ) )}>All</button>
            <button className="btn small" title={`Powder ${Math.round( p.powder * 100 )} cm deep off the trails and marked pistes`} onClick={() => run( "Powder off the pistes", () => allPowder( p.powder, true ) )}>Off piste</button>
          </div>
        </Field> }
        { !onPiece && <Field label="Reset">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn small" onClick={() => run( "Covering everything in snow", allSnow )}>All snow</button>
            <button className="btn small" onClick={() => run( "Clearing markings", clearMarkings )}>Clear markings</button>
            <button className="btn small" onClick={() => run( "Clearing powder", clearPowder )}>Clear powder</button>
            <button className="btn small" onClick={() => run( "Clearing grip", clearGrip )}>Clear grip</button>
          </div>
        </Field> }
      </div>
    </Panel>
  );
}
