// 3D previews and drag ghosts for the asset browser, built with the viewport's own renderer and materials so they
// look exactly like the scene. Each library entry ( a file ) has its own asset cache.
//
// Drawing one means loading its model, making its materials ( their shaders ) and rendering it — enough to make the
// 3D view stutter, and a folder of them at once made it crawl. So a few are loaded at a time ( files, on other
// threads ) but drawn one at a time with the view drawing in between, and they're kept on disk ( by the library
// file's size and date ): each is drawn once, not every session.

import { useEffect, useState, useSyncExternalStore } from "react";
import * as THREE from "three/webgpu";
import { ipc, joinPath, type LibraryEntry } from "../core/ipc";
import type { CustomMaterial, CustomObjectEntry } from "../core/types";
import { userPath } from "../pieces/library";
import { useEditor } from "../map/store";
import { materialKey } from "../pieces/userAssets";
import { CustomObjectsRenderer } from "../viewport/render/customRenderer";
import { getEngine } from "./Viewport";

// Bump when previews are drawn differently: the ones on disk are drawn again.
const PREVIEW_VERSION = 1;

const sphere = new THREE.SphereGeometry( 0.5, 48, 32 );

const userRenderers = new Map<string, Promise<{ r: CustomObjectsRenderer; object: CustomObjectEntry }>>();
function userEntry( path: string ) {
  let p = userRenderers.get( path );
  if ( !p ) {
    p = ipc.libraryEntryPreview( path ).then( ( { index, object } ) => {
      const r = new CustomObjectsRenderer();
      r.useIndex( index );
      return { r, object: { ...( object as Omit<CustomObjectEntry, "uid"> ), uid: "preview" } as CustomObjectEntry };
    } );
    userRenderers.set( path, p );
  }
  return p;
}

/**
 * A fresh 3D copy of a library mesh ( for a drag ghost or a preview ).
**/
export async function entryObject( e: LibraryEntry ): Promise<THREE.Group> {
  const { r, object } = await userEntry( userPath( e ) );
  return r.buildGroup( object );
}

/**
 * A library entry drawn for its preview with a loader of its own, everything it loaded let go once the picture is
 * taken ( kept, a bar's worth of previews held some 6 GB of graphics memory — taken from the game when it plays ).
**/
async function drawEntry( e: LibraryEntry ): Promise<string> {
  return drawFile( userPath( e ), e.kind === "material" ? e.material : null );
}

/**
 * A library file drawn for its preview ( a mesh, or `material` on a sphere ).
**/
async function drawFile( path: string, material: CustomMaterial | null ): Promise<string> {
  const { index, object } = await ipc.libraryEntryPreview( path );
  const r                 = new CustomObjectsRenderer();
  r.useIndex( index );
  try {
    const obj = material
      ? new THREE.Mesh( sphere, await r.materials.material( material ) )
      : await r.buildGroup( { ...( object as Omit<CustomObjectEntry, "uid"> ), uid: "preview" } as CustomObjectEntry );
    return await inTurn( async () => {
      const eng = await engine();
      return material ? eng.pictures.renderPreview( obj, 128, 128 ) : eng.pictures.renderPreview( obj );
    } );
  } finally {
    r.clear();
  }
}

const cache = new Map<string, Promise<string | null>>();
function cached( key: string, make: () => Promise<string | null> ) {
  let p = cache.get( key );
  if ( !p ) {
    p = make().catch( ( err ) => {
      console.warn( "preview failed", key, err );
      return null;
    } );
    cache.set( key, p );
  }
  return p;
}

async function engine() {
  const eng = getEngine();
  if ( !eng ) throw new Error( "viewport not ready" );
  await eng.ready;
  return eng;
}

// ---------------------------------------------------------------- one at a time

// previews waiting to be drawn or being drawn ( for the asset bar's indicator )
let pending      = 0;
const listeners  = new Set<() => void>();
const setPending = ( n: number ) => {
  pending = n;
  for ( const l of listeners ) l();
};
/**
 * counted as pending until it's done
**/
function counted<T>( job: () => Promise<T> ): Promise<T> {
  setPending( pending + 1 );
  return job().finally( () => setPending( pending - 1 ) );
}

// a load waiting its turn: woken when one finishes
type Wake = () => void;

// at most this many models loading at once ( their files read and converted off the page's thread )
const LOADING_AT_ONCE = 3;
let loading           = 0;
const waiting: Wake[] = [];
async function fewAtATime<T>( job: () => Promise<T> ): Promise<T> {
  while ( loading >= LOADING_AT_ONCE ) await new Promise<void>( ( r ) => waiting.push( r ) );
  loading++;
  try {
    return await job();
  } finally {
    loading--;
    waiting.shift()?.();
  }
}

let line: Promise<unknown> = Promise.resolve();

