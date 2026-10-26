// Copy and paste ( Ctrl+C / Ctrl+V ) of features, spawns and pieces: pasted where the mouse points on the terrain,
// keeping their layout and their height above the ground; into the same map or another one ( pieces bring their
// meshes and textures along ).

import { namesFor } from "./names";
import type { V3 } from "../core/coords";
import { ipc } from "../core/ipc";
import { deltaBetween, transformCustom } from "../core/transform";
import { arr3, customName, xyz, type CustomObjectEntry, type ObjectEntry, type SpawnEntry } from "../core/types";
import { getEngine } from "../ui/Viewport";
import { newUid, useEditor, type Selection } from "./store";
import { terrain } from "../terrain/terrain";
import { inAssets } from "../pieces/assetScene";
import { copyPiece } from "../model/objects";

interface Clip {
  projectDir:    string;
  objects:       ObjectEntry[];
  spawns:        SpawnEntry[];
  customObjects: CustomObjectEntry[];
  // the copied things' collections and names ( by their uid )
  membership:    Record<string, string>;
  labels:        Record<string, string>;
  // middle of what was copied
  centre:        V3;
}

let clip: Clip | null = null;

/**
 * Copies the selection; returns how many things were copied.
**/
export function copySelection(): number {
  const st = useEditor.getState();
  if ( !st.projectDir || !st.selection.length ) return 0;
  const want          = ( k: Selection["kind"] ) => new Set( st.selection.filter( ( s ) => s.kind === k ).map( ( s ) => s.uid ) );
  const objs          = want( "object" ), sps = want( "spawn" ), cus = want( "custom" );
  const objects       = st.objects.filter( ( o ) => objs.has( o.uid ) ).map( ( o ) => structuredClone( o ) );
  const spawns        = st.spawns.filter( ( o ) => sps.has( o.uid ) ).map( ( o ) => structuredClone( o ) );
  const customObjects = st.customObjects.filter( ( o ) => cus.has( o.uid ) ).map( ( o ) => structuredClone( o ) );
  const points: V3[]  = [...objects.map( ( o ) => o.position ), ...spawns.map( ( o ) => o.position ), ...customObjects.map( ( o ) => arr3( o.position ) )];
  if ( !points.length ) {
    st.toast( "Terrain shapes can't be copied yet — use their handles to make another", "info" );
    return 0;
  }
  const centre = [0, 1, 2].map( ( k ) => points.reduce( ( a, p ) => a + p[k], 0 ) / points.length ) as V3;
  const uids   = new Set( st.selection.map( ( s ) => s.uid ) );
  const pick   = ( r: Record<string, string> ) => Object.fromEntries( Object.entries( r ).filter( ( [u] ) => uids.has( u ) ) );
  clip         = { projectDir: st.projectDir, objects, spawns, customObjects, membership: pick( st.membership ), labels: pick( st.labels ), centre };
  return points.length;
}

export const hasClipboard = () => !!clip;

/**
 * Pastes what was copied: at the terrain under the mouse if it's over the viewport, else where it was.
**/
export async function paste() {
  const st = useEditor.getState();
  const c  = clip;
  if ( !c || !st.projectDir ) return;
  const other = c.projectDir !== st.projectDir;
  if ( other && c.customObjects.length ) {
    // pieces from another map: their meshes and textures come along into this map's library
    try {
      const library = await ipc.copyPieceAssets( c.projectDir, st.projectDir, c.customObjects );
      useEditor.setState( { library } );
      getEngine()?.customR.reloadLibrary();
    } catch ( e ) {
      st.toast( `Couldn't bring the pieces' meshes over: ${e}`, "error" );
      return;
    }
  }
  // ( on the map: where the mouse points on the ground; in the Assets workspace where they were, as Blender pastes )
  const cursor = inAssets() ? null : getEngine()?.cursorUnity() ?? null;
  // ( in the Assets workspace the ground is its floor, at nought )
  const ground = ( x: number, z: number ) => ( inAssets() ? 0 : terrain.heightAt( x, z ) );
  // where each copied thing goes: shifted with the group, at the same height above the ground as before
  const moved  = ( p: V3 ): V3 => {
    if ( !cursor ) return p;
    const x      = p[0] + cursor[0] - c.centre[0], z = p[2] + cursor[2] - c.centre[2];
    const before = ground( p[0], p[2] ), after = ground( x, z );
    const lift   = Number.isNaN( before ) || Number.isNaN( after ) ? cursor[1] - c.centre[1] : after - before;
    return [x, p[1] + lift, z];
  };
  const fresh   = new Map<string, string>(); // copied uid -> pasted uid
  const objects = c.objects.map( ( o ) => {
    const u = newUid();
    fresh.set( o.uid, u );
    return { ...structuredClone( o ), uid: u, position: moved( o.position ) };
  } );
  const spawns = c.spawns.map( ( o ) => {
    const u = newUid();
    fresh.set( o.uid, u );
    return { ...structuredClone( o ), uid: u, name: other ? o.name : `${o.name} copy`, position: moved( o.position ) };
  } );
  const customObjects = c.customObjects.map( ( o ) => {
    const u = newUid();
    fresh.set( o.uid, u );
    const cur = { pos: arr3( o.position ), rot: arr3( o.rotation ), scl: arr3( o.scale ) };
    const to  = moved( cur.pos );
    const t   = transformCustom( copyPiece( o, u ), deltaBetween( cur, { ...cur, pos: to } ) );
    return { ...t, position: xyz( to ) };
  } );
  // into the active collection; otherwise where they were copied from ( same map, if it's still there )
  const cols       = new Set( st.collections.map( ( x ) => x.id ) );
  const membership = { ...st.membership };
  const named: { uid: string; want: string }[] = [];
  for ( const [from, to] of fresh ) {
    const home = st.activeCollection && cols.has( st.activeCollection ) ? st.activeCollection : !other && cols.has( c.membership[from] ) ? c.membership[from] : null;
    if ( home ) membership[to] = home;
    const src = c.customObjects.find( ( o ) => o.uid === from );
    if ( src ) named.push( { uid: to, want: c.labels[from] || customName( src ) } );
  }
  // ( Blender's: a pasted "Cube" is "Cube.001" beside the first )
  const labels = namesFor( { labels: st.labels, customObjects: [...st.customObjects, ...customObjects] }, named );
  const n      = fresh.size;
  st.commit( `Paste ${n} item${n > 1 ? "s" : ""}`, {
    objects:       [...st.objects,       ...objects      ],
    spawns:        [...st.spawns,        ...spawns       ],
    customObjects: [...st.customObjects, ...customObjects],
    membership,
    labels,
  } );
  st.setSelection( [
    ...objects.map( ( o ) => ( { kind: "object" as const, uid: o.uid } ) ),
    ...spawns.map( ( o ) => ( { kind: "spawn"  as const, uid: o.uid } ) ),
    ...customObjects.map( ( o ) => ( { kind: "custom" as const, uid: o.uid } ) ),
  ] );
  if ( !cursor && !inAssets() ) st.toast( `Pasted ${n} in place — point at the terrain while pasting to put them there`, "info" );
}
