// Editing a fence ( pieces/fence.ts ) as a lift is edited: with one fence picked, its points are handles — dragged over
// the ground, or moved with the gizmo, which sits on the point picked ( the one clicked, or nearest where the fence was
// clicked; its first till then ) and moves it along the ground, or up and down off it ( into it too ); Ctrl+click on
// the ground puts a point into the nearest stretch, X / Delete takes away the point picked. While a point moves the
// fence is made again without what only matters once it's put down ( its colliders, its grind rail ).

import * as THREE from "three/webgpu";
import { toThree, toUnity, type V3 } from "../../core/coords";
import type { CustomObjectEntry } from "../../core/types";
import { history } from "../../map/history";
import { useEditor } from "../../map/store";
import { fenceLocal, fenceOf, fenceWorld, isRepeat, liftAt, withFence, type FenceData } from "../../pieces/fence";
import { partsFor } from "../../pieces/library";
import { autoRail, withRail } from "../../pieces/rail";
import { terrain } from "../../terrain/terrain";
import { redraw } from "../redraw";

const POINT  = 0xffffff;
const PICKED = 0xff5a36;

/**
 * A fence made again over the ground as it is, its posts or panels from the map's pieces as they are ( `quick`: no
 * colliders or grind rail, for while it's being moved ).
**/
export function rebuilt( o: CustomObjectEntry, quick = false ): CustomObjectEntry {
  const st = useEditor.getState();
  return withFence( o, ( x, z ) => terrain.heightAt( x, z ), ( uid ) => st.customObjects.find( ( c ) => c.uid === uid ), quick );
}

/**
 * The fence with a new path ( and its style, `f`'s ), made again.
**/
export const withPath = ( o: CustomObjectEntry, f: FenceData, quick = false ) => rebuilt( { ...o, fence: f } as CustomObjectEntry, quick );

// every point's height over the ground
const liftsOf = ( f: FenceData ) => f.points.map( ( _, i ) => liftAt( f, i ) );

type Fence = CustomObjectEntry & { fence: FenceData };

export class FenceTool {
  readonly group = new THREE.Group();
  private ball   = new THREE.SphereGeometry( 1, 14, 10 );
  private mats   = new Map<number, THREE.Material>();
  // a point being dragged: the fence, which point, the pieces before ( one undo step ), whether it's moved
  private grab:  { uid: string; index: number; before: CustomObjectEntry[]; moved: boolean } | null = null;
  // the point last clicked ( the gizmo's on it; X takes it away )
  private picked: { uid: string; index: number } | null = null;
  // a move with the gizmo under way: the point, where it was, the pieces before
  private moving: { uid: string; index: number; from: V3; before: CustomObjectEntry[] } | null = null;
  // the point picked changed ( the gizmo goes to it )
  onPicked: () => void = () => {};
  // a piece's vertices in its own space, as drawn ( the engine's renderer: a repeat's rail found along it again )
  localVertices: ( o: CustomObjectEntry ) => Promise<Float32Array | null> = async () => null;

  constructor(
    private raycast:    ( x: number, y: number ) => THREE.Raycaster,
    private camera:     () => THREE.PerspectiveCamera,
    private viewHeight: () => number,
  ) {
    this.group.renderOrder = 13;
  }

  private mat( color: number ) {
    let m = this.mats.get( color );
    if ( !m ) this.mats.set( color, ( m = new THREE.MeshBasicNodeMaterial( { color, transparent: true, opacity: 0.95, depthTest: false } ) ) );
    return m;
  }

  /**
   * The fence being edited: the one piece picked, when it's a fence ( and the select tool is out ).
  **/
  target(): Fence | null {
    const st = useEditor.getState();
    if ( st.tool !== "select" || st.selection.length !== 1 || st.selection[0].kind !== "custom" || st.locked[st.selection[0].uid] ) return null;
    const o = st.customObjects.find( ( x ) => x.uid === st.selection[0].uid );
    return o && fenceOf( o ) ? ( o as Fence ) : null;
  }

