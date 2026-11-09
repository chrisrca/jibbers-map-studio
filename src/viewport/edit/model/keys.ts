// Edit Mode's keys ( Blender's ): G / R / S, E, I, Ctrl+B, Ctrl+R, K, F, M, X, Shift+D, Alt+N, 1 / 2 / 3, A, L, H…

import { useEditor } from "../../../map/store";
import { ekv, recalcOutside } from "../../../model/mesh";
import { duplicate, emptySel, fill, linked, selFromFaces, selFromVerts } from "../../../model/ops";
import type { ModelEditor } from "./modelEditor";

// Edit Mode's keys.
export class ModelKeys {
  constructor( private ed: ModelEditor ) {}

  /**
   * Alt+H ( Blender's Reveal ): what was hidden comes back, selected along with what already was.
  **/
  reveal() {
    const back = [...this.ed.hidden];
    this.ed.hidden.clear();
    this.ed.picking.apply( ( g, s ) => ( this.ed.mode === "face" ? selFromFaces( g, [...s.f, ...back] ) : selFromVerts( g, [...s.v, ...back.flatMap( ( f ) => g.f[f] ?? [] )] ) ) );
  }

  key( e: KeyboardEvent ): boolean {
    const k = e.key.toLowerCase(), m = this.ed.modal;
    if ( m ) {
      if ( k === "escape" ) return this.ed.cancel(), true;
      if ( k === "enter"  || k === " " ) return m.kind === "loopcut" ? ( this.ed.loopCut.apply(), true ) : m.kind === "knife" ? ( this.ed.knife.apply(), true ) : ( this.ed.keep(), true );
      if ( m.kind === "transform" ) {
        if ( k === "x" || k === "y" || k === "z" ) {
          // ( Blender's Y is the game's Z, its Z the game's Y )
          const axis  = ( { x: 0, y: 2, z: 1 } as const )[k];
          // ( Shift: the other two, as Blender's Shift+Z moves on X and Y )
          const plane = e.shiftKey && m.op !== "r";
          // again: the piece's own axes; a third time: none
          if ( m.axis === axis && m.plane === plane && !m.local ) m.local = true;
          else if ( m.axis === axis && m.plane === plane && m.local ) { m.axis = null; m.local = false; }
          else { m.axis = axis; m.local = false; }
          m.plane = m.axis !== null && plane;
          m.dir   = null;
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
      if ( ( m.kind === "transform" || m.kind === "inset" || m.kind === "bevel" || m.kind === "spin" || m.kind === "crease" || m.kind === "drag" ) && /^[0-9.-]$/.test( e.key ) ) {
        m.typed += e.key;
        this.ed.rerun( e );
        return true;
      }
      if ( ( m.kind === "transform" || m.kind === "inset" || m.kind === "bevel" || m.kind === "spin" || m.kind === "crease" || m.kind === "drag" ) && k === "backspace" ) {
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
    if ( k === "h" && e.altKey ) return this.reveal(), true;
    if ( k === "a" && !e.ctrlKey ) return this.ed.picking.selectAll( true ), true;
    // invert ( of the select mode's own: edges in edge select )
    if ( k === "i" && e.ctrlKey ) return this.ed.picking.invert(), true;
    // Ctrl+Numpad + / - ( or the main row's ): Select More / Less
    if ( e.ctrlKey && ( e.code === "NumpadAdd" || k === "+" || k === "=" ) ) return this.ed.picking.more(), true;
    if ( e.ctrlKey && ( e.code === "NumpadSubtract" || k === "-" ) ) return this.ed.picking.less(), true;
    if ( k === "l" ) {
      // linked: everything joined to what's under the cursor ( L; Shift+L: off ) or to the selection ( Ctrl+L )
      if ( e.ctrlKey ) return this.ed.picking.linkedAll(), true;
      const under = this.ed.picking.pick( this.ed.mouse.x, this.ed.mouse.y );
      const start = under === null ? [] : typeof under === "string" ? ekv( under ) : this.ed.mode === "face" ? g.f[under] : [under];
      if ( !start.length ) return true;
      const verts = linked( g, start );
      this.ed.picking.apply( ( g2, s ) => {
        const sv = e.shiftKey ? selFromVerts( g2, [...s.v].filter( ( v ) => !verts.has( v ) ) ) : selFromVerts( g2, [...s.v, ...verts] );
        return this.ed.mode === "face" ? selFromFaces( g2, e.shiftKey ? [...s.f].filter( ( f ) => !sv.f.has( f ) && g2.f[f].every( ( v ) => !verts.has( v ) ) ) : [...sv.f] ) : sv;
      } );
      return true;
    }
    if ( e.ctrlKey && k === "r" ) return this.ed.loopCut.start(), true;
    if ( k === "k" && !e.ctrlKey ) return this.ed.knife.start(), true;
    if ( e.ctrlKey && k === "e" ) return this.ed.menus.edgeMenu(), true;
    if ( e.ctrlKey && k === "b" ) return this.ed.ops.startBevel( e.shiftKey ), true;
    if ( e.ctrlKey && k === "n" ) return this.ed.menus.op( recalcOutside( g, this.ed.sel.f.size ? this.ed.sel.f : undefined ), "Recalculate outside" ), true;
    if ( e.ctrlKey ) return false;
    if ( k === "s" && e.shiftKey ) return this.ed.menus.snapMenu(), true;
    // Alt+S: Shrink/Fatten ( Blender's ), along the vertices' normals with the mouse, or as typed
    if ( k === "s" && e.altKey ) return this.ed.toolbar.startShrink(), true;
    if ( k === "g" || k === "r" || k === "s" ) return this.ed.ops.startTransform( k ), true;
    if ( k === "e" && e.shiftKey ) return this.ed.ops.startCrease(), true;
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
      // ( moved from the mesh with the copy in it; kept as one step from before it )
      this.ed.ops.startTransform( "g", "Duplicate", o, undefined, r.mesh );
      return true;
    }
    if ( k === "x" || k === "delete" ) return this.ed.menus.deleteMenu(), true;
    if ( k === "o" ) {
      useEditor.setState( ( s ) => ( { modelTools: { ...s.modelTools, proportional: !s.modelTools.proportional } } ) );
      return true;
    }
    if ( k === "p" ) return this.ed.menus.separateMenu(), true;
    if ( k === "h" ) {
      if ( e.altKey ) return this.reveal(), true;
      const faces = g.f.map( ( _, i ) => i ).filter( ( fi ) => ( e.shiftKey ? !this.ed.sel.f.has( fi ) && !g.f[fi].every( ( v ) => this.ed.sel.v.has( v ) ) : this.ed.sel.f.has( fi ) || g.f[fi].some( ( v ) => this.ed.sel.v.has( v ) && this.ed.mode !== "face" ) ) );
      for ( const f of faces ) this.ed.hidden.add( f );
      if ( !e.shiftKey ) this.ed.sel = emptySel();
      this.ed.sync();
      this.ed.publish();
      return true;
    }
    if ( k === "m" ) return this.ed.menus.mergeMenu(), true;
    if ( k === "u" ) return this.ed.menus.unwrapMenu(), true;
    if ( k === "n" && e.altKey ) return this.ed.menus.normalsMenu(), true;
    return false;
  }
}
