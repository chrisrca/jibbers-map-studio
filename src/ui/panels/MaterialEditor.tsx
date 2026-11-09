// A piece's materials, as the game's custom-object shader takes them ( Map-Tools CustomObjectLit ): colour and textures
// ( base, normal, metallic, roughness, glow ), metallic and smoothness, tiling and offset, opaque / cutout /
// transparent, one or both sides, and the snow overlay. A change applies to every part of the piece using that material.

import { open } from "@tauri-apps/plugin-dialog";
import { ipc } from "../../core/ipc";
import { materialOverlay, withOverlay } from "../../core/overlay";
import { adjustOf, type CustomMaterial, type CustomObjectEntry, type PieceAdjust, type RGBA } from "../../core/types";
import type { ModelData } from "../../model/build";
import { editTexture, PAINT_SIZE, pieceTexture, resizeTexture } from "../../texture/meshPaint";
import { weatherRows, type WeatherSettings } from "../blender/WeatherPanels";
import { applyGameLook, canUseGameLook } from "../../pieces/library";
import { useEditor } from "../../map/store";
import { NumberField } from "../widgets/controls";
import { Icon } from "../widgets/icons";
import { getEngine } from "../Viewport";
import { Dropdown, NumSlider } from "../widgets/widgets";
import { ColourChip } from "../widgets/ColourPicker";

type Slot = "base_tex" | "normal_tex" | "metallic_tex" | "roughness_tex" | "emission_tex";

/**
 * The piece's distinct materials, in the order its parts use them.
**/
const slotsOf = ( o: CustomObjectEntry ) => [...new Set( o.parts.flatMap( ( p ) => p.materials.map( keyOf ) ) )];

// ( each material's text kept with it: a piece dragged about is drawn again every step, its materials the same ones )
const keys  = new WeakMap<CustomMaterial, string>();
const keyOf = ( m: CustomMaterial ) => {
  let k = keys.get( m );
  if ( k === undefined ) keys.set( m, ( k = JSON.stringify( m ) ) );
  return k;
};

const hex     = ( c:   RGBA   ) => `#${[c.r, c.g, c.b].map( ( v ) => Math.round( Math.min( 1, Math.max( 0, v ) ) * 255 ).toString( 16 ).padStart( 2, "0" ) ).join( "" )}`;
const texName = ( key: string ) => key.split( "/" ).pop()?.replace( /-[0-9a-f]{8}$/, "" ) || key;

/**
 * The rows of a piece's Material section ( called as a function, so the Properties editor folds them as a section of
 * their own ).
**/
// The adjustments under the Hue, as Photoshop names them
const ADJUSTS: [keyof PieceAdjust, string][] = [["saturation", "Saturation"], ["lightness", "Lightness"], ["brightness", "Brightness"], ["contrast", "Contrast"]];

/**
 * A piece's paint adjusted, in its Colour's picker: Hue ( round the colour wheel, as the game turns its own features' ),
 * Saturation, Lightness, Brightness and Contrast, as Photoshop has them. The whole piece, every slot; baked into
 * copies of its textures for the game ( project/hue.rs ).
**/
export function AdjustRows( { o, set, commit }: { o: CustomObjectEntry; set: ( f: ( x: CustomObjectEntry ) => CustomObjectEntry ) => void; commit: () => void } ) {
  const a   = o.adjust ?? {};
  const deg = ( ( o.hue ?? 0 ) * 360 ) % 360;
  const put = ( k: keyof PieceAdjust, v: number ) =>
    set( ( x ) => {
      const { adjust: _a, ...y } = x;
      const next: PieceAdjust    = { ...x.adjust, [k]: v };
      for ( const key of Object.keys( next ) as ( keyof PieceAdjust )[] ) if ( Math.abs( next[key] ?? 0 ) < 1e-4 ) delete next[key];
      return Object.keys( next ).length ? { ...y, adjust: next } : y;
    } );
  return (
    <div className="cpick-adjust">
      <div className="cpick-adjust-head">
        <span>Adjust</span>
        { adjustOf( o ) && (
          <button className="btn small" onClick={() => { set( ( x ) => { const { hue: _h, adjust: _a, ...y } = x; return y; } ); commit(); }}>Reset</button>
        ) }
      </div>
      <NumSlider
        label="Hue"
        value={deg > 180 ? deg - 360 : deg}
        min={-180}
        max={180}
        step={1}
        fmt={( v ) => `${Math.round( v )}°`}
        onChange={( v ) => set( ( x ) => {
          const { hue: _h, ...y } = x;
          const t                 = ( ( Math.round( v ) % 360 ) + 360 ) % 360;
          return t ? { ...y, hue: t / 360 } : y;
        } )}
        onCommit={commit}
      />
      { ADJUSTS.map( ( [k, label] ) => (
        <NumSlider key={k} label={label} value={( a[k] ?? 0 ) * 100} min={-100} max={100} step={1} fmt={( v ) => `${Math.round( v )}`} onChange={( v ) => put( k, Math.round( v ) / 100 )} onCommit={commit} />
      ) ) }
    </div>
  );
}

