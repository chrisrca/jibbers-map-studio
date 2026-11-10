// A piece's grind rail in Properties: its points, shape and parts, and whether the game will grind it.

import { useState } from "react";
import { fenceOf } from "../../../pieces/fence";
import { rebuilt } from "../../../viewport/tools/fenceTool";
import { arr3, type CustomObjectEntry } from "../../../core/types";
import { useEditor } from "../../../map/store";
import type { Profile } from "../../../model/curve";
import { applyScale, isModelled } from "../../../model/objectOps";
import { withModel } from "../../../model/objects";
import { partsFor } from "../../../pieces/library";
import { autoRail, isRailCollider, PART_MARK, straightRail, withRail } from "../../../pieces/rail";
import { getEngine } from "../../Viewport";
import { NumberField } from "../../widgets/controls";

// A curve rail's tube: a round rail, a box rail, a flat bar.
const PROFILES: [Profile, string][] = [["round", "Round"], ["square", "Box"], ["flat", "Flat"]];

/**
 * How many colliders a railed piece's visible parts have ( pieces/rail.ts fitParts ).
**/
const fittedCount = ( o: CustomObjectEntry ) => o.colliders.filter( ( c ) => c.mesh_ref === PART_MARK ).length;

/**
 * A jib's grind rail ( pieces/rail.ts ): made from its shape, then bent by moving its points in the 3D view. The game
 * grinds exactly along it, wherever the piece's centre is.
**/
export function RailEditor( { o, set, commit }: { o: CustomObjectEntry; set: ( f: ( x: CustomObjectEntry ) => CustomObjectEntry ) => void; commit: () => void } ) {
  const editing         = useEditor( ( s ) => ( s.railEdit?.uid === o.uid ? s.railEdit : null ) );
  const [busy, setBusy] = useState( false );
  const remake          = () => {
    // ( a repeat with its section's rail: that laid along it again )
    if ( fenceOf( o )?.style.infill.sectionRail ) {
      set( ( x ) => rebuilt( x ) );
      commit();
      return;
    }
    setBusy( true );
    makeRail( o, set, commit ).finally( () => setBusy( false ) );
  };
  const resetButton = (
    <button className="btn" disabled={busy} title="Makes the rail again from the piece's shape (your changes to it go)" onClick={remake}>
      {o.rail ? "Reset" : "Make rail"}
    </button>
  );
  if ( !o.rail )
    return (
      <>
        <label />
        <div>{resetButton}</div>
      </>
    );
  // a curve piece's rail is its curve: its own points, its tube's size and shape
  const curve = o.model?.curve;
  const edit  = (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <button className={`btn ${editing ? "on" : ""}`} onClick={() => useEditor.setState( { railEdit: editing ? null : { uid: o.uid, point: null } } )}>
        {editing ? "Done" : "Edit points"}
      </button>
      {editing && <button className="btn" onClick={() => getEngine()?.rails.addPoint()}>Add point</button>}
      {editing && <button className="btn" disabled={editing.point === null} onClick={() => getEngine()?.rails.deletePoint()}>Delete point</button>}
      {editing && ( editing.collider ?? null ) !== null && <button className="btn" title="As the rail makes it (Alt G / R / S: location, rotation, scale)" onClick={() => getEngine()?.rails.resetCollider()}>Reset collider</button>}
      {editing && !!o.rail.tweaks?.length && <button className="btn" title={`${o.rail.tweaks.length} changed`} onClick={() => getEngine()?.rails.resetCollider( null )}>Reset colliders</button>}
      {!curve && resetButton}
    </div>
  );
  if ( curve && o.model ) {
    const model    = o.model;
    const setCurve = ( p: Partial<typeof curve> ) => set( ( x ) => ( x.model?.curve ? withModel( x, { ...x.model, curve: { ...x.model.curve, ...p } } ) : x ) );
    return (
      <>
        <label>Rail</label>
        <span style={{ alignSelf: "center", color: "var(--muted)" }}>{`${curve.splines[0]?.points.length ?? 0} points · ${o.colliders.filter( isRailCollider ).length} segments`}</span>
        <label>Thickness</label>
        <NumberField value={curve.radius * 200} unit="cm" step={0.5} min={0.5} digits={1} onChange={( v ) => setCurve( { radius: Math.max( 0.0025, v / 200 ) } )} onCommit={commit} />
        <label>Shape</label>
        <div className="seg">
          { PROFILES.map( ( [id, label] ) => (
            <button key={id} className={curve.profile === id ? "on" : ""} onClick={() => { setCurve( { profile: id, ...( id === "flat" && model.curve!.profile !== "flat" ? { thickness: Math.min( model.curve!.radius, 0.006 ) } : {} ) } ); commit(); }}>
              {label}
            </button>
          ) ) }
        </div>
        <label />
        {edit}
      </>
    );
  }
  // ( a repeat's rail is its section's laid along it: kept there too, or it'd go back as it's made again )
  const inSection = ( x: CustomObjectEntry ): CustomObjectEntry => {
    const f = fenceOf( x ), r = f?.style.infill.sectionRail;
    if ( !f || !r || !x.rail ) return x;
    // ( kept as the section's own, before it's sized )
    const k           = f.style.infill.sectionSize ?? [1, 1, 1];
    const sectionRail = { ...r, radius: x.rail.radius / Math.sqrt( k[1] * k[2] ), ...( x.rail.box ? { box: [x.rail.box[0] / k[2], x.rail.box[1] / k[1]] as [number, number] } : {} ) };
    if ( !x.rail.box ) delete ( sectionRail as { box?: unknown } ).box;
    return { ...x, fence: { ...f, style: { ...f.style, infill: { ...f.style.infill, sectionRail } } } } as CustomObjectEntry;
  };
  // the box's half width or half height as it is
  const x0   = ( k: "w" | "h" ) => ( k === "w" ? o.rail!.box![0] : o.rail!.box![1] );
  // a size ( half of it, metres ) shown across in centimetres
  const size = ( v: number, to: ( half: number ) => { radius?: number; box?: [number, number] } ) => (
    <NumberField
      value={v * 200}
      unit="cm"
      step={0.5}
      min={1}
      digits={1}
      onChange={( cm ) => set( ( x ) => ( x.rail ? inSection( withRail( x, { ...x.rail, ...to( Math.max( 0.005, cm / 200 ) ) } ) ) : x ) )}
      onCommit={commit}
    />
  );
  return (
    <>
      <label>Rail</label>
      <span style={{ alignSelf: "center", color: "var(--muted)" }}>
        {o.rail.points.length < 2 ? "being laid: Ctrl+click along its top" : `${o.rail.points.length} points · ${o.colliders.filter( isRailCollider ).length} segments`}
      </span>
      { o.rail.box ? (
        <>
          <label>Width</label>
          {size( o.rail.box[0], ( w ) => ( { box: [w, x0( "h" )] } ) )}
          <label>Height</label>
          {size( o.rail.box[1], ( h ) => ( { box: [x0( "w" ), h] } ) )}
        </>
      ) : (
        <>
          <label>Thickness</label>
          {size( o.rail.radius, ( radius ) => ( { radius } ) )}
        </>
      ) }
      <label>Collider</label>
      <div className="seg">
        { ( [["round", "Round", "Capsules"], ["box", "Box", "Boxes"]] as const ).map( ( [id, label, tip] ) => (
          <button
            key={id}
            title={tip}
            className={( id === "box" ) === !!o.rail!.box ? "on" : ""}
            onClick={() => {
              set( ( x ) => {
                if ( !x.rail ) return x;
                const { box: _b, ...line } = x.rail;
                return inSection( withRail( x, id === "box" ? { ...line, box: [x.rail.radius, x.rail.radius] } : line ) );
              } );
              commit();
            }}
          >
            {label}
          </button>
        ) ) }
      </div>
      <label />
      <label
        style={{ color: "var(--text)" }}
        title="The piece's posts, poles, panels and boards are solid, each with its own close-fitting collider (nothing in between them). Untick to leave just the rail."
      >
        <input
          type="checkbox"
          checked={o.rail.solid !== false}
          onChange={async ( e ) => {
            const on   = e.target.checked;
            const body = on && o.rail ? await partsFor( o, o.rail ) : undefined;
            set( ( x ) => ( x.rail ? withRail( x, { ...x.rail, solid: on, ...body } ) : x ) );
            commit();
          }}
        />{" "}
        Mesh collidable
        { o.rail.solid !== false && ( o.rail.whole || o.rail.parts ) && (
          <span style={{ color: "var(--muted)" }}>
            {" "}· {o.rail.whole ? "the whole piece" : `${fittedCount( o )} part${fittedCount( o ) === 1 ? "" : "s"}`}
          </span>
        ) }
      </label>
      <label />
      {edit}
    </>
  );
}

