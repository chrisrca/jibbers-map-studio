// Edit Mode's menus ( Blender's ): Delete, Merge, Edge, Separate, Normals, the right-click menu, and material slots.

import { namesFor, pieceName } from "../../../map/names";
import { useEditor } from "../../../map/store";
import { newUid } from "../../../map/store";
import { compact, recalcOutside, type Mesh } from "../../../model/mesh";
import { withModel } from "../../../model/objects";
import { bridge, emptySel, fill, flip, linked, merge, remove, selFromFaces, setSmooth, subdivide, type DeleteKind, type MergeKind } from "../../../model/ops";
import type { MenuItem } from "../../../ui/widgets/widgets";
import type { ModelEditor } from "./modelEditor";

// Edit Mode's menus.
export class ModelMenus {
  constructor( private ed: ModelEditor ) {}

  op( mesh: Mesh, label: string ) {
    this.ed.setMesh( mesh, label );
  }

  private menuAtMouse( title: string, items: MenuItem[] ) {
    const r = this.ed.view.host.getBoundingClientRect();
    this.ed.view.menu( r.left + this.ed.mouse.x, r.top + this.ed.mouse.y, title, items );
  }

  deleteMenu() {
    if ( this.ed.obj() ) this.menuAtMouse( "Delete", this.deleteItems() );
  }

  private deleteItems(): MenuItem[] {
    const run = ( kind: DeleteKind, label: string ) => () => {
      const r     = remove( this.ed.obj()!.model.mesh, this.ed.sel, kind );
      this.ed.sel = r.sel;
      this.op( r.mesh, label );
    };
    return [
      { label: "Vertices",   run: run( "verts",     "Delete vertices"   ) },
      { label: "Edges",      run: run( "edges",     "Delete edges"      ) },
      { label: "Faces",      run: run( "faces",     "Delete faces"      ) },
      { label: "Only Faces", run: run( "onlyFaces", "Delete only faces" ) },
      { sep:   true,                label: "" },
      { label: "Dissolve Vertices", run:   run( "dissolveVerts", "Dissolve vertices" ) },
      { label: "Dissolve Edges",    run:   run( "dissolveEdges", "Dissolve edges" ) },
      { label: "Dissolve Faces",    run:   run( "dissolveFaces", "Dissolve faces" ) },
    ];
  }

  mergeMenu() {
    this.menuAtMouse( "Merge", this.mergeItems() );
  }

  private mergeItems(): MenuItem[] {
    const order = [...this.ed.sel.v];
    const run   = ( kind: MergeKind, label: string ) => () => {
      const r     = merge( this.ed.obj()!.model.mesh, kind === "distance" ? this.ed.obj()!.model.mesh.v.map( ( _, i ) => i ).filter( ( v ) => this.ed.sel.v.has( v ) ) : order, kind );
      this.ed.sel = r.sel;
      this.op( r.mesh, label );
    };
    return [
      { label: "At Center",   run: run( "center",   "Merge at center"   ) },
      { label: "At First",    run: run( "first",    "Merge at first"    ) },
      { label: "At Last",     run: run( "last",     "Merge at last"     ) },
      { label: "Collapse",    run: run( "collapse", "Collapse"          ) },
      { label: "By Distance", run: run( "distance", "Merge by distance" ) },
    ];
  }

  /**
   * Ctrl+E: Blender's Edge menu ( what's here of it ).
  **/
  edgeMenu() {
    this.menuAtMouse( "Edge", [this.bridgeItem(), this.subdivideItem(), this.slideItem()] );
  }

  private bridgeItem(): MenuItem {
    const g = () => this.ed.obj()!.model.mesh;
    return { label: "Bridge Edge Loops", run: () => {
      const r = bridge( g(), this.ed.sel.e );
      if ( r.mesh === g() ) return useEditor.getState().toast( "Select two loops of the same length", "info" );
      this.ed.sel = r.sel;
      this.op( r.mesh, "Bridge edge loops" );
    } };
  }

