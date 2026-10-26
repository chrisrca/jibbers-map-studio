// Texture Paint's header ( the Material workspace ): the brush, its colours and blend, the texture view, the decal and
// stencil.

import { open } from "@tauri-apps/plugin-dialog";
import { useEditor } from "../../map/store";
import { PAINT_PRESETS } from "../../paint/engine/brush";
import { clearStencil, loadDecal, loadStencil, useDecal, useStencil } from "../../texture/stencil";
import { applyPaintPreset } from "../panels/PaintProperties";
import { useTexView } from "../panels/TextureView";
import { getEngine } from "../Viewport";
import { ColourChip } from "../widgets/ColourPicker";
import { Slider } from "../widgets/controls";
import { Icon } from "../widgets/icons";
import { Dropdown } from "../widgets/widgets";
import { BLENDS } from "./tools";

/**
 * Texture Paint's settings ( the Assets header's second row ): which map, the brush, its colours.
**/
export function TexturePaintSettings() {
  const p   = useEditor( ( s ) => s.paint );
  const set = useEditor.getState().setPaint;
  return (
    <>
      <Dropdown
        value={p.channel}
        menuTitle="Paint"
        title="Which map"
        options={[
          { value: "colour" as const,    label: "Colour" },
          { value: "metallic" as const,  label: "Metallic" },
          { value: "roughness" as const, label: "Roughness" },
          { value: "height" as const,    label: "Height" },
        ]}
        onChange={( channel ) => set( { channel } )}
      />
      {p.texTool === "brush" && <Dropdown value={p.preset} menuTitle="Brush" options={PAINT_PRESETS.map( ( x ) => ( { value: x.name, label: x.name } ) )} onChange={( name ) => applyPaintPreset( name )} />}
      {p.texTool === "brush" && <Slider label="Radius" log value={p.radius} min={0.005} max={5} step={0.005} onChange={( radius ) => set( { radius } )} fmt={( v ) => ( v < 1 ? `${Math.round( v * 100 )} cm` : `${v.toFixed( 2 )} m` )} />}
      <Slider label="Strength" value={p.strength} min={0.01} max={1} step={0.01} onChange={( strength ) => set( { strength } )} fmt={( v ) => v.toFixed( 2 )} />
      {p.texTool === "decal" && <DecalControls />}
      {p.texTool === "fill" && <Slider label="Tolerance" value={p.tolerance} min={0} max={1} step={0.01} onChange={( tolerance ) => set( { tolerance } )} fmt={( v ) => v.toFixed( 2 )} />}
      { p.texTool === "gradient" && (
        <>
          <Dropdown value={p.gradient.shape} menuTitle="Gradient Type" options={[{ value: "linear" as const, label: "Linear" }, { value: "radial" as const, label: "Radial" }]} onChange={( shape ) => set( { gradient: { ...p.gradient, shape } } )} />
          <Dropdown value={p.gradient.to} menuTitle="Gradient" options={[{ value: "fade" as const, label: "Fade Out" }, { value: "second" as const, label: "Two Colours" }]} onChange={( to ) => set( { gradient: { ...p.gradient, to } } )} />
        </>
      ) }
      { p.channel === "colour" ? (
        <>
          <ColourChip value={p.rgb} recent={p.recent} onChange={( rgb ) => set( { rgb } )} />
          <button className="btn ghost small" title="Swap colours (X)" onClick={() => set( { rgb: p.rgb2, rgb2: p.rgb } )}><Icon name="swap" size={13} /></button>
          <ColourChip value={p.rgb2} recent={p.recent} onChange={( rgb2 ) => set( { rgb2 } )} />
        </>
      ) : (
        <Slider label="Value" value={p.value} min={0} max={1} step={0.01} onChange={( value ) => set( { value } )} fmt={( v ) => v.toFixed( 2 )} />
      ) }
      {p.texTool === "brush" && <Dropdown value={p.blend} menuTitle="Blend" options={BLENDS} onChange={( blend ) => set( { blend } )} />}
      <span className="spacer" />
      <StencilControls />
      <TexViewButton />
    </>
  );
}

/**
 * Opens or closes the Image view beside the 3D view.
**/
function TexViewButton() {
  const open = useTexView( ( s ) => s.open );
  return (
    <button className={`btn ghost small${open ? " on" : ""}`} title="Image" onClick={() => useTexView.setState( { open: !open } )}><Icon name="texture" size={14} /></button>
  );
}

/**
 * The Decal tool's image ( picked from a file ), its size on the piece and its turn.
**/
function DecalControls() {
  const d    = useDecal();
  const pick = async () => {
    const file = await open( { title: "Decal image", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "tga", "bmp", "webp"] }] } );
    if ( typeof file === "string" ) await loadDecal( file );
  };
  return (
    <>
      <button className="btn ghost small decal-pick" title={d.img?.name ?? "Decal image"} onClick={pick}>
        {d.img ? <img src={d.img.url} alt="" draggable={false} /> : <><Icon name="image" size={14} /> Image</>}
      </button>
      <Slider label="Size" log value={d.size} min={0.01} max={10} step={0.01} onChange={( size ) => useDecal.setState( { size } )} fmt={( v ) => ( v < 1 ? `${Math.round( v * 100 )} cm` : `${v.toFixed( 2 )} m` )} />
      <Slider label="Rotation" value={( d.angle * 180 ) / Math.PI} min={-180} max={180} step={1} onChange={( v ) => useDecal.setState( { angle: ( v * Math.PI ) / 180 } )} fmt={( v ) => `${Math.round( v )}°`} />
    </>
  );
}

/**
 * The stencil: an image to paint through ( or press on whole ), placed over the view.
**/
function StencilControls() {
  const s    = useStencil();
  const pick = async () => {
    const file = await open( { title: "Stencil image", filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "tga", "bmp", "webp"] }] } );
    const eng  = getEngine();
    const r    = eng?.renderer.domElement.getBoundingClientRect();
    if ( typeof file === "string" && r ) await loadStencil( file, r.width, r.height );
  };
  if ( !s.img )
    return (
      <button className="btn ghost small" title="Stencil" onClick={pick}><Icon name="image" size={14} /></button>
    );
  return (
    <div className="seg">
      <button title={s.img.name} onClick={pick}><Icon name="image" size={14} /></button>
      <button className={s.adjust ? "on" : ""} title="Place the stencil" onClick={() => useStencil.setState( { adjust: !s.adjust } )}><Icon name="move" size={14} /></button>
      <Slider label="Show" value={s.opacity} min={0} max={1} step={0.01} onChange={( opacity ) => useStencil.setState( { opacity } )} fmt={( v ) => v.toFixed( 2 )} />
      <button title="Press the whole stencil on" onClick={() => getEngine()?.meshPainter.applyStencil()}>Apply</button>
      <button title="Remove the stencil" onClick={clearStencil}><Icon name="close" size={14} /></button>
    </div>
  );
}