/**
 * `job` after every one before it, with a frame of the 3D view drawn in between.
**/
function inTurn<T>( job: () => Promise<T> ): Promise<T> {
  const run = line.then( () => new Promise( ( r ) => requestAnimationFrame( () => r( null ) ) ) ).then( job );
  line      = run.catch( () => {} );
  return run;
}

export const previewsPending = () => pending;

/**
 * How many previews are still to be drawn.
**/
export function usePreviewsPending() {
  return useSyncExternalStore(
    ( l ) => {
      listeners.add( l );
      return () => listeners.delete( l );
    },
    () => pending,
  );
}

// ---------------------------------------------------------------- kept on disk

let folder: Promise<string | null> | undefined;
const previewFolder = () => ( folder ??= ipc.appInfo().then( ( i ) => joinPath( i.dataDir, "cache", "previews" ) ).catch( () => null ) );

/**
 * FNV-1a, for file names ( stable across sessions ).
**/
function fnv( s: string ) {
  let h = 0x811c9dc5;
  for ( let i = 0; i < s.length; i++ ) h = Math.imul( h ^ s.charCodeAt( i ), 0x01000193 ) >>> 0;
  return h.toString( 16 ).padStart( 8, "0" );
}

/**
 * A library entry's preview from disk when it was drawn before ( for this version of its file ), else drawn and kept.
**/
async function onDisk( e: LibraryEntry, draw: () => Promise<string | null> ): Promise<string | null> {
  const dir   = await previewFolder();
  const stamp = dir ? await ipc.fileStamp( userPath( e ) ).catch( () => null ) : null;
  if ( !dir || !stamp ) return draw();
  const key  = `${PREVIEW_VERSION}|${e.id}|${stamp[0]}|${stamp[1]}`;
  const file = joinPath( dir, `${fnv( key )}-${fnv( key.split( "" ).reverse().join( "" ) )}.png` );
  if ( await ipc.pathExists( file ).catch( () => false ) ) {
    try {
      return URL.createObjectURL( new Blob( [await ipc.readBinary( file )], { type: "image/png" } ) );
    } catch {
      // unreadable: drawn again
    }
  }
  const url = await draw();
  if ( url ) {
    const png = new Uint8Array( await ( await fetch( url ) ).arrayBuffer() );
    ipc.writeBinary( file, png ).catch( ( err ) => console.warn( "couldn't keep the preview", err ) );
  }
  return url;
}

// ---------------------------------------------------------------- previews

export function entryPreview( e: LibraryEntry ) {
  return cached( e.id, () =>
    onDisk( e, () =>
      counted( () => fewAtATime( () => drawEntry( e ) ) ),
    ),
  );
}

/**
 * A lift's card: its base station in the game's look ( null where the game isn't installed ).
**/
export function liftPreview( id: string ) {
  return cached( `lift:${id}`, () =>
    counted( async () => {
      const file = await ipc.gameObjectLook( `${id}:base`, {} );
      return file ? fewAtATime( () => drawFile( file, null ) ) : null;
    } ),
  );
}

/**
 * A material the open map uses ( its textures are already in the viewport's cache ).
**/
export function mapMaterialPreview( m: CustomMaterial ) {
  const dir = useEditor.getState().projectDir ?? "";
  return cached( `map:${dir}:${materialKey( m )}`, () =>
    counted( () =>
      inTurn( async () => {
        const eng = await engine();
        return eng.pictures.renderPreview( new THREE.Mesh( sphere, await eng.customR.materials.material( m ) ), 128, 128 );
      } ),
    ),
  );
}

/**
 * A material on a sphere, as the Material tab's Preview shows it ( by everything about it ).
**/
export function materialSpherePreview( m: CustomMaterial ) {
  const dir = useEditor.getState().projectDir ?? "";
  return cached( `sphere:${dir}:${JSON.stringify( m )}`, () =>
    counted( () =>
      inTurn( async () => {
        const eng = await engine();
        return eng.pictures.renderPreview( new THREE.Mesh( sphere, await eng.customR.materials.material( m ) ), 192, 192 );
      } ),
    ),
  );
}

/**
 * After the library was rebuilt: everything is loaded and rendered afresh ( the disk copies go by the files' dates ).
**/
export function resetLibraryPreviews() {
  userRenderers.clear();
  cache.clear();
}

/**
 * Forget a deleted personal entry.
**/
export function dropPreview( id: string ) {
  cache.delete( id );
  userRenderers.delete( id.slice( id.indexOf( ":" ) + 1 ) );
}

/**
 * A card's preview: undefined while it's being made, null when there's none.
**/
export function usePreview( make: () => Promise<string | null>, deps: unknown[] ) {
  const [url, setUrl] = useState<string | null | undefined>( undefined );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect( () => {
    let alive = true;
    setUrl( undefined );
    make().then( ( u ) => alive && setUrl( u ) );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps );
  return url;
}
