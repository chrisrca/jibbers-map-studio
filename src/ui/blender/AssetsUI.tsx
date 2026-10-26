// The Assets workspace's 3D view chrome, as Blender's: the header ( mode, menus, transform settings, overlays, X-ray,
// shading ), the tool settings row, and the toolbar ( Blender's tools and icons ).

import type { ReactNode } from "react";
import { useEditor, type AssetTool, type Shading } from "../../map/store";
import { getEngine } from "../Viewport";
import { MenuButton, type MenuItem } from "../widgets/widgets";
import { BlIcon, ToolIcon } from "./BlIcon";
import { pieceTexture } from "../../texture/meshPaint";
import { newAsset, saveAsset, saveAssetAs } from "../../pieces/assetFiles";
import { useTransformReadout } from "./ViewOverlays";

const eng = () => getEngine();

/**
 * Texture Paint on the selected modelled piece ( the colour brush's settings ).
**/
export function enterTexturePaint() {
  const st = useEditor.getState();
  if ( !st.selection.some( ( s ) => s.kind === "custom" && st.customObjects.find( ( o ) => o.uid === s.uid )?.model ) ) {
    st.toast( "No modelled piece selected", "info" );
    return;
  }
  const piece = st.selection.find( ( s ) => s.kind === "custom" && st.customObjects.find( ( o ) => o.uid === s.uid )?.model )!;
  const eng   = getEngine();
  const go    = () => {
    useEditor.setState( { materialMode: "paint" } );
  };
  const o = st.customObjects.find( ( x ) => x.uid === piece.uid )!;
  if ( !eng || pieceTexture( piece.uid ) || !o.parts[0].materials.some( ( m ) => m.base_tex || m.metallic_tex || m.roughness_tex ) ) return go();
  st.setBusy( "Baking its textures…" );
  return eng.modelling.bakeTexturedModel( piece.uid ).finally( () => {
    useEditor.getState().setBusy( null );
    go();
  } );
}

/**
 * Which of Blender's modes the workspace is in.
**/
export function useAssetMode(): "object" | "edit" | "paint" {
  const edit  = useEditor( ( s ) => !!s.modelEdit                                       );
  const paint = useEditor( ( s ) => s.tool === "material" && s.materialMode === "paint" );
  return paint ? "paint" : edit ? "edit" : "object";
}

export function setAssetMode( m: "object" | "edit" | "paint" ) {
  const st = useEditor.getState(), e = eng();
  if ( !e ) return;
  if ( m  !== "edit" && e.editing ) e.modelling.toggleEditMode();
  if ( m === "paint" ) {
    if ( st.tool !== "material" ) st.setTool( "material" );
    void enterTexturePaint();
    return;
  }
  if ( st.tool !== "model" ) st.setTool( "model" );
  if ( m === "edit" && !e.editing ) queueMicrotask( () => eng()?.modelling.toggleEditMode() );
}

const MODES = { object: ["object_datamode", "Object Mode"], edit: ["editmode_hlt", "Edit Mode"], paint: ["tpaint_hlt", "Texture Paint"] } as const;

/**
 * A header button: a Blender icon, on when `on`.
**/
export function HB( { icon, on, title, onClick, children }: { icon?: string; on?: boolean; title: string; onClick: () => void; children?: ReactNode } ) {
  return (
    <button className={`hb${on ? " on" : ""}`} title={title} onClick={onClick}>
      {icon && <BlIcon name={icon} />}
      {children}
    </button>
  );
}

