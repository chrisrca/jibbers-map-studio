// The Ski Line tool ( Map-Tools' Ski Line Builder, as its Scene view edits a line ): every ski line drawn as Map-Tools
// previews it ( its surface's middle and edges, the line under it, ribs across, its features' spans ) while the tool's
// out, or the line's picked, or All Paths is on. A click on the ground adds a point to the end of the picked line ( a
// new line with none picked ); Shift+click near it puts a point in where it's nearest; a point dragged slides over the
// ground, as high over it as it was; Ctrl+click or X takes a point out; Enter or Escape lets the line go. A feature's
// cone slides it along the line, its cube from side to side. The gizmo moves the picked point anywhere.

import * as THREE from "three/webgpu";
import { toThree, toUnity } from "../../core/coords";
import { cancelShape, commitShape, deleteShape, liveShape } from "../../terrain/shapes/edits";
import { groundWithout, newSkiLine, type SkiLineShape } from "../../terrain/shapes/shapes";
import { featureOffsetAt, indexAt, nearestAlong, pointAt, rightAt, skiLineBake, surfaceAt, tangentAt } from "../../terrain/shapes/shapes/skiline";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";

type V3 = [number, number, number];

// ( Map-Tools' preview colours: MoreColors )
const COLOURS = { editing: 0xff8a00, line: 0x4fe0a8, off: 0x6b7a8f, base: 0x9b6bff, edge: 0x4b3fbf, rib: 0x2f8f4f, feature: 0xff9a2e, node: 0x3a9bff, handle: 0xffbf00 };

const ground = ( x: number, z: number ) => {
  const h = terrain.heightAt( x, z );
  return Number.isNaN( h ) ? 0 : h;
};

export class SkiLineTool {
  readonly group  = new THREE.Group();
  private lines   = new THREE.Group();
  private handles = new THREE.Group();
  private sphere  = new THREE.SphereGeometry( 1, 16, 12 );
  private cone    = new THREE.ConeGeometry( 0.6, 1.6, 16 );
  private cube    = new THREE.BoxGeometry( 1, 1, 1 );
  private mats    = new Map<string, THREE.Material>();
  // the picked line's point ( the gizmo's on it; X takes it out )
  private pickedAt: { uid: string; i: number } | null = null;
  onPicked: () => void = () => {};
  private drag:
    | { kind: "node"; s: SkiLineShape; i: number }
    | { kind: "start" | "lateral"; s: SkiLineShape; f: number; from: number; at: [number, number] }
    | null = null;
  private moving: { s: SkiLineShape; i: number; from: THREE.Vector3 } | null = null;

  constructor( private raycast: ( x: number, y: number ) => THREE.Raycaster, private pickTerrain: ( x: number, y: number ) => THREE.Vector3 | null ) {
    this.group.add( this.lines, this.handles );
    this.handles.renderOrder = 10;
  }

  private get picked() {
    return this.pickedAt;
  }
  private set picked( p: { uid: string; i: number } | null ) {
    const was     = this.pickedAt;
    this.pickedAt = p;
    if ( was?.uid !== p?.uid || was?.i !== p?.i ) this.onPicked();
  }

  /**
   * Whether the Ski Line tool is out.
  **/
  active() {
    const st = useEditor.getState();
    return st.tool === "shape" && st.shapeKind === "skiline";
  }

  private skiLines(): SkiLineShape[] {
    const st = useEditor.getState();
    return st.shapes.filter( ( s ): s is SkiLineShape => s.kind === "skiline" && !st.locked[s.uid] );
  }

  // ( the line being edited: the one picked )
  private editing(): SkiLineShape | null {
    const st = useEditor.getState(), sel = st.selection.length === 1 && st.selection[0].kind === "shape" ? st.selection[0].uid : null;
    return this.skiLines().find( ( s ) => s.uid === sel ) ?? null;
  }

  private mat( kind: "line" | "mesh", colour: number, opacity = 0.9 ) {
    const key = `${kind}${colour}/${opacity}`;
    let m     = this.mats.get( key );
    if ( !m ) this.mats.set( key, ( m = kind === "line" ? new THREE.LineBasicNodeMaterial( { color: colour, depthTest: false, transparent: true, opacity } ) : new THREE.MeshBasicNodeMaterial( { color: colour, depthTest: false, transparent: true, opacity } ) ) );
    return m;
  }

