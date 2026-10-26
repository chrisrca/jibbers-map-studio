// The tools and modes, as the toolbar, menus and keys list them.

import type { ToolId } from "../../map/store";
import { BLEND_MODES } from "../../paint/engine/stroke";
import type { PaintTool } from "../../paint/settings";
import type { BrushId } from "../../sculpt/brushes";
import type { IconName } from "../widgets/icons";

export const TOOLS: { id: ToolId; icon: IconName; key: string; label: string }[] = [
  { id: "select", icon: "cursor",     key: "V", label: "Select & transform" },
  { id: "sculpt", icon: "brush",      key: "B", label: "Shape the terrain" },
  { id: "shape",  icon: "shapeCurve", key: "H", label: "Terrain shapes (jumps, curves, circles)" },
  { id: "paint",  icon: "paintSnow",  key: "T", label: "Paint the ground (snow, rock, markings, powder, corduroy)" },
  { id: "place",  icon: "place",      key: "P", label: "Place features" },
  { id: "spawn",  icon: "spawn",      key: "N", label: "Add spawn point" },
];

// Number keys for the most used brushes ( in sculpt mode ).
export const BRUSH_KEYS: Partial<Record<BrushId, string>> = {
  draw: "1", smooth: "2", flatten: "3", layer: "4", clay: "5", crease: "6", pinch: "7", smudge: "8", noise: "9", mask: "0",
};

/**
 * Opens the Properties editor's Brush tab ( all of the brush's settings ).
**/
export const showBrushSettings = () => window.dispatchEvent( new CustomEvent( "show-brush-settings" ) );

// Terrain Mode holds the trails ( points joined by runs, the ground made round them ), the brushes and the shapes: one
// place for ground.
export type Mode = "object" | "sculpt" | "paint";

export const modeOf = ( tool: ToolId ): Mode => ( tool === "sculpt" || tool === "shape" || tool === "trail" ? "sculpt" : tool === "paint" ? "paint" : "object" );

export const MODES: { id: Mode; label: string; tool: ToolId; key: string }[] = [
  { id: "object", label: "Object Mode",  tool: "select", key: "V" },
  { id: "sculpt", label: "Terrain Mode", tool: "trail",  key: "B" },
  { id: "paint",  label: "Paint Mode",   tool: "paint",  key: "T" },
];

export const PAINT_TOOLS: { id: PaintTool; icon: IconName; label: string; ctrl: string; tip: string }[] = [
  { id: "snow",    icon: "paintSnow",    label: "Snow / rock", ctrl: "rock",   tip: "Paint snow, or rock with Ctrl (or the Rock button)" },
  { id: "marking", icon: "paintMarking", label: "Markings",    ctrl: "erase",  tip: "Paint lines and colour in the game's hues; Ctrl erases; Shift+click draws a straight line on" },
  { id: "powder",  icon: "paintPowder",  label: "Powder",      ctrl: "remove", tip: "Paint powder depth (deep snow); Ctrl removes it" },
  { id: "grip",    icon: "paintGrip",    label: "Grip",        ctrl: "remove", tip: "Powder you feel but can't see; Ctrl removes it" },
  { id: "flow",    icon: "paintFlow",    label: "Corduroy",    ctrl: "",       tip: "Paint the direction the groomed corduroy runs: drag along the way it should go" },
];

// Blender's blend modes for the colour brush.
export const BLENDS = BLEND_MODES;
