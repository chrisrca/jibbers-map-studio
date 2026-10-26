// The transform gizmo: what it's on ( the selection, a trail point or handle, a rail's point, a lift's piece ) and what
// its drags do.

import * as THREE from "three/webgpu";
import { toThree, toUnity, unityEulerToQuat, type V3 } from "../../core/coords";
import { applyToTRS, transformCustom } from "../../core/transform";
import { arr3, type CustomObjectEntry, type ObjectEntry, type SpawnEntry } from "../../core/types";
import { history } from "../../map/history";
import { unlocked, useEditor, workspaceOf } from "../../map/store";
import { cancelPreview, commitMoved, commitTrails, joinDropped, previewNet, withHandle, withPointAt } from "../../trails/edits";
import type { TrailNet } from "../../trails/trails";
import { BlGizmo } from "../tools/gizmo/blGizmo";
import type { Engine } from "./engine";

// The transform gizmo: where it sits, and its drags.
export class GizmoControl {
  constructor( private engine: Engine ) {}

  // a trail point being moved with the gizmo: where it was, and the trails then
  private trailFrom: { id:      string; end?: "a" | "b"; node?: V3; nodeId?: string; at: THREE.Vector3; net: TrailNet } | null = null;
  // a rail's point ( or its arrow ) as a gizmo drag began
  private railFrom:  { at:      THREE.Vector3; q: THREE.Quaternion; point: number | null } | null = null;
  // what was selected as an Object Mode drag began ( put back if it's cancelled )
  private before:    { objects: ObjectEntry[]; spawns: SpawnEntry[]; customObjects: CustomObjectEntry[]; pivot: THREE.Vector3 | null } | null = null;

  /**
   * The picked handle's tip ( and the point it's on ), while one is picked with the Trails tool.
  **/
  private trailHandleTip() {
    const st = useEditor.getState(), h = st.trailHandle;
    const r  = h && st.trails.runs.find( ( x ) => x.id === h.run );
    if ( !h || !r ) return null;
    const node = st.trails.nodes.find( ( n ) => n.id === ( h.end === "a" ? r.a : r.b ) )!.p, v = h.end === "a" ? r.ha : r.hb;
    return { run: r.id, end: h.end, node, nodeId: h.end === "a" ? r.a : r.b, at: [node[0] + v[0], node[1] + v[1], node[2] + v[2]] as V3 };
  }

  private selectionCenter(): THREE.Vector3 | null {
    const { selection, objects, spawns, customObjects, locked } = useEditor.getState();
    const pts: THREE.Vector3[] = [];
    for ( const s of selection ) {
      if ( locked[s.uid] ) continue;
      if ( s.kind === "custom" ) {
        const c = customObjects.find( ( o ) => o.uid === s.uid );
        if ( c ) pts.push( toThree( arr3( c.position ) ) );
        continue;
      }
      const e = s.kind === "object" ? objects.find( ( o ) => o.uid === s.uid ) : spawns.find( ( o ) => o.uid === s.uid );
      if ( e ) pts.push( toThree( e.position ) );
    }
    if ( !pts.length ) return null;
    return pts.reduce( ( a, b ) => a.add( b ), new THREE.Vector3() ).divideScalar( pts.length );
  }

