// The Shapes tool in the viewport: drawing curves/circles on the terrain, outlines for every shape, and handles to drag
// on the selected one. Formations are laid as trails are: every formation's points are out to click while the tool is;
// a click on the ground adds a point after the one picked ( the formation grows from it ) or, with none picked, starts
// a new formation; a click near an outline puts a point in it there; a point is dragged about; Ctrl+click on another
// formation's point ( or a point let go on one ) joins the two into one outline; X or Delete takes the picked point
// out; Enter or Escape lets go of it, to start another.
// Edits go through terrain/shapes/edits.ts ( live preview, one undo step per drag ).

import * as THREE from "three/webgpu";
import { toThree, toUnity } from "../../core/coords";
import { PROFILES } from "../../core/curve";
import { history } from "../../map/history";
import { cancelShape, commitShape, deleteShape, liveShape } from "../../terrain/shapes/edits";
import { captureStamp, fitFormation, groundWithout, newCircle, newCurve, newFormation, newStamp, shapeHeightAt, type CurveShape, type FormationShape, type Shape, type StampShape } from "../../terrain/shapes/shapes";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { redraw } from "../redraw";

// ( a number: a formation's outline point )
type Handle = "start" | "end" | "center" | "radius" | "rotate" | number;

const COLOR    = 0x38bdf8;
const SELECTED = 0xffb000;

// Settings the tool header controls for new shapes.
export interface ShapeToolSettings {
  preset:   keyof typeof PROFILES;
  // kickers: lip angle above level ( their height follows from it and the length )
  lipAngle: number;
  height:   number;
  width:    number;
}
export const shapeToolSettings: ShapeToolSettings = { preset: "kicker", height: 1.5, width: 6, lipAngle: 25 };

const ground = ( x: number, z: number ) => {
  const h = terrain.heightAt( x, z );
  return Number.isNaN( h ) ? 0 : h;
};

export class ShapeTool {
  readonly group    = new THREE.Group();
  private lines     = new THREE.Group();
  private handles   = new THREE.Group();
  private handleGeo = new THREE.SphereGeometry( 1, 16, 12 );
  private handleMat = new THREE.MeshBasicNodeMaterial( { color: SELECTED, depthTest: false, transparent: true, opacity: 0.9 } );
  private pickedMat = new THREE.MeshBasicNodeMaterial( { color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 } );
  // where a click on the selected formation's edge would add a point
  private ghost     = new THREE.Mesh( this.handleGeo, new THREE.MeshBasicNodeMaterial( { color: SELECTED, depthTest: false, transparent: true, opacity: 0.45 } ) );
  // the formation's point last clicked ( the gizmo's on it; X or Delete takes it out ), told to the gizmo as it changes
  private pickedAt: { uid: string; i: number } | null = null;
  private get picked() {
    return this.pickedAt;
  }
  private set picked( p: { uid: string; i: number } | null ) {
    const was     = this.pickedAt;
    this.pickedAt = p;
    if ( was?.uid !== p?.uid || was?.i !== p?.i ) this.onPicked();
  }
  onPicked: () => void = () => {};
  // a move with the gizmo under way: the formation as it was, which point, where it was ( view space )
  private moving: { s: FormationShape; i: number; from: THREE.Vector3 } | null = null;
  private lineMats  = new Map<string, THREE.LineBasicNodeMaterial>();
  private drag:
    | { kind: "draw";   at:     [number, number]; shape: Shape | null; box?: [number, number] }
    | { kind: "handle"; handle: Handle; shape: Shape }
    | null = null;

  constructor( private raycast: ( x: number, y: number ) => THREE.Raycaster, private pickTerrain: ( x: number, y: number ) => THREE.Vector3 | null ) {
    this.group.add( this.lines, this.handles, this.ghost );
    this.handles.renderOrder = 10;
    this.ghost.renderOrder   = 11;
    this.ghost.visible       = false;
  }

  private selected(): Shape | null {
    const st  = useEditor.getState();
    const sel = st.selection.length === 1 && st.selection[0].kind === "shape" ? st.selection[0].uid : null;
    return sel ? st.shapes.find( ( s ) => s.uid === sel ) ?? null : null;
  }

