// Edit Mode on a curve piece ( Blender's curve editing ): its control points and the path through them drawn over it;
// click / Shift / box to select, A / Alt+A; G / R / S with X / Y / Z and typed numbers; E extrudes a new point from an
// end, Ctrl+click adds one at the cursor; Alt+S sizes the tube at the points, V makes them sharp ( a kink ) or smooth;
// Alt+C closes or opens a spline; X deletes; Subdivide ( right-click ) adds points between selected neighbours. Each
// kept change is one undo step.

import { cameraPosition, float, instancedBufferAttribute, positionLocal } from "three/tsl";
import * as THREE from "three/webgpu";
import { toThree, toUnity } from "../../../core/coords";
import { pieceMatrix } from "../../../core/transform";
import type { CustomObjectEntry } from "../../../core/types";
import { useEditor } from "../../../map/store";
import type { ModelData } from "../../../model/build";
import { samplePath, type CurveData, type CurvePoint } from "../../../model/curve";
import type { V3 } from "../../../model/mesh";
import { withModel } from "../../../model/objects";
import { CurveOperators } from "./operators";
import { CurveTransforms } from "./transforms";
import type { EditView } from "../model/modelEditor";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TslNode = any;
export const pull   = ( p: TslNode ): TslNode => p.add( cameraPosition.sub( p ).mul( 0.0025 ) );
const SELECTED      = new THREE.Color( 0xffa033 ), PLAIN = new THREE.Color( 0x101010 ), SHARP = new THREE.Color( 0x3a6df0 );

// A point: its spline and place in it.
export type Id     = string;
export const idOf  = ( s:  number, i: number ): Id => `${s}:${i}`;
export const parse = ( id: Id ) => id.split( ":" ).map( Number ) as [number, number];

export type Modal =
  | { kind: "transform"; op: "g" | "r" | "s" | "radius"; o0: CustomObjectEntry; base: CurveData; pivot: THREE.Vector3; x0: number; y0: number; axis: 0 | 1 | 2 | null; typed: string; label: string }
  | { kind: "box";       x0: number; y0: number; extend: boolean };

export class CurveEditor {
  // its parts, each in a file of its own beside this one
  readonly ops        = new CurveOperators( this );  // the curve's operators
  readonly transforms = new CurveTransforms( this ); // grab, Rotate, Scale and radius

  readonly group      = new THREE.Group();
  uid: string | null  = null;
  sel                 = new Set<Id>();
  modal: Modal | null = null;
  mouse               = { x: 0, y: 0 };
  private lines: THREE.LineSegments;
  private dots:  THREE.Sprite;
  boxRect: [number, number, number, number] | null = null;
  statusText = "";

  constructor( readonly view: EditView, readonly ground: ( x: number, y: number ) => THREE.Vector3 | null ) {
    const lineMat        = new THREE.LineBasicNodeMaterial( { vertexColors: true, transparent: true, depthTest: false } );
    lineMat.positionNode = pull( positionLocal );
    this.lines           = new THREE.LineSegments( new THREE.BufferGeometry(), lineMat );
    const pos            = new THREE.InstancedBufferAttribute( new Float32Array( 3 * 256 ), 3 ), col = new THREE.InstancedBufferAttribute( new Float32Array( 3 * 256 ), 3 );
    const dotMat         = new THREE.PointsNodeMaterial( { sizeAttenuation: false, depthTest: false } );
    dotMat.positionNode  = pull( instancedBufferAttribute( pos ) );
    dotMat.colorNode     = instancedBufferAttribute( col ) as TslNode;
    dotMat.sizeNode      = float( 9 );
    this.dots            = new THREE.Sprite( dotMat );
    this.dots.count      = 0;
    this.dots.userData   = { pos, col };
    for ( const o of [this.lines, this.dots] ) {
      o.frustumCulled = false;
      o.renderOrder   = 21;
      this.group.add( o );
    }
    this.group.visible = false;
  }

  // ---------------------------------------------------------------- the piece

