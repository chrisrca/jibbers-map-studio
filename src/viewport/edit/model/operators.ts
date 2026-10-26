// Edit Mode's modal operators ( Blender's ): Grab / Rotate / Scale, Spin, Extrude, Inset and Bevel, worked out as the
// mouse moves, with typed numbers and axis locks.

import * as THREE from "three/webgpu";
import { toThree, toUnity } from "../../../core/coords";
import type { CustomObjectEntry } from "../../../core/types";
import { useEditor } from "../../../map/store";
import { bevel } from "../../../model/bevel";
import { edgesOf, type Mesh, type V3 } from "../../../model/mesh";
import { selectedGroups, extrudeEdges, extrudeFaces, extrudeVerts, inset, selFromEdges, selFromVerts, spin } from "../../../model/ops";
import type { ModelEditor } from "./modelEditor";
import { Modal } from "./modelEditor";

// Edit Mode's modal operators.
export class ModelOperators {
  constructor( private ed: ModelEditor ) {}

  /**
   * Blender's G / R / S on the selection ( `label`: an operator it finishes, like Extrude ).
  **/
  startTransform( op: "g" | "r" | "s", label?: string, o0?: CustomObjectEntry, dir?: THREE.Vector3, pre?: Mesh ) {
    const o = this.ed.obj();
    if ( !o || !this.ed.sel.v.size ) return;
    this.ed.modal = {
      kind: "transform", op, o0: o0 ?? o, verts: [...this.ed.sel.v], pivot: useEditor.getState().modelTools.pivot === "cursor" ? toThree( useEditor.getState().cursor3d ) : this.ed.gizmo.pivotOf( o, this.ed.sel.v ), x0: this.ed.mouse.x, y0: this.ed.mouse.y,
      axis: null,        local: false, dir: dir ?? null, typed: "", label: label ?? { g: "Move", r: "Rotate", s: "Scale" }[op], pre,
      vx:         this.ed.mouse.x, vy: this.ed.mouse.y, lx: this.ed.mouse.x, ly: this.ed.mouse.y,
      propRadius: useEditor.getState().modelTools.propRadius,
    };
    this.ed.publish();
  }

  private axisDir( m: Extract<Modal, { kind: "transform" }> ): THREE.Vector3 | null {
    if ( m.dir  && m.axis === null ) return m.dir;
    if ( m.axis === null ) return null;
    const u: V3 = [0, 0, 0];
    u[m.axis]   = 1;
    const d     = toThree( u );
    if ( m.local ) d.applyQuaternion( new THREE.Quaternion().setFromRotationMatrix( this.ed.matrix( m.o0 ) ) );
    return d.normalize();
  }

  /**
   * Metres a screen pixel covers at a point.
  **/
  mpp( p: THREE.Vector3 ) {
    const cam = this.ed.view.camera;
    return ( 2 * Math.tan( THREE.MathUtils.degToRad( cam.fov ) / 2 ) * p.distanceTo( cam.position ) ) / this.ed.view.host.clientHeight;
  }

  /**
   * Where the mouse ray meets a line ( its parameter along it ).
  **/
  private alongLine( x: number, y: number, origin: THREE.Vector3, dir: THREE.Vector3 ) {
    const r   = this.ed.view.ray( x, y ).ray;
    const w0  = origin.clone().sub( r.origin ), b = dir.dot( r.direction ), d = dir.dot( w0 ), e = r.direction.dot( w0 );
    const den = 1 - b * b;
    return den > 1e-6 ? ( b * e - d ) / den : 0;
  }

