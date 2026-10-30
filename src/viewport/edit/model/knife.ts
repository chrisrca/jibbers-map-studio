// Edit Mode's Knife ( K ): points clicked on corners, edges and faces, the cut walked across the faces between them.

import * as THREE from "three/webgpu";
import { toThree } from "../../../core/coords";
import type { CustomObjectEntry } from "../../../core/types";
import type { ModelData } from "../../../model/build";
import { ekv, faceCenter, faceNormal, type Mesh, type V3 } from "../../../model/mesh";
import { knifeCut, type KnifePoint } from "../../../model/ops";
import type { ModelEditor } from "./modelEditor";
import { KnifeHit } from "./modelEditor";

// The Knife.
export class ModelKnife {
  constructor( private ed: ModelEditor ) {}

  /**
   * K: Knife — click corners, edges ( Ctrl: an edge's middle ) and faces, the cut running across the faces between
   * them as seen; Enter cuts, Esc gives up.
  **/
  start() {
    const o = this.ed.obj();
    if ( !o ) return;
    this.ed.modal = { kind: "knife", o0: o, pts: [], hover: null, preview: [] };
    this.hover( this.ed.mouse.x, this.ed.mouse.y, false );
  }

  /**
   * The corner, edge place or face place under a screen point ( seen, not behind anything ).
  **/
  private at( x: number, y: number, middle: boolean ): KnifeHit | null {
    const o = this.ed.obj();
    if ( !o ) return null;
    const was = this.ed.mode;
    try {
      this.ed.mode = "vert";
      const v      = this.ed.picking.pick( x, y );
      if ( typeof v === "number" ) return { v };
      this.ed.mode = "edge";
      const k      = this.ed.picking.pick( x, y );
      if ( typeof k !== "string" ) {
        // inside a face, not on a corner or an edge
        const h = this.ed.picking.faceHit( x, y );
        return h ? { f: h.f, p: this.ed.toPiece( h.at ) } : null;
      }
      const [a, b]   = ekv( k ), M = this.ed.matrix( o );
      const [ax, ay] = this.ed.picking.screen( this.ed.world( o, o.model.mesh.v[a], M ) ), [bx, by] = this.ed.picking.screen( this.ed.world( o, o.model.mesh.v[b], M ) );
      const dx       = bx - ax, dy = by - ay;
      const t        = middle ? 0.5 : Math.max( 0.02, Math.min( 0.98, ( ( x - ax ) * dx + ( y - ay ) * dy ) / ( dx * dx + dy * dy || 1 ) ) );
      return { a, b, t };
    } finally {
      this.ed.mode = was;
    }
  }

  private pos( g: Mesh, h: KnifeHit ): V3 {
    if ( "v" in h ) return g.v[h.v];
    if ( "f" in h ) return h.p;
    const p = g.v[h.a], q = g.v[h.b];
    return [p[0] + ( q[0] - p[0] ) * h.t, p[1] + ( q[1] - p[1] ) * h.t, p[2] + ( q[2] - p[2] ) * h.t];
  }

  /**
   * The faces a knife point is on.
  **/
  private facesOf( g: Mesh, h: KnifeHit ) {
    const out: number[] = [];
    if ( "f" in h ) return [h.f];
    g.f.forEach( ( f, fi ) => {
      if ( "v" in h ? f.includes( h.v ) : f.some( ( v, i ) => ( v === h.a && f[( i + 1 ) % f.length] === h.b ) || ( v === h.b && f[( i + 1 ) % f.length] === h.a ) ) ) out.push( fi );
    } );
    return out;
  }