  sync() {
    const g = this.engine.blGizmo;
    if ( !g || g.dragging ) return;
    const st = useEditor.getState();
    // editing a rail: Move moves its picked point ( nothing while none is ), Rotate turns the arrow halfway along it,
    // the whole rail's way up
    if ( st.railEdit ) {
      const turning = st.gizmoMode === "rotate";
      const arrow   = turning ? this.engine.railTool.arrowFrame() : null;
      const p       = turning ? ( arrow?.at ?? null ) : st.railEdit.point !== null ? this.engine.railTool.pointInView( st.railEdit.point ) : null;
      if ( !p || ( st.tool !== "select" && st.tool !== "model" && st.tool !== "material" ) ) return g.detach();
      g.setMode( turning ? "rotate" : "translate" );
      return g.attach( p, arrow ? arrow.q : new THREE.Quaternion(), !!arrow );
    }
    if ( workspaceOf( st.tool ) === "assets" ) return this.syncAssets();
    // the Trails tool: Move on the picked handle, else on the one picked point
    if ( st.tool === "trail" ) {
      const tip = this.trailHandleTip();
      if ( tip ) {
        g.setMode( "translate" );
        return g.attach( toThree( tip.at ), new THREE.Quaternion(), false );
      }
      const one = st.selection.length === 1 && st.selection[0].kind === "trailNode" ? st.trails.nodes.find( ( n ) => n.id === st.selection[0].uid ) : null;
      if ( !one ) return g.detach();
      g.setMode( "translate" );
      return g.attach( toThree( one.p ), new THREE.Quaternion(), false );
    }
    // a lift: Move on its piece picked ( each station and mast is moved on its own; there's no moving the lift as one )
    const piece = st.tool === "select" && !this.engine.editing && unlocked( st, st.selection ).length ? this.engine.liftTool.gizmoAt() : null;
    if ( piece ) {
      g.setMode( "translate" );
      return g.attach( piece, new THREE.Quaternion(), false );
    }
    // the map: on what's selected while the Select tool is out, as its Move / Rotate / Scale says
    const c = this.selectionCenter();
    if ( !c || st.tool !== "select" || this.engine.editing ) return g.detach();
    g.setMode( st.gizmoMode );
    g.attach( c, this.mapOrientation(), st.view3d.orientation === "local" );
  }

  /**
   * The map's gizmo turned as the header's orientation says: the world's axes, or the one selected thing's own.
  **/
  private mapOrientation() {
    const st = useEditor.getState();
    if ( st.view3d.orientation !== "local" ) return new THREE.Quaternion();
    const moving       = unlocked( st, st.selection );
    const one          = moving.length === 1 ? moving[0] : null;
    let rot: V3 | null = null;
    if ( one?.kind === "object" ) rot = st.objects.find( ( o ) => o.uid === one.uid )?.rotation ?? null;
    else if ( one?.kind === "custom" ) {
      const o = st.customObjects.find( ( x ) => x.uid === one.uid );
      if ( o ) rot = arr3( o.rotation );
    }
    return rot ? unityEulerToQuat( rot ) : new THREE.Quaternion();
  }

  /**
   * The Move / Rotate / Scale / Transform tools' gizmo: on what's selected ( the corners in Edit Mode ), turned as the
   * header's orientation says.
  **/
  private syncAssets() {
    const st    = useEditor.getState(), g = this.engine.blGizmo;
    const modes = { move: "translate", rotate: "rotate", scale: "scale", transform: "transform" } as const;
    const mode  = modes[st.modelTool as keyof typeof modes];
    if ( !mode || !st.view3d.gizmos || st.tool !== "model" ) return g.detach();
    g.setMode( mode );
    if ( this.engine.editing ) {
      const p = this.engine.editing === this.engine.modelEd ? this.engine.modelEd.gizmo.pivot() : null;
      const o = p && st.customObjects.find( ( x ) => x.uid === this.engine.modelEd.uid );
      if ( !p || !o ) return g.detach();
      return g.attach( p, st.view3d.orientation === "local" ? unityEulerToQuat( arr3( o.rotation ) ) : new THREE.Quaternion(), st.view3d.orientation === "local" );
    }
    const c = this.objectPivot();
    if ( !c ) return g.detach();
    g.attach( c, this.objectOrientation(), st.view3d.orientation === "local" );
  }

