// What the open project keeps besides the editor's state: which chunks are saved as they are, its piece ids, and
// what it was made from ( the map it came from, a real place's terrain ).

import type { Shape } from "../../terrain/shapes/shapes";
import { terrain } from "../../terrain/terrain";
import { trailEditorData } from "../../trails/edits";
import { type Collection, newUid, useEditor } from "../store";

// chunk key -> heights version saved to disk, to skip unchanged chunks on save
export const savedVersion = new Map<string, number>();

export const chunkVersion = new Map<string, number>();

// chunk key -> the heights array that was saved ( a chunk swapped for another array, e.g. by undoing a change to the
// map's size, must be written even if no edit bumped its version )
export const savedArray = new Map<string, Float32Array>();

terrain.subscribe( ( dirty ) => {
  for ( const ci of dirty.keys() ) {
    const k = terrain.chunks[ci]?.key;
    if ( k ) chunkVersion.set( k, ( chunkVersion.get( k ) ?? 0 ) + 1 );
  }
} );

export const uuid = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace( /[xy]/g, ( c ) => {
    const r = ( Math.random() * 16 ) | 0;
    return ( c === "x" ? r : ( r & 0x3 ) | 0x8 ).toString( 16 );
  } );

// The editor's own data in project.json.
export interface EditorData {
  // 2: saved after the jib fix was narrowed ( see undoUpMethodSwitch )
  jibFix?:      number;
  shapes?:      Shape[];
  trails?:      ReturnType<typeof trailEditorData>;
  collections?: Collection[];
  membership?:  Record<string, string>;
  labels?:      Record<string, string>;
  // uids locked in the Outliner ( missing: the surroundings are )
  locked?:      string[];
  // uids hidden in the 3D view
  hidden?:      string[];
  customUids?:  string[];
  // the map in the game this project last wrote ( to tell it from one it didn't: exportToGame )
  exported?:    Exported;
  // the game map this project was imported from
  sourceMapId?: string;
  realTerrain?: RealTerrainData;
}

interface Exported {
  id:       string;
  bytes:    number;
  // when it was written ( ms )
  modified: number;
}

// This project's own bookkeeping ( in its editor data ).
export const meta: { exported?: Exported; sourceMapId?: string; realTerrain?: RealTerrainData } = {};

// A real mountain's place on the earth and its data's credits ( from its import; kept through saves ).
type RealTerrainData = { center: { lon: number; lat: number }; seaLevelOffset: number; source?: string; attribution?: string[] };

/**
 * Where this map is on the earth, if it was imported from a real mountain.
**/
export const realTerrainOf = () => meta.realTerrain;

export const usedUids = new Set<string>();

/**
 * The saved uid at `i`, or a fresh one ( missing, or already handed out ).
**/
export function uidAt( list: string[] | undefined, i: number ) {
  const u = list?.[i];
  if ( u && !usedUids.has( u ) ) {
    usedUids.add( u );
    return u;
  }
  return newUid();
}

// edits after an export make the game's copy out of date
useEditor.subscribe( ( s, prev ) => {
  if ( s.dirty && !prev.dirty && s.gameCopy === "current" ) useEditor.setState( { gameCopy: "stale" } );
} );
