// Blender's own icons ( CC-BY-SA 4.0, see THIRD_PARTY.md ): interface icons drawn in the text colour, toolbar icons in
// their colours.

import { BL_ICONS, BL_TOOL_ICONS } from "./icons.generated";

// Blender's theme colours for icons of a kind ( objects orange, modifiers and physics blue, data green, materials and
// the world red ); the rest take the text colour.
const TINT: Record<string, string> = {
  object_data: "#e19658", outliner_ob_mesh:   "#e19658", outliner_ob_curve:   "#e19658",
  modifier:    "#6387d2", physics:            "#6387d2", mod_mirror:          "#6387d2", mod_array:       "#6387d2", mod_solidify: "#6387d2", mod_bevel: "#6387d2",
  mod_subsurf: "#6387d2", mod_decim:          "#6387d2", mod_boolean:         "#6387d2", mod_triangulate: "#6387d2", mod_smooth:   "#6387d2",
  mesh_data:   "#06af88", outliner_data_mesh: "#06af88", outliner_data_curve: "#06af88",
  material:    "#a8575f", world:              "#a8575f",
};

export function BlIcon( { name, size = 16, className = "" }: { name: string; size?: number; className?: string } ) {
  const icon = BL_ICONS[name];
  if ( !icon ) return <span style={{ width: size, height: size, display: "inline-block" }} />;
  return (
    <svg className={`bl-icon ${className}`} width={size} height={size} viewBox={icon[0]} fill="currentColor" style={TINT[name] ? { color: TINT[name] } : undefined} aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon[1] }} />
  );
}

export function ToolIcon( { name, size = 28 }: { name: string; size?: number } ) {
  const icon = BL_TOOL_ICONS[name];
  return <svg className="bl-tool-icon" width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon ?? "" }} />;
}
