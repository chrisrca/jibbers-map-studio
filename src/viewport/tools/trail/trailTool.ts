// The Trails tool in the viewport: the runs drawn over the ground, their points, the selected run's height handles and
// the selected point's turning handles. A click on the ground adds a point ( joined on from the selected one ), a point
// or run is picked by clicking it, handles are dragged. Changes go through trails/edits.ts ( drawn while dragging, the
// ground made on letting go ).

import * as THREE from "three/webgpu";
import { toThree } from "../../../core/coords";
import { useEditor } from "../../../map/store";
import { surfaceOf, type Surface } from "../../../trails/surface";
import { handlePoints, nodeOf, runsAt, runStrip, type TrailNet, type TrailRun } from "../../../trails/trails";
import { redraw } from "../../redraw";
import { TrailDrawing } from "./drawing";
import { TrailHints } from "./hints";
import { TrailMouse } from "./mouse";

export type V3 = [number, number, number];

export const RUN    = 0x4f9cf0;
export const PICKED = 0xffb000;
export const POINT  = 0xffffff;
export const HEIGHT = 0x7ee787;
export const HANDLE = 0xff5a36;
export const WIDTH  = 0x58c4f6;
export const JOIN   = 0x3fe08a;
// how see-through the runs' shape is
export const FILL   = 0.28;

// A run as the shape is drawn from it: its surface ( v: which one ), picked or not, its narrowest half width.
export type Shaped = { id: string; S: Surface; v: number; picked: boolean; half: number };

export type Grab =
  | { kind: "node";   id:  string; plane: THREE.Plane; off: THREE.Vector3; moved: boolean; net: TrailNet }
  | { kind: "handle"; run: string; end:   "a" | "b"; plane: THREE.Plane; moved: boolean; net: TrailNet }
  | { kind: "height"; run: string; which: "corner" | "mid"; index: number; y0: number; start: number; at: THREE.Vector3; moved: boolean; net: TrailNet }
  | { kind: "width";  run: string; end:   "a" | "b"; centre: THREE.Vector3; out: number; plane: THREE.Plane; moved: boolean; net: TrailNet };

// metres across a tile of the runs' drawn shape
export const TILE = 64;

/**
 * metres a width handle sits out from its run's edge ( half its width, at least 8 m: clear of the corner's handle )
**/
export const widthOut = ( w: number ) => Math.max( 8, w * 0.5 );

export class TrailTool {
  // its parts, each in a file of its own beside this one
  readonly drawing = new TrailDrawing( this ); // the runs drawn
  readonly mouse   = new TrailMouse( this );   // the mouse on the trails
  readonly hints   = new TrailHints( this );   // what a click or a drop would do

  readonly group = new THREE.Group();
  ribbons        = new THREE.Group();
  // the runs drawn as one shape ( in tiles )
  shape          = new THREE.Group();
  marks          = new THREE.Group();
  // the point a click puts in the run under the mouse ( shown hovering its centre line )
  ghostMark: THREE.Mesh;
  private ball = new THREE.SphereGeometry( 1, 14, 10 );
  private mats = new Map<string, THREE.Material>();

  constructor(
    readonly raycast:     ( x: number, y: number ) => THREE.Raycaster,
    readonly pickTerrain: ( x: number, y: number ) => THREE.Vector3 | null,
    readonly camera:     () => THREE.PerspectiveCamera,
    readonly viewHeight: () => number,
  ) {
    this.ghostMark             = new THREE.Mesh( this.ball, this.mat( "mark", POINT, 0.6 ) );
    this.ghostMark.visible     = false;
    this.ghostMark.renderOrder = 13;
    this.group.add( this.ribbons, this.shape, this.marks, this.ghostMark );
    this.marks.renderOrder = 12;
  }

  mat( kind: "fill" | "pick" | "line" | "mark", color: number, opacity: number ) {
    const key = `${kind}/${color}/${opacity}`;
    let m     = this.mats.get( key );
    if ( !m ) {
      m =
        kind === "fill" ? new THREE.MeshBasicNodeMaterial( { vertexColors: true, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } )
        : kind === "pick" ? new THREE.MeshBasicNodeMaterial( { side: THREE.DoubleSide } )
        : kind === "line" ? new THREE.LineBasicNodeMaterial( { color, transparent: true, opacity, depthTest: false } )
        : new THREE.MeshBasicNodeMaterial( { color, transparent: true, opacity, depthTest: false } );
      this.mats.set( key, m );
    }
    return m;
  }

