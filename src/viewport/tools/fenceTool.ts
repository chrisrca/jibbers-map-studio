// Editing a fence ( pieces/fence.ts ) as a lift is edited: with one fence picked, its points are handles — dragged over
// the ground, or moved with the gizmo, which sits on the point picked ( the one clicked, or nearest where the fence was
// clicked; its first till then ) and moves it along the ground, or up and down off it ( into it too ); Ctrl+click on
// the ground puts a point into the nearest stretch, X / Delete takes away the point picked. While a point moves the
// fence is made again without what only matters once it's put down ( its colliders, its grind rail ). A repeat turned
// with the gizmo ( Rotate, or R ) turns each of its sections about its own middle, not the whole of it.

import * as THREE from "three/webgpu";
import { toThree, toUnity, unityEulerToQuat, type V3 } from "../../core/coords";
import type { CustomObjectEntry } from "../../core/types";
import { history } from "../../map/history";
import { useEditor } from "../../map/store";
import { fenceLocal, fenceOf, fenceWorld, isRepeat, liftAt, scaledSections, turnedSections, withFence, type FenceData } from "../../pieces/fence";
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
  // ( `off`: from the ground under the mouse to the point, kept as it's dragged: it doesn't jump to the mouse )
  private grab:  { uid: string; index: number; before: CustomObjectEntry[]; moved: boolean; off: [number, number] } | null = null;
  // the point last clicked ( the gizmo's on it; X takes it away )
  private picked: { uid: string; index: number } | null = null;
  // a move with the gizmo under way: the point, where it was, the pieces before
  private moving: { uid: string; index: number; from: V3; before: CustomObjectEntry[] } | null = null;
  // a turn ( or a scaling ) with the gizmo under way: the repeat, the pieces before, how its sections face by the
  // picked point
  private turning: { uid: string; before: CustomObjectEntry[]; frame: THREE.Quaternion; axes: THREE.Quaternion; scale: boolean } | null = null;
  // the gizmo's middle circle under the mouse; the gizmo shown ( set by the engine ): pressed there, the point picked is
  // dragged over the ground, as its handle was ( the handle itself not drawn under the gizmo )
  centreUnder: ( x: number, y: number ) => boolean = () => false;
  gizmoShown:  () => boolean                       = () => false;
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
      m.userData    = { index: i, px: 9, picked: on === i };
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
    for ( const c of this.group.children ) {
      c.scale.setScalar( ( c.userData.px as number ) * k * cam.position.distanceTo( c.position ) );
      if ( c.userData.picked ) c.visible = !this.gizmoShown();
    }
  }

  private handleAt( x: number, y: number ): number | null {
    const hit = this.raycast( x, y ).intersectObjects( this.group.children.filter( ( c ) => c.visible ), false )[0];
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
    return !!o && ( ctrl || this.handleAt( x, y ) !== null || this.centreUnder( x, y ) );
  }

  /**
   * Pointer down: true when it took it ( a point grabbed, or one put in ).
  **/
  down( x: number, y: number, e: { ctrlKey: boolean } ): boolean {
    const o = this.target();
    if ( !o ) return false;
    const st = useEditor.getState(), i = this.handleAt( x, y ) ?? ( this.centreUnder( x, y ) ? this.pickedOn( o ) : null );
    if ( i !== null ) {
      const foot = this.footOf( o, i ), g = this.groundAt( x, y, foot[1] ) ?? foot;
      this.grab  = { uid: o.uid, index: i, before: st.customObjects, moved: false, off: [foot[0] - g[0], foot[2] - g[2]] };
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
   * The fence whose point is being dragged or moved, or whose sections are being turned, if one is.
  **/
  get busyWith(): string | null {
    return this.grab?.uid ?? this.moving?.uid ?? this.turning?.uid ?? null;
  }
  // a drag over ( set by the engine: the jib's grind guide back )
  onIdle: () => void = () => {};

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
   * and kept in the same undo step as the change ( `make`: one made if it has none yet ). Nothing if anything else
   * changed meanwhile.
  **/
  async railAgain( uid: string, make = false ) {
    const top = history.last, find = () => useEditor.getState().customObjects.find( ( q ) => q.uid === uid );
    const o   = find();
    // ( one with its section's rail has it laid along it as it's made: nothing to find )
    if ( !top || !( o?.rail || make ) || o?.surface_type !== "Jib" || !isRepeat( fenceOf( o ) ) || fenceOf( o )!.style.infill.sectionRail ) return;
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
    this.withPointAt( gr.before, gr.uid, gr.index, [g[0] + gr.off[0], g[1], g[2] + gr.off[1]] );
  }

  /**
   * Let go: the move kept as one undo step.
  **/
  up() {
    const gr  = this.grab;
    this.grab = null;
    if ( gr?.moved ) this.keep( gr.uid, gr.before, "Move point" );
    this.onIdle();
  }

  // ---- the gizmo on the picked point

  /**
   * Where the gizmo goes: the picked point ( view space ), or null with no fence being edited.
  **/
  gizmoAt(): THREE.Vector3 | null {
    const o = this.target();
    // ( where its ball is, a little up: the gizmo takes the ball's place )
    const f = o && o.fence.points.length ? this.footOf( o, this.pickedOn( o ) ) : null;
    return f ? toThree( [f[0], f[1] + 0.3, f[2]] ) : null;
  }

  /**
   * Which way the repeat's sections face by the picked point ( three.js space: their X the way the path runs there ),
   * for the gizmo's axes: a turn or a scaling along them is made each section's own.
  **/
  sectionAxes(): THREE.Quaternion | null {
    const o = this.target(), F = this.pathFrame(), t = o?.fence.style.infill.sectionTurn;
    return F && t ? F.multiply( new THREE.Quaternion( ...t ) ) : F;
  }

  /**
   * Which way the path runs by the picked point ( three.js space: its X along the path ).
  **/
  private pathFrame(): THREE.Quaternion | null {
    const o = this.target();
    if ( !o || o.fence.points.length < 2 ) return o ? new THREE.Quaternion() : null;
    const p      = o.fence.points, i = this.pickedOn( o ), j = i + 1 < p.length ? i + 1 : i - 1;
    const [a, b] = j > i ? [p[i], p[j]] : [p[j], p[i]];
    return unityEulerToQuat( [0, ( Math.atan2( -( b[1] - a[1] ), b[0] - a[0] ) * 180 ) / Math.PI, 0] );
  }

  /**
   * Whether the fence being edited turns with the gizmo: a repeat ( its sections, each about its own middle ).
  **/
  turns() {
    return isRepeat( this.target()?.fence ?? null );
  }

  /**
   * A gizmo drag starting: true when there's a fence being edited ( its picked point moves; a turn, a repeat's sections
   * turn ).
  **/
  gizmoStart( op: "move" | "turn" | "scale" | null = "move" ): boolean {
    const o = this.target();
    if ( !o || !o.fence.points.length ) return false;
    if ( op === "turn" || op === "scale" ) {
      if ( !isRepeat( o.fence ) ) return false;
      this.turning = { uid: o.uid, before: useEditor.getState().customObjects, frame: this.pathFrame()!, axes: this.sectionAxes()!, scale: op === "scale" };
      return true;
    }
    const i     = this.pickedOn( o );
    this.moving = { uid: o.uid, index: i, from: this.footOf( o, i ), before: useEditor.getState().customObjects };
    return true;
  }

  get gizmoMoving() {
    return !!this.moving || !!this.turning;
  }

  /**
   * The gizmo's change so far ( view space ) applied to the picked point: along the ground as it goes across, off it
   * ( or into it ) as it goes up or down.
  **/
  gizmoMove( delta: THREE.Matrix4 ) {
    if ( this.turning ) return this.turnBy( delta );
    const mv = this.moving, o = mv && mv.before.find( ( q ) => q.uid === mv.uid ), f = o && fenceOf( o );
    if ( !mv || !f ) return;
    const w = toUnity( toThree( mv.from ).applyMatrix4( delta ) );
    this.withPointAt( mv.before, mv.uid, mv.index, w, liftAt( f, mv.index ) + w[1] - mv.from[1] );
  }

  /**
   * The gizmo's turn so far applied to every section of the repeat, each about its own middle, made again quickly.
  **/
  private turnBy( delta: THREE.Matrix4 ) {
    const tr = this.turning!, o = tr.before.find( ( q ) => q.uid === tr.uid ), f = o && fenceOf( o );
    if ( !o || !f ) return;
    // ( the world's change as the sections' own: their frame undone, changed, put back; the gizmo's axes are theirs,
    // so a scaling along one is along theirs )
    const F    = new THREE.Matrix4().makeRotationFromQuaternion( tr.scale ? tr.axes : tr.frame );
    const own  = F.clone().invert().multiply( delta ).multiply( F );
    let next: FenceData;
    if ( tr.scale ) {
      const e = own.elements;
      next    = scaledSections( f, [Math.max( 0.05, Math.hypot( e[0], e[1], e[2] ) ), Math.max( 0.05, Math.hypot( e[4], e[5], e[6] ) ), Math.max( 0.05, Math.hypot( e[8], e[9], e[10] ) )] );
    } else {
      const q = new THREE.Quaternion();
      own.decompose( new THREE.Vector3(), q, new THREE.Vector3() );
      next    = turnedSections( f, q );
    }
    useEditor.setState( ( s ) => ( { customObjects: s.customObjects.map( ( x ) => ( x.uid === tr.uid ? withPath( o, next, true ) : x ) ) } ) );
  }

  gizmoEnd() {
    const mv = this.moving, tr = this.turning;
    this.moving = this.turning = null;
    if ( mv ) this.keep( mv.uid, mv.before, "Move point" );
    if ( tr ) this.keep( tr.uid, tr.before, tr.scale ? "Scale sections" : "Turn sections" );
    this.onIdle();
  }

  gizmoCancel() {
    const before = this.moving?.before ?? this.turning?.before;
    this.moving  = this.turning = null;
    if ( before ) useEditor.setState( { customObjects: before } );
    this.onIdle();
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