export function AssetsHeader() {
  const readout = useTransformReadout();
  const mode    = useAssetMode();
  const edit    = useEditor( ( s ) => s.modelEdit  );
  const v       = useEditor( ( s ) => s.view3d     );
  const t       = useEditor( ( s ) => s.modelTools );
  const setV    = ( p: Partial<typeof v> ) => useEditor.setState( { view3d: { ...useEditor.getState().view3d, ...p } } );
  const setT    = ( p: Partial<typeof t> ) => useEditor.setState( ( s ) => ( { modelTools: { ...s.modelTools, ...p } } ) );
  const sel     = ( on: boolean ) => {
    const e = eng(), st = useEditor.getState();
    if ( e?.editing === e?.modelEd && e?.modelEd.uid ) return e.modelEd.picking.selectAll( on );
    st.setSelection( on ? st.customObjects.map( ( o ) => ( { kind: "custom" as const, uid: o.uid } ) ) : [] );
  };
  const assetItems = (): MenuItem[] => [
    { label: "New",          bl:    "file_new", run: () => void newAsset() },
    { sep:   true,           label: "" },
    { label: "Save",         keys:  "Ctrl S", bl: "file_tick", run: () => void saveAsset() },
    { label: "Save as New…", keys:  "Shift Ctrl S", run: () => void saveAssetAs() },
  ];
  const viewItems = (): MenuItem[] => [
    { label: "Frame Selected", keys: "Numpad .", run: () => eng()?.nav.frameSelection() },
    { label: "Frame All",      keys: "Home",     run: () => eng()?.nav.frameAll()       },
    { sep:   true,           label: "" },
    { label: "Top",          keys:  "Numpad 7", bl: "axis_top", run: () => eng()?.nav.viewAlong( "top" ) },
    { label: "Front",        keys:  "Numpad 1", bl: "axis_front", run: () => eng()?.nav.viewAlong( "front" ) },
    { label: "Right",        keys:  "Numpad 3", bl: "axis_side", run: () => eng()?.nav.viewAlong( "right" ) },
    { label: "Bottom",       keys:  "Ctrl Numpad 7", run: () => eng()?.nav.viewAlong( "bottom" ) },
    { label: "Back",         keys:  "Ctrl Numpad 1", run: () => eng()?.nav.viewAlong( "back" ) },
    { label: "Left",         keys:  "Ctrl Numpad 3", run: () => eng()?.nav.viewAlong( "left" ) },
    { sep:   true,           label: "" },
    { label: "Toggle X-Ray", keys:  "Alt Z", bl: "xray", checked: v.xray, run: () => setV( { xray: !v.xray } ) },
  ];
  const selectItems = (): MenuItem[] => [
    { label: "All",  keys: "A",     run: () => sel( true  ) },
    { label: "None", keys: "Alt A", run: () => sel( false ) },
  ];
  const objectItems = (): MenuItem[] => [
    { label: "Join",      keys: "Ctrl J",  run: () => eng()?.modelling.joinSelected() },
    // ( as Shift+D: the copy moves with the mouse, not left on top of the original )
    { label: "Duplicate", keys: "Shift D", bl:  "duplicate", run: () => eng()?.menus.duplicateAndGrab() },
    { label: "Delete",    keys: "X",       bl:  "trash", run: () => useEditor.getState().removeSelected() },
    { sep:   true,                 label: "" },
    { label: "Convert to Model",   run:   () => void eng()?.modelling.convertToModel() },
    { label: "Convert to Mesh",    run:   () => eng()?.modelling.convertToMesh() },
    { sep:   true,                 label: "" },
    { label: "Boolean Difference", keys:  "Ctrl −", bl: "mod_boolean", run: () => void eng()?.modelling.booleanSelected( "difference" ) },
    { label: "Boolean Union",      keys:  "Ctrl +", run: () => void eng()?.modelling.booleanSelected( "union" ) },
    { label: "Boolean Intersect",  keys:  "Ctrl *", run: () => void eng()?.modelling.booleanSelected( "intersect" ) },
  ];
  const meshItems = (): MenuItem[] => [
    { label: "Extrude",     keys: "E",      run: () => eng()?.modelEd.arm( "e"     ) },
    { label: "Inset Faces", keys: "I",      run: () => eng()?.modelEd.arm( "i"     ) },
    { label: "Bevel",       keys: "Ctrl B", run: () => eng()?.modelEd.arm( "b"     ) },
    { label: "Loop Cut",    keys: "Ctrl R", run: () => eng()?.modelEd.arm( "loop"  ) },
    { label: "Knife",       keys: "K",      run: () => eng()?.modelEd.arm( "knife" ) },
    { label: "Spin",      run:   () => eng()?.modelEd.arm( "spin" ) },
    { sep:   true,        label: "" },
    { label: "Merge…",    keys:  "M", run: () => eng()?.modelEd.menus.mergeMenu() },
    { label: "Separate…", keys:  "P", run: () => eng()?.modelEd.menus.separateMenu() },
    { label: "Delete…",   keys:  "X", run: () => eng()?.modelEd.menus.deleteMenu() },
    { label: "Normals…",  keys:  "Alt N", run: () => eng()?.modelEd.menus.normalsMenu() },
  ];
  const ORIENT = { global:    ["orientation_global", "Global"             ], local:  ["orientation_local", "Local"    ] } as const;
  const PIVOT  = { bounds:    ["pivot_boundbox",     "Bounding Box Center"], cursor: ["pivot_cursor",      "3D Cursor"], individual: ["pivot_individual", "Individual Origins"], median: ["pivot_median", "Median Point"], active: ["pivot_active", "Active Element"] } as const;
  const SNAP   = { increment: ["snap_increment",     "Increment"          ], vertex: ["snap_vertex",       "Vertex"   ], surface: ["snap_face", "Face"] } as const;
  // a transform under way: what it's doing, where the menus were ( as Blender's header )
  if ( readout ) return <div className="vp-header bl readout"><span>{readout}</span></div>;
  const SHADING: [Shading, string, string][] = [["wire", "shading_wire", "Wireframe"], ["solid", "shading_solid", "Solid"], ["material", "shading_texture", "Material Preview"], ["rendered", "shading_rendered", "Rendered"]];
  return (
    <div className="vp-header bl">
      <span className="editor-icon" title="3D Viewport"><BlIcon name="view3d" /></span>
      <MenuButton
        className="mode-pull"
        bl={MODES[mode][0]}
        label={MODES[mode][1]}
        items={( Object.keys( MODES ) as ( keyof typeof MODES )[] ).map( ( m ) => ( { label: MODES[m][1], bl: MODES[m][0], checked: m === mode, keys: m === "edit" ? "Tab" : undefined, run: () => setAssetMode( m ) } ) )}
      />
      { mode === "edit" && edit && (
        <div className="seg hseg">
          <HB icon="vertexsel" on={edit.mode === "vert"} title="Vertex (1)" onClick={() => eng()?.modelEd.picking.setMode( "vert" )} />
          <HB icon="edgesel" on={edit.mode === "edge"} title="Edge (2)" onClick={() => eng()?.modelEd.picking.setMode( "edge" )} />
          <HB icon="facesel" on={edit.mode === "face"} title="Face (3)" onClick={() => eng()?.modelEd.picking.setMode( "face" )} />
        </div>
      ) }
      <MenuButton label="Asset" items={assetItems} />
      <MenuButton label="View" items={viewItems} />
      {mode !== "paint" && <MenuButton label="Select" items={selectItems} />}
      { mode !== "paint" && (
        <button className="bpull" onClick={( e ) => eng()?.menus.addMenu( ( e.currentTarget as HTMLElement ).getBoundingClientRect() )}>Add</button>
      ) }
      {mode === "object" && <MenuButton label="Object" items={objectItems} />}
      {mode === "edit" && <MenuButton label="Mesh" items={meshItems} />}
      <span className="spacer" />
      { mode !== "paint" && (
        <div className="hgroup">
          <MenuButton bl={ORIENT[v.orientation][0]} label={ORIENT[v.orientation][1]} title="Transform Orientation" items={( Object.keys( ORIENT ) as ( keyof typeof ORIENT )[] ).map( ( k ) => ( { label: ORIENT[k][1], bl: ORIENT[k][0], checked: v.orientation === k, run: () => setV( { orientation: k } ) } ) )} />
          <MenuButton bl={PIVOT[t.pivot][0]} title="Transform Pivot Point" items={( Object.keys( PIVOT ) as ( keyof typeof PIVOT )[] ).map( ( k ) => ( { label: PIVOT[k][1], bl: PIVOT[k][0], checked: t.pivot === k, run: () => setT( { pivot: k } ) } ) )} />
          <div className="seg hseg">
            <HB icon={t.snap ? "snap_on" : "snap_off"} on={t.snap} title="Snap (Shift Tab)" onClick={() => setT( { snap: !t.snap } )} />
            <MenuButton bl={SNAP[t.snapTo][0]} title="Snap To" items={( Object.keys( SNAP ) as ( keyof typeof SNAP )[] ).map( ( k ) => ( { label: SNAP[k][1], bl: SNAP[k][0], checked: t.snapTo === k, run: () => setT( { snapTo: k } ) } ) )} />
          </div>
          <HB icon={t.proportional ? "prop_on" : "prop_off"} on={t.proportional} title="Proportional Editing (O)" onClick={() => setT( { proportional: !t.proportional } )} />
        </div>
      ) }
      <span className="spacer" />
      <HB icon="gizmo" on={v.gizmos} title="Show Gizmo" onClick={() => setV( { gizmos: !v.gizmos } )} />
      <div className="seg hseg">
        <HB icon="overlay" on={v.overlays.grid || v.overlays.faceOrientation || v.overlays.stats} title="Overlays" onClick={() => setV( { overlays: { ...v.overlays, grid: !v.overlays.grid } } )} />
        <MenuButton
          title="Viewport Overlays"
          bl="disclosure_tri_down"
          items={[
            { label: "Grid",             bl: "grid",    checked: v.overlays.grid,            run: () => setV( { overlays: { ...v.overlays, grid: !v.overlays.grid } } ) },
            { label: "Statistics",       bl: "info",    checked: v.overlays.stats,           run: () => setV( { overlays: { ...v.overlays, stats: !v.overlays.stats } } ) },
            { label: "Face Orientation", bl: "facesel", checked: v.overlays.faceOrientation, run: () => setV( { overlays: { ...v.overlays, faceOrientation: !v.overlays.faceOrientation } } ) },
          ]}
        />
      </div>
      <HB icon="xray" on={v.xray} title="Toggle X-Ray (Alt Z)" onClick={() => setV( { xray: !v.xray } )} />
      <div className="seg hseg">
        { SHADING.map( ( [k, icon, label] ) => (
          <HB key={k} icon={icon} on={v.shading === k} title={`Viewport Shading: ${label}`} onClick={() => setV( { shading: k } )} />
        ) ) }
      </div>
    </div>
  );
}