  wire() {
    const g = ( this.engine.blGizmo = new BlGizmo( {
      camera: this.engine.camera,
      host:   this.engine.host,
      ray:    ( x, y ) => this.engine.ray( x, y ),
      snapping: () => {
        const t = useEditor.getState().modelTools;
        return { on: t.snap, to: t.snapTo };
      },
      snapPoint: ( x, y, to ) => ( this.engine.editing === this.engine.modelEd && this.engine.modelEd.uid ? this.engine.modelEd.gizmo.snapTarget( x, y, to ) : this.objectSnapPoint( x, y, to ) ),
    } ) );
    g.onStart = () => {
      if ( this.engine.editing === this.engine.modelEd && this.engine.modelEd.uid ) return this.engine.modelEd.gizmo.start();
      const st = useEditor.getState();
      if ( st.tool === "trail" ) {
        const tip      = this.trailHandleTip();
        const one      = st.selection[0]?.kind === "trailNode" ? st.trails.nodes.find( ( n ) => n.id === st.selection[0].uid ) : null;
        this.trailFrom = tip ? { id: tip.run, end: tip.end, node: tip.node, nodeId: tip.nodeId, at: toThree( tip.at ), net: st.trails } : one ? { id: one.id, at: toThree( one.p ), net: st.trails } : null;
        return;
      }
      if ( st.railEdit ) {
        const arrow            = st.gizmoMode === "rotate" ? this.engine.railTool.arrowFrame() : null;
        const at               = arrow?.at ?? ( st.railEdit.point !== null ? this.engine.railTool.pointInView( st.railEdit.point ) : null );
        this.engine.rails.drag = st.customObjects;
        this.railFrom          = at ? { at, q: arrow?.q ?? new THREE.Quaternion(), point: st.railEdit.point } : null;
        return;
      }
      // ( a lift's piece picked: it's what moves )
      if ( st.tool === "select" && this.engine.liftTool.gizmoStart() ) return;
      this.before = { objects: st.objects, spawns: st.spawns, customObjects: st.customObjects, pivot: this.objectPivot() };
    };
    g.onChange = ( delta ) => {
      if ( this.engine.editing === this.engine.modelEd && this.engine.modelEd.uid ) return this.engine.modelEd.gizmo.move( delta );
      if ( this.trailFrom ) {
        const f = this.trailFrom, p = toUnity( f.at.clone().applyMatrix4( delta ) );
        if ( f.end && f.node ) return previewNet( withHandle( f.net, f.id, f.end, [p[0] - f.node[0], p[1] - f.node[1], p[2] - f.node[2]] ) );
        const next = withPointAt( f.net, f.id, p );
        this.engine.trailTool.hints.hintFor( next, f.id );
        return previewNet( next );
      }
      if ( this.engine.rails.drag ) {
        const f = this.railFrom;
        if ( !f ) return;
        // turned: the arrow's up is the rail's way up
        if ( g.mode === "rotate" ) return void this.engine.railTool.previewUp( new THREE.Vector3( 0, 1, 0 ).applyQuaternion( new THREE.Quaternion().setFromRotationMatrix( delta ).multiply( f.q ) ) );
        const p = this.engine.railTool.toPiece( f.at.clone().applyMatrix4( delta ) );
        if ( f.point !== null && p ) this.engine.railTool.preview( f.point, p );
        return;
      }
      if ( this.engine.liftTool.gizmoMoving ) return this.engine.liftTool.gizmoMove( delta );
      if ( this.before ) this.applyDelta( delta, this.before );
    };
    g.onEnd = () => {
      const label = { translate: "Move", rotate: "Rotate", scale: "Resize", transform: "Transform" }[g.mode];
      if ( this.engine.editing === this.engine.modelEd && this.engine.modelEd.uid ) {
        this.engine.modelEd.gizmo.end( label );
      } else if ( this.trailFrom ) {
        const f        = this.trailFrom;
        this.trailFrom = null;
        const net      = useEditor.getState().trails;
        // ( a point let go on another, or on a run: joined there )
        this.engine.trailTool.hints.clearHint();
        const joined = !f.end && net !== f.net ? joinDropped( net, f.id, this.engine.trailTool.hints.pointNear( net, f.id ), this.engine.trailTool.hints.runOnScreen( net, f.id ) ) : null;
        if ( joined ) {
          commitTrails( joined.net, "Join" );
          useEditor.getState().setSelection( [{ kind: "trailNode", uid: joined.node }] );
        } else if ( net !== f.net ) commitMoved( net, [f.end ? f.nodeId! : f.id], f.end ? "Turn run end" : "Move point" );
      } else if ( this.engine.rails.drag ) {
        this.engine.rails.drag = null;
        this.railFrom          = null;
        this.engine.rails.commit( g.mode === "rotate" ? "Turn rail" : "Move rail point" );
      } else if ( this.engine.liftTool.gizmoMoving ) {
        this.engine.liftTool.gizmoEnd();
      } else if ( this.before ) {
        const prev  = this.before, s = useEditor.getState();
        const after = { objects: s.objects, spawns: s.spawns, customObjects: s.customObjects };
        this.before = null;
        if ( after.objects !== prev.objects || after.spawns !== prev.spawns || after.customObjects !== prev.customObjects ) {
          history.push( {
            label,
            undo: () => useEditor.setState( { objects: prev.objects, spawns: prev.spawns, customObjects: prev.customObjects, dirty: true } ),
            redo: () => useEditor.setState( { ...after, dirty: true } ),
          } );
          useEditor.setState( { dirty: true } );
        }
      }
      this.sync();
    };
    g.onCancel = () => {
      if ( this.engine.editing === this.engine.modelEd && this.engine.modelEd.uid ) this.engine.modelEd.gizmo.cancel();
      else if ( this.trailFrom ) {
        this.trailFrom = null;
        cancelPreview();
      } else if ( this.engine.rails.drag ) {
        // ( the rail as it is in the map again )
        this.engine.rails.drag = null;
        this.railFrom          = null;
        this.engine.rails.sync();
      }
      else if ( this.engine.liftTool.gizmoMoving ) this.engine.liftTool.gizmoCancel();
      else if ( this.before ) {
        const was   = this.before;
        this.before = null;
        useEditor.setState( { objects: was.objects, spawns: was.spawns, customObjects: was.customObjects } );
      }
      this.sync();
    };
    this.engine.scene.add( g.group );
  }

