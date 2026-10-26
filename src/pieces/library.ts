// The asset library shown in the bottom panel: folders of pieces and materials, one file each — the studio's own
// ( the official features ) and yours ( imports, maps' pieces, anything you put there ), shown as one ( src-tauri library/mod.rs ).

import * as THREE from "three/webgpu";
import { unityEulerToQuat, type V3 } from "../core/coords";
import { ipc, type LibraryEntry } from "../core/ipc";
import { withOverlay } from "../core/overlay";
import { deltaBetween, transformCustom } from "../core/transform";
import { arr3, type CustomMaterial, type CustomObjectEntry, type Rail } from "../core/types";
import { newUid, useEditor } from "../map/store";
import { getEngine } from "../ui/Viewport";
import { autoRail, fitParts, keepClear, recoverRail, withRail } from "./rail";
import { materialName } from "./userAssets";

export async function loadLibrary() {
  try {
    useEditor.setState( { assetLibrary: await ipc.listLibrary() } );
  } catch ( e ) {
    useEditor.getState().toast( `Couldn't read the asset library: ${e}`, "error" );
  }
}

/**
 * In your library ( yours to delete ), not the studio's.
**/
export const isUserEntry = ( e: LibraryEntry ) => e.id.startsWith( "user:" );
export const userPath    = ( e: LibraryEntry ) => e.id.slice( e.id.indexOf( ":" ) + 1 );

// "Features/<id>/<n>": the placeholder's meshes; "…/g<n>": the game's own ( src-tauri gamelook/features.rs )
const OFFICIAL_PIECE = /^Features\/([^/]+)\/g?\d+$/;

/**
 * The official feature a library piece was made from ( its id ), if it was.
**/
export const officialOf = ( o: CustomObjectEntry ) => OFFICIAL_PIECE.exec( o.parts[0]?.mesh ?? "" )?.[1] ?? null;

// Official pieces that look the same turned about their length ( their local Z ), found by checking every library
// mesh against itself turned: tube_long is round ( any turn looks the same ), flat_box looks the same after half a
// turn. Turned that way by accident ( scaling through zero with the gizmo used to flip things over ), nothing in the
// editor shows it — but the game reads which side is the top from the piece's turn, so it won't grind.
const ROUND            = new Set( ["tube_long"]             );
const SAME_HALF_TURNED = new Set( ["tube_long", "flat_box"] );

/**
 * How far an object's own up points along the world's up ( 1 upright, -1 upside down ).
**/
export function uprightness( o: CustomObjectEntry ) {
  return new THREE.Vector3( 0, 1, 0 ).applyQuaternion( unityEulerToQuat( arr3( o.rotation ) ) ).y;
}

/**
 * The object turned half a turn about its own length ( its local Z ), parts and colliders with it.
**/
export function turnedOver( o: CustomObjectEntry ): CustomObjectEntry {
  const cur = { pos: arr3( o.position ), rot: arr3( o.rotation ), scl: arr3( o.scale ) };
  return transformCustom( o, deltaBetween( cur, { ...cur, rot: [cur.rot[0], cur.rot[1], ( cur.rot[2] + 180 ) % 360] } ) );
}

/**
 * The object turned about its own length ( local Z ) to Unity rotation Z = `z`, parts and colliders with it.
**/
function rolledTo( o: CustomObjectEntry, z: number ): CustomObjectEntry {
  const cur = { pos: arr3( o.position ), rot: arr3( o.rotation ), scl: arr3( o.scale ) };
  return transformCustom( o, deltaBetween( cur, { ...cur, rot: [cur.rot[0], cur.rot[1], z] } ) );
}

const angleOff = ( a: number, b: number ) => Math.abs( ( ( a - b + 540 ) % 360 ) - 180 );

