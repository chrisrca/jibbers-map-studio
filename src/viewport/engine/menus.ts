// The 3D view's menus and the operators they run: Blender's Object menu, Add, Move to Collection, Rename.

import * as THREE from "three/webgpu";
import { ask } from "../../app/ask";
import { toThree, toUnity, type V3 } from "../../core/coords";
import { transformCustom } from "../../core/transform";
import { arr3, type CustomObjectEntry } from "../../core/types";
import { copySelection, hasClipboard, paste } from "../../map/clipboard";
import { pieceName, uniqueName } from "../../map/names";
import { newUid, unlocked, useEditor, type Selection } from "../../map/store";
import { type ModelData } from "../../model/build";
import { newCurve, type CurveData } from "../../model/curve";
import { primitive, PRIMITIVES, type PrimitiveId } from "../../model/mesh";
import { geometryToOrigin, isModelled, mirrorLocal, originTo, originToGeometry, shade } from "../../model/objectOps";
import { newCurveObject, newModelObject } from "../../model/objects";
import type { IconName } from "../../ui/widgets/icons";
import type { MenuItem } from "../../ui/widgets/widgets";
import type { Engine } from "./engine";

// The view's menus ( Object, Add, Move to Collection ) and their operators.
export class ViewportMenus {
  constructor( private engine: Engine ) {}

  /**
   * Blender's Shift+D: a copy of what's selected, moving with the mouse ( a click puts it down, Esc takes it back ).
  **/
  duplicateAndGrab() {
    const made = useEditor.getState().duplicateSelected();
    if ( made.length ) queueMicrotask( () => this.engine.gizmo.startObjectModal( "translate" ) );
  }

  /**
   * The active piece's name, asked for ( F2 ).
  **/
  renameActive() {
    const st   = useEditor.getState();
    const last = st.selection[st.selection.length - 1];
    const o    = last && st.customObjects.find( ( x ) => x.uid === last.uid );
    if ( !o ) return;
    void ask( { title: "Rename Active Object", text: { label: "Name", value: pieceName( st, o ) }, answers: [{ id: "ok", label: "Rename", primary: true, usesText: true }, { id: "cancel", label: "Cancel" }] } )
      .then( ( a ) => a?.id === "ok" && a.text.trim() && useEditor.getState().renameItem( { kind: "custom", uid: o.uid }, uniqueName( useEditor.getState(), a.text.trim(), o.uid ) ) );
  }

  /**
   * M: the selection into a collection ( or a new one ).
  **/
  moveToCollectionMenu() {
    const items = this.collectionItems();
    if ( items.length ) this.menuAtMouse( "Move to Collection", items );
  }

  private collectionItems(): MenuItem[] {
    const st   = useEditor.getState();
    const uids = unlocked( st, st.selection ).map( ( s ) => s.uid );
    if ( !uids.length ) return [];
    return [
      { label: "Scene Collection", bl: "outliner_collection", run: () => useEditor.getState().moveToCollection( uids, null ) },
      ...st.collections.map( ( c ) => ( { label: c.name, bl: "outliner_collection", run: () => useEditor.getState().moveToCollection( uids, c.id ) } ) ),
      { sep:   true,             label: "" },
      { label: "New Collection", bl:    "collection_new", run: () => useEditor.getState().moveToCollection( uids, useEditor.getState().newCollection( null ) ) },
    ];
  }

  private menuAtMouse( title: string, items: MenuItem[] ) {
    const r = this.engine.host.getBoundingClientRect();
    window.dispatchEvent( new CustomEvent( "viewport-menu", { detail: { x: r.left + this.engine.mouse.x, y: r.top + this.engine.mouse.y, title, items } } ) );
  }

  /**
   * Blender's Object context menu ( a right click in Object Mode ).
  **/
  objectMenu() {
    if ( useEditor.getState().selection.length ) this.menuAtMouse( "Object", this.objectMenuItems() );
  }

