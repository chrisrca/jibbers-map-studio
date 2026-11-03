// A fence's path and style ( pieces/fence.ts ): a repeat ( Make Repeat ) whether it closes and its section's length,
// riding as any piece ( the Riding section ); a fence made here its presets, posts, what's between them and colours. Any
// change makes the fence again over the ground.

import { useState } from "react";
import type { CustomObjectEntry } from "../../../core/types";
import { useEditor } from "../../../map/store";
import { fenceOf, FENCE_PRESETS, isRepeat, type FenceData, type FenceStyle } from "../../../pieces/fence";
import { pieceName } from "../../../map/names";
import { getEngine } from "../../Viewport";
import { withPath } from "../../../viewport/tools/fenceTool";
import { ColourChip } from "../../widgets/ColourPicker";
import { NumberField } from "../../widgets/controls";
import { Dropdown } from "../../widgets/widgets";

export function FenceRows( { o, set, commit }: { o: CustomObjectEntry; set: ( f: ( x: CustomObjectEntry ) => CustomObjectEntry ) => void; commit: () => void } ) {
  const f                   = fenceOf( o )!;
  const s                   = f.style;
  const [heights, setText]  = useState( s.infill.heights.join( ", " ) );
  const put                 = ( p: Partial<FenceData> ) => set( ( x ) => withPath( x, { ...fenceOf( x )!, ...p } ) );
  const style               = ( p: Partial<FenceStyle> ) => put( { style: { ...s, ...p } } );
  const post                = ( p: Partial<FenceStyle["post"]> ) => style( { post: { ...s.post, ...p } } );
  const infill              = ( p: Partial<FenceStyle["infill"]> ) => style( { infill: { ...s.infill, ...p } } );
  const st                  = useEditor.getState();
  // ( the map's other pieces, for posts or panels made from them )
  const pieces = st.customObjects.filter( ( x ) => x.uid !== o.uid && !fenceOf( x ) && !x.parts.some( ( p ) => p.mesh.startsWith( "Scenery/" ) ) ).map( ( x ) => ( { value: x.uid, label: pieceName( st, x ) } ) );
  const seg    = <T extends string>( value: T, options: [T, string][], onPick: ( v: T ) => void ) => (
    <div className="seg">
      {options.map( ( [id, label] ) => <button key={id} className={value === id ? "on" : ""} onClick={() => { onPick( id ); commit(); }}>{label}</button> )}
    </div>
  );
  const num = ( v: number, onChange: ( v: number ) => void, step: number, min: number, max: number, unit = "m" ) => (
    <NumberField value={v} step={step} min={min} max={max} unit={unit} onChange={onChange} onCommit={commit} />
  );
  // ( a repeat's shape changed: its rail, if it has one, found along it again )
  const kept = () => {
    commit();
    void getEngine()?.fenceTool.railAgain( o.uid );
  };
  const loop = (
    <>
      <label />
      <label className="check"><input type="checkbox" checked={f.closed} onChange={( e ) => { put( { closed: e.target.checked } ); kept(); }} /> Closed loop</label>
    </>
  );
  // a repeat: the piece along the path, at its own length
  if ( isRepeat( f ) )
    return (
      <>
        <div className="section">Repeat</div>
        {loop}
        <label>Length</label>
        <NumberField value={s.infill.length ?? s.spacing} step={0.05} min={0.2} max={50} unit="m" onChange={( length ) => style( { spacing: length, infill: { ...s.infill, length } } )} onCommit={kept} />
      </>
    );
  const path = (
    <>
      <label />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn small" onClick={() => { put( {} ); commit(); }}>Fit to Ground</button>
      </div>
      {loop}
      <label />
      <label className="check"><input type="checkbox" checked={s.grind} onChange={( e ) => { style( { grind: e.target.checked } ); commit(); }} /> Grindable</label>
    </>
  );
  const postPiece = (
    <>
      <label>Post piece</label>
      <Dropdown value={s.post.piece ?? ""} menuTitle="Post piece" options={[{ value: "", label: "Pick a piece…" }, ...pieces]} onChange={( piece ) => { post( { piece: piece || undefined } ); commit(); }} />
    </>
  );
  return (
    <>
      <div className="section">Fence</div>
      <label>Preset</label>
      <Dropdown value="" menuTitle="Preset" options={[{ value: "", label: "Apply a preset…" }, ...FENCE_PRESETS.map( ( p ) => ( { value: p.name, label: p.name } ) )]} onChange={( name ) => {
        const p = FENCE_PRESETS.find( ( x ) => x.name === name );
        if ( !p ) return;
        put( { style: structuredClone( p.style ) } );
        setText( p.style.infill.heights.join( ", " ) );
        commit();
      }} />
      {path}

      <label>Spacing</label>
      {num( s.spacing, ( spacing ) => style( { spacing } ), 0.1, 0.3, 50 )}
      <label>Posts</label>
      {seg( s.post.kind, [["round", "Round"], ["square", "Square"], ["piece", "Piece"], ["none", "None"]], ( kind ) => post( { kind } ) )}
      { s.post.kind === "piece" && postPiece }
      { ( s.post.kind === "round" || s.post.kind === "square" ) && (
        <>
          <label>{s.post.kind === "round" ? "Radius" : "Half width"}</label>
          {num( s.post.size, ( size ) => post( { size } ), 0.005, 0.005, 1 )}
        </>
      ) }
      { s.post.kind !== "none" && s.post.kind !== "piece" && (
        <>
          <label>Height</label>
          {num( s.post.height, ( height ) => post( { height } ), 0.05, 0.1, 10 )}
          <label>Sunk in</label>
          {num( s.post.sink, ( sink ) => post( { sink } ), 0.05, 0, 3 )}
        </>
      ) }

      <label>Between</label>
      {seg( s.infill.kind, [["rails", "Rails"], ["net", "Net"], ["rope", "Rope"], ["panel", "Panel"], ["none", "None"]], ( kind ) => infill( { kind } ) )}
      { ( s.infill.kind === "rails" || s.infill.kind === "rope" ) && (
        <>
          <label>Heights</label>
          <input className="text" value={heights} onChange={( e ) => {
            setText( e.target.value );
            const hs = e.target.value.split( /[,\s]+/ ).map( Number ).filter( ( h ) => Number.isFinite( h ) && h >= 0 );
            if ( hs.length ) infill( { heights: hs } );
          }} onBlur={commit} />
          { s.infill.kind === "rails" && (
            <>
              <label>Profile</label>
              {seg( s.infill.profile, [["round", "Round"], ["square", "Square"], ["flat", "Flat"]], ( profile ) => infill( { profile } ) )}
            </>
          ) }
          <label>{s.infill.profile === "flat" && s.infill.kind === "rails" ? "Half height" : "Radius"}</label>
          {num( s.infill.size, ( size ) => infill( { size } ), 0.005, 0.003, 0.5 )}
          { s.infill.kind === "rope" && (
            <>
              <label>Sag</label>
              {num( s.infill.sag, ( sag ) => infill( { sag } ), 0.01, 0, 5 )}
            </>
          ) }
        </>
      ) }
      { s.infill.kind === "net" && (
        <>
          <label>Bottom</label>
          {num( s.infill.bottom, ( bottom ) => infill( { bottom } ), 0.05, 0, 10 )}
          <label>Top</label>
          {num( s.infill.top, ( top ) => infill( { top } ), 0.05, 0.1, 10 )}
          <label>Opacity</label>
          {num( s.netOpacity, ( netOpacity ) => style( { netOpacity } ), 0.05, 0.05, 1, "" )}
        </>
      ) }
      { s.infill.kind === "panel" && (
        <>
          <label>Panel piece</label>
          <Dropdown value={s.infill.piece ?? ""} menuTitle="Panel piece" options={[{ value: "", label: "Pick a piece…" }, ...pieces]} onChange={( piece ) => { infill( { piece: piece || undefined } ); commit(); }} />
          <label>Its length</label>
          {num( s.infill.length ?? 2, ( length ) => infill( { length } ), 0.05, 0.05, 50 )}
        </>
      ) }

      <label>Colours</label>
      <div style={{ display: "flex", gap: 6 }}>
        <ColourChip value={s.postColour} onChange={( postColour ) => { style( { postColour } ); commit(); }} />
        <ColourChip value={s.railColour} onChange={( railColour ) => { style( { railColour } ); commit(); }} />
        { s.infill.kind === "net" && <ColourChip value={s.netColour} onChange={( netColour ) => { style( { netColour } ); commit(); }} /> }
      </div>
    </>
  );
}
