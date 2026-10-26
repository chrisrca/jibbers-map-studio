// Blender's gizmo drawn: its arrows, planes, rings and trackball, kept a constant size on screen, lit up under the
// mouse; and while a drag goes on, the turn it's made.

import * as THREE from "three/webgpu";
import { BL_AXES } from "../../../core/blenderAxes";
import type { BlGizmo } from "./blGizmo";
import { Handle, AXIS, WHITE, SIZE, RING, VIEW_RING, same, circle } from "./blGizmo";

// The gizmo drawn.
export class GizmoLook {
  constructor( private gizmo: BlGizmo ) {}

  private material( c: THREE.Color, alpha = 1 ) {
    const m = new THREE.MeshBasicNodeMaterial( { color: c.clone(), transparent: true, opacity: alpha, depthTest: false, depthWrite: false, side: THREE.DoubleSide } );
    return m as THREE.Material & { color: THREE.Color; opacity: number };
  }

  private line( c: THREE.Color, alpha = 1 ) {
    const m = new THREE.LineBasicNodeMaterial( { color: c.clone(), transparent: true, opacity: alpha, depthTest: false, depthWrite: false } );
    return m as unknown as THREE.Material & { color: THREE.Color; opacity: number };
  }

  private add( h: Handle, obj: THREE.Object3D, mat: THREE.Material & { color: THREE.Color; opacity: number }, base: THREE.Color, alpha: number ) {
    obj.traverse( ( o ) => ( o.renderOrder = 1000 ) );
    this.gizmo.handles.add( obj );
    this.gizmo.parts.push( { h, obj, mat, base, alpha } );
  }

  build() {
    for ( const p of this.gizmo.parts ) this.gizmo.handles.remove( p.obj );
    this.gizmo.parts = [];
    const dirs       = BL_AXES;
    const up         = new THREE.Vector3( 0, 1, 0 );
    const turnTo     = ( o: THREE.Object3D, d: THREE.Vector3 ) => o.quaternion.setFromUnitVectors( up, d );
    const arrows     = this.gizmo.mode === "translate" || this.gizmo.mode === "transform", boxes = this.gizmo.mode === "scale";
    if ( arrows || boxes ) {
      for ( const a of [0, 1, 2] as const ) {
        const c     = AXIS[a], h: Handle = { kind: "axis", axis: a };
        const lm    = this.line( c );
        const shaft = new THREE.Line( new THREE.BufferGeometry().setFromPoints( [dirs[a].clone().multiplyScalar( 0.18 ), dirs[a].clone().multiplyScalar( boxes ? 0.92 : 0.84 )] ), lm );
        this.add( h, shaft, lm, c, 1 );
        const hm   = this.material( c );
        const head = boxes ? new THREE.Mesh( new THREE.BoxGeometry( 0.09, 0.09, 0.09 ), hm ) : new THREE.Mesh( new THREE.ConeGeometry( 0.045, 0.18, 12 ), hm );
        turnTo( head, dirs[a] );
        head.position.copy( dirs[a] ).multiplyScalar( boxes ? 0.96 : 0.93 );
        this.add( h, head, hm, c, 1 );
        // the plane square between the other two axes
        const pm     = this.material( c, 0.55 );
        const sq     = new THREE.Mesh( new THREE.PlaneGeometry( 0.1, 0.1 ), pm );
        const [u, v] = [0, 1, 2].filter( ( k ) => k !== a );
        sq.position.copy( dirs[u].clone().add( dirs[v] ).multiplyScalar( 0.32 ) );
        sq.quaternion.setFromUnitVectors( new THREE.Vector3( 0, 0, 1 ), dirs[a] );
        this.add( { kind: "plane", axis: a }, sq, pm, c, 0.55 );
      }
      // the white circle in the middle: move ( or scale ) in the view
      const cm               = this.line( WHITE, 0.9 );
      const centre           = new THREE.Line( circle( 0.12, 32 ), cm );
      centre.userData.facing = true;
      this.add( { kind: this.gizmo.mode === "scale" ? "uniform" : "view", axis: 0 }, centre, cm, WHITE, 0.9 );
    }
    if ( this.gizmo.mode === "scale" || this.gizmo.mode === "transform" ) {
      const om              = this.line( WHITE, 0.75 );
      const outer           = new THREE.Line( circle( 1.18, 64 ), om );
      outer.userData.facing = true;
      this.add( { kind: "uniform", axis: 0 }, outer, om, WHITE, 0.75 );
    }
    if ( this.gizmo.mode === "rotate" ) {
      for ( const a of [0, 1, 2] as const ) {
        const rm           = this.line( AXIS[a] );
        const ring         = new THREE.Line( new THREE.BufferGeometry(), rm );
        ring.userData.ring = a;
        this.add( { kind: "ring", axis: a }, ring, rm, AXIS[a], 1 );
      }
      const vm              = this.line( WHITE, 0.8 );
      const outer           = new THREE.Line( circle( VIEW_RING, 64 ), vm );
      outer.userData.facing = true;
      this.add( { kind: "viewRing", axis: 0 }, outer, vm, WHITE, 0.8 );
      // the trackball: the disc inside the rings ( lit faintly when it's under the mouse )
      const tm             = this.material( WHITE, 0 );
      const disc           = new THREE.Mesh( new THREE.CircleGeometry( RING * 0.98, 48 ), tm );
      disc.userData.facing = true;
      this.add( { kind: "trackball", axis: 0 }, disc, tm, WHITE, 0 );
    }
  }

