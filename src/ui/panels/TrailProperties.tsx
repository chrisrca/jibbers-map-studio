// Properties of a picked trail run or point. A change shows at once on the drawn trails; the ground follows when a
// field or curve point is let go ( one undo step ).

import { CROSS_SECTIONS, type Curve } from "../../core/curve";
import { useEditor } from "../../map/store";
import { commitMoved, commitTrails, deleteTrails, fitToGroundPicked, previewNet, withWidthAt } from "../../trails/edits";
import { realTerrainOf } from "../../map/project";
import { RUN_PROFILES, runLength, runsAt, skirtOf, type TrailNode, type TrailRun } from "../../trails/trails";
import { NumberField, Panel } from "../widgets/controls";
import { CurveEditor } from "../widgets/CurveEditor";
import { Icon } from "../widgets/icons";

const commit = ( label: string ) => () => commitTrails( useEditor.getState().trails, label );

function Field( { label, children }: { label: string; children: React.ReactNode } ) {
  return (
    <>
      <label>{label}</label>
      <div>{children}</div>
    </>
  );
}

function Presets( { items, onPick }: { items: Record<string, { label: string; curve: Curve }>; onPick: ( c: Curve ) => void } ) {
  return (
    <div className="seg wrap">
      { Object.keys( items ).map( ( id ) => (
        <button key={id} onClick={() => onPick( structuredClone( items[id].curve ) )}>
          {items[id].label}
        </button>
      ) ) }
    </div>
  );
}

export function TrailRunProperties( { r }: { r: TrailRun } ) {
  const net = useEditor( ( s ) => s.trails );
  const set = ( p: Partial<TrailRun> ) => {
    const n      = structuredClone( useEditor.getState().trails );
    // ( its shape given by hand: no longer fitted to the ground when its points move )
    const shaped = ["corners", "mids", "profile", "bump", "roll", "cross", "crossDepth"].some( ( k ) => k in p );
    Object.assign( n.runs.find( ( x ) => x.id === r.id )!, p, shaped ? { fit: false } : {} );
    previewNet( n );
  };
  const done = commit( "Change run" );
  const pick = ( p: Partial<TrailRun> ) => {
    set( p );
    done();
  };
  const corner = ( i: number ) => ( v: number ) => {
    const c = [...r.corners] as TrailRun["corners"];
    c[i]    = v;
    set( { corners: c } );
  };
  const mid = ( i: number ) => ( v: number ) => {
    const m = [...r.mids] as TrailRun["mids"];
    m[i]    = v;
    set( { mids: m } );
  };
  return (
    <Panel icon="trail" title="Run">
      <div className="props">
        <Field label="Length"><span style={{ color: "var(--muted)" }}>{runLength( net, r ).toFixed( 1 )} m</span></Field>
        <Field label="Width"><NumberField onCommit={done} value={( r.wa + r.wb ) / 2} step={0.5} min={1} max={300} unit=" m" onChange={( w ) => set( { wa: w, wb: w } )} /></Field>
        <Field label="Width start"><NumberField onCommit={done} value={r.wa} step={0.5} min={1} max={300} unit=" m" onChange={( wa ) => set( { wa } )} /></Field>
        <Field label="Width end"><NumberField onCommit={done} value={r.wb} step={0.5} min={1} max={300} unit=" m" onChange={( wb ) => set( { wb } )} /></Field>
        <Field label="Roll"><NumberField onCommit={done} value={r.roll} step={0.5} min={-60} max={60} digits={1} unit="°" onChange={( roll ) => set( { roll } )} /></Field>
        <Field label="Edge"><NumberField onCommit={done} value={r.edge ?? skirtOf( ( r.wa + r.wb ) / 2 )} step={0.5} min={1} max={200} unit=" m" onChange={( edge ) => set( { edge } )} /></Field>

        <div className="section">Corners</div>
        <Field label="Start left"><NumberField onCommit={done} value={r.corners[0]} step={0.1} unit=" m" onChange={corner( 0 )} /></Field>
        <Field label="Start right"><NumberField onCommit={done} value={r.corners[1]} step={0.1} unit=" m" onChange={corner( 1 )} /></Field>
        <Field label="Middle left"><NumberField onCommit={done} value={r.mids[0]} step={0.1} unit=" m" onChange={mid( 0 )} /></Field>
        <Field label="Middle right"><NumberField onCommit={done} value={r.mids[1]} step={0.1} unit=" m" onChange={mid( 1 )} /></Field>
        <Field label="End left"><NumberField onCommit={done} value={r.corners[2]} step={0.1} unit=" m" onChange={corner( 2 )} /></Field>
        <Field label="End right"><NumberField onCommit={done} value={r.corners[3]} step={0.1} unit=" m" onChange={corner( 3 )} /></Field>

        <div className="section">Along</div>
        <div style={{ gridColumn: "1 / -1" }}>
          <Presets items={RUN_PROFILES} onPick={( profile ) => pick( { profile, bump: r.bump || 3 } )} />
          <CurveEditor value={r.profile} min={-1.25} max={1.25} label={["start", "end"]} onChange={( profile ) => set( { profile } )} onCommit={done} />
        </div>
        <Field label="Height"><NumberField onCommit={done} value={r.bump} step={0.1} unit=" m" onChange={( bump ) => set( { bump } )} /></Field>

        <div className="section">Across</div>
        <div style={{ gridColumn: "1 / -1" }}>
          <Presets items={CROSS_SECTIONS} onPick={( cross ) => pick( { cross, crossDepth: r.crossDepth || 3 } )} />
          <CurveEditor value={r.cross} min={-1} max={1} label={["left", "right"]} onChange={( cross ) => set( { cross } )} onCommit={done} />
        </div>
        <Field label="Depth"><NumberField onCommit={done} value={r.crossDepth} step={0.1} unit=" m" onChange={( crossDepth ) => set( { crossDepth } )} /></Field>
        <Field label="">
          <div style={{ display: "flex", gap: 4 }}>
            {!net.grow && <button className="btn small" onClick={() => fitToGroundPicked()}><Icon name="mountain" size={12} /> Fit to Ground</button>}
            <button className="btn small" onClick={() => deleteTrails( [], [r.id] )}><Icon name="trash" size={12} /> Delete</button>
          </div>
        </Field>
      </div>
    </Panel>
  );
}

