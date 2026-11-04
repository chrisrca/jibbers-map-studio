// Edit Mode on a modelled piece ( Blender's ): its vertices, edges and faces drawn over it, picked ( what can be seen ),
// box-selected, and edited with Blender's keys — G/R/S with X/Y/Z ( twice for the piece's own axes ) and typed
// numbers, Extrude ( E ), Inset ( I ), Bevel ( Ctrl+B ), Loop Cut ( Ctrl+R ), Fill ( F ), Merge ( M ), Delete ( X ), Duplicate
// ( Shift+D ), normals ( Alt+N ), select modes ( 1/2/3 ), all ( A / Alt+A ), linked ( L ), loops ( Alt+click ). Operators run
// live under the mouse; Enter or a click keeps the result, Esc or a right-click puts it back; each kept one is one
// undo step.

import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineSegments2 } from "three/addons/lines/webgpu/LineSegments2.js";
import { cameraPosition, float, instancedBufferAttribute } from "three/tsl";
import * as THREE from "three/webgpu";
import { toThree, toUnity } from "../../../core/coords";
import { pieceMatrix } from "../../../core/transform";
import type { CustomObjectEntry } from "../../../core/types";
import { history } from "../../../map/history";
import { useEditor } from "../../../map/store";
import type { ModelData } from "../../../model/build";
import { edgesOf, ek, faceCenter, type Mesh, type V3 } from "../../../model/mesh";
import { isModel, withModel } from "../../../model/objects";
import { edgeLoop, emptySel, faceLoop, selFromEdges, selFromFaces, selFromVerts, type Sel, type SelectMode } from "../../../model/ops";
import type { MenuItem } from "../../../ui/widgets/widgets";
import { ModelGizmo } from "./gizmo";
import { ModelKeys } from "./keys";
import { ModelKnife } from "./knife";
import { ModelLoopCut } from "./loopCut";
import { ModelMenus } from "./menus";
import { ModelOperators } from "./operators";
import { ModelPicking } from "./picking";
import { ModelToolbar } from "./toolbar";

// What the editor needs of the viewport.
export interface EditView {
  camera: THREE.PerspectiveCamera;
  host:   HTMLElement;
  ray( x: number, y: number ): THREE.Raycaster;
  // shows a menu at a screen point ( client coordinates )
  menu( x: number, y: number, title: string, items: MenuItem[] ): void;
  // the surface under a screen point ( other pieces, the ground ), for snapping
  surfaceAt?( x: number, y: number, skip: string ): THREE.Vector3 | null;
}

// ( TSL's node types are stricter than these simple expressions need )
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TslNode = any;
/**
 * A point pulled a little towards the camera, so lines and dots show on the surface they lie on.
**/
export const pull   = ( p: TslNode ): TslNode => p.add( cameraPosition.sub( p ).mul( 0.0025 ) );

export const SELECTED = new THREE.Color( 0xffa033 ), ACTIVE = new THREE.Color( 0xffffff ), PLAIN = new THREE.Color( 0x101010 ), FACE_DOT = new THREE.Color( 0x4a4a4a );
// a creased edge ( Blender's theme ), as strongly as it's creased
export const CREASE   = new THREE.Color( 0xff1ef0 );
// edges this wide ( CSS pixels, so as wide on a high-DPI screen ): a one-pixel line was lost on one
export const EDGE_WIDTH = 2;

