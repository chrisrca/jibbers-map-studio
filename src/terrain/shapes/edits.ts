// Editing terrain shapes from the UI: live changes while dragging a handle or a slider, one undo step per edit.

import { beginShapeEdit, commitShapeEdit, previewShape, removeShape, type Shape, type ShapeEdit } from "./shapes";
import { useEditor } from "../../map/store";

let session: { edit: ShapeEdit; before: Shape[]; label: string } | null = null;

/**
 * Applies a changed ( or new ) shape right away; the edit stays open until `commitShape`.
**/
export function liveShape( next: Shape, label = "Edit shape" ) {
  const st = useEditor.getState();
  if ( session && session.edit.uid !== next.uid ) commitShape();
  if ( !session ) session = { edit: beginShapeEdit( next.uid ), before: st.shapes, label };
  previewShape( next );
  const exists = st.shapes.some( ( s ) => s.uid === next.uid );
  useEditor.setState( { shapes: exists ? st.shapes.map( ( s ) => ( s.uid === next.uid ? next : s ) ) : [...st.shapes, next], dirty: true } );
  // a new shape goes into the Outliner's active collection, like everything else
  if ( !exists && st.activeCollection && st.collections.some( ( c ) => c.id === st.activeCollection ) )
    useEditor.setState( { membership: { ...st.membership, [next.uid]: st.activeCollection } } );
}

/**
 * Ends the open edit as one undo step.
**/
export function commitShape() {
  if ( !session ) return;
  const s     = session;
  session     = null;
  const after = useEditor.getState().shapes;
  commitShapeEdit( s.edit, s.label, {
    undo: () => useEditor.setState( { shapes: s.before, dirty: true } ),
    redo: () => useEditor.setState( { shapes: after,    dirty: true } ),
  } );
}

/**
 * Abandons the open edit ( e.g. a shape drawn too small to keep ): the terrain and the list go back as they were.
**/
export function cancelShape() {
  if ( !session ) return;
  const s = session;
  session = null;
  removeShape( s.edit.uid );
  const prev = s.before.find( ( x ) => x.uid === s.edit.uid );
  if ( prev ) previewShape( prev );
  useEditor.setState( { shapes: s.before } );
}

export function deleteShape( uid: string ) {
  commitShape();
  const st     = useEditor.getState();
  const before = st.shapes;
  const edit   = beginShapeEdit( uid );
  removeShape( uid );
  const after = before.filter( ( s ) => s.uid !== uid );
  useEditor.setState( { shapes: after, selection: st.selection.filter( ( s ) => s.uid !== uid ), dirty: true } );
  commitShapeEdit( edit, "Delete shape", {
    undo: () => useEditor.setState( { shapes: before, dirty: true } ),
    redo: () => useEditor.setState( { shapes: after,  dirty: true } ),
  } );
}
