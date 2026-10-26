// Scenery ( a real map's land round the play area ) in Properties.

import { useEffect, useRef, useState } from "react";
import { type CustomObjectEntry, SCENERY_ROCK_ANGLE } from "../../../core/types";
import { useEditor } from "../../../map/store";
import { getEngine } from "../../Viewport";
import { Panel } from "../../widgets/controls";
import { NumSlider } from "../../widgets/widgets";

/**
 * A real-world map's surroundings: where its rock is painted.
**/
export function SceneryProperties( { o }: { o: CustomObjectEntry } ) {
  const saved             = o.scenery?.rockAngle ?? SCENERY_ROCK_ANGLE;
  const [angle, setAngle] = useState( saved );
  // ( what the slider is at, for when it lets go: its handlers were made when the drag began )
  const at                = useRef( saved );
  const [busy, setBusy]   = useState( false );
  useEffect( () => {
    at.current = saved;
    setAngle( saved );
  }, [saved] );
  const apply = async ( v: number ) => {
    if ( v === saved ) return;
    setBusy( true );
    try {
      const { repaintScenery } = await import( "../../../geo/scenery/inner" );
      await repaintScenery( o.uid, v );
      getEngine()?.customR.reloadLibrary();
    } catch ( e ) {
      useEditor.getState().toast( `The surroundings weren't painted: ${e}`, "error" );
      at.current = saved;
      setAngle( saved );
    } finally {
      setBusy( false );
    }
  };
  return (
    <Panel icon="mountain" title="Surroundings">
      <div className="props">
        <div className="section">Rock</div>
        <label>Rocks from</label>
        <NumSlider
          className={busy ? "busy" : ""}
          value={angle}
          min={5}
          max={60}
          step={1}
          fmt={( v ) => `${Math.round( v )}°`}
          onChange={( v ) => {
            at.current = v;
            setAngle( v );
          }}
          onCommit={() => void apply( at.current )}
        />
      </div>
    </Panel>
  );
}
