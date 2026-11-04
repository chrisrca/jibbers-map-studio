// The UV Editor ( Blender's, beside the 3D view in Edit Mode ): the selected faces' UVs ( every face's when none
// is ) laid out on the square, their corners picked ( a click, Shift adds; a drag from nothing boxes them; A / Alt+A )
// and moved, turned and scaled with G / R / S ( X / Y hold it to an axis; Enter or a click keeps it, Esc or a
// right-click puts it back ); the wheel zooms, the middle button pans, Home fits it.

import { useEffect, useRef } from "react";
import { create } from "zustand";
import { useEditor } from "../../map/store";
import { joined, moveUvs, uvAt, type Corner } from "../../model/uvEdit";
import type { Mesh } from "../../model/mesh";
import type { CustomObjectEntry } from "../../core/types";
import { getEngine } from "../Viewport";
import { Icon } from "../widgets/icons";

export const useUvEditor = create<{ open: boolean }>( () => ( { open: false } ) );

export function UvEditor() {
  const open = useUvEditor( ( s ) => s.open );
  const uid  = useEditor( ( s ) => ( s.tool === "model" ? s.modelEdit?.uid : undefined ) );
  if ( !open || !uid ) return null;
  return <UvCanvas key={uid} />;
}

// A move under way: what it moves, from where, and the piece as it was ( put back by Esc ).
type Move = { op: "g" | "r" | "s"; corners: Corner[]; mesh0: Mesh; o0: CustomObjectEntry; x0: number; y0: number; axis: 0 | 1 | null; pivot: [number, number] };

const key = ( c: Corner ) => `${c[0]}:${c[1]}`;

