// Editing a lift ( Map-Tools' Edit Lift ): with one lift picked, each of its stations and masts is a piece of its own —
// dragged over the ground by the piece itself or its handle, or moved with the gizmo, which sits on the piece last
// clicked ( the base station to begin with ); the rest of the lift stays where it is. A lift spacing its masts itself
// puts them afresh as its ends move; a mast moved or put down ( Ctrl+click on the ground, in its place up the line )
// leaves them where they are. X / Delete takes away the mast picked. Where there's no ground ( a map without terrain )
// pieces slide on the level they're at.

import * as THREE from "three/webgpu";
import { toThree, toUnity, type V3 } from "../../core/coords";
import type { ObjectEntry } from "../../core/types";
import { liftLocal, liftPieces, mastIndexFor, withAutoMasts, withBaseAt } from "../../pieces/lift";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { redraw } from "../redraw";

const STATION = 0xffb000;
const MAST    = 0xffffff;
const PICKED  = 0xff5a36;

export type LiftPart = "base" | "top" | number;
// `off`: from the ground under the mouse to the piece's foot ( kept as it's dragged: it doesn't jump to the mouse );
// `level`: the height it slides at where there's no ground
type Grab            = { uid: string; which: LiftPart; before: ObjectEntry[]; moved: boolean; off: [number, number]; level: number };

const label    = ( which: LiftPart ) => ( which === "base" ? "Move base station" : which === "top" ? "Move top station" : "Move mast" );
const groundAt = ( x:     number, z: number ) => terrain.heightAt( x, z );

/**
 * A lift with one of its pieces moved to `at` ( world, Unity space ): the rest where it is, its masts spaced afresh if
 * it spaces them itself ( a mast moved by hand: they stay where they're put from now on ).
**/
export function withPieceAt( o: ObjectEntry, which: LiftPart, at: V3 ): ObjectEntry {
  if ( !o.lift ) return o;
  if ( which === "base" ) return withAutoMasts( withBaseAt( o, at ), groundAt );
  const l = liftLocal( o, at ), v = { x: l[0], y: l[1], z: l[2] };
  if ( which === "top" ) return withAutoMasts( { ...o, lift: { ...o.lift, endPosition: v } }, groundAt );
  return { ...o, liftAuto: undefined, lift: { ...o.lift, masts: o.lift.masts.map( ( m, i ) => ( i === which ? v : m ) ) } };
}

/**
 * Where a piece of the lift stands ( Unity space ).
**/
function footOf( o: ObjectEntry, which: LiftPart ): V3 | null {
  const p = liftPieces( o );
  if ( !p ) return null;
  return which === "base" ? p.base.at : which === "top" ? p.top.at : ( p.masts[which]?.at ?? null );
}

export class LiftTool {
  readonly group = new THREE.Group();
  private ball   = new THREE.SphereGeometry( 1, 14, 10 );
  private mats   = new Map<number, THREE.Material>();
  private grab:   Grab | null = null;
  // the piece last clicked ( the gizmo's on it; X takes it away when it's a mast )
  private picked: { uid: string; which: LiftPart } | null = null;
  // a move with the gizmo under way: where the piece was
  private moving: { uid: string; which: LiftPart; from: V3; before: ObjectEntry[] } | null = null;
  /**
   * the piece picked changed ( the gizmo goes to it )
  **/
  onPicked: () => void = () => {};

  constructor(
    private raycast:    ( x: number, y: number ) => THREE.Raycaster,
    private camera:     () => THREE.PerspectiveCamera,
    private viewHeight: () => number,
    private isLift:     ( o: ObjectEntry ) => boolean,
    // whether a lift has masts ( a rope tow has none: Ctrl puts none down )
    private hasMasts:   ( o: ObjectEntry ) => boolean,
    // a lift's pieces as drawn ( picked by: `userData.liftPart` says which )
    private piecesOf:   ( uid: string ) => THREE.Object3D[],
  ) {
    this.group.renderOrder = 13;
  }

  private mat( color: number ) {
    let m = this.mats.get( color );
    if ( !m ) this.mats.set( color, ( m = new THREE.MeshBasicNodeMaterial( { color, transparent: true, opacity: 0.95, depthTest: false } ) ) );
    return m;
  }

  /**
   * The lift being edited: the one object picked, when it's a lift ( and the select tool is out ).
  **/
  target(): ObjectEntry | null {
    const st = useEditor.getState();
    if ( st.tool !== "select" || st.selection.length !== 1 || st.selection[0].kind !== "object" ) return null;
    const o = st.objects.find( ( x ) => x.uid === st.selection[0].uid );
    return o && o.lift && this.isLift( o ) ? o : null;
  }

