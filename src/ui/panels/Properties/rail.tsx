// A piece's grind rail in Properties: its points, shape and parts, and whether the game will grind it.

import { useEffect, useState } from "react";
import type { CustomObjectEntry } from "../../../core/types";
import { useEditor } from "../../../map/store";
import type { Profile } from "../../../model/curve";
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
        <label>Rail</label>
        <span style={{ alignSelf: "center", color: "var(--muted)" }}>none yet</span>
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
  return (
    <>
      <label>Rail</label>
      <span style={{ alignSelf: "center", color: "var(--muted)" }}>
        {o.rail.points.length < 2 ? "being laid: Ctrl+click along its top" : `${o.rail.points.length} points · ${o.colliders.filter( isRailCollider ).length} segments`}
      </span>
      <label>Thickness</label>
      <NumberField
        value={o.rail.radius * 200}
        unit="cm"
        step={0.5}
        min={1}
        digits={1}
        onChange={( v ) => set( ( x ) => {
          if ( !x.rail ) return x;
          const radius = Math.max( 0.005, v / 200 );
          return withRail( x, { ...x.rail, radius, ...( x.rail.box ? { box: [radius, radius] as [number, number] } : {} ) } );
        } )}
        onCommit={commit}
      />
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
                return withRail( x, id === "box" ? { ...line, box: [x.rail.radius, x.rail.radius] } : line );
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
 * When the grind line in the view runs across the piece: why, and the fix. Nothing otherwise.
**/
export function GrindStatus( { o }: { o: CustomObjectEntry } ) {
  const [, bump] = useState( 0 );
  useEffect( () => {
    const f = () => bump( ( n ) => n + 1 );
    window.addEventListener( "grind-guides", f );
    return () => window.removeEventListener( "grind-guides", f );
  }, [] );
  const g = getEngine()?.customR.guides.of( o.uid ) ?? null;
  if ( !g || g.ok ) return null;
  if ( g.problem !== "across" ) return null;
  return <div className="note warn">{`The game looks for this rail running across it (the red line), so it won't grab you. ${o.rail ? "Reset" : "Make rail"} lays one along it.`}</div>;
}

/**
 * Makes a piece's grind rail from its shape ( pieces/rail.ts ), `also` applied with it ( making it a jib ). Where its shape
 * can't be followed ( a spiral ) the rail is started empty, to lay by hand: Ctrl+click along it.
**/
export async function makeRail( o: CustomObjectEntry, set: ( f: ( x: CustomObjectEntry ) => CustomObjectEntry ) => void, commit: () => void, also = ( x: CustomObjectEntry ) => x ) {
  const pts = await getEngine()?.customR.localVertices( o );
  if ( !pts ) return void useEditor.getState().toast( "Its mesh hasn't loaded yet; try again in a moment", "info" );
  const made = autoRail( pts );
  const rail = made.rail ?? { points: [], radius: made.radius ?? straightRail( pts ).radius };
  const body = await partsFor( o, rail );
  set( ( x ) => withRail( also( x ), { ...rail, ...body } ) );
  commit();
  if ( !made.rail ) {
    useEditor.setState( { railEdit: { uid: o.uid, point: null } } );
    useEditor.getState().toast( `Couldn't follow its shape by itself (${made.why}). Ctrl+click along its top, from one end to the other, to lay the rail.`, "info" );
  }
}
