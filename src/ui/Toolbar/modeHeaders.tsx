// Object and Paint Mode's headers, the mode switch, and the Select and Add menus.

import { useState } from "react";
import { copySelection, hasClipboard, paste } from "../../map/clipboard";
import { realTerrainOf } from "../../map/project";
import { unlocked, useEditor } from "../../map/store";
import type { PaintTool } from "../../paint/settings";
import { mirrorTerrain } from "../../terrain/ops";
import { HB } from "../blender/AssetsUI";
import { BlIcon, ToolIcon } from "../blender/BlIcon";
import { pickAndImportAny } from "../importAny";
import { getEngine } from "../Viewport";
import { Slider } from "../widgets/controls";
import { Icon } from "../widgets/icons";
import { MarkingSwatches } from "../widgets/MarkingSwatches";
import { MenuButton, type MenuItem, Popover } from "../widgets/widgets";
import { TerrainViewPanel, layRuns } from "./terrainHeaders";
import { grindOn, toggleGrindLines, toggleSlope } from "./ToolColumn";
import { MODES, type Mode, PAINT_TOOLS, modeOf, showBrushSettings } from "./tools";

function selectAllItems() {
  const st = useEditor.getState();
  st.setSelection( unlocked( st, [
    ...st.objects.map( ( o ) => ( { kind: "object" as const, uid: o.uid } ) ),
    ...st.spawns.map( ( o ) => ( { kind: "spawn" as const, uid: o.uid } ) ),
    ...st.customObjects.map( ( o ) => ( { kind: "custom" as const, uid: o.uid } ) ),
  ] ) );
}

const SELECT_MENU = (): MenuItem[] => [
  { label: "All",  keys: "Ctrl A", bl: "select_set",      run: selectAllItems },
  { label: "None", keys: "Alt A",  bl: "select_subtract", run: () => useEditor.getState().setSelection( [] ) },
];

const ADD_MENU = (): MenuItem[] => [
  { label: "Spawn",         icon: "spawn", keys: "N", run: () => useEditor.getState().setTool( "spawn" ) },
  { label: "Library Piece", icon: "place", keys: "P", run: () => useEditor.getState().setTool( "place" ) },
  { sep:   true,             label: "" },
  { label: "Ramp",           icon:  "shapeCurve", keys: "H", run: () => useEditor.setState( { tool: "shape", shapeKind: "curve" } ) },
  { label: "Copy Terrain",   icon:  "shapeCopy", run: () => useEditor.setState( { tool: "shape", shapeKind: "stamp" } ) },
  { sep:   true,             label: "" },
  { label: "Import…",        icon:  "import", keys: "Ctrl I", run: () => pickAndImportAny() },
  { label: "Real Mountain…", icon:  "mountain", run: () => useEditor.setState( { mountainImport: true } ) },
];

/**
 * The object brush's settings ( the tool settings row ): what it drops, and how.
**/
export function ScatterHeader() {
  const sc    = useEditor( ( s ) => s.scatter      );
  const lib   = useEditor( ( s ) => s.assetLibrary );
  const set   = ( p: Partial<typeof sc> ) => useEditor.setState( { scatter: { ...useEditor.getState().scatter, ...p } } );
  const names = sc.picks.map( ( id ) => lib.find( ( e ) => e.id === id )?.name ).filter( Boolean );
  return (
    <>
      <span className="tool-name"><Icon name="draw" size={14} /> Scatter</span>
      <span className={`muted pick-list ${names.length ? "" : "none"}`} title={names.join( ", " )}>{names.length ? names.join( ", " ) : "No pieces"}</span>
      {names.length > 0 && <button className="btn ghost small" title="Clear" onClick={() => set( { picks: [] } )}><Icon name="close" size={12} /></button>}
      <Slider label="Radius" log value={sc.radius} min={1} max={100} step={0.5} onChange={( radius ) => set( { radius } )} fmt={( v ) => `${v.toFixed( 1 )} m`} />
      <Slider label="Spacing" log value={sc.spacing} min={0.5} max={50} step={0.25} onChange={( spacing ) => set( { spacing } )} fmt={( v ) => `${v.toFixed( 1 )} m`} />
      <Slider label="Size Variation" value={sc.scaleJitter} min={0} max={0.5} step={0.01} onChange={( scaleJitter ) => set( { scaleJitter } )} fmt={( v ) => `±${Math.round( v * 100 )}%`} />
      <Slider label="Follow Slope" value={sc.followSlope} min={0} max={1} step={0.05} onChange={( followSlope ) => set( { followSlope } )} fmt={( v ) => `${Math.round( v * 100 )}%`} />
      <Slider label="Lean" value={sc.tilt} min={0} max={20} step={1} onChange={( tilt ) => set( { tilt } )} fmt={( v ) => `${Math.round( v )}°`} />
    </>
  );
}