/**
 * Official pieces that look the same whichever way round they are about their length, but were left turned with
 * their top facing down or sideways: turned back so it faces up. They look no different, but the game sees their
 * top where it should be. Nothing else is touched. Returns the pieces ( the same array when nothing needed it ) and
 * how many were fixed.
**/
export function fixJibs( list: CustomObjectEntry[] ): { list: CustomObjectEntry[]; fixed: number } {
  let fixed = 0;
  const out = list.map( ( o ) => {
    const id = officialOf( o );
    if ( !id || o.surface_type !== "Jib" || !SAME_HALF_TURNED.has( id ) ) return o;
    let n = o;
    if ( ROUND.has( id ) ) {
      // Unity turns about Z first, so the top's height is cos( rotation X ) * cos( rotation Z ): Z = 0 is as upright as
      // the slope allows ( 180 past vertical )
      const r    = arr3( o.rotation );
      const best = Math.cos( ( r[0] * Math.PI ) / 180 ) >= 0 ? 0 : 180;
      if ( angleOff( r[2], best ) > 10 ) n = rolledTo( n, best );
      // the flip also left its mesh mirrored ( the collider wasn't ): a mirrored tube looks the same, so undo it
      if ( n.parts.some( ( p ) => p.local_scale.x < 0 || p.local_scale.y < 0 || p.local_scale.z < 0 ) )
        n = { ...n, parts: n.parts.map( ( p ) => ( { ...p, local_scale: { x: Math.abs( p.local_scale.x ), y: Math.abs( p.local_scale.y ), z: Math.abs( p.local_scale.z ) } } ) ) };
    } else if ( uprightness( n ) < -0.3 ) n = turnedOver( n );
    if ( n !== o ) fixed++;
    return n;
  } );
  return { list: fixed ? out : list, fixed };
}

/**
 * The first version of fixJibs also switched every tube- and rail-named official piece's "intended up" to 2 —
 * pieces that worked as they were among them. Projects saved by it are recognised by all of those pieces being on 2
 * ( and no marker yet ): they go back to 0, the library's setting. Returns the pieces and how many changed.
**/
export function undoUpMethodSwitch( list: CustomObjectEntry[] ): { list: CustomObjectEntry[]; fixed: number } {
  const named = list.filter( ( o ) => o.surface_type === "Jib" && /tube|rail|log|pipe|bar/.test( officialOf( o ) ?? "" ) );
  if ( !named.length || named.some( ( o ) => o.intended_up_method !== 2 ) ) return { list, fixed: 0 };
  const ids = new Set( named.map( ( o ) => o.uid ) );
  return { list: list.map( ( o ) => ( ids.has( o.uid ) ? { ...o, intended_up_method: 0 } : o ) ), fixed: named.length };
}

/**
 * A rail's solid body for a piece ( pieces/rail.ts fitParts ): colliders fitted to its visible parts, or its own collider
 * when it's one convex shape — as rail fields to merge in, once its mesh has loaded.
**/
export async function partsFor( o: CustomObjectEntry, rail: Rail ): Promise<Pick<Rail, "parts" | "whole"> | undefined> {
  const tris = await getEngine()?.customR.localTriangles( o );
  return tris ? fitParts( tris, rail ) : undefined;
}

/**
 * Railed pieces whose visible parts haven't been fitted yet ( rails from before, rails got back after a save dropped
 * them ), or were fitted reaching over the top of the rail, get them fitted, once the map's pieces have loaded: their
 * posts and panels solid, nothing in between, the rail clear to land on.
**/
export async function fitMissingParts() {
  const wait    = ( ms: number ) => new Promise( ( r ) => setTimeout( r, ms ) );
  const due     = ( o: CustomObjectEntry ) => !!o.rail && o.rail.solid !== false && o.rail.points.length >= 2 && ( !o.rail.parts || keepClear( o.rail.parts, o.rail ) !== o.rail.parts );
  const missing = () => useEditor.getState().customObjects.filter( due );
  const fitted  = new Map<string, Pick<Rail, "parts" | "whole">>();
  // the 3D view ( and the map's meshes in it ) may still be on its way when a map opens: try for a while
  for ( let attempt = 0; attempt < 60 && missing().some( ( o ) => !fitted.has( o.uid ) ); attempt++ ) {
    const eng = getEngine();
    if ( eng ) {
      await eng.ready;
      await eng.customR.settled;
      for ( const o of missing() ) {
        if ( fitted.has( o.uid ) ) continue;
        const parts = await partsFor( o, o.rail! );
        if ( parts ) fitted.set( o.uid, parts );
      }
    }
    if ( missing().some( ( o ) => !fitted.has( o.uid ) ) ) await wait( 500 );
  }
  if ( !fitted.size ) return;
  const fresh = useEditor.getState().customObjects.filter( ( o ) => fitted.has( o.uid ) && !o.rail?.parts ).length;
  useEditor.setState( ( s ) => ( {
    customObjects: s.customObjects.map( ( o ) => ( fitted.has( o.uid ) && due( o ) ? withRail( o, { ...o.rail!, ...fitted.get( o.uid ) } ) : o ) ),
    dirty:         true,
  } ) );
  if ( fresh ) useEditor.getState().toast( `Made the posts and parts of ${fresh} rail piece${fresh > 1 ? "s" : ""} solid on their own: no invisible walls between them any more`, "info" );
}

