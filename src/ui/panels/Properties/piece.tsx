// A custom piece in Properties: its transform, surface, colliders, lights and the rest of its settings.

import { useState } from "react";
import type { V3 } from "../../../core/coords";
import { deltaBetween, transformCustom } from "../../../core/transform";
import { type CustomObjectEntry, type SurfaceType, arr3, customName, safeScale } from "../../../core/types";
import { useEditor } from "../../../map/store";
import { withModel } from "../../../model/objects";
import { withRail, withoutRail } from "../../../pieces/rail";
import { saveCustomToLibrary } from "../../../pieces/userAssets";
import { commitShape, liveShape } from "../../../terrain/shapes/edits";
import { newStamp } from "../../../terrain/shapes/shapes";
import { terrain } from "../../../terrain/terrain";
import { MaterialTab } from "../../blender/MaterialTab";
import { useWeather } from "../../blender/WeatherPanels";
import { getEngine } from "../../Viewport";
import { ColourChip } from "../../widgets/ColourPicker";
import { NumberField, Panel, Vec3Field } from "../../widgets/controls";
import { Icon } from "../../widgets/icons";
import { materialRows } from "../MaterialEditor";
import { modelRows } from "../ModelProperties";
import type { AssetTab } from "./index";
import { commitWhenStill } from "./live";
import type { Live } from "./live";
import { makeRail } from "./rail";
import { GrindStatus, RailEditor } from "./rail";
import { NameRow, Row } from "./rows";

const SURFACES: { id: SurfaceType; label: string; tip: string }[] = [
  { id: "Generic", label: "Generic", tip: "Solid, not grindable"                       },
  { id: "Snow",    label: "Snow",    tip: "Rides like snow"                            },
  { id: "Jib",     label: "Jib",     tip: "Grindable / pressable like rails and boxes" },
];

type LightNumbers = { color: { r: number; g: number; b: number; a?: number }; intensity: number; range: number };

/**
 * A piece's lights ( a floodlight's lamps ): their colour, brightness and reach, all of them together ( each keeps
 * how bright and far it is next to the others ). Lit in the view once the map's time is set to dark.
**/
function LightRows( { o, set, commit }: { o: CustomObjectEntry; set: ( f: ( x: CustomObjectEntry ) => CustomObjectEntry ) => void; commit: () => void } ) {
  const ls    = o.lights as unknown as LightNumbers[];
  const first = ls[0];
  const each  = ( f: ( l: LightNumbers ) => Partial<LightNumbers> ) => set( ( x ) => ( { ...x, lights: x.lights.map( ( l ) => ( { ...l, ...f( l as unknown as LightNumbers ) } ) ) } ) );
  return (
    <>
      <div className="section">Light</div>
      <Row label="Colour">
        <ColourChip
          value={[first.color.r, first.color.g, first.color.b]}
          onChange={( [r, g, b] ) => {
            each( ( l ) => ( { color: { ...l.color, r, g, b } } ) );
            commitWhenStill( commit );
          }}
        />
      </Row>
      <Row label="Intensity">
        <NumberField value={first.intensity} step={1} min={0} digits={1} onChange={( v ) => each( ( l ) => ( { intensity: first.intensity > 0 ? ( l.intensity * v ) / first.intensity : v } ) )} onCommit={commit} />
      </Row>
      <Row label="Range">
        <NumberField value={first.range} step={1} min={0} digits={1} unit="m" onChange={( v ) => each( ( l ) => ( { range: first.range > 0 ? ( l.range * v ) / first.range : v } ) )} onCommit={commit} />
      </Row>
    </>
  );
}