  private clear( g: THREE.Group ) {
    for ( const c of g.children ) if ( ( c as THREE.Mesh ).geometry && ( c as THREE.Mesh ).geometry !== this.ball ) ( c as THREE.Mesh ).geometry.dispose();
    g.clear();
  }

  picked() {
    const sel = useEditor.getState().selection;
    return { nodes: new Set( sel.filter( ( s ) => s.kind === "trailNode" ).map( ( s ) => s.uid ) ), runs: new Set( sel.filter( ( s ) => s.kind === "trailRun" ).map( ( s ) => s.uid ) ) };
  }

  private warmed = false;

  /**
   * Every look the trails are drawn with, made ready on the GPU in the background the first time the tool is out ( made
   * when first drawn instead, they held a frame up for a second and a half ).
  **/
  warmUp( renderer: THREE.WebGPURenderer, camera: THREE.Camera, scene: THREE.Scene ) {
    if ( this.warmed ) return;
    this.warmed = true;
    const g     = new THREE.Group();
    const tri   = new THREE.BufferGeometry().setAttribute( "position", new THREE.BufferAttribute( new Float32Array( 9 ), 3 ) );
    tri.setAttribute( "color", new THREE.BufferAttribute( new Float32Array( 9 ), 3 ) );
    for ( const [kind, color, opacity] of [
      ["fill", RUN,   FILL],
      ["line", RUN,   0.9 ], ["line", RUN, 0.45], ["line", PICKED, 0.9], ["line", PICKED, 0.45],
      ["mark", POINT, 0.95], ["mark", POINT, 0.6], ["mark", JOIN, 0.6], ["mark", PICKED, 0.95], ["mark", HEIGHT, 0.95], ["mark", HANDLE, 0.95], ["mark", WIDTH, 0.95], ["line", WIDTH, 0.9], ["mark", JOIN, 0.95],
    ] as const ) {
      const m = this.mat( kind, color, opacity );
      g.add( kind === "line" ? new THREE.Line( tri, m ) : new THREE.Mesh( kind === "mark" ? this.ball : tri, m ) );
    }
    for ( const c of [RUN, PICKED] ) g.add( new THREE.LineSegments( tri, this.mat( "line", c, 0.9 ) ) );
    scene.add( g );
    void renderer.compileAsync( g, camera, scene ).finally( () => {
      scene.remove( g );
      tri.dispose();
    } );
  }

