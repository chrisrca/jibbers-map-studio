// Recently opened projects ( File › Open Recent ).

import { testRun } from "../store";

export interface Recent {
  dir:    string;
  name:   string;
  at:     number;
  // the map's id ( to find the project for a map in the game folder )
  mapId?: string;
}

export function recentProjects(): Recent[] {
  try {
    return JSON.parse( localStorage.getItem( "recentProjects" ) ?? "[]" );
  } catch {
    return [];
  }
}

export function forgetRecent( dir: string ) {
  try {
    localStorage.setItem( "recentProjects", JSON.stringify( recentProjects().filter( ( r ) => r.dir !== dir ) ) );
  } catch {
    // storage unavailable
  }
}

export function rememberRecent( dir: string, name: string, mapId?: string ) {
  if ( testRun.active ) return;
  try {
    const list = recentProjects().filter( ( r ) => r.dir !== dir );
    list.unshift( { dir, name, at: Date.now(), mapId } );
    localStorage.setItem( "recentProjects", JSON.stringify( list.slice( 0, 12 ) ) );
  } catch {
    // storage unavailable
  }
}
