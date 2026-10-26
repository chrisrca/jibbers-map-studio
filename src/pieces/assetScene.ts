// The Assets workspace's own scene: an asset being made or changed, kept apart from the map ( Blender's own file for
// it, in effect ). Going into Assets sets the map's contents, selection and undo steps aside and brings the asset
// scene's in; coming out swaps them back. Whatever's shown, saving and exporting the map use the map's ( mapState ).

import { history, type HistoryEntry } from "../map/history";
import { useEditor, workspaceOf, type EditorState } from "../map/store";

type Slice = Pick<EditorState, "objects" | "spawns" | "customObjects" | "shapes" | "collections" | "membership" | "labels" | "locked" | "selection" | "activeCollection" | "hiddenInView">;
const KEYS = ["objects", "spawns", "customObjects", "shapes", "collections", "membership", "labels", "locked", "selection", "activeCollection", "hiddenInView"] as const;

const take  = ( s: EditorState ): Slice => Object.fromEntries( KEYS.map( ( k ) => [k, s[k]] ) ) as Slice;
const empty = (): Slice => ( { objects: [], spawns: [], customObjects: [], shapes: [], collections: [], membership: {}, labels: {}, locked: {}, selection: [], activeCollection: null, hiddenInView: {} } );

// the map's, while the asset scene is shown
let mapSlice:     Slice | null = null;
let mapHistory:   { past: HistoryEntry[]; future: HistoryEntry[] } | null = null;
// the asset scene's, while the map is shown
let assetSlice:   Slice        = empty();
let assetHistory: { past: HistoryEntry[]; future: HistoryEntry[] } = { past: [], future: [] };

/**
 * Whether the asset scene is what's shown.
**/
export const inAssets = () => mapSlice !== null;

/**
 * The document with the map's contents, whichever is shown ( for saving and exporting the map ).
**/
export function mapState(): EditorState {
  const s = useEditor.getState();
  return mapSlice ? { ...s, ...mapSlice } : s;
}

function enter() {
  if ( mapSlice ) return;
  mapSlice   = take( useEditor.getState() );
  mapHistory = history.take();
  useEditor.setState( { ...assetSlice } );
  history.restore( assetHistory );
}

function leave() {
  if ( !mapSlice ) return;
  assetSlice   = take( useEditor.getState() );
  assetHistory = history.take();
  const back   = mapSlice;
  mapSlice     = null;
  useEditor.setState( { ...back } );
  history.restore( mapHistory ?? { past: [], future: [] } );
  mapHistory = null;
}

/**
 * A project opening or closing: the map's contents are replaced, so nothing's kept for it ( the asset scene stays ).
**/
export function leaveAssetsForNewMap() {
  if ( !mapSlice ) return;
  assetSlice   = take( useEditor.getState() );
  assetHistory = history.take();
  mapSlice     = null;
  mapHistory   = null;
  useEditor.setState( { tool: "select" } );
}

/**
 * The asset scene's contents replaced ( an asset opened from the library, or a new one ).
**/
export function setAssetScene( customObjects: EditorState["customObjects"] ) {
  const slice = { ...empty(), customObjects, selection: customObjects.slice( -1 ).map( ( o ) => ( { kind: "custom" as const, uid: o.uid } ) ) };
  if ( mapSlice ) {
    useEditor.setState( slice );
    history.clear();
  } else {
    assetSlice   = slice;
    assetHistory = { past: [], future: [] };
  }
}

/**
 * The asset scene's pieces, whichever scene is shown.
**/
export const assetObjects = () => ( mapSlice ? useEditor.getState().customObjects : assetSlice.customObjects );

/**
 * The map's pieces replaced, whichever scene is shown ( placed copies of an asset saved over ).
**/
export function setMapCustomObjects( customObjects: EditorState["customObjects"] ) {
  if ( mapSlice ) mapSlice = { ...mapSlice, customObjects };
  else useEditor.setState( { customObjects } );
  useEditor.setState( { dirty: true } );
}

// in and out with the workspace
useEditor.subscribe( ( s, prev ) => {
  if ( s.tool === prev.tool ) return;
  const was = workspaceOf( prev.tool ) === "assets", now = workspaceOf( s.tool ) === "assets";
  if ( now && !was ) enter();
  else if ( was && !now ) leave();
} );