  /**
   * The Object menu's operators ( the right-click menu, and the header's Object menu ).
  **/
  objectMenuItems(): MenuItem[] {
    const st     = useEditor.getState();
    const sel    = unlocked( st, st.selection ).map( ( s ) => st.customObjects.find( ( o ) => o.uid === s.uid ) ).filter( ( o ): o is CustomObjectEntry => !!o );
    const models = sel.filter( isModelled );
    const each   = ( label: string, f: ( o: CustomObjectEntry & { model: ModelData } ) => CustomObjectEntry ) => () => {
      useEditor.getState().updateCustom( label, models.map( ( o ) => o.uid ), ( o ) => ( isModelled( o ) ? f( o ) : o ) );
    };
    const noModels  = !models.length;
    const cursor    = () => toThree( useEditor.getState().cursor3d );
    const setCursor = ( v: THREE.Vector3 ) => useEditor.setState( { cursor3d: toUnity( v ) } );
    const moveTo    = ( to: ( o: CustomObjectEntry ) => THREE.Vector3, label: string ) => () => {
      useEditor.getState().updateCustom( label, sel.map( ( o ) => o.uid ), ( o ) => {
        const d = to( o ).sub( toThree( arr3( o.position ) ) );
        return transformCustom( o, new THREE.Matrix4().makeTranslation( d.x, d.y, d.z ) );
      } );
    };
    const grid = ( v: THREE.Vector3 ) => v.set( Math.round( v.x ), Math.round( v.y ), Math.round( v.z ) );
    return [
      { label: "Shade Smooth",      disabled: noModels, run: each( "Shade smooth",      ( o ) => shade( o, "smooth" ) ) },
      { label: "Shade Auto Smooth", disabled: noModels, run: each( "Shade auto smooth", ( o ) => shade( o, "auto"   ) ) },
      { label: "Shade Flat",        disabled: noModels, run: each( "Shade flat",        ( o ) => shade( o, "flat"   ) ) },
      { sep: true, label: "" },
      { label: "Convert To", sub: [
        { label: "Model", bl: "outliner_ob_mesh",   disabled: sel.every( ( o ) => o.model ), run: () => void this.engine.modelling.convertToModel() },
        { label: "Mesh",  bl: "outliner_data_mesh", disabled: noModels, run: () => this.engine.modelling.convertToMesh() },
      ] },
      { label: "Set Origin", disabled: noModels, sub: [
        { label: "Geometry to Origin", run: each( "Geometry to origin", geometryToOrigin ) },
        { label: "Origin to Geometry", run: each( "Origin to geometry", originToGeometry ) },
        { label: "Origin to 3D Cursor", run: each( "Origin to 3D cursor", ( o ) => originTo( o, cursor() ) ) },
      ] },
      { sep:   true,                    label:    "" },
      { label: "Copy Objects",          bl:       "copydown", keys: "Ctrl C", run: () => void copySelection() },
      { label: "Paste Objects",         bl:       "pastedown", keys: "Ctrl V", disabled: !hasClipboard(), run: () => void paste() },
      { sep:   true,                    label:    "" },
      { label: "Duplicate Objects",     bl:       "duplicate", keys: "Shift D", run: () => this.duplicateAndGrab() },
      { sep:   true,                    label:    "" },
      { label: "Rename Active Object…", keys:     "F2", run: () => this.renameActive() },
      { sep:   true,                    label:    "" },
      { label: "Mirror",                disabled: noModels, sub: ( ["X", "Y", "Z"] as const ).map( ( a, i ) => ( { label: `${a} Local`, run: each( `Mirror ${a}`, ( o ) => mirrorLocal( o, ( [0, 2, 1] as const )[i] ) ) } ) ) },
      { label: "Snap", sub: [
        { label: "Selection to Cursor", run: moveTo( () => cursor(), "Selection to cursor" ) },
        { label: "Selection to Grid",   run: moveTo( ( o ) => grid( toThree( arr3( o.position ) ) ), "Selection to grid" ) },
        { label: "Cursor to Selected",     disabled: !sel.length, run: () => setCursor( sel.reduce( ( a, o ) => a.add( toThree( arr3( o.position ) ) ), new THREE.Vector3() ).divideScalar( sel.length ) ) },
        { label: "Cursor to World Origin", run:      () => setCursor( new THREE.Vector3() ) },
        { label: "Cursor to Grid",         run:      () => setCursor( grid( cursor() ) ) },
      ] },
      { label: "Move to Collection", keys:  "M", sub: this.collectionItems() },
      { sep:   true,                 label: "" },
      { label: "Delete",             keys:  "X", run: () => useEditor.getState().removeSelected() },
    ];
  }