/**
 * Makes a piece's grind rail from its shape ( pieces/rail.ts ), `also` applied with it ( making it a jib ). Where its shape
 * can't be followed ( a spiral ) the rail is started empty, to lay by hand: Ctrl+click along it.
**/
export async function makeRail( o: CustomObjectEntry, set: ( f: ( x: CustomObjectEntry ) => CustomObjectEntry ) => void, commit: () => void, also = ( x: CustomObjectEntry ) => x ) {
  // ( a modelled piece stretched by its scale: the scale put into its mesh first, as Blender's Apply Scale. Found in
  // its own space, a box stretched long was still a cube there: the rail went across it, as thick as the cube )
  const stretched = isModelled( o ) && !o.model.curve && arr3( o.scale ).some( ( v ) => Math.abs( v - 1 ) > 1e-6 );
  const flat      = ( x: CustomObjectEntry ) => ( stretched && isModelled( x ) ? applyScale( x ) : x );
  o               = flat( o );
  const pts = await getEngine()?.customR.localVertices( o );
  if ( !pts ) return void useEditor.getState().toast( "Its mesh hasn't loaded yet; try again in a moment", "info" );
  const made = autoRail( pts );
  const rail = made.rail ?? { points: [], radius: made.radius ?? straightRail( pts ).radius };
  const body = await partsFor( o, rail );
  // ( made again: its colliders changed by hand go too )
  set( ( x ) => withRail( also( flat( x ) ), { ...rail, ...body, tweaks: undefined } ) );
  commit();
  if ( !made.rail ) {
    useEditor.setState( { railEdit: { uid: o.uid, point: null } } );
    useEditor.getState().toast( "Ctrl+click along its top, end to end, to lay the rail", "info" );
  }
}
