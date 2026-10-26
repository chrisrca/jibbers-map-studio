// Camera navigation, Blender style:
//   orbit: MMB drag ( or Alt+LMB ), pan: Shift+MMB, zoom: wheel ( toward cursor ) / Ctrl+MMB
//   fly:   hold RMB + WASD/QE ( Shift = fast ), wheel while flying changes speed
//   WASD/QE also move the view without RMB whenever the mouse is over the viewport ( speed follows the zoom )
//   rider: pointer-locked walk over the terrain at rider eye height ( Esc to leave )
//   ( the engine's keys: numpad views, framing )
//   the same in every workspace ( a right-click without a drag is left to menus ); in the Assets workspace ( `blender` )
//   framing glides there ( `glideTo` ), as Blender's smooth view.

import * as THREE from "three/webgpu";
import { clamp } from "../core/coords";
import type { Terrain } from "../terrain/terrain";
import { RIDER_HEIGHT } from "./render/objectsRenderer";

export class CameraController {
  target    = new THREE.Vector3();
  distance  = 300;
  yaw       = Math.PI * 0.75;
  pitch     = -0.45;
  flySpeed  = 40;
  riderMode = false;
  // navigating as Blender does ( the Assets workspace )
  blender   = false;
  onRiderExit?: () => void;
  // a view change gliding there ( Blender's smooth view )
  private glide: { from: { t: THREE.Vector3; d: number; y: number; p: number }; to: { t: THREE.Vector3; d: number; y: number; p: number }; t0: number; ms: number } | null = null;

  private keys    = new Set<string>();
  // the mouse is over the viewport ( WASD moves the view then, without holding RMB )
  private hovered = false;
  private drag: { mode: "orbit" | "pan" | "zoom" | "fly"; x: number; y: number; moved?: boolean } | null = null;
  private riderVelY = 0;

  constructor( private camera: THREE.PerspectiveCamera, private dom: HTMLElement, private terrain: Terrain, private pickPoint: ( x: number, y: number ) => THREE.Vector3 | null ) {
    dom.addEventListener( "pointerdown",  this.onDown                      );
    dom.addEventListener( "wheel",        this.onWheel, { passive: false } );
    dom.addEventListener( "contextmenu",  ( e ) => e.preventDefault()      );
    dom.addEventListener( "pointerenter", () => ( this.hovered = true )    );
    dom.addEventListener( "pointerleave", () => ( this.hovered = false )   );
    window.addEventListener( "pointermove", this.onMove             );
    window.addEventListener( "pointerup",   this.onUp               );
    window.addEventListener( "keydown",     this.onKey              );
    window.addEventListener( "keyup",       this.onKeyUp            );
    // keys released while the window was in the background never send keyup
    window.addEventListener( "blur",        () => this.keys.clear() );
    document.addEventListener( "pointerlockchange", () => {
      if ( this.riderMode && document.pointerLockElement !== this.dom ) this.exitRider();
    } );
    this.apply();
  }

  get flying() {
    return this.drag?.mode === "fly";
  }

  private onDown = ( e: PointerEvent ) => {
    if ( this.riderMode ) return;
    if ( e.button === 1 || ( e.button === 0 && e.altKey ) ) {
      e.preventDefault();
      this.glide = null;
      this.drag  = { mode: e.shiftKey ? "pan" : e.ctrlKey ? "zoom" : "orbit", x: e.clientX, y: e.clientY };
      this.dom.setPointerCapture( e.pointerId );
    } else if ( e.button === 2 ) {
      this.drag = { mode: "fly", x: e.clientX, y: e.clientY };
      this.dom.setPointerCapture( e.pointerId );
    }
  };

  private onMove = ( e: PointerEvent ) => {
    if ( this.riderMode && document.pointerLockElement === this.dom ) {
      this.yaw  -= e.movementX * 0.0025;
      this.pitch = clamp( this.pitch - e.movementY * 0.0025, -1.45, 1.45 );
      return;
    }
    if ( !this.drag ) return;
    const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
    if ( dx || dy ) this.drag.moved = true;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    switch ( this.drag.mode ) {
      case "orbit":
        this.yaw  -= dx * 0.005;
        this.pitch = clamp( this.pitch - dy * 0.005, -1.55, 1.55 );
        break;
      case "pan": {
        const s     = ( this.distance * 2 * Math.tan( ( this.camera.fov * Math.PI ) / 360 ) ) / this.dom.clientHeight;
        const right = new THREE.Vector3().setFromMatrixColumn( this.camera.matrixWorld, 0 );
        const up    = new THREE.Vector3().setFromMatrixColumn( this.camera.matrixWorld, 1 );
        this.target.addScaledVector( right, -dx * s ).addScaledVector( up, dy * s );
        break;
      }
      case "zoom":
        this.distance = clamp( this.distance * Math.pow( 1.01, dy ), 0.2, 50000 );
        break;
      case "fly": {
        // mouse-look around the camera position: keep the eye fixed, move the target
        const eye  = this.camera.position.clone();
        this.yaw  -= dx * 0.004;
        this.pitch = clamp( this.pitch - dy * 0.004, -1.55, 1.55 );
        this.target.copy( eye ).add( this.forward().multiplyScalar( this.distance ) );
        break;
      }
    }
    this.apply();
  };