  private polyline( pts: V3[], colour: number, lift = 0.06 ) {
    const l       = new THREE.Line( new THREE.BufferGeometry().setFromPoints( pts.map( ( p ) => toThree( [p[0], p[1] + lift, p[2]] ) ) ), this.mat( "line", colour ) );
    l.renderOrder = 9;
    this.lines.add( l );
  }

  private handle( geo: THREE.BufferGeometry, at: V3, size: number, colour: number, data: object, q?: THREE.Quaternion ) {
    const m = new THREE.Mesh( geo, this.mat( "mesh", colour ) );
    m.position.copy( toThree( at ) );
    if ( q ) m.quaternion.copy( q );
    m.scale.setScalar( size );
    m.renderOrder = 11;
    m.userData    = data;
    this.handles.add( m );
  }

  /**
   * The lines drawn again ( every one while the tool's out or All Paths is on, else the picked one ), and the picked
   * line's points and its features' handles.
  **/
  sync() {
    for ( const l of [...this.lines.children] ) ( l as THREE.Line ).geometry.dispose();
    this.lines.clear();
    this.handles.clear();
    const st   = useEditor.getState();
    const edit = this.editing();
    const show = this.active() || st.showPaths ? this.skiLines() : edit ? [edit] : [];
    if ( this.picked && ( this.picked.uid !== edit?.uid || this.picked.i >= ( edit?.nodes.length ?? 0 ) ) ) this.picked = null;
    for ( const s of show ) {
      const b       = skiLineBake( s );
      const editing = s.uid === edit?.uid;
      if ( b ) {
        const n = b.pos.length;
        const row = ( t: number ) => Array.from( { length: n }, ( _, i ) => surfaceAt( s, b, i, t ) );
        this.polyline( row( 0.5 ), !s.enabled ? COLOURS.off : editing ? COLOURS.editing : COLOURS.line );
        this.polyline( b.pos, COLOURS.base );
        this.polyline( row( 0 ), COLOURS.edge );
        this.polyline( row( 1 ), COLOURS.edge );
        const ribs = Math.min( 24, Math.max( 6, Math.floor( n / 24 ) ) );
        for ( let r = 0; r < ribs; r++ ) {
          const i = Math.min( n - 1, Math.floor( ( r * ( n - 1 ) ) / ( ribs - 1 ) ) );
          this.polyline( Array.from( { length: 17 }, ( _, j ) => surfaceAt( s, b, i, j / 16 ) ), COLOURS.rib );
        }
        // ( each feature's span along the middle )
        for ( const f of s.features ) {
          if ( !f.enabled || f.length <= 0.01 ) continue;
          const i0 = indexAt( b, Math.max( 0, f.start ) ), i1 = indexAt( b, Math.min( b.total, f.start + f.length ) );
          if ( i1 > i0 ) this.polyline( Array.from( { length: i1 - i0 + 1 }, ( _, k ) => surfaceAt( s, b, i0 + k, 0.5 ) ), COLOURS.feature, 0.12 );
        }
      }
      // the points: the picked line's to take hold of; the others' shown
      const size = Math.max( 0.35, s.width * 0.04 );
      s.nodes.forEach( ( nd, i ) => {
        const picked = editing && this.picked?.i === i;
        this.handle( this.sphere, [nd.p[0], nd.p[1] + size, nd.p[2]], picked ? size * 1.3 : size, picked ? COLOURS.editing : COLOURS.node, editing ? { node: i, uid: s.uid } : { line: s.uid } );
      } );
      // the picked line's features: a cone to slide it along, a cube to slide it across
      if ( editing && b )
        s.features.forEach( ( f, k ) => {
          const d    = Math.min( b.total, Math.max( 0, f.start ) ), i = indexAt( b, d ), r = rightAt( b, i ), t = tangentAt( b, i );
          const half = b.half[i], lat = Math.min( half, Math.max( -half, f.lateral ) );
          const p    = pointAt( b, d ), at: V3 = [p[0] + r[0] * lat, p[1] + featureOffsetAt( s.features, d, lat ) + 0.25, p[2] + r[2] * lat];
          const along = new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), toThree( t ).sub( toThree( [0, 0, 0] ) ).normalize() );
          this.handle( this.cone, at, size * 1.2, f.enabled ? COLOURS.handle : COLOURS.off, { start: k, uid: s.uid }, along );
          this.handle( this.cube, [at[0], at[1] + size * 2, at[2]], size * 0.9, f.enabled ? COLOURS.handle : COLOURS.off, { lateral: k, uid: s.uid } );
        } );
    }
  }

  /**
   * Whether a press here is the tool's ( on a point or a feature's handle ), not the gizmo's.
  **/
  markUnder( x: number, y: number ) {
    return this.active() && this.raycast( x, y ).intersectObjects( this.handles.children, false ).length > 0;
  }

  /**
   * The ground under the picked line as if it weren't there ( where its points sit ).
  **/
  private under( uid: string | null ): ( x: number, z: number ) => number {
    const g = uid ? groundWithout( uid ) : null;
    return ( x, z ) => {
      const h = g ? g( x, z ) : ground( x, z );
      return Number.isNaN( h ) ? ground( x, z ) : h;
    };
  }

  private shapeOf( uid: string ) {
    return this.skiLines().find( ( s ) => s.uid === uid ) ?? null;
  }

  /**
   * Pointer down: true when the tool took it.
  **/
  down( x: number, y: number, e: { ctrlKey?: boolean; shiftKey?: boolean } = {} ): boolean {
    if ( !this.active() ) return false;
    const st  = useEditor.getState();
    const hit = this.raycast( x, y ).intersectObjects( this.handles.children, false )[0];
    if ( hit ) {
      const d = hit.object.userData as { node?: number; line?: string; start?: number; lateral?: number; uid?: string };
      const s = d.uid ? this.shapeOf( d.uid ) : null;
      if ( d.line ) {
        st.setSelection( [{ kind: "shape", uid: d.line }] );
        return true;
      }
      if ( s && d.node !== undefined ) {
        // ( Ctrl: the point taken out )
        if ( e.ctrlKey ) {
          this.picked = { uid: s.uid, i: d.node };
          this.deletePoint();
          return true;
        }
        this.picked = { uid: s.uid, i: d.node };
        this.drag   = { kind: "node", s, i: d.node };
        this.sync();
        return true;
      }
      const k = d.start ?? d.lateral;
      if ( s && k !== undefined ) {
        const p = this.pickTerrain( x, y ), u = p ? toUnity( p ) : null;
        this.drag = { kind: d.start !== undefined ? "start" : "lateral", s, f: k, from: d.start !== undefined ? s.features[k].start : s.features[k].lateral, at: u ? [u[0], u[2]] : [0, 0] };
        return true;
      }
    }
    const p = this.pickTerrain( x, y );
    if ( !p ) return false;
    const u = toUnity( p ), at: [number, number] = [u[0], u[2]];
    const s = this.editing();
    // ( on another line: that one picked )
    const other = this.skiLines().find( ( q ) => q.uid !== s?.uid && ( () => { const b = skiLineBake( q ); return b && nearestAlong( b, at[0], at[1] ).off <= b.half[indexAt( b, nearestAlong( b, at[0], at[1] ).d )]; } )() );
    if ( other && !e.shiftKey ) {
      st.setSelection( [{ kind: "shape", uid: other.uid }] );
      this.picked = null;
      return true;
    }
    const y0 = this.under( s?.uid ?? null )( at[0], at[1] );
    const nd = { p: [at[0], y0, at[1]] as V3, width: null, roll: 0 };
    if ( !s ) {
      const line = newSkiLine( [nd] );
      liveShape( line, "Add ski line" );
      st.setSelection( [{ kind: "shape", uid: line.uid }] );
      this.picked = { uid: line.uid, i: 0 };
      this.drag   = { kind: "node", s: line, i: 0 };
      this.sync();
      return true;
    }
    // Shift: put in where it's nearest; else on the end
    const b = s.nodes.length >= 2 ? skiLineBake( s ) : null;
    let i   = s.nodes.length;
    if ( e.shiftKey && b ) i = Math.min( s.nodes.length - 2, Math.max( 0, Math.trunc( b.nodeParam[indexAt( b, nearestAlong( b, at[0], at[1] ).d )] ) ) ) + 1;
    const next = { ...s, nodes: [...s.nodes.slice( 0, i ), nd, ...s.nodes.slice( i )] };
    liveShape( next, "Add ski line point" );
    this.picked = { uid: s.uid, i };
    this.drag   = { kind: "node", s: next, i };
    this.sync();
    return true;
  }

  move( x: number, y: number ): boolean {
    const d = this.drag;
    if ( !d ) return false;
    const p = this.pickTerrain( x, y );
    if ( !p ) return true;
    const u = toUnity( p );
    if ( d.kind === "node" ) {
      // ( slid over the ground, as high over it as it was )
      const under = this.under( d.s.uid ), nd = d.s.nodes[d.i];
      const off   = nd.p[1] - under( nd.p[0], nd.p[2] );
      const next  = { ...d.s, nodes: d.s.nodes.map( ( q, k ) => ( k === d.i ? { ...q, p: [u[0], under( u[0], u[2] ) + off, u[2]] as V3 } : q ) ) };
      liveShape( next, "Move ski line point" );
      return true;
    }
    const b = skiLineBake( d.s );
    if ( !b ) return true;
    const f = d.s.features[d.f];
    let next = f;
    if ( d.kind === "start" ) next = { ...f, start: Math.min( b.total, Math.max( 0, nearestAlong( b, u[0], u[2] ).d ) ) };
    else {
      const i = indexAt( b, Math.min( b.total, Math.max( 0, f.start ) ) ), r = rightAt( b, i ), half = b.half[i];
      const by = ( u[0] - d.at[0] ) * r[0] + ( u[2] - d.at[1] ) * r[2];
      next     = { ...f, lateral: Math.min( half, Math.max( -half, d.from + by ) ) };
    }
    liveShape( { ...d.s, features: d.s.features.map( ( q, k ) => ( k === d.f ? next : q ) ) }, "Move ski line feature" );
    return true;
  }

  up() {
    if ( !this.drag ) return;
    this.drag = null;
    commitShape();
    this.sync();
  }

  get dragging() {
    return !!this.drag;
  }

  /**
   * X / Delete: the picked point taken out ( its last: the line with it ). True when there was one.
  **/
  deletePoint() {
    const p = this.picked, s = p && this.shapeOf( p.uid );
    if ( !this.active() || !p || !s ) return false;
    this.picked = null;
    if ( s.nodes.length <= 1 ) {
      deleteShape( s.uid );
      return true;
    }
    liveShape( { ...s, nodes: s.nodes.filter( ( _, i ) => i !== p.i ) }, "Delete ski line point" );
    commitShape();
    this.sync();
    return true;
  }

  /**
   * Enter / Escape: the line let go ( the next click starts another ). True when one was picked.
  **/
  done() {
    if ( !this.active() || !this.editing() ) return false;
    this.picked = null;
    useEditor.getState().setSelection( [] );
    return true;
  }

  // ---------------------------------------------------------------- the gizmo on the picked point ( anywhere )

  gizmoAt(): THREE.Vector3 | null {
    const p = this.picked, s = p && this.active() ? this.shapeOf( p.uid ) : null;
    const nd = s && p ? s.nodes[p.i] : null;
    return nd ? toThree( nd.p ) : null;
  }

  gizmoStart() {
    const at = this.gizmoAt(), s = this.picked && this.shapeOf( this.picked.uid );
    if ( !at || !s ) return false;
    this.moving = { s, i: this.picked!.i, from: at };
    return true;
  }

  get gizmoMoving() {
    return !!this.moving;
  }

  gizmoMove( delta: THREE.Matrix4 ) {
    const mv = this.moving;
    if ( !mv ) return;
    const u = toUnity( mv.from.clone().applyMatrix4( delta ) );
    liveShape( { ...mv.s, nodes: mv.s.nodes.map( ( q, k ) => ( k === mv.i ? { ...q, p: u } : q ) ) }, "Move ski line point" );
  }

  gizmoEnd() {
    this.moving = null;
    commitShape();
  }

  gizmoCancel() {
    this.moving = null;
    cancelShape();
  }

  /**
   * A map opened: nothing picked or under way from the one before.
  **/
  reset() {
    this.picked = null;
    this.drag   = null;
    this.moving = null;
    this.sync();
  }
}
