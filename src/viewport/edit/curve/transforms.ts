// Edit Mode on a curve's Grab / Rotate / Scale and radius ( Alt+S ), worked out as the mouse moves, kept or put back.

import * as THREE from "three/webgpu";
import { toThree, toUnity } from "../../../core/coords";
import type { CustomObjectEntry } from "../../../core/types";
import { type CurveData } from "../../../model/curve";
import type { CurveEditor } from "./curveEditor";
import { parse } from "./curveEditor";

// Grab, Rotate, Scale and radius.
export class CurveTransforms {
  constructor( private ed: CurveEditor ) {}

  start( op: "g" | "r" | "s" | "radius", label?: string, o0?: CustomObjectEntry, base?: CurveData ) {
    const o = this.ed.obj();
    if ( !o || !this.ed.sel.size ) return;
    const from = base ?? o.model.curve;
    const M    = this.ed.matrix( o ), c = new THREE.Vector3();
    for ( const id of this.ed.sel ) {
      const [s, i] = parse( id );
      c.add( this.ed.world( o, from.splines[s].points[i].p, M ) );
    }
    c.divideScalar( this.ed.sel.size );
    this.ed.modal = { kind: "transform", op, o0: o0 ?? o, base: from, pivot: c, x0: this.ed.mouse.x, y0: this.ed.mouse.y, axis: null, typed: "", label: label ?? { g: "Move", r: "Rotate", s: "Scale", radius: "Size" }[op] };
    this.runTransform( {} );
  }

  private alongLine( x: number, y: number, origin: THREE.Vector3, dir: THREE.Vector3 ) {
    const r   = this.ed.view.ray( x, y ).ray;
    const w0  = origin.clone().sub( r.origin ), b = dir.dot( r.direction ), d = dir.dot( w0 ), e = r.direction.dot( w0 );
    const den = 1 - b * b;
    return den > 1e-6 ? ( b * e - d ) / den : 0;
  }

  runTransform( e: { ctrlKey?: boolean; shiftKey?: boolean } ) {
    const m = this.ed.modal;
    if ( m?.kind !== "transform" ) return;
    const c0       = m.base, c = this.ed.clone( c0 ), M = this.ed.matrix( m.o0 ), Minv = M.clone().invert();
    const typed    = m.typed && m.typed !== "-" && m.typed !== "." ? parseFloat( m.typed ) : NaN;
    const [px, py] = this.ed.screen( m.pivot );
    const dir      = m.axis === null ? null : toThree( [m.axis === 0 ? 1 : 0, m.axis === 1 ? 1 : 0, m.axis === 2 ? 1 : 0] ).normalize();
    const d0       = Math.max( 1, Math.hypot( m.x0 - px, m.y0 - py ) );
    let factor     = Math.hypot( this.ed.mouse.x - px, this.ed.mouse.y - py ) / d0;
    if ( e.ctrlKey ) factor = Math.round( factor * 10 ) / 10;
    if ( !Number.isNaN( typed ) ) factor = typed;
    let apply: ( w: THREE.Vector3 ) => THREE.Vector3 = ( w ) => w;
    if ( m.op === "g" ) {
      let delta: THREE.Vector3;
      if ( dir ) {
        let t = this.alongLine( this.ed.mouse.x, this.ed.mouse.y, m.pivot, dir ) - this.alongLine( m.x0, m.y0, m.pivot, dir );
        if ( e.ctrlKey ) t = Math.round( t * 10 ) / 10;
        if ( !Number.isNaN( typed ) ) t = typed;
        delta = dir.clone().multiplyScalar( t );
      } else {
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint( this.ed.view.camera.getWorldDirection( new THREE.Vector3() ), m.pivot );
        const a     = this.ed.view.ray( m.x0, m.y0 ).ray.intersectPlane( plane, new THREE.Vector3() ), b = this.ed.view.ray( this.ed.mouse.x, this.ed.mouse.y ).ray.intersectPlane( plane, new THREE.Vector3() );
        delta       = a && b ? b.sub( a ) : new THREE.Vector3();
        if ( e.ctrlKey ) delta.set( Math.round( delta.x * 10 ) / 10, Math.round( delta.y * 10 ) / 10, Math.round( delta.z * 10 ) / 10 );
      }
      apply              = ( w ) => w.add( delta );
      this.ed.statusText = `${m.label}: ${toUnity( delta ).map( ( v ) => v.toFixed( 3 ) ).join( ", " )}${m.axis !== null ? ` along ${"XYZ"[m.axis]}` : ""}`;
    } else if ( m.op === "r" ) {
      let deg       = THREE.MathUtils.radToDeg( Math.atan2( this.ed.mouse.y - py, this.ed.mouse.x - px ) - Math.atan2( m.y0 - py, m.x0 - px ) );
      const viewDir = this.ed.view.camera.getWorldDirection( new THREE.Vector3() );
      const axis    = dir ?? viewDir.clone().negate();
      if ( axis.dot( viewDir ) > 0 ) deg = -deg;
      deg = -deg;
      if ( e.ctrlKey ) deg = Math.round( deg / 5 ) * 5;
      if ( !Number.isNaN( typed ) ) deg = typed;
      const q            = new THREE.Quaternion().setFromAxisAngle( axis, THREE.MathUtils.degToRad( deg ) );
      apply              = ( w ) => w.sub( m.pivot ).applyQuaternion( q ).add( m.pivot );
      this.ed.statusText = `Rotate: ${deg.toFixed( 1 )}°`;
    } else if ( m.op === "s" ) {
      apply              = dir ? ( w ) => w.add( dir.clone().multiplyScalar( w.clone().sub( m.pivot ).dot( dir ) * ( factor - 1 ) ) ) : ( w ) => w.sub( m.pivot ).multiplyScalar( factor ).add( m.pivot );
      this.ed.statusText = `Scale: ${factor.toFixed( 3 )}`;
    } else this.ed.statusText = `Size: ${factor.toFixed( 3 )}`;
    for ( const id of this.ed.sel ) {
      const [s, i] = parse( id );
      const q      = c.splines[s].points[i], q0 = c0.splines[s].points[i];
      if ( m.op === "radius" ) q.r = Math.max( 0.05, q0.r * factor );
      else q.p = toUnity( apply( toThree( q0.p ).applyMatrix4( M ) ).applyMatrix4( Minv ) );
    }
    this.ed.setCurve( c, null );
  }
}
