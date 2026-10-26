// The 3D view's keys: the numpad's views, each tool's own, and the Modelling workspace's ( Blender's ).

import { unlocked, useEditor } from "../../map/store";
import { deleteShape } from "../../terrain/shapes/edits";
import { terrain } from "../../terrain/terrain";
import { deleteTrails, connect } from "../../trails/edits";
import type { Engine } from "./engine";

// The keys pressed over the view.
export class ViewportKeys {
  constructor( private engine: Engine ) {}

  /**
   * The numpad, as Blender's: 1 / 3 / 7 front, right, top ( Ctrl: the opposite ), 9 the other side, 2 / 4 / 6 / 8 a
   * 15° turn, 5 a narrow view, . the selection framed. Whether it was one of them.
  **/
  private numpad( e: KeyboardEvent ) {
    const c = this.engine.controls, step = Math.PI / 12;
    switch ( e.code ) {
      case "Numpad1": this.engine.nav.viewAlong( e.ctrlKey ? "back"   : "front" ); return true;
      case "Numpad3": this.engine.nav.viewAlong( e.ctrlKey ? "left"   : "right" ); return true;
      case "Numpad7": this.engine.nav.viewAlong( e.ctrlKey ? "bottom" : "top"   ); return true;
      case "Numpad9": c.glideTo( { yaw:   c.yaw + Math.PI, pitch: -c.pitch } ); return true;
      case "Numpad2": c.glideTo( { pitch: Math.max( -1.5707, c.pitch - step ) }, 120 ); return true;
      case "Numpad8": c.glideTo( { pitch: Math.min( 1.5707, c.pitch + step ) }, 120 ); return true;
      case "Numpad4": c.glideTo( { yaw:   c.yaw - step }, 120 ); return true;
      case "Numpad6": c.glideTo( { yaw:   c.yaw + step }, 120 ); return true;
      case "Numpad5":       this.engine.camera.fov = this.engine.camera.fov > 30 ? 20 : 55; this.engine.camera.updateProjectionMatrix(); return true;
      case "NumpadDecimal": this.engine.nav.frameSelection(); return true;
    }
    return false;
  }