  runTransform( e: { ctrlKey?: boolean; shiftKey?: boolean } ) {
    const m = this.ed.modal;
    if ( m?.kind !== "transform" ) return;
    const o = this.ed.obj();
    if ( !o ) return;
    const tools    = useEditor.getState().modelTools;
    // Shift: the pointer counts a tenth as far, from where it is when it's pressed
    const k        = e.shiftKey ? 0.1 : 1;
    m.vx          += ( this.ed.mouse.x - m.lx ) * k;
    m.vy          += ( this.ed.mouse.y - m.ly ) * k;
    m.lx           = this.ed.mouse.x;
    m.ly           = this.ed.mouse.y;
    const mx       = m.vx, my = m.vy;
    const base     = m.pre ?? m.o0.model!.mesh;
    const M        = this.ed.matrix( m.o0 ), Minv = M.clone().invert();
    const typed    = m.typed && m.typed !== "-" && m.typed !== "." ? parseFloat( m.typed ) : NaN;
    const dir      = this.axisDir( m );
    const start    = new Map( m.verts.map( ( v ) => [v, toThree( base.v[v] ).applyMatrix4( M )] ) );
    // snapping: the magnet's setting, Ctrl turning it the other way while held
    const snapping = tools.snap !== !!e.ctrlKey;
    const g: Mesh  = { ...base, v: base.v.map( ( p ) => [...p] as V3 ) };
    let status     = "";
    if ( m.op === "slide" ) {
      // Edge / Vertex Slide: each vertex along its edge to an unselected neighbour, the one that goes the way the
      // mouse does on the screen, by the same fraction of its length
      const moving = new Set( m.verts ), nb = new Map<number, number[]>();
      for ( const ed of edgesOf( base ).values() ) {
        if ( moving.has( ed.a ) && !moving.has( ed.b ) ) ( nb.get( ed.a ) ?? nb.set( ed.a, [] ).get( ed.a )! ).push( ed.b );
        if ( moving.has( ed.b ) && !moving.has( ed.a ) ) ( nb.get( ed.b ) ?? nb.set( ed.b, [] ).get( ed.b )! ).push( ed.a );
      }
      const md  = new THREE.Vector2( mx - m.x0, my - m.y0 );
      let shown = 0;
      for ( const v of m.verts ) {
        const P = start.get( v )!, [sx, sy] = this.ed.picking.screen( P );
        let best: { to: THREE.Vector3; t: number; score: number } | null = null;
        for ( const n of nb.get( v ) ?? [] ) {
          const T  = toThree( base.v[n] ).applyMatrix4( M ), [tx, ty] = this.ed.picking.screen( T );
          const sd = new THREE.Vector2( tx - sx, ty - sy ), l = sd.length();
          if ( l < 1e-3 ) continue;
          const score = md.dot( sd ) / l;
          if ( !best || score > best.score ) best = { to: T, t: Math.max( 0, Math.min( 1, score / l ) ), score };
        }
        if ( !best ) continue;
        const t = !Number.isNaN( typed ) ? Math.max( 0, Math.min( 1, typed ) ) : best.t;
        shown   = t;
        g.v[v]  = toUnity( P.clone().lerp( best.to, t ).applyMatrix4( Minv ) );
      }
      this.ed.statusText = `Slide: ${shown.toFixed( 3 )}${m.typed ? `  [${m.typed}]` : ""}`;
      this.ed.setMesh( g, null );
      return;
    }
    // what turns and scales round what: one pivot, or each group of selected vertices its own
    const groups: number[][] = tools.pivot === "individual" ? selectedGroups( base, selFromVerts( base, m.verts ) ) : [m.verts];
    const pivotOf            = ( vs: number[] ) => {
      if ( tools.pivot === "cursor" ) return toThree( useEditor.getState().cursor3d );
      if ( tools.pivot === "bounds" ) {
        const b = new THREE.Box3();
        for ( const v of vs ) b.expandByPoint( start.get( v )! );
        return b.getCenter( new THREE.Vector3() );
      }
      if ( tools.pivot === "active" && typeof this.ed.active === "number" && this.ed.mode === "vert" && start.has( this.ed.active ) ) return start.get( this.ed.active )!.clone();
      return vs.reduce( ( c, v ) => c.add( start.get( v )! ), new THREE.Vector3() ).divideScalar( Math.max( 1, vs.length ) );
    };
    const [px, py] = this.ed.picking.screen( m.pivot );
    // the grid's step where the pivot is ( a dozen or so pixels long ), a tenth with Shift
    const step     = Math.pow( 10, Math.ceil( Math.log10( this.mpp( m.pivot ) * 14 ) ) ) * ( e.shiftKey ? 0.1 : 1 );
    let applyAt: ( w: THREE.Vector3, pivot: THREE.Vector3 ) => THREE.Vector3;
    if ( m.op === "g" ) {
      let delta: THREE.Vector3;
      if ( dir ) {
        let t = this.alongLine( mx, my, m.pivot, dir ) - this.alongLine( m.x0, m.y0, m.pivot, dir );
        if ( snapping && tools.snapTo === "increment" ) t = Math.round( t / step ) * step;
        if ( !Number.isNaN( typed ) ) t = typed;
        delta  = dir.clone().multiplyScalar( t );
        status = `D: ${t.toFixed( 3 )} m`;
      } else {
        // across the view, at the pivot's depth
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint( this.ed.view.camera.getWorldDirection( new THREE.Vector3() ), m.pivot );
        const a     = this.ed.view.ray( m.x0, m.y0 ).ray.intersectPlane( plane, new THREE.Vector3() ), b = this.ed.view.ray( mx, my ).ray.intersectPlane( plane, new THREE.Vector3() );
        delta       = a && b ? b.sub( a ) : new THREE.Vector3();
        if ( snapping && tools.snapTo === "increment" ) delta.set( Math.round( delta.x / step ) * step, Math.round( delta.y / step ) * step, Math.round( delta.z / step ) * step );
        if ( !Number.isNaN( typed ) ) delta = toThree( [typed, 0, 0] );
      }
      // onto a vertex or a surface: the selected vertex nearest it lands there
      if ( snapping && tools.snapTo !== "increment" && Number.isNaN( typed ) ) {
        const target = tools.snapTo === "vertex" ? this.vertexUnder( this.ed.mouse.x, this.ed.mouse.y, new Set( m.verts ) ) : this.ed.view.surfaceAt?.( this.ed.mouse.x, this.ed.mouse.y, o.uid ) ?? null;
        if ( target ) {
          let src = start.get( m.verts[0] )!, bd = Infinity;
          for ( const P of start.values() ) {
            const d2 = P.distanceToSquared( target );
            if ( d2 < bd ) { bd = d2; src = P; }
          }
          delta = target.clone().sub( src );
          if ( dir ) delta = dir.clone().multiplyScalar( delta.dot( dir ) );
          status = `snapped to ${tools.snapTo}  `;
        }
      }
      const u = toUnity( delta );
      // ( on Blender's axes )
      status += `D: ${+u[0].toFixed( 4 )} m  ${+u[2].toFixed( 4 )} m  ${+u[1].toFixed( 4 )} m (${+delta.length().toFixed( 4 )} m)`;
      applyAt = ( w ) => w.add( delta );
    } else if ( m.op === "r" ) {
      let ang       = Math.atan2( my - py, mx - px ) - Math.atan2( m.y0 - py, m.x0 - px );
      const viewDir = this.ed.view.camera.getWorldDirection( new THREE.Vector3() );
      const axis    = dir ?? viewDir.clone().negate();
      // turning the way the mouse goes round, seen from the camera
      if ( axis.dot( viewDir ) > 0 ) ang = -ang;
      let deg = THREE.MathUtils.radToDeg( -ang );
      if ( snapping ) deg = Math.round( deg / ( e.shiftKey ? 1 : 5 ) ) * ( e.shiftKey ? 1 : 5 );
      if ( !Number.isNaN( typed ) ) deg = typed;
      const q = new THREE.Quaternion().setFromAxisAngle( axis, THREE.MathUtils.degToRad( deg ) );
      applyAt = ( w, pv ) => w.sub( pv ).applyQuaternion( q ).add( pv );
      status  = `Rotation: ${deg.toFixed( 2 )}°`;
    } else {
      const d0 = Math.max( 1, Math.hypot( m.x0 - px, m.y0 - py ) );
      let sc   = Math.hypot( mx - px, my - py ) / d0;
      if ( snapping ) sc = Math.round( sc / ( e.shiftKey ? 0.01 : 0.1 ) ) * ( e.shiftKey ? 0.01 : 0.1 );
      if ( !Number.isNaN( typed ) ) sc = typed;
      applyAt = dir
        ? ( w, pv ) => w.add( dir.clone().multiplyScalar( w.clone().sub( pv ).dot( dir ) * ( sc - 1 ) ) )
        : ( w, pv ) => w.sub( pv ).multiplyScalar( sc ).add( pv );
      status = `Scale: ${sc.toFixed( 4 )}`;
    }
    for ( const grp of groups ) {
      const pv = pivotOf( grp );
      for ( const v of grp ) g.v[v] = toUnity( applyAt( start.get( v )!.clone(), pv ).applyMatrix4( Minv ) );
    }
    // proportional editing: the vertices near the selection go part of the way, smoothly less further off
    if ( tools.proportional ) {
      const R = m.propRadius, moving = new Set( m.verts ), pv = pivotOf( m.verts );
      base.v.forEach( ( p, i ) => {
        if ( moving.has( i ) ) return;
        const P  = toThree( p ).applyMatrix4( M );
        let dmin = Infinity;
        for ( const S of start.values() ) dmin = Math.min( dmin, P.distanceTo( S ) );
        if ( dmin >= R ) return;
        const t  = 1 - dmin / R, w = t * t * ( 3 - 2 * t );
        const to = applyAt( P.clone(), pv );
        g.v[i]   = toUnity( P.clone().lerp( to, w ).applyMatrix4( Minv ) );
      } );
      status += `  proportional ${R.toFixed( 2 )} m (scroll)`;
    }
    // ( Blender's letter for the game's axis )
    const ax           = m.axis === null ? ( m.dir ? " along normal" : "" ) : ` along ${m.local ? "local" : "global"} ${"XZY"[m.axis]}`;
    this.ed.statusText = `${m.label}: ${status}${ax}${m.typed ? `  [${m.typed}]` : ""}`;
    this.ed.setMesh( g, null );
  }

