// Blender's transform gizmos: Move ( axis arrows, plane squares, a white circle to move in the view ), Rotate ( an axis
// ring each, their near halves, a white ring to turn about the view, and inside them a trackball ), Scale ( axes ending
// in boxes, plane squares, an outer ring to scale evenly ), and Transform ( Move's with Scale's ring ). On Blender's
// axes ( red X, green Y into the scene, blue Z up: core/blenderAxes.ts ), the same size on screen wherever they are;
// the handle under the mouse lights up. The G / R / S keys drive the same drags without a handle ( `begin` ), X / Y / Z
// ( Shift: the other two ) holding them to an axis or a plane.
//
// While dragging: Ctrl snaps ( or stops snapping, with the header's magnet on ) — by increments, the grid's own step
// for moves, 5° turns, tenths of a scale — or onto a vertex or a surface under the mouse; Shift goes ten times finer.
// A turn shows its ring whole, the angle swept filled in, and the numbers ( `info` ) for the header.

import * as THREE from "three/webgpu";
import { BL_AXES } from "../../../core/blenderAxes";
import { GizmoLook } from "./look";

export type GizmoMode = "translate" | "rotate" | "scale" | "transform";
export type Handle    = { kind: "axis" | "plane" | "view" | "ring" | "viewRing" | "uniform" | "trackball"; axis: 0 | 1 | 2 };
export type SnapTo    = "increment" | "vertex" | "surface";

// Blender's axis colours ( its theme's )
export const AXIS  = [new THREE.Color( 0xff3352 ), new THREE.Color( 0x8bdc00 ), new THREE.Color( 0x2890ff )];
export const WHITE = new THREE.Color( 0xffffff );
// the gizmo's size on screen ( pixels, from its middle to an arrow's tip )
export const SIZE  = 78;
export const RING  = 1, VIEW_RING = 1.2;

export interface GizmoView {
  camera:     THREE.PerspectiveCamera;
  host:       HTMLElement;
  ray:        ( x: number, y: number ) => THREE.Raycaster;
  // the header's snapping: on or off, and onto what
  snapping:   () => { on: boolean; to: SnapTo };
  // a vertex or surface point under a screen point ( not on what's being moved ), for snapping onto
  snapPoint?: ( x: number, y: number, to: "vertex" | "surface" ) => THREE.Vector3 | null;
}

export class BlGizmo {
  // its parts, each in a file of its own beside this one
  readonly look   = new GizmoLook( this ); // the gizmo drawn
  readonly group  = new THREE.Group();
  mode: GizmoMode = "translate";
  // what a drag is doing, for the header ( Blender's "D: 0.5 m along global X" )
  info: { text: string; from: [number, number]; to: [number, number]; line: boolean } | null = null;
  handles        = new THREE.Group();      // the handles ( turned by the orientation ) and a turn's feedback ( not )
  fb             = new THREE.Group();      //  :
  pivot          = new THREE.Vector3();    //  :
  quat           = new THREE.Quaternion(); //  :
  private local  = false;
  hover: Handle | null = null;
  drag: {
    h:     Handle; op: "move" | "turn" | "scale"; x0: number; y0: number; pivot: THREE.Vector3; hit0: THREE.Vector3 | null;
    // a turn so far ( counted on past half a turn )
    ang?:  number;
    // the pointer as it counts ( Shift moves it a tenth as far )
    vx:    number; vy: number; lx: number; ly: number;
    // started by a key ( no handle under the mouse; hidden meanwhile )
    modal: boolean;
    // a turn's ring: its axis, and where on it the drag began
    ring?: { n: THREE.Vector3; u0: THREE.Vector3; r: number; col: THREE.Color };
  } | null = null;
  // the parts drawn, by handle
  parts:     { h: Handle; obj: THREE.Object3D; mat: THREE.Material & { color: THREE.Color; opacity: number }; base: THREE.Color; alpha: number }[] = [];
  onStart?:  () => void;
  onChange?: ( delta: THREE.Matrix4 ) => void;
  onEnd?:    () => void;
  onCancel?: () => void;

