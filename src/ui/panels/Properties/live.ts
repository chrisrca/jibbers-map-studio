// Properties' live edits: a field dragged changes the map as it goes, and one undo step is kept when it's let go.

import { useRef } from "react";
import type { CustomObjectEntry, ObjectEntry, SpawnEntry } from "../../../core/types";
import { history } from "../../../map/history";
import { useEditor } from "../../../map/store";

// Live-edits go straight into the store; a single undo step is recorded when the edit commits
// ( field blur / drag end ), so dragging a number doesn't flood the history.
type Snapshot = { objects: ObjectEntry[]; spawns: SpawnEntry[]; customObjects: CustomObjectEntry[] };

const snapshot = (): Snapshot => {
  const s = useEditor.getState();
  return { objects: s.objects, spawns: s.spawns, customObjects: s.customObjects };
};

/**
 * Whether two lists hold the same things: the same entries, or ones made again with the same values ( a field saving
 * as Enter's pressed and again as it loses focus: the second no change, and no undo step of its own ). Only the
 * entries made again are compared by value.
**/
const same = <T>( a: T[], b: T[] ) => a === b || ( a.length === b.length && a.every( ( x, i ) => x === b[i] || JSON.stringify( x ) === JSON.stringify( b[i] ) ) );

export function useLiveEdit() {
  const start = useRef<Snapshot | null>( null );
  const begin = () => {
    if ( !start.current ) start.current = snapshot();
  };
  const commit = ( label: string ) => {
    const prev    = start.current;
    start.current = null;
    if ( !prev ) return;
    const after = snapshot();
    if ( same( after.objects, prev.objects ) && same( after.spawns, prev.spawns ) && same( after.customObjects, prev.customObjects ) ) return;
    history.push( {
      label,
      undo: () => useEditor.setState( { ...prev,  dirty: true } ),
      redo: () => useEditor.setState( { ...after, dirty: true } ),
    } );
    useEditor.setState( { dirty: true } );
  };
  return { begin, commit };
}

export type Live = ReturnType<typeof useLiveEdit>;

let colourRest = 0;

/**
 * A colour being picked kept as one undo step: once the picker has rested a moment ( it changes as it's dragged ).
**/
export function commitWhenStill( commit: () => void ) {
  clearTimeout( colourRest );
  colourRest = window.setTimeout( commit, 400 );
}