  obj(): ( CustomObjectEntry & { model: ModelData & { curve: CurveData } } ) | null {
    const o = useEditor.getState().customObjects.find( ( x ) => x.uid === this.uid );
    return o?.model?.curve ? ( o as CustomObjectEntry & { model: ModelData & { curve: CurveData } } ) : null;
  }
  matrix( o: CustomObjectEntry ) {
    return pieceMatrix( o );
  }
  world( o: CustomObjectEntry, p: V3, M = this.matrix( o ) ) {
    return toThree( p ).applyMatrix4( M );
  }
  toPiece( o: CustomObjectEntry, w: THREE.Vector3 ): V3 {
    return toUnity( w.clone().applyMatrix4( this.matrix( o ).invert() ) );
  }
  private points( c: CurveData ) {
    const out: { id: Id; q: CurvePoint }[] = [];
    c.splines.forEach( ( s, si ) => s.points.forEach( ( q, i ) => out.push( { id: idOf( si, i ), q } ) ) );
    return out;
  }

  enter( uid: string ) {
    this.uid           = uid;
    this.sel           = new Set();
    this.modal         = null;
    this.group.visible = true;
    this.publish();
    this.sync();
  }
  exit() {
    if ( this.modal ) this.cancel();
    this.uid           = null;
    this.group.visible = false;
    useEditor.setState( { modelEdit: null } );
  }
  private publish() {
    const o = this.obj();
    if ( !o ) return;
    useEditor.setState( { modelEdit: { uid: o.uid, mode: "vert", verts: this.sel.size, edges: 0, faces: 0, status: this.modal ? this.statusText : "" } } );
  }

  /**
   * Redraws the points and the path.
  **/
  sync() {
    const o = this.obj();
    if ( !o ) {
      if ( this.uid ) this.exit();
      return;
    }
    const c = o.model.curve, M = this.matrix( o );
    for ( const id of this.sel ) {
      const [s, i] = parse( id );
      if ( !c.splines[s]?.points[i] ) this.sel.delete( id );
    }
    const lp: number[] = [], lc: number[] = [];
    const seg          = ( a: THREE.Vector3, b: THREE.Vector3, col: THREE.Color ) => {
      lp.push( a.x,   a.y,   a.z,   b.x,   b.y,   b.z   );
      lc.push( col.r, col.g, col.b, col.r, col.g, col.b );
    };
    const pathCol = new THREE.Color( 0xd8d8d8 ), handleCol = new THREE.Color( 0x707070 );
    c.splines.forEach( ( s ) => {
      const path = samplePath( s, c.resolution ).map( ( q ) => this.world( o, q.p, M ) );
      for ( let i = 0; i + 1 < path.length; i++ ) seg( path[i], path[i + 1], pathCol );
      if ( s.closed && path.length > 2 ) seg( path[path.length - 1], path[0], pathCol );
      const W = s.points.map( ( q ) => this.world( o, q.p, M ) );
      for ( let i = 0; i + 1 < W.length; i++ ) seg( W[i], W[i + 1], handleCol );
    } );
    const g = new THREE.BufferGeometry();
    g.setAttribute( "position", new THREE.Float32BufferAttribute( lp, 3 ) );
    g.setAttribute( "color",    new THREE.Float32BufferAttribute( lc, 3 ) );
    this.lines.geometry.dispose();
    this.lines.geometry = g;
    const pts           = this.points( c );
    let { pos, col }    = this.dots.userData as { pos: THREE.InstancedBufferAttribute; col: THREE.InstancedBufferAttribute };
    if ( pos.count < pts.length ) {
      pos                = new THREE.InstancedBufferAttribute( new Float32Array( pts.length * 6 ), 3 );
      col                = new THREE.InstancedBufferAttribute( new Float32Array( pts.length * 6 ), 3 );
      const mat          = this.dots.material as THREE.PointsNodeMaterial;
      mat.positionNode   = pull( instancedBufferAttribute( pos ) );
      mat.colorNode      = instancedBufferAttribute( col ) as TslNode;
      mat.needsUpdate    = true;
      this.dots.userData = { pos, col };
    }
    pts.forEach( ( { id, q }, k ) => {
      const w = this.world( o, q.p, M ), cc = this.sel.has( id ) ? SELECTED : q.sharp ? SHARP : PLAIN;
      pos.setXYZ( k, w.x,  w.y,  w.z  );
      col.setXYZ( k, cc.r, cc.g, cc.b );
    } );
    pos.needsUpdate = col.needsUpdate = true;
    this.dots.count = pts.length;
  }

