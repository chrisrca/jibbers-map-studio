// The 3D view's mouse and pen: clicks and drags handed to the tool that's out, brush strokes, and the brush's ring.

import * as THREE from "three/webgpu";
import { toThree, toUnity } from "../../core/coords";
import { useEditor } from "../../map/store";
import { ensureLayer, PaintStroke } from "../../paint/ground";
import { BrushStroke } from "../../sculpt/stroke/stroke";
import { terrain } from "../../terrain/terrain";
import { brushLook, snowLook } from "../render/terrainRenderer";
import { ScatterStroke, scatterTemplates } from "../tools/scatter";
import type { Engine } from "./engine";

export class ViewportInput {
  constructor( private engine: Engine ) {}

  private rightDown: { x: number; y: number; t: number } | null = null;
  // the Ramp brush's line, from where its stroke started
  private rampLine = new THREE.Line( new THREE.BufferGeometry().setFromPoints( [new THREE.Vector3(), new THREE.Vector3()] ), new THREE.LineBasicNodeMaterial( { color: 0xffb000, depthTest: false } ) );
  stroke:      BrushStroke | null = null;
  paintStroke: PaintStroke | null = null;
  // where the last ground paint stroke ended ( Shift+click paints a straight line from there )
  private lastPaintAt: [number, number] | null = null;
  // the pen's pressure on the stroke under way ( 1 for a mouse )
  strokePressure = 1;
  // F / Shift+F: resizing the brush ( or its strength ) by moving the mouse, Blender style
  sizeDrag: { what: "radius" | "strength"; x0: number; v0: number; perPx: number } | null = null;
  // Object Mode's box select in the Assets workspace, while it's dragged
  private objBox: { x0: number; y0: number; extend: boolean; subtract: boolean } | null = null;
  // the map whose paint has been loaded for Paint Mode
  private paintLoaded = "";
  // the object brush's stroke under way ( "starting": the pieces still coming into the map )
  scatterStroke: ScatterStroke | "starting" | null = null;

  /**
   * Its listeners on the view ( and the window: a drag let go outside the view ), and the Ramp brush's line.
  **/
  attach() {
    const dom                   = this.engine.renderer.domElement;
    this.rampLine.renderOrder   = 999;
    this.rampLine.frustumCulled = false;
    this.rampLine.visible       = false;
    this.engine.scene.add( this.rampLine );
    dom.addEventListener( "pointerdown",  this.onDown                              );
    dom.addEventListener( "pointermove",  this.onMove                              );
    dom.addEventListener( "pointerenter", () => ( this.engine.mouseInside = true ) );
    dom.addEventListener( "pointerleave", () => {
      this.engine.mouseInside           = false;
      this.engine.placing.ghost.visible = false;
    } );
    window.addEventListener( "pointerup", this.onUp       );
    window.addEventListener( "keydown",   this.mods, true );
    window.addEventListener( "keyup",     this.mods, true );
    // ( before the camera's zoom: an Edit Mode tool under way takes the wheel )
    dom.addEventListener( "wheel", this.onWheel, { capture: true, passive: false } );
  }

  detach() {
    window.removeEventListener( "pointerup", this.onUp       );
    window.removeEventListener( "keydown",   this.mods, true );
    window.removeEventListener( "keyup",     this.mods, true );
  }

  /**
   * Shift / Ctrl pressed or let go mid-drag: the drag worked out again ( finer, snapping ).
  **/
  private mods = ( e: KeyboardEvent ) => {
    if ( e.key !== "Shift" && e.key !== "Control" ) return;
    const { blGizmo, modelEd, mouse } = this.engine;
    if ( blGizmo.dragging ) blGizmo.move( mouse.x, mouse.y, { ctrl: e.ctrlKey, shift: e.shiftKey } );
    if ( this.engine.editing === modelEd ) modelEd.modsChanged( e );
  };