  /**
   * Where Object Mode turns and scales about ( the header's pivot point ): the origins' middle, their bounds' middle,
   * the active one's, or the 3D cursor.
  **/
  private objectPivot(): THREE.Vector3 | null {
    const st = useEditor.getState();
    if ( !this.engine.stage.shown ) return this.selectionCenter();
    const pts = unlocked( st, st.selection ).flatMap( ( s ) => {
      const o = st.customObjects.find( ( x ) => x.uid === s.uid );
      return o ? [toThree( arr3( o.position ) )] : [];
    } );
    if ( !pts.length ) return null;
    const how = st.modelTools.pivot;
    if ( how === "cursor" ) return toThree( st.cursor3d );
    if ( how === "active" ) return pts[pts.length - 1];
    if ( how === "bounds" ) return new THREE.Box3().setFromPoints( pts ).getCenter( new THREE.Vector3() );
    return pts.reduce( ( a, b ) => a.add( b ), new THREE.Vector3() ).divideScalar( pts.length );
  }

  /**
   * The header's orientation: the world's axes, or the active piece's own.
  **/
  private objectOrientation() {
    const st   = useEditor.getState();
    const last = st.selection[st.selection.length - 1];
    const o    = last && st.customObjects.find( ( x ) => x.uid === last.uid );
    return st.view3d.orientation === "local" && o ? unityEulerToQuat( arr3( o.rotation ) ) : new THREE.Quaternion();
  }

  /**
   * G / R / S in Object Mode: the selection moved, turned or scaled with the mouse ( Blender's modal transform ).
  **/
  startObjectModal( op: "translate" | "rotate" | "scale" ) {
    const st    = useEditor.getState();
    // ( a lift's picked piece is only moved: G, from where it stands )
    const piece = this.engine.stage.shown ? null : this.engine.liftTool.gizmoAt();
    if ( piece && op !== "translate" ) return false;
    const c = piece ?? this.objectPivot();
    if ( !c || !unlocked( st, st.selection ).length || this.engine.blGizmo.dragging ) return false;
    this.engine.blGizmo.attach( c, this.objectOrientation(), st.view3d.orientation === "local" );
    this.engine.blGizmo.begin( op, this.engine.mouse.x, this.engine.mouse.y );
    return true;
  }

