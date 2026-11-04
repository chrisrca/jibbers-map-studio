// A piece's Moving Parts ( pieces/motion.ts ): what of it spins, swings or bobs in the game, and how, with a preview
// of them moving in the view.

import { toThree } from "../../../core/coords";
import type { CustomObjectEntry } from "../../../core/types";
import { useEditor } from "../../../map/store";
import { movingPartsOf, newMovingPart, useMotionPreview, MAX_BOB, MAX_SWING, type MotionRegion, type MovingPart } from "../../../pieces/motion";
import { toPiece } from "../../../pieces/rail";
import { NumberField, Vec3Field } from "../../widgets/controls";
import { Icon } from "../../widgets/icons";
import { Dropdown } from "../../widgets/widgets";
import { getEngine } from "../../Viewport";

// The piece's own axes by Blender's names ( its X, Y, Z: the game's X, Z, Y ).
const AXES: { id: MovingPart["axis"]; label: string }[] = [{ id: "x", label: "X" }, { id: "z", label: "Y" }, { id: "y", label: "Z" }];

const PIVOTS: { value: MovingPart["pivot"]; label: string }[] = [
  { value: "center", label: "Middle of the part" },
  { value: "top",    label: "Top of the part"    },
  { value: "bottom", label: "Bottom of the part" },
  { value: "origin", label: "Object origin"      },
  { value: "region", label: "Middle of the region" },
];

const SHAPES: { value: "whole" | MotionRegion["shape"]; label: string }[] = [
  { value: "whole",    label: "The whole object" },
  { value: "sphere",   label: "In a sphere"      },
  { value: "cylinder", label: "In a cylinder"    },
  { value: "box",      label: "In a box"         },
];