export function materialRows( { o, set, commit, slot, setSlot, weather }: {
  o:       CustomObjectEntry;
  weather: WeatherSettings;
  set:     ( f: ( x: CustomObjectEntry ) => CustomObjectEntry ) => void;
  commit:  () => void;
  slot:    number;
  setSlot: ( i: number ) => void;
} ) {
  const slots = slotsOf( o );
  const i     = Math.min( slot, slots.length - 1 );
  if ( i < 0 ) return null;
  const m      = JSON.parse( slots[i] ) as CustomMaterial;
  // every part's material that's this one ( found afresh in the latest piece: a drag changes it as it goes )
  const update = ( f: ( m: CustomMaterial ) => CustomMaterial ) =>
    set( ( x ) => {
      const k = slotsOf( x )[i];
      return { ...x, parts: x.parts.map( ( p ) => ( { ...p, materials: p.materials.map( ( mm ) => ( keyOf( mm ) === k ? f( mm ) : mm ) ) } ) ) };
    } );
  const field = <K extends keyof CustomMaterial>( k: K, v: CustomMaterial[K] ) => update( ( mm ) => ( { ...mm, [k]: v } ) );

  const pickTexture = async ( s: Slot ) => {
    const dir  = useEditor.getState().projectDir;
    const file = await open( { title: "Pick an image", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "tga", "bmp", "webp"] }] } );
    if ( !dir || typeof file !== "string" ) return;
    try {
      const key = await ipc.addTextureToProject( dir, file, s !== "base_tex" && s !== "emission_tex" );
      useEditor.setState( { library: "assets/library.jbrmap" } );
      getEngine()?.customR.reloadLibrary();
      // a texture on a black glow would show nothing: white lets it through
      update( ( mm ) => ( { ...mm, [s]: key, ...( s === "emission_tex" && ( mm.emission_color.r + mm.emission_color.g + mm.emission_color.b ) === 0 ? { emission_color: { r: 1, g: 1, b: 1, a: 1 } } : {} ) } ) );
      commit();
    } catch ( e ) {
      useEditor.getState().toast( `Couldn't use that image: ${e}`, "error" );
    }
  };
  const texture = ( s: Slot, label: string ) => {
    const key = ( m[s] as string ) ?? "";
    return (
      <>
        <label>{label}</label>
        <div className="tex-slot">
          <span className={key ? "" : "muted"} title={key || undefined}>{key ? texName( key ) : "None"}</span>
          <button className="btn small" title="Pick an image" onClick={() => pickTexture( s )}><Icon name="folderOpen" size={13} /></button>
          {key && <button className="btn small" title="Remove" onClick={() => { field( s, "" ); commit(); }}><Icon name="close" size={12} /></button>}
        </div>
      </>
    );
  };
  // ( the base colour's picker with the piece's paint adjustments under it )
  const colour = ( k: "base_color" | "emission_color", label: string ) => (
    <>
      <label>{label}</label>
      <div>
        <ColourChip value={[m[k].r, m[k].g, m[k].b]} onChange={( [r, g, b] ) => { field( k, { r, g, b, a: m[k].a } ); commit(); }}>
          {k === "base_color" && <AdjustRows o={o} set={set} commit={commit} />}
        </ColourChip>
      </div>
    </>
  );
  const overlay = !!materialOverlay( m );

  // a feature still in the placeholder's colour: the game's own meshes and paint for it ( and the others selected )
  const gameLook = canUseGameLook( o ) && (
    <>
      <label />
      <button
        className="btn small"
        onClick={async () => {
          const sel = useEditor.getState().selection.filter( ( s ) => s.kind === "custom" ).map( ( s ) => s.uid );
          await applyGameLook( sel.includes( o.uid ) ? sel : [o.uid] );
        }}
      >
        <Icon name="paintSnow" size={13} /> Game's paint
      </button>
    </>
  );

  return (
    <>
      <div className="section">Material</div>
      {gameLook}
      { slots.length > 1 && (
        <>
          <label>Slot</label>
          <Dropdown value={i} options={slots.map( ( s, k ) => ( { value: k, label: `${k + 1} · ${materialLabel( JSON.parse( s ) as CustomMaterial )}` } ) )} onChange={( v ) => setSlot( Number( v ) )} />
        </>
      ) }
      {colour( "base_color", "Colour" )}
      {texture( "base_tex", "Texture" )}
      {texture( "normal_tex", "Normal map" )}
      <label>Metallic</label>
      <NumSlider value={m.metallic} min={0} max={1} onChange={( v ) => field( "metallic", v )} onCommit={commit} />
      <label>Smoothness</label>
      <NumSlider value={m.smoothness} min={0} max={1} onChange={( v ) => field( "smoothness", v )} onCommit={commit} />
      {texture( "metallic_tex", "Metallic map" )}
      {texture( "roughness_tex", "Roughness map" )}
      <label>Tiling</label>
      <div className="pair">
        <NumberField value={m.tiling.x} step={0.1} onChange={( v ) => field( "tiling", { ...m.tiling, x: v } )} onCommit={commit} />
        <NumberField value={m.tiling.y} step={0.1} onChange={( v ) => field( "tiling", { ...m.tiling, y: v } )} onCommit={commit} />
      </div>
      <label>Offset</label>
      <div className="pair">
        <NumberField value={m.offset.x} step={0.05} onChange={( v ) => field( "offset", { ...m.offset, x: v } )} onCommit={commit} />
        <NumberField value={m.offset.y} step={0.05} onChange={( v ) => field( "offset", { ...m.offset, y: v } )} onCommit={commit} />
      </div>
      <label>Surface</label>
      <div className="seg">
        { ( ["Opaque", "Cutout", "Clear"] as const ).map( ( l, k ) => (
          <button key={l} className={m.render_mode === k ? "on" : ""} onClick={() => { field( "render_mode", k ); commit(); }}>{l}</button>
        ) ) }
      </div>
      { m.render_mode === 1 && (
        <>
          <label>Cutoff</label>
          <NumSlider value={m.alpha_cutoff} min={0} max={1} onChange={( v ) => field( "alpha_cutoff", v )} onCommit={commit} />
        </>
      ) }
      <label>Sides</label>
      <div className="seg">
        <button className={m.cull_mode !== 0 ? "on" : ""} onClick={() => { field( "cull_mode", 2 ); commit(); }}>Front</button>
        <button className={m.cull_mode === 0 ? "on" : ""} onClick={() => { field( "cull_mode", 0 ); commit(); }}>Both</button>
      </div>
      {colour( "emission_color", "Glow" )}
      {texture( "emission_tex", "Glow map" )}
      <label />
      <label style={{ color: "var(--text)" }}>
        <input type="checkbox" checked={overlay} onChange={( e ) => { update( ( mm ) => withOverlay( mm, e.target.checked ) ); commit(); }} /> Snow on top
      </label>
      {o.model && <div className="section">Paint</div>}
      {o.model && paintRows( o as CustomObjectEntry & { model: ModelData }, weather )}
    </>
  );
}

