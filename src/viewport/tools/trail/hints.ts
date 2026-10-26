// The Trails tool's hints: the point a click would put in a run, the point a dragged one would join.

import * as THREE from "three/webgpu";
import { toThree, toUnity } from "../../../core/coords";
import { useEditor } from "../../../map/store";
import { nearestOnRun, nodeOf, pointOnRun, type TrailNet } from "../../../trails/trails";
import { redraw } from "../../redraw";
import type { TrailTool } from "./trailTool";
import { V3, POINT, JOIN } from "./trailTool";

// What a click or a drop would do.
export class TrailHints {
  constructor( private tool: TrailTool ) {}

  // Where a point being moved would join if let go ( a point, or a spot on a run ), drawn as a ring.
  joinHint: V3 | null = null;

  hintFor( net: TrailNet, id: string ) {
    const onto = this.pointNear( net, id );
    if ( onto ) {
      this.joinHint = nodeOf( net, onto ).p;
      return;
    }
    const under   = this.runOnScreen( net, id );
    this.joinHint = under ? under.at : null;
  }

  /**
   * The run ( not one of point `id`'s own ) drawn under the point where it is on screen, and where along it: what a
   * point dragged onto a run joins ( a point moved across the view by the gizmo isn't on the ground beneath it ).
  **/
  runOnScreen( net: TrailNet, id: string ): { run: string; t: number; at: V3 } | null {
    const n   = nodeOf( net, id ), cam = this.tool.camera();
    const q   = toThree( n.p ).project( cam );
    const ray = new THREE.Raycaster();
    ray.setFromCamera( new THREE.Vector2( q.x, q.y ), cam );
    const own = new Set( net.runs.filter( ( r ) => r.a === id || r.b === id ).map( ( r ) => r.id ) );
    const hit = ray.intersectObjects( this.tool.ribbons.children, true ).find( ( h ) => h.object.userData.pickRun && !own.has( h.object.userData.pickRun ) );
    if ( !hit ) return null;
    const r = net.runs.find( ( x ) => x.id === hit.object.userData.pickRun );
    if ( !r ) return null;
    const u = toUnity( hit.point ), t = nearestOnRun( net, r, u[0], u[2] ).t;
    if ( t <= 0.05 || t >= 0.95 ) return null;
    return { run: r.id, t, at: [u[0], u[1], u[2]] };
  }

  /**
   * The mouse moved with nothing held: over a run's centre line, the point a click would put there shown.
  **/
  hover( x: number, y: number, ctrl: boolean ) {
    const st = useEditor.getState();
    if ( st.tool !== "trail" ) return this.setGhost( null );
    const g = this.ghostAt( x, y, st.trails );
    this.setGhost( g, ctrl && this.tool.picked().nodes.size === 1 );
  }

  setGhost( g: { run: string; t: number; p: V3 } | null, joining = false ) {
    if ( !g && !this.tool.ghostMark.visible ) return;
    this.tool.ghostMark.visible = !!g;
    if ( !g ) return redraw();
    this.tool.ghostMark.position.copy( toThree( g.p ) );
    this.tool.ghostMark.material = this.tool.mat( "mark", joining ? JOIN : POINT, 0.6 );
    this.tool.frame();
    redraw();
  }

  /**
   * The point a click at ( x, y ) would put in a run: on the centre line of the run under the mouse, where it's within
   * a few pixels of it on screen ( not near its ends or another point ).
  **/
  ghostAt( x: number, y: number, net: TrailNet ): { run: string; t: number; p: V3 } | null {
    const ray = this.tool.raycast( x, y );
    if ( ray.intersectObjects( this.tool.marks.children.filter( ( c ) => ( c as THREE.Mesh ).isMesh ), false ).length ) return null;
    const hit = ray.intersectObjects( this.tool.ribbons.children, true ).find( ( h ) => h.object.userData.pickRun );
    const r   = hit && net.runs.find( ( q ) => q.id === hit.object.userData.pickRun );
    if ( !hit || !r ) return null;
    const u = toUnity( hit.point ), q = nearestOnRun( net, r, u[0], u[2] ), t = q.t;
    if ( t <= 0.04 || t >= 0.96 ) return null;
    // ( within a third of its half width of the line, too: from far off, the rest of the run picks it )
    if ( q.d > ( ( r.wa + ( r.wb - r.wa ) * t ) / 2 ) * 0.33 ) return null;
    const p   = pointOnRun( net, r, t );
    const cam = this.tool.camera(), h = this.tool.viewHeight(), w = h * cam.aspect;
    const scr = ( v: V3 ) => {
      const q = toThree( v ).project( cam );
      return [( q.x * 0.5 + 0.5 ) * w, ( -q.y * 0.5 + 0.5 ) * h] as const;
    };
    const s = scr( p );
    if ( Math.hypot( s[0] - x, s[1] - y ) > 12 ) return null;
    for ( const n of net.nodes ) {
      const q = scr( n.p );
      if ( Math.hypot( q[0] - s[0], q[1] - s[1] ) < 18 ) return null;
    }
    return { run: r.id, t, p };
  }

  /**
   * Whether a point, handle or other mark of the trails is under the mouse ( a press there takes it, not the gizmo over
   * it ).
  **/
  markUnder( x: number, y: number ) {
    return this.tool.raycast( x, y ).intersectObjects( this.tool.marks.children.filter( ( c ) => ( c as THREE.Mesh ).isMesh ), false ).length > 0;
  }

  clearHint() {
    this.joinHint = null;
  }

  /**
   * Another point within a dozen pixels of point `id` on screen, if one is.
  **/
  pointNear( net: TrailNet, id: string ): string | null {
    const cam = this.tool.camera(), h = this.tool.viewHeight(), w = h * cam.aspect;
    const scr = ( p: [number, number, number] ) => {
      const q = toThree( p ).project( cam );
      return [( q.x * 0.5 + 0.5 ) * w, ( -q.y * 0.5 + 0.5 ) * h, q.z] as const;
    };
    const me                = scr( nodeOf( net, id ).p );
    let best: string | null = null, bd = 12;
    for ( const n of net.nodes ) {
      if ( n.id === id ) continue;
      const q = scr( n.p );
      if ( q[2] > 1 ) continue;
      const d = Math.hypot( q[0] - me[0], q[1] - me[1] );
      if ( d < bd ) { bd = d; best = n.id; }
    }
    return best;
  }
}