  /**
   * Where a point of the fence stands: on the ground under it ( Unity space ).
  **/
  private footOf( o: Fence, i: number ): V3 {
    const w = fenceWorld( o, o.fence.points[i] ), g = terrain.heightAt( w[0], w[2] );
    return [w[0], ( Number.isNaN( g ) ? w[1] : g ) + liftAt( o.fence, i ), w[2]];
  }

  /**
   * The point picked on fence `o`: the one clicked, else its first.
  **/
  private pickedOn( o: Fence ) {
    const p = this.picked;
    return p && p.uid === o.uid && p.index < o.fence.points.length ? p.index : 0;
  }

  /**
   * Its handles drawn again ( the fence or the selection changed ).
  **/
  sync() {
    this.group.clear();
    const o = this.target();
    if ( !o ) {
      this.picked = null;
      return redraw();
    }
    if ( this.picked && ( this.picked.uid !== o.uid || this.picked.index >= o.fence.points.length ) ) this.picked = null;
    const on = this.pickedOn( o );
    o.fence.points.forEach( ( _, i ) => {
      const f = this.footOf( o, i );
      const m = new THREE.Mesh( this.ball, this.mat( on === i ? PICKED : POINT ) );
      m.position.copy( toThree( [f[0], f[1] + 0.3, f[2]] ) );
      m.userData    = { index: i, px: 9 };
      m.renderOrder = 13;
      this.group.add( m );
    } );
    this.frame();
    redraw();
  }

  /**
   * The handles kept the same size on screen.
  **/
  frame() {
    if ( !this.group.children.length ) return;
    const cam = this.camera(), k = ( 2 * Math.tan( THREE.MathUtils.degToRad( cam.fov ) / 2 ) ) / Math.max( 1, this.viewHeight() );
    for ( const c of this.group.children ) c.scale.setScalar( ( c.userData.px as number ) * k * cam.position.distanceTo( c.position ) );
  }

  private handleAt( x: number, y: number ): number | null {
    const hit = this.raycast( x, y ).intersectObjects( this.group.children, false )[0];
    return hit ? ( hit.object.userData.index as number ) : null;
  }

