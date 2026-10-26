// The brush settings remembered between sessions ( the sculpt brushes', the paint's ), in the browser's storage.

import { DEFAULT_PAINT, type PaintSettings, mergePaint } from "../../paint/settings";
import { type SculptState, mergeSculpt } from "../../sculpt/brushes";
import { testRun } from "./index";

const SCULPT_KEY = "jibbers.sculpt.v2";

export function loadSculpt(): SculptState {
  try {
    return mergeSculpt( JSON.parse( localStorage.getItem( SCULPT_KEY ) ?? "null" ) );
  } catch {
    return mergeSculpt( null );
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function loadPaint(): PaintSettings {
  try {
    return mergePaint( JSON.parse( localStorage.getItem( "jibbers.paint.v1" ) ?? "{}" ) );
  } catch {
    return { ...DEFAULT_PAINT };
  }
}

export function saveSculpt( sc: SculptState ) {
  if ( testRun.active ) return;
  if ( saveTimer ) clearTimeout( saveTimer );
  saveTimer = setTimeout( () => {
    try {
      localStorage.setItem( SCULPT_KEY, JSON.stringify( sc ) );
    } catch {
      // storage full or unavailable: settings just aren't remembered
    }
  }, 400 );
}