  /**
   * The nearest vertex on the screen to a point ( of this piece, not moving, or of another modelled piece ).
  **/
  vertexUnder( x: number, y: number, skip: Set<number> ): THREE.Vector3 | null {
    const st                       = useEditor.getState();
    let best: THREE.Vector3 | null = null, bd = 20;
    for ( const o of st.customObjects ) {
      if ( !o.model ) continue;
      const M = this.ed.matrix( o ), mine = o.uid === this.ed.uid;
      o.model.mesh.v.forEach( ( p, i ) => {
        if ( mine && skip.has( i ) ) return;
        const w = toThree( p ).applyMatrix4( M ), [sx, sy, z] = this.ed.picking.screen( w );
        const d = Math.hypot( sx - x, sy - y );
        if ( z <= 1 && d < bd ) { bd = d; best = w; }
      } );
    }
    return best;
  }

  /**
   * Spin: the selection swept round an axis through the piece's origin ( Y unless X or Z is pressed ); the mouse
   * sideways takes from a whole turn ( Ctrl: 15° steps ), the wheel or + / − sets the steps, a typed angle is used as is.
  **/
  startSpin() {
    const o = this.ed.obj();
    if ( !o || !this.ed.sel.v.size ) return;
    this.ed.modal = { kind: "spin", o0: o, mesh0: o.model.mesh, sel0: this.ed.sel, axis: 1, steps: 12, x0: this.ed.mouse.x, typed: "" };
    this.runSpin( {} as PointerEvent );
  }