  /**
   * The wheel during Edit Mode's G / R / S ( the proportional radius ), Loop Cut ( cuts ), Bevel ( segments ) or Spin
   * ( steps ): theirs, not the camera's.
  **/
  private onWheel = ( e: WheelEvent ) => {
    const { modelEd } = this.engine;
    if ( this.engine.editing !== modelEd || !modelEd.wheel( e ) ) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  onDown = ( e: PointerEvent ) => {
    const p = this.engine.local( e );
    this.engine.mouse.copy( p );
    if ( this.sizeDrag ) {
      // left click keeps the new size, right click puts it back
      if ( e.button === 2 ) this.endSizeDrag( false );
      else this.endSizeDrag( true );
      e.preventDefault();
      return;
    }
    if ( this.engine.controls.riderMode ) return;
    if ( e.button === 2 ) this.rightDown = { x: p.x, y: p.y, t: performance.now() };
    // Shift+right-click in the Assets workspace: the 3D cursor put down there
    if ( e.button === 2 && e.shiftKey && this.engine.stage.shown ) {
      const at = this.engine.pointAt( p.x, p.y );
      if ( at ) useEditor.setState( { cursor3d: toUnity( at ) } );
      return;
    }
    // G / R / S under way: a click keeps it, a right click puts things back
    if ( this.engine.blGizmo.dragging && ( e.button === 0 || e.button === 2 ) ) {
      if ( e.button === 0 ) this.engine.blGizmo.up();
      else this.engine.blGizmo.cancel();
      this.rightDown = null;
      e.stopImmediatePropagation();
      return;
    }
    // a gizmo handle under the mouse takes it ( the gizmo's own listener has started its drag )
    // ( Blender's gizmo, in the Assets workspace )
    // ( the Trails tool: a press on a point moves the point along the snow, the gizmo on it being for its arrows )
    // ( a lift's handles too: its stations and masts, over the gizmo on its base; the pieces themselves after it )
    if ( e.button === 0 && !( useEditor.getState().tool === "trail" && this.engine.trailTool.hints.markUnder( p.x, p.y ) ) && !this.engine.liftTool.markUnder( p.x, p.y, e.ctrlKey ) && this.engine.blGizmo.down( p.x, p.y ) ) {
      this.engine.renderer.domElement.setPointerCapture( e.pointerId );
      return;
    }
    // the Assets workspace's tools: the 3D cursor put down, a cube added, an editing tool's drag on the selection
    const st0 = useEditor.getState();
    if ( e.button === 0 && st0.tool === "model" && this.engine.stage.shown && !this.engine.controls.flying ) {
      if ( st0.modelTool === "cursor" || st0.modelTool === "add" ) {
        const at = this.engine.pointAt( p.x, p.y );
        if ( at ) {
          if ( st0.modelTool === "cursor" ) useEditor.setState( { cursor3d: toUnity( at ) } );
          else this.engine.placing.addCubeAt( at );
        }
        return;
      }
      if ( this.engine.editing === this.engine.modelEd && this.engine.modelEd.toolbar.toolDown( st0.modelTool, p.x, p.y ) ) {
        this.engine.renderer.domElement.setPointerCapture( e.pointerId );
        return;
      }
    }
    // Edit Mode takes the mouse ( Alt+click selects loops there )
    if ( useEditor.getState().tool === "model" && this.engine.editing && !this.engine.controls.flying ) {
      if ( this.engine.editing.down( e, p.x, p.y ) ) {
        if ( e.button === 0 ) this.engine.renderer.domElement.setPointerCapture( e.pointerId );
        return;
      }
    }
    if ( e.button !== 0 || e.altKey ) return;
    const st = useEditor.getState();
    // Texture Paint: a stroke on the selected modelled piece ( off it, a click selects as usual )
    if ( st.tool === "material" && st.materialMode === "paint" ) {
      this.strokePressure = this.pressureOf( e );
      if ( this.engine.meshPainter.down( p.x, p.y, this.strokePressure, e.ctrlKey ) ) {
        this.engine.renderer.domElement.setPointerCapture( e.pointerId );
        return;
      }
    }
    // the Trails tool: points, handles, runs, and new points on the ground
    if ( st.tool === "trail" && !this.engine.controls.flying && this.engine.trailTool.mouse.down( p.x, p.y, e ) ) {
      this.engine.renderer.domElement.setPointerCapture( e.pointerId );
      return;
    }
    // a picked lift's handles and pieces, dragged on their own; Ctrl+click on the ground puts a mast there
    if ( st.tool === "select" && !this.engine.controls.flying && this.engine.liftTool.down( p.x, p.y, e ) ) {
      this.engine.renderer.domElement.setPointerCapture( e.pointerId );
      return;
    }
    // shape handles ( when a shape is selected ) and the Shapes tool
    if ( st.tool !== "sculpt" && this.engine.shapeTool?.down( p.x, p.y ) ) {
      this.engine.renderer.domElement.setPointerCapture( e.pointerId );
      return;
    }
    const hit = this.engine.pickTerrain( p.x, p.y );
    switch ( st.tool ) {
      case "model":
      case "material":
      case "select": {
        if ( st.railEdit ) {
          const i = this.engine.railTool.hit( this.engine.ray( p.x, p.y ) );
          if ( i !== null ) return void useEditor.setState( { railEdit: { ...st.railEdit, point: i } } );
          const on = this.engine.pickObject( p.x, p.y );
          if ( e.ctrlKey && on?.uid === st.railEdit.uid ) return void this.engine.rails.addPointAt( p.x, p.y );
          // on the piece ( not a point ): no point picked; off it: a click as any other ( deselects, or picks
          // what's there ), which ends editing
          if ( on?.uid === st.railEdit.uid ) return void useEditor.setState( { railEdit: { ...st.railEdit, point: null } } );
        }
        const sel = this.engine.pickObject( p.x, p.y );
        // the Assets workspace: Blender's Select Box ( a drag from nothing boxes pieces; the header's mode adds or takes )
        if ( this.engine.stage.shown ) {
          const extend = e.shiftKey || st.selectOp === "extend", subtract = e.ctrlKey || st.selectOp === "subtract";
          if ( !sel ) {
            this.objBox = { x0: p.x, y0: p.y, extend, subtract };
            this.engine.renderer.domElement.setPointerCapture( e.pointerId );
            return;
          }
          const has = st.selection.some( ( s ) => s.uid === sel.uid );
          if ( subtract ) return st.setSelection( st.selection.filter( ( s ) => s.uid !== sel.uid ) );
          if ( extend   ) return st.setSelection( has ? [...st.selection.filter( ( s ) => s.uid !== sel.uid ), sel] : [...st.selection, sel] );
          return st.setSelection( [sel] );
        }
        if ( !sel ) return st.setSelection( e.shiftKey ? st.selection : [] );
        // ( a lift: the gizmo starts on the piece clicked )
        if ( sel.kind === "object" && !e.shiftKey ) this.engine.liftTool.pickAt( sel.uid, p.x, p.y );
        if ( e.shiftKey ) {
          const has = st.selection.some( ( s ) => s.uid === sel.uid );
          st.setSelection( has ? st.selection.filter( ( s ) => s.uid !== sel.uid ) : [...st.selection, sel] );
        } else st.setSelection( [sel] );
        return;
      }
      case "paint": {
        if ( !hit ) return;
        const u             = toUnity( hit );
        this.paintStroke    = new PaintStroke( st.paint, e.ctrlKey );
        this.strokePressure = this.pressureOf( e );
        // Shift+click: a straight line on from where the last stroke ended
        if ( e.shiftKey && this.lastPaintAt ) void this.paintStroke.move( this.lastPaintAt[0], this.lastPaintAt[1] );
        void this.paintStroke.move( u[0], u[2] );
        this.lastPaintAt = [u[0], u[2]];
        this.engine.renderer.domElement.setPointerCapture( e.pointerId );
        return;
      }
      case "sculpt": {
        if ( !hit ) return;
        const u  = toUnity( hit );
        const sc = st.sculpt;
        // Ctrl+click picks a height for Flatten
        if ( e.ctrlKey && sc.brush === "flatten" ) {
          st.setBrush( { targetHeight: Math.round( u[1] * 100 ) / 100, flattenTarget: "exact" } );
          st.toast( `Flatten to ${u[1].toFixed( 2 )} m (picked)`, "info" );
          return;
        }
        this.strokePressure = this.pressureOf( e );
        this.stroke         = new BrushStroke( terrain, sc, [u[0], u[2]], { invert: e.ctrlKey, smooth: e.shiftKey } );
        this.stroke.move( { x: u[0], z: u[2], pressure: this.strokePressure } );
        this.engine.renderer.domElement.setPointerCapture( e.pointerId );
        return;
      }
      case "place": {
        if ( hit && st.placeEntry ) {
          const pl = this.engine.placing.libraryPlacement( hit );
          this.engine.placing.onPlaceEntry?.( st.placeEntry, pl.pos, pl.rot );
        }
        else if ( hit && st.placeId ) this.engine.placing.placeObject( st.placeId, hit );
        return;
      }
      case "spawn": {
        if ( hit ) this.engine.placing.placeSpawn( hit );
        return;
      }
      case "scatter": {
        if ( !hit ) return;
        const u            = toUnity( hit ), erase = e.ctrlKey;
        // ( the picked pieces' meshes come into the map first: the stroke starts once they're here )
        this.scatterStroke = "starting";
        try {
          this.engine.renderer.domElement.setPointerCapture( e.pointerId );
        } catch {
          // ( a pointer that's gone: the stroke works without )
        }
        void scatterTemplates( () => this.engine.customR.reloadLibrary() ).then( ( t ) => {
          if ( this.scatterStroke !== "starting" ) return;
          if ( !t.length ) {
            this.scatterStroke = null;
            return useEditor.getState().toast( "No pieces picked", "info" );
          }
          this.scatterStroke = new ScatterStroke( t, erase );
          this.scatterStroke.dab( u[0], u[2] );
        } );
        return;
      }
    }
  };

  onMove = ( e: PointerEvent ) => {
    const p = this.engine.local( e );
    this.engine.mouse.copy( p );
    if ( this.sizeDrag ) return this.moveSizeDrag( p.x );
    if ( this.engine.controls.riderMode ) return;
    if ( this.engine.controls.flying ) return;
    if ( this.engine.meshPainter.painting ) {
      this.strokePressure = this.pressureOf( e );
      this.engine.meshPainter.move( p.x, p.y, this.strokePressure );
      return;
    }
    if ( this.engine.blGizmo.dragging ) return this.engine.blGizmo.move( p.x, p.y, { ctrl: e.ctrlKey, shift: e.shiftKey } );
    if ( this.objBox ) {
      const b = this.objBox;
      window.dispatchEvent( new CustomEvent( "model-box", { detail: [Math.min( b.x0, p.x ), Math.min( b.y0, p.y ), Math.max( b.x0, p.x ), Math.max( b.y0, p.y )] } ) );
      return;
    }
    if ( !e.buttons ) this.engine.blGizmo.hoverAt( p.x, p.y );
    // Loop Cut and Knife stay armed while they're the tool
    if ( !e.buttons && this.engine.editing === this.engine.modelEd && this.engine.modelEd.uid ) this.engine.modelEd.toolbar.armTool( useEditor.getState().modelTool );
    if ( this.engine.editing?.move( e, p.x, p.y ) ) {
      window.dispatchEvent( new CustomEvent( "model-box", { detail: this.engine.editing.boxRect } ) );
      return;
    }
    if ( this.engine.shapeTool?.dragging ) {
      this.engine.shapeTool.move( p.x, p.y );
      return;
    }
    if ( this.engine.trailTool?.mouse.dragging ) {
      this.engine.trailTool.mouse.move( p.x, p.y );
      return;
    }
    if ( this.engine.liftTool?.dragging ) {
      this.engine.liftTool.move( p.x, p.y );
      return;
    }
    if ( !e.buttons ) this.engine.trailTool?.hints.hover( p.x, p.y, e.ctrlKey );
    const st                = useEditor.getState();
    const hit               = this.engine.pickTerrain( p.x, p.y );
    this.engine.cursorWorld = hit;
    if ( this.scatterStroke instanceof ScatterStroke && hit ) {
      const u = toUnity( hit );
      this.scatterStroke.dab( u[0], u[2] );
    }

    if ( this.engine.placing.libGhost ) {
      this.engine.placing.libGhost.visible = st.tool === "place" && !!hit;
      if ( hit ) {
        const pl = this.engine.placing.libraryPlacement( hit );
        this.engine.placing.libGhost.position.copy( pl.p );
        this.engine.placing.libGhost.quaternion.copy( pl.q );
      }
    }
    if ( st.tool === "place" && st.placeId && !st.placeEntry && hit ) {
      this.engine.placing.ghost.visible = true;
      this.engine.placing.ghost.position.copy( hit );
      this.engine.placing.ghost.quaternion.copy( this.engine.placing.placementRotation( hit ) );
      const sc = st.defaultPlaceholderScale;
      this.engine.placing.ghost.scale.setScalar( sc );
    } else this.engine.placing.ghost.visible = false;

    if ( this.paintStroke && hit ) {
      this.strokePressure = this.pressureOf( e );
      const u             = toUnity( hit );
      void this.paintStroke.move( u[0], u[2] );
      this.lastPaintAt = [u[0], u[2]];
    }
    if ( this.stroke ) {
      this.strokePressure = this.pressureOf( e );
      if ( hit ) {
        const u = toUnity( hit );
        this.stroke.move( { x: u[0], z: u[2], pressure: this.strokePressure } );
      }
      const line = this.stroke.line;
      if ( line ) {
        const at = ( [x, z]: [number, number] ) => toThree( [x, terrain.heightAt( x, z ) + 0.3, z] );
        this.rampLine.geometry.setFromPoints( [at( line[0] ), at( line[1] )] );
        this.rampLine.visible = true;
      }
    }
  };

  /**
   * Pen pressure ( 0..1 ); 1 for a mouse.
  **/
  private pressureOf( e: PointerEvent ) {
    return e.pointerType === "pen" ? Math.max( 0.05, e.pressure || 0.5 ) : 1;
  }

  /**
   * Metres one screen pixel covers at a point ( for dragging things by mouse distance ).
  **/
  private metresPerPixel( at: THREE.Vector3 ) {
    const d = this.engine.camera.position.distanceTo( at );
    return ( 2 * d * Math.tan( ( this.engine.camera.fov * Math.PI ) / 360 ) ) / Math.max( 1, this.engine.host.clientHeight );
  }

  /**
   * Puts the brush outline ( drawn by the terrain shader ) where the brush is: every symmetric copy, the right
   * shape and size, and the Clone brush's source. Runs every frame, so it follows setting changes live.
  **/
  updateBrushLook() {
    const st                = useEditor.getState();
    const sc                = st.sculpt, b = sc.brushes[sc.brush];
    const painting          = st.tool === "paint", scattering = st.tool === "scatter";
    const show              = ( st.tool === "sculpt" || painting || scattering ) && ( !!this.stroke || !!this.paintStroke || ( this.engine.mouseInside && !!this.engine.cursorWorld ) ) && !this.engine.controls.riderMode && !this.engine.controls.flying;
    snowLook.showFlow.value = painting && st.paint.tool === "flow" ? 1 : 0;
    // ( every chunk's paint loaded on entering Paint Mode, not under the first dab: a 4096² mask held a stroke 0.4 s )
    const paintKey          = painting ? `${st.projectDir}|${terrain.chunks.map( ( c ) => c.key ).join( "," )}` : "";
    if ( paintKey && paintKey !== this.paintLoaded ) {
      this.paintLoaded = paintKey;
      void Promise.all( terrain.chunks.map( ( c ) => ensureLayer( c ) ) );
    }
    const grip = painting && st.paint.tool === "grip" ? 1 : 0;
    if ( grip !== snowLook.showGrip.value ) {
      snowLook.showGrip.value = grip;
      if ( grip ) void Promise.all( terrain.chunks.map( ( c ) => ensureLayer( c ) ) ).then( () => this.engine.terrainR.refreshGrip() );
    }
    brushLook.visible.value  = show ? 1 : 0;
    brushLook.showMask.value = sc.showMask ? 1 : 0;
    if ( !show ) return;
    let x: number, z: number, r = painting ? st.paint.radius : scattering ? st.scatter.radius : sc.radius;
    if ( this.stroke ) {
      [x, z] = this.stroke.brushPoint;
      r      = this.stroke.radius;
    } else {
      // ( a paint stroke goes on with the cursor off the ground: the outline stays where it was )
      if ( !this.engine.cursorWorld ) return;
      const u = toUnity( this.engine.cursorWorld );
      x       = u[0];
      z       = u[2];
    }
    // the same symmetric copies the stroke paints
    const pts: [number, number][] = [[x, z]];
    const sym                     = sc.symmetry;
    if ( !painting && !scattering && ( sym.x || sym.z || sym.radial > 1 ) ) {
      const bb       = terrain.bounds();
      const [px, pz] = sym.pivot ?? [( bb.x0 + bb.x1 ) / 2, ( bb.z0 + bb.z1 ) / 2];
      if ( sym.x ) pts.push( ...pts.map( ( [a, c] ): [number, number] => [2 * px - a, c] ) );
      if ( sym.z ) pts.push( ...pts.map( ( [a, c] ): [number, number] => [a, 2 * pz - c] ) );
      const n = Math.max( 1, Math.round( sym.radial ) );
      for ( let k = 1; k < n && pts.length < 4; k++ ) {
        const a = ( k * 2 * Math.PI ) / n;
        pts.push( [px + ( x - px ) * Math.cos( a ) - ( z - pz ) * Math.sin( a ), pz + ( x - px ) * Math.sin( a ) + ( z - pz ) * Math.cos( a )] );
      }
    }
    brushLook.count.value = Math.min( 4, pts.length );
    pts.slice( 0, 4 ).forEach( ( [a, c], k ) => brushLook.centers[k].value.set( a, -c ) );
    brushLook.radius.value    = r;
    brushLook.hard.value      = scattering ? 1 : painting ? st.paint.hardness : b.falloff === "custom" || b.falloff === "constant" ? 1 : Math.min( 1, Math.max( 0, b.hardness ) );
    brushLook.roundness.value = painting || scattering ? 1 : b.roundness;
    brushLook.angle.value     = painting || scattering ? 0 : -( b.rotation * Math.PI ) / 180;
  }

  /**
   * F / Shift+F: move the mouse to resize the brush ( or change its strength ), click to keep, Esc to cancel.
  **/
  startSizeDrag( what: "radius" | "strength" ) {
    const st      = useEditor.getState();
    const v0      = what === "radius" ? st.sculpt.radius : st.sculpt.brushes[st.sculpt.brush].strength;
    const at      = this.engine.cursorWorld;
    this.sizeDrag = { what, x0: this.engine.mouse.x, v0, perPx: what === "radius" ? ( at ? this.metresPerPixel( at ) : 0.1 ) : 1 / 300 };
    st.toast( `${what === "radius" ? "Brush size" : "Strength"}: move the mouse, click to keep, Esc to cancel`, "info" );
  }

  private moveSizeDrag( x: number ) {
    const d  = this.sizeDrag!;
    const st = useEditor.getState();
    if ( d.what === "radius" ) st.setSculpt( { radius: Math.min( 500, Math.max( 0.25, d.v0 + ( x - d.x0 ) * d.perPx ) ) } );
    else st.setBrush( { strength: Math.min( 1, Math.max( 0.005, d.v0 + ( x - d.x0 ) * d.perPx ) ) } );
  }

  endSizeDrag( keep: boolean ) {
    const d = this.sizeDrag;
    if ( !d ) return;
    this.sizeDrag = null;
    if ( keep ) return;
    const st = useEditor.getState();
    if ( d.what === "radius" ) st.setSculpt( { radius: d.v0 } );
    else st.setBrush( { strength: d.v0 } );
  }

  onUp = ( e: PointerEvent ) => {
    if ( e.button === 0 && this.engine.meshPainter.painting ) return this.engine.meshPainter.up();
    if ( e.button === 0 && this.engine.blGizmo.up() ) return;
    if ( e.button === 0 && this.objBox ) {
      const b     = this.objBox, p = this.engine.local( e );
      this.objBox = null;
      window.dispatchEvent( new CustomEvent( "model-box", { detail: null } ) );
      const st = useEditor.getState();
      if ( Math.hypot( p.x - b.x0, p.y - b.y0 ) < 4 ) return void ( !b.extend && !b.subtract && st.setSelection( [] ) );
      const [x0, y0, x1, y1] = [Math.min( b.x0, p.x ), Math.min( b.y0, p.y ), Math.max( b.x0, p.x ), Math.max( b.y0, p.y )];
      const r                = this.engine.host.getBoundingClientRect();
      // a piece is in the box when any corner of its bounds is
      const inBox            = ( uid: string ) => {
        const g = this.engine.customR.objectGroup( uid );
        if ( !g?.children.length ) return false;
        const box = new THREE.Box3().setFromObject( g );
        for ( let k = 0; k < 8; k++ ) {
          const v  = new THREE.Vector3( k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z ).project( this.engine.camera );
          const sx = ( v.x * 0.5 + 0.5 ) * r.width, sy = ( -v.y * 0.5 + 0.5 ) * r.height;
          if ( v.z <= 1 && sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 ) return true;
        }
        return false;
      };
      const hit = st.customObjects.filter( ( o ) => !st.locked[o.uid] && !st.hiddenInView[o.uid] && inBox( o.uid ) ).map( ( o ) => ( { kind: "custom" as const, uid: o.uid } ) );
      const ids = new Set( hit.map( ( h ) => h.uid ) );
      st.setSelection( b.subtract ? st.selection.filter( ( s ) => !ids.has( s.uid ) ) : b.extend ? [...st.selection.filter( ( s ) => !ids.has( s.uid ) ), ...hit] : hit );
      return;
    }
    const ed = this.engine.editing;
    if ( ed ) {
      const p = this.engine.local( e );
      if ( ed.up( e, p.x, p.y ) ) {
        window.dispatchEvent( new CustomEvent( "model-box", { detail: null } ) );
        return;
      }
      // a right-click ( not a drag to fly ): the context menu
      const r = this.rightDown;
      if ( e.button === 2 && r && Math.hypot( p.x - r.x, p.y - r.y ) < 5 && performance.now() - r.t < 400 && !ed.modal ) ed.contextMenu();
    }
    // the Assets workspace's Object Mode: a right-click is its Object menu
    if ( e.button === 2 && !ed && this.engine.stage.shown && useEditor.getState().tool === "model" ) {
      const p = this.engine.local( e ), r = this.rightDown;
      if ( r && Math.hypot( p.x - r.x, p.y - r.y ) < 5 ) this.engine.menus.objectMenu();
    }
    if ( e.button === 0 && this.engine.shapeTool?.dragging ) return this.engine.shapeTool.up();
    if ( e.button === 0 && this.engine.trailTool?.mouse.dragging ) return this.engine.trailTool.mouse.up();
    if ( e.button === 0 && this.engine.liftTool?.dragging ) return this.engine.liftTool.up();
    if ( e.button === 0 && this.scatterStroke ) {
      const s            = this.scatterStroke;
      this.scatterStroke = null;
      if ( s !== "starting" ) s.end();
      return;
    }
    if ( e.button === 0 && this.paintStroke ) {
      const s          = this.paintStroke;
      this.paintStroke = null;
      void s.end();
      return;
    }
    if ( e.button !== 0 || !this.stroke ) return;
    if ( this.stroke.end() ) useEditor.getState().markDirty();
    this.stroke           = null;
    this.rampLine.visible = false;
  };
}
