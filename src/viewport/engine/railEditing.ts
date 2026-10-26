// Editing a piece's grind rail in the view ( Properties › Rail › Edit points ): its points added, moved, deleted.

import { type CustomObjectEntry } from "../../core/types";
import { useEditor } from "../../map/store";
import { partsFor } from "../../pieces/library";
import { insertAt, railPath, withRail, type P3 } from "../../pieces/rail";
import type { Engine } from "./engine";

// A piece's grind rail being edited.
export class RailEditing {
  constructor( private engine: Engine ) {}

  // the pieces before a rail point drag ( the point moves on screen; it's kept when the drag ends )
  drag: CustomObjectEntry[] | null = null;

  sync() {
    const st    = useEditor.getState();
    const re    = st.railEdit;
    const piece = re ? ( st.customObjects.find( ( o ) => o.uid === re.uid ) ?? null ) : null;
    if ( !this.drag ) this.engine.railTool.sync( piece, re?.point ?? null, st.gizmoMode === "rotate" );
    this.engine.customR.guides.hide( piece?.rail ? piece.uid : null );
    if ( !this.drag ) this.engine.gizmo.sync();
  }

  async refitParts( uid: string ) {
    const o = useEditor.getState().customObjects.find( ( x ) => x.uid === uid );
    if ( !o?.rail || o.rail.points.length < 2 || o.rail.solid === false ) return;
    const body = await partsFor( o, o.rail );
    if ( !body ) return;
    // derived from the piece and its rail, so no step of its own to undo
    useEditor.setState( ( s ) => ( { customObjects: s.customObjects.map( ( x ) => ( x.uid === uid && x.rail ? withRail( x, { ...x.rail, ...body } ) : x ) ), dirty: true } ) );
  }

  /**
   * Keeps the rail's points and its way up as shown ( after a drag, a turn, a deletion, a new point ); its colliders are
   * made again.
  **/
  commit( label: string, points: P3[] = this.engine.railTool.livePoints(), up: P3 = this.engine.railTool.liveUp() ) {
    const st  = useEditor.getState();
    const uid = st.railEdit?.uid;
    if ( !st.customObjects.some( ( x ) => x.uid === uid && x.rail ) ) return;
    st.commit( label, { customObjects: st.customObjects.map( ( x ) => ( x.uid === uid && x.rail ? withRail( x, { ...x.rail, points, up } ) : x ) ) } );
  }

  /**
   * Ctrl+click on the piece: a point there ( the rail's middle is its thickness below the surface clicked ).
  **/
  addPointAt( x: number, y: number ) {
    const st  = useEditor.getState();
    const o   = st.customObjects.find( ( c ) => c.uid === st.railEdit?.uid );
    const g   = o ? this.engine.customR.objectGroup( o.uid ) : null;
    const hit = g ? this.engine.ray( x, y ).intersectObjects( g.children, false )[0] : undefined;
    const p   = hit ? this.engine.railTool.toPiece( hit.point ) : null;
    if ( !o?.rail || !p ) return;
    p[1]     -= o.rail.radius;
    const pts = this.engine.railTool.livePoints();
    const at  = insertAt( pts, p );
    pts.splice( at, 0, p );
    this.commit( "Add rail point", pts );
    useEditor.setState( { railEdit: { uid: o.uid, point: at } } );
  }

  /**
   * A new point halfway along the rail after the picked one ( before it, at the far end ).
  **/
  addPoint() {
    const st = useEditor.getState();
    const o  = st.customObjects.find( ( c ) => c.uid === st.railEdit?.uid );
    if ( !o?.rail ) return;
    const pts  = this.engine.railTool.livePoints();
    const i    = Math.max( 0, Math.min( st.railEdit!.point ?? pts.length - 2, pts.length - 2 ) );
    const path = railPath( { ...o.rail, points: pts }, 12 );
    const mid  = pts.length >= 3 ? path[i * 12 + 6] : path[0].clone().add( path[1] ).multiplyScalar( 0.5 );
    pts.splice( i + 1, 0, [mid.x, mid.y, mid.z] );
    this.commit( "Add rail point", pts );
    useEditor.setState( { railEdit: { uid: o.uid, point: i + 1 } } );
  }

  /**
   * Deletes the picked point ( a rail keeps two at least ).
  **/
  deletePoint() {
    const st = useEditor.getState();
    const i  = st.railEdit?.point;
    if ( i === null || i === undefined ) return;
    const pts = this.engine.railTool.livePoints();
    if ( pts.length <= 2 ) return void st.toast( "A rail needs two points at least", "info" );
    pts.splice( i, 1 );
    this.commit( "Delete rail point", pts );
    useEditor.setState( { railEdit: { uid: st.railEdit!.uid, point: null } } );
  }
}
