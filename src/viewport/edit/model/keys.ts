// Edit Mode's keys ( Blender's ): G / R / S, E, I, Ctrl+B, Ctrl+R, K, F, M, X, Shift+D, Alt+N, 1 / 2 / 3, A, L, H…

import { useEditor } from "../../../map/store";
import { ekv, recalcOutside } from "../../../model/mesh";
import { duplicate, emptySel, fill, linked, selFromFaces, selFromVerts } from "../../../model/ops";
import type { ModelEditor } from "./modelEditor";

// Edit Mode's keys.
export class ModelKeys {
  constructor( private ed: ModelEditor ) {}

  key( e: KeyboardEvent ): boolean {
    const k = e.key.toLowerCase(), m = this.ed.modal;
    if ( m ) {
      if ( k === "escape" ) return this.ed.cancel(), true;
      if ( k === "enter"  || k === " " ) return m.kind === "loopcut" ? ( this.ed.loopCut.apply(), true ) : m.kind === "knife" ? ( this.ed.knife.apply(), true ) : ( this.ed.keep(), true );
      if ( m.kind === "transform" ) {
        if ( k === "x" || k === "y" || k === "z" ) {
          // ( Blender's Y is the game's Z, its Z the game's Y )
          const axis = ( { x: 0, y: 2, z: 1 } as const )[k];
          // again: the piece's own axes; a third time: none
          if ( m.axis === axis && !m.local ) m.local = true;
          else if ( m.axis === axis && m.local ) { m.axis = null; m.local = false; }
          else { m.axis = axis; m.local = false; }
          m.dir = null;
          this.ed.ops.runTransform( e );
          return true;
        }
        if ( k === "g" && m.op === "g" && !m.dir ) {
          // G twice: Edge / Vertex Slide
          m.op    = "slide";
          m.label = "Slide";
          this.ed.ops.runTransform( e );
          return true;
        }
        if ( k === "g" || k === "r" || k === "s" ) {
          m.op = k;
          this.ed.ops.runTransform( e );
          return true;
        }
      }
      if ( m.kind === "spin" && ( k === "x" || k === "y" || k === "z" ) ) {
        m.axis = ( { x: 0, y: 2, z: 1 } as const )[k];
        this.ed.ops.runSpin( e as unknown as PointerEvent );
        return true;
      }
      if ( m.kind === "spin" && ( k === "+" || k === "=" || k === "-" ) && !m.typed ) {
        m.steps = Math.max( 1, Math.min( 128, m.steps + ( k === "-" ? -1 : 1 ) ) );
        this.ed.ops.runSpin( e as unknown as PointerEvent );
        return true;
      }
      if ( ( m.kind === "transform" || m.kind === "inset" || m.kind === "bevel" || m.kind === "spin" ) && /^[0-9.-]$/.test( e.key ) ) {
        m.typed += e.key;
        this.ed.rerun( e );
        return true;
      }
      if ( ( m.kind === "transform" || m.kind === "inset" || m.kind === "bevel" || m.kind === "spin" ) && k === "backspace" ) {
        m.typed = m.typed.slice( 0, -1 );
        this.ed.rerun( e );
        return true;
      }
      if ( m.kind === "inset" && k === "i" ) {
        m.individual = !m.individual;
        this.ed.ops.runInset( e as unknown as PointerEvent );
        return true;
      }
      return true;
    }
    const o = this.ed.obj();
    if ( !o ) return false;
    const g = o.model.mesh;
    if ( !e.ctrlKey && !e.altKey && ( k === "1" || k === "2" || k === "3" ) ) return this.ed.picking.setMode( ( ["vert", "edge", "face"] as const )[+k - 1] ), true;
    if ( k === "a" && e.altKey ) return this.ed.picking.selectAll( false ), true;
    if ( k === "h" && e.altKey ) {
      const back = [...this.ed.hidden];
      this.ed.hidden.clear();
      this.ed.sel = selFromFaces( g, back );
      this.ed.sync();
      this.ed.publish();
      return true;
    }
    if ( k === "a" && !e.ctrlKey ) return this.ed.picking.selectAll( true ), true;
    if ( k === "i" && e.ctrlKey ) {
      // invert
      const all   = g.v.map( ( _, i ) => i );
      this.ed.sel = this.ed.mode === "face" ? selFromFaces( g, g.f.map( ( _, i ) => i ).filter( ( f ) => !this.ed.sel.f.has( f ) ) ) : selFromVerts( g, all.filter( ( v ) => !this.ed.sel.v.has( v ) ) );
      this.ed.sync();
      this.ed.publish();
      return true;
    }
    if ( k === "l" ) {
      // linked: everything joined to what's under the cursor ( L ) or to the selection ( Ctrl+L )
      const under = this.ed.picking.pick( this.ed.mouse.x, this.ed.mouse.y );
      const start = e.ctrlKey ? [...this.ed.sel.v] : under === null ? [] : typeof under === "string" ? ekv( under ) : this.ed.mode === "face" ? g.f[under] : [under];
      if ( !start.length ) return true;
      const verts = linked( g, start );
      const s     = selFromVerts( g, [...this.ed.sel.v, ...verts] );
      this.ed.sel = this.ed.mode === "face" ? selFromFaces( g, [...s.f] ) : s;
      this.ed.sync();
      this.ed.publish();
      return true;
    }
    if ( e.ctrlKey && k === "r" ) return this.ed.loopCut.start(), true;
    if ( k === "k" && !e.ctrlKey ) return this.ed.knife.start(), true;
    if ( e.ctrlKey && k === "e" ) return this.ed.menus.edgeMenu(), true;
    if ( e.ctrlKey && k === "b" ) return this.ed.ops.startBevel(), true;
    if ( e.ctrlKey && k === "n" ) return this.ed.menus.op( recalcOutside( g, this.ed.sel.f.size ? this.ed.sel.f : undefined ), "Recalculate outside" ), true;
    if ( e.ctrlKey ) return false;
    if ( k === "g" || k === "r" || k === "s" ) return this.ed.ops.startTransform( k ), true;
    if ( k === "e" ) return this.ed.ops.extrude(), true;
    if ( k === "i" ) return this.ed.ops.startInset(), true;
    if ( k === "f" ) {
      const r     = fill( g, [...this.ed.sel.v] );
      this.ed.sel = r.sel;
      return this.ed.menus.op( r.mesh, "Fill" ), true;
    }
    if ( k === "d" && e.shiftKey ) {
      const r = duplicate( g, this.ed.sel );
      this.ed.setMesh( r.mesh, null );
      this.ed.sel = r.sel;
      this.ed.ops.startTransform( "g", "Duplicate", o );
      return true;
    }
    if ( k === "x" || k === "delete" ) return this.ed.menus.deleteMenu(), true;
    if ( k === "o" ) {
      useEditor.setState( ( s ) => ( { modelTools: { ...s.modelTools, proportional: !s.modelTools.proportional } } ) );
      return true;
    }
    if ( k === "p" ) return this.ed.menus.separateMenu(), true;
    if ( k === "h" ) {
      if ( e.altKey ) {
        // reveal: what was hidden comes back selected
        const back = [...this.ed.hidden];
        this.ed.hidden.clear();
        this.ed.sel = selFromFaces( g, back );
      } else {
        const faces = g.f.map( ( _, i ) => i ).filter( ( fi ) => ( e.shiftKey ? !this.ed.sel.f.has( fi ) && !g.f[fi].every( ( v ) => this.ed.sel.v.has( v ) ) : this.ed.sel.f.has( fi ) || g.f[fi].some( ( v ) => this.ed.sel.v.has( v ) && this.ed.mode !== "face" ) ) );
        for ( const f of faces ) this.ed.hidden.add( f );
        if ( !e.shiftKey ) this.ed.sel = emptySel();
      }
      this.ed.sync();
      this.ed.publish();
      return true;
    }
    if ( k === "m" ) return this.ed.menus.mergeMenu(), true;
    if ( k === "n" && e.altKey ) return this.ed.menus.normalsMenu(), true;
    return false;
  }
}
