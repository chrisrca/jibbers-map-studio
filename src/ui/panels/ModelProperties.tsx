// Properties of a modelled piece: Blender's modifier stack, and its mesh ( smoothing, colliders, size ).

import type { CustomObjectEntry } from "../../core/types";
import { evaluate, MODIFIERS, type ModelData, type Modifier } from "../../model/build";
import { builtOf, lodPreview, withModel } from "../../model/objects";
import { useEffect, useState } from "react";
import { getEngine } from "../Viewport";
import { NumberField } from "../widgets/controls";
import { Icon } from "../widgets/icons";
import { Dropdown, MenuButton, NumSlider } from "../widgets/widgets";

type Set = ( f: ( x: CustomObjectEntry ) => CustomObjectEntry ) => void;

/**
 * The rows ( called, not rendered: the Properties panel groups them under their headings ).
**/
export function modelRows( { o, set, commit, only }: { o: CustomObjectEntry & { model: ModelData }; set: Set; commit: () => void; only?: "modifiers" | "data" } ) {
  const model  = o.model;
  const put    = ( m: Partial<ModelData> ) => set( ( x ) => ( x.model ? withModel( x, { ...x.model, ...m } ) : x ) );
  const putMod = ( i: number, p: Partial<Modifier> ) => put( { modifiers: model.modifiers.map( ( m, k ) => ( k === i ? ( { ...m, ...p } as Modifier ) : m ) ) } );
  const move   = ( i: number, d: number ) => {
    const list = [...model.modifiers];
    const j    = i + d;
    if ( j < 0 || j >= list.length ) return;
    [list[i], list[j]] = [list[j], list[i]];
    put( { modifiers: list } );
    commit();
  };
  const evaluated = evaluate( model );
  // ( Blender's X, Y, Z: the game's X, Z, Y — see core/blenderAxes.ts )
  const BL        = [0, 2, 1] as const;
  const axisBox   = ( m: Extract<Modifier, { type: "mirror" }>, i: number ) => (
    <div className="seg">
      { ( ["X", "Y", "Z"] as const ).map( ( l, b ) => {
        const k = BL[b];
        return <button key={l} className={m.axes[k] ? "on" : ""} onClick={() => { putMod( i, { axes: m.axes.map( ( a, j ) => ( j === k ? !a : a ) ) as [boolean, boolean, boolean] } ); commit(); }}>{l}</button>;
      } ) }
    </div>
  );
  const v3 = ( val: [number, number, number], onChange: ( v: [number, number, number] ) => void, step: number ) => (
    <div className="vec">
      { ( ["X", "Y", "Z"] as const ).map( ( l, b ) => {
        const k = BL[b];
        return <NumberField key={l} className={l.toLowerCase()} label={l} value={val[k]} step={step} onChange={( n ) => onChange( val.map( ( x, j ) => ( j === k ? n : x ) ) as [number, number, number] )} onCommit={commit} />;
      } ) }
    </div>
  );
  const c        = model.curve;
  const putCurve = ( p: Partial<NonNullable<ModelData["curve"]>> ) => put( { curve: { ...c!, ...p } } );
  return (
    <>
      { c && only !== "modifiers" && (
        <>
          <div className="section">Curve</div>
          <label>Profile</label>
          <div className="seg">
            { ( ["round", "square", "flat"] as const ).map( ( p ) => (
              <button key={p} className={c.profile === p ? "on" : ""} onClick={() => { putCurve( { profile: p } ); commit(); }}>{{ round: "Round", square: "Square", flat: "Flat bar" }[p]}</button>
            ) ) }
          </div>
          <label>{c.profile === "flat" ? "Half width" : "Radius"}</label>
          <NumberField value={c.radius} step={0.002} min={0.002} max={2} digits={3} unit="m" onChange={( radius ) => putCurve( { radius } )} onCommit={commit} />
          { c.profile === "flat" && (
            <>
              <label>Half thickness</label>
              <NumberField value={c.thickness} step={0.001} min={0.001} max={0.5} digits={3} unit="m" onChange={( thickness ) => putCurve( { thickness } )} onCommit={commit} />
            </>
          ) }
          { c.profile === "round" && (
            <>
              <label>Sides</label>
              <NumberField value={c.sides} step={1} min={3} max={64} digits={0} onChange={( sides ) => putCurve( { sides: Math.round( sides ) } )} onCommit={commit} />
            </>
          ) }
          <label>Smoothness</label>
          <NumberField value={c.resolution} step={1} min={1} max={64} digits={0} onChange={( resolution ) => putCurve( { resolution: Math.round( resolution ) } )} onCommit={commit} />
          <label />
          <label className="check"><input type="checkbox" checked={c.caps} onChange={( e ) => { putCurve( { caps: e.target.checked } ); commit(); }} /> Close the ends</label>
        </>
      ) }
      { only !== "data" && <>
      <div className="section">Modifiers</div>
      <label />
      <MenuButton
        label="Add Modifier"
        icon="plus"
        items={MODIFIERS.map( ( d ) => ( { label: d.label, run: () => { put( { modifiers: [...model.modifiers, d.make()] } ); commit(); } } ) )}
      />
      { model.modifiers.map( ( m, i ) => (
        <div key={i} className="modifier">
          <div className="mod-head">
            <input type="checkbox" checked={m.on} title="Show" onChange={( e ) => { putMod( i, { on: e.target.checked } ); commit(); }} />
            <span className="ttl">{MODIFIERS.find( ( d ) => d.type === m.type )!.label}</span>
            <button className="btn ghost small" title="Move up" onClick={() => move( i, -1 )}><Icon name="chevronUp" size={12} /></button>
            <button className="btn ghost small" title="Move down" onClick={() => move( i, 1 )}><Icon name="chevronDown" size={12} /></button>
            <button className="btn ghost small" title="Remove" onClick={() => { put( { modifiers: model.modifiers.filter( ( _, k ) => k !== i ) } ); commit(); }}><Icon name="close" size={12} /></button>
          </div>
          <div className="props">
            { m.type === "mirror" && (
              <>
                <label>Axis</label>
                {axisBox( m, i )}
                <label>Merge</label>
                <NumberField value={m.merge} step={0.001} min={0} digits={3} unit="m" onChange={( merge ) => putMod( i, { merge } )} onCommit={commit} />
              </>
            ) }
            { m.type === "array" && (
              <>
                <label>Count</label>
                <NumberField value={m.count} step={1} min={1} max={200} digits={0} onChange={( count ) => putMod( i, { count: Math.round( count ) } )} onCommit={commit} />
                <label>Relative offset</label>
                {v3( m.relative, ( relative ) => putMod( i, { relative } ), 0.05 )}
                <label>Constant offset</label>
                {v3( m.constant, ( constant ) => putMod( i, { constant } ), 0.05 )}
                <label />
                <label className="check"><input type="checkbox" checked={m.merge} onChange={( e ) => { putMod( i, { merge: e.target.checked } ); commit(); }} /> Merge</label>
              </>
            ) }
            { m.type === "solidify" && (
              <>
                <label>Thickness</label>
                <NumberField value={m.thickness} step={0.01} digits={3} unit="m" onChange={( thickness ) => putMod( i, { thickness } )} onCommit={commit} />
              </>
            ) }
            { m.type === "bevel" && (
              <>
                <label>Width</label>
                <NumberField value={m.width} step={0.005} min={0} digits={3} unit="m" onChange={( width ) => putMod( i, { width } )} onCommit={commit} />
                <label>Segments</label>
                <NumberField value={m.segments} step={1} min={1} max={12} digits={0} onChange={( segments ) => putMod( i, { segments: Math.round( segments ) } )} onCommit={commit} />
                <label>Angle</label>
                <NumberField value={m.angle} step={1} min={0} max={180} digits={0} unit="°" onChange={( angle ) => putMod( i, { angle } )} onCommit={commit} />
              </>
            ) }
            { m.type === "subsurf" && (
              <>
                <label>Levels</label>
                <NumberField value={m.levels} step={1} min={0} max={4} digits={0} onChange={( levels ) => putMod( i, { levels: Math.round( levels ) } )} onCommit={commit} />
              </>
            ) }
          </div>
        </div>
      ) ) }

      </> }

      { only !== "modifiers" && <>
      <div className="section">Mesh</div>
      <label>Auto smooth</label>
      <NumberField value={model.smoothAngle} step={1} min={0} max={180} digits={0} unit="°" onChange={( smoothAngle ) => put( { smoothAngle } )} onCommit={commit} />
      <label>Colliders</label>
      <Dropdown
        value={model.colliders}
        menuTitle="Colliders"
        options={[{ value: "auto" as const, label: "Fitted to the shape" }, { value: "none" as const, label: "None" }]}
        onChange={( colliders ) => { put( { colliders } ); commit(); }}
      />
      <label>Size</label>
      <span className="muted">{evaluated.v.length} vertices · {evaluated.f.length} faces · {o.colliders.length} collider{o.colliders.length === 1 ? "" : "s"}</span>

      <div className="section">Levels of Detail</div>
      <LodRows o={o} put={put} commit={commit} />
      </> }
    </>
  );
}

