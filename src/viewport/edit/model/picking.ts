// Edit Mode's picking: the vertex, edge or face under the mouse ( only what can be seen ), and selecting it ( Shift
// adds, the select mode, all or none ).

import * as THREE from "three/webgpu";
import type { CustomObjectEntry } from "../../../core/types";
import type { ModelData } from "../../../model/build";
import { edgesOf } from "../../../model/mesh";
import { emptySel, selFromEdges, selFromFaces, selFromVerts, type SelectMode } from "../../../model/ops";
import type { ModelEditor } from "./modelEditor";

// A triangle of a piece in the view, and its face.
type Tri = { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; f: number };

// Picking and selecting.
export class ModelPicking {
  constructor( private ed: ModelEditor ) {}

  screen( p: THREE.Vector3 ): [number, number, number] {
    const v = p.clone().project( this.ed.view.camera );
    return [( v.x * 0.5 + 0.5 ) * this.ed.view.host.clientWidth, ( -v.y * 0.5 + 0.5 ) * this.ed.view.host.clientHeight, v.z];
  }

  /**
   * Triangles of the piece ( viewport space ) with their face, for seeing what's in front.
  **/
  tris( o: CustomObjectEntry & { model: ModelData } ) {
    const g          = o.model.mesh, M = this.ed.matrix( o ), W = g.v.map( ( p ) => this.ed.world( o, p, M ) );
    const out: Tri[] = [];
    g.f.forEach( ( f, fi ) => {
      if ( this.ed.hidden.has( fi ) ) return;
      for ( let i = 1; i + 1 < f.length; i++ ) out.push( { a: W[f[0]], b: W[f[i]], c: W[f[i + 1]], f: fi } );
    } );
    return out;
  }

  /**
   * The face under a screen point, and how far.
  **/
  private faceAt( o: CustomObjectEntry & { model: ModelData }, x: number, y: number ) {
    const ray = this.ed.view.ray( x, y ).ray, hit = new THREE.Vector3();
    let best: { f: number; d: number } | null = null;
    for ( const t of this.tris( o ) ) {
      if ( !ray.intersectTriangle( t.a, t.b, t.c, false, hit ) ) continue;
      const d = hit.distanceTo( ray.origin );
      if ( !best || d < best.d ) best = { f: t.f, d };
    }
    return best;
  }

  /**
   * The face under a screen point and where on it ( the 3D view ).
  **/
  faceHit( x: number, y: number ): { f: number; at: THREE.Vector3 } | null {
    const o = this.ed.obj();
    const h = o ? this.faceAt( o, x, y ) : null;
    if ( !h ) return null;
    const ray = this.ed.view.ray( x, y ).ray;
    return { f: h.f, at: ray.origin.clone().addScaledVector( ray.direction, h.d ) };
  }

  /**
   * Whether a point of the piece can be seen ( no face in front of it ).
  **/
  visible( o: CustomObjectEntry & { model: ModelData }, p: THREE.Vector3, tris = this.tris( o ) ) {
    const cam = this.ed.view.camera.position, dir = p.clone().sub( cam ), dist = dir.length();
    const ray = new THREE.Ray( cam, dir.normalize() ), hit = new THREE.Vector3();
    for ( const t of tris ) if ( ray.intersectTriangle( t.a, t.b, t.c, false, hit ) && hit.distanceTo( cam ) < dist - dist * 0.002 - 0.002 ) return false;
    return true;
  }

  /**
   * The element under a screen point: a vertex, an edge ( key ) or a face, by mode.
  **/
  pick( x: number, y: number ): number | string | null {
    const o = this.ed.obj();
    if ( !o ) return null;
    const g = o.model.mesh, M = this.ed.matrix( o ), tris = this.tris( o ), vis = this.ed.shown( g );
    if ( this.ed.mode === "face" ) return this.faceAt( o, x, y )?.f ?? null;
    if ( this.ed.mode === "vert" ) {
      let best: { v: number; d: number } | null = null;
      g.v.forEach( ( p, i ) => {
        if ( !vis.v.has( i ) ) return;
        const w = this.ed.world( o, p, M ), [sx, sy, z] = this.screen( w );
        const d = Math.hypot( sx - x, sy - y );
        if ( z > 1 || d > 14 || ( best && d >= best.d ) ) return;
        if ( !this.visible( o, w, tris ) ) return;
        best = { v: i, d };
      } );
      return ( best as { v: number } | null )?.v ?? null;
    }
    return this.pickEdge( x, y, 10, tris );
  }