  constructor( readonly view: GizmoView ) {
    this.group.visible     = false;
    this.group.renderOrder = 1000;
    this.group.add( this.handles, this.fb );
    this.look.build();
  }

  get attached() {
    return this.group.visible;
  }
  get dragging() {
    return !!this.drag;
  }

  setMode( m: GizmoMode ) {
    if ( m === this.mode ) return;
    this.mode = m;
    this.look.build();
  }

  /**
   * Shown at `pivot` ( view space ), its axes turned by `quat` ( the world's, or a piece's own: `local` ).
  **/
  attach( pivot: THREE.Vector3, quat: THREE.Quaternion, local = false ) {
    if ( this.drag ) return;
    this.pivot.copy( pivot );
    this.quat.copy( quat );
    this.local         = local;
    this.group.visible = true;
    this.look.update();
  }

  detach() {
    if ( this.drag ) return;
    this.group.visible = false;
    this.hover         = null;
  }

  mpp( at = this.pivot ) {
    const cam = this.view.camera;
    return ( 2 * Math.tan( THREE.MathUtils.degToRad( cam.fov ) / 2 ) * at.distanceTo( cam.position ) ) / this.view.host.clientHeight;
  }

  // ---------------------------------------------------------------- picking

  private screen( p: THREE.Vector3 ): [number, number] {
    const v = p.clone().project( this.view.camera );
    return [( v.x * 0.5 + 0.5 ) * this.view.host.clientWidth, ( -v.y * 0.5 + 0.5 ) * this.view.host.clientHeight];
  }
  /**
   * Blender's axis `a` ( X, Y, Z ) as the gizmo is turned, in view space
  **/
  private axisDir( a: number ) {
    return BL_AXES[a].clone().applyQuaternion( this.quat );
  }