export type Modal =
  | {
      kind:       "transform"; op: "g" | "r" | "s" | "slide"; o0: CustomObjectEntry; verts: number[]; pivot: THREE.Vector3; x0: number; y0: number;
      axis:       0 | 1 | 2 | null; local: boolean; dir: THREE.Vector3 | null; typed: string; label: string; pre?: Mesh;
      // Shift with the axis: everything but it ( the plane square to it )
      plane:      boolean;
      // the pointer as it counts ( Shift: a tenth as far ), and where the real one was
      vx:         number; vy: number; lx: number; ly: number;
      // proportional editing's reach ( metres )
      propRadius: number;
    }
  | { kind: "inset"; o0: CustomObjectEntry; mesh0: Mesh; faces: Set<number>; pivot: THREE.Vector3; x0: number; y0: number; typed: string; individual: boolean }
  | { kind: "bevel"; o0: CustomObjectEntry; mesh0: Mesh; edges: Set<string>; pivot: THREE.Vector3; x0: number; y0: number; typed: string; segments:   number  }
  | { kind: "loopcut"; cuts: number;            edge:  string | null; preview: THREE.Vector3[][] }
  | { kind: "slide";   o0:   CustomObjectEntry; mesh0: Mesh; edge: string; cuts: number; x0: number; y0: number; along: THREE.Vector2 }
  | { kind: "box";     x0:   number;            y0:    number; x1: number; y1: number; extend: boolean; subtract: boolean }
  | { kind: "spin";    o0:   CustomObjectEntry; mesh0: Mesh; sel0: Sel; axis: 0 | 1 | 2; steps: number; typed: string; centre: V3; turned: number; last: number }
  | { kind: "crease";  o0:   CustomObjectEntry; mesh0: Mesh; edges: string[]; pivot: THREE.Vector3; x0: number; y0: number; typed: string }
  | { kind: "knife";   o0:   CustomObjectEntry; pts:   KnifeHit[]; hover: KnifeHit | null; preview: THREE.Vector3[][] }
  | { kind: "drag";    o0:   CustomObjectEntry; mesh0: Mesh; x0: number; label: string; run: ( px: number ) => { mesh: Mesh; status: string } };

// What's selected, the active element and the select mode, as an undo step keeps them.
export type Picked = { sel: Sel; active: number | string | null; mode: SelectMode };

/**
 * Wide lines' geometry: segments' ends ( xyz each ) and colours ( one segment, out of sight, when there are none: the
 * material can't be made for no segments at all, and every material's made ready up front ).
**/
function edgeGeometry( pos: number[], col: number[] ) {
  return new LineSegmentsGeometry().setPositions( pos.length ? pos : [0, 0, 0, 0, 0, 0] ).setColors( col.length ? col : [0, 0, 0, 0, 0, 0] );
}

// A knife point as picked: a corner, a place on an edge ( t from a to b ), or a place inside a face ( the piece's own
// coordinates ).
export type KnifeHit = { v: number } | { a: number; b: number; t: number } | { f: number; p: V3 };

export class ModelEditor {
  // its parts, each in a file of its own beside this one
  readonly menus   = new ModelMenus( this );     // Delete, Merge, Edge, Separate, Normals, the right-click menu
  readonly ops     = new ModelOperators( this ); // Grab / Rotate / Scale, Spin, Extrude, Inset, Bevel
  readonly knife   = new ModelKnife( this );     // the Knife ( K )
  readonly loopCut = new ModelLoopCut( this );   // Loop Cut and Slide ( Ctrl+R )
  readonly picking = new ModelPicking( this );   // picking and selecting
  readonly toolbar = new ModelToolbar( this );   // the toolbar's tools
  readonly gizmo   = new ModelGizmo( this );     // the gizmo on the selection
  readonly keys    = new ModelKeys( this );      // Edit Mode's keys

