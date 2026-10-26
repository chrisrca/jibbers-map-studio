// The object brush ( Scatter ): pieces picked in the asset browser dropped over the ground as the brush is dragged —
// one at a time at random inside the circle, a few metres apart, each turned at random, leaning with the slope as far
// as asked ( and a little at random ), a little bigger or smaller. With Ctrl it takes away pieces of those kinds under
// the brush instead. A stroke is one undo step.

import * as THREE from "three/webgpu";
import { toThree, type V3 } from "../../core/coords";
import { ipc } from "../../core/ipc";
import { transformCustom } from "../../core/transform";
import type { CustomObjectEntry } from "../../core/types";
import { history } from "../../map/history";
import { namesFor } from "../../map/names";
import { newUid, useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";

type Template = { id: string; name: string; object: Omit<CustomObjectEntry, "uid"> };

// The picked pieces as they come into this map ( their meshes copied in once ), by pick set and map.
let cache: { key: string; templates: Template[] } | null = null;

/**
 * The picked pieces, ready to drop; `fresh` is told when their meshes have just come into the map ( the renderer reads
 * its library again ).
**/
export async function scatterTemplates( fresh: () => void ): Promise<Template[]> {
  const st    = useEditor.getState();
  const picks = st.scatter.picks;
  if ( !st.projectDir || !picks.length ) return [];
  const key = `${st.projectDir}|${picks.join( "|" )}`;
  if ( cache?.key === key ) return cache.templates;
  const placed = await ipc.placeLibraryMeshes( st.projectDir, picks );
  useEditor.setState( { library: placed[0]?.library ?? st.library } );
  fresh();
  const templates = placed.map( ( p, i ) => ( { id: picks[i], name: st.assetLibrary.find( ( e ) => e.id === picks[i] )?.name ?? "Piece", object: p.object as Omit<CustomObjectEntry, "uid"> } ) );
  cache           = { key, templates };
  return templates;
}

export class ScatterStroke {
  private before = useEditor.getState();
  private last: [number, number] | null = null;
  private placed: CustomObjectEntry[] = [];
  private names: { uid: string; want: string }[] = [];
  private removed = 0;

  constructor( private templates: Template[], private erase: boolean ) {}

  /**
   * The brush at a point of the ground ( Unity x, z ): a piece dropped ( or, erasing, those under it taken away ).
  **/
  dab( x: number, z: number ) {
    const s = useEditor.getState().scatter;
    if ( this.erase ) return this.takeAway( x, z, s.radius );
    if ( this.last  && Math.hypot( x - this.last[0], z - this.last[1] ) < s.spacing ) return;
    this.last   = [x, z];
    const kinds = new Set( this.templates.map( ( t ) => t.id ) );
    const near  = useEditor.getState().customObjects.filter( ( o ) => o.source && kinds.has( o.source.id ) );
    // a spot in the circle not crowding another piece of these kinds ( a few tries )
    for ( let attempt = 0; attempt < 8; attempt++ ) {
      const a  = Math.random() * Math.PI * 2, d = Math.sqrt( Math.random() ) * s.radius;
      const px = x + Math.cos( a ) * d, pz = z + Math.sin( a ) * d;
      const y  = terrain.heightAt( px, pz );
      if ( Number.isNaN( y ) ) continue;
      if ( near.some( ( o ) => Math.hypot( o.position.x - px, o.position.z - pz ) < s.spacing * 0.7 ) ) continue;
      this.drop( this.templates[Math.floor( Math.random() * this.templates.length )], [px, y, pz] );
      return;
    }
  }

  private drop( t: Template, at: V3 ) {
    const s      = useEditor.getState().scatter;
    // up: the world's, leaning towards the ground's as asked, then a little at random
    const n      = terrain.normalAt( at[0], at[2], 1 );
    const ground = new THREE.Vector3( n.x, n.y, -n.z ).normalize();
    const up     = new THREE.Vector3( 0,   1,   0    ).lerp( ground, s.followSlope ).normalize();
    const lean   = THREE.MathUtils.degToRad( s.tilt ) * Math.random(), dir = Math.random() * Math.PI * 2;
    up.applyAxisAngle( new THREE.Vector3( Math.cos( dir ), 0, Math.sin( dir ) ), lean );
    const q     = new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), up ).multiply( new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), Math.random() * Math.PI * 2 ) );
    const k     = 1 + ( Math.random() * 2 - 1 ) * s.scaleJitter;
    const uid   = newUid();
    const stamp = Date.now();
    const o     = transformCustom( { ...( structuredClone( t.object ) as CustomObjectEntry ), uid, source: { id: t.id, stamp } }, new THREE.Matrix4().compose( toThree( at ), q, new THREE.Vector3( k, k, k ) ) );
    this.placed.push( o );
    this.names.push( { uid, want: t.name } );
    const st = useEditor.getState();
    useEditor.setState( { customObjects: [...st.customObjects, o] } );
  }

  private takeAway( x: number, z: number, r: number ) {
    const kinds = new Set( this.templates.map( ( t ) => t.id ) );
    const st    = useEditor.getState();
    const keep  = st.customObjects.filter( ( o ) => !( o.source && kinds.has( o.source.id ) && !st.locked[o.uid] && Math.hypot( o.position.x - x, o.position.z - z ) <= r ) );
    if ( keep.length === st.customObjects.length ) return;
    this.removed += st.customObjects.length - keep.length;
    useEditor.setState( { customObjects: keep } );
  }

  /**
   * The stroke done: its pieces named ( Blender's ".001"s ), into the active collection, one undo step.
  **/
  end() {
    const b = this.before, st = useEditor.getState();
    if ( !this.placed.length && !this.removed ) return;
    const labels     = this.names.length ? namesFor( { labels: st.labels, customObjects: st.customObjects }, this.names ) : st.labels;
    const membership = { ...st.membership };
    if ( st.activeCollection ) for ( const o of this.placed ) membership[o.uid] = st.activeCollection;
    const after = { customObjects: st.customObjects, labels, membership };
    useEditor.setState( { ...after, dirty: true } );
    history.push( {
      label: this.erase ? `Scatter: take away ${this.removed}` : `Scatter ${this.placed.length}`,
      undo:  () => useEditor.setState( { customObjects: b.customObjects, labels: b.labels, membership: b.membership, dirty: true } ),
      redo:  () => useEditor.setState( { ...after, dirty: true } ),
    } );
  }
}
