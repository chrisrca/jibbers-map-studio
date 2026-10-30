// The 3D view's menus and the operators they run: Blender's Object menu, Add, Move to Collection, Rename.

import * as THREE from "three/webgpu";
import { ask } from "../../app/ask";
import { toThree, toUnity, unityEulerToQuat, type V3 } from "../../core/coords";
import { deltaBetween, transformCustom } from "../../core/transform";
import { arr3, type CustomObjectEntry } from "../../core/types";
import { copySelection, hasClipboard, paste } from "../../map/clipboard";
import { pieceName, uniqueName } from "../../map/names";
import { history } from "../../map/history";
import { newUid, unlocked, useEditor, type LastAdd } from "../../map/store";
import { type ModelData } from "../../model/build";
import { CURVE_PRESETS, presetCurve, type CurvePreset } from "../../model/curve";
import { primitive, PRIMITIVES, type PrimitiveId } from "../../model/mesh";
import { geometryToOrigin, isModelled, mirrorLocal, originTo, originToGeometry, shade } from "../../model/objectOps";
import { newCurveObject, newModelObject } from "../../model/objects";
import { showHideItems } from "../../ui/Toolbar/modeHeaders";
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
   * Shift+S: Blender's Snap menu, at the mouse.
  **/
  snapMenu() {
    const snap = this.objectMenuItems().find( ( i ) => i.label === "Snap" )?.sub;
    if ( snap ) this.menuAtMouse( "Snap", snap );
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
      { label: "Show/Hide",             sub:      showHideItems() },
      { sep:   true,                    label:    "" },
      { label: "Mirror",                disabled: noModels, sub: ( ["X", "Y", "Z"] as const ).map( ( a, i ) => ( { label: `${a} Local`, run: each( `Mirror ${a}`, ( o ) => mirrorLocal( o, ( [0, 2, 1] as const )[i] ) ) } ) ) },
      { label: "Snap", keys: "Shift S", sub: [
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
    const add   = ( id: PrimitiveId ) => () => {
      const into = !!this.engine.modelEd.uid;
      if ( into ) return this.addPrimitive( { uid: this.engine.modelEd.uid!, id, opts: {}, at: this.engine.modelEd.toPiece( at ), rot: [0, 0, 0], into } );
      // on the map: sitting on the ground ( a flat one just above it ); in Assets, its middle at the cursor
      const low = Math.min( ...primitive( id ).v.map( ( p ) => p[1] ) );
      this.addPrimitive( { uid: newUid(), id, opts: {}, at: onMap( this.engine.stage.shown ? 0 : Math.max( 0.002, -low ) ), rot: [0, 0, 0], into } );
    };
    const icons: Record<PrimitiveId, IconName> = {
      plane:    "primPlane",  cube:      "cube",          circle: "primCircle", cylinder: "primCylinder", cone: "primCone",
      uvsphere: "primSphere", icosphere: "primIcosphere", torus:  "primTorus",  grid:     "primGrid",
    };
    const items: MenuItem[] = [
      ...PRIMITIVES.map( ( p ) => ( { label: p.label, icon: icons[p.id], bl: `mesh_${p.id}`, run: add( p.id ) } ) ),
      { sep: true, label: "" },
      ...CURVE_PRESETS.map( ( p ) => ( { label: p.label, icon: "rail" as const, run: () => this.addCurve( p, onMap( p.jib && !this.engine.stage.shown ? 0.6 : 0 ) ) } ) ),
    ];
    window.dispatchEvent( new CustomEvent( "viewport-menu", { detail: { ...place, title: "Add", items } } ) );
  }

  /**
   * A primitive added ( Add › Mesh ): a new piece, or in Edit Mode into the mesh being edited, selected; kept as the
   * last thing done, to be done again with other settings ( Blender's Adjust Last Operation ).
  **/
  addPrimitive( a: Omit<LastAdd, "made"> ) {
    const name = PRIMITIVES.find( ( p ) => p.id === a.id )!.label;
    const turn = unityEulerToQuat( a.rot );
    let mesh   = primitive( a.id, a.opts );
    if ( a.into ) {
      mesh = { ...mesh, v: mesh.v.map( ( p ) => toUnity( toThree( p ).applyQuaternion( turn ) ) ) };
      this.engine.modelEd.addInto( mesh, a.at );
      const made = useEditor.getState().customObjects.find( ( o ) => o.uid === a.uid )?.model?.mesh;
      if ( made ) useEditor.setState( { lastAdd: { ...a, made } } );
      return;
    }
    const plain = newModelObject( a.uid, mesh, a.at );
    const o     = a.rot.some( ( x ) => x ) ? transformCustom( plain, deltaBetween( { pos: a.at, rot: [0, 0, 0], scl: [1, 1, 1] }, { pos: a.at, rot: a.rot, scl: [1, 1, 1] } ) ) : plain;
    useEditor.getState().addCustom( o, name );
    useEditor.getState().setSelection( [{ kind: "custom", uid: o.uid }] );
    const made = useEditor.getState().customObjects.find( ( x ) => x.uid === a.uid );
    if ( made ) useEditor.setState( { lastAdd: { ...a, made } } );
  }

  /**
   * The last Add › Mesh done again with other settings: taken back ( its undo step ), then added as they say.
  **/
  redoAdd( a: Omit<LastAdd, "made"> ) {
    history.undo();
    this.addPrimitive( a );
  }

  /**
   * A curve piece added at `at` ( Unity ), selected; on the map, a rail's points out to be moved straight away.
  **/
  addCurve( p: CurvePreset, at: V3 ) {
    const o = newCurveObject( newUid(), presetCurve( p ), at, p.jib );
    useEditor.getState().addCustom( o, p.label );
    useEditor.getState().setSelection( [{ kind: "custom", uid: o.uid }] );
    if ( p.jib && !this.engine.stage.shown ) useEditor.setState( { railEdit: { uid: o.uid, point: null } } );
    return o.uid;
  }

  /**
   * The Design workspace's Add › Rail: a curve piece where the view looks, on the ground.
  **/
  addCurveInView( p: CurvePreset ) {
    const r  = this.engine.host.getBoundingClientRect();
    const at = this.engine.pickTerrain( r.width / 2, r.height / 2 ) ?? this.engine.controls.target.clone();
    return this.addCurve( p, toUnity( at.add( new THREE.Vector3( 0, p.jib ? 0.6 : 0, 0 ) ) ) );
  }
}
