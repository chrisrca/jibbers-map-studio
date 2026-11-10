// The Collider tool ( Object Mode ): pieces of colliders only, put down as a lift's line is ( nothing to see in the
// game; drawn see-through here, picked, moved and edited as any piece ). A click on the ground, or on anything, makes
// one of its Size, two metres long, running away from the view; held and dragged, from where it was pressed to where
// it's let go. A jib is a grind rail through those two points ( its points then edited as any jib's: Properties ›
// Rail › Edit points ); a solid or snow one, a box between them. With a piece picked, a click on one of its colliders
// picks that ( the gizmo then moves, turns or sizes it; X deletes it ). Each piece made is one undo step.

import * as THREE from "three/webgpu";
import { quatToUnityEuler, toThree, toUnity, unityEulerToQuat, type V3 } from "../../core/coords";
import { arr3, hasLook, xyz, type CustomCollider, type CustomObjectEntry } from "../../core/types";
import { newUid, useEditor } from "../../map/store";
import { isBrushCollider, strokeColliders, type StrokePoint } from "../../pieces/brushColliders";
import { isRailCollider, withRail } from "../../pieces/rail";
import type { Engine } from "../engine/engine";
import { redraw } from "../redraw";
import { colliderShell, shellMaterial, shellObject } from "./grindGuide";

const PICKED = 0xffb000;
// a click's length ( metres )
const LENGTH = 2;

export class ColliderTool {
  readonly group = new THREE.Group();
  private uid: string | null = null;
  // the colliders as shown ( the gizmo's changes here before they're kept, or the one being put down ), and each
  // one's shell
  private shown: CustomCollider[] = [];
  private shells: THREE.Mesh[]    = [];
  // a press under way: on one of the picked piece's colliders ( `under` ), or putting a new one down from `a` ( on the
  // surface there, its way out `n` ) to `b`; `on` the piece pressed on, if any
  private press: { x0: number; y0: number; moved: boolean; under: number | null; a: StrokePoint | null; b: StrokePoint | null; on: string | null } | null = null;
  private from: { at: THREE.Vector3; q: THREE.Quaternion; c: CustomCollider } | null = null;
  private mats = {
    shell:  shellMaterial(),
    drawn:  new THREE.MeshBasicNodeMaterial( { color: 0x1fb6ff, depthTest: false, depthWrite: false, transparent: true, opacity: 0.5 } ),
    picked: new THREE.MeshBasicNodeMaterial( { color: PICKED, depthTest: false, depthWrite: false, transparent: true, opacity: 0.55 } ),
    // ( its edges drawn too: a pale box on snow didn't show )
    edge:   new THREE.LineBasicNodeMaterial( { color: 0x0a4f9e, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 } ),
  };

  constructor( private engine: Engine ) {}

  get dragging() {
    return !!this.press;
  }

  get gizmoMoving() {
    return !!this.from;
  }

  /**
   * The piece the tool works on: the one piece picked, with the tool out.
  **/
  piece(): CustomObjectEntry | null {
    const st = useEditor.getState();
    if ( st.tool !== "collider" || st.selection.length !== 1 || st.selection[0].kind !== "custom" ) return null;
    return st.customObjects.find( ( o ) => o.uid === st.selection[0].uid ) ?? null;
  }

  /**
   * Shows the picked piece's colliders as they are ( after any change to the map, the tool or what's picked ).
  **/
  sync() {
    if ( this.press || this.from ) return;
    const o  = this.piece();
    this.uid = o?.uid ?? null;
    this.show( o?.colliders ?? [] );
  }

  private show( colliders: CustomCollider[] ) {
    this.shown = colliders;
    for ( const s of this.shells ) {
      s.parent?.remove( s );
      s.geometry.dispose();
      for ( const e of s.children ) ( e as THREE.LineSegments ).geometry?.dispose();
    }
    this.shells = [];
    const pick  = useEditor.getState().colliderPick;
    colliders.forEach( ( c, i ) => {
      if ( c.shape === "Mesh" ) return;
      // ( the drawn ones stronger than the piece's own )
      const g = shellObject( [colliderShell( c )], i === pick ? this.mats.picked : isBrushCollider( c ) ? this.mats.drawn : this.mats.shell );
      const m = g.children[0] as THREE.Mesh;
      m.userData = { index: i };
      if ( isBrushCollider( c ) || i === pick ) {
        const e         = new THREE.LineSegments( new THREE.EdgesGeometry( m.geometry, 30 ), this.mats.edge );
        e.renderOrder   = 1000;
        e.raycast       = () => {};
        m.add( e );
      }
      this.group.add( m );
      this.shells.push( m );
    } );
    redraw();
  }

  // ---------------------------------------------------------------- putting one down