  runSpin( e: { ctrlKey?: boolean } ) {
    const m = this.ed.modal;
    if ( m?.kind !== "spin" ) return;
    let deg = Math.max( -360, Math.min( 360, 360 - ( m.x0 - this.ed.mouse.x ) * 0.5 ) );
    if ( e.ctrlKey ) deg = Math.round( deg / 15 ) * 15;
    if ( m.typed   && !Number.isNaN( parseFloat( m.typed ) ) ) deg = parseFloat( m.typed );
    const axis: V3     = [0, 0, 0];
    axis[m.axis]       = 1;
    const r            = Math.abs( deg ) < 1e-6 ? { mesh: m.mesh0, sel: m.sel0 } : spin( m.mesh0, m.sel0, [0, 0, 0], axis, ( deg * Math.PI ) / 180, m.steps );
    this.ed.sel        = r.sel;
    this.ed.statusText = `Spin: ${Math.round( deg * 10 ) / 10}° · ${m.steps} steps (scroll) · axis ${"XYZ"[m.axis]}${m.typed ? `  [${m.typed}]` : ""}`;
    this.ed.setMesh( r.mesh, null );
  }

  /**
   * E: extrude what's selected, then move it ( faces along their normal ).
  **/
  extrude() {
    const o = this.ed.obj();
    if ( !o ) return;
    const g = o.model.mesh;
    const M = this.ed.matrix( o );
    if ( this.ed.mode === "face" || ( this.ed.sel.f.size && this.ed.mode !== "vert" ) ) {
      if ( !this.ed.sel.f.size ) return;
      const r     = extrudeFaces( g, this.ed.sel.f );
      this.ed.sel = r.sel;
      const n     = toThree( r.normal ).transformDirection( M );
      this.ed.setMesh( r.mesh, null );
      this.startTransform( "g", "Extrude", o, n, r.mesh );
      return;
    }
    if ( this.ed.sel.f.size ) {
      const r     = extrudeFaces( g, this.ed.sel.f );
      this.ed.sel = r.sel;
      this.ed.setMesh( r.mesh, null );
      this.startTransform( "g", "Extrude", o, toThree( r.normal ).transformDirection( M ), r.mesh );
      return;
    }
    const r = this.ed.sel.e.size ? extrudeEdges( g, this.ed.sel.e ) : extrudeVerts( g, this.ed.sel.v );
    if ( !r.sel.v.size ) return;
    this.ed.sel = r.sel;
    this.ed.setMesh( r.mesh, null );
    this.startTransform( "g", "Extrude", o, undefined, r.mesh );
  }