  /**
   * The ground under the mouse ( Unity space ); where there's none, the level `level`.
  **/
  private groundAt( x: number, y: number, level: number ): V3 | null {
    const r   = this.raycast( x, y ).ray;
    const hit = terrain.raycast( r.origin, r.direction, 20000 );
    if ( hit ) return toUnity( hit );
    const p = r.intersectPlane( new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), -level ), new THREE.Vector3() );
    return p ? toUnity( p ) : null;
  }

  /**
   * Whether a press here is the fence's, not the gizmo's: on a handle, or with Ctrl ( a point put in ).
  **/
  markUnder( x: number, y: number, ctrl = false ) {
    const o = this.target();
    return !!o && ( ctrl || this.handleAt( x, y ) !== null );
  }

  /**
   * Pointer down: true when it took it ( a point grabbed, or one put in ).
  **/
  down( x: number, y: number, e: { ctrlKey: boolean } ): boolean {
    const o = this.target();
    if ( !o ) return false;
    const st = useEditor.getState(), i = this.handleAt( x, y );
    if ( i !== null ) {
      this.grab = { uid: o.uid, index: i, before: st.customObjects, moved: false };
      this.pick( o.uid, i );
      return true;
    }
    if ( !e.ctrlKey ) return false;
    const g = this.groundAt( x, y, o.position.y );
    if ( !g ) return true;
    // ( into the nearest stretch, in its place along the fence, as high off the ground as its ends between them )
    const p    = fenceLocal( o, g ), pts = [...o.fence.points], lift = liftsOf( o.fence );
    const at   = nearestGap( pts, p, o.fence.closed ) + 1;
    pts.splice( at, 0, p );
    lift.splice( at, 0, ( lift[at - 1] + ( lift[at % lift.length] ?? lift[at - 1] ) ) / 2 );
    const before = st.customObjects;
    st.updateCustom( "Add point", [o.uid], ( x ) => withPath( x, { ...fenceOf( x )!, points: pts, lift } ) );
    this.pick( o.uid, at );
    if ( useEditor.getState().customObjects !== before ) void this.railAgain( o.uid );
    return true;
  }

  private pick( uid: string, index: number | null ) {
    this.picked = index === null ? null : { uid, index };
    this.sync();
    this.onPicked();
  }

  /**
   * A fence clicked ( not on a handle ), at ( x, y ) on screen: its point nearest the click picked, as a lift's piece
   * clicked is ( the gizmo goes to it ). Not a fence: nothing.
  **/
  pickAt( uid: string, x: number, y: number ) {
    const o = useEditor.getState().customObjects.find( ( q ) => q.uid === uid ) as Fence | undefined;
    if ( !o || !fenceOf( o ) ) return;
    // ( nearest the line under the mouse, as it looks: off it by the least angle )
    const ray = this.raycast( x, y ).ray;
    let best  = 0, bd = Infinity;
    o.fence.points.forEach( ( _, i ) => {
      const f = toThree( this.footOf( o, i ) ), d = ray.distanceToPoint( f ) / Math.max( 1e-3, f.distanceTo( ray.origin ) );
      if ( d < bd ) { bd = d; best = i; }
    } );
    this.pick( uid, best );
  }

  get dragging() {
    return !!this.grab;
  }

  /**
   * The fence `uid` with point `index` over `w` ( Unity, world; `up`: its height over the ground, else as it was ), made
   * again quickly.
  **/
  private withPointAt( before: CustomObjectEntry[], uid: string, index: number, w: V3, up?: number ) {
    const o = before.find( ( q ) => q.uid === uid ), f = o && fenceOf( o );
    if ( !o || !f ) return;
    const pts  = f.points.map( ( p, k ) => ( k === index ? fenceLocal( o, w ) : p ) );
    const lift = up === undefined ? f.lift : liftsOf( f ).map( ( l, k ) => ( k === index ? up : l ) );
    useEditor.setState( ( s ) => ( { customObjects: s.customObjects.map( ( q ) => ( q.uid === uid ? withPath( o, { ...f, points: pts, lift }, true ) : q ) ) } ) );
  }

  /**
   * The moved fence made again in full ( colliders, grind rail ) and kept as one undo step.
  **/
  private keep( uid: string, before: CustomObjectEntry[], label: string ) {
    const now = useEditor.getState().customObjects, o = now.find( ( q ) => q.uid === uid );
    if ( now === before || !o ) return;
    const after = now.map( ( q ) => ( q.uid === uid ? rebuilt( o ) : q ) );
    useEditor.setState( { customObjects: before } );
    useEditor.getState().commit( label, { customObjects: after } );
    void this.railAgain( uid );
  }

  /**
   * A repeat that's a jib with a rail, its shape changed: its rail found along it again ( as Make rail finds a piece's )
   * and kept in the same undo step as the change. Nothing if anything else changed meanwhile.
  **/
  async railAgain( uid: string ) {
    const top = history.last, find = () => useEditor.getState().customObjects.find( ( q ) => q.uid === uid );
    const o   = find();
    if ( !top || !o?.rail || o.surface_type !== "Jib" || !isRepeat( fenceOf( o ) ) ) return;
    const pts  = await this.localVertices( o );
    const made = pts ? autoRail( pts ) : null;
    if ( !made?.rail || history.last !== top || find() !== o ) return;
    const body = await partsFor( o, made.rail );
    if ( history.last !== top || find() !== o ) return;
    useEditor.getState().updateCustom( top.label, [uid], ( x ) => withRail( x, { ...made.rail!, ...body } ) );
    history.mergeLast( 2, top.label );
  }

  move( x: number, y: number ) {
    const gr = this.grab;
    if ( !gr ) return;
    const o = gr.before.find( ( q ) => q.uid === gr.uid );
    const g = o && this.groundAt( x, y, o.position.y );
    if ( !g ) return;
    gr.moved = true;
    this.withPointAt( gr.before, gr.uid, gr.index, g );
  }

  /**
   * Let go: the move kept as one undo step.
  **/
  up() {
    const gr  = this.grab;
    this.grab = null;
    if ( gr?.moved ) this.keep( gr.uid, gr.before, "Move point" );
  }

  // ---- the gizmo on the picked point

  /**
   * Where the gizmo goes: the picked point ( view space ), or null with no fence being edited.
  **/
  gizmoAt(): THREE.Vector3 | null {
    const o = this.target();
    return o && o.fence.points.length ? toThree( this.footOf( o, this.pickedOn( o ) ) ) : null;
  }

  /**
   * A gizmo move starting: true when there's a fence being edited ( its picked point moves ).
  **/
  gizmoStart(): boolean {
    const o = this.target();
    if ( !o || !o.fence.points.length ) return false;
    const i     = this.pickedOn( o );
    this.moving = { uid: o.uid, index: i, from: this.footOf( o, i ), before: useEditor.getState().customObjects };
    return true;
  }

  get gizmoMoving() {
    return !!this.moving;
  }

  /**
   * The gizmo's change so far ( view space ) applied to the picked point: along the ground as it goes across, off it
   * ( or into it ) as it goes up or down.
  **/
  gizmoMove( delta: THREE.Matrix4 ) {
    const mv = this.moving, o = mv && mv.before.find( ( q ) => q.uid === mv.uid ), f = o && fenceOf( o );
    if ( !mv || !f ) return;
    const w = toUnity( toThree( mv.from ).applyMatrix4( delta ) );
    this.withPointAt( mv.before, mv.uid, mv.index, w, liftAt( f, mv.index ) + w[1] - mv.from[1] );
  }

  gizmoEnd() {
    const mv    = this.moving;
    this.moving = null;
    if ( mv ) this.keep( mv.uid, mv.before, "Move point" );
  }

  gizmoCancel() {
    const mv    = this.moving;
    this.moving = null;
    if ( mv ) useEditor.setState( { customObjects: mv.before } );
  }

  /**
   * X / Delete: the point picked taken away ( a fence keeps two at least ); true when there was one.
  **/
  deletePoint() {
    const o = this.target(), p = this.picked;
    if ( !o || !p || p.uid !== o.uid ) return false;
    if ( o.fence.points.length <= 2 ) {
      useEditor.getState().toast( "Two points at least", "info" );
      return true;
    }
    const pts  = o.fence.points.filter( ( _, k ) => k !== p.index );
    const lift = liftsOf( o.fence ).filter( ( _, k ) => k !== p.index );
    useEditor.getState().updateCustom( "Delete point", [o.uid], ( x ) => withPath( x, { ...fenceOf( x )!, points: pts, lift } ) );
    this.pick( o.uid, null );
    void this.railAgain( o.uid );
    return true;
  }
}

/**
 * The stretch of a path nearest a point ( its first point's index ).
**/
export function nearestGap( pts: [number, number][], p: [number, number], closed: boolean ) {
  let best   = 0, bd = Infinity;
  const gaps = closed && pts.length > 2 ? pts.length : pts.length - 1;
  for ( let i = 0; i < gaps; i++ ) {
    const a = pts[i], b = pts[( i + 1 ) % pts.length], ux = b[0] - a[0], uz = b[1] - a[1], l2 = ux * ux + uz * uz || 1;
    const t = Math.max( 0, Math.min( 1, ( ( p[0] - a[0] ) * ux + ( p[1] - a[1] ) * uz ) / l2 ) );
    const d = Math.hypot( p[0] - a[0] - ux * t, p[1] - a[1] - uz * t );
    if ( d < bd ) { bd = d; best = i; }
  }
  return best;
}