/**
 * A modelled piece's painted texture: its size, cleared; then weathering generated over it ( a panel each ). Called as a
 * function, so each of its headings is a panel of the editor it's in ( `weather`: the weathering's settings ).
**/
export function paintRows( o: CustomObjectEntry & { model: ModelData }, weather: WeatherSettings ) {
  return (
    <>
      <label>Texture Size</label>
      <Dropdown
        value={o.model.paint?.size ?? PAINT_SIZE}
        menuTitle="Texture Size"
        options={[512, 1024, 2048, 4096].map( ( v ) => ( { value: v, label: `${v} px` } ) )}
        onChange={( size ) => resizeTexture( o, size )}
      />
      <label />
      <button className="btn small" disabled={!pieceTexture( o.uid )} onClick={() => clearPaint( o )}>Clear Paint</button>
      {weatherRows( o, weather )}
    </>
  );
}

/**
 * Back to one colour all over ( the piece's ), one undo step.
**/
function clearPaint( o: CustomObjectEntry & { model: ModelData } ) {
  const c = [255, 255, 255];
  editTexture( o.uid, "Clear paint", ( T ) => {
    for ( let k = 0; k < T.n * T.n; k++ ) T.rgba.set( [c[0], c[1], c[2], 255], k * 4 );
  } );
}

/**
 * A material's short name: its texture's, else its colour.
**/
function materialLabel( m: CustomMaterial ) {
  if ( m.base_tex ) return texName( m.base_tex );
  return hex( m.base_color );
}