  /**
   * Redraws the trails ( while the tool is out ) and the picked one's handles.
  **/
  sync() {
    const st = useEditor.getState();
    this.clear( this.marks );
    redraw();
    this.ribbons.visible = this.shape.visible = st.tool === "trail";
    if ( st.tool !== "trail" ) {
      this.ghostMark.visible = false;
      return;
    }
    const net   = st.trails, { nodes, runs } = this.picked();
    // runs drawn again only when they ( or what they ease into ) changed: a point dragged on a big map redrew all of
    // them every move
    const alive = new Set<string>(), list: Shaped[] = [];
    for ( const r of net.runs ) {
      alive.add( r.id );
      // ( its surface, by what its shape depends on; a number for each new one, for the tiles' keys )
      const shapeKey = this.drawing.drawKey( net, r );
      let surf       = this.drawing.surfs.get( r.id );
      if ( surf?.key !== shapeKey ) this.drawing.surfs.set( r.id, ( surf = { key: shapeKey, S: surfaceOf( runStrip( net, r, 1 ), 0 ), v: ++this.drawing.made } ) );
      list.push( { id: r.id, S: surf.S, v: surf.v, picked: runs.has( r.id ), half: Math.min( r.wa, r.wb ) / 2 } );
      const key = `${shapeKey}|${runs.has( r.id )}`;
      const had = this.drawing.drawn.get( r.id );
      if ( had?.key === key ) continue;
      if ( had ) this.drawing.drop( had.g );
      const g = this.drawing.drawRun( net, r, runs.has( r.id ) );
      this.ribbons.add( g );
      this.drawing.drawn.set( r.id, { key, g } );
    }
    for ( const [id, d] of [...this.drawing.drawn] ) if ( !alive.has( id ) ) { this.drawing.drop( d.g ); this.drawing.drawn.delete( id ); }
    for ( const id of [...this.drawing.surfs.keys()] ) if ( !alive.has( id ) ) this.drawing.surfs.delete( id );
    this.drawing.drawShape( list );
    for ( const n of net.nodes ) this.mark( toThree( n.p ), nodes.has( n.id ) ? 8 : 6.5, nodes.has( n.id ) ? PICKED : POINT, { node: n.id } );
    // the handles of the runs leaving a picked point, and of a picked run's two ends
    const ends: { r: TrailRun; end: "a" | "b" }[] = [];
    for ( const id of nodes ) for ( const r of runsAt( net, id ) ) ends.push( { r, end: r.a === id ? "a" : "b" } );
    for ( const id of runs ) {
      const r = net.runs.find( ( x ) => x.id === id );
      if ( r ) ends.push( { r, end: "a" }, { r, end: "b" } );
    }
    const on = st.trailHandle;
    for ( const { r, end } of ends ) {
      const n      = nodeOf( net, end === "a" ? r.a : r.b ), h = end === "a" ? r.ha : r.hb;
      const tip    = toThree( [n.p[0] + h[0], n.p[1] + h[1], n.p[2] + h[2]] );
      const active = on?.run === r.id && on.end === end;
      this.line( [toThree( n.p ), tip], PICKED, 0.9 );
      this.mark( tip, active ? 6.5 : 5, active ? HANDLE : PICKED, { run: r.id, end } );
    }
    // a picked run: its corners' and sides' height handles
    for ( const id of runs ) {
      const r = net.runs.find( ( x ) => x.id === id );
      if ( !r ) continue;
      for ( const h of handlePoints( net, r ) ) this.mark( toThree( h.p ), 5.5, HEIGHT, { run: r.id, which: h.which, index: h.index } );
      // its width at each end: a handle out past the right edge, dragged sideways
      for ( const end of ["a", "b"] as const ) {
        const w = this.widthHandle( net, r, end );
        this.line( [w.edge, w.at], WIDTH, 0.9 );
        this.mark( w.at, 5.5, WIDTH, { run: r.id, widthEnd: end } );
      }
    }
    if ( this.hints.joinHint ) {
      this.mark( toThree( this.hints.joinHint ), 13, JOIN, {} );
      this.mark( toThree( this.hints.joinHint ), 7,  JOIN, {} );
    }
    this.frame();
  }

  /**
   * Where a run's width handle for one end is: the end's middle, its right edge, the handle out past it.
  **/
  widthHandle( net: TrailNet, r: TrailRun, end: "a" | "b" ) {
    const hp     = handlePoints( net, r );
    const L      = hp.find( ( h ) => h.which === "corner" && h.index === ( end === "a" ? 0 : 2 ) )!.p, R = hp.find( ( h ) => h.which === "corner" && h.index === ( end === "a" ? 1 : 3 ) )!.p;
    const centre = toThree( [( L[0] + R[0] ) / 2, ( L[1] + R[1] ) / 2, ( L[2] + R[2] ) / 2] ), edge = toThree( R );
    const out    = edge.clone().sub( centre ).setY( 0 ).normalize();
    return { centre, edge, at: edge.clone().addScaledVector( out, widthOut( end === "a" ? r.wa : r.wb ) ), out: widthOut( end === "a" ? r.wa : r.wb ) };
  }

  /**
   * A ball `px` pixels across on screen ( kept so as the view moves: frame() ).
  **/
  private mark( p: THREE.Vector3, px: number, color: number, data: object ) {
    const m = new THREE.Mesh( this.ball, this.mat( "mark", color, 0.95 ) );
    m.position.copy( p );
    m.renderOrder = 13;
    m.userData    = { ...data, px };
    this.marks.add( m );
  }

  /**
   * The points and handles kept the same size on screen, however near or far ( every frame, and when redrawn ).
  **/
  frame() {
    const cam = this.camera(), k = ( 2 * Math.tan( THREE.MathUtils.degToRad( cam.fov ) / 2 ) ) / Math.max( 1, this.viewHeight() );
    if ( this.ghostMark.visible ) this.ghostMark.scale.setScalar( 8 * k * cam.position.distanceTo( this.ghostMark.position ) );
    for ( const c of this.marks.children ) {
      const px = c.userData.px as number | undefined;
      if ( px ) c.scale.setScalar( px * k * cam.position.distanceTo( c.position ) );
    }
  }

  private line( pts: THREE.Vector3[], color: number, opacity: number ) {
    const l       = new THREE.Line( new THREE.BufferGeometry().setFromPoints( pts ), this.mat( "line", color, opacity ) );
    l.renderOrder = 12;
    this.marks.add( l );
  }
}