/**
 * Imported map pieces and user assets. Transform edits move every part, collider and light with the object.
**/
export function CustomProperties( { o, live, tab }: { o: CustomObjectEntry; live: Live; tab?: AssetTab } ) {
  const set = ( f: ( x: CustomObjectEntry ) => CustomObjectEntry ) => {
    live.begin();
    useEditor.setState( ( s ) => ( { customObjects: s.customObjects.map( ( x ) => ( x.uid === o.uid ? f( x ) : x ) ) } ) );
  };
  const name            = customName( o );
  const commit          = () => live.commit( `Edit ${name}` );
  const layout          = !tab;
  const [slot, setSlot] = useState( 0 );
  const weather         = useWeather();
  const cur             = { pos: arr3( o.position ), rot: arr3( o.rotation ), scl: arr3( o.scale ) };
  const moveTo          = ( to: Partial<{ pos: V3; rot: V3; scl: V3 }> ) =>
    set( ( x ) => transformCustom( x, deltaBetween( cur, { ...cur, ...to } ) ) );
  const ground = terrain.heightAt( o.position.x, o.position.z );
  const flag   = ( k: "can_stabilize" | "can_rotate" | "can_magnetize" | "disable_distance_culling" | "timed_visibility", label: string ) => (
    <>
      <label />
      <label style={{ color: "var(--text)" }}>
        <input type="checkbox" checked={o[k]} onChange={( e ) => { set( ( x ) => ( { ...x, [k]: e.target.checked } ) ); commit(); }} /> {label}
      </label>
    </>
  );

  // ( the Assets workspace's Material tab: Blender's, slots and all )
  if ( tab === "material" )
    return (
      <Panel icon="cube" title={`Material · ${useEditor.getState().labels[o.uid] || name}`} head={<NameRow key={o.uid} uid={o.uid} name={useEditor.getState().labels[o.uid] || name} />}>
        <MaterialTab key={o.uid} o={o} live={live} />
      </Panel>
    );
  return (
    <Panel
      icon="cube"
      title={`Object · ${useEditor.getState().labels[o.uid] || name}`}
      // ( Blender's name field )
      head={<NameRow key={o.uid} uid={o.uid} name={useEditor.getState().labels[o.uid] || name} />}
    >
      <div className="props">
        { ( layout || tab === "object" ) && <>
        <div className="section">Transform</div>
        <Vec3Field label="Location" value={cur.pos} digits={4} trim unit="m" onChange={( v ) => moveTo( { pos: v } )} onCommit={commit} />
        <Vec3Field label="Rotation" kind="rotation" value={cur.rot} step={1} digits={4} trim unit="°" onChange={( v ) => moveTo( { rot: v } )} onCommit={commit} />
        <Vec3Field label="Scale" kind="scale" value={cur.scl} step={0.01} digits={3} onChange={( v ) => moveTo( { scl: safeScale( v ) } )} onCommit={commit} />
        { layout && <>
        <label>Ground</label>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn small" disabled={Number.isNaN( ground )} onClick={() => { moveTo( { pos: [cur.pos[0], ground, cur.pos[2]] } ); commit(); }}>
            Drop to ground
          </button>
          <span style={{ color: "var(--muted)", alignSelf: "center" }}>{Number.isNaN( ground ) ? "off terrain" : `${( o.position.y - ground ).toFixed( 2 )} m above`}</span>
        </div>
        </> }
        </> }
        {layout && o.lights.length > 0 && <LightRows o={o} set={set} commit={commit} />}

        { ( tab === "modifiers" || tab === "data" ) && ( o.model ? modelRows( { o: o as CustomObjectEntry & { model: NonNullable<CustomObjectEntry["model"]> }, set, commit, only: tab } ) : (
          <>
            <div className="section">Mesh</div>
            <label />
            <button className="btn small" onClick={() => void getEngine()?.modelling.convertToModel( [o.uid] )}><Icon name="cube" size={13} /> Convert to Model</button>
          </>
        ) ) }

        { ( layout || tab === "physics" ) && <>
        <div className="section">Riding</div>
        <label>Surface</label>
        <div className="seg">
          { SURFACES.map( ( s ) => (
            <button
              key={s.id}
              title={s.tip}
              className={o.surface_type === s.id ? "on" : ""}
              onClick={() => {
                // a modelled piece's colliders ( and a curve's rail ) come from its shape: made again for the new surface
                if ( o.model ) {
                  set( ( x ) => {
                    const { rail: _r, ...y } = x;
                    return withModel( { ...( s.id === "Jib" && x.model?.curve ? x : y ), surface_type: s.id, ...( s.id === "Jib" ? { can_magnetize: true } : {} ) }, x.model! );
                  } );
                  commit();
                  return;
                }
                const jib = ( x: CustomObjectEntry ): CustomObjectEntry => ( { ...x, surface_type: "Jib", can_magnetize: true, colliders: x.colliders.map( ( c ) => ( { ...c, surface_type: "Jib" as const } ) ) } );
                // a jib grinds along its rail: made as it becomes one ( or when it's still without one )
                if ( s.id === "Jib" && !o.rail ) return void makeRail( o, set, commit, jib );
                // colliders carry their own surface type; keep them in step with the object's ( a grind rail
                // only makes sense on a jib: it goes when the piece stops being one )
                set( ( x ) => {
                  const base = x.rail && s.id !== "Jib" ? withoutRail( x ) : x;
                  const y    = { ...base, surface_type: s.id, colliders: base.colliders.map( ( c ) => ( { ...c, surface_type: s.id } ) ) };
                  return y.rail ? withRail( y, y.rail ) : y;
                } );
                commit();
              }}
            >
              {s.label}
            </button>
          ) ) }
        </div>
        { o.surface_type === "Jib" && (
          <>
            {flag( "can_stabilize", "Can stabilize" )}
            {flag( "can_rotate", "Can rotate" )}
            {flag( "can_magnetize", "Can magnetize" )}
            {layout && <RailEditor o={o} set={set} commit={commit} />}
            <GrindStatus o={o} />
          </>
        ) }
        </> }

        {layout && materialRows( { o, set, commit, slot, setSlot, weather } )}

        { layout && <>
        <div className="section">Visibility</div>
        {flag( "disable_distance_culling", "Always visible (no distance culling)" )}
        {flag( "timed_visibility", "Only visible at certain hours" )}
        { o.timed_visibility && (
          <>
            <label>From</label>
            <NumberField value={o.visible_from_hour} step={0.5} min={0} max={24} onChange={( v ) => set( ( x ) => ( { ...x, visible_from_hour: v } ) )} onCommit={commit} />
            <label>Until</label>
            <NumberField value={o.visible_until_hour} step={0.5} min={0} max={24} onChange={( v ) => set( ( x ) => ( { ...x, visible_until_hour: v } ) )} onCommit={commit} />
          </>
        ) }

        <div className="section">Terrain</div>
        <label />
        <button
          className="btn small"
          onClick={() => {
            const imp = getEngine()?.imprintGrid( o.uid );
            if ( !imp ) return useEditor.getState().toast( "Nothing to imprint yet — the object hasn't loaded", "error" );
            const shape = newStamp( imp.center, imp.grid, false, `Imprint of ${name}` );
            liveShape( shape, "Imprint object" );
            commitShape();
            useEditor.getState().setSelection( [{ kind: "shape", uid: shape.uid }] );
          }}
        >
          Press into terrain
        </button>

        <div className="section">Library</div>
        <label />
        <button className="btn small" onClick={() => saveCustomToLibrary( o )} title="Keep a copy in My assets to use in other maps">
          Save to My assets
        </button>

        <div className="section">Contents</div>
        <div className="note">
          {o.parts.length} part{o.parts.length === 1 ? "" : "s"} · {o.colliders.length} collider{o.colliders.length === 1 ? "" : "s"}
          {o.lights.length ? ` · ${o.lights.length} light${o.lights.length === 1 ? "" : "s"}` : ""}
          {o.colliders.length === 0 && " — nothing to ride on, the rider passes through it"}
        </div>
        </> }
      </div>
    </Panel>
  );
}