  /**
   * Whatever's under a screen point to put one on: a piece ( which, its way out there ) or the ground ( straight up ).
  **/
  private surfaceAt( x: number, y: number ): ( StrokePoint & { uid: string | null } ) | null {
    const rc   = this.engine.ray( x, y );
    const hit  = rc.intersectObjects( [...this.engine.objectsR.pickables(), ...this.engine.customR.pickables()], false )[0];
    const tHit = this.engine.pickTerrain( x, y );
    if ( hit && ( !tHit || hit.distance <= tHit.distanceTo( this.engine.camera.position ) + 0.01 ) ) {
      const n = ( hit.face?.normal.clone() ?? new THREE.Vector3( 0, 1, 0 ) ).transformDirection( hit.object.matrixWorld );
      if ( n.dot( rc.ray.direction ) > 0 ) n.negate();
      return { p: toUnity( hit.point ), n: toUnity( n ), uid: ( hit.object.userData as { uid?: string } ).uid ?? null };
    }
    return tHit ? { p: toUnity( tHit ), n: [0, 1, 0], uid: null } : null;
  }

  private colliderUnder( x: number, y: number ): number | null {
    const h = this.engine.ray( x, y ).intersectObjects( this.shells, false )[0];
    return h ? ( h.object.userData.index as number ) : null;
  }

  hover( _x: number, _y: number ) {}

  /**
   * A press: on one of the picked piece's colliders, that ( picked once it's let go without moving ); anywhere else, a
   * new one begins there. True when it's the tool's.
  **/
  down( x: number, y: number, _e: PointerEvent ): boolean {
    const under = this.uid ? this.colliderUnder( x, y ) : null;
    if ( under !== null ) {
      this.press = { x0: x, y0: y, moved: false, under, a: null, b: null, on: null };
      return true;
    }
    const s = this.surfaceAt( x, y );
    if ( !s ) return false;
    this.press = { x0: x, y0: y, moved: false, under: null, a: { p: s.p, n: s.n }, b: null, on: s.uid };
    useEditor.setState( { colliderPick: null } );
    return true;
  }

  move( x: number, y: number ) {
    const k = this.press;
    if ( !k?.a ) return;
    if ( !k.moved && Math.hypot( x - k.x0, y - k.y0 ) < 6 ) return;
    k.moved = true;
    const s = this.surfaceAt( x, y );
    if ( s ) k.b = { p: s.p, n: s.n };
    this.show( this.preview() );
  }

  /**
   * Where a new one runs to: where it was let go, or ( a click ) its length away from the view.
  **/
  private end( k: NonNullable<ColliderTool["press"]> ): StrokePoint {
    if ( k.b && Math.hypot( k.b.p[0] - k.a!.p[0], k.b.p[1] - k.a!.p[1], k.b.p[2] - k.a!.p[2] ) > 0.05 ) return k.b;
    const f = toUnity( this.engine.camera.getWorldDirection( new THREE.Vector3() ) );
    const h = Math.hypot( f[0], f[2] ) > 1e-3 ? [f[0] / Math.hypot( f[0], f[2] ), f[2] / Math.hypot( f[0], f[2] )] : [0, 1];
    const a = k.a!.p;
    return { p: [a[0] + h[0] * LENGTH, a[1], a[2] + h[1] * LENGTH], n: k.a!.n };
  }

  /**
   * The one being put down, as it would be.
  **/
  private preview(): CustomCollider[] {
    const k = this.press, b = useEditor.getState().colliderBrush;
    if ( !k?.a ) return this.shown;
    return strokeColliders( [k.a, this.end( k )], b.radius, b.shape, b.surface ?? "Jib", true );
  }

  up() {
    const k = this.press;
    if ( !k ) return;
    this.press = null;
    // ( a click on one of the picked piece's colliders: that picked )
    if ( k.under !== null ) {
      if ( !k.moved ) useEditor.setState( { colliderPick: k.under } );
      return this.sync();
    }
    // ( a click on a piece of colliders: that picked, not another made on it )
    const st = useEditor.getState();
    const on = k.on ? st.customObjects.find( ( o ) => o.uid === k.on ) : undefined;
    if ( !k.moved && on && !hasLook( on ) ) {
      st.setSelection( [{ kind: "custom", uid: on.uid }] );
      return this.sync();
    }
    if ( k.a ) this.addPiece( k.a, this.end( k ) );
    this.sync();
  }