  private subdivideItem(): MenuItem {
    return { label: "Subdivide", run: () => {
      const r     = subdivide( this.ed.obj()!.model.mesh, this.ed.sel.f );
      this.ed.sel = r.sel;
      this.op( r.mesh, "Subdivide" );
    } };
  }

  private slideItem(): MenuItem {
    return { label: this.ed.mode === "vert" ? "Slide Vertices" : "Edge Slide", keys: "G G", run: () => {
      this.ed.ops.startTransform( "g" );
      const m = this.ed.modal;
      if ( m?.kind === "transform" ) { m.op = "slide"; m.label = "Slide"; }
    } };
  }

  /**
   * P: Separate — the selected faces ( or each loose part ) into a piece of their own, in the same place.
  **/
  separateMenu() {
    this.menuAtMouse( "Separate", this.separateItems() );
  }

  private separateItems(): MenuItem[] {
    const run = ( loose: boolean ) => () => {
      const o = this.ed.obj();
      if ( !o ) return;
      const g                  = o.model.mesh;
      const groups: number[][] = [];
      if ( loose ) {
        const seen = new Set<number>();
        g.f.forEach( ( f, fi ) => {
          if ( seen.has( fi ) ) return;
          const verts = linked( g, f ), faces = g.f.map( ( _, i ) => i ).filter( ( i ) => verts.has( g.f[i][0] ) );
          faces.forEach( ( i ) => seen.add( i ) );
          groups.push( faces );
        } );
        if ( groups.length < 2 ) return useEditor.getState().toast( "It's all one part", "info" );
        groups.shift();
      } else {
        if ( !this.ed.sel.f.size ) return;
        groups.push( [...this.ed.sel.f] );
      }
      const st            = useEditor.getState();
      const moved         = new Set( groups.flat() );
      const pick          = ( faces: number[] ) => compact( { ...g, f: faces.map( ( i ) => g.f[i] ), m: faces.map( ( i ) => g.m[i] ), s: faces.map( ( i ) => g.s[i] ), w: [] } ).mesh;
      const rest          = pick( g.f.map( ( _, i ) => i ).filter( ( i ) => !moved.has( i ) ) );
      const pieces        = groups.map( ( faces ) => withModel( { ...o, uid: newUid() }, { ...o.model, paint: undefined, mesh: pick( faces ) } ) );
      const kept          = withModel( o, { ...o.model, mesh: rest } );
      const customObjects = [...st.customObjects.map( ( x ) => ( x.uid === o.uid ? kept : x ) ), ...pieces];
      st.commit( loose ? "Separate by loose parts" : "Separate selection", {
        customObjects,
        // ( Blender's: "Cube" separated makes "Cube.001" )
        labels: namesFor( { labels: st.labels, customObjects }, pieces.map( ( x ) => ( { uid: x.uid, want: pieceName( st, o ) } ) ) ),
      } );
      this.ed.sel = emptySel();
      this.ed.sync();
      this.ed.publish();
    };
    return [
      { label: "Selection",      run: run( false ) },
      { label: "By Loose Parts", run: run( true  ) },
    ];
  }

  normalsMenu() {
    this.menuAtMouse( "Normals", this.normalsItems() );
  }

  private normalsItems(): MenuItem[] {
    const g = () => this.ed.obj()!.model.mesh;
    return [
      { label: "Flip",                run:  () => this.op( flip( g(), this.ed.sel.f ), "Flip normals" ) },
      { label: "Recalculate Outside", keys: "Ctrl N", run: () => this.op( recalcOutside( g(), this.ed.sel.f.size ? this.ed.sel.f : undefined ), "Recalculate outside" ) },
    ];
  }

