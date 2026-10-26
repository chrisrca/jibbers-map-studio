// Edit Mode's toolbar tools ( Blender's ): Extrude, Inset, Bevel, Loop Cut, Knife… as drags on the selection.

import { type Mesh } from "../../../model/mesh";
import { shrinkFatten, smoothVerts } from "../../../model/ops";
import type { ModelEditor } from "./modelEditor";
import { Modal } from "./modelEditor";

// The toolbar's tools.
export class ModelToolbar {
  constructor( private ed: ModelEditor ) {}

  // a tool's drag under way: letting go keeps it
  toolDrag = false;

  /**
   * Whether an element ( vertex, edge key or face, by mode ) is selected.
  **/
  isSelected( el: number | string ) {
    return typeof el === "string" ? this.ed.sel.e.has( el ) : this.ed.mode === "face" ? this.ed.sel.f.has( el ) : this.ed.sel.v.has( el );
  }

  /**
   * A press with an editing tool: on the selection it starts the tool's drag ( let go to keep it ); elsewhere it
   * selects as usual. Whether it took the press.
  **/
  toolDown( tool: string, x: number, y: number ): boolean {
    if ( this.ed.modal || !this.ed.sel.v.size ) return false;
    const el = this.ed.picking.pick( x, y );
    if ( el === null || !this.isSelected( el ) ) return false;
    this.ed.mouse = { x, y };
    switch ( tool ) {
      case "extrude": this.ed.ops.extrude();    break;
      case "inset":   this.ed.ops.startInset(); break;
      case "bevel":   this.ed.ops.startBevel(); break;
      case "spin":    this.ed.ops.startSpin();  break;
      case "slide": {
        this.ed.ops.startTransform( "g" );
        const m = this.ed.modal as Modal | null;
        if ( m?.kind === "transform" ) { m.op = "slide"; m.label = "Slide"; }
        break;
      }
      case "smooth": this.startDrag( "Smooth", ( px ) => {
        const f = Math.max( 0, Math.min( 1, px / 200 ) );
        return { mesh: smoothVerts( this.dragBase(), new Set( this.ed.sel.v ), f, 3 ).mesh, status: `Smooth: ${Math.round( f * 100 )}%` };
      } ); break;
      case "shrink": this.startDrag( "Shrink/Fatten", ( px ) => {
        const o = this.ed.obj()!, d = ( px * this.ed.ops.mpp( this.ed.gizmo.pivotOf( o, this.ed.sel.v ) ) ) / ( Math.abs( o.scale.x ) || 1 );
        return { mesh: shrinkFatten( this.dragBase(), new Set( this.ed.sel.v ), d ).mesh, status: `Shrink/Fatten: ${d.toFixed( 3 )} m` };
      } ); break;
      default: return false;
    }
    this.toolDrag = !!this.ed.modal;
    return this.toolDrag;
  }

  /**
   * Loop Cut and Knife stay armed while they're the tool: their previews follow the mouse.
  **/
  armTool( tool: string ) {
    if ( this.ed.modal || !this.ed.obj() ) return;
    if ( tool === "loopcut" ) this.ed.loopCut.start();
    else if ( tool === "knife" ) this.ed.knife.start();
  }

  private dragBase() {
    const m = this.ed.modal;
    return m?.kind === "drag" ? m.mesh0 : this.ed.obj()!.model.mesh;
  }

  /**
   * A drag sideways sets an amount ( Smooth, Shrink/Fatten ).
  **/
  private startDrag( label: string, run: ( px: number ) => { mesh: Mesh; status: string } ) {
    const o = this.ed.obj();
    if ( !o ) return;
    this.ed.modal = { kind: "drag", o0: o, mesh0: o.model.mesh, x0: this.ed.mouse.x, label, run };
    this.runDrag();
  }

  runDrag() {
    const m = this.ed.modal;
    if ( m?.kind !== "drag" ) return;
    const r            = m.run( this.ed.mouse.x - m.x0 );
    this.ed.statusText = r.status;
    this.ed.setMesh( r.mesh, null );
  }
}
