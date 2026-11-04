// Blender's Adjust Last Operation for operators beyond Add › Mesh ( Duplicate Array… ): the last one's settings, shown
// in the 3D view's corner while it's still the last thing done; a change takes it back and does it again with them.

import { create } from "zustand";
import { history } from "../map/history";
import { useEditor, type Selection } from "../map/store";

// A setting, as its field shows it.
export interface OpField {
  key:     string;
  label:   string;
  step:    number;
  min?:    number;
  max?:    number;
  digits?: number;
  unit?:   string;
}

export interface LastOp {
  label:  string;
  fields: OpField[];
  values: Record<string, number>;
  run:    ( v: Record<string, number> ) => void;
  // what was selected when it ran ( put back to run it again ), and the undo step it made
  sel:    Selection[];
  entry:  unknown;
}

export const useLastOp = create<{ op: LastOp | null }>( () => ( { op: null } ) );

/**
 * Runs an operator with `values`, its settings then adjustable.
**/
export function doOp( label: string, fields: OpField[], values: Record<string, number>, run: ( v: Record<string, number> ) => void ) {
  const sel = useEditor.getState().selection;
  run( values );
  useLastOp.setState( { op: { label, fields, values, run, sel, entry: history.top } } );
}

/**
 * The last operator again with a setting changed ( what it did first taken back ).
**/
export function redoOp( key: string, value: number ) {
  const op = useLastOp.getState().op;
  if ( !op || history.top !== op.entry ) return;
  history.undo();
  useEditor.setState( { selection: op.sel } );
  doOp( op.label, op.fields, { ...op.values, [key]: value }, op.run );
}

/**
 * Whether the operator is still the last thing done.
**/
export const stillLastOp = ( op: LastOp | null ) => !!op && history.top === op.entry;