  private onUp = ( e: PointerEvent ) => {
    if ( this.drag && ( e.button === 1 || e.button === 2 || e.button === 0 ) ) {
      if ( this.drag.mode === "fly" && this.drag.moved ) {
        // re-anchor orbit target on whatever is in the middle of the screen ( not after a plain right-click: a menu )
        const hit = this.pickPoint( this.dom.clientWidth / 2, this.dom.clientHeight / 2 );
        if ( hit ) {
          this.distance = hit.distanceTo( this.camera.position );
          this.target.copy( hit );
        }
      }
      this.drag = null;
    }
  };

  private onWheel = ( e: WheelEvent ) => {
    e.preventDefault();
    if ( this.riderMode ) return;
    if ( this.flying ) {
      this.flySpeed = clamp( this.flySpeed * ( e.deltaY < 0 ? 1.25 : 0.8 ), 1, 2000 );
      return;
    }
    this.glide   = null;
    // ( toward the point under the mouse )
    const factor = Math.pow( 1.0015, e.deltaY );
    const rect   = this.dom.getBoundingClientRect();
    const hit    = this.pickPoint( e.clientX - rect.left, e.clientY - rect.top );
    if ( hit && e.deltaY < 0 ) this.target.lerp( hit, 1 - factor );
    this.distance = clamp( this.distance * factor, 0.2, 50000 );
    this.apply();
  };

  private onKey = ( e: KeyboardEvent ) => {
    if ( ( e.target as HTMLElement )?.closest?.( "input, textarea, select, [contenteditable]" ) ) return;
    // Ctrl/Alt combinations are shortcuts ( Ctrl+S, Alt+G… ), not movement
    if ( e.ctrlKey || e.altKey || e.metaKey ) return;
    this.keys.add( e.code );
    if ( this.riderMode && e.code === "Space" ) {
      // the jump key: not also a click on whatever button has the focus
      e.preventDefault();
      if ( this.riderGrounded() ) this.riderVelY = 4.5;
    }
  };
  private onKeyUp = ( e: KeyboardEvent ) => {
    this.keys.delete( e.code );
    if ( this.riderMode && e.code === "Space" ) e.preventDefault();
  };

  forward() {
    // pitch < 0 looks down; yaw 0 looks along three -Z ( Unity +Z, "downhill" on generated maps )
    return new THREE.Vector3( -Math.sin( this.yaw ) * Math.cos( this.pitch ), Math.sin( this.pitch ), -Math.cos( this.yaw ) * Math.cos( this.pitch ) );
  }

  apply() {
    if ( this.riderMode ) return;
    const eye = this.target.clone().addScaledVector( this.forward(), -this.distance );
    this.camera.position.copy( eye );
    this.camera.lookAt( this.target );
    this.camera.near = clamp( this.distance * 0.002, 0.05, 5 );
    this.camera.far  = Math.max( 30000, this.distance * 10 );
    this.camera.updateProjectionMatrix();
  }

  frame( center: THREE.Vector3, radius: number ) {
    if ( this.blender ) return this.glideTo( { target: center, distance: Math.max( 1, radius * 2.6 ) } );
    this.target.copy( center );
    this.distance = Math.max( 4, radius * 2.6 );
    this.apply();
  }

  /**
   * Glides to a view ( any of target, distance, yaw, pitch ) over `ms`, as Blender's smooth view.
  **/
  glideTo( to: Partial<{ target: THREE.Vector3; distance: number; yaw: number; pitch: number }>, ms = 200 ) {
    const from = { t: this.target.clone(), d: this.distance, y: this.yaw, p: this.pitch };
    // ( the short way round )
    let y      = to.yaw ?? this.yaw;
    while ( y - this.yaw > Math.PI ) y -= Math.PI * 2;
    while ( y - this.yaw < -Math.PI ) y += Math.PI * 2;
    this.glide = { from, to: { t: to.target?.clone() ?? from.t, d: to.distance ?? from.d, y, p: to.pitch ?? from.p }, t0: performance.now(), ms };
  }