  onKey = ( e: KeyboardEvent ) => {
    if ( ( e.target as HTMLElement )?.closest?.( "input, textarea, select, [contenteditable]" ) ) return;
    const st = useEditor.getState();

    if ( !this.engine.mouseInside || this.engine.controls.riderMode ) return;
    // ( not while an operator's running: its typed numbers )
    if ( !this.engine.controls.flying && !this.engine.editing?.modal && !this.engine.blGizmo.dragging && this.numpad( e ) ) {
      e.preventDefault();
      return;
    }
    if ( st.tool === "model" && !this.engine.controls.flying && this.modelKey( e ) ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    if ( this.engine.input.sizeDrag && ( e.key === "Escape" || e.key === "Enter" ) ) {
      this.engine.input.endSizeDrag( e.key === "Enter" );
      e.preventDefault();
      return;
    }
    if ( st.tool === "sculpt" ) {
      if ( e.key === "[" ) st.setSculpt( { radius: Math.max( 0.25, st.sculpt.radius / 1.15 ) } );
      if ( e.key === "]" ) st.setSculpt( { radius: Math.min( 500,  st.sculpt.radius * 1.15 ) } );
    }
    if ( st.tool === "material" && st.materialMode === "paint" ) {
      if ( e.key === "[" ) st.setPaint( { radius: Math.max( 0.005, st.paint.radius / 1.15 ) } );
      if ( e.key === "]" ) st.setPaint( { radius: Math.min( 5,     st.paint.radius * 1.15 ) } );
      if ( e.key.toLowerCase() === "x" && !e.ctrlKey ) st.setPaint( { rgb: st.paint.rgb2, rgb2: st.paint.rgb } );
    }
    if ( st.tool === "paint" ) {
      if ( e.key === "[" ) st.setPaint( { radius: Math.max( 0.25, st.paint.radius / 1.15 ) } );
      if ( e.key === "]" ) st.setPaint( { radius: Math.min( 500,  st.paint.radius * 1.15 ) } );
      if ( !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "f" && !this.engine.controls.flying && !this.engine.input.stroke ) {
        this.engine.input.startSizeDrag( e.shiftKey ? "strength" : "radius" );
        e.preventDefault();
        return;
      }
    }
    if ( e.ctrlKey || e.metaKey ) return;
    const k = e.key.toLowerCase();
    // the Trails tool: G moves the picked point ( X / Y / Z holding it to an axis, Enter or a click keeping it, Esc
    // taking it back ), X / Delete takes the picked points and runs away, F joins two picked points, Esc lets go
    if ( st.tool === "trail" && !this.engine.controls.flying && this.engine.blGizmo.dragging ) {
      if ( k === "escape" ) this.engine.blGizmo.cancel();
      else if ( k === "enter" || k === " " ) this.engine.blGizmo.up();
      else if ( k === "x"     || k === "y" || k === "z" ) this.engine.blGizmo.constrain( ( { x: 0, y: 1, z: 2 } as const )[k], e.shiftKey );
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if ( st.tool === "trail" && !this.engine.controls.flying && k === "g" && ( st.trailHandle || ( st.selection.length === 1 && st.selection[0].kind === "trailNode" ) ) ) {
      this.engine.gizmo.sync();
      this.engine.blGizmo.begin( "translate", this.engine.mouse.x, this.engine.mouse.y );
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if ( st.tool === "trail" && !this.engine.controls.flying ) {
      const nodes = st.selection.filter( ( s ) => s.kind === "trailNode" ).map( ( s ) => s.uid ), runs = st.selection.filter( ( s ) => s.kind === "trailRun" ).map( ( s ) => s.uid );
      const did =
        k === "delete" || k === "x" ? ( deleteTrails( nodes, runs ), true )
        : k === "f"      && nodes.length === 2 ? ( connect( nodes[0], nodes[1] ), true )
        : k === "escape" && st.selection.length ? ( st.setSelection( [] ), true )
        : false;
      if ( did ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
    }
    if ( st.railEdit && !this.engine.controls.flying ) {
      if ( k === "escape" ) {
        useEditor.setState( { railEdit: null } );
        e.preventDefault();
        return;
      }
      if ( k === "delete" || k === "x" ) {
        this.engine.rails.deletePoint();
        e.preventDefault();
        return;
      }
    }
    // Transforms are gizmo-only: single-letter keys here would collide with fly-mode WASD/QE.
    if ( this.engine.controls.flying ) return;
    if ( k === "f" ) this.engine.nav.frameSelection();
    else if ( st.selection.length && ( k === "delete" || k === "x" ) ) {
      // ( a lift's mast last clicked: that mast, not the lift )
      if ( this.engine.liftTool.deleteMast() ) return;
      for ( const sel of st.selection.filter( ( x ) => x.kind === "shape" ) ) deleteShape( sel.uid );
      if ( useEditor.getState().selection.length ) useEditor.getState().removeSelected();
    }
    else if ( e.shiftKey && k === "d" && st.selection.length ) st.duplicateSelected();
    else if ( e.altKey   && k === "g" ) this.resetSelected( "position" );
    else if ( e.altKey   && k === "r" ) this.resetSelected( "rotation" );
    else if ( e.altKey   && k === "s" ) this.resetSelected( "scale" );
  };

  /**
   * The Modelling workspace's keys: Tab in and out of Edit Mode, Shift+A to add, and Edit Mode's own.
  **/
  private modelKey( e: KeyboardEvent ): boolean {
    const st = useEditor.getState(), k = e.key.toLowerCase();
    // Alt+Z: X-ray
    if ( k === "z" && e.altKey ) {
      useEditor.setState( { view3d: { ...st.view3d, xray: !st.view3d.xray } } );
      return true;
    }
    if ( k === "tab" && e.shiftKey && this.engine.editing ) {
      useEditor.setState( ( s ) => ( { modelTools: { ...s.modelTools, snap: !s.modelTools.snap } } ) );
      return true;
    }
    if ( k === "tab" && !e.ctrlKey ) {
      this.engine.modelling.toggleEditMode();
      return true;
    }
    if ( k === "a" && e.shiftKey && !e.ctrlKey && !this.engine.editing?.modal ) {
      this.engine.menus.addMenu();
      return true;
    }
    // a G / R / S drag under way: X / Y / Z ( Shift: the other two ) hold it to an axis or plane, Esc lets go, Enter keeps
    if ( this.engine.blGizmo.dragging ) {
      if ( k === "escape" ) this.engine.blGizmo.cancel();
      else if ( k === "enter" || k === " " ) this.engine.blGizmo.up();
      else if ( k === "x"     || k === "y" || k === "z" ) this.engine.blGizmo.constrain( ( { x: 0, y: 1, z: 2 } as const )[k], e.shiftKey );
      return true;
    }
    if ( this.engine.editing ) return this.engine.editing.key( e );
    if ( !e.ctrlKey && !e.altKey && ( k === "g" || k === "r" || k === "s" ) ) return this.engine.gizmo.startObjectModal( ( { g: "translate", r: "rotate", s: "scale" } as const )[k] );
    if ( k === "d" && e.shiftKey && !e.ctrlKey ) {
      if ( !unlocked( st, st.selection ).length ) return false;
      this.engine.menus.duplicateAndGrab();
      return true;
    }
    if ( k === "f2" ) return this.engine.menus.renameActive(), true;
    if ( k === "m"  && !e.ctrlKey && !e.altKey ) return this.engine.menus.moveToCollectionMenu(), true;
    if ( k === "j" && e.ctrlKey ) {
      this.engine.modelling.joinSelected();
      return true;
    }
    // Bool Tool's keys ( the keypad's or the main row's )
    const bool = !e.ctrlKey ? null : e.key === "-" ? "difference" : e.key === "+" || e.key === "=" ? "union" : e.key === "*" ? "intersect" : null;
    if ( bool ) {
      void this.engine.modelling.booleanSelected( bool );
      return true;
    }
    return false;
  }

  private resetSelected( what: "position" | "rotation" | "scale" ) {
    const st   = useEditor.getState();
    const uids = unlocked( st, st.selection ).filter( ( s ) => s.kind === "object" ).map( ( s ) => s.uid );
    if ( !uids.length ) return;
    st.updateObjects( `Reset ${what}`, uids, ( o ) => {
      if ( what === "rotation" ) return { ...o, rotation: [0, 0, 0] };
      if ( what === "scale"    ) return { ...o, scale:    [1, 1, 1] };
      const g = terrain.heightAt( o.position[0], o.position[2] );
      return Number.isNaN( g ) ? o : { ...o, position: [o.position[0], g, o.position[2]] };
    } );
  }
}