/**
 * The tool settings row ( under the header ): what the active tool takes.
**/
export function AssetsToolSettings() {
  const tool = useEditor( ( s ) => s.modelTool );
  const op   = useEditor( ( s ) => s.selectOp  );
  const info = TOOLS.find( ( x ) => x.id === tool );
  return (
    <>
      <span className="tool-name">{info && <ToolIcon name={info.icon} size={16} />} {info?.label}</span>
      { ( tool === "select" || tool === "move" || tool === "rotate" || tool === "scale" || tool === "transform" ) && (
        <div className="seg hseg">
          <HB icon="select_set" on={op === "set"} title="Set a new selection" onClick={() => useEditor.setState( { selectOp: "set" } )} />
          <HB icon="select_extend" on={op === "extend"} title="Extend existing selection" onClick={() => useEditor.setState( { selectOp: "extend" } )} />
          <HB icon="select_subtract" on={op === "subtract"} title="Subtract existing selection" onClick={() => useEditor.setState( { selectOp: "subtract" } )} />
        </div>
      ) }
    </>
  );
}

// Blender's toolbar tools: in which modes, their icons and keys.
const TOOLS: { id: AssetTool; icon: string; label: string; keys?: string; edit?: true; group: number }[] = [
  { id: "select",    icon: "ops.generic.select_box",            label: "Select Box",     keys:  "W", group: 0 },
  { id: "cursor",    icon: "ops.generic.cursor",                label: "Cursor",         group: 0 },
  { id: "move",      icon: "ops.transform.translate",           label: "Move",           keys:  "G", group: 1 },
  { id: "rotate",    icon: "ops.transform.rotate",              label: "Rotate",         keys:  "R", group: 1 },
  { id: "scale",     icon: "ops.transform.resize",              label: "Scale",          keys:  "S", group: 1 },
  { id: "transform", icon: "ops.transform.transform",           label: "Transform",      group: 1 },
  { id: "add",       icon: "ops.mesh.primitive_cube_add_gizmo", label: "Add Cube",       group: 2 },
  { id: "extrude",   icon: "ops.mesh.extrude_region_move",      label: "Extrude Region", keys:  "E", edit: true, group: 3 },
  { id: "inset",     icon: "ops.mesh.inset",                    label: "Inset Faces",    keys:  "I", edit: true, group: 3 },
  { id: "bevel",     icon: "ops.mesh.bevel",                    label: "Bevel",          keys:  "Ctrl B", edit: true, group: 3 },
  { id: "loopcut",   icon: "ops.mesh.loopcut_slide",            label: "Loop Cut",       keys:  "Ctrl R", edit: true, group: 3 },
  { id: "knife",     icon: "ops.mesh.knife_tool",               label: "Knife",          keys:  "K", edit: true, group: 3 },
  { id: "spin",      icon: "ops.mesh.spin",                     label: "Spin",           edit:  true, group: 4 },
  { id: "smooth",    icon: "ops.mesh.vertices_smooth",          label: "Smooth",         edit:  true, group: 4 },
  { id: "slide",     icon: "ops.transform.edge_slide",          label: "Edge Slide",     edit:  true, group: 4 },
  { id: "shrink",    icon: "ops.transform.shrink_fatten",       label: "Shrink/Fatten",  keys:  "Alt S", edit: true, group: 4 },
];

