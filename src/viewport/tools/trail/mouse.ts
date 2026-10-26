// The Trails tool's mouse: points laid and picked, runs joined, points, handles, corners and widths dragged.

import * as THREE from "three/webgpu";
import { toThree, toUnity } from "../../../core/coords";
import { useEditor } from "../../../map/store";
import { terrain } from "../../../terrain/terrain";
import { addPoint, cancelPreview, commitMoved, commitTrails, connect, joinDropped, layInto, previewNet, snapGround, withHandle, withPointAt } from "../../../trails/edits";
import { nearestOnRun, nodeOf, splitRun } from "../../../trails/trails";
import type { TrailTool } from "./trailTool";
import { V3, Grab } from "./trailTool";

// The mouse on the trails.
export class TrailMouse {
  constructor( private tool: TrailTool ) {}

  private grab: Grab | null = null;

  /**
   * Pointer down ( the Trails tool out ): true when it took it.
  **/
  down( x: number, y: number, e: { shiftKey: boolean; ctrlKey: boolean } ): boolean {
    const st  = useEditor.getState();
    const ray = this.tool.raycast( x, y );
    const hit = ray.intersectObjects( this.tool.marks.children.filter( ( c ) => ( c as THREE.Mesh ).isMesh ), false )[0];
    const net = st.trails;
    if ( !hit?.object.userData.end && st.trailHandle ) useEditor.setState( { trailHandle: null } );
    if ( hit ) {
      const d = hit.object.userData as { node?: string; run?: string; end?: "a" | "b"; which?: "corner" | "mid"; index?: number; widthEnd?: "a" | "b" };
      if ( d.widthEnd && d.run ) {
        const r   = net.runs.find( ( x ) => x.id === d.run )!;
        const w   = this.tool.widthHandle( net, r, d.widthEnd );
        this.grab = { kind: "width", run: d.run, end: d.widthEnd, centre: w.centre, out: w.out, plane: new THREE.Plane().setFromNormalAndCoplanarPoint( new THREE.Vector3( 0, 1, 0 ), w.at ), moved: false, net };
        return true;
      }
      if ( d.node ) {
        const { nodes } = this.tool.picked();
        // Ctrl+click: the picked point joined to this one
        if ( e.ctrlKey && nodes.size === 1 && !nodes.has( d.node ) ) {
          connect( [...nodes][0], d.node );
          st.setSelection( [{ kind: "trailNode", uid: d.node }] );
          return true;
        }
        if ( e.shiftKey ) {
          st.setSelection( nodes.has( d.node ) ? st.selection.filter( ( s ) => s.uid !== d.node ) : [...st.selection, { kind: "trailNode", uid: d.node }] );
          return true;
        }
        if ( !nodes.has( d.node ) || nodes.size > 1 ) st.setSelection( [{ kind: "trailNode", uid: d.node }] );
        const p     = toThree( nodeOf( net, d.node ).p );
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint( new THREE.Vector3( 0, 1, 0 ), p );
        const on    = ray.ray.intersectPlane( plane, new THREE.Vector3() );
        this.grab   = { kind: "node", id: d.node, plane, off: on ? p.clone().sub( on ) : new THREE.Vector3(), moved: false, net };
        return true;
      }
      if ( d.end && d.run ) {
        // ( the gizmo goes on it: it moves in any direction, up and down too )
        useEditor.setState( { trailHandle: { run: d.run, end: d.end } } );
        const r     = net.runs.find( ( x ) => x.id === d.run )!;
        const n     = nodeOf( net, d.end === "a" ? r.a : r.b );
        const h     = d.end === "a" ? r.ha : r.hb;
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint( new THREE.Vector3( 0, 1, 0 ), toThree( [n.p[0] + h[0], n.p[1] + h[1], n.p[2] + h[2]] ) );
        this.grab   = { kind: "handle", run: d.run, end: d.end, plane, moved: false, net };
        return true;
      }
      if ( d.which && d.run !== undefined && d.index !== undefined ) {
        const r     = net.runs.find( ( x ) => x.id === d.run )!;
        const start = d.which === "corner" ? r.corners[d.index] : r.mids[d.index];
        this.grab   = { kind: "height", run: d.run, which: d.which, index: d.index, y0: y, start, at: hit.object.position.clone(), moved: false, net };
        return true;
      }
    }
    // the point shown on a run's centre line: put in the run there ( Ctrl, with a point picked: joined to it too )
    const ghost = this.tool.hints.ghostAt( x, y, net );
    if ( ghost ) {
      const { nodes: pickedNodes } = this.tool.picked();
      const from                   = e.ctrlKey && pickedNodes.size === 1 ? [...pickedNodes][0] : null;
      const made                   = from ? layInto( from, ghost.run, ghost.p ) : null;
      let node                     = made;
      if ( !node ) {
        const next = structuredClone( net );
        node       = splitRun( next, ghost.run, ghost.t );
        commitTrails( next, "Add point" );
      }
      this.tool.hints.setGhost( null );
      st.setSelection( [{ kind: "trailNode", uid: node }] );
      return true;
    }
    const onRun = ray.intersectObjects( this.tool.ribbons.children, true ).find( ( h ) => h.object.userData.pickRun );
    if ( onRun ) {
      const id                     = onRun.object.userData.pickRun as string;
      // laying a trail ( a point picked ) and clicking another run: the new run joins it there
      const { nodes: pickedNodes } = this.tool.picked();
      if ( !e.ctrlKey && !e.shiftKey && pickedNodes.size === 1 ) {
        const cut = layInto( [...pickedNodes][0], id, toUnity( onRun.point ) );
        if ( cut ) {
          st.setSelection( [{ kind: "trailNode", uid: cut }] );
          return true;
        }
      }
      // Ctrl+click on a run: a point put in it there
      if ( e.ctrlKey ) {
        const next = structuredClone( net ), u = toUnity( onRun.point );
        const node = splitRun( next, id, Math.min( 0.95, Math.max( 0.05, nearestOnRun( next, next.runs.find( ( r ) => r.id === id )!, u[0], u[2] ).t ) ) );
        commitTrails( next, "Add point" );
        st.setSelection( [{ kind: "trailNode", uid: node }] );
        return true;
      }
      const has = st.selection.some( ( s ) => s.uid === id );
      st.setSelection( e.shiftKey ? ( has ? st.selection.filter( ( s ) => s.uid !== id ) : [...st.selection, { kind: "trailRun", uid: id }] ) : [{ kind: "trailRun", uid: id }] );
      return true;
    }
    // the ground: a new point, joined on from the picked point ( if one is )
    const g = this.tool.pickTerrain( x, y );
    if ( !g ) {
      st.setSelection( [] );
      return true;
    }
    const { nodes } = this.tool.picked();
    const from      = nodes.size === 1 ? [...nodes][0] : null;
    const u         = toUnity( g );
    const made      = addPoint( [u[0], u[1], u[2]], from );
    useEditor.getState().setSelection( [{ kind: "trailNode", uid: made.node }] );
    return true;
  }