  /**
   * The context menu ( right-click ): Blender's Vertex, Edge or Face menu, as the select mode is ( what's here of it ).
  **/
  contextMenu() {
    const g                  = () => this.ed.obj()!.model.mesh;
    const smooth             = ( on: boolean ): MenuItem => ( { label: on ? "Shade Smooth" : "Shade Flat", run: () => this.op( setSmooth( g(), this.selectedFaces(), on ), on ? "Shade smooth" : "Shade flat" ) } );
    const fillItem: MenuItem = { label: "New Edge/Face from Vertices", keys: "F", run: () => {
      const r     = fill( g(), [...this.ed.sel.v] );
      this.ed.sel = r.sel;
      this.op( r.mesh, "Fill" );
    } };
    const tail: MenuItem[] = [
      { sep:   true,       label: "" },
      { label: "Merge",    keys:  "M", sub: this.mergeItems() },
      { label: "Separate", keys:  "P", sub: this.separateItems() },
      { sep:   true,       label: "" },
      { label: "Delete",   keys:  "X", sub: this.deleteItems() },
    ];
    if ( this.ed.mode === "vert" )
      return this.menuAtMouse( "Vertex", [
        this.subdivideItem(),
        { label: "Extrude Vertices", keys: "E",            run: () => this.ed.ops.extrude()    },
        { label: "Bevel Vertices",   keys: "Shift Ctrl B", run: () => this.ed.ops.startBevel() },
        { sep: true, label: "" },
        fillItem,
        { sep: true, label: "" },
        this.slideItem(),
        { label: "Smooth Vertices", run: () => useEditor.setState( { modelTool: "smooth" } ) },
        ...tail,
      ] );
    if ( this.ed.mode === "edge" )
      return this.menuAtMouse( "Edge", [
        this.subdivideItem(),
        { label: "Extrude Edges", keys: "E",      run: () => this.ed.ops.extrude()    },
        { label: "Bevel Edges",   keys: "Ctrl B", run: () => this.ed.ops.startBevel() },
        this.bridgeItem(),
        { label: "Loop Cut and Slide", keys: "Ctrl R", run: () => this.ed.loopCut.start() },
        { label: "Knife",              keys: "K",      run: () => this.ed.knife.start()   },
        { sep: true, label: "" },
        this.slideItem(),
        ...tail,
      ] );
    return this.menuAtMouse( "Face", [
      { label: "Extrude Faces", keys: "E", run: () => this.ed.ops.extrude()    },
      { label: "Inset Faces",   keys: "I", run: () => this.ed.ops.startInset() },
      { label: "Spin", run: () => this.ed.ops.startSpin() },
      this.subdivideItem(),
      fillItem,
      { sep: true, label: "" },
      smooth( true  ),
      smooth( false ),
      { sep:   true,      label: "" },
      { label: "Normals", keys:  "Alt N", sub: this.normalsItems() },
      ...tail,
    ] );
  }

  /**
   * The faces an operator works on: selected faces, or ( vertex / edge mode ) those whose corners are all selected.
  **/
  private selectedFaces() {
    return this.ed.sel.f;
  }

  /**
   * The selected faces given material slot `slot` ( Blender's Assign ). False when no face is selected.
  **/
  assignSlot( slot: number ): boolean {
    const o = this.ed.obj();
    if ( !o || !this.ed.sel.f.size ) return false;
    const g = o.model.mesh;
    this.op( { ...g, m: g.f.map( ( _, i ) => ( this.ed.sel.f.has( i ) ? slot : g.m[i] ?? 0 ) ) }, "Assign material" );
    return true;
  }

  /**
   * The faces of material slot `slot` added to the selection, or taken out of it ( Blender's Select / Deselect ).
  **/
  selectSlot( slot: number, on: boolean ) {
    const o = this.ed.obj();
    if ( !o ) return;
    const g = o.model.mesh, faces = new Set( this.ed.sel.f );
    g.f.forEach( ( _, i ) => ( g.m[i] ?? 0 ) === slot && ( on ? faces.add( i ) : faces.delete( i ) ) );
    this.ed.sel = selFromFaces( g, [...faces] );
    this.ed.sync();
    this.ed.publish();
  }
}