const PAINT_TOOLS: { id: "brush" | "fill" | "gradient" | "decal"; icon: string; label: string }[] = [
  { id: "brush",    icon: "brush.draw",                label: "Draw"     },
  { id: "fill",     icon: "brush.paint_texture.fill",  label: "Fill"     },
  { id: "gradient", icon: "ops.paint.weight_gradient", label: "Gradient" },
  { id: "decal",    icon: "brush.paint_texture.clone", label: "Decal"    },
];

export function AssetsToolbar() {
  const mode    = useAssetMode();
  const tool    = useEditor( ( s ) => s.modelTool     );
  const texTool = useEditor( ( s ) => s.paint.texTool );
  if ( mode === "paint" )
    return (
      <div className="tool-column bl">
        <div className="tool-group">
          { PAINT_TOOLS.map( ( t ) => (
            <button key={t.id} className={`tool${texTool === t.id ? " on" : ""}`} title={t.label} onClick={() => useEditor.getState().setPaint( { texTool: t.id } )}>
              <ToolIcon name={t.icon} />
            </button>
          ) ) }
        </div>
      </div>
    );
  const shown  = TOOLS.filter( ( t ) => mode === "edit" || !t.edit );
  const groups = [...new Set( shown.map( ( t ) => t.group ) )];
  return (
    <div className="tool-column bl">
      { groups.map( ( g ) => (
        <div key={g} className="tool-group">
          { shown
            .filter( ( t ) => t.group === g )
            .map( ( t ) => (
              <button key={t.id} className={`tool${tool === t.id ? " on" : ""}`} title={t.keys ? `${t.label} (${t.keys})` : t.label} onClick={() => useEditor.setState( { modelTool: t.id } )}>
                <ToolIcon name={t.icon} />
              </button>
            ) ) }
        </div>
      ) ) }
    </div>
  );
}