  setCurve( curve: CurveData, label: string | null, o0?: CustomObjectEntry ) {
    const st = useEditor.getState(), o = this.obj();
    if ( !o ) return;
    if ( label ) {
      if ( o0 ) useEditor.setState( { customObjects: st.customObjects.map( ( x ) => ( x.uid === o.uid ? o0 : x ) ) } );
      st.updateCustom( label, [o.uid], ( x ) => withModel( x, { ...x.model!, curve } ) );
    } else useEditor.setState( { customObjects: st.customObjects.map( ( x ) => ( x.uid === o.uid ? { ...o, model: { ...o.model, curve } } : x ) ) } );
    this.sync();
    this.publish();
  }
  clone( c: CurveData ): CurveData {
    return { ...c, splines: c.splines.map( ( s ) => ( { closed: s.closed, points: s.points.map( ( q ) => ( { ...q, p: [...q.p] as V3 } ) ) } ) ) };
  }

  // ---------------------------------------------------------------- picking

  screen( p: THREE.Vector3 ): [number, number, number] {
    const v = p.clone().project( this.view.camera );
    return [( v.x * 0.5 + 0.5 ) * this.view.host.clientWidth, ( -v.y * 0.5 + 0.5 ) * this.view.host.clientHeight, v.z];
  }
  private pick( x: number, y: number ): Id | null {
    const o = this.obj();
    if ( !o ) return null;
    const M                                = this.matrix( o );
    let best: { id: Id; d: number } | null = null;
    for ( const { id, q } of this.points( o.model.curve ) ) {
      const [sx, sy, z] = this.screen( this.world( o, q.p, M ) );
      const d           = Math.hypot( sx - x, sy - y );
      if ( z <= 1 && d < 14 && ( !best || d < best.d ) ) best = { id, d };
    }
    return best?.id ?? null;
  }

  // ---------------------------------------------------------------- pointer

  down( e: PointerEvent, x: number, y: number ): boolean {
    this.mouse = { x, y };
    const m    = this.modal;
    if ( m ) {
      if ( e.button === 2 ) this.cancel();
      else if ( e.button === 0 ) this.keep();
      return true;
    }
    if ( e.button  !== 0 ) return false;
    // Ctrl+click: a new point at the cursor, after the selected end
    if ( e.ctrlKey ) return this.ops.addAtCursor( x, y ), true;
    const id = this.pick( x, y );
    if ( id === null ) {
      this.modal = { kind: "box", x0: x, y0: y, extend: e.shiftKey };
      return true;
    }
    if ( e.shiftKey ) this.sel.has( id ) ? this.sel.delete( id ) : this.sel.add( id );
    else this.sel = new Set( [id] );
    this.sync();
    this.publish();
    return true;
  }

  move( e: PointerEvent, x: number, y: number ): boolean {
    this.mouse = { x, y };
    const m    = this.modal;
    if ( !m ) return false;
    if ( m.kind === "box" ) this.boxRect = [Math.min( m.x0, x ), Math.min( m.y0, y ), Math.max( m.x0, x ), Math.max( m.y0, y )];
    else this.transforms.runTransform( e );
    return true;
  }

