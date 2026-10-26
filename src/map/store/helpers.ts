// Small things about the editor's state: new ids, which workspace a tool is in, what's unlocked, a parameter's
// default.

import type { ParamValue, PlaceholderInfo } from "../../core/types";
import type { EditorState, Selection, ToolId } from "./types";

export const newUid = () => Math.random().toString( 36 ).slice( 2, 10 );

/**
 * The workspace ( the menu bar's tabs ) a tool is in.
**/
export const workspaceOf = ( t: ToolId ) => ( t === "sculpt" || t === "shape" || t === "trail" ? "sculpting" : t === "paint" ? "painting" : t === "model" || t === "material" ? "assets" : "layout" );

/**
 * What the viewport can pick and Select All takes: everything not locked.
**/
export const unlocked = ( s: Pick<EditorState, "locked">, sel: Selection[] ) => sel.filter( ( x ) => !s.locked[x.uid] );

/**
 * The membership with `uids` put into the active collection ( if one is ).
**/
export function intoActive( s: EditorState, uids: string[] ) {
  if ( !s.activeCollection || !s.collections.some( ( c ) => c.id === s.activeCollection ) ) return s.membership;
  const m = { ...s.membership };
  for ( const u of uids ) m[u] = s.activeCollection;
  return m;
}

export const paramDefault = ( p: PlaceholderInfo["parameters"][number] ): ParamValue => {
  switch ( p.type ) {
    case "int":   return { type: "Int",    value: Number( p.default ) };
    case "float": return { type: "Float",  value: Number( p.default ) };
    case "bool":  return { type: "Bool",   value: Boolean( p.default ) };
    default:      return { type: "String", value: String( p.default ) };
  }
};