  /**
   * The handle under a screen point ( null: none ).
  **/
  private pick( x: number, y: number ): Handle | null {
    if ( !this.group.visible ) return null;
    const s       = SIZE * this.mpp(), [px, py] = this.screen( this.pivot );
    const r       = Math.hypot( x - px, y - py );
    const segDist = ( a: [number, number], b: [number, number] ) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
      const t  = Math.max( 0, Math.min( 1, ( ( x - a[0] ) * dx + ( y - a[1] ) * dy ) / l2 ) );
      return Math.hypot( a[0] + dx * t - x, a[1] + dy * t - y );
    };
    let best: { h: Handle; d: number } | null = null;
    const offer = ( h: Handle, d: number, within = 9 ) => {
      if ( d <= within && ( !best || d < best.d ) ) best = { h, d };
    };
    const at = ( v: THREE.Vector3 ) => this.screen( this.pivot.clone().add( v.multiplyScalar( s ) ) );
    if ( this.mode !== "rotate" ) {
      for ( const a of [0, 1, 2] as const ) {
        const d = this.axisDir( a );
        offer( { kind: "axis", axis: a }, segDist( at( d.clone().multiplyScalar( 0.18 ) ), at( d.clone().multiplyScalar( 1.02 ) ) ) );
        const [u, v] = [0, 1, 2].filter( ( k ) => k !== a );
        const c      = at( this.axisDir( u ).add( this.axisDir( v ) ).multiplyScalar( 0.32 ) );
        offer( { kind: "plane", axis: a }, Math.hypot( x - c[0], y - c[1] ), 8 );
      }
      offer( { kind: this.mode === "scale" ? "uniform" : "view", axis: 0 }, Math.abs( r - 0.12 * SIZE ), 6 );
      if ( r < 0.12 * SIZE ) offer( { kind: this.mode === "scale" ? "uniform" : "view", axis: 0 }, 0 );
      if ( this.mode !== "translate" ) offer( { kind: "uniform", axis: 0 }, Math.abs( r - 1.18 * SIZE ), 7 );
    } else {
      offer( { kind: "viewRing", axis: 0 }, Math.abs( r - VIEW_RING * SIZE ), 7 );
      // a ring: near the circle the axis' ring makes on screen ( sampled )
      for ( const a of [0, 1, 2] as const ) {
        const n     = this.axisDir( a ), u = new THREE.Vector3().crossVectors( n, Math.abs( n.y ) < 0.9 ? new THREE.Vector3( 0, 1, 0 ) : new THREE.Vector3( 1, 0, 0 ) ).normalize(), w = n.clone().cross( u );
        const toCam = this.view.camera.position.clone().sub( this.pivot );
        let d       = Infinity;
        for ( let k = 0; k < 64; k++ ) {
          const t = ( k / 64 ) * Math.PI * 2;
          const p = u.clone().multiplyScalar( Math.cos( t ) ).add( w.clone().multiplyScalar( Math.sin( t ) ) );
          if ( p.dot( toCam ) < -0.05 ) continue;
          const q = at( p );
          d       = Math.min( d, Math.hypot( q[0] - x, q[1] - y ) );
        }
        offer( { kind: "ring", axis: a }, d, 8 );
      }
      // anywhere else inside: the trackball
      if ( !best && r < RING * SIZE ) best = { h: { kind: "trackball", axis: 0 }, d: 0 };
    }
    return ( best as { h: Handle } | null )?.h ?? null;
  }

  /**
   * The mouse moved ( no button ): what's under it lights up. Whether it's over a handle.
  **/
  hoverAt( x: number, y: number ) {
    this.hover = this.pick( x, y );
    return !!this.hover;
  }

  // ---------------------------------------------------------------- dragging

  /**
   * A press: a drag starts if it's on a handle.
  **/
  down( x: number, y: number ): boolean {
    const h = this.pick( x, y );
    if ( !h ) return false;
    this.start( h, x, y, false );
    return true;
  }

  /**
   * G / R / S: a drag without a handle, from the mouse where it is ( in the view, about it, evenly ).
  **/
  begin( op: "translate" | "rotate" | "scale", x: number, y: number ) {
    if ( this.drag ) return;
    this.group.visible = true;
    this.start( { kind: op === "translate" ? "view" : op === "rotate" ? "viewRing" : "uniform", axis: 0 }, x, y, true );
  }

  /**
   * X / Y / Z during a key's drag: along that axis ( `plane`: across it ), again: back to free.
  **/
  constrain( axis: 0 | 1 | 2, plane: boolean ) {
    const d = this.drag;
    if ( !d ) return;
    const want: Handle = d.op === "turn" ? { kind: "ring", axis } : { kind: plane ? "plane" : "axis", axis };
    const free: Handle = { kind: d.op === "move" ? "view" : d.op === "turn" ? "viewRing" : "uniform", axis: 0 };
    const h            = same( d.h, want ) ? free : want;
    d.h                = h;
    d.ang              = 0;
    d.hit0             = this.planeHit( h, d.x0, d.y0 );
    d.ring             = h.kind === "ring" || h.kind === "viewRing" ? this.ringOf( h, d.x0, d.y0 ) : undefined;
    this.move( d.lx, d.ly, { ctrl: false, shift: false }, true );
  }

  private start( h: Handle, x: number, y: number, modal: boolean ) {
    const op       = h.kind === "ring" || h.kind === "viewRing" || h.kind === "trackball" ? "turn" : h.kind === "uniform" || this.mode === "scale" ? "scale" : "move";
    this.drag      = { h, op, x0: x, y0: y, pivot: this.pivot.clone(), hit0: null, vx: x, vy: y, lx: x, ly: y, modal };
    this.drag.hit0 = this.planeHit( h, x, y );
    if ( h.kind === "ring" || h.kind === "viewRing" ) this.drag.ring = this.ringOf( h, x, y );
    this.onStart?.();
  }

  /**
   * A turn's ring: its axis, and where on it ( from the middle ) the drag began.
  **/
  private ringOf( h: Handle, x: number, y: number ) {
    const P     = this.drag?.pivot ?? this.pivot;
    const toCam = this.view.camera.position.clone().sub( P ).normalize();
    const n     = h.kind === "ring" ? this.axisDir( h.axis ) : toCam.clone().negate();
    const hit   = this.view.ray( x, y ).ray.intersectPlane( new THREE.Plane().setFromNormalAndCoplanarPoint( n, P ), new THREE.Vector3() );
    let u0      = hit ? hit.sub( P ) : new THREE.Vector3();
    u0.sub( n.clone().multiplyScalar( u0.dot( n ) ) );
    // ( a ring seen edge-on: from the screen instead )
    if ( u0.lengthSq() < 1e-10 || Math.abs( n.dot( toCam ) ) < 0.08 ) u0 = new THREE.Vector3().setFromMatrixColumn( this.view.camera.matrixWorld, 0 ).cross( n ).cross( n ).negate();
    return { n, u0: u0.normalize(), r: h.kind === "ring" ? RING : VIEW_RING, col: h.kind === "ring" ? AXIS[h.axis] : WHITE };
  }

  /**
   * The plane a move handle slides in, through the pivot.
  **/
  private planeOf( h: Handle ) {
    const toCam = this.view.camera.position.clone().sub( this.drag?.pivot ?? this.pivot ).normalize();
    if ( h.kind === "plane" ) return this.axisDir( h.axis );
    if ( h.kind === "axis" ) {
      const a = this.axisDir( h.axis ), side = toCam.clone().cross( a );
      const n = a.clone().cross( side );
      return n.lengthSq() > 1e-8 ? n.normalize() : toCam;
    }
    return toCam;
  }
  private planeHit( h: Handle, x: number, y: number ) {
    const ray   = this.view.ray( x, y ).ray, n = this.planeOf( h );
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint( n, this.drag?.pivot ?? this.pivot );
    return ray.intersectPlane( plane, new THREE.Vector3() );
  }

  /**
   * The grid's step where the pivot is ( what a move snaps by ): the power of ten a dozen or so pixels long.
  **/
  private moveStep() {
    return Math.pow( 10, Math.ceil( Math.log10( this.mpp( this.drag?.pivot ) * 14 ) ) );
  }

  /**
   * The mouse moved ( or Ctrl or Shift changed ) during a drag.
  **/
  move( x: number, y: number, mods: { ctrl: boolean; shift: boolean }, again = false ) {
    const d = this.drag;
    if ( !d ) return;
    if ( !again ) {
      // Shift: the pointer counts a tenth as far, from where it is when it's pressed
      const k = mods.shift ? 0.1 : 1;
      d.vx   += ( x - d.lx ) * k;
      d.vy   += ( y - d.ly ) * k;
      d.lx    = x;
      d.ly    = y;
    }
    const vx       = d.vx, vy = d.vy;
    const sn       = this.view.snapping();
    const snapping = sn.on !== mods.ctrl;
    const inc      = snapping && sn.to === "increment", fine = mods.shift;
    const P        = d.pivot, h = d.h;
    const [px, py] = this.screen( P );
    const about    = ( m: THREE.Matrix4 ) => new THREE.Matrix4().makeTranslation( P.x, P.y, P.z ).multiply( m ).multiply( new THREE.Matrix4().makeTranslation( -P.x, -P.y, -P.z ) );
    const frame    = this.local ? "local" : "global";
    const name     = ( a: number ) => "XYZ"[a];
    let delta      = new THREE.Matrix4();
    let text       = "";
    this.look.clearFeedback();
    if ( h.kind === "axis" && d.op === "scale" ) {
      // scaling along an axis: how much farther along it ( on screen ) the mouse is than it was
      const a     = this.axisDir( h.axis ), e = this.screen( P.clone().add( a ) );
      const dir   = [e[0] - px, e[1] - py], l = Math.hypot( dir[0], dir[1] ) || 1;
      const along = ( mx: number, my: number ) => ( ( mx - px ) * dir[0] + ( my - py ) * dir[1] ) / l;
      let k       = along( vx, vy ) / ( along( d.x0, d.y0 ) || 1 );
      if ( inc ) k = roundTo( k, fine ? 0.01 : 0.1 );
      delta = about( scaleAlong( a, k ) );
      text  = `Scale: ${k.toFixed( 4 )} along ${frame} ${name( h.axis )}`;
    } else if ( h.kind === "uniform" || ( h.kind === "plane" && d.op === "scale" ) ) {
      let k = Math.hypot( vx - px, vy - py ) / ( Math.hypot( d.x0 - px, d.y0 - py ) || 1 );
      if ( inc ) k = roundTo( k, fine ? 0.01 : 0.1 );
      if ( h.kind === "plane" ) {
        const [u, v] = [0, 1, 2].filter( ( q ) => q !== h.axis );
        delta        = about( scaleAlong( this.axisDir( u ), k ).multiply( scaleAlong( this.axisDir( v ), k ) ) );
        text         = `Scale: ${k.toFixed( 4 )} along ${frame} ${name( u )}${name( v )}`;
      } else {
        delta = about( new THREE.Matrix4().makeScale( k, k, k ) );
        text  = `Scale: ${k.toFixed( 4 )}`;
      }
    } else if ( h.kind === "trackball" ) {
      // the trackball: across the screen turns about the view's up, up and down about its right
      const cam   = this.view.camera;
      const right = new THREE.Vector3().setFromMatrixColumn( cam.matrixWorld, 0 ), up = new THREE.Vector3().setFromMatrixColumn( cam.matrixWorld, 1 );
      let ax      = ( vx - d.x0 ) * 0.01, ay = ( vy - d.y0 ) * 0.01;
      if ( inc ) { ax = roundTo( ax, rad( fine ? 1 : 5 ) ); ay = roundTo( ay, rad( fine ? 1 : 5 ) ); }
      const q = new THREE.Quaternion().setFromAxisAngle( up, ax ).multiply( new THREE.Quaternion().setFromAxisAngle( right, ay ) );
      delta   = about( new THREE.Matrix4().makeRotationFromQuaternion( q ) );
      text    = `Trackball: ${deg( ax ).toFixed( 2 )}° ${deg( ay ).toFixed( 2 )}°`;
    } else if ( h.kind === "ring" || h.kind === "viewRing" ) {
      const ring  = d.ring ?? this.ringOf( h, d.x0, d.y0 );
      const toCam = this.view.camera.position.clone().sub( P ).normalize();
      let ang     = Math.atan2( vy - py, vx - px ) - Math.atan2( d.y0 - py, d.x0 - px );
      ang         = Math.atan2( Math.sin( ang ), Math.cos( ang ) );
      // ( keep counting past half a turn )
      const prev  = d.ang ?? 0;
      while ( ang - prev > Math.PI ) ang -= Math.PI * 2;
      while ( ang - prev < -Math.PI ) ang += Math.PI * 2;
      d.ang    = ang;
      // ( screen angles run clockwise; an axis pointing away turns the other way )
      let turn = ring.n.dot( toCam ) > 0 ? -ang : ang;
      if ( inc ) turn = roundTo( turn, rad( fine ? 1 : 5 ) );
      delta = about( new THREE.Matrix4().makeRotationAxis( ring.n, turn ) );
      this.look.showTurn( ring, turn );
      text = `Rotation: ${deg( turn ).toFixed( 2 )}°${h.kind === "ring" ? ` along ${frame} ${name( h.axis )}` : ""}`;
    } else {
      // moving: along the axis, in the plane, or in the view
      const hit = this.planeHit( h, vx, vy );
      if ( !hit || !d.hit0 ) return;
      let v      = hit.clone().sub( d.hit0 );
      // onto a vertex or a surface under the ( real ) mouse: the pivot lands there
      const onto = snapping && sn.to !== "increment" ? this.view.snapPoint?.( x, y, sn.to ) ?? null : null;
      if ( onto ) v = onto.clone().sub( P );
      const step = this.moveStep() * ( fine ? 0.1 : 1 );
      if ( h.kind === "axis" ) {
        const a = this.axisDir( h.axis );
        let t   = v.dot( a );
        if ( inc && !onto ) t = roundTo( t, step );
        v    = a.multiplyScalar( t );
        text = `D: ${fmtM( t )} along ${frame} ${name( h.axis )}`;
      } else {
        // in the gizmo's axes: steps along each ( a plane's own axis kept out )
        const parts = [0, 1, 2].map( ( a ) => v.dot( this.axisDir( a ) ) );
        if ( h.kind === "plane" ) parts[h.axis] = 0;
        if ( inc && !onto ) for ( let a = 0; a < 3; a++ ) parts[a] = roundTo( parts[a], step );
        if ( !onto || h.kind === "plane" ) v = parts.reduce( ( acc, t, a ) => acc.add( this.axisDir( a ).multiplyScalar( t ) ), new THREE.Vector3() );
        const shown = [0, 1, 2].map( ( a ) => v.dot( this.axisDir( a ) ) );
        text        = `D: ${shown.map( ( t ) => fmtM( t ) ).join( "  " )} (${fmtM( v.length() )})${h.kind === "plane" ? ` along ${frame} ${[0, 1, 2].filter( ( q ) => q !== h.axis ).map( name ).join( "" )}` : ""}`;
      }
      if ( onto ) text += `  snapped to ${sn.to}`;
      delta = new THREE.Matrix4().makeTranslation( v.x, v.y, v.z );
    }
    this.info = { text, from: [px, py], to: [x, y], line: d.op !== "move" };
    this.onChange?.( delta );
  }

  up() {
    if ( !this.drag ) return false;
    const modal = this.drag.modal;
    this.drag   = null;
    this.info   = null;
    this.look.clearFeedback();
    if ( modal ) this.group.visible = false;
    this.onEnd?.();
    return true;
  }

  /**
   * Esc or a right click: what was being moved goes back.
  **/
  cancel() {
    if ( !this.drag ) return false;
    const modal = this.drag.modal;
    this.drag   = null;
    this.info   = null;
    this.look.clearFeedback();
    if ( modal ) this.group.visible = false;
    this.onCancel?.();
    return true;
  }
}

