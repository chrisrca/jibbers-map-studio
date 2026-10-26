// The camera moved for the user: the map or the selection framed, a view from a point, the navigation gizmo's
// drags, Blender's numpad views, the rider's eye.

import * as THREE from "three/webgpu";
import { toThree, type V3 } from "../../core/coords";
import { arr3 } from "../../core/types";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import type { Engine } from "./engine";

// The camera's moves.
export class CameraMoves {
  constructor( private engine: Engine ) {}

  frameAll() {
    // on the stage: its pieces
    if ( this.engine.stage.shown ) {
      const box = new THREE.Box3();
      this.engine.customR.group.updateMatrixWorld( true );
      for ( const o of useEditor.getState().customObjects ) {
        const g = this.engine.customR.objectGroup( o.uid );
        if ( g?.children.length ) box.expandByObject( g );
      }
      if ( box.isEmpty() ) box.setFromCenterAndSize( this.engine.stage.at, new THREE.Vector3( 4, 4, 4 ) );
      const sphere = box.getBoundingSphere( new THREE.Sphere() );
      return this.engine.controls.frame( sphere.center, Math.max( 3, sphere.radius ) );
    }
    const b = terrain.bounds();
    // ( no terrain yet: the origin, as the Assets workspace opens )
    if ( !Number.isFinite( b.x0 ) ) return this.engine.controls.frame( new THREE.Vector3( 0, 0, 0 ), 6 );
    const cx                   = ( b.x0 + b.x1 ) / 2, cz = ( b.z0 + b.z1 ) / 2;
    const h                    = terrain.heightAt( cx, cz );
    const size                 = Math.max( b.x1 - b.x0, b.z1 - b.z0 );
    // single park chunk: frame the middle closely; big maps: frame the centre chunk
    const radius               = Math.min( size, 1000 ) * 0.35;
    this.engine.controls.yaw   = 0;
    this.engine.controls.pitch = -0.5;
    this.engine.controls.frame( new THREE.Vector3( cx, Number.isNaN( h ) ? 0 : h, -cz ), radius );
  }

  frameSelection() {
    const { selection, objects, spawns, customObjects } = useEditor.getState();
    if ( !selection.length ) return this.frameAll();
    const box = new THREE.Box3();
    for ( const s of selection ) {
      if ( s.kind === "custom" ) {
        const g = this.engine.customR.objectGroup( s.uid );
        if ( g?.children.length ) box.expandByObject( g );
        else {
          const o = customObjects.find( ( x ) => x.uid === s.uid );
          if ( o ) box.expandByPoint( toThree( arr3( o.position ) ) ).expandByScalar( 2 );
        }
      } else if ( s.kind === "object" ) {
        const m = this.engine.objectsR.objectMesh( s.uid );
        if ( m ) box.expandByObject( m );
        else {
          const o = objects.find( ( x ) => x.uid === s.uid );
          if ( o ) box.expandByPoint( toThree( o.position ) );
        }
      } else {
        const sp = spawns.find( ( x ) => x.uid === s.uid );
        if ( sp ) box.expandByPoint( toThree( sp.position ) ).expandByScalar( 2 );
      }
    }
    if ( box.isEmpty() ) return;
    const sphere = box.getBoundingSphere( new THREE.Sphere() );
    this.engine.controls.frame( sphere.center, Math.max( 3, sphere.radius ) );
  }

  /**
   * Look from a Unity-space eye position toward a Unity-space target.
  **/
  lookAtUnity( eye: V3, target: V3 ) {
    const e = toThree( eye ), t = toThree( target );
    const d = t.clone().sub( e );
    this.engine.controls.target.copy( t );
    this.engine.controls.distance = d.length();
    this.engine.controls.yaw      = Math.atan2( -d.x, -d.z );
    this.engine.controls.pitch    = Math.asin( d.y / d.length() );
    this.engine.controls.apply();
  }

  /**
   * The navigation gizmo's drags: orbit, zoom, pan ( pixels ).
  **/
  orbitBy( dx: number, dy: number ) {
    const c = this.engine.controls;
    c.yaw  -= dx * 0.008;
    c.pitch = Math.max( -1.55, Math.min( 1.55, c.pitch - dy * 0.008 ) );
    c.apply();
  }

  zoomBy( dy: number ) {
    const c    = this.engine.controls;
    c.distance = Math.max( 0.2, Math.min( 50000, c.distance * Math.pow( 1.01, dy ) ) );
    c.apply();
  }

  panBy( dx: number, dy: number ) {
    const c     = this.engine.controls, cam = this.engine.camera;
    const k     = ( 2 * Math.tan( THREE.MathUtils.degToRad( cam.fov ) / 2 ) * c.distance ) / this.engine.host.clientHeight;
    const right = new THREE.Vector3().setFromMatrixColumn( cam.matrixWorld, 0 ), up = new THREE.Vector3().setFromMatrixColumn( cam.matrixWorld, 1 );
    c.target.addScaledVector( right, -dx * k ).addScaledVector( up, dy * k );
    c.apply();
  }

  /**
   * Looking along an axis ( view space ), from its side ( the navigation gizmo's circles ).
  **/
  viewFrom( axis: THREE.Vector3 ) {
    const d = axis.clone().normalize().negate(), c = this.engine.controls;
    c.glideTo( { yaw: Math.abs( d.y ) > 0.999 ? 0 : Math.atan2( -d.x, -d.z ), pitch: Math.asin( Math.max( -0.9999, Math.min( 0.9999, d.y ) ) ) } );
  }

  /**
   * Blender's numpad views: looking down on it ( along -Z ), from its front ( along +Y ), its right ( along -X ), and their
   * opposites ( Blender's axes: core/blenderAxes.ts ).
  **/
  viewAlong( v: "top" | "bottom" | "front" | "back" | "right" | "left" ) {
    // the direction looked in ( three's space: Blender's Y is three's -Z, its Z three's Y )
    const d = { top: [0, -1, 0], bottom: [0, 1, 0], front: [0, 0, -1], back: [0, 0, 1], right: [-1, 0, 0], left: [1, 0, 0] }[v];
    this.engine.controls.glideTo( { yaw: v === "top" || v === "bottom" ? 0 : Math.atan2( -d[0], -d[2] ), pitch: Math.asin( Math.max( -0.9999, Math.min( 0.9999, d[1] ) ) ) } );
  }

  enterRider() {
    return this.engine.controls.enterRider();
  }
}