  /**
   * The edge nearest a screen point, within `reach` pixels, that can be seen there ( whatever the select mode: loops
   * and Loop Cut go by edges ).
  **/
  pickEdge( x: number, y: number, reach = 30, tris?: Tri[] ): string | null {
    const o = this.ed.obj();
    if ( !o ) return null;
    const g                                   = o.model.mesh, M = this.ed.matrix( o ), vis = this.ed.shown( g ), seen = tris ?? this.tris( o );
    let best: { k: string; d: number } | null = null;
    for ( const [k, e] of edgesOf( g ) ) {
      if ( !vis.e.has( k ) ) continue;
      const wa       = this.ed.world( o, g.v[e.a], M ), wb = this.ed.world( o, g.v[e.b], M );
      const [ax, ay] = this.screen( wa ), [bx, by] = this.screen( wb );
      const dx       = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const t        = Math.max( 0, Math.min( 1, ( ( x - ax ) * dx + ( y - ay ) * dy ) / l2 ) );
      const d        = Math.hypot( ax + dx * t - x, ay + dy * t - y );
      if ( d > reach || ( best && d >= best.d ) ) continue;
      if ( !this.visible( o, wa.clone().lerp( wb, t ), seen ) ) continue;
      best = { k, d };
    }
    return best?.k ?? null;
  }

  selectOnly( el: number | string | null, extend: boolean ) {
    const o = this.ed.obj();
    if ( !o ) return;
    const g   = o.model.mesh;
    const was = this.ed.snapshot();
    if ( el === null ) {
      if ( !extend ) this.ed.sel = emptySel();
    } else if ( typeof el === "string" ) {
      const has   = this.ed.sel.e.has( el );
      const edges = extend ? ( has ? [...this.ed.sel.e].filter( ( k ) => k !== el ) : [...this.ed.sel.e, el] ) : [el];
      this.ed.sel = selFromEdges( g, edges );
    } else if ( this.ed.mode === "face" ) {
      const has   = this.ed.sel.f.has( el );
      const faces = extend ? ( has ? [...this.ed.sel.f].filter( ( f ) => f !== el ) : [...this.ed.sel.f, el] ) : [el];
      this.ed.sel = selFromFaces( g, faces );
    } else {
      const has   = this.ed.sel.v.has( el );
      const verts = extend ? ( has ? [...this.ed.sel.v].filter( ( v ) => v !== el ) : [...this.ed.sel.v, el] ) : [el];
      this.ed.sel = selFromVerts( g, verts );
    }
    this.ed.active = el;
    this.ed.selected( was );
    this.ed.sync();
    this.ed.publish();
  }

  setMode( mode: SelectMode ) {
    const o = this.ed.obj();
    if ( !o ) return;
    const was      = this.ed.snapshot();
    this.ed.mode   = mode;
    const g        = o.model.mesh;
    // as Blender converts: faces keep only fully selected ones
    this.ed.sel    = mode === "face" ? selFromFaces( g, [...this.ed.sel.f] ) : mode === "edge" ? selFromEdges( g, [...this.ed.sel.e] ) : selFromVerts( g, [...this.ed.sel.v] );
    this.ed.active = null;
    this.ed.selected( was );
    this.ed.sync();
    this.ed.publish();
  }

  selectAll( on: boolean ) {
    const o = this.ed.obj();
    if ( !o ) return;
    const was   = this.ed.snapshot();
    const vis   = this.ed.shown( o.model.mesh );
    this.ed.sel = on ? selFromVerts( o.model.mesh, o.model.mesh.v.map( ( _, i ) => i ).filter( ( i ) => vis.v.has( i ) ) ) : emptySel();
    this.ed.selected( was );
    this.ed.sync();
    this.ed.publish();
  }
}