/**
 * Puts a library piece down at `at` ( Unity coords ), copying what it uses into the map.
**/
export async function placeEntry( entryId: string, at: V3, rot: V3 = [0, 0, 0] ) {
  const st = useEditor.getState();
  if ( !st.projectDir ) return;
  try {
    const placed = await ipc.placeLibraryMesh( st.projectDir, entryId );
    useEditor.setState( { library: placed.library } );
    getEngine()?.customR.reloadLibrary();
    const stamp  = entryId.startsWith( "user:" ) ? ( await ipc.fileStamp( entryId.slice( 5 ) ).catch( () => null ) )?.[1] : undefined;
    const source = { id: entryId, stamp: stamp ?? Date.now() };
    const got    = fixJibs( [{ ...( placed.object as Omit<CustomObjectEntry, "uid"> ), uid: newUid(), source } as CustomObjectEntry] ).list[0];
    // ( an asset file keeps a rail as its capsules only: the rail made again from them )
    const o      = recoverRail( got ) ?? got;
    let here     = transformCustom( o, deltaBetween( { pos: [0, 0, 0], rot: [0, 0, 0], scl: [1, 1, 1] }, { pos: at, rot, scl: [1, 1, 1] } ) );
    // jibs start out able to magnetize; official ones get their grind rail straight away
    if ( here.surface_type === "Jib" ) here = { ...here, can_magnetize: true };
    if ( officialOf( here ) && here.surface_type === "Jib" ) {
      const pts  = await getEngine()?.customR.localVertices( here );
      const made = pts ? autoRail( pts ) : null;
      if ( made?.rail ) here = withRail( here, { ...made.rail, ...( await partsFor( here, made.rail ) ) } );
    }
    // ( named after the library's entry )
    st.addCustom( here, useEditor.getState().assetLibrary.find( ( e ) => e.id === entryId )?.name );
  } catch ( e ) {
    st.toast( `Couldn't place it: ${e}`, "error" );
  }
}

/**
 * The library's piece with the game's own look for an official feature ( built from your install ), if there is one.
**/
export function gameEntryFor( id: string ) {
  const name = id.replace( /[_-]/g, " " ).split( " " ).filter( Boolean ).map( ( w ) => w[0].toUpperCase() + w.slice( 1 ) ).join( " " );
  return useEditor.getState().assetLibrary.find( ( e ) => e.id.startsWith( "game:" ) && e.kind === "mesh" && e.name === name ) ?? null;
}

/**
 * Whether a piece is an official feature still in the placeholder's one-colour look, with the game's look to hand.
**/
export const canUseGameLook = ( o: CustomObjectEntry ) => {
  const id = officialOf( o );
  return !!id && !o.parts.some( ( p ) => /\/g\d+$/.test( p.mesh ) ) && !!gameEntryFor( id );
};

/**
 * Official features placed with the placeholder's look given the game's ( its meshes and paint, in the place of their
 * parts ); everything else — rail, colliders, settings — is kept. With `again`, pieces that have it already get the
 * current build of it. One undo step; returns how many changed.
**/
export async function applyGameLook( uids: string[], again = false ) {
  const st = useEditor.getState();
  if ( !st.projectDir ) return 0;
  const todo: { o: CustomObjectEntry; entry: string }[] = [];
  for ( const uid of uids ) {
    const o  = st.customObjects.find( ( x ) => x.uid === uid );
    const id = o && officialOf( o );
    if ( o && id && ( again ? gameEntryFor( id ) : canUseGameLook( o ) ) ) todo.push( { o, entry: gameEntryFor( id )!.id } );
  }
  if ( !todo.length ) return 0;
  // every feature's look brought into the map in one go ( its library is read and written once )
  const entries = [...new Set( todo.map( ( t ) => t.entry ) )];
  const placed  = await ipc.placeLibraryMeshes( st.projectDir, entries );
  const looks   = new Map( entries.map( ( e, i ) => [e, placed[i].object as Omit<CustomObjectEntry, "uid">] ) );
  const next    = new Map<string, CustomObjectEntry>();
  for ( const { o, entry } of todo ) {
    const look  = { ...looks.get( entry )!, uid: o.uid } as CustomObjectEntry;
    const posed = transformCustom( look, deltaBetween( { pos: [0, 0, 0], rot: [0, 0, 0], scl: [1, 1, 1] }, { pos: arr3( o.position ), rot: arr3( o.rotation ), scl: arr3( o.scale ) } ) );
    // ( its lights too, when it has none of its own yet: a floodlight placed before pieces carried the game's )
    next.set( o.uid, { ...o, parts: posed.parts, lights: o.lights.length ? o.lights : posed.lights } );
  }
  useEditor.setState( { library: "assets/library.jbrmap" } );
  getEngine()?.customR.reloadLibrary();
  st.commit( `The game's look ${again ? "updated " : ""}on ${next.size} piece${next.size > 1 ? "s" : ""}`, { customObjects: useEditor.getState().customObjects.map( ( o ) => next.get( o.uid ) ?? o ) } );
  return next.size;
}

