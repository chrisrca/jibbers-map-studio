// Undo and redo with a note of what changed ( the shortcuts and the Edit menu ).

import { history } from "../map/history";
import { useEditor } from "../map/store";

export function undo() {
  const l = history.undo();
  if ( l ) useEditor.getState().toast( `Undone: ${l}`, "info" );
}

export function redo() {
  const l = history.redo();
  if ( l ) useEditor.getState().toast( `Redone: ${l}`, "info" );
}