/**
 * The Trails tool's own settings: new runs, the ground round the trails, and what can be done to all of them.
**/
export function TrailToolPanel() {
  const tool    = useEditor( ( s ) => s.trailTool          );
  const runs    = useEditor( ( s ) => s.trails.runs.length );
  const grown   = useEditor( ( s ) => !!s.trails.grow      );
  // ( fitting: runs to fit, on ground that isn't all the trails' own )
  const fit     = !grown && runs > 0;
  const setTool = ( p: Partial<typeof tool> ) => useEditor.setState( { trailTool: { ...useEditor.getState().trailTool, ...p } } );
  return (
    <Panel icon="trail" title="Trails">
      <div className="props">
        <div className="section">New Runs</div>
        <Field label="Width"><NumberField value={tool.width} step={1} min={2} max={300} unit=" m" onChange={( width ) => setTool( { width } )} /></Field>
        <label />
        <label style={{ color: "var(--text)" }}>
          <input type="checkbox" checked={tool.follow} onChange={( e ) => setTool( { follow: e.target.checked } )} /> Follow Ground
        </label>

        {( fit || realTerrainOf() ) && <div className="section">Runs</div>}
        { ( fit || realTerrainOf() ) && <Field label="">
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {fit && <button className="btn small" onClick={() => fitToGroundPicked()}><Icon name="mountain" size={12} /> Fit to Ground</button>}
            { realTerrainOf() && (
              <button className="btn small" onClick={() => void import( "../../trails/fromRuns" ).then( async ( t ) => {
                const r = await t.trailsFromRuns( realTerrainOf() );
                if ( typeof r === "string" ) useEditor.getState().toast( r, "info" );
              } )}><Icon name="trail" size={12} /> Trails from Runs</button>
            ) }
          </div>
        </Field> }
      </div>
    </Panel>
  );
}

/**
 * A point: where it is ( Blender's axes: Y the game's Z, Z up ).
**/
export function TrailNodeProperties( { n }: { n: TrailNode } ) {
  const net = useEditor( ( s ) => s.trails );
  const set = ( p: [number, number, number] ) => {
    const next = structuredClone( useEditor.getState().trails );
    next.nodes.find( ( x ) => x.id === n.id )!.p = p;
    previewNet( next );
  };
  const done  = () => commitMoved( useEditor.getState().trails, [n.id], "Move point" );
  const at    = runsAt( net, n.id );
  const width = at.length ? at.reduce( ( sum, r ) => sum + ( r.a === n.id ? r.wa : r.wb ), 0 ) / at.length : 0;
  return (
    <Panel icon="trail" title="Point">
      <div className="props">
        { at.length > 0 && (
          <Field label="Width">
            <NumberField value={width} step={0.5} min={1} max={300} unit=" m" onChange={( w ) => previewNet( withWidthAt( useEditor.getState().trails, n.id, w ) )} onCommit={() => commitMoved( useEditor.getState().trails, [n.id], "Change width" )} />
          </Field>
        ) }
        <Field label="X"><NumberField value={n.p[0]} step={0.5} unit=" m" onChange={( x ) => set( [x, n.p[1], n.p[2]] )} onCommit={done} /></Field>
        <Field label="Y"><NumberField value={n.p[2]} step={0.5} unit=" m" onChange={( y ) => set( [n.p[0], n.p[1], y] )} onCommit={done} /></Field>
        <Field label="Z"><NumberField value={n.p[1]} step={0.1} unit=" m" onChange={( z ) => set( [n.p[0], z, n.p[2]] )} onCommit={done} /></Field>
        <Field label="Runs"><span style={{ color: "var(--muted)" }}>{runsAt( net, n.id ).length}</span></Field>
        <Field label=""><button className="btn small" onClick={() => deleteTrails( [n.id], [] )}><Icon name="trash" size={12} /> Delete</button></Field>
      </div>
    </Panel>
  );
}
