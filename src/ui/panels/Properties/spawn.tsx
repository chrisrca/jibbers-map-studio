// A spawn in Properties: where the rider starts, and how fast.

import type { SpawnEntry } from "../../../core/types";
import { useEditor } from "../../../map/store";
import { NumberField, Panel, Vec3Field } from "../../widgets/controls";
import type { Live } from "./live";

export function SpawnProperties( { sp, live }: { sp: SpawnEntry; live: Live } ) {
  const edit = ( f: ( s: SpawnEntry ) => SpawnEntry ) => {
    live.begin();
    useEditor.setState( ( s ) => ( { spawns: s.spawns.map( ( x ) => ( x.uid === sp.uid ? f( x ) : x ) ) } ) );
  };
  const commit          = () => live.commit( `Edit spawn ${sp.name}` );
  const speed           = Math.hypot( ...sp.velocity );
  const heading         = ( Math.atan2( sp.velocity[0], sp.velocity[2] ) * 180 ) / Math.PI;
  const setSpeedHeading = ( kmh: number, deg: number ) => {
    const v       = kmh / 3.6;
    const vyRatio = sp.velocity[1] / ( speed || 1 );
    const h       = v * Math.sqrt( Math.max( 0, 1 - vyRatio * vyRatio ) );
    const a       = ( deg * Math.PI ) / 180;
    edit( ( x ) => ( { ...x, velocity: [Math.sin( a ) * h, v * vyRatio, Math.cos( a ) * h], rotation: [x.rotation[0], ( ( deg % 360 ) + 360 ) % 360, x.rotation[2]] } ) );
  };

  return (
    <Panel icon="spawn" title={`Spawn · ${sp.name}`}>
      <div className="props">
        <div className="section">Spawn</div>
        <label>Name</label>
        <input
          className="txt"
          key={sp.uid}
          defaultValue={sp.name}
          onBlur={( e ) => { edit( ( x ) => ( { ...x, name: e.target.value } ) ); commit(); }}
          onKeyDown={( e ) => e.key === "Enter" && ( e.target as HTMLInputElement ).blur()}
        />
        <Vec3Field label="Location" value={sp.position} digits={4} trim unit="m" onChange={( v ) => edit( ( x ) => ( { ...x, position: v } ) )} onCommit={commit} />
        <div className="section">Start speed</div>
        <label>Speed</label>
        <NumberField value={speed * 3.6} step={0.5} digits={1} min={0} onChange={( v ) => setSpeedHeading( v, heading )} onCommit={commit} />
        <label>Heading</label>
        <NumberField value={heading} step={1} digits={0} unit="°" onChange={( v ) => setSpeedHeading( speed * 3.6, v )} onCommit={commit} />
        <Vec3Field label="Velocity" value={sp.velocity} digits={2} unit="m/s" onChange={( v ) => edit( ( x ) => ( { ...x, velocity: v } ) )} onCommit={commit} />
        <div className="note">Speed is km/h. The blue line shows a frictionless ride from this spawn — use it to size jumps.</div>
      </div>
    </Panel>
  );
}