  readonly group                     = new THREE.Group();
  uid:    string     | null          = null;
  mode:   SelectMode                 = "vert";
  sel:    Sel                        = emptySel();
  // the last picked element ( Blender's active )
  active: number     | string | null = null;
  // faces hidden ( H ): not drawn over, picked or in the way; their vertices and edges too, unless another face shows them
  hidden                             = new Set<number>();
  shown( g: Mesh ) {
    const v = new Set<number>(), e = new Set<string>();
    g.f.forEach( ( f, fi ) => {
      if ( this.hidden.has( fi ) ) return;
      for ( let i = 0; i < f.length; i++ ) {
        v.add( f[i] );
        e.add( ek( f[i], f[( i + 1 ) % f.length] ) );
      }
    } );
    for ( const [a, b] of g.w ) { v.add( a ); v.add( b ); e.add( ek( a, b ) ); }
    g.v.forEach( ( _, i ) => !g.f.length && v.add( i ) );
    return { v, e };
  }
  modal: Modal | null = null;
  mouse               = { x: 0, y: 0 };
  private lines:   LineSegments2;
  private dots:    THREE.Sprite;
  private faces:   THREE.Mesh;
  private preview: THREE.LineSegments;
  // the box being dragged ( screen ), drawn by the viewport's overlay
  boxRect: [number, number, number, number] | null = null;

  constructor( readonly view: EditView ) {
    // ( drawn as thin quads, nudged towards the camera so they show on the faces they lie on )
    const lineMat               = new THREE.Line2NodeMaterial( { vertexColors: true, depthTest: true, linewidth: EDGE_WIDTH } );
    lineMat.polygonOffset       = true;
    lineMat.polygonOffsetFactor = -2;
    lineMat.polygonOffsetUnits  = -4;
    this.lines                  = new LineSegments2( edgeGeometry( [], [] ), lineMat );
    const dotPos                = new THREE.InstancedBufferAttribute( new Float32Array( 3 ), 3 ), dotCol = new THREE.InstancedBufferAttribute( new Float32Array( 3 ), 3 );
    const dotMat                = new THREE.PointsNodeMaterial( { sizeAttenuation: false, depthTest: true } );
    dotMat.positionNode         = pull( instancedBufferAttribute( dotPos ) );
    dotMat.colorNode            = instancedBufferAttribute( dotCol ) as TslNode;
    dotMat.sizeNode             = float( 7 );
    this.dots                   = new THREE.Sprite( dotMat );
    this.dots.count             = 0;
    this.dots.userData          = { pos: dotPos, col: dotCol };
    const faceMat               = new THREE.MeshBasicNodeMaterial( { color: 0xffa033, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide } );
    faceMat.polygonOffset       = true;
    faceMat.polygonOffsetFactor = -1;
    faceMat.polygonOffsetUnits  = -2;
    this.faces                  = new THREE.Mesh( new THREE.BufferGeometry(), faceMat );
    const prevMat               = new THREE.LineBasicNodeMaterial( { color: 0xffd23f, depthTest: false, transparent: true } );
    this.preview                = new THREE.LineSegments( new THREE.BufferGeometry(), prevMat );
    for ( const o of [this.lines, this.dots, this.faces, this.preview] ) {
      o.frustumCulled = false;
      o.renderOrder   = 20;
      this.group.add( o );
    }
    this.group.visible = false;
  }

  // ---------------------------------------------------------------- the piece

  obj(): ( CustomObjectEntry & { model: ModelData } ) | null {
    const o = useEditor.getState().customObjects.find( ( x ) => x.uid === this.uid );
    return o && isModel( o ) ? o : null;
  }
  matrix( o: CustomObjectEntry ) {
    return pieceMatrix( o );
  }
  /**
   * A vertex of the piece in the viewport's space.
  **/
  world( o: CustomObjectEntry, p: V3, M = this.matrix( o ) ) {
    return toThree( p ).applyMatrix4( M );
  }