/**
 * Object mode: which handles the gizmo shows.
**/
export function SelectHeader() {
  const g     = useEditor( ( s ) => s.gizmoMode );
  const names = { translate: ["ops.transform.translate", "Move"], rotate: ["ops.transform.rotate", "Rotate"], scale: ["ops.transform.resize", "Scale"] } as const;
  return (
    <span className="tool-name">
      <ToolIcon name={names[g][0]} size={16} /> {names[g][1]}
    </span>
  );
}

const DESIGN_MODES = { object: ["object_datamode", "Object Mode"], sculpt: ["sculptmode_hlt", "Terrain Mode"], paint: ["tpaint_hlt", "Paint Mode"] } as const;

/**
 * The Design workspace's 3D view header, as Blender's: the mode, its menus, the orientation, the view's toggles.
**/
export function DesignHeader() {
  const tool     = useEditor( ( s ) => s.tool        );
  const v        = useEditor( ( s ) => s.view3d      );
  const tv       = useEditor( ( s ) => s.terrainView );
  const [, bump] = useState( 0 );
  useState( () => window.addEventListener( "grind-lines", () => bump( ( n ) => n + 1 ) ) );
  const mode      = modeOf( tool );
  const eng       = getEngine;
  const viewItems = (): MenuItem[] => [
    { label: "Frame Selected", keys: "Numpad .", icon: "frame", run: () => eng()?.nav.frameSelection() },
    { label: "Frame All",      keys: "Home",     icon: "home",  run: () => eng()?.nav.frameAll()       },
    { sep:   true,            label: "" },
    { label: "Top",           keys:  "Numpad 7", bl: "axis_top", run: () => eng()?.nav.viewAlong( "top" ) },
    { label: "Front",         keys:  "Numpad 1", bl: "axis_front", run: () => eng()?.nav.viewAlong( "front" ) },
    { label: "Right",         keys:  "Numpad 3", bl: "axis_side", run: () => eng()?.nav.viewAlong( "right" ) },
    { sep:   true,            label: "" },
    { label: "Rider View",    keys:  "Ctrl R", icon: "person", run: () => eng()?.nav.enterRider() && useEditor.setState( { cameraMode: "rider" } ) },
    { label: "Slope Colours", keys:  "Ctrl L", icon: "mountain", checked: useEditor.getState().terrainView.slope, run: toggleSlope },
    { label: "Grind Lines",   icon:  "rail", checked: grindOn, run: toggleGrindLines },
  ];
  const objectItems = (): MenuItem[] => [
    { label: "Copy",      bl: "copydown",  keys: "Ctrl C",  run:      () => void copySelection() },
    { label: "Paste",     bl: "pastedown", keys: "Ctrl V",  disabled: !hasClipboard(), run: () => void paste() },
    { label: "Duplicate", bl: "duplicate", keys: "Shift D", run:      () => useEditor.getState().duplicateSelected() },
    { sep:   true,     label: "" },
    { label: "Delete", bl:    "trash", keys: "X", run: () => useEditor.getState().removeSelected() },
  ];
  const sculptItems = (): MenuItem[] => [
    { label: "Trails",           icon: "trail", run:      () => useEditor.getState().setTool( "trail" ) },
    { label: "Trails from Runs", icon: "trail", disabled: !realTerrainOf(), run: () => void layRuns() },
    { sep:   true,           label: "" },
    { label: "Ramp",         icon:  "shapeCurve", keys: "H", run: () => useEditor.setState( { tool: "shape", shapeKind: "curve" } ) },
    { label: "Copy Terrain", icon:  "shapeCopy", run: () => useEditor.setState( { tool: "shape", shapeKind: "stamp" } ) },
    { sep:   true,           label: "" },
    { label: "Mirror", bl: "mod_mirror", sub: [
      { label: "Left to Right", bl: "axis_side",  run: () => mirrorTerrain( "x" ) },
      { label: "Front to Back", bl: "axis_front", run: () => mirrorTerrain( "z" ) },
    ] },
  ];
  const ORIENT = { global: ["orientation_global", "Global"], local: ["orientation_local", "Local"] } as const;
  return (
    <div className="vp-header bl">
      <span className="editor-icon" title="3D Viewport"><BlIcon name="view3d" /></span>
      <MenuButton
        className="mode-pull"
        bl={DESIGN_MODES[mode][0]}
        label={DESIGN_MODES[mode][1]}
        items={( Object.keys( DESIGN_MODES ) as Mode[] ).map( ( m ) => ( { label: DESIGN_MODES[m][1], bl: DESIGN_MODES[m][0], checked: m === mode, keys: MODES.find( ( x ) => x.id === m )?.key, run: () => useEditor.getState().setTool( MODES.find( ( x ) => x.id === m )!.tool ) } ) )}
      />
      <MenuButton label="View" items={viewItems} />
      {mode === "object" && <MenuButton label="Select" items={SELECT_MENU} />}
      {mode === "object" && <MenuButton label="Add" items={ADD_MENU} />}
      {mode === "object" && <MenuButton label="Object" items={objectItems} />}
      {mode === "sculpt" && <MenuButton label="Terrain" items={sculptItems} />}
      <span className="spacer" />
      { mode === "object" && (
        <MenuButton bl={ORIENT[v.orientation][0]} label={ORIENT[v.orientation][1]} title="Transform Orientation" items={( Object.keys( ORIENT ) as ( keyof typeof ORIENT )[] ).map( ( k ) => ( { label: ORIENT[k][1], bl: ORIENT[k][0], checked: v.orientation === k, run: () => useEditor.setState( { view3d: { ...useEditor.getState().view3d, orientation: k } } ) } ) )} />
      ) }
      <span className="spacer" />
      <HB on={grindOn} title="Grind Lines" onClick={toggleGrindLines}><Icon name="magnet" size={14} /></HB>
      <div className="seg hseg">
        <HB on={tv.slope || tv.hillshade > 0 || tv.contours > 0} title="Slope Colours (Ctrl L)" onClick={toggleSlope}><Icon name="mountain" size={14} /></HB>
        <Popover title="Terrain View">
          <TerrainViewPanel />
        </Popover>
      </div>
      <HB title="Rider View (Ctrl R)" onClick={() => eng()?.nav.enterRider() && useEditor.setState( { cameraMode: "rider" } )}><Icon name="person" size={14} /></HB>
      <HB title="Frame All (Home)" onClick={() => eng()?.nav.frameAll()}><Icon name="frame" size={14} /></HB>
    </div>
  );
}