  /**
   * Shift+A ( or the Add button: `anchor`, its place ): primitives and curve pieces, added sitting on the floor under
   * the mouse ( from the button: the stage's middle ), upright on the stage.
  **/
  addMenu( anchor?: DOMRect ) {
    const r     = this.engine.host.getBoundingClientRect();
    // ( in Assets, at the 3D cursor, as Blender adds )
    const at    = ( this.engine.stage.shown ? toThree( useEditor.getState().cursor3d ) : null ) ?? this.engine.pickTerrain( this.engine.mouse.x, this.engine.mouse.y ) ?? this.engine.camera.position.clone().add( this.engine.camera.getWorldDirection( new THREE.Vector3() ).multiplyScalar( 10 ) );
    // under a header button, beside a toolbar one, else at the mouse
    const place = !anchor ? { x: r.left + this.engine.mouse.x, y: r.top + this.engine.mouse.y } : anchor.bottom <= r.top + 2 ? { x: anchor.left, y: anchor.bottom } : { x: anchor.right + 4, y: anchor.top };
    if ( this.engine.curveEd.uid ) {
      window.dispatchEvent( new CustomEvent( "viewport-menu", { detail: { ...place, title: "Add", items: [{ label: "Spline", icon: "rail", run: () => this.engine.curveEd.addSpline( at ) }] } } ) );
      return;
    }
    // `up` metres above the place
    const onMap = ( up: number ): V3 => toUnity( at.clone().add( new THREE.Vector3( 0, up, 0 ) ) );
    const add   = ( id: PrimitiveId, name: string ) => () => {
      const mesh = primitive( id );
      if ( this.engine.modelEd.uid ) return this.engine.modelEd.addInto( mesh, this.engine.modelEd.toPiece( at ) );
      // on the map: sitting on the ground ( a flat one just above it ); in Assets, its middle at the cursor
      const low            = Math.min( ...mesh.v.map( ( p ) => p[1] ) );
      const o              = newModelObject( newUid(), mesh, onMap( this.engine.stage.shown ? 0 : Math.max( 0.002, -low ) ) );
      const sel: Selection = { kind: "custom", uid: o.uid };
      useEditor.getState().addCustom( o, name );
      useEditor.getState().setSelection( [sel] );
    };
    const curve = ( label: string, pts: V3[], p: Partial<CurveData> = {}, sharp: number[] = [], jib = true ) => ( {
      label,
      icon: "rail" as const,
      run: () => {
        const c = { ...newCurve( pts ), ...p };
        for ( const i of sharp ) c.splines[0].points[i].sharp = true;
        const o = newCurveObject( newUid(), c, onMap( jib && !this.engine.stage.shown ? 0.6 : 0 ), jib );
        useEditor.getState().addCustom( o, label );
        useEditor.getState().setSelection( [{ kind: "custom", uid: o.uid }] );
      },
    } );
    const icons: Record<PrimitiveId, IconName> = {
      plane:    "primPlane",  cube:      "cube",          circle: "primCircle", cylinder: "primCylinder", cone: "primCone",
      uvsphere: "primSphere", icosphere: "primIcosphere", torus:  "primTorus",  grid:     "primGrid",
    };
    const items: MenuItem[] = [
      ...PRIMITIVES.map( ( p ) => ( { label: p.label, icon: icons[p.id], bl: `mesh_${p.id}`, run: add( p.id, p.label ) } ) ),
      { sep: true, label: "" },
      curve( "Rail",        [[-2,   0,   0 ], [2,  0,   0  ]] ),
      curve( "Kinked Rail", [[-3,   0.6, 0 ], [-1, 0.6, 0  ], [3, -0.6, 0]], {}, [1] ),
      curve( "Curved Rail", [[-2.5, 0,   -1], [0,  0,   0.6], [2.5, 0, -1]] ),
      curve( "Box Rail",    [[-2,   0,   0 ], [2,  0,   0  ]], { profile: "square", radius: 0.08 } ),
      curve( "Flat Bar",    [[-2,   0,   0 ], [2,  0,   0  ]], { profile: "flat", radius: 0.04, thickness: 0.004 } ),
      curve( "Pipe Leg",    [[0,    0,   0 ], [0,  0.6, 0  ]], { radius: 0.03 }, [], false ),
    ];
    window.dispatchEvent( new CustomEvent( "viewport-menu", { detail: { ...place, title: "Add", items } } ) );
  }
}