  enter( uid: string ) {
    this.uid           = uid;
    this.sel           = emptySel();
    this.active        = null;
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

  /**
   * The store hears how much is selected ( the header and Properties show it ).
  **/
  publish() {
    const o = this.obj();
    if ( !o ) return;
    useEditor.setState( { modelEdit: { uid: o.uid, mode: this.mode, verts: this.sel.v.size, edges: this.sel.e.size, faces: this.sel.f.size, status: this.status() } } );
  }

  /**
   * What's selected, and how, as it is now ( to put back ).
  **/
  snapshot(): Picked {
    return { sel: { v: new Set( this.sel.v ), e: new Set( this.sel.e ), f: new Set( this.sel.f ) }, active: this.active, mode: this.mode };
  }

  /**
   * A change of selection kept as an undo step ( Blender's: Ctrl+Z puts the last selection back, a miss-click
   * undone ), from what it was ( `before` ).
  **/
  selected( before: Picked ) {
    const after = this.snapshot(), uid = this.uid;
    const same  = ( a: Set<unknown>, b: Set<unknown> ) => a.size === b.size && [...a].every( ( x ) => b.has( x ) );
    if ( before.mode === after.mode && before.active === after.active && same( before.sel.v, after.sel.v ) && same( before.sel.e, after.sel.e ) && same( before.sel.f, after.sel.f ) ) return;
    const put = ( p: Picked ) => {
      if ( this.uid !== uid ) return;
      this.sel    = { v: new Set( p.sel.v ), e: new Set( p.sel.e ), f: new Set( p.sel.f ) };
      this.active = p.active;
      this.mode   = p.mode;
      this.sync();
      this.publish();
    };
    history.push( { label: before.mode === after.mode ? "Select" : "Select mode", undo: () => put( before ), redo: () => put( after ) } );
  }

  /**
   * The selection kept to what still exists ( after an undo, say ).
  **/
  private clampSel( g: Mesh ) {
    const s = this.sel;
    for ( const v of s.v ) if ( v >= g.v.length ) s.v.delete( v );
    for ( const f of s.f ) if ( f >= g.f.length ) s.f.delete( f );
    const edges = edgesOf( g );
    for ( const k of s.e ) if ( !edges.has( k ) ) s.e.delete( k );
  }

  // set while a kept result is recorded ( the piece is put back for a moment to record it from )
  recording = false;

  /**
   * Redraws the overlay ( vertices, edges, selected faces ) from the piece as it is.
  **/
  sync() {
    if ( this.recording ) return;
    const o = this.obj();
    if ( !o ) {
      if ( this.uid ) this.exit();
      return;
    }
    const g = o.model.mesh, M = this.matrix( o );
    this.clampSel( g );
    const W = g.v.map( ( p ) => this.world( o, p, M ) );
    for ( const f of this.hidden ) if ( f >= g.f.length ) this.hidden.delete( f );
    const vis          = this.shown( g );
    // edges
    const edges        = edgesOf( g );
    const lp: number[] = [], lc: number[] = [];
    for ( const [k, e] of edges ) {
      if ( !vis.e.has( k ) ) continue;
      const on = this.mode === "face" ? [...e.faces].some( ( f ) => this.sel.f.has( f ) ) && this.sel.e.has( k ) : this.sel.e.has( k );
      const cr = g.c?.[k] ? PLAIN.clone().lerp( CREASE, 0.35 + 0.65 * g.c[k] ) : PLAIN;
      const ca = this.mode === "vert" ? ( this.sel.v.has( e.a ) ? SELECTED : cr ) : on ? SELECTED : cr;
      const cb = this.mode === "vert" ? ( this.sel.v.has( e.b ) ? SELECTED : cr ) : on ? SELECTED : cr;
      lp.push( W[e.a].x, W[e.a].y, W[e.a].z, W[e.b].x, W[e.b].y, W[e.b].z );
      lc.push( ca.r, ca.g, ca.b, cb.r, cb.g, cb.b );
    }
    this.lines.geometry.dispose();
    this.lines.geometry = edgeGeometry( lp, lc );
    this.lines.visible  = lp.length > 0;
    // dots: vertices ( vertex mode ) or face centres ( face mode )
    const dp: number[]  = [], dc: number[] = [];
    if ( this.mode === "vert" )
      W.forEach( ( w, i ) => {
        if ( !vis.v.has( i ) ) return;
        const c = this.active === i ? ACTIVE : this.sel.v.has( i ) ? SELECTED : PLAIN;
        dp.push( w.x, w.y, w.z );
        dc.push( c.r, c.g, c.b );
      } );
    else if ( this.mode === "face" )
      g.f.forEach( ( _, fi ) => {
        if ( this.hidden.has( fi ) ) return;
        const w = this.world( o, faceCenter( g, fi ), M );
        const c = this.active === fi ? ACTIVE : this.sel.f.has( fi ) ? SELECTED : FACE_DOT;
        dp.push( w.x, w.y, w.z );
        dc.push( c.r, c.g, c.b );
      } );
    const { pos } = this.dots.userData as { pos: THREE.InstancedBufferAttribute };
    if ( pos.array.length < dp.length ) {
      const np           = new THREE.InstancedBufferAttribute( new Float32Array( dp.length * 2 ), 3 ), nc = new THREE.InstancedBufferAttribute( new Float32Array( dp.length * 2 ), 3 );
      const mat          = this.dots.material as THREE.PointsNodeMaterial;
      mat.positionNode   = pull( instancedBufferAttribute( np ) );
      mat.colorNode      = instancedBufferAttribute( nc ) as TslNode;
      mat.needsUpdate    = true;
      this.dots.userData = { pos: np, col: nc };
    }
    const { pos: P, col: C } = this.dots.userData as { pos: THREE.InstancedBufferAttribute; col: THREE.InstancedBufferAttribute };
    ( P.array as Float32Array ).set( dp );
    ( C.array as Float32Array ).set( dc );
    P.needsUpdate      = C.needsUpdate = true;
    this.dots.count    = dp.length / 3;
    // selected faces, tinted
    const fp: number[] = [];
    for ( const fi of this.sel.f ) {
      const f = g.f[fi];
      if ( !f ) continue;
      for ( let i = 1; i + 1 < f.length; i++ ) for ( const v of [f[0], f[i], f[i + 1]] ) fp.push( W[v].x, W[v].y, W[v].z );
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute( "position", new THREE.Float32BufferAttribute( fp, 3 ) );
    this.faces.geometry.dispose();
    this.faces.geometry = fg;
    this.drawPreview();
  }

  drawPreview() {
    const segs        = this.modal?.kind === "loopcut" || this.modal?.kind === "knife" ? this.modal.preview : [];
    const p: number[] = [];
    for ( const s of segs ) for ( let i = 0; i + 1 < s.length; i++ ) p.push( s[i].x, s[i].y, s[i].z, s[i + 1].x, s[i + 1].y, s[i + 1].z );
    const g = new THREE.BufferGeometry();
    g.setAttribute( "position", new THREE.Float32BufferAttribute( p, 3 ) );
    this.preview.geometry.dispose();
    this.preview.geometry = g;
  }

  // ---------------------------------------------------------------- changing the model

  /**
   * Puts a mesh on the piece: `label` = one undo step from `o0` ( else a live step, recorded when it's kept ).
  **/
  setMesh( mesh: Mesh, label: string | null, o0?: CustomObjectEntry ) {
    const st = useEditor.getState(), o = this.obj();
    if ( !o ) return;
    const next = withModel( o, { ...o.model, mesh } );
    if ( label ) {
      this.recording = true;
      try {
        if ( o0 ) useEditor.setState( { customObjects: st.customObjects.map( ( x ) => ( x.uid === o.uid ? o0 : x ) ) } );
        st.updateCustom( label, [o.uid], () => next );
      } finally {
        this.recording = false;
      }
    } else useEditor.setState( { customObjects: st.customObjects.map( ( x ) => ( x.uid === o.uid ? { ...o, model: { ...o.model, mesh } } : x ) ) } );
    this.sync();
    this.publish();
  }

  // ---------------------------------------------------------------- pointer

  down( e: PointerEvent, x: number, y: number ): boolean {
    this.mouse = { x, y };
    const m    = this.modal;
    if ( m ) {
      if ( e.button === 2 ) {
        if ( m.kind === "slide" ) this.keep();
        else this.cancel();
        return true;
      }
      if ( e.button !== 0 ) return false;
      if ( m.kind === "loopcut" ) {
        // ( a click off the mesh keeps the tool going )
        if ( m.edge ) this.loopCut.apply();
        return true;
      }
      if ( m.kind === "knife" ) {
        if ( m.hover ) m.pts.push( m.hover );
        this.knife.hover( x, y, e.ctrlKey );
        return true;
      }
      this.keep();
      return true;
    }
    if ( e.button !== 0 ) return false;
    if ( e.altKey ) {
      // Alt+click: the loop through the edge nearest the mouse, whatever the select mode ( faces: the faces round it;
      // Shift adds it )
      const k = this.picking.pickEdge( x, y );
      if ( k === null ) return true;
      const g   = this.obj()!.model.mesh;
      const was = this.snapshot();
      if ( this.mode === "face" ) this.sel = selFromFaces( g, [...( e.shiftKey ? this.sel.f : [] ), ...faceLoop( g, k )] );
      else this.sel = selFromEdges( g, [...( e.shiftKey ? this.sel.e : [] ), ...edgeLoop( g, k )] );
      this.active = k;
      this.selected( was );
      this.sync();
      this.publish();
      return true;
    }
    const el = this.picking.pick( x, y );
    const op     = useEditor.getState().selectOp;
    const extend = e.shiftKey || op === "extend", subtract = e.ctrlKey || op === "subtract";
    if ( el === null ) {
      // a drag from nothing: a box
      this.modal = { kind: "box", x0: x, y0: y, x1: x, y1: y, extend, subtract };
      return true;
    }
    if ( subtract ) {
      if ( this.toolbar.isSelected( el ) ) this.picking.selectOnly( el, true );
      return true;
    }
    this.picking.selectOnly( el, extend );
    return true;
  }

  move( e: PointerEvent, x: number, y: number ): boolean {
    this.mouse = { x, y };
    if ( this.armed ) this.fireArmed();
    const m = this.modal;
    if ( !m ) return false;
    switch ( m.kind ) {
      case "box":
        m.x1         = x;
        m.y1         = y;
        this.boxRect = [Math.min( m.x0, x ), Math.min( m.y0, y ), Math.max( m.x0, x ), Math.max( m.y0, y )];
        return true;
      case "transform": return this.ops.runTransform( e ), true;
      case "inset":     return this.ops.runInset( e ), true;
      case "bevel":     return this.ops.runBevel( e ), true;
      case "loopcut":   return this.loopCut.hover( x, y ), true;
      case "slide":     return this.loopCut.runSlide(), true;
      case "spin":      return this.ops.runSpin( e ), true;
      case "crease":    return this.ops.runCrease( e ), true;
      case "knife":     return this.knife.hover( x, y, e.ctrlKey ), true;
      case "drag":      return this.toolbar.runDrag(), true;
    }
  }

  up( e: PointerEvent, x: number, y: number ): boolean {
    // a tool's drag: let go, kept
    if ( this.toolbar.toolDrag && e.button === 0 ) {
      this.toolbar.toolDrag = false;
      if ( this.modal && this.modal.kind !== "box" ) this.keep();
      return true;
    }
    const m = this.modal;
    if ( m?.kind !== "box" || e.button !== 0 ) return false;
    this.modal   = null;
    this.boxRect = null;
    const o      = this.obj();
    if ( !o ) return true;
    if ( Math.hypot( x - m.x0, y - m.y0 ) < 4 ) {
      // a click on nothing: deselect
      this.picking.selectOnly( null, false );
      return true;
    }
    const [x0, y0, x1, y1] = [Math.min( m.x0, x ), Math.min( m.y0, y ), Math.max( m.x0, x ), Math.max( m.y0, y )];
    const g                = o.model.mesh, M = this.matrix( o ), tris = this.picking.tris( o );
    const inBox            = ( w: THREE.Vector3 ) => {
      const [sx, sy, z] = this.picking.screen( w );
      return z <= 1 && sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && this.picking.visible( o, w, tris );
    };
    const W    = g.v.map( ( p ) => this.world( o, p, M ) );
    const hitV = new Set( g.v.map( ( _, i ) => i ).filter( ( i ) => inBox( W[i] ) ) );
    let next: Sel;
    if ( this.mode === "face" ) {
      const hitF  = g.f.map( ( _, fi ) => fi ).filter( ( fi ) => inBox( this.world( o, faceCenter( g, fi ), M ) ) );
      const faces = m.subtract ? [...this.sel.f].filter( ( f ) => !hitF.includes( f ) ) : m.extend ? [...this.sel.f, ...hitF] : hitF;
      next        = selFromFaces( g, faces );
    } else if ( this.mode === "edge" ) {
      const hitE  = [...edgesOf( g ).values()].filter( ( e2 ) => hitV.has( e2.a ) && hitV.has( e2.b ) ).map( ( e2 ) => ek( e2.a, e2.b ) );
      const edges = m.subtract ? [...this.sel.e].filter( ( k ) => !hitE.includes( k ) ) : m.extend ? [...this.sel.e, ...hitE] : hitE;
      next        = selFromEdges( g, edges );
    } else {
      const verts = m.subtract ? [...this.sel.v].filter( ( v ) => !hitV.has( v ) ) : m.extend ? [...this.sel.v, ...hitV] : [...hitV];
      next        = selFromVerts( g, verts );
    }
    const was = this.snapshot();
    this.sel  = next;
    this.selected( was );
    this.sync();
    this.publish();
    return true;
  }

  wheel( e: WheelEvent ): boolean {
    const m = this.modal;
    if ( m?.kind === "transform" && useEditor.getState().modelTools.proportional ) {
      m.propRadius = Math.max( 0.01, m.propRadius * ( e.deltaY < 0 ? 1.15 : 1 / 1.15 ) );
      useEditor.setState( ( s ) => ( { modelTools: { ...s.modelTools, propRadius: m.propRadius } } ) );
      this.ops.runTransform( e as unknown as PointerEvent );
      return true;
    }
    if ( m?.kind === "loopcut" ) {
      m.cuts = Math.max( 1, Math.min( 32, m.cuts + ( e.deltaY < 0 ? 1 : -1 ) ) );
      this.loopCut.hover( this.mouse.x, this.mouse.y );
      return true;
    }
    if ( m?.kind === "bevel" ) {
      m.segments = Math.max( 1, Math.min( 16, m.segments + ( e.deltaY < 0 ? 1 : -1 ) ) );
      this.ops.runBevel( e as unknown as PointerEvent );
      return true;
    }
    if ( m?.kind === "spin" ) {
      m.steps = Math.max( 1, Math.min( 128, m.steps + ( e.deltaY < 0 ? 1 : -1 ) ) );
      this.ops.runSpin( e as unknown as PointerEvent );
      return true;
    }
    return false;
  }

  /**
   * The right-click menu ( the view asks either Edit Mode for it ).
  **/
  contextMenu() {
    this.menus.contextMenu();
  }

  /**
   * A key pressed in Edit Mode: whether it was one of its own ( the view asks either Edit Mode ).
  **/
  key( e: KeyboardEvent ): boolean {
    return this.keys.key( e );
  }

  // ---------------------------------------------------------------- an operator under way ( operators.ts, knife.ts, loopCut.ts )

  // An operator from the toolbar: it starts at the next move of the mouse in the viewport.
  private armed: "g" | "r" | "s" | "e" | "i" | "b" | "loop" | "spin" | "knife" | null = null;
  arm( op: "g" | "r" | "s" | "e" | "i" | "b" | "loop" | "spin" | "knife" ) {
    if ( this.modal ) this.cancel();
    this.armed = op;
  }
  private fireArmed() {
    const op   = this.armed;
    this.armed = null;
    if ( op === "g" || op === "r" || op === "s" ) this.ops.startTransform( op );
    else if ( op === "e"     ) this.ops.extrude();
    else if ( op === "i"     ) this.ops.startInset();
    else if ( op === "b"     ) this.ops.startBevel();
    else if ( op === "loop"  ) this.loopCut.start();
    else if ( op === "spin"  ) this.ops.startSpin();
    else if ( op === "knife" ) this.knife.start();
  }

  statusText = "";
  private status() {
    return this.modal ? this.statusText : "";
  }

  /**
   * Shift or Ctrl pressed or let go during an operator: it's worked out again ( finer, snapping ).
  **/
  modsChanged( e: KeyboardEvent ) {
    if ( this.modal ) this.rerun( e );
  }

  rerun( e: KeyboardEvent ) {
    const m = this.modal;
    if ( m?.kind === "transform" ) this.ops.runTransform( e );
    if ( m?.kind === "inset"     ) this.ops.runInset( e as unknown as PointerEvent );
    if ( m?.kind === "bevel"     ) this.ops.runBevel( e as unknown as PointerEvent );
    if ( m?.kind === "spin"      ) this.ops.runSpin( e as unknown as PointerEvent );
    if ( m?.kind === "crease"    ) this.ops.runCrease( e );
  }

  // ---------------------------------------------------------------- keeping or putting back

  /**
   * The live result recorded as one undo step from the piece as it was.
  **/
  commitFrom( o0: CustomObjectEntry, label: string ) {
    const o = this.obj();
    if ( !o ) return;
    this.setMesh( o.model.mesh, label, o0 );
  }

  keep() {
    const m = this.modal;
    if ( !m || m.kind === "box" || m.kind === "loopcut" ) return;
    this.modal      = null;
    const label     = m.kind === "transform" ? m.label : m.kind === "inset" ? "Inset faces" : m.kind === "bevel" ? "Bevel" : m.kind === "spin" ? "Spin" : m.kind === "crease" ? "Edge crease" : m.kind === "drag" ? m.label : "Loop cut";
    this.statusText = "";
    this.commitFrom( m.o0, label );
  }

  cancel() {
    const m         = this.modal;
    this.modal      = null;
    this.boxRect    = null;
    this.statusText = "";
    if ( m && "o0" in m ) {
      const st = useEditor.getState();
      useEditor.setState( { customObjects: st.customObjects.map( ( x ) => ( x.uid === m.o0.uid ? m.o0 : x ) ) } );
      this.sel = selFromVerts( m.o0.model!.mesh, [...this.sel.v].filter( ( v ) => v < m.o0.model!.mesh.v.length ) );
    }
    this.sync();
    this.publish();
  }

  /**
   * Adds a primitive into the mesh being edited, at a point of the piece ( Shift+A in Edit Mode ), selected.
  **/
  addInto( mesh: Mesh, at: V3 ) {
    const o = this.obj();
    if ( !o ) return;
    const g          = o.model.mesh, base = g.v.length;
    const next: Mesh = {
      v: [...g.v, ...mesh.v.map( ( p ) => [p[0] + at[0], p[1] + at[1], p[2] + at[2]] as V3 )],
      f: [...g.f, ...mesh.f.map( ( f ) => f.map( ( v ) => v + base ) )],
      m: [...g.m, ...mesh.m],
      s: [...g.s, ...mesh.s],
      w: [...g.w, ...mesh.w.map( ( [a, b] ) => [a + base, b + base] as [number, number] )],
    };
    this.sel = selFromVerts( next, mesh.v.map( ( _, i ) => base + i ) );
    this.setMesh( next, "Add mesh" );
  }

  /**
   * A point of the viewport in the piece's own coordinates.
  **/
  toPiece( w: THREE.Vector3 ): V3 {
    const o = this.obj();
    return o ? toUnity( w.clone().applyMatrix4( this.matrix( o ).invert() ) ) : [0, 0, 0];
  }
}