  /**
   * Whether the Formation tool is out ( every formation's points to click ).
  **/
  private forming() {
    const st = useEditor.getState();
    return st.tool === "shape" && st.shapeKind === "formation";
  }

  private formations(): FormationShape[] {
    const st = useEditor.getState();
    return st.shapes.filter( ( s ): s is FormationShape => s.kind === "formation" && !st.locked[s.uid] );
  }

  private formation( uid: string ) {
    return this.formations().find( ( s ) => s.uid === uid ) ?? null;
  }

  // ---- the gizmo on the picked point ( as on a trail's )

  /**
   * Where the gizmo goes: the picked point on the ground ( view space ), with the Formation tool out.
  **/
  gizmoAt(): THREE.Vector3 | null {
    const p = this.picked, s = p && this.forming() ? this.formation( p.uid ) : null;
    if ( !s || !p || p.i >= s.points.length ) return null;
    const [x, z] = s.points[p.i];
    return toThree( [x, ground( x, z ), z] );
  }

  gizmoStart() {
    const at = this.gizmoAt(), s = this.picked && this.formation( this.picked.uid );
    if ( !at || !s ) return false;
    this.moving = { s, i: this.picked!.i, from: at };
    return true;
  }

  get gizmoMoving() {
    return !!this.moving;
  }