// What a paint tool's two ways are called ( Ctrl switches while held ); none for one with a single way.
type Directions = Record<PaintTool, [string, string] | null>;

/**
 * Paint mode's quick settings.
**/
export function PaintHeader() {
  const p                = useEditor( ( s ) => s.paint );
  const set              = useEditor.getState().setPaint;
  const info             = PAINT_TOOLS.find( ( t ) => t.id === p.tool )!;
  const dirs: Directions = { snow: ["Snow", "Rock"], marking: ["Paint", "Erase"], powder: ["Add", "Remove"], grip: ["Add", "Remove"], flow: null };
  const dir              = dirs[p.tool];
  return (
    <>
      <b><Icon name={info.icon} size={14} /> {info.label}</b>
      { dir && (
        <div className="seg" title="Ctrl switches while held">
          <button className={!p.invert ? "on" : ""} onClick={() => set( { invert: false } )}>{dir[0]}</button>
          <button className={p.invert ? "on" : ""} onClick={() => set( { invert: true } )}>{dir[1]}</button>
        </div>
      ) }
      <Slider label="Radius" log value={p.radius} min={0.25} max={300} step={0.05} onChange={( radius ) => set( { radius } )} fmt={( v ) => `${v < 10 ? v.toFixed( 2 ) : v.toFixed( 1 )} m`} />
      <Slider label="Strength" value={p.strength} min={0.01} max={1} step={0.01} onChange={( strength ) => set( { strength } )} fmt={( v ) => v.toFixed( 2 )} />
      {p.tool === "marking" && <MarkingSwatches small />}
      {( p.tool === "powder" || p.tool === "grip" ) && <Slider label="Depth" value={p.powder} min={0} max={1} step={0.01} onChange={( powder ) => set( { powder } )} fmt={( v ) => `${( v * 100 ).toFixed( 0 )} cm`} />}
      <button className="bdrop" title="Fills and all the settings" onClick={showBrushSettings}>Options <Icon name="chevronDown" size={12} className="chev" /></button>
    </>
  );
}
