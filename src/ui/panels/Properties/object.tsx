// The game's objects ( features, lifts ) in Properties: their transform, the game's settings for them, and a lift's
// stations and masts.

import { hexOf, rgbOfHex } from "../../../core/colour";
import { type ObjectEntry, type ParamValue, safeScale } from "../../../core/types";
import { useEditor } from "../../../map/store";
import { liftPieces, withAutoMasts } from "../../../pieces/lift";
import { terrain } from "../../../terrain/terrain";
import { PLACEHOLDER_COLORS } from "../../../viewport/render/objectsRenderer";
import { type LiftPart, withPieceAt } from "../../../viewport/tools/liftTool";
import { ColourChip } from "../../widgets/ColourPicker";
import { NumberField, Panel, Vec3Field } from "../../widgets/controls";
import { Dropdown } from "../../widgets/widgets";
import type { Live } from "./live";
import { commitWhenStill } from "./live";
import { Row } from "./rows";

function setObj( uid: string, f: ( o: ObjectEntry ) => ObjectEntry ) {
  useEditor.setState( ( s ) => ( { objects: s.objects.map( ( o ) => ( o.uid === uid ? f( o ) : o ) ) } ) );
}

/**
 * A lift's line: how long, how many masts, masts put along it afresh.
**/
function LiftSection( { o, hasMasts }: { o: ObjectEntry; hasMasts: boolean } ) {
  const e       = o.lift!.endPosition, length = Math.hypot( e.x * o.scale[0], e.y * o.scale[1], e.z * o.scale[2] );
  const rise    = e.y * o.scale[1];
  const ground  = ( px: number, pz: number ) => terrain.heightAt( px, pz );
  const setAuto = ( interval: number | undefined, label: string ) =>
    useEditor.getState().updateObjects( label, [o.uid], ( x ) => withAutoMasts( { ...x, liftAuto: interval }, ground ) );
  return (
    <>
      <div className="section">Lift</div>
      <Row label="Length">
        <span style={{ color: "var(--muted)" }}>{length.toFixed( 0 )} m · {rise >= 0 ? "+" : ""}{rise.toFixed( 0 )} m</span>
      </Row>
      { hasMasts && (
        <>
          <Row label="Masts">
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ color: "var(--muted)", minWidth: 18 }}>{o.lift!.masts.length}</span>
              <label className="check" title="Spaced on the ground, again as the ends move">
                <input type="checkbox" checked={!!o.liftAuto} onChange={( e ) => setAuto( e.target.checked ? 40 : undefined, e.target.checked ? "Masts spaced automatically" : "Masts kept where they are" )} /> Auto
              </label>
            </div>
          </Row>
          { o.liftAuto && (
            <Row label="Spacing">
              <NumberField value={o.liftAuto} step={1} min={8} max={200} digits={0} unit="m" onChange={( v ) => setAuto( v, "Mast spacing" )} />
            </Row>
          ) }
        </>
      ) }
    </>
  );
}

/**
 * A lift's Transform: where the piece picked in the view stands ( its base station, top station or a mast ), moved as
 * dragging it does; a lift has no turn or size of its own to set ( its line sets which way its stations face ).
**/
function LiftPieceTransform( { o, edit, commit }: { o: ObjectEntry; edit: ( f: ( o: ObjectEntry ) => ObjectEntry ) => void; commit: () => void } ) {
  const info            = useEditor( ( s ) => s.placeholders.find( ( p ) => p.id === o.id ) )!.lift!;
  const picked          = useEditor( ( s ) => ( s.liftPick?.uid === o.uid ? s.liftPick.which : "base" ) );
  const pieces          = liftPieces( o )!;
  const which: LiftPart = typeof picked === "number" && !pieces.masts[picked] ? "base" : picked;
  const foot            = which === "base" ? pieces.base.at : which === "top" ? pieces.top.at : pieces.masts[which].at;
  const part            = which === "base" ? info.base : which === "top" ? info.top : info.mast!;
  const size            = part.boundsMax.map( ( v, i ) => ( v - part.boundsMin[i] ) * o.scale[i] );
  const ground          = terrain.heightAt( foot[0], foot[2] );
  const name            = which === "base" ? "Base Station" : which === "top" ? "Top Station" : `Mast ${which + 1}`;
  return (
    <>
      <div className="section">{name}</div>
      <Vec3Field
        label="Location"
        value={foot}
        digits={4}
        trim
        unit="m"
        // ( the same place again — a field let go of twice — is no move, and no step to undo )
        onChange={( v ) => {
          const now = useEditor.getState().objects.find( ( x ) => x.uid === o.uid );
          const key = ( x: ObjectEntry ) => JSON.stringify( [x.position, x.lift, x.liftAuto] );
          if ( now && key( withPieceAt( now, which, v ) ) !== key( now ) ) edit( ( x ) => withPieceAt( x, which, v ) );
        }}
        onCommit={commit}
      />
      <label>Ground</label>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn small" disabled={Number.isNaN( ground )} onClick={() => { edit( ( x ) => withPieceAt( x, which, [foot[0], ground, foot[2]] ) ); commit(); }}>
          Drop to ground
        </button>
        <span style={{ color: "var(--muted)", alignSelf: "center" }}>{Number.isNaN( ground ) ? "off terrain" : `${( foot[1] - ground ).toFixed( 2 )} m above`}</span>
      </div>
      <label>Size</label>
      <span style={{ color: "var(--muted)" }}>{size.map( ( v ) => `${v.toFixed( 2 )}` ).join( " × " )} m</span>
    </>
  );
}

