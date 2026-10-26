// Properties editor › Brush tab in Paint mode: the paint brush's settings and the whole-map fills.

import { useState, type ReactNode } from "react";
import { allSnow, clearGrip, clearMarkings, clearPowder, rockOnSteep } from "../../paint/ground";
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
  const [steep, setSteep] = useState( 38 );
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
        { !onPiece && <Field label="Rock on steep">
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <div style={{ width: 60 }}>
              <NumberField value={steep} step={1} min={5} max={85} digits={0} unit="°" onChange={setSteep} />
            </div>
            <button className="btn small" onClick={() => run( "Painting rock on steep ground", () => rockOnSteep( steep ) )}>Apply</button>
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