  /**
   * The gizmo's change so far ( view space ) applied to the picked point, over the ground.
  **/
  gizmoMove( delta: THREE.Matrix4 ) {
    const mv = this.moving;
    if ( !mv ) return;
    const u = toUnity( mv.from.clone().applyMatrix4( delta ) );
    liveShape( { ...mv.s, points: mv.s.points.map( ( q, k ): [number, number] => ( k === mv.i ? [u[0], u[2]] : q ) ) }, "Move point" );
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
   * Whether a handle of a picked shape is under the mouse ( any of them: Design's Select Box hands a press on one to
   * the tool ).
  **/
  handleUnder( x: number, y: number ) {
    return this.handles.visible && this.raycast( x, y ).intersectObjects( this.handles.children, false ).length > 0;
  }

  /**
   * Whether a press here is the tool's, not the gizmo's: on a point's handle.
  **/
  markUnder( x: number, y: number ) {
    return this.forming() && this.raycast( x, y ).intersectObjects( this.handles.children, false ).length > 0;
  }

  /**
   * A map opened: nothing picked or under way from the one before.
  **/
  reset() {
    this.picked        = null;
    this.drag          = null;
    this.moving        = null;
    this.ghost.visible = false;
    this.sync();
  }

  private lineMat( color: number, opacity = 0.85 ) {
    let m = this.lineMats.get( `${color}/${opacity}` );
    if ( !m ) this.lineMats.set( `${color}/${opacity}`, ( m = new THREE.LineBasicNodeMaterial( { color, depthTest: false, transparent: true, opacity } ) ) );
    return m;
  }

  // each shown shape's outline, kept while the shape and its colour stay the same ( dragging one point redrew every
  // shape's outline on the map, every move ); lines go into `into` as they're drawn
  private outlines = new Map<string, { s: Shape; color: number; g: THREE.Group }>();
  private into: THREE.Object3D = this.lines;

  /**
   * The loose lines drawn before go ( an outline being drawn, a box being dragged ), their geometry with them.
  **/
  private clearLines() {
    for ( const l of [...this.lines.children] )
      if ( !( l instanceof THREE.Group ) ) {
        ( l as THREE.Line ).geometry.dispose();
        this.lines.remove( l );
      }
  }

  private dropOutline( g: THREE.Group ) {
    for ( const l of g.children ) ( l as THREE.Line ).geometry.dispose();
    this.lines.remove( g );
  }

  /**
   * Redraws outlines ( all shapes while the tool is active, else just the selected one ) and handles.
  **/
  sync() {
    const st  = useEditor.getState();
    const sel = this.selected();
    this.clearLines();
    // ( every shape while the tool is out, or the view's Show All Paths is on )
    const show = st.tool === "shape" || st.showPaths ? st.shapes : sel ? [sel] : [];
    const kept = new Set<string>();
    for ( const s of show ) {
      const color = s.uid === sel?.uid ? SELECTED : COLOR, had = this.outlines.get( s.uid );
      kept.add( s.uid );
      if ( had && had.s === s && had.color === color ) continue;
      if ( had ) this.dropOutline( had.g );
      const g   = new THREE.Group();
      this.into = g;
      this.outline( s, color );
      this.into = this.lines;
      this.lines.add( g );
      this.outlines.set( s.uid, { s, color, g } );
    }
    for ( const [uid, o] of this.outlines )
      if ( !kept.has( uid ) ) {
        this.dropOutline( o.g );
        this.outlines.delete( uid );
      }
    this.handles.clear();
    if ( this.picked && ( this.picked.uid !== sel?.uid || sel.kind !== "formation" || this.picked.i >= sel.points.length ) ) this.picked = null;
    // ( the Formation tool: every formation's points; else the selected shape's handles )
    if ( this.forming() ) for ( const f of this.formations() ) for ( const [h, p] of this.handlePoints( f ) ) this.addHandle( h, p, f );
    else if ( sel && !st.locked[sel.uid] ) for ( const [h, p] of this.handlePoints( sel ) ) this.addHandle( h, p, sel );
  }

  /**
   * The edge of a formation's outline nearest `at` ( not at one of its points ), within reach: the formation, the side
   * ( from point `i` to the next ) and the spot on it.
  **/
  private edgeNear( at: [number, number] ): { s: FormationShape; i: number; p: [number, number] } | null {
    let best: { s: FormationShape; i: number; p: [number, number] } | null = null, bd = Infinity;
    for ( const s of this.formations() ) {
      const e = this.edgeAt( s, at );
      if ( !e ) continue;
      const d = Math.hypot( e.p[0] - at[0], e.p[1] - at[1] );
      if ( d < bd ) {
        bd   = d;
        best = { s, ...e };
      }
    }
    return best;
  }

  /**
   * The selected formation's edge near `at` ( not at one of its points ): the side it's on ( from point `i` to the
   * next ) and the spot on it.
  **/
  private edgeAt( s: Shape | null, [x, z]: [number, number] ): { i: number; p: [number, number] } | null {
    if ( s?.kind !== "formation" || useEditor.getState().locked[s.uid] || s.points.length < 2 ) return null;
    const near                                         = this.handleSize( s ) * 2.5;
    let best: { i: number; p: [number, number] } | null = null, bd = near;
    // ( two points: the one side; three on: closed round )
    for ( let i = 0; i < ( s.points.length < 3 ? 1 : s.points.length ); i++ ) {
      const [ax, az] = s.points[i], [bx, bz] = s.points[( i + 1 ) % s.points.length];
      const ux       = bx - ax, uz = bz - az, l2 = ux * ux + uz * uz || 1;
      const t        = Math.max( 0, Math.min( 1, ( ( x - ax ) * ux + ( z - az ) * uz ) / l2 ) );
      const px       = ax + ux * t, pz = az + uz * t, d = Math.hypot( x - px, z - pz );
      // ( not on a point: that's picking it )
      if ( d < bd && Math.hypot( px - ax, pz - az ) > near && Math.hypot( px - bx, pz - bz ) > near ) {
        bd   = d;
        best = { i, p: [px, pz] };
      }
    }
    return best;
  }

  /**
   * The mouse over the ground ( no button down ): over a formation's edge, where a click puts a point in.
  **/
  hover( hit: THREE.Vector3 | null ) {
    const u = this.forming() && !this.drag && hit ? toUnity( hit ) : null;
    const e = u ? this.edgeNear( [u[0], u[2]] ) : null;
    if ( !e ) {
      if ( this.ghost.visible ) redraw();
      return void ( this.ghost.visible = false );
    }
    redraw();
    const size         = this.handleSize( e.s );
    this.ghost.visible = true;
    this.ghost.position.copy( toThree( [e.p[0], ground( e.p[0], e.p[1] ) + size, e.p[1]] ) );
    this.ghost.scale.setScalar( size * 0.8 );
  }

  /**
   * X / Delete: the picked point taken out of its formation ( its last: the formation with it ). True when there was
   * one.
  **/
  deletePoint() {
    const p = this.picked, s = p && this.formation( p.uid );
    if ( !p || !s ) return false;
    this.picked = null;
    if ( s.points.length <= 1 ) {
      deleteShape( s.uid );
      return true;
    }
    // ( fitted to what's left, if it hadn't been yet: Map-Tools' RefitAfterAreaEdit )
    const next = { ...s, points: s.points.filter( ( _, i ) => i !== p.i ) };
    liveShape( !s.fitted && next.points.length >= 3 ? fitFormation( next ) : next, "Delete point" );
    commitShape();
    this.sync();
    return true;
  }

  /**
   * Enter / Escape with the Formation tool out: the picked point let go ( the next click starts a new formation ).
   * True when there was one.
  **/
  done() {
    if ( !this.forming() || !this.picked ) return false;
    this.picked = null;
    useEditor.getState().setSelection( [] );
    return true;
  }

  /**
   * Two formations made one outline, joined at a point of each: `a`'s round to its point, then `b`'s from its point
   * ( `dropped`: `a`'s point was let go on `b`'s, the one point now ). One undo step; `a`'s settings kept.
  **/
  private join( a: { uid: string; i: number }, b: { uid: string; i: number }, dropped: boolean ) {
    const A = this.formation( a.uid ), B = this.formation( b.uid );
    if ( !A || !B || A === B ) return;
    // ( each outline taken round from its point, either way; the way that bridges the two the shortest is used, so the
    // join doesn't cross itself )
    type P         = [number, number];
    const round    = ( p: P[], k: number ) => [...p.slice( ( ( k % p.length ) + p.length ) % p.length ), ...p.slice( 0, ( ( k % p.length ) + p.length ) % p.length )];
    const ends     = [round( A.points, a.i + 1 ), round( A.points, a.i ).reverse()].map( ( q ) => ( dropped ? q.slice( 0, -1 ) : q ) );
    const starts   = [round( B.points, b.i ), round( B.points, b.i + 1 ).reverse()];
    const gap      = ( p: P, q: P ) => Math.hypot( p[0] - q[0], p[1] - q[1] );
    let best: P[]  = [], mine: P[] = [], most = Infinity;
    for ( const e of ends )
      for ( const s of starts ) {
        const d = gap( e[e.length - 1] ?? s[0], s[0] ) + gap( s[s.length - 1], e[0] ?? s[0] );
        if ( d < most ) {
          most = d;
          mine = e;
          best = [...e, ...s];
        }
      }
    const next  = { ...A, points: best };
    this.picked = { uid: A.uid, i: mine.length };
    liveShape( next, "Join formations" );
    commitShape();
    deleteShape( B.uid );
    history.mergeLast( 2, "Join formations" );
    useEditor.getState().setSelection( [{ kind: "shape", uid: A.uid }] );
  }

  private polyline( pts: [number, number][], mat: THREE.LineBasicNodeMaterial ) {
    const l       = new THREE.Line( new THREE.BufferGeometry().setFromPoints( pts.map( ( [x, z] ) => toThree( [x, ground( x, z ) + 0.08, z] ) ) ), mat );
    l.renderOrder = 9;
    this.into.add( l );
  }

  private outline( s: Shape, color: number ) {
    const mat  = this.lineMat( color );
    // ( a formation: closed round from three points; its line so far before that )
    if ( s.kind === "formation" ) return s.points.length > 1 ? this.polyline( s.points.length > 2 ? [...s.points, s.points[0]] : s.points, mat ) : undefined;
    // ( a ski line: drawn and edited by its own tool, viewport/tools/skiLineTool.ts )
    if ( s.kind === "skiline" ) return undefined;
    const line = ( pts: [number, number][] ) => {
      const v       = pts.map( ( [x, z] ) => toThree( [x, ground( x, z ) + 0.08, z] ) );
      const l       = new THREE.Line( new THREE.BufferGeometry().setFromPoints( v ), mat );
      l.renderOrder = 9;
      this.into.add( l );
    };
    const N = 48;
    if ( s.kind === "stamp" ) {
      line( stampCorners( s ) );
      return;
    }
    if ( s.kind === "circle" ) {
      line( Array.from( { length: N + 1 }, ( _, i ) => {
        const a = ( i / N ) * Math.PI * 2;
        return [s.center[0] + Math.sin( a ) * s.radius, s.center[1] + Math.cos( a ) * s.radius] as [number, number];
      } ) );
      return;
    }
    const [ax, az] = s.start, [bx, bz] = s.end;
    const len      = Math.hypot( bx - ax, bz - az ) || 1;
    const rx       = ( bz - az ) / len, rz = -( bx - ax ) / len; // right-hand side
    const side     = ( o: number ) =>
      Array.from( { length: N + 1 }, ( _, i ) => [ax + ( ( bx - ax ) * i ) / N + rx * o, az + ( ( bz - az ) * i ) / N + rz * o] as [number, number] );
    line( side( 0            ) );
    line( side( s.width / 2  ) );
    line( side( -s.width / 2 ) );
    line( [[ax + rx * s.width / 2, az + rz * s.width / 2], [ax - rx * s.width / 2, az - rz * s.width / 2]] );
    line( [[bx + rx * s.width / 2, bz + rz * s.width / 2], [bx - rx * s.width / 2, bz - rz * s.width / 2]] );
  }

  private handlePoints( s: Shape ): [Handle, [number, number]][] {
    if ( s.kind === "formation" ) return s.points.map( ( p, i ) => [i, p] );
    if ( s.kind === "skiline" ) return [];
    if ( s.kind === "curve" || s.kind === "paint" ) return [["start", s.start], ["end", s.end]];
    if ( s.kind === "stamp" ) {
      const a = ( s.rotation * Math.PI ) / 180, r = ( ( s.grid.h - 1 ) * s.grid.spacing ) / 2 + 1.5;
      return [["center", s.center], ["rotate", [s.center[0] + Math.sin( a ) * r, s.center[1] + Math.cos( a ) * r]]];
    }
    return [["center", s.center], ["radius", [s.center[0] + s.radius, s.center[1]]]];
  }

  private handleSize( s: Shape ) {
    return s.kind === "formation" ? Math.max( 0.5, ( Math.max( ...s.points.map( ( p ) => p[0] ) ) - Math.min( ...s.points.map( ( p ) => p[0] ) ) ) * 0.015 )
      : s.kind === "curve" || s.kind === "paint" ? Math.max( 0.35, s.width * 0.06 )
      : s.kind === "circle" ? Math.max( 0.35, s.radius * 0.05 )
      : s.kind === "stamp" ? Math.max( 0.35, s.grid.w * s.grid.spacing * 0.03 )
      : 0.5;
  }

  private addHandle( h: Handle, [x, z]: [number, number], s: Shape ) {
    const size = this.handleSize( s );
    const m    = new THREE.Mesh( this.handleGeo, this.picked?.uid === s.uid && this.picked.i === h ? this.pickedMat : this.handleMat );
    m.position.copy( toThree( [x, ground( x, z ) + size, z] ) );
    m.scale.setScalar( size );
    m.renderOrder = 11;
    m.userData    = { handle: h, uid: s.uid };
    this.handles.add( m );
  }

  /**
   * Pointer down at screen point; true if the tool took it.
  **/
  down( x: number, y: number, e: { ctrlKey?: boolean } = {} ): boolean {
    const st  = useEditor.getState();
    const hit = this.raycast( x, y ).intersectObjects( this.handles.children, false )[0];
    if ( hit ) {
      const h = hit.object.userData.handle as Handle, s = st.shapes.find( ( q ) => q.uid === hit.object.userData.uid );
      if ( s?.kind === "formation" && typeof h === "number" ) {
        // ( Ctrl: the picked point's formation joined to this one, here )
        if ( e.ctrlKey && this.picked && this.picked.uid !== s.uid ) {
          this.join( this.picked, { uid: s.uid, i: h }, false );
          return true;
        }
        this.grabPoint( s, h );
        return true;
      }
      if ( s ) {
        this.drag = { kind: "handle", handle: h, shape: s };
        return true;
      }
    }
    if ( st.tool !== "shape" || st.shapeKind === "skiline" ) return false;
    const p = this.pickTerrain( x, y );
    if ( !p ) return false;
    const u                    = toUnity( p );
    const at: [number, number] = [u[0], u[2]];
    if ( this.forming() ) {
      // near an outline: a point put in it there; the ground, with a formation picked: a point put into its side
      // nearest the click ( under three points, on after the picked one ); else a new formation begun
      const edge = this.edgeNear( at ), from = this.picked && this.formation( this.picked.uid );
      // ( a point put in: the formation fitted to its outline again, as Map-Tools does while points are added )
      const into = ( s: FormationShape, k: number, p: [number, number] ) => {
        const next = { ...s, points: [...s.points.slice( 0, k ), p, ...s.points.slice( k )] };
        this.grabPoint( next.points.length >= 3 ? fitFormation( next ) : next, k, "Add point" );
      };
      if ( edge ) into( edge.s, edge.i + 1, edge.p );
      else if ( from ) into( from, from.points.length >= 3 ? nearestSide( from.points, at ) + 1 : this.picked!.i + 1, at );
      else this.grabPoint( newFormation( [at] ), 0, "Add formation" );
      this.ghost.visible = false;
      return true;
    }
    this.drag = { kind: "draw", at, shape: null };
    return true;
  }

  /**
   * A formation's point picked and taken hold of ( `label`: the formation's changed to `s` first, a point put in ).
  **/
  private grabPoint( s: FormationShape, i: number, label?: string ) {
    if ( label ) liveShape( s, label );
    this.picked = { uid: s.uid, i };
    this.drag   = { kind: "handle", handle: i, shape: s };
    useEditor.getState().setSelection( [{ kind: "shape", uid: s.uid }] );
    this.sync();
  }

  /**
   * The ground under the cursor; while a shape is being made or dragged, the ground under it as if it weren't there
   * ( picked on its own surface, its end would hop onto the ramp it makes and back off it, move after move ).
  **/
  private pick( x: number, y: number, dragged: Shape | null ) {
    if ( !dragged ) return this.pickTerrain( x, y );
    const r = this.raycast( x, y ).ray;
    return terrain.raycast( r.origin, r.direction, 20000, groundWithout( dragged.uid ) );
  }

  move( x: number, y: number ): boolean {
    const d = this.drag;
    if ( !d ) return false;
    const p = this.pick( x, y, d.shape );
    if ( !p ) return true;
    const u                    = toUnity( p );
    const at: [number, number] = [u[0], u[2]];
    if ( d.kind === "handle" ) {
      const s = d.shape;
      let next: Shape;
      if ( s.kind === "skiline" ) return true;
      if ( s.kind === "formation" ) next = { ...s, points: s.points.map( ( p, i ) => ( i === d.handle ? at : p ) ) };
      else if ( s.kind === "curve" || s.kind === "paint" ) next = d.handle === "start" ? { ...s, start: at } : { ...s, end: at };
      else if ( d.handle === "center" ) next = { ...s, center:   at };
      else if ( s.kind   === "stamp"  ) next = { ...s, rotation: ( Math.atan2( at[0] - s.center[0], at[1] - s.center[1] ) * 180 ) / Math.PI };
      else next = { ...s, radius: Math.max( 1, Math.hypot( at[0] - s.center[0], at[1] - s.center[1] ) ) };
      d.shape   = next;
      liveShape( next, "Move shape" );
      return true;
    }
    const dist = Math.hypot( at[0] - d.at[0], at[1] - d.at[1] );
    if ( !d.shape && dist < 1 ) return true; // still a click
    const kind = useEditor.getState().shapeKind;
    const set  = shapeToolSettings;
    if ( kind === "stamp" ) {
      // dragging out the area to copy: just a box until the button is let go
      d.box   = at;
      d.shape = null;
      this.sync();
      const [ax, az]                = d.at;
      const box: [number, number][] = [[ax, az], [at[0], az], [at[0], at[1]], [ax, at[1]], [ax, az]];
      const l                       = new THREE.Line( new THREE.BufferGeometry().setFromPoints( box.map( ( [x, z] ) => toThree( [x, ground( x, z ) + 0.1, z] ) ) ), this.lineMat( SELECTED, 1 ) );
      l.renderOrder                 = 9;
      this.lines.add( l );
      return true;
    }
    let next: Shape;
    if ( kind === "circle" ) {
      next = d.shape?.kind === "circle" ? { ...d.shape, radius: Math.max( 1, dist ) } : { ...newCircle( d.at, dist ), depth: set.height };
    } else if ( d.shape?.kind === "curve" ) next = { ...d.shape, end: at };
    else {
      const preset        = PROFILES[set.preset];
      const c: CurveShape = { ...newCurve( d.at, at ), width: set.width, name: preset.label, profile: structuredClone( preset.curve ) };
      // new runs sit on the slope they're drawn on, the profile rising `height` above it
      next                = { ...c, heightMode: "bump", bump: set.height, lipAngle: set.preset === "kicker" ? set.lipAngle : null };
    }
    d.shape = next;
    liveShape( next, kind === "circle" ? "Add circle" : `Add ${next.name.toLowerCase()}` );
    return true;
  }

  up() {
    const d   = this.drag;
    this.drag = null;
    if ( !d ) return;
    if ( d.kind === "draw" && d.box ) {
      const [ax, az] = d.at, [bx, bz] = d.box;
      if ( Math.abs( bx - ax ) < 1 || Math.abs( bz - az ) < 1 ) return this.sync();
      const grid  = captureStamp( Math.min( ax, bx ), Math.min( az, bz ), Math.max( ax, bx ), Math.max( az, bz ) );
      // the copy starts on top of what it copied, selected, ready to drag somewhere else by its centre handle
      const stamp = newStamp( [( ax + bx ) / 2, ( az + bz ) / 2], grid, true );
      liveShape( stamp, "Copy terrain" );
      commitShape();
      useEditor.getState().setSelection( [{ kind: "shape", uid: stamp.uid }] );
      return;
    }
    if ( d.kind === "handle" && d.shape.kind === "formation" && typeof d.handle === "number" ) {
      // ( let go on another formation's point: the two joined there )
      const p = d.shape.points[d.handle], near = this.handleSize( d.shape ) * 1.5;
      for ( const f of this.formations() ) {
        if ( f.uid === d.shape.uid ) continue;
        const j = f.points.findIndex( ( q ) => Math.hypot( q[0] - p[0], q[1] - p[1] ) < near );
        if ( j >= 0 ) return this.join( { uid: d.shape.uid, i: d.handle }, { uid: f.uid, i: j }, true );
      }
    }
    if ( d.kind === "draw" && !d.shape ) {
      // a click: select the shape under the cursor ( or clear the selection )
      const st    = useEditor.getState();
      const under = [...st.shapes].reverse().find( ( s ) => !st.locked[s.uid] && shapeHeightAt( s, d.at[0], d.at[1] ) !== null );
      st.setSelection( under ? [{ kind: "shape", uid: under.uid }] : [] );
      return;
    }
    if ( d.kind === "draw" && d.shape ) {
      const s = d.shape;
      const tooSmall =
        s.kind === "curve" ? Math.hypot( s.end[0] - s.start[0], s.end[1] - s.start[1] ) < 1.5 : s.kind === "circle" ? s.radius < 1.5 : false;
      if ( tooSmall ) return cancelShape();
      commitShape();
      useEditor.getState().setSelection( [{ kind: "shape", uid: s.uid }] );
      return;
    }
    commitShape();
  }

  get dragging() {
    return !!this.drag;
  }


}

/**
 * The side of a closed outline a new point goes into ( its first point's index ): the one it lengthens the outline
 * least, between the two points nearest it ( the nearest side alone, at a corner two sides share, could fold the
 * outline over itself ).
**/
function nearestSide( pts: [number, number][], [x, z]: [number, number] ) {
  let best = 0, bd = Infinity;
  for ( let i = 0; i < pts.length; i++ ) {
    const [ax, az] = pts[i], [bx, bz] = pts[( i + 1 ) % pts.length];
    const d        = Math.hypot( x - ax, z - az ) + Math.hypot( x - bx, z - bz ) - Math.hypot( bx - ax, bz - az );
    if ( d < bd ) {
      bd   = d;
      best = i;
    }
  }
  return best;
}

/**
 * The four corners ( closed ) of a stamp's footprint, turned by its rotation.
**/
export function stampCorners( s: StampShape ): [number, number][] {
  const hw = ( ( s.grid.w - 1 ) * s.grid.spacing ) / 2, hh = ( ( s.grid.h - 1 ) * s.grid.spacing ) / 2;
  const a  = ( s.rotation * Math.PI ) / 180, c = Math.cos( a ), si = Math.sin( a );
  return ( [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]] as [number, number][] ).map( ( [x, z] ) => [
    s.center[0] + x * c + z * si,
    s.center[1] - x * si + z * c,
  ] );
}