  up( e: PointerEvent, x: number, y: number ): boolean {
    const m = this.modal;
    if ( m?.kind !== "box" || e.button !== 0 ) return false;
    this.modal   = null;
    this.boxRect = null;
    const o      = this.obj();
    if ( !o ) return true;
    if ( Math.hypot( x - m.x0, y - m.y0 ) < 4 ) {
      if ( !m.extend ) this.sel.clear();
    } else {
      const [x0, y0, x1, y1] = [Math.min( m.x0, x ), Math.min( m.y0, y ), Math.max( m.x0, x ), Math.max( m.y0, y )];
      if ( !m.extend ) this.sel.clear();
      const M = this.matrix( o );
      for ( const { id, q } of this.points( o.model.curve ) ) {
        const [sx, sy, z] = this.screen( this.world( o, q.p, M ) );
        if ( z <= 1 && sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 ) this.sel.add( id );
      }
    }
    this.sync();
    this.publish();
    return true;
  }

  // ---------------------------------------------------------------- keys

  /**
   * The right-click menu ( the view asks either Edit Mode for it ).
  **/
  contextMenu() {
    this.ops.contextMenu();
  }

  key( e: KeyboardEvent ): boolean {
    const k = e.key.toLowerCase(), m = this.modal;
    if ( m ) {
      if ( k === "escape" ) return this.cancel(), true;
      if ( k === "enter"  ) return this.keep(),   true;
      if ( m.kind === "transform" ) {
        if ( k === "x" || k === "y" || k === "z" ) {
          const axis = ( ["x", "y", "z"] as const ).indexOf( k ) as 0 | 1 | 2;
          m.axis     = m.axis === axis ? null : axis;
          this.transforms.runTransform( e );
        } else if ( /^[0-9.-]$/.test( e.key ) ) {
          m.typed += e.key;
          this.transforms.runTransform( e );
        } else if ( k === "backspace" ) {
          m.typed = m.typed.slice( 0, -1 );
          this.transforms.runTransform( e );
        }
      }
      return true;
    }
    const o = this.obj();
    if ( !o ) return false;
    const c = o.model.curve;
    if ( k === "a" && e.altKey   ) return ( this.sel.clear(), this.sync(), this.publish() ), true;
    if ( k === "a" && !e.ctrlKey ) return ( this.sel = new Set( this.points( c ).map( ( p ) => p.id ) ), this.sync(), this.publish() ), true;
    if ( k === "s" && e.altKey ) return this.transforms.start( "radius" ), true;
    if ( k === "c" && e.altKey ) return this.ops.toggleClosed(), true;
    if ( e.ctrlKey || e.altKey ) return false;
    if ( k === "g" || k === "r" || k === "s" ) return this.transforms.start( k ), true;
    if ( k === "e" ) return this.ops.extrude(), true;
    if ( k === "v" ) return this.ops.sharpMenu(), true;
    if ( k === "x" || k === "delete" ) return this.ops.remove(), true;
    return false;
  }

  keep() {
    const m = this.modal;
    if ( !m || m.kind === "box" ) return;
    this.modal      = null;
    this.statusText = "";
    const o         = this.obj();
    if ( o ) this.setCurve( o.model.curve, m.label, m.o0 );
  }

  cancel() {
    const m         = this.modal;
    this.modal      = null;
    this.boxRect    = null;
    this.statusText = "";
    if ( m?.kind === "transform" ) {
      const st = useEditor.getState();
      useEditor.setState( { customObjects: st.customObjects.map( ( x ) => ( x.uid === m.o0.uid ? m.o0 : x ) ) } );
    }
    this.sync();
    this.publish();
  }

  /**
   * Shift+A in Edit Mode: a new two-point spline at a point of the piece.
  **/
  addSpline( at: THREE.Vector3 ) {
    const o = this.obj();
    if ( !o ) return;
    const c = this.clone( o.model.curve ), p = this.toPiece( o, at );
    c.splines.push( { closed: false, points: [{ p, r: 1, sharp: false }, { p: [p[0] + 1, p[1], p[2]], r: 1, sharp: false }] } );
    this.sel = new Set( [idOf( c.splines.length - 1, 0 ), idOf( c.splines.length - 1, 1 )] );
    this.setCurve( c, "Add spline" );
  }
}

