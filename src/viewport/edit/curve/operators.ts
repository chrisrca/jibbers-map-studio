// Edit Mode on a curve's operators: its menus, points removed, subdivided, extruded and added, the spline closed.

import * as THREE from "three/webgpu";
import { type CurvePoint } from "../../../model/curve";
import type { V3 } from "../../../model/mesh";
import type { MenuItem } from "../../../ui/widgets/widgets";
import type { CurveEditor } from "./curveEditor";
import { Id, idOf, parse } from "./curveEditor";

// The curve's operators.
export class CurveOperators {
  constructor( private ed: CurveEditor ) {}

  private menuAtMouse( title: string, items: MenuItem[] ) {
    const r = this.ed.view.host.getBoundingClientRect();
    this.ed.view.menu( r.left + this.ed.mouse.x, r.top + this.ed.mouse.y, title, items );
  }

  contextMenu() {
    this.menuAtMouse( "Curve", [
      { label: "Extrude",         keys:  "E", run: () => this.extrude() },
      { label: "Subdivide",       run:   () => this.subdivide() },
      { label: "Sharp / Smooth…", keys:  "V", run: () => this.sharpMenu() },
      { label: "Size",            keys:  "Alt S", run: () => this.ed.transforms.start( "radius" ) },
      { label: "Close / Open",    keys:  "Alt C", run: () => this.toggleClosed() },
      { sep:   true,              label: "" },
      { label: "Delete Points",   keys:  "X", run: () => this.remove() },
    ] );
  }

  sharpMenu() {
    const set = ( sharp: boolean ) => () => {
      const o = this.ed.obj();
      if ( !o ) return;
      const c = this.ed.clone( o.model.curve );
      for ( const id of this.ed.sel ) {
        const [s, i] = parse( id );
        c.splines[s].points[i].sharp = sharp;
      }
      this.ed.setCurve( c, sharp ? "Sharp points" : "Smooth points" );
    };
    this.menuAtMouse( "Point Type", [{ label: "Sharp (a kink)", run: set( true ) }, { label: "Smooth", run: set( false ) }] );
  }

  toggleClosed() {
    const o = this.ed.obj();
    if ( !o ) return;
    const c       = this.ed.clone( o.model.curve );
    const splines = new Set( [...this.ed.sel].map( ( id ) => parse( id )[0] ) );
    for ( const s of splines ) c.splines[s].closed = !c.splines[s].closed;
    this.ed.setCurve( c, "Close / open spline" );
  }

  remove() {
    const o = this.ed.obj();
    if ( !o || !this.ed.sel.size ) return;
    const c   = this.ed.clone( o.model.curve );
    c.splines = c.splines
      .map( ( s, si ) => ( { ...s, points: s.points.filter( ( _, i ) => !this.ed.sel.has( idOf( si, i ) ) ) } ) )
      .filter( ( s ) => s.points.length >= 2 );
    this.ed.sel.clear();
    this.ed.setCurve( c, "Delete points" );
  }

  private subdivide() {
    const o = this.ed.obj();
    if ( !o ) return;
    const c    = this.ed.clone( o.model.curve );
    const next = new Set<Id>();
    c.splines  = c.splines.map( ( s, si ) => {
      const out: CurvePoint[] = [];
      s.points.forEach( ( q, i ) => {
        out.push( q );
        const n = s.points[i + 1];
        if ( n && this.ed.sel.has( idOf( si, i ) ) && this.ed.sel.has( idOf( si, i + 1 ) ) ) {
          out.push( { p: q.p.map( ( v, k ) => ( v + n.p[k] ) / 2 ) as V3, r: ( q.r + n.r ) / 2, sharp: false } );
          next.add( idOf( si, out.length - 1 ) );
        }
      } );
      return { ...s, points: out };
    } );
    this.ed.sel = next;
    this.ed.setCurve( c, "Subdivide" );
  }

  /**
   * E: a new point from each selected end, then moved.
  **/
  extrude() {
    const o = this.ed.obj();
    if ( !o ) return;
    const c    = this.ed.clone( o.model.curve );
    const next = new Set<Id>();
    c.splines.forEach( ( s, si ) => {
      const last = s.points.length - 1;
      if ( this.ed.sel.has( idOf( si, last ) ) && !s.closed ) {
        s.points.push( { ...s.points[last], p: [...s.points[last].p] as V3 } );
        next.add( idOf( si, last + 1 ) );
      } else if ( this.ed.sel.has( idOf( si, 0 ) ) && !s.closed ) {
        s.points.unshift( { ...s.points[0], p: [...s.points[0].p] as V3 } );
        next.add( idOf( si, 0 ) );
      }
    } );
    if ( !next.size ) return;
    this.ed.sel = next;
    this.ed.setCurve( c, null );
    // ( moved from the curve with its new point; kept or put back as one step from the curve before it )
    this.ed.transforms.start( "g", "Extrude", o, c );
  }

  /**
   * Ctrl+click: a point where the cursor is ( on the ground, or level with the end it carries on from ).
  **/
  addAtCursor( x: number, y: number ) {
    const o = this.ed.obj();
    if ( !o ) return;
    const c      = this.ed.clone( o.model.curve );
    const ends   = [...this.ed.sel].map( parse ).filter( ( [s, i] ) => !c.splines[s].closed && ( i === 0 || i === c.splines[s].points.length - 1 ) );
    const [s, i] = ends[0] ?? [c.splines.length - 1, c.splines[c.splines.length - 1].points.length - 1];
    const spline = c.splines[s];
    const from   = this.ed.world( o, spline.points[i].p );
    // on the plane level with that end, where the mouse ray meets it
    const plane  = new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), -from.y );
    const hit    = this.ed.view.ray( x, y ).ray.intersectPlane( plane, new THREE.Vector3() ) ?? this.ed.ground( x, y );
    if ( !hit ) return;
    const q = { ...spline.points[i], p: this.ed.toPiece( o, hit ) };
    if ( i === 0 ) {
      spline.points.unshift( q );
      this.ed.sel = new Set( [idOf( s, 0 )] );
    } else {
      spline.points.push( q );
      this.ed.sel = new Set( [idOf( s, spline.points.length - 1 )] );
    }
    this.ed.setCurve( c, "Add point" );
  }
}
