import { useState } from "react";
import { useEditor } from "../../map/store";
import { AssetsHeader, AssetsToolSettings, useAssetMode } from "../blender/AssetsUI";
import { Icon } from "../widgets/icons";
import { DesignHeader, PaintHeader, ScatterHeader, SelectHeader } from "./modeHeaders";
import { BrushHeader, ShapeHeader, TrailHeader } from "./terrainHeaders";
import { TexturePaintSettings } from "./texturePaint";

export { TOOLS, BRUSH_KEYS, showBrushSettings, PAINT_TOOLS, BLENDS, modeOf } from "./tools";
export { ToolColumn, toggleGrindLines, toggleSlope } from "./ToolColumn";
export { TexturePaintSettings } from "./texturePaint";

/**
 * The 3D view's headers: mode and menus, then the active tool's settings ( Blender's tool settings row ).
**/
export function ToolHeader() {
  const s        = useEditor();
  const onStage  = s.tool === "model" || s.tool === "material";
  const paint    = useAssetMode() === "paint";
  const [, bump] = useState( 0 );
  useState( () => window.addEventListener( "grind-lines", () => bump( ( n ) => n + 1 ) ) );
  if ( onStage )
    return (
      <>
        <AssetsHeader />
        <div className="tool-settings">
          {paint ? <TexturePaintSettings /> : <AssetsToolSettings />}
        </div>
      </>
    );
  return (
    <>
      <DesignHeader />
      <div className="tool-settings">
        {s.tool === "select" && <SelectHeader />}
        {s.tool === "sculpt" && <BrushHeader />}
        {s.tool === "trail" && <TrailHeader />}
        {s.tool === "paint" && <PaintHeader />}
        { s.tool === "place" && (
          <>
            <span className="tool-name"><Icon name="place" size={14} /> Place</span>
            <span className="muted">{s.assetLibrary.find( ( e ) => e.id === s.placeEntry )?.name ?? ""}</span>
          </>
        ) }
        {s.tool === "shape" && <ShapeHeader />}
        {s.tool === "spawn" && <span className="tool-name"><Icon name="spawn" size={14} /> Add Spawn</span>}
        {s.tool === "scatter" && <ScatterHeader />}
      </div>
    </>
  );
}