  move( x: number, y: number ) {
    const gr = this.grab;
    if ( !gr ) return;
    const ray = this.tool.raycast( x, y ).ray;
    if ( gr.kind === "node" ) {
      // ( Follow Ground: on the snow under the mouse; else level, at its own height )
      const g = snapGround( gr.net );
      if ( g ) {
        const hit = terrain.raycast( ray.origin, ray.direction, 20000, ( x, z ) => g( x, z ) );
        if ( !hit ) return;
        const p    = toUnity( hit );
        gr.moved   = true;
        const next = withPointAt( gr.net, gr.id, [p[0], p[1], p[2]] as V3 );
        this.tool.hints.hintFor( next, gr.id );
        previewNet( next );
        return;
      }
      const on = ray.intersectPlane( gr.plane, new THREE.Vector3() );
      if ( !on ) return;
      const p    = toUnity( on.add( gr.off ) );
      gr.moved   = true;
      const next = withPointAt( gr.net, gr.id, [p[0], nodeOf( gr.net, gr.id ).p[1], p[2]] as V3 );
      this.tool.hints.hintFor( next, gr.id );
      previewNet( next );
    } else if ( gr.kind === "width" ) {
      // the end's width: twice the mouse's distance from its middle, less the handle's offset
      const on = ray.intersectPlane( gr.plane, new THREE.Vector3() );
      if ( !on ) return;
      const half  = Math.hypot( on.x - gr.centre.x, on.z - gr.centre.z ) - gr.out;
      const width = Math.max( 2, Math.round( half * 2 * 2 ) / 2 );
      const net   = structuredClone( gr.net ), r = net.runs.find( ( q ) => q.id === gr.run )!;
      if ( gr.end === "a" ) r.wa = width;
      else r.wb = width;
      gr.moved  = true;
      previewNet( net );
    } else if ( gr.kind === "handle" ) {
      const on = ray.intersectPlane( gr.plane, new THREE.Vector3() );
      if ( !on ) return;
      const r  = gr.net.runs.find( ( q ) => q.id === gr.run )!;
      const n  = nodeOf( gr.net, gr.end === "a" ? r.a : r.b ).p, u = toUnity( on );
      const h  = gr.end === "a" ? r.ha : r.hb;
      gr.moved = true;
      previewNet( withHandle( gr.net, gr.run, gr.end, [u[0] - n[0], h[1], u[2] - n[2]] ) );
    } else {
      // up and down the screen: metres at the handle's distance
      const cam = this.tool.camera();
      const mpp = ( 2 * Math.tan( THREE.MathUtils.degToRad( cam.fov ) / 2 ) * cam.position.distanceTo( gr.at ) ) / Math.max( 1, this.tool.viewHeight() );
      const v   = Math.round( ( gr.start + ( gr.y0 - y ) * mpp ) * 10 ) / 10;
      const net = structuredClone( gr.net ), r = net.runs.find( ( q ) => q.id === gr.run )!;
      r.fit     = false;
      if ( gr.which === "corner" ) r.corners[gr.index] = v;
      else r.mids[gr.index] = v;
      gr.moved = true;
      previewNet( net );
    }
  }

  up() {
    const gr  = this.grab;
    this.grab = null;
    if ( !gr ) return;
    if ( !gr.moved ) return cancelPreview();
    let net                  = useEditor.getState().trails;
    this.tool.hints.joinHint = null;
    if ( gr.kind === "node" ) {
      const joined = joinDropped( net, gr.id, this.tool.hints.pointNear( net, gr.id ), this.tool.hints.runOnScreen( net, gr.id ) );
      if ( joined ) {
        net = joined.net;
        commitTrails( net, "Join" );
        useEditor.getState().setSelection( [{ kind: "trailNode", uid: joined.node }] );
        return;
      }
    }
    if ( gr.kind === "node" ) return commitMoved( net, [gr.id], "Move point" );
    if ( gr.kind === "handle" || gr.kind === "width" ) {
      const r = net.runs.find( ( x ) => x.id === gr.run )!;
      return commitMoved( net, [gr.end === "a" ? r.a : r.b], gr.kind === "width" ? "Change width" : "Turn run end" );
    }
    commitTrails( net, "Change run height" );
  }

  get dragging() {
    return !!this.grab;
  }
}