  /**
   * What a moved piece snaps onto under the mouse: the nearest corner on the screen of a piece that isn't moving,
   * or the surface of one ( else the floor ).
  **/
  private objectSnapPoint( x: number, y: number, to: "vertex" | "surface" ): THREE.Vector3 | null {
    const st = useEditor.getState(), moving = new Set( st.selection.map( ( s ) => s.uid ) );
    if ( to === "surface" ) {
      const hits = this.engine.ray( x, y ).intersectObjects( this.engine.customR.pickables(), false );
      const h    = hits.find( ( x2 ) => !moving.has( ( x2.object.userData as { uid?: string } ).uid ?? "" ) );
      return h ? h.point.clone() : this.engine.pointAt( x, y );
    }
    let best: THREE.Vector3 | null = null, bd = 20, budget = 200000;
    const v                        = new THREE.Vector3();
    for ( const o of st.customObjects ) {
      if ( moving.has( o.uid ) ) continue;
      const g = this.engine.customR.objectGroup( o.uid );
      g?.updateMatrixWorld( true );
      g?.traverse( ( m ) => {
        const pos = ( m as THREE.Mesh ).isMesh ? ( ( m as THREE.Mesh ).geometry.getAttribute( "position" ) as THREE.BufferAttribute | undefined ) : undefined;
        if ( !pos || budget <= 0 ) return;
        budget -= pos.count;
        for ( let i = 0; i < pos.count; i++ ) {
          v.fromBufferAttribute( pos, i ).applyMatrix4( m.matrixWorld );
          const [sx, sy, front] = this.engine.screenOf( v );
          const d               = Math.hypot( sx - x, sy - y );
          if ( front && d < bd ) { bd = d; best = v.clone(); }
        }
      } );
    }
    return best;
  }

  /**
   * Applies a world-space delta matrix to the selection, relative to a start snapshot.
  **/
  private applyDelta( delta: THREE.Matrix4, start: { objects: ObjectEntry[]; spawns: SpawnEntry[]; customObjects: CustomObjectEntry[] } ) {
    const st  = useEditor.getState();
    const sel = unlocked( st, st.selection );
    const ids = new Set( sel.map( ( s ) => s.uid ) );
    // Individual Origins: each turned and scaled about its own ( the change moved from the pivot to it )
    const P   = ( start as { pivot?: THREE.Vector3 | null } ).pivot;
    const own = this.engine.stage.shown && st.modelTools.pivot === "individual" && P
      ? ( o: CustomObjectEntry ) => {
          const at = toThree( arr3( o.position ) ), d = at.clone().sub( P );
          return new THREE.Matrix4().makeTranslation( d.x, d.y, d.z ).multiply( delta ).multiply( new THREE.Matrix4().makeTranslation( -d.x, -d.y, -d.z ) );
        }
      : () => delta;
    // ( scale is kept positive: dragged through zero it comes out mirrored, which the game can't load )
    const xf = ( pos: V3, rot: V3, scl: V3 ) => applyToTRS( delta, pos, rot, scl );
    useEditor.setState( {
      customObjects: start.customObjects.map( ( o ) => ( ids.has( o.uid ) ? transformCustom( o, own( o ) ) : o ) ),
      objects:       start.objects.map( ( o ) => ( ids.has( o.uid ) ? { ...o, ...xf( o.position, o.rotation, o.scale ) } : o ) ),
      spawns: start.spawns.map( ( s ) => {
        if ( !ids.has( s.uid ) ) return s;
        const r   = xf( s.position, s.rotation, [1, 1, 1] );
        // rotate the velocity with the spawn
        const rot = new THREE.Quaternion();
        delta.decompose( new THREE.Vector3(), rot, new THREE.Vector3() );
        const v = toUnity( toThree( s.velocity ).applyQuaternion( rot ) );
        return { ...s, position: r.position, rotation: r.rotation, velocity: v };
      } ),
    } );
  }
}
