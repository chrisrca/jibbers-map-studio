// Edit Mode's Loop Cut and Slide ( Ctrl+R ): a ring of edges cut across, then slid along.

import * as THREE from "three/webgpu";
import { ekv } from "../../../model/mesh";
import { edgeRing, loopCut } from "../../../model/ops";
import type { ModelEditor } from "./modelEditor";

// Loop Cut and Slide.
export class ModelLoopCut {
  constructor( private ed: ModelEditor ) {}

  start() {
    this.ed.modal = { kind: "loopcut", cuts: 1, edge: null, preview: [] };
    this.hover( this.ed.mouse.x, this.ed.mouse.y );
  }

  hover( x: number, y: number ) {
    const m = this.ed.modal;
    if ( m?.kind !== "loopcut" ) return;
    const o = this.ed.obj();
    if ( !o ) return;
    // ( the nearest edge within reach, as Blender's: the edges needn't be hit exactly )
    const k   = this.ed.picking.pickEdge( x, y, 60 );
    m.edge    = k;
    m.preview = [];
    if ( k ) {
      const g                = o.model.mesh, M = this.ed.matrix( o );
      const { ring, closed } = edgeRing( g, k );
      for ( let j = 0; j < m.cuts; j++ ) {
        const t   = ( j + 1 ) / ( m.cuts + 1 );
        const pts = ring.map( ( [a, b] ) => this.ed.world( o, g.v[a], M ).lerp( this.ed.world( o, g.v[b], M ), t ) );
        if ( closed && pts.length ) pts.push( pts[0] );
        m.preview.push( pts );
      }
    }
    this.ed.statusText = `Loop Cut: ${m.cuts} cut${m.cuts > 1 ? "s" : ""} (scroll), click to cut`;
    this.ed.publish();
    this.ed.drawPreview();
  }

  apply() {
    const m = this.ed.modal;
    if ( m?.kind !== "loopcut" || !m.edge ) return this.ed.cancel();
    const o      = this.ed.obj()!;
    const r      = loopCut( o.model.mesh, m.edge, m.cuts, 0 );
    this.ed.sel  = r.sel;
    this.ed.mode = "edge";
    this.ed.setMesh( r.mesh, null );
    if ( m.cuts === 1 ) {
      // then slide it ( right-click: leave it in the middle )
      const g            = o.model.mesh, [a, b] = ekv( m.edge ), M = this.ed.matrix( o );
      const [ax, ay]     = this.ed.picking.screen( this.ed.world( o, g.v[a], M ) ), [bx, by] = this.ed.picking.screen( this.ed.world( o, g.v[b], M ) );
      this.ed.modal      = { kind: "slide", o0: o, mesh0: o.model.mesh, edge: m.edge, cuts: 1, x0: this.ed.mouse.x, y0: this.ed.mouse.y, along: new THREE.Vector2( bx - ax, by - ay ) };
      this.ed.statusText = "Edge Slide: move the mouse, click to keep";
      this.ed.publish();
      this.ed.drawPreview();
      return;
    }
    this.ed.modal = null;
    this.ed.drawPreview();
    this.ed.commitFrom( o, "Loop cut" );
  }

  runSlide() {
    const m = this.ed.modal;
    if ( m?.kind !== "slide" ) return;
    const l     = m.along.length() || 1;
    const t     = ( ( this.ed.mouse.x - m.x0 ) * m.along.x + ( this.ed.mouse.y - m.y0 ) * m.along.y ) / ( l * l );
    const slide = Math.max( -0.98, Math.min( 0.98, t * 2 ) );
    const r     = loopCut( m.mesh0, m.edge, 1, slide );
    this.ed.sel = r.sel;
    this.ed.setMesh( r.mesh, null );
  }
}