  /**
   * Each frame: the same size on screen, circles facing the view, rings' near halves, the handle under the mouse lit.
  **/
  update() {
    if ( !this.gizmo.group.visible ) return;
    const cam = this.gizmo.view.camera;
    const s   = SIZE * this.gizmo.mpp();
    this.gizmo.group.position.copy( this.gizmo.drag?.pivot ?? this.gizmo.pivot );
    this.gizmo.group.scale.setScalar( s );
    this.gizmo.handles.quaternion.copy( this.gizmo.quat );
    this.gizmo.group.updateMatrixWorld( true );
    const toCam   = cam.position.clone().sub( this.gizmo.group.position ).normalize();
    const local   = toCam.clone().applyQuaternion( this.gizmo.quat.clone().invert() );
    const dirs    = BL_AXES;
    const hideAll = !!this.gizmo.drag?.modal;
    for ( const p of this.gizmo.parts ) {
      if ( p.obj.userData.facing ) p.obj.quaternion.setFromUnitVectors( new THREE.Vector3( 0, 0, 1 ), local );
      const a = p.obj.userData.ring as number | undefined;
      if ( a !== undefined ) {
        // the half of the ring nearer the eye ( all of it while it's being turned )
        const whole = this.gizmo.drag && same( this.gizmo.drag.h, p.h );
        const n     = dirs[a], u = local.clone().sub( n.clone().multiplyScalar( local.dot( n ) ) );
        if ( u.lengthSq() < 1e-6 ) u.copy( dirs[( a + 1 ) % 3] );
        u.normalize();
        const w                    = n.clone().cross( u );
        const pts: THREE.Vector3[] = [];
        for ( let k = 0; k <= 96; k++ ) {
          const t = whole ? ( Math.PI * 2 * k ) / 96 : -Math.PI / 2 + ( Math.PI * k ) / 96;
          pts.push( u.clone().multiplyScalar( Math.cos( t ) ).add( w.clone().multiplyScalar( Math.sin( t ) ) ) );
        }
        ( p.obj as THREE.Line ).geometry.dispose();
        ( p.obj as THREE.Line ).geometry = new THREE.BufferGeometry().setFromPoints( pts );
      }
      // an axis pointing at the eye fades out ( it can't be dragged along usefully )
      const axisOn = p.h.kind        === "axis" ? 1 - Math.max( 0, ( Math.abs( local.dot( dirs[p.h.axis] ) ) - 0.9 ) / 0.08 ) : 1;
      const lit    = this.gizmo.drag ? same( this.gizmo.drag.h, p.h ) : this.gizmo.hover && same( this.gizmo.hover, p.h );
      p.mat.color.copy( p.base ).lerp( WHITE, lit && p.h.kind !== "trackball" ? 0.45 : 0 );
      p.mat.opacity = Math.max( 0, axisOn ) * ( p.h.kind === "trackball" ? ( lit && !this.gizmo.drag ? 0.06 : 0 ) : lit ? 1 : p.alpha );
      p.obj.visible = !hideAll && axisOn > 0.02 && ( !this.gizmo.drag || same( this.gizmo.drag.h, p.h ) || ( p.h.kind === "view" && this.gizmo.drag.h.kind !== "ring" ) );
    }
  }

  /**
   * A turn: its ring whole, the angle swept filled in, lines to where it began and where it is.
  **/
  showTurn( ring: NonNullable<NonNullable<BlGizmo["drag"]>["ring"]>, turn: number ) {
    const fill = this.material( ring.col, 0.22 ), edge = this.line( ring.col, 0.95 );
    const n    = 48, pts = [new THREE.Vector3()];
    for ( let k = 0; k <= n; k++ ) pts.push( ring.u0.clone().applyAxisAngle( ring.n, ( turn * k ) / n ).multiplyScalar( ring.r ) );
    const idx: number[] = [];
    for ( let k = 1; k <= n; k++ ) idx.push( 0, k, k + 1 );
    const g = new THREE.BufferGeometry().setFromPoints( pts );
    g.setIndex( idx );
    const sector = new THREE.Mesh( g, fill );
    const lines  = new THREE.LineSegments( new THREE.BufferGeometry().setFromPoints( [new THREE.Vector3(), pts[1], new THREE.Vector3(), pts[n + 1]] ), edge );
    for ( const o of [sector, lines] ) {
      o.renderOrder = 1000;
      this.gizmo.fb.add( o );
    }
    if ( this.gizmo.drag?.h.kind === "viewRing" || this.gizmo.drag?.modal ) {
      // ( the white ring isn't drawn by a key's turn: drawn here, whole )
      const circ: THREE.Vector3[] = [];
      for ( let k = 0; k <= 96; k++ ) circ.push( ring.u0.clone().applyAxisAngle( ring.n, ( Math.PI * 2 * k ) / 96 ).multiplyScalar( ring.r ) );
      const whole       = new THREE.Line( new THREE.BufferGeometry().setFromPoints( circ ), this.line( ring.col, 0.8 ) );
      whole.renderOrder = 1000;
      this.gizmo.fb.add( whole );
    }
  }

  clearFeedback() {
    for ( const o of [...this.gizmo.fb.children] ) {
      this.gizmo.fb.remove( o );
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      ( m.material as THREE.Material | undefined )?.dispose();
    }
  }
}
