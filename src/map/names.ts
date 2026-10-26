// Names as Blender gives them: what a piece is ( "Cube", "Flat Down Flat Box" ), and when that's taken, the next free
// ".001", ".002"… A piece without a name of its own ( older maps ) goes by what it's made of.

import { customName, type CustomObjectEntry } from "../core/types";
import type { EditorState } from "./store";

/**
 * A piece's name: its own, else what it's made of.
**/
export const pieceName = ( st: Pick<EditorState, "labels">, o: CustomObjectEntry ) => st.labels[o.uid] || customName( o );

/**
 * "Cube.003" → "Cube"
**/
export const baseName = ( n: string ) => n.replace( /\.\d{3,}$/, "" );

/**
 * `want` if it's free among the pieces' names ( `self` aside ), else Blender's next ".001".
**/
export function uniqueName( st: Pick<EditorState, "labels" | "customObjects">, want: string, self?: string ) {
  const taken = new Set( st.customObjects.filter( ( o ) => o.uid !== self ).map( ( o ) => pieceName( st, o ) ) );
  if ( !taken.has( want ) ) return want;
  const base = baseName( want );
  for ( let k = 1; ; k++ ) {
    const n = `${base}.${String( k ).padStart( 3, "0" )}`;
    if ( !taken.has( n ) ) return n;
  }
}

/**
 * Names for pieces just made ( `from`: each one's source, or the name it should have ): unique among the others and
 * each other.
**/
export function namesFor( st: Pick<EditorState, "labels" | "customObjects">, made: { uid: string; want: string }[] ) {
  const labels = { ...st.labels };
  const view   = { labels, customObjects: st.customObjects };
  for ( const m of made ) labels[m.uid] = uniqueName( view, m.want, m.uid );
  return labels;
}
