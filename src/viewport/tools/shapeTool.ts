// The Shapes tool in the viewport: drawing curves/circles on the terrain, outlines for every shape, and handles
// to drag on the selected one. Edits go through terrain/shapes/edits.ts ( live preview, one undo step per drag ).

import * as THREE from "three/webgpu";
import { toThree, toUnity } from "../../core/coords";
import { PROFILES } from "../../core/curve";
import { cancelShape, commitShape, liveShape } from "../../terrain/shapes/edits";
import { captureStamp, groundWithout, newCircle, newCurve, newStamp, shapeHeightAt, type CurveShape, type Shape, type StampShape } from "../../terrain/shapes/shapes";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";

type Handle = "start" | "end" | "center" | "radius" | "rotate";

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
  private lineMats  = new Map<string, THREE.LineBasicNodeMaterial>();
  private drag:
    | { kind: "draw";   at:     [number, number]; shape: Shape | null; box?: [number, number] }
    | { kind: "handle"; handle: Handle; shape: Shape }
    | null = null;

  constructor( private raycast: ( x: number, y: number ) => THREE.Raycaster, private pickTerrain: ( x: number, y: number ) => THREE.Vector3 | null ) {
    this.group.add( this.lines, this.handles );
    this.handles.renderOrder = 10;
  }

  private selected(): Shape | null {
    const st  = useEditor.getState();
    const sel = st.selection.length === 1 && st.selection[0].kind === "shape" ? st.selection[0].uid : null;
    return sel ? st.shapes.find( ( s ) => s.uid === sel ) ?? null : null;
  }

  private lineMat( color: number, opacity = 0.85 ) {
    let m = this.lineMats.get( `${color}/${opacity}` );
    if ( !m ) this.lineMats.set( `${color}/${opacity}`, ( m = new THREE.LineBasicNodeMaterial( { color, depthTest: false, transparent: true, opacity } ) ) );
    return m;
  }

  /**
   * Lines drawn before go ( their geometry with them ).
  **/
  private clearLines() {
    for ( const l of this.lines.children ) ( l as THREE.Line ).geometry.dispose();
    this.lines.clear();
  }

  /**
   * Redraws outlines ( all shapes while the tool is active, else just the selected one ) and handles.
  **/
  sync() {
    const st  = useEditor.getState();
    const sel = this.selected();
    this.clearLines();
    const show = st.tool === "shape" ? st.shapes : sel ? [sel] : [];
    for ( const s of show ) this.outline( s, s.uid === sel?.uid ? SELECTED : COLOR );
    this.handles.clear();
    if ( sel && !st.locked[sel.uid] ) for ( const [h, p] of this.handlePoints( sel ) ) this.addHandle( h, p, sel );
  }

  private outline( s: Shape, color: number ) {
    const mat  = this.lineMat( color );
    const line = ( pts: [number, number][] ) => {
      const v       = pts.map( ( [x, z] ) => toThree( [x, ground( x, z ) + 0.08, z] ) );
      const l       = new THREE.Line( new THREE.BufferGeometry().setFromPoints( v ), mat );
      l.renderOrder = 9;
      this.lines.add( l );
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
    if ( s.kind === "curve" ) return [["start", s.start], ["end", s.end]];
    if ( s.kind === "stamp" ) {
      const a = ( s.rotation * Math.PI ) / 180, r = ( ( s.grid.h - 1 ) * s.grid.spacing ) / 2 + 1.5;
      return [["center", s.center], ["rotate", [s.center[0] + Math.sin( a ) * r, s.center[1] + Math.cos( a ) * r]]];
    }
    return [["center", s.center], ["radius", [s.center[0] + s.radius, s.center[1]]]];
  }

  private addHandle( h: Handle, [x, z]: [number, number], s: Shape ) {
    const size =
      s.kind === "curve" ? Math.max( 0.35, s.width * 0.06 )
      : s.kind === "circle" ? Math.max( 0.35, s.radius * 0.05 )
      : Math.max( 0.35, s.grid.w * s.grid.spacing * 0.03 );
    const m = new THREE.Mesh( this.handleGeo, this.handleMat );
    m.position.copy( toThree( [x, ground( x, z ) + size, z] ) );
    m.scale.setScalar( size );
    m.renderOrder = 11;
    m.userData    = { handle: h };
    this.handles.add( m );
  }

  /**
   * Pointer down at screen point; true if the tool took it.
  **/
  down( x: number, y: number ): boolean {
    const hit = this.raycast( x, y ).intersectObjects( this.handles.children, false )[0];
    const sel = this.selected();
    if ( hit && sel ) {
      this.drag = { kind: "handle", handle: hit.object.userData.handle as Handle, shape: sel };
      return true;
    }
    if ( useEditor.getState().tool !== "shape" ) return false;
    const p = this.pickTerrain( x, y );
    if ( !p ) return false;
    const u   = toUnity( p );
    this.drag = { kind: "draw", at: [u[0], u[2]], shape: null };
    return true;
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
      if ( s.kind === "curve" ) next = d.handle === "start" ? { ...s, start: at } : { ...s, end: at };
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