export function MotionRows( { o, set, commit }: { o: CustomObjectEntry; set: ( f: ( x: CustomObjectEntry ) => CustomObjectEntry ) => void; commit: () => void } ) {
  const parts   = movingPartsOf( o );
  const preview = useMotionPreview();
  // ( while previewing: the parts that move nothing, an earlier part having all they'd take )
  const idle    = preview.on ? getEngine()?.customR.movesNothing( o.uid ) ?? [] : [];
  const put     = ( list: MovingPart[] ) => set( ( x ) => ( { ...x, motions: list.length ? list : undefined } as CustomObjectEntry ) );
  const edit    = ( k: number, p: Partial<MovingPart> ) => put( parts.map( ( m, j ) => ( j === k ? { ...m, ...p } : m ) ) );
  const seg     = <T extends string>( value: T, options: { id: T; label: string }[], onPick: ( v: T ) => void ) => (
    <div className="seg">
      {options.map( ( x ) => <button key={x.id} className={value === x.id ? "on" : ""} onClick={() => { onPick( x.id ); commit(); }}>{x.label}</button> )}
    </div>
  );
  // ( a new region: round the 3D cursor when it's on the piece's side of things, else its middle )
  const regionAt = ( shape: MotionRegion["shape"] ): MotionRegion => ( { shape, center: toPiece( o, toThree( useEditor.getState().cursor3d ) ), size: shape === "box" ? [0.5, 0.5, 0.5] : [0.3, 0.3, 0.3] } );
  return (
    <>
      <div className="section">Moving Parts</div>
      <label />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="btn small" onClick={() => { put( [...parts, newMovingPart( `Part ${parts.length + 1}` )] ); commit(); }}><Icon name="plus" size={12} /> Add Part</button>
        { parts.length > 0 && (
          <button className="btn small" onClick={() => useMotionPreview.setState( preview.on && preview.playing ? { playing: false } : { on: true, playing: true } )}>
            {preview.on && preview.playing ? "Pause" : "Preview"}
          </button>
        ) }
        { preview.on && <button className="btn small" onClick={() => useMotionPreview.setState( { on: false, t: 0 } )}>Stop</button> }
      </div>
      { preview.on && (
        <>
          <label>Time</label>
          <NumberField value={preview.t} step={0.1} min={0} digits={1} unit="s" onChange={( t ) => useMotionPreview.setState( { t, playing: false } )} />
        </>
      ) }
      { parts.map( ( m, k ) => (
        <div key={k} style={{ display: "contents" }}>
          <label>Name</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="text" value={m.name} onChange={( e ) => edit( k, { name: e.target.value } )} onBlur={commit} />
            <button className="btn small" title="Remove" onClick={() => { put( parts.filter( ( _, j ) => j !== k ) ); commit(); }}><Icon name="close" size={12} /></button>
          </div>
          { idle.includes( k ) && <div className="note warn">Moves nothing: an earlier part already moves this.</div> }
          <label>Motion</label>
          {seg( m.kind, [{ id: "spin", label: "Spin" }, { id: "swing", label: "Swing" }, { id: "bob", label: "Bob" }], ( kind ) => edit( k, { kind } ) )}
          <label>Axis</label>
          {seg( m.axis, AXES, ( axis ) => edit( k, { axis } ) )}
          { m.kind === "spin" && (
            <>
              <label>Speed</label>
              <NumberField value={m.speed} step={0.05} min={0.001} max={50} unit="/s" onChange={( speed ) => edit( k, { speed } )} onCommit={commit} />
              <label />
              <label className="check"><input type="checkbox" checked={m.reverse} onChange={( e ) => { edit( k, { reverse: e.target.checked } ); commit(); }} /> Invert</label>
            </>
          ) }
          { m.kind === "swing" && (
            <>
              <label>Angle</label>
              <NumberField value={m.angle} step={1} min={0} max={MAX_SWING} digits={0} unit="°" onChange={( angle ) => edit( k, { angle } )} onCommit={commit} />
            </>
          ) }
          { m.kind === "bob" && (
            <>
              <label>Distance</label>
              <NumberField value={m.distance} step={0.05} min={0} max={MAX_BOB} unit="m" onChange={( distance ) => edit( k, { distance } )} onCommit={commit} />
            </>
          ) }
          { m.kind !== "spin" && (
            <>
              <label>Period</label>
              <NumberField value={m.period} step={0.1} min={0.05} max={600} unit="s" onChange={( period ) => edit( k, { period } )} onCommit={commit} />
              <label />
              <label className="check"><input type="checkbox" checked={m.phase === null} onChange={( e ) => { edit( k, { phase: e.target.checked ? null : 0 } ); commit(); }} /> Out of step with others</label>
              { m.phase !== null && (
                <>
                  <label>Phase</label>
                  <NumberField value={m.phase} step={0.05} min={0} max={1} onChange={( phase ) => edit( k, { phase } )} onCommit={commit} />
                </>
              ) }
            </>
          ) }
          <label>Pivot</label>
          <Dropdown value={m.pivot} menuTitle="Pivot" options={PIVOTS} onChange={( pivot ) => { edit( k, { pivot } ); commit(); }} />
          <label>What moves</label>
          <Dropdown value={m.region?.shape ?? "whole"} menuTitle="What moves" options={SHAPES} onChange={( s ) => { edit( k, { region: s === "whole" ? null : m.region ? { ...m.region, shape: s } : regionAt( s ) } ); commit(); }} />
          { m.region && (
            <>
              <label />
              {seg( m.capture, [{ id: "islands", label: "Loose parts" }, { id: "vertices", label: "Vertices" }], ( capture ) => edit( k, { capture } ) )}
              <Vec3Field label="Centre" value={m.region.center} step={0.01} digits={3} unit="m" onChange={( center ) => edit( k, { region: { ...m.region!, center } } )} onCommit={commit} />
              { m.region.shape === "box"
                ? <Vec3Field label="Size" kind="scale" value={m.region.size} step={0.01} digits={3} onChange={( size ) => edit( k, { region: { ...m.region!, size } } )} onCommit={commit} />
                : (
                  <>
                    <label>Radius</label>
                    <NumberField value={m.region.size[0]} step={0.01} min={0.001} unit="m" onChange={( r ) => edit( k, { region: { ...m.region!, size: [r, m.region!.size[1], m.region!.size[2]] } } )} onCommit={commit} />
                    { m.region.shape === "cylinder" && (
                      <>
                        <label>Length</label>
                        <NumberField value={m.region.size[1]} step={0.01} min={0.001} unit="m" onChange={( l ) => edit( k, { region: { ...m.region!, size: [m.region!.size[0], l, m.region!.size[2]] } } )} onCommit={commit} />
                      </>
                    ) }
                  </>
                ) }
              <label />
              <button className="btn small" onClick={() => { edit( k, { region: { ...m.region!, center: toPiece( o, toThree( useEditor.getState().cursor3d ) ) } } ); commit(); }}>Centre on the 3D cursor</button>
            </>
          ) }
        </div>
      ) ) }
    </>
  );
}