  /**
   * Per-frame movement for fly and rider modes, and a view gliding.
  **/
  tick( dt: number ) {
    const k = this.keys;
    if ( this.riderMode ) return this.tickRider( dt );
    if ( this.glide ) {
      const g = this.glide, u = Math.min( 1, ( performance.now() - g.t0 ) / g.ms ), e = u * u * ( 3 - 2 * u );
      this.target.lerpVectors( g.from.t, g.to.t, e );
      this.distance = g.from.d * Math.pow( g.to.d / g.from.d, e );
      this.yaw      = g.from.y + ( g.to.y - g.from.y ) * e;
      this.pitch    = g.from.p + ( g.to.p - g.from.p ) * e;
      if ( u >= 1 ) this.glide = null;
      this.apply();
      return;
    }
    const shift = k.has( "ShiftLeft" ) || k.has( "ShiftRight" );
    if ( !this.flying ) {
      // without RMB: only over the viewport, and Shift is left to shortcuts ( Shift+D duplicates )
      if ( !this.hovered || shift || this.drag ) return;
    }
    // flying has its own speed ( wheel changes it ); otherwise it follows the zoom so it's useful close up and far out
    const base  = this.flying ? this.flySpeed : clamp( this.distance * 0.8, 2, 600 );
    const speed = base * ( this.flying && shift ? 4 : 1 ) * dt;
    const f     = this.forward(), r = new THREE.Vector3().crossVectors( f, new THREE.Vector3( 0, 1, 0 ) ).normalize();
    const move  = new THREE.Vector3();
    if ( k.has( "KeyW" ) ) move.add( f );
    if ( k.has( "KeyS" ) ) move.sub( f );
    if ( k.has( "KeyD" ) ) move.add( r );
    if ( k.has( "KeyA" ) ) move.sub( r );
    if ( k.has( "KeyE" ) ) move.y += 1;
    if ( k.has( "KeyQ" ) ) move.y -= 1;
    if ( move.lengthSq() === 0 ) return;
    if ( this.drag ) this.drag.moved = true;
    move.normalize().multiplyScalar( speed );
    this.target.add( move );
    this.apply();
  }

  // ---------------------------------------------------------------- rider-eye

  enterRider() {
    if ( this.riderMode ) return true;
    ( document.activeElement as HTMLElement | null )?.blur?.();
    const p = this.target.clone();
    const g = this.terrain.heightAt( p.x, -p.z );
    if ( Number.isNaN( g ) ) return false;
    this.riderMode = true;
    this.camera.position.set( p.x, g + RIDER_HEIGHT - 0.1, p.z );
    this.pitch       = -0.1;
    this.camera.near = 0.05;
    this.camera.updateProjectionMatrix();
    this.dom.requestPointerLock();
    return true;
  }

  exitRider() {
    if ( !this.riderMode ) return;
    this.riderMode = false;
    if ( document.pointerLockElement === this.dom ) document.exitPointerLock();
    this.target.copy( this.camera.position ).add( this.forward().multiplyScalar( 20 ) );
    this.distance = 20;
    this.apply();
    this.onRiderExit?.();
  }

  private riderGrounded() {
    const p = this.camera.position;
    return p.y <= this.terrain.heightAt( p.x, -p.z ) + RIDER_HEIGHT;
  }

  private tickRider( dt: number ) {
    const k     = this.keys, p = this.camera.position;
    const speed = ( k.has( "ShiftLeft" ) ? 12 : 5 ) * dt;
    const f     = new THREE.Vector3( -Math.sin( this.yaw ), 0, -Math.cos( this.yaw ) );
    const r     = new THREE.Vector3( -f.z,                  0, f.x                   );
    const move  = new THREE.Vector3();
    if ( k.has( "KeyW" ) ) move.add( f );
    if ( k.has( "KeyS" ) ) move.sub( f );
    if ( k.has( "KeyD" ) ) move.add( r );
    if ( k.has( "KeyA" ) ) move.sub( r );
    if ( move.lengthSq() ) p.addScaledVector( move.normalize(), speed );
    const ground    = this.terrain.heightAt( p.x, -p.z );
    this.riderVelY -= 9.81 * dt;
    p.y            += this.riderVelY * dt;
    if ( !Number.isNaN( ground ) && p.y < ground + RIDER_HEIGHT - 0.1 ) {
      p.y            = ground + RIDER_HEIGHT - 0.1;
      this.riderVelY = 0;
    }
    this.camera.lookAt( p.clone().add( this.forward() ) );
  }
}