/**
 * The piece's levels of detail: how many, how much each keeps, and one shown in the viewport to judge it.
**/
function LodRows( { o, put, commit }: { o: CustomObjectEntry & { model: ModelData }; put: ( m: Partial<ModelData> ) => void; commit: () => void } ) {
  const lods              = o.model.lods ?? { levels: 0, keep: 0.5 };
  const [shown, setShown] = useState( lodPreview.get( o.uid ) ?? 0 );
  const show              = ( level: number ) => {
    if ( level ) lodPreview.set( o.uid, level );
    else lodPreview.delete( o.uid );
    setShown( level );
    getEngine()?.customR.refresh( o.uid );
  };
  useEffect( () => () => {
    // the full one again once the panel's gone
    if ( lodPreview.delete( o.uid ) ) getEngine()?.customR.refresh( o.uid );
  }, [o.uid] );
  const level = Math.min( shown, lods.levels );
  return (
    <>
      <label />
      <label className="check">
        <input type="checkbox" checked={lods.levels > 0} onChange={( e ) => { put( { lods: { ...lods, levels: e.target.checked ? 2 : 0 } } ); commit(); }} /> Levels of Detail
      </label>
      { lods.levels > 0 && (
        <>
          <label>Levels</label>
          <NumberField value={lods.levels} step={1} min={1} max={3} digits={0} onChange={( levels ) => put( { lods: { ...lods, levels: Math.round( levels ) } } )} onCommit={commit} />
          <label>Keep</label>
          <NumSlider value={lods.keep} min={0.1} max={0.9} onChange={( keep ) => put( { lods: { ...lods, keep } } )} onCommit={commit} fmt={( v ) => `${Math.round( v * 100 )}%`} />
          <label />
          <label className="check">
            <input type="checkbox" checked={!!lods.crossFade} onChange={( e ) => { put( { lods: { ...lods, crossFade: e.target.checked } } ); commit(); }} /> Cross-Fade
          </label>
          <label>Show</label>
          <div className="seg">
            { Array.from( { length: lods.levels + 1 }, ( _, k ) => (
              <button key={k} className={level === k ? "on" : ""} onClick={() => show( k )}>{k ? `LOD ${k}` : "Full"}</button>
            ) ) }
          </div>
          <label />
          <span className="muted">{builtOf( o.model, level ).tris} triangles</span>
        </>
      ) }
    </>
  );
}
