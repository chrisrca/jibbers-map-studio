// Blender's Adjust Last Operation panel ( bottom left of the 3D view ) for Add › Mesh: the primitive's own settings
// ( a sphere's segments and rings, a cylinder's vertices and depth… ), where it went and its turn; a change does the
// add again with them.

import { useState } from "react";
import { useEditor, workspaceOf, type LastAdd } from "../../map/store";
import { PRIMITIVES, type PrimitiveId, type PrimitiveOpts } from "../../model/mesh";
import { getEngine } from "../Viewport";
import { NumberField, Vec3Field } from "../widgets/controls";
import { BlIcon } from "./BlIcon";

// A setting: which of the primitive's, Blender's name for it, its default; `half`: shown as half the size ( a radius ).
interface Field {
  key:    keyof PrimitiveOpts;
  label:  string;
  def:    number;
  min:    number;
  max?:   number;
  whole?: boolean;
  half?:  boolean;
}

const VERTICES: Field = { key: "segments", label: "Vertices", def: 32, min: 3,     max: 256, whole: true };
const RADIUS:   Field = { key: "size",     label: "Radius",   def: 2,  min: 0.001, half: true             };
const SIZE:     Field = { key: "size",     label: "Size",     def: 2,  min: 0.001                         };
const DEPTH:    Field = { key: "depth",    label: "Depth",    def: 2,  min: 0.001                         };

// Each primitive's settings, as Blender's panel lists them.
export const ADD_FIELDS: Record<PrimitiveId, Field[]> = {
  plane:     [SIZE],
  cube:      [SIZE],
  circle:    [VERTICES, RADIUS],
  uvsphere:  [{ key: "segments", label: "Segments", def: 32, min: 3, max: 256, whole: true }, { key: "rings", label: "Rings", def: 16, min: 3, max: 128, whole: true }, RADIUS],
  icosphere: [{ key: "rings", label: "Subdivisions", def: 2, min: 1, max: 6, whole: true }, RADIUS],
  cylinder:  [VERTICES, RADIUS, DEPTH],
  cone:      [VERTICES, RADIUS, DEPTH],
  torus:     [{ key: "segments", label: "Major Segments", def: 32, min: 3, max: 256, whole: true }, { key: "minor", label: "Minor Segments", def: 12, min: 3, max: 256, whole: true }, RADIUS],
  grid:      [{ key: "segments", label: "Subdivisions", def: 10, min: 1, max: 100, whole: true }, SIZE],
};

/**
 * Whether the last Add is still the last thing done ( nothing changed since: the piece, or Edit Mode's mesh, as it
 * left it ).
**/
export const stillLast = ( s: { lastAdd: LastAdd | null; customObjects: { uid: string; model?: { mesh: unknown } }[] } ) => {
  const a = s.lastAdd, o = a && s.customObjects.find( ( x ) => x.uid === a.uid );
  return !!a && !!o && ( a.into ? o.model?.mesh === a.made : o === a.made );
};

export function AdjustLast() {
  const last            = useEditor( ( s ) => ( stillLast( s ) ? s.lastAdd : null ) );
  const assets          = useEditor( ( s ) => workspaceOf( s.tool ) === "assets" );
  const [open, setOpen] = useState( true );
  if ( !last || !assets ) return null;
  const redo  = ( p: Partial<Omit<LastAdd, "made">> ) => getEngine()?.menus.redoAdd( { uid: last.uid, id: last.id, opts: last.opts, at: last.at, rot: last.rot, into: last.into, ...p } );
  const label = PRIMITIVES.find( ( p ) => p.id === last.id )!.label;
  return (
    <div className="adjust-last" onPointerDown={( e ) => e.stopPropagation()}>
      <button className="al-head" onClick={() => setOpen( !open )}>
        <BlIcon name={open ? "disclosure_tri_down" : "disclosure_tri_right"} size={12} /> Add {label}
      </button>
      { open && (
        <div className="props">
          { ADD_FIELDS[last.id].map( ( f ) => {
            const v = last.opts[f.key] ?? f.def, k = f.half ? 0.5 : 1;
            return (
              <div key={f.key} style={{ display: "contents" }}>
                <label>{f.label}</label>
                <NumberField
                  value={v * k}
                  step={f.whole ? 1 : 0.1}
                  digits={f.whole ? 0 : 3}
                  trim={!f.whole}
                  unit={f.whole ? undefined : "m"}
                  min={f.min * k}
                  max={f.max === undefined ? undefined : f.max * k}
                  onChange={( x ) => redo( { opts: { ...last.opts, [f.key]: ( f.whole ? Math.round( x ) : x ) / k } } )}
                />
              </div>
            );
          } ) }
          <Vec3Field label="Location" value={last.at} digits={4} trim unit="m" onChange={( at ) => redo( { at } )} />
          <Vec3Field label="Rotation" kind="rotation" value={last.rot} step={1} digits={2} trim unit="°" onChange={( rot ) => redo( { rot } )} />
        </div>
      ) }
    </div>
  );
}
