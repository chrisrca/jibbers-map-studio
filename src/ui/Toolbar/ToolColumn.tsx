// Blender's tool shelf: the column of tools at the left of the viewport, for the mode.

import { useEditor } from "../../map/store";
import { BRUSHES } from "../../sculpt/brushes";
import { AssetsToolbar } from "../blender/AssetsUI";
import { ToolIcon } from "../blender/BlIcon";
import { getEngine } from "../Viewport";
import { Icon, type IconName } from "../widgets/icons";
import { BRUSH_KEYS, PAINT_TOOLS, modeOf } from "./tools";

/**
 * Blender's tool shelf: a column of tools floating at the left of the viewport, depending on the mode.
**/
export function ToolColumn() {
  const tool      = useEditor( ( s ) => s.tool         );
  const gizmo     = useEditor( ( s ) => s.gizmoMode    );
  const brush     = useEditor( ( s ) => s.sculpt.brush );
  const paintTool = useEditor( ( s ) => s.paint.tool   );
  const shapeKind = useEditor( ( s ) => s.shapeKind    );
  const mode      = modeOf( tool );
  const st        = useEditor.getState;
  // ( the engine follows gizmoMode )
  const transform = ( m: "translate" | "rotate" | "scale" ) => () => useEditor.setState( { tool: "select", gizmoMode: m } );
  // editing a rail's points: scale does nothing to a point
  const pointEdit = useEditor( ( s ) => !!s.railEdit );
  if ( tool === "material" || tool === "model" ) return <AssetsToolbar />;
  // ( Blender's toolbar: groups of tools, its own icons where it has the tool )
  const tb = ( key: string, icon: IconName | { tool: string }, title: string, on: boolean, run: () => void ) => (
    <button key={key} className={`tool ${on ? "on" : ""}`} title={title} onClick={run}>
      {typeof icon === "string" ? <Icon name={icon} size={18} /> : <ToolIcon name={icon.tool} />}
    </button>
  );
  return (
    <div className="tool-column bl">
      { mode === "object" && (
        <>
          <div className="tool-group">
            {tb( "move",   { tool: "ops.transform.translate" }, "Move",   tool === "select" && gizmo === "translate", transform( "translate" ) )}
            {tb( "rotate", { tool: "ops.transform.rotate"    }, "Rotate", tool === "select" && gizmo === "rotate",    transform( "rotate"    ) )}
            {!pointEdit && tb( "scale", { tool: "ops.transform.resize" }, "Scale", tool === "select" && gizmo === "scale", transform( "scale" ) )}
          </div>
          <div className="tool-group">
            {tb( "place",   "place", "Place (P)",     tool === "place",   () => st().setTool( "place"   ) )}
            {tb( "scatter", "draw",  "Scatter",       tool === "scatter", () => st().setTool( "scatter" ) )}
            {tb( "spawn",   "spawn", "Add Spawn (N)", tool === "spawn",   () => st().setTool( "spawn"   ) )}
          </div>
        </>
      ) }
      {mode === "paint" && <div className="tool-group">{PAINT_TOOLS.map( ( t, i ) => tb( t.id, t.icon, `${t.label} (${i + 1})`, paintTool === t.id, () => st().setPaint( { tool: t.id } ) ) )}</div>}
      { mode === "sculpt" && (
        <>
          <div className="tool-group">
            {tb( "trail", "trail", "Trails", tool === "trail", () => st().setTool( "trail" ) )}
          </div>
          <div className="tool-group">
            { BRUSHES.map( ( b ) =>
              tb( b.id, b.icon, `${b.label} (${BRUSH_KEYS[b.id] ?? ""})`.replace( " ()", "" ), tool === "sculpt" && brush === b.id, () => {
                st().setTool( "sculpt" );
                st().setSculpt( { brush: b.id } );
              } ),
            ) }
          </div>
          <div className="tool-group">
            {tb( "curve", "shapeCurve", "Ramp (H)",     tool === "shape" && shapeKind === "curve", () => useEditor.setState( { tool: "shape", shapeKind: "curve" } ) )}
            {tb( "copy",  "shapeCopy",  "Copy Terrain", tool === "shape" && shapeKind === "stamp", () => useEditor.setState( { tool: "shape", shapeKind: "stamp" } ) )}
          </div>
        </>
      ) }
    </div>
  );
}

// Grind lines on every jib ( selected jibs always show theirs ).
export let grindOn = false;

export function toggleGrindLines() {
  grindOn = !grindOn;
  getEngine()?.customR.guides.setAll( grindOn );
  window.dispatchEvent( new CustomEvent( "grind-lines" ) );
}

/**
 * View › Slope colours ( also Ctrl+L ).
**/
export function toggleSlope() {
  const v = useEditor.getState().terrainView;
  useEditor.setState( { terrainView: { ...v, slope: !v.slope } } );
}