  /**
   * The piece of the lift being edited that's picked ( its base station unless another's been clicked ).
  **/
  private pickedPart( o: ObjectEntry ): LiftPart {
    const w = this.picked?.uid === o.uid ? this.picked.which : "base";
    return typeof w === "number" && w >= ( o.lift?.masts.length ?? 0 ) ? "base" : w;
  }

  /**
   * A lift's piece picked ( its base station unless another's been clicked ).
  **/
  pickedOf( uid: string ): LiftPart {
    return this.picked?.uid === uid ? this.picked.which : "base";
  }

  /**
   * Where the gizmo goes: the picked piece's foot ( view space ), or null with no lift being edited.
  **/
  gizmoAt(): THREE.Vector3 | null {
    const o  = this.target();
    const at = o && footOf( o, this.pickedPart( o ) );
    return at ? toThree( at ) : null;
  }

  private pick( uid: string, which: LiftPart ) {
    const was = this.picked;
    this.setPicked( { uid, which } );
    if ( was?.uid !== uid || was.which !== which ) this.onPicked();
  }

  /**
   * The piece picked, told to the panels too ( its Transform is the piece's ).
  **/
  private setPicked( p: { uid: string; which: LiftPart } | null ) {
    this.picked = p;
    const cur   = useEditor.getState().liftPick;
    if ( cur?.uid !== p?.uid || cur?.which !== p?.which ) useEditor.setState( { liftPick: p } );
  }