  startInset() {
    const o = this.ed.obj();
    if ( !o || !this.ed.sel.f.size ) return;
    this.ed.modal = { kind: "inset", o0: o, mesh0: o.model.mesh, faces: new Set( this.ed.sel.f ), pivot: this.ed.gizmo.pivotOf( o, this.ed.sel.v ), x0: this.ed.mouse.x, y0: this.ed.mouse.y, typed: "", individual: false };
    this.runInset( {} as PointerEvent );
  }

  runInset( e: { ctrlKey?: boolean } ) {
    const m = this.ed.modal;
    if ( m?.kind !== "inset" ) return;
    const [px, py] = this.ed.picking.screen( m.pivot );
    const d0       = Math.hypot( m.x0 - px, m.y0 - py ), d = Math.hypot( this.ed.mouse.x - px, this.ed.mouse.y - py );
    // the mouse going in towards the middle insets further
    let t          = Math.max( 0, ( d0 - d ) * this.mpp( m.pivot ) * 0.5 + 0.0 );
    if ( e.ctrlKey ) t = Math.round( t * 100 ) / 100;
    if ( m.typed   && !Number.isNaN( parseFloat( m.typed ) ) ) t = parseFloat( m.typed );
    // ( the piece's scale: thickness in the piece's own units )
    const k            = Math.abs( m.o0.scale.x ) || 1;
    const r            = inset( m.mesh0, m.faces, t / k, 0, m.individual );
    this.ed.sel        = r.sel;
    this.ed.statusText = `Inset: thickness ${t.toFixed( 3 )} m${m.individual ? " (individual)" : ""}${m.typed ? `  [${m.typed}]` : ""}`;
    this.ed.setMesh( r.mesh, null );
  }

  startBevel() {
    const o = this.ed.obj();
    if ( !o ) return;
    const edges = new Set( this.ed.sel.e );
    if ( !edges.size ) return;
    this.ed.modal = { kind: "bevel", o0: o, mesh0: o.model.mesh, edges, pivot: this.ed.gizmo.pivotOf( o, this.ed.sel.v ), x0: this.ed.mouse.x, y0: this.ed.mouse.y, typed: "", segments: 1 };
    this.runBevel( {} as PointerEvent );
  }

  runBevel( e: { ctrlKey?: boolean } ) {
    const m = this.ed.modal;
    if ( m?.kind !== "bevel" ) return;
    const [px, py] = this.ed.picking.screen( m.pivot );
    const d0       = Math.hypot( m.x0 - px, m.y0 - py ), d = Math.hypot( this.ed.mouse.x - px, this.ed.mouse.y - py );
    let w          = Math.max( 0, ( d - d0 ) * this.mpp( m.pivot ) * 0.5 );
    if ( e.ctrlKey ) w = Math.round( w * 100 ) / 100;
    if ( m.typed   && !Number.isNaN( parseFloat( m.typed ) ) ) w = parseFloat( m.typed );
    const k            = Math.abs( m.o0.scale.x ) || 1;
    const r            = w > 0 ? bevel( m.mesh0, m.edges, w / k, m.segments ) : { mesh: m.mesh0, sel: selFromEdges( m.mesh0, [...m.edges] ) };
    this.ed.sel        = r.sel;
    this.ed.statusText = `Bevel: width ${w.toFixed( 3 )} m, ${m.segments} segment${m.segments > 1 ? "s" : ""} (scroll)${m.typed ? `  [${m.typed}]` : ""}`;
    this.ed.setMesh( r.mesh, null );
  }
}