export function ObjectProperties( { o, live }: { o: ObjectEntry; live: Live } ) {
  const info = useEditor( ( s ) => s.placeholders.find( ( p ) => p.id === o.id ) );
  const edit = ( f: ( o: ObjectEntry ) => ObjectEntry ) => {
    live.begin();
    setObj( o.uid, f );
  };
  const commit = () => live.commit( `Edit ${o.id}` );
  const ground = terrain.heightAt( o.position[0], o.position[2] );
  const size   = info ? info.boundsMax.map( ( v, i ) => ( v - info.boundsMin[i] ) * o.scale[i] ) : null;

  return (
    <Panel icon="cube" title={`Object · ${useEditor.getState().labels[o.uid] ?? o.id.replace( /_/g, " " )}`}>
      <div className="props">
        { info?.lift && o.lift ? (
          <LiftPieceTransform o={o} edit={edit} commit={commit} />
        ) : (
          <>
            <div className="section">Transform</div>
            <Vec3Field label="Location" value={o.position} digits={4} trim unit="m" onChange={( v ) => edit( ( x ) => ( { ...x, position: v } ) )} onCommit={commit} />
            <Vec3Field label="Rotation" kind="rotation" value={o.rotation} step={1} digits={4} trim unit="°" onChange={( v ) => edit( ( x ) => ( { ...x, rotation: v } ) )} onCommit={commit} />
            <Vec3Field
              label="Scale"
              kind="scale"
              value={o.scale}
              step={0.01}
              digits={3}
              onChange={( v ) => edit( ( x ) => ( { ...x, scale: safeScale( info?.forceUniformScale ? [v[0], v[0], v[0]] : v ) } ) )}
              onCommit={commit}
            />
            <label>Ground</label>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn small" disabled={Number.isNaN( ground )} onClick={() => { edit( ( x ) => ( { ...x, position: [x.position[0], ground, x.position[2]] } ) ); commit(); }}>
                Drop to ground
              </button>
              <span style={{ color: "var(--muted)", alignSelf: "center" }}>{Number.isNaN( ground ) ? "off terrain" : `${( o.position[1] - ground ).toFixed( 2 )} m above`}</span>
            </div>
            { size && (
              <>
                <label>Size</label>
                <span style={{ color: "var(--muted)" }}>{size.map( ( v ) => `${v.toFixed( 2 )}` ).join( " × " )} m</span>
              </>
            ) }
          </>
        ) }

        {info?.lift && o.lift && <LiftSection o={o} hasMasts={!!info.lift.mast} />}
        {info && info.parameters.length > 0 && <div className="section">Parameters</div>}
        { info?.parameters.map( ( p ) => {
          const cur  = o.params[p.name];
          const setP = ( v: ParamValue ) => {
            edit( ( x ) => ( { ...x, params: { ...x.params, [p.name]: v } } ) );
            commit();
          };
          const label = p.name.replace( /-/g, " " );
          if ( p.type === "selection" && p.name === "color" )
            return (
              <Row key={p.name} label={label}>
                <div className="swatches">
                  { p.options!.map( ( opt ) => (
                    <div
                      key={opt}
                      title={opt}
                      className={`swatch ${cur?.type === "String" && cur.value === opt ? "on" : ""}`}
                      style={{ background: `#${( PLACEHOLDER_COLORS[opt] ?? 0x888888 ).toString( 16 ).padStart( 6, "0" )}` }}
                      onClick={() => setP( { type: "String", value: opt } )}
                    />
                  ) ) }
                </div>
              </Row>
            );
          if ( p.type === "selection" )
            return (
              <Row key={p.name} label={label}>
                <Dropdown value={cur?.type === "String" ? cur.value : String( p.default )} menuTitle={label} options={p.options!.map( ( opt ) => ( { value: opt, label: opt } ) )} onChange={( v ) => setP( { type: "String", value: v } )} />
              </Row>
            );
          if ( p.type === "bool" )
            return (
              <Row key={p.name} label={label}>
                <input type="checkbox" checked={cur?.type === "Bool" ? cur.value : Boolean( p.default )} onChange={( e ) => setP( { type: "Bool", value: e.target.checked } )} />
              </Row>
            );
          if ( p.type === "color" )
            return (
              <Row key={p.name} label={label}>
                <ColourChip
                  value={rgbOfHex( cur?.type === "String" ? cur.value : String( p.default ) ) ?? [1, 1, 1]}
                  onChange={( rgb ) => {
                    // ( one undo step for a drag in the picker: kept once it rests )
                    edit( ( x ) => ( { ...x, params: { ...x.params, [p.name]: { type: "String", value: hexOf( rgb ).toUpperCase() } } } ) );
                    commitWhenStill( commit );
                  }}
                />
              </Row>
            );
          if ( p.type === "int" || p.type === "float" )
            return (
              <Row key={p.name} label={label}>
                <NumberField
                  value={cur && ( cur.type === "Int" || cur.type === "Float" ) ? cur.value : Number( p.default )}
                  step={p.type === "int" ? 1 : 0.1}
                  digits={p.type === "int" ? 0 : 2}
                  onChange={( v ) => edit( ( x ) => ( { ...x, params: { ...x.params, [p.name]: { type: p.type === "int" ? "Int" : "Float", value: p.type === "int" ? Math.round( v ) : v } as ParamValue } } ) )}
                  onCommit={commit}
                />
              </Row>
            );
          return (
            <Row key={p.name} label={label}>
              <input
                className="txt"
                defaultValue={cur?.type === "String" ? cur.value : String( p.default )}
                onBlur={( e ) => setP( { type: "String", value: e.target.value } )}
                onKeyDown={( e ) => e.key === "Enter" && ( e.target as HTMLInputElement ).blur()}
              />
            </Row>
          );
        } ) }
      </div>
    </Panel>
  );
}