  /**
   * Its handles drawn again ( the lift or the selection changed ).
  **/
  sync() {
    this.group.clear();
    const o = this.target();
    if ( this.picked && this.picked.uid !== o?.uid ) this.setPicked( null );
    if ( !o ) return redraw();
    const p    = liftPieces( o )!, on = this.pickedPart( o );
    const ball = ( at: V3, color: number, which: LiftPart ) => {
      const m = new THREE.Mesh( this.ball, this.mat( which === on ? PICKED : color ) );
      // ( a little above the piece's foot: on the snow it would hide in it )
      m.position.copy( toThree( [at[0], at[1] + 1, at[2]] ) );
      m.userData    = { which, px: typeof which === "number" ? 9 : 11 };
      m.renderOrder = 13;
      this.group.add( m );
    };
    ball( p.base.at, STATION, "base" );
    ball( p.top.at,  STATION, "top"  );
    p.masts.forEach( ( m, i ) => ball( m.at, MAST, i ) );
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

  /**
   * The handle under the mouse, if one is.
  **/
  private handleAt( x: number, y: number ): LiftPart | null {
    const hit = this.raycast( x, y ).intersectObjects( this.group.children, false )[0];
    return hit ? ( hit.object.userData.which as LiftPart ) : null;
  }

  /**
   * The lift's piece under the mouse ( its station or mast itself ), if one is.
  **/
  private pieceAt( o: ObjectEntry, x: number, y: number ): LiftPart | null {
    const hit = this.raycast( x, y ).intersectObjects( this.piecesOf( o.uid ), false )[0];
    return hit ? ( hit.object.userData.liftPart as LiftPart ) : null;
  }

  /**
   * A lift clicked to select it: the piece clicked is the one picked ( the gizmo starts on it ).
  **/
  pickAt( uid: string, x: number, y: number ) {
    const hit   = this.raycast( x, y ).intersectObjects( this.piecesOf( uid ), false )[0];
    const which = hit?.object.userData.liftPart as LiftPart | undefined;
    if ( which !== undefined ) this.setPicked( { uid, which } );
  }

  /**
   * Whether a press here is the lift's, not the gizmo's: on a handle, or with Ctrl ( a mast put down ).
  **/
  markUnder( x: number, y: number, ctrl = false ) {
    const o = this.target();
    return !!o && ( ( ctrl && this.hasMasts( o ) ) || this.handleAt( x, y ) !== null );
  }

  /**
   * Pointer down: true when it took it ( a piece grabbed, or a mast put down with Ctrl ).
  **/
  down( x: number, y: number, e: { ctrlKey: boolean } ): boolean {
    const o = this.target();
    if ( !o ) return false;
    const which = this.handleAt( x, y ) ?? ( e.ctrlKey ? null : this.pieceAt( o, x, y ) );
    if ( which !== null ) {
      const foot = footOf( o, which )!;
      const g    = this.groundAt( x, y, foot[1] ) ?? foot;
      this.grab  = { uid: o.uid, which, before: useEditor.getState().objects, moved: false, off: [foot[0] - g[0], foot[2] - g[2]], level: foot[1] };
      this.pick( o.uid, which );
      this.sync();
      return true;
    }
    if ( !e.ctrlKey || !this.hasMasts( o ) ) return false;
    const g = this.groundAt( x, y, o.position[1] );
    if ( !g ) return true;
    const local = liftLocal( o, g ), i = mastIndexFor( o, local );
    const masts = [...o.lift!.masts];
    masts.splice( i, 0, { x: local[0], y: local[1], z: local[2] } );
    // ( put by hand: the masts stay where they are from now on )
    useEditor.getState().updateObjects( "Add mast", [o.uid], ( x ) => ( { ...x, liftAuto: undefined, lift: { ...x.lift!, masts } } ) );
    this.pick( o.uid, i );
    this.sync();
    return true;
  }

  get dragging() {
    return !!this.grab;
  }

  /**
   * The ground under the mouse ( Unity space ); where there's none, the level `level` under it.
  **/
  private groundAt( x: number, y: number, level: number ): V3 | null {
    const r   = this.raycast( x, y ).ray;
    const hit = terrain.raycast( r.origin, r.direction, 20000 );
    if ( hit ) return toUnity( hit );
    const p = r.intersectPlane( new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), -level ), new THREE.Vector3() );
    return p ? toUnity( p ) : null;
  }

  move( x: number, y: number ) {
    const gr = this.grab;
    if ( !gr ) return;
    const under = this.groundAt( x, y, gr.level );
    const o     = useEditor.getState().objects.find( ( q ) => q.uid === gr.uid );
    if ( !under || !o?.lift ) return;
    const g: V3 = [under[0] + gr.off[0], 0, under[2] + gr.off[1]];
    g[1]        = groundAt( g[0], g[2] );
    if ( Number.isNaN( g[1] ) ) g[1] = gr.level;
    const next = withPieceAt( o, gr.which, g );
    gr.moved   = true;
    useEditor.setState( ( s ) => ( { objects: s.objects.map( ( q ) => ( q.uid === gr.uid ? next : q ) ) } ) );
  }

  /**
   * Let go: the move kept as one undo step.
  **/
  up() {
    const gr  = this.grab;
    this.grab = null;
    if ( !gr?.moved ) return;
    const after = useEditor.getState().objects;
    useEditor.setState( { objects: gr.before } );
    useEditor.getState().commit( label( gr.which ), { objects: after } );
  }

  // ---- the gizmo on the picked piece

  /**
   * A gizmo move starting: true when it's the picked piece's ( a lift's being edited ).
  **/
  gizmoStart(): boolean {
    const o = this.target();
    if ( !o ) return false;
    const which = this.pickedPart( o ), from = footOf( o, which );
    if ( !from ) return false;
    this.moving = { uid: o.uid, which, from, before: useEditor.getState().objects };
    return true;
  }

  get gizmoMoving() {
    return !!this.moving;
  }

  /**
   * The gizmo's change so far ( view space ) applied to the picked piece: moved along the ground, or up and down.
  **/
  gizmoMove( delta: THREE.Matrix4 ) {
    const mv = this.moving;
    if ( !mv ) return;
    const o = mv.before.find( ( q ) => q.uid === mv.uid );
    if ( !o ) return;
    const p = toUnity( toThree( mv.from ).applyMatrix4( delta ) );
    // ( moved across: on the ground where it goes; moved up or down: kept there )
    if ( Math.abs( p[1] - mv.from[1] ) < 1e-4 ) {
      const g = groundAt( p[0], p[2] );
      if ( !Number.isNaN( g ) ) p[1] = g;
    }
    const next = withPieceAt( o, mv.which, p );
    useEditor.setState( ( s ) => ( { objects: s.objects.map( ( q ) => ( q.uid === mv.uid ? next : q ) ) } ) );
  }

  gizmoEnd() {
    const mv    = this.moving;
    this.moving = null;
    if ( !mv ) return;
    const after = useEditor.getState().objects;
    if ( after === mv.before ) return;
    useEditor.setState( { objects: mv.before } );
    useEditor.getState().commit( label( mv.which ), { objects: after } );
  }

  gizmoCancel() {
    const mv    = this.moving;
    this.moving = null;
    if ( mv ) useEditor.setState( { objects: mv.before } );
  }

  /**
   * X / Delete: the picked mast taken away ( true when one's picked ).
  **/
  deleteMast(): boolean {
    const o = this.target(), m = this.picked;
    if ( !o || !m || m.uid !== o.uid || typeof m.which !== "number" || m.which >= o.lift!.masts.length ) return false;
    const i = m.which;
    useEditor.getState().updateObjects( "Delete mast", [o.uid], ( x ) => ( { ...x, liftAuto: undefined, lift: { ...x.lift!, masts: x.lift!.masts.filter( ( _, k ) => k !== i ) } } ) );
    this.pick( o.uid, "base" );
    this.sync();
    return true;
  }
}