  /**
   * The knife's way from one point to the next across the faces facing the view: where it crosses edges, then the
   * last point ( as Blender's knife, cutting what's seen ).
  **/
  private walk( o: CustomObjectEntry & { model: ModelData }, A: KnifeHit, B: KnifeHit ): KnifeHit[] {
    const g          = o.model.mesh, M = this.ed.matrix( o );
    const scr        = ( p: V3 ) => this.ed.picking.screen( this.ed.world( o, p, M ) );
    const [sax, say] = scr( this.pos( g, A ) ), [sbx, sby] = scr( this.pos( g, B ) );
    const cam        = this.ed.view.camera.position;
    const facing     = ( fi: number ) => {
      const c = this.ed.world( o, faceCenter( g, fi ), M );
      const n = toThree( faceNormal( g, fi ) ).transformDirection( M );
      return n.dot( cam.clone().sub( c ) ) > 0;
    };
    const bFaces          = new Set( this.facesOf( g, B ) );
    const out: KnifeHit[] = [];
    let P                 = A, s0 = 0, prev = -1;
    for ( let step = 0; step < 256; step++ ) {
      const faces = this.facesOf( g, P ).filter( ( f ) => f !== prev && facing( f ) );
      if ( faces.some( ( f ) => bFaces.has( f ) ) ) break;
      let best: { s: number; hit: KnifeHit; f: number } | null = null;
      for ( const fi of faces ) {
        const f = g.f[fi];
        for ( let i = 0; i < f.length; i++ ) {
          const u = f[i], w = f[( i + 1 ) % f.length];
          // not the edge ( or corner ) it's on
          if ( "f" in P ? false : "v" in P ? u === P.v || w === P.v : ( u === P.a && w === P.b ) || ( u === P.b && w === P.a ) ) continue;
          const [ux, uy] = scr( g.v[u] ), [wx, wy] = scr( g.v[w] );
          const rx       = sbx - sax, ry = sby - say, qx = wx - ux, qy = wy - uy;
          const den      = rx * qy - ry * qx;
          if ( Math.abs( den ) < 1e-9 ) continue;
          const s = ( ( ux - sax ) * qy - ( uy - say ) * qx ) / den, r = ( ( ux - sax ) * ry - ( uy - say ) * rx ) / den;
          if ( s    <= s0 + 1e-6 || s > 1 || r < -1e-6 || r > 1 + 1e-6 ) continue;
          if ( best && s >= best.s ) continue;
          const hit: KnifeHit = r < 0.01 ? { v: u } : r > 0.99 ? { v: w } : { a: u, b: w, t: r };
          best                = { s, hit, f: fi };
        }
      }
      if ( !best ) break;
      out.push( best.hit );
      P    = best.hit;
      s0   = best.s;
      prev = best.f;
    }
    out.push( B );
    return out;
  }

  /**
   * The whole cut so far: its points with the crossings between them.
  **/
  private path( o: CustomObjectEntry & { model: ModelData }, pts: KnifeHit[] ) {
    const all: KnifeHit[] = pts.length ? [pts[0]] : [];
    for ( let i = 0; i + 1 < pts.length; i++ ) all.push( ...this.walk( o, pts[i], pts[i + 1] ) );
    return all;
  }

  hover( x: number, y: number, middle: boolean ) {
    const m = this.ed.modal, o = this.ed.obj();
    if ( m?.kind !== "knife" || !o ) return;
    m.hover    = this.at( x, y, middle );
    const g    = o.model.mesh, M = this.ed.matrix( o );
    const W    = ( h: KnifeHit ) => this.ed.world( o, this.pos( g, h ), M );
    const path = this.path( o, m.hover ? [...m.pts, m.hover] : m.pts ).map( W );
    m.preview  = path.length > 1 ? [path] : [];
    if ( m.hover ) {
      // a small cross where it would go
      const c = W( m.hover ), r = this.ed.ops.mpp( c ) * 5;
      m.preview.push( [c.clone().add( new THREE.Vector3( -r, 0, 0 ) ), c.clone().add( new THREE.Vector3( r, 0, 0 ) )], [c.clone().add( new THREE.Vector3( 0, -r, 0 ) ), c.clone().add( new THREE.Vector3( 0, r, 0 ) )] );
    }
    this.ed.statusText = `Knife: ${m.pts.length} point${m.pts.length === 1 ? "" : "s"}`;
    this.ed.drawPreview();
    this.ed.publish();
  }

  apply() {
    const m = this.ed.modal, o = this.ed.obj();
    if ( m?.kind !== "knife" || !o ) return this.ed.cancel();
    this.ed.modal      = null;
    this.ed.statusText = "";
    const g            = o.model.mesh;
    const path         = this.path( o, m.pts );
    if ( path.length < 2 ) return this.ed.cancel();
    const r     = knifeCut( g, path.map( ( h ): KnifePoint => ( "v" in h ? { v: h.v } : "f" in h ? { f: h.f, p: h.p } : { a: h.a, b: h.b, p: this.pos( g, h ) } ) ) );
    this.ed.sel = r.sel;
    this.ed.menus.op( r.mesh, "Knife" );
  }
}