function UvCanvas() {
  const canvas = useRef<HTMLCanvasElement>( null );
  useEffect( () => {
    const cv    = canvas.current!, ctx = cv.getContext( "2d" )!;
    const ed    = () => getEngine()?.modelEd ?? null;
    const mesh  = () => ed()?.obj()?.model.mesh ?? null;
    // the faces shown: the selected ones, every one when none is
    const faces = ( g: Mesh ) => {
      const sel = ed()?.sel.f;
      return sel?.size ? [...sel].filter( ( f ) => g.f[f] ) : g.f.map( ( _, i ) => i );
    };
    // the corners picked ( face:corner keys ), the view ( screen pixels per UV unit, where UV 0,0 is )
    let picked            = new Set<string>();
    let move: Move | null = null;
    const view            = { zoom: 300, x: 40, y: 340 };
    const mouse           = { x: 0, y: 0, inside: false };
    const toScreen        = ( u: number, v: number ): [number, number] => [view.x + u * view.zoom, view.y - v * view.zoom];
    const toUv            = ( x: number, y: number ): [number, number] => [( x - view.x ) / view.zoom, ( view.y - y ) / view.zoom];
    const fit             = () => {
      const w   = cv.clientWidth, h = cv.clientHeight;
      view.zoom = Math.min( w, h ) * 0.85;
      view.x    = ( w - view.zoom ) / 2;
      view.y    = ( h + view.zoom ) / 2;
    };
    const draw = () => {
      const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
      if ( cv.width !== Math.round( w * dpr ) || cv.height !== Math.round( h * dpr ) ) {
        cv.width  = Math.round( w * dpr );
        cv.height = Math.round( h * dpr );
      }
      ctx.setTransform( dpr, 0, 0, dpr, 0, 0 );
      ctx.fillStyle = "#282828";
      ctx.fillRect( 0, 0, w, h );
      // the square, and its grid ( eighths )
      const [x0, y0]  = toScreen( 0, 1 );
      ctx.fillStyle   = "#333333";
      ctx.fillRect( x0, y0, view.zoom, view.zoom );
      ctx.strokeStyle = "#3f3f3f";
      ctx.lineWidth   = 1;
      ctx.beginPath();
      for ( let k = 1; k < 8; k++ ) {
        const [ax, ay] = toScreen( k / 8, 0 ), [, by] = toScreen( 0, k / 8 );
        ctx.moveTo( ax, y0 );
        ctx.lineTo( ax, ay );
        ctx.moveTo( x0, by );
        ctx.lineTo( x0 + view.zoom, by );
      }
      ctx.stroke();
      ctx.strokeStyle = "#555555";
      ctx.strokeRect( x0, y0, view.zoom, view.zoom );
      const g = mesh();
      if ( !g ) return;
      const shown = faces( g );
      // the faces: picked ones tinted, outlined
      for ( const fi of shown ) {
        const f = g.f[fi];
        ctx.beginPath();
        f.forEach( ( _, k ) => {
          const [x, y] = toScreen( ...uvAt( g, fi, k ) );
          if ( k ) ctx.lineTo( x, y );
          else ctx.moveTo( x, y );
        } );
        ctx.closePath();
        if ( f.every( ( _, k ) => picked.has( `${fi}:${k}` ) ) ) {
          ctx.fillStyle = "rgba(255, 160, 51, 0.22)";
          ctx.fill();
        }
        ctx.strokeStyle = "#0c0c0c";
        ctx.lineWidth   = 1.5;
        ctx.stroke();
      }
      // their corners
      for ( const fi of shown )
        g.f[fi].forEach( ( _, k ) => {
          const [x, y]  = toScreen( ...uvAt( g, fi, k ) );
          ctx.fillStyle = picked.has( `${fi}:${k}` ) ? "#ffa033" : "#101010";
          ctx.fillRect( x - 2.5, y - 2.5, 5, 5 );
        } );
      if ( box ) {
        ctx.strokeStyle = "#ffffff";
        ctx.setLineDash( [4, 3] );
        ctx.strokeRect( Math.min( box.x0, box.x1 ), Math.min( box.y0, box.y1 ), Math.abs( box.x1 - box.x0 ), Math.abs( box.y1 - box.y0 ) );
        ctx.setLineDash( [] );
      }
    };
    // the corner nearest a screen point ( within a few pixels ), with those joined to it
    const cornerAt = ( x: number, y: number ): Corner[] => {
      const g = mesh();
      if ( !g ) return [];
      let best: { c: Corner; d: number } | null = null;
      for ( const fi of faces( g ) )
        g.f[fi].forEach( ( _, k ) => {
          const [sx, sy] = toScreen( ...uvAt( g, fi, k ) ), d = Math.hypot( sx - x, sy - y );
          if ( d < 10 && ( !best || d < best.d ) ) best = { c: [fi, k], d };
        } );
      const b = best as { c: Corner } | null;
      return b ? joined( g, faces( g ), b.c[0], b.c[1] ) : [];
    };
    const pickedCorners = (): Corner[] => [...picked].map( ( s ) => s.split( ":" ).map( Number ) as Corner );
    // a move: the picked corners from where they were, by the mouse since it began
    const runMove = () => {
      const m = move, e = ed();
      if ( !m || !e ) return;
      const [mu, mv] = toUv( mouse.x, mouse.y ), [su, sv] = toUv( m.x0, m.y0 ), [pu, pv] = m.pivot;
      let to: ( u: number, v: number ) => [number, number];
      if ( m.op === "g" ) {
        const du = m.axis === 1 ? 0 : mu - su, dv = m.axis === 0 ? 0 : mv - sv;
        to       = ( u, v ) => [u + du, v + dv];
      } else if ( m.op === "r" ) {
        const a  = Math.atan2( mv - pv, mu - pu ) - Math.atan2( sv - pv, su - pu ), c = Math.cos( a ), s = Math.sin( a );
        to       = ( u, v ) => [pu + ( u - pu ) * c - ( v - pv ) * s, pv + ( u - pu ) * s + ( v - pv ) * c];
      } else {
        const k  = Math.hypot( mu - pu, mv - pv ) / Math.max( 1e-6, Math.hypot( su - pu, sv - pv ) );
        to       = ( u, v ) => [m.axis === 1 ? u : pu + ( u - pu ) * k, m.axis === 0 ? v : pv + ( v - pv ) * k];
      }
      e.setMesh( moveUvs( m.mesh0, m.corners, to ), null );
      draw();
    };
    const startMove = ( op: Move["op"] ) => {
      const e = ed(), o = e?.obj(), g = mesh();
      if ( !e || !o || !g || !picked.size ) return;
      const corners = pickedCorners(), at = corners.map( ( [fi, k] ) => uvAt( g, fi, k ) );
      const pivot: [number, number] = [at.reduce( ( s, p ) => s + p[0], 0 ) / at.length, at.reduce( ( s, p ) => s + p[1], 0 ) / at.length];
      move = { op, corners, mesh0: g, o0: o, x0: mouse.x, y0: mouse.y, axis: null, pivot };
    };
    const keep = () => {
      const m = move, e = ed();
      move    = null;
      if ( m && e && e.obj()?.model.mesh !== m.mesh0 ) e.commitFrom( m.o0, { g: "Move UVs", r: "Rotate UVs", s: "Scale UVs" }[m.op] );
      draw();
    };
    const cancel = () => {
      const m = move, e = ed();
      move    = null;
      if ( m && e ) e.setMesh( m.mesh0, null );
      draw();
    };
    // a drag from nothing: a box
    let box: { x0: number; y0: number; x1: number; y1: number; extend: boolean } | null = null;
    let pan: { x: number; y: number } | null                                            = null;
    const local = ( e: PointerEvent | WheelEvent ) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = ( e: PointerEvent ) => {
      const p = local( e );
      Object.assign( mouse, p );
      if ( move ) {
        if ( e.button === 0 ) keep();
        else if ( e.button === 2 ) cancel();
        return;
      }
      if ( e.button === 1 ) {
        pan = p;
        cv.setPointerCapture( e.pointerId );
        return;
      }
      if ( e.button !== 0 ) return;
      const hit = cornerAt( p.x, p.y );
      if ( !hit.length ) {
        box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, extend: e.shiftKey };
        cv.setPointerCapture( e.pointerId );
        return;
      }
      const on = hit.every( ( c ) => picked.has( key( c ) ) );
      if ( !e.shiftKey ) picked = new Set();
      for ( const c of hit ) {
        if ( e.shiftKey && on ) picked.delete( key( c ) );
        else picked.add( key( c ) );
      }
      draw();
    };
    const moveTo = ( e: PointerEvent ) => {
      const p = local( e );
      if ( pan ) {
        view.x += p.x - pan.x;
        view.y += p.y - pan.y;
        pan     = p;
      }
      Object.assign( mouse, p );
      if ( box ) {
        box.x1 = p.x;
        box.y1 = p.y;
      }
      if ( move ) runMove();
      else draw();
    };
    const up = ( e: PointerEvent ) => {
      pan = null;
      if ( !box ) return;
      const b = box, g = mesh();
      box     = null;
      if ( !g ) return draw();
      if ( !b.extend ) picked = new Set();
      const [xa, xb] = [Math.min( b.x0, b.x1 ), Math.max( b.x0, b.x1 )], [ya, yb] = [Math.min( b.y0, b.y1 ), Math.max( b.y0, b.y1 )];
      for ( const fi of faces( g ) )
        g.f[fi].forEach( ( _, k ) => {
          const [x, y] = toScreen( ...uvAt( g, fi, k ) );
          if ( x >= xa && x <= xb && y >= ya && y <= yb ) picked.add( `${fi}:${k}` );
        } );
      if ( cv.hasPointerCapture( e.pointerId ) ) cv.releasePointerCapture( e.pointerId );
      draw();
    };
    const wheel = ( e: WheelEvent ) => {
      e.preventDefault();
      const p = local( e ), [u, v] = toUv( p.x, p.y ), k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      view.zoom *= k;
      view.x     = p.x - u * view.zoom;
      view.y     = p.y + v * view.zoom;
      draw();
    };
    // its keys, while the mouse is over it ( before the 3D view's )
    const onKey = ( e: KeyboardEvent ) => {
      if ( !mouse.inside || ( e.target as HTMLElement )?.closest?.( "input, textarea" ) ) return;
      const k  = e.key.toLowerCase();
      let used = true;
      if ( move ) {
        if ( k === "escape" ) cancel();
        else if ( k === "enter" || k === " " ) keep();
        else if ( k === "x" || k === "y" ) {
          const axis = k === "x" ? 0 : 1;
          move.axis  = move.axis === axis ? null : axis;
          runMove();
        } else if ( k === "g" || k === "r" || k === "s" ) {
          move.op = k;
          runMove();
        }
      } else if ( ( k === "g" || k === "r" || k === "s" ) && !e.ctrlKey ) startMove( k );
      else if ( k === "a" && e.altKey ) { picked = new Set(); draw(); }
      else if ( k === "a" && !e.ctrlKey ) {
        const g = mesh();
        if ( g ) picked = new Set( faces( g ).flatMap( ( fi ) => g.f[fi].map( ( _, j ) => `${fi}:${j}` ) ) );
        draw();
      } else if ( k === "home" ) { fit(); draw(); }
      else used = false;
      if ( used ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    const enter = () => ( mouse.inside = true );
    const leave = () => ( mouse.inside = false );
    const menu  = ( e: MouseEvent ) => e.preventDefault();
    fit();
    draw();
    // drawn again as the mesh or what's selected changes
    const unsub = useEditor.subscribe( ( s, p ) => {
      if ( s.customObjects !== p.customObjects || s.modelEdit !== p.modelEdit ) draw();
    } );
    const ro = new ResizeObserver( () => draw() );
    ro.observe( cv );
    cv.addEventListener( "pointerdown",  down   );
    cv.addEventListener( "pointermove",  moveTo );
    cv.addEventListener( "pointerup",    up     );
    cv.addEventListener( "pointerenter", enter  );
    cv.addEventListener( "pointerleave", leave  );
    cv.addEventListener( "wheel",        wheel, { passive: false } );
    cv.addEventListener( "contextmenu",  menu   );
    window.addEventListener( "keydown", onKey, true );
    return () => {
      unsub();
      ro.disconnect();
      if ( move ) cancel();
      cv.removeEventListener( "pointerdown",  down   );
      cv.removeEventListener( "pointermove",  moveTo );
      cv.removeEventListener( "pointerup",    up     );
      cv.removeEventListener( "pointerenter", enter  );
      cv.removeEventListener( "pointerleave", leave  );
      cv.removeEventListener( "wheel",        wheel  );
      cv.removeEventListener( "contextmenu",  menu   );
      window.removeEventListener( "keydown", onKey, true );
    };
  }, [] );
  return (
    <div className="uv-editor">
      <canvas ref={canvas} />
      <button className="btn ghost small close" title="Close" onClick={() => useUvEditor.setState( { open: false } )}>
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}
