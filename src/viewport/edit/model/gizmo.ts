// Edit Mode under the toolbar's Move / Rotate / Scale gizmo: the selection's pivot, and its drag kept or put back.

import * as THREE from "three/webgpu";
import { toThree, toUnity } from "../../../core/coords";
import type { CustomObjectEntry } from "../../../core/types";
import { useEditor } from "../../../map/store";
import type { ModelEditor } from "./modelEditor";

// The gizmo on the selection.
export class ModelGizmo {
  constructor( private ed: ModelEditor ) {}

  private from: { o0: CustomObjectEntry; verts: number[]; world: THREE.Vector3[] } | null = null;

  /**
   * Where the gizmo goes: the selection's pivot ( null when nothing's selected or an operator is running ).
  **/
  pivot(): THREE.Vector3 | null {
    const o = this.ed.obj();
    // ( not while an edit is being recorded: the piece is put back as it was for a moment, the selection still the new )
    if ( !o || !this.ed.sel.v.size || this.ed.modal || this.ed.recording ) return null;
    if ( useEditor.getState().modelTools.pivot === "cursor" ) return toThree( useEditor.getState().cursor3d );
    return this.pivotOf( o, this.ed.sel.v );
  }

  /**
   * A gizmo drag starts: the selected corners as they are.
  **/
  start() {
    const o = this.ed.obj();
    if ( !o ) return;
    const verts = [...this.ed.sel.v], M = this.ed.matrix( o );
    this.from   = { o0: o, verts, world: verts.map( ( v ) => this.ed.world( o, o.model.mesh.v[v], M ) ) };
  }

  /**
   * The drag so far ( a change in the view's space ): the selected corners moved by it.
  **/
  move( delta: THREE.Matrix4 ) {
    const f = this.from, o = this.ed.obj();
    if ( !f || !o ) return;
    const Minv = this.ed.matrix( o ).invert(), mesh = { ...o.model.mesh, v: [...o.model.mesh.v] };
    f.verts.forEach( ( v, i ) => ( mesh.v[v] = toUnity( f.world[i].clone().applyMatrix4( delta ).applyMatrix4( Minv ) ) ) );
    this.ed.setMesh( mesh, null );
  }

  /**
   * The drag let go of ( Esc, a right click ): the corners back where they were.
  **/
  cancel() {
    const f   = this.from;
    this.from = null;
    if ( f ) this.ed.setMesh( f.o0.model!.mesh, null );
  }

  /**
   * What a gizmo drag snaps onto under the mouse: a vertex ( not a moving one ) or a surface ( not this piece ).
  **/
  snapTarget( x: number, y: number, to: "vertex" | "edge" | "surface" ) {
    if ( to === "vertex" ) return this.ed.ops.vertexUnder( x, y, new Set( this.from?.verts ?? this.ed.sel.v ) );
    if ( to === "edge"   ) return this.ed.ops.edgePointUnder( x, y, new Set( this.from?.verts ?? this.ed.sel.v ) );
    return this.ed.view.surfaceAt?.( x, y, this.ed.uid ?? "" ) ?? null;
  }

  /**
   * The drag done: one undo step.
  **/
  end( label: string ) {
    const f   = this.from;
    this.from = null;
    if ( f && this.ed.obj()?.model.mesh !== f.o0.model!.mesh ) this.ed.commitFrom( f.o0, label );
  }

  pivotOf( o: CustomObjectEntry, verts: Iterable<number> ) {
    const g = o.model!.mesh;
    const c = new THREE.Vector3();
    let n   = 0;
    for ( const v of verts ) {
      if ( !g.v[v] ) continue;
      c.add( this.ed.world( o, g.v[v] ) );
      n++;
    }
    return n ? c.divideScalar( n ) : this.ed.world( o, [0, 0, 0] );
  }
}