  /**
   * A new piece of colliders only from `a` to `b` ( points on the surfaces there ), one undo step, picked: a jib, a
   * grind rail through them ( its middle its Size's half above the surface ); otherwise a box between them.
  **/
  private addPiece( a: StrokePoint, b: StrokePoint ) {
    const st = useEditor.getState(), brush = st.colliderBrush, surface = brush.surface ?? "Jib", r = Math.max( 0.01, brush.radius );
    const up = ( s: StrokePoint ): V3 => {
      const n = new THREE.Vector3( ...s.n ).normalize();
      return [s.p[0] + n.x * r, s.p[1] + n.y * r, s.p[2] + n.z * r];
    };
    const pa = up( a ), pb = up( b );
    const base: CustomObjectEntry = {
      uid:                      newUid(),
      surface_type:             surface,
      can_stabilize:            true,
      can_rotate:               true,
      can_magnetize:            surface === "Jib",
      intended_up_method:       0,
      // ( nothing drawn to tell the game how near it is: always there )
      disable_distance_culling: true,
      timed_visibility:         false,
      visible_from_hour:        19,
      visible_until_hour:       6,
      position:                 xyz( pa ),
      rotation:                 xyz( [0, 0, 0] ),
      scale:                    xyz( [1, 1, 1] ),
      parts:                    [],
      colliders:                surface === "Jib" ? [] : strokeColliders( [a, b], r, brush.shape, surface, true ),
      lod_groups:               [],
      lights:                   [],
    };
    // ( a rail's points in the piece's own coordinates: from its first )
    const o = surface !== "Jib" ? base : withRail( base, { points: [[0, 0, 0], [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]]], radius: r, ...( brush.shape === "Box" ? { box: [r, r] as [number, number] } : {} ) } );
    st.addCustom( o, surface === "Jib" ? "Jib" : surface === "Snow" ? "Snow collider" : "Collider" );
  }

  /**
   * [ and ]: the size smaller or bigger.
  **/
  resize( k: number ) {
    const b = useEditor.getState().colliderBrush;
    useEditor.setState( { colliderBrush: { ...b, radius: Math.min( 5, Math.max( 0.01, b.radius * k ) ) } } );
  }

  /**
   * X / Delete: the picked collider taken out ( a rail's are its rail's: not this tool's ). True when there was one.
  **/
  deletePicked(): boolean {
    const st = useEditor.getState(), o = this.piece(), i = st.colliderPick;
    if ( !o || i === null || !o.colliders[i] || isRailCollider( o.colliders[i] ) ) return false;
    st.commit( "Delete collider", { customObjects: st.customObjects.map( ( x ) => ( x.uid === o.uid ? { ...x, colliders: x.colliders.filter( ( _, k ) => k !== i ) } : x ) ) } );
    useEditor.setState( { colliderPick: null } );
    return true;
  }

  // ---------------------------------------------------------------- the gizmo on the picked collider

  /**
   * Where the picked collider is ( its middle ) and how it's turned ( the 3D view ), for the gizmo; null without one.
  **/
  pickedFrame(): { at: THREE.Vector3; q: THREE.Quaternion } | null {
    const o = this.piece(), i = useEditor.getState().colliderPick;
    const c = o && i !== null ? o.colliders[i] : null;
    if ( !c || c.shape === "Mesh" || isRailCollider( c ) ) return null;
    return { at: colliderShell( c ).centre, q: unityEulerToQuat( arr3( c.local_rotation ) ) };
  }

  gizmoStart(): boolean {
    const f = this.pickedFrame(), o = this.piece(), i = useEditor.getState().colliderPick;
    if ( !f || !o || i === null ) return false;
    this.from = { ...f, c: o.colliders[i] };
    return true;
  }

  /**
   * The picked collider as the gizmo has it: moved, turned about its middle, or sized in its own axes.
  **/
  gizmoMove( delta: THREE.Matrix4, mode: string ) {
    const f = this.from, o = this.piece(), i = useEditor.getState().colliderPick;
    if ( !f || !o || i === null ) return;
    const c    = f.c, rot = new THREE.Quaternion().setFromRotationMatrix( new THREE.Matrix4().extractRotation( delta ) );
    const pos0 = toThree( arr3( c.local_position ) ), at = f.at.clone().applyMatrix4( delta );
    let next: CustomCollider;
    if ( mode === "rotate" ) {
      const q = rot.clone().multiply( f.q );
      const p = pos0.clone().sub( f.at ).applyQuaternion( rot ).add( f.at );
      next    = { ...c, local_position: xyz( toUnity( p ) ), local_rotation: xyz( quatToUnityEuler( q ) ) };
    } else if ( mode === "scale" ) {
      // ( how much longer each of its own axes came out )
      const m3 = new THREE.Matrix3().setFromMatrix4( delta );
      const k  = [0, 1, 2].map( ( a ) => new THREE.Vector3().setComponent( a, 1 ).applyQuaternion( f.q ).applyMatrix3( m3 ).length() ) as V3;
      const ax = c.direction ?? 1, round = Math.max( ...[0, 1, 2].filter( ( a ) => a !== ax ).map( ( a ) => k[a] ) );
      next     = c.shape === "Box" ? { ...c, size: xyz( [c.size.x * k[0], c.size.y * k[1], c.size.z * k[2]] ) }
        : c.shape === "Sphere" ? { ...c, radius: c.radius * Math.max( ...k ) }
        : { ...c, radius: c.radius * round, height: c.height * k[ax] };
    } else next = { ...c, local_position: xyz( toUnity( pos0.clone().add( at.clone().sub( f.at ) ) ) ) };
    this.show( o.colliders.map( ( x, k ) => ( k === i ? next : x ) ) );
  }

  gizmoEnd( label: string ) {
    const o = this.piece(), i = useEditor.getState().colliderPick, next = i !== null ? this.shown[i] : null;
    this.from = null;
    if ( o && i !== null && next && next !== o.colliders[i] ) {
      const st = useEditor.getState();
      st.commit( `${label} collider`, { customObjects: st.customObjects.map( ( x ) => ( x.uid === o.uid ? { ...x, colliders: x.colliders.map( ( c, k ) => ( k === i ? next : c ) ) } : x ) ) } );
    }
    this.sync();
  }
}
