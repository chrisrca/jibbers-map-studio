// The Material tab's weathering panels for a modelled piece's paint: Edge Wear, Scratches and Dirt, each its settings
// and Generate ( texture/weathering.ts ). Rows called as a function ( each heading its own panel of the tab ), their settings
// in a store of their own, kept while the app runs.

import { create } from "zustand";
import type { CustomObjectEntry } from "../../core/types";
import type { ModelData } from "../../model/build";
import { DEFAULT_DIRT, DEFAULT_EDGE_WEAR, DEFAULT_SCRATCHES, dirt, edgeWear, scratches, type Dirt, type EdgeWear, type Scratches } from "../../texture/weathering";
import { useEditor } from "../../map/store";
import { NumberField } from "../widgets/controls";
import { ColourChip } from "../widgets/ColourPicker";
import { NumSlider } from "../widgets/widgets";

type Piece = CustomObjectEntry & { model: ModelData };

export interface WeatherSettings {
  wear:      EdgeWear;
  scratches: Scratches;
  dirt:      Dirt;
}

export const useWeather = create<WeatherSettings>( () => ( {
  wear:      { ...DEFAULT_EDGE_WEAR },
  scratches: { ...DEFAULT_SCRATCHES },
  dirt:      { ...DEFAULT_DIRT },
} ) );

const setWear      = ( p: Partial<EdgeWear>  ) => useWeather.setState( ( s ) => ( { wear:      { ...s.wear,      ...p } } ) );
const setScratches = ( p: Partial<Scratches> ) => useWeather.setState( ( s ) => ( { scratches: { ...s.scratches, ...p } } ) );
const setDirt      = ( p: Partial<Dirt>      ) => useWeather.setState( ( s ) => ( { dirt:      { ...s.dirt,      ...p } } ) );

/**
 * A generator run under the busy veil ( a big texture takes a moment ).
**/
async function run( what: string, f: () => void ) {
  const st = useEditor.getState();
  st.setBusy( what );
  await new Promise( ( r ) => requestAnimationFrame( () => requestAnimationFrame( r ) ) );
  try {
    f();
  } finally {
    st.setBusy( null );
  }
}

const colour = ( v: [number, number, number], set: ( c: [number, number, number] ) => void ) => (
  <>
    <label>Color</label>
    <div>
      <ColourChip value={v} onChange={set} />
    </div>
  </>
);
const seed = ( v: number, set: ( n: number ) => void ) => (
  <>
    <label>Seed</label>
    <NumberField value={v} step={1} min={0} max={9999} digits={0} onChange={set} />
  </>
);
const generate = ( label: string, f: () => void ) => (
  <>
    <label />
    <button className="btn" onClick={() => run( `${label}…`, f )}>Generate</button>
  </>
);

/**
 * The three panels' rows ( `w`: their settings, from useWeather ).
**/
export function weatherRows( o: Piece, w: WeatherSettings ) {
  const { wear: e, scratches: s, dirt: d } = w;
  return (
    <>
      <div className="section">Edge Wear</div>
      {colour( e.colour, ( c ) => setWear( { colour: c } ) )}
      <label>Width</label>
      <NumberField value={e.width} step={0.005} min={0.005} max={1} digits={3} unit="m" onChange={( width ) => setWear( { width } )} />
      <label>Amount</label>
      <NumSlider value={e.amount} min={0} max={1} onChange={( amount ) => setWear( { amount } )} />
      <label>Top Scuffs</label>
      <NumSlider value={e.top} min={0} max={1} onChange={( top ) => setWear( { top } )} />
      <label>Blotch Size</label>
      <NumberField value={e.scale} step={0.01} min={0.02} max={2} digits={2} unit="m" onChange={( scale ) => setWear( { scale } )} />
      <label>Metallic</label>
      <NumSlider value={e.metal} min={0} max={1} onChange={( metal ) => setWear( { metal } )} />
      <label>Roughness</label>
      <NumSlider value={e.rough ?? 0.5} min={0} max={1} onChange={( rough ) => setWear( { rough } )} />
      {seed( e.seed, ( v ) => setWear( { seed: v } ) )}
      {generate( "Edge Wear", () => edgeWear( o, useWeather.getState().wear ) )}

      <div className="section">Scratches</div>
      {colour( s.colour, ( c ) => setScratches( { colour: c } ) )}
      <label>Count</label>
      <NumberField value={s.count} step={10} min={1} max={2000} digits={0} onChange={( count ) => setScratches( { count } )} />
      <label>Length</label>
      <NumberField value={s.length} step={0.01} min={0.01} max={5} digits={2} unit="m" onChange={( length ) => setScratches( { length } )} />
      <label>Width</label>
      <NumberField value={s.width} step={0.001} min={0.001} max={0.2} digits={3} unit="m" onChange={( width ) => setScratches( { width } )} />
      <label>Depth</label>
      <NumSlider value={s.depth} min={0} max={1} onChange={( depth ) => setScratches( { depth } )} />
      <label>On Top</label>
      <NumSlider value={s.top} min={0} max={1} onChange={( top ) => setScratches( { top } )} />
      <label>Metallic</label>
      <NumSlider value={s.metal} min={0} max={1} onChange={( metal ) => setScratches( { metal } )} />
      <label>Roughness</label>
      <NumSlider value={s.rough ?? 0.5} min={0} max={1} onChange={( rough ) => setScratches( { rough } )} />
      {seed( s.seed, ( v ) => setScratches( { seed: v } ) )}
      {generate( "Scratches", () => scratches( o, useWeather.getState().scratches ) )}

      <div className="section">Dirt</div>
      {colour( d.colour, ( c ) => setDirt( { colour: c } ) )}
      <label>Amount</label>
      <NumSlider value={d.amount} min={0} max={1} onChange={( amount ) => setDirt( { amount } )} />
      <label>Corners</label>
      <NumberField value={d.crevice} step={0.01} min={0.005} max={2} digits={2} unit="m" onChange={( crevice ) => setDirt( { crevice } )} />
      <label>From Bottom</label>
      <NumSlider value={d.bottom} min={0} max={1} onChange={( bottom ) => setDirt( { bottom } )} />
      <label>Streaks</label>
      <NumSlider value={d.streaks} min={0} max={1} onChange={( streaks ) => setDirt( { streaks } )} />
      <label>Patch Size</label>
      <NumberField value={d.scale} step={0.01} min={0.02} max={4} digits={2} unit="m" onChange={( scale ) => setDirt( { scale } )} />
      <label>Roughness</label>
      <NumSlider value={d.rough ?? 0.9} min={0} max={1} onChange={( rough ) => setDirt( { rough } )} />
      {seed( d.seed, ( v ) => setDirt( { seed: v } ) )}
      {generate( "Dirt", () => dirt( o, useWeather.getState().dirt ) )}
    </>
  );
}
