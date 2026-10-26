// The game's look for its objects: the pieces built for a feature, its direction and colour ( a renderer of their
// own ), and the plain look of what has no settings ( instanced ).

import * as THREE from "three/webgpu";
import { type GameSpin, ipc } from "../../../core/ipc";
import type { CustomObjectEntry, ObjectEntry } from "../../../core/types";
import { CustomObjectsRenderer } from "../customRenderer";

// The placeholder models are twice the size of the game's own ( see jibbers-player-scale ).
export const PLACEHOLDER_TO_GAME = 0.5;

// The game-look pieces are the game's prefabs ( the placeholders' size ) at half size ( gamelook/features.rs ).
export const LOOK_TO_PLACEHOLDER = 2;

/**
 * An object's settings as the game reads them ( colour, direction… ): those that change how it looks ( its lights'
 * colour and brightness are the lamps', not the piece's ).
**/
export const settingsOf = ( o: ObjectEntry ) => Object.fromEntries( Object.entries( o.params ?? {} ).filter( ( [k] ) => k !== "light-color" && k !== "light-intensity" ).map( ( [k, v] ) => [k, String( v.value )] ) );

// The game-look piece for a feature and its settings ( its file, drawn by a renderer of its own, shared ).
const looks = new Map<string, Promise<{ r: CustomObjectsRenderer; object: CustomObjectEntry } | null>>();

export function lookFor( id: string, settings: Record<string, string> ) {
  const key = `${id}|${JSON.stringify( settings )}`;
  let p     = looks.get( key );
  if ( !p ) {
    p = ipc
      .gameObjectLook( id, settings )
      .then( async ( file ) => {
        if ( !file ) return null;
        const { index, object } = await ipc.libraryEntryPreview( file );
        const r                 = new CustomObjectsRenderer();
        r.useIndex( index );
        return { r, object: { ...( object as Omit<CustomObjectEntry, "uid"> ), uid: "look" } as CustomObjectEntry };
      } )
      .catch( ( e ) => {
        console.warn( "no game look for", id, e );
        return null;
      } );
    looks.set( key, p );
  }
  return { key, look: p };
}

// A piece in the game's look with no settings ( a lift's `chairlift:mast`, `tbar:carrier`…, a map's tree ): its
// meshes, placed in the piece's frame; null when the game's look has none. Kept once it's come, so a lift moved is
// dressed again straight away.
const plainLooks = new Map<string, Promise<THREE.Mesh[] | null>>();

export const plainLooksReady = new Map<string, THREE.Mesh[] | null>();

// the wheels the game turns on its pieces ( read once )
let gameSpins: Promise<Record<string, GameSpin[]>> | null = null;

export function plainLook( key: string ) {
  let p = plainLooks.get( key );
  if ( !p ) {
    p = lookFor( key, {} ).look.then( async ( lk ) => {
      let meshes: THREE.Mesh[] | null = null;
      if ( lk ) {
        const g = await lk.r.buildGroup( lk.object );
        g.updateMatrixWorld( true );
        const found: THREE.Mesh[] = [];
        g.traverse( ( x ) => ( x as THREE.Mesh ).isMesh && found.push( x as THREE.Mesh ) );
        if ( found.length ) meshes = found;
        // its wheels ( a lift station's ), each a part of its own: which, and how they turn
        gameSpins ??= ipc.gameSpins().catch( () => ( {} ) );
        const spins = ( await gameSpins )[key] ?? [];
        for ( const m of found ) {
          const part = /\/g(\d+)$/.exec( lk.object.parts[m.userData.partIndex as number]?.mesh ?? "" )?.[1];
          const s    = spins.find( ( x ) => String( x.part ) === part );
          if ( s ) m.userData.spin = s;
        }
      }
      plainLooksReady.set( key, meshes );
      return meshes;
    } );
    plainLooks.set( key, p );
  }
  return p;
}