export const same = ( a: Handle | null, b: Handle ) => !!a && a.kind === b.kind && a.axis === b.axis;
export const rad  = ( d: number ) => ( d * Math.PI ) / 180;
export const deg  = ( r: number ) => ( r * 180 ) / Math.PI;
const roundTo     = ( v: number, step: number ) => Math.round( v / step ) * step;
/**
 * metres as Blender shows them ( four places, no trailing zeros )
**/
export const fmtM = ( v: number ) => `${( +v.toFixed( 4 ) ).toString()} m`;

export function circle( r: number, n: number ) {
  const pts: THREE.Vector3[] = [];
  // ( closed: WebGPU draws no line loops, so the last point is the first )
  for ( let k = 0; k <= n; k++ ) pts.push( new THREE.Vector3( Math.cos( ( k / n ) * Math.PI * 2 ) * r, Math.sin( ( k / n ) * Math.PI * 2 ) * r, 0 ) );
  return new THREE.BufferGeometry().setFromPoints( pts );
}

/**
 * A scale by `k` along a direction ( and nothing across it ).
**/
function scaleAlong( a: THREE.Vector3, k: number ) {
  const n = a.clone().normalize(), m = new THREE.Matrix4();
  const e = ( i: number, j: number ) => ( i === j ? 1 : 0 ) + ( k - 1 ) * n.getComponent( i ) * n.getComponent( j );
  m.set( e( 0, 0 ), e( 0, 1 ), e( 0, 2 ), 0, e( 1, 0 ), e( 1, 1 ), e( 1, 2 ), 0, e( 2, 0 ), e( 2, 1 ), e( 2, 2 ), 0, 0, 0, 0, 1 );
  return m;
}