/**
 * Pieces wearing an older build of the game's look ( its meshes or paint read better since they were placed ) brought
 * up to date: their parts only, as above. Run when a project opens; one undo step.
**/
export async function refreshGameLook() {
  const st = useEditor.getState();
  if ( !st.projectDir ) return 0;
  if ( !st.assetLibrary.length ) await loadLibrary();
  const uidsOf = new Map<string, string[]>();
  for ( const o of st.customObjects ) {
    const id = officialOf( o );
    if ( id && o.parts.some( ( p ) => /\/g\d+$/.test( p.mesh ) ) && gameEntryFor( id ) ) uidsOf.set( id, [...( uidsOf.get( id ) ?? [] ), o.uid] );
  }
  if ( !uidsOf.size ) return 0;
  const ids      = [...uidsOf.keys()];
  // ( the game-look textures each feature's pieces are painted with )
  const textures = ( id: string ) => [...new Set( uidsOf.get( id )!.flatMap( ( uid ) => st.customObjects.find( ( o ) => o.uid === uid )!.parts.flatMap( ( p ) => p.materials.flatMap( ( m ) => [m.base_tex, m.normal_tex, m.metallic_tex, m.roughness_tex, m.emission_tex] as ( string | undefined )[] ) ) ) )].filter( ( k ): k is string => !!k && k.startsWith( "GameLook/" ) );
  const stale    = await ipc.staleGameLook( st.projectDir, ids.map( ( id ) => [gameEntryFor( id )!.id, textures( id )] ) );
  // ( and pieces of a feature with lights in the game, placed without them )
  const lit      = await ipc.gameLights().catch( () => ( {} ) as Record<string, unknown[]> );
  const dark     = ( id: string ) => !!lit[id]?.length && uidsOf.get( id )!.some( ( uid ) => !st.customObjects.find( ( o ) => o.uid === uid )!.lights.length );
  const uids     = ids.filter( ( id, i ) => stale[i] || dark( id ) ).flatMap( ( id ) => uidsOf.get( id )! );
  return uids.length ? applyGameLook( uids, true ) : 0;
}

// A material to drop: from the library, or one the open map already uses.
export type MaterialSource = { kind: "library"; entryId: string } | { kind: "map"; material: CustomMaterial };

/**
 * Assigns a material to the surface under the cursor ( one material slot of one part ), or with `whole` to every
 * surface of the object. Library materials bring their textures into the map first.
**/
export async function applyMaterial( src: MaterialSource, target: { uid: string; partIndex: number; slot: number }, whole: boolean ) {
  const st = useEditor.getState();
  if ( !st.projectDir ) return;
  let mat: CustomMaterial;
  try {
    if ( src.kind === "library" ) {
      const placed = await ipc.placeLibraryMaterial( st.projectDir, src.entryId );
      useEditor.setState( { library: placed.library } );
      getEngine()?.customR.reloadLibrary();
      mat = placed.material;
    } else mat = src.material;
  } catch ( e ) {
    st.toast( `Couldn't apply the material: ${e}`, "error" );
    return;
  }
  // Many library materials ( Melon's ) carry the game's snow overlay; a dropped material is just the material.
  // "Snow on top" in the object's properties adds it back.
  mat = withOverlay( mat, false );
  st.updateCustom( `Apply ${materialName( mat )}`, [target.uid], ( o ) => ( {
    ...o,
    parts: o.parts.map( ( p, i ) => {
      if ( whole ) return { ...p, materials: ( p.materials.length ? p.materials : [mat] ).map( () => structuredClone( mat ) ) };
      if ( i !== target.partIndex ) return p;
      const materials = [...p.materials];
      while ( materials.length <= target.slot ) materials.push( structuredClone( materials[0] ?? mat ) );
      materials[target.slot] = structuredClone( mat );
      return { ...p, materials };
    } ),
  } ) );
}
