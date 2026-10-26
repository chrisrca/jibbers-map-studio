import { useEffect, useState } from "react";
import { customName, isScenery } from "../../../core/types";
import { useEditor, workspaceOf } from "../../../map/store";
import { BlIcon } from "../../blender/BlIcon";
import { Panel } from "../../widgets/controls";
import { BrushProperties } from "../BrushProperties";
import { PaintProperties } from "../PaintProperties";
import { ShapeProperties } from "../ShapeProperties";
import { TrailNodeProperties, TrailRunProperties, TrailToolPanel } from "../TrailProperties";
import { useLiveEdit } from "./live";
import { MapProperties } from "./map";
import { ObjectProperties } from "./object";
import { CustomProperties } from "./piece";
import { SceneryProperties } from "./scenery";
import { SpawnProperties } from "./spawn";

// A tab of the Design workspace's Properties editor.
type PropTab = { id: "item" | "map" | "brush"; bl: string; title: string; label: string };

/**
 * Blender's Properties editor: a column of tabs on the left ( the selected item, the map ) and stacked panels.
 * Selecting something switches to its tab.
**/
export function PropertiesEditor() {
  const selection     = useEditor( ( s ) => s.selection );
  const tool          = useEditor( ( s ) => s.tool      );
  const [tab, setTab] = useState<"item" | "map" | "brush">( "item" );
  useEffect( () => {
    if ( selection.length ) setTab( "item" );
  }, [selection] );
  // the brush's settings come up when sculpting ( and from the tool header's "More…" )
  useEffect( () => {
    if ( tool === "sculpt" || tool === "paint" ) setTab( "brush" );
    else setTab( ( t ) => ( t === "brush" ? "item" : t ) );
  }, [tool] );
  useEffect( () => {
    const show = () => setTab( "brush" );
    window.addEventListener( "show-brush-settings", show );
    return () => window.removeEventListener( "show-brush-settings", show );
  }, [] );
  if ( workspaceOf( tool ) === "assets" ) return <AssetsPropertiesEditor />;
  // ( on the stage the map's settings don't come into it; Modeling has no brush )
  const onStage         = tool === "model" || tool === "material";
  const tabs: PropTab[] = [
    ...( tool === "sculpt" || tool === "paint" ? [{ id: "brush" as const, bl: "tool_settings", title: "Tool", label: "Tool" }] : [] ),
    { id: "item", bl: "object_data", title: "Object", label: "Object" },
    ...( onStage ? [] : [{ id: "map" as const, bl: "world", title: "Map", label: "Map" }] ),
  ];
  const shown = tabs.some( ( t ) => t.id === tab ) ? tab : "item";
  return (
    <>
      <div className="area-header props-hdr">
        <span className="editor-icon" title="Properties"><BlIcon name="properties" /></span>
        <span className="ctx-path"><BlIcon name={tabs.find( ( t ) => t.id === shown )?.bl ?? "object_data"} size={14} />{tabs.find( ( t ) => t.id === shown )?.label}</span>
      </div>
      <div className="props-editor">
        <div className="props-tabs">
          { tabs.map( ( t ) => (
            <button key={t.id} className={shown === t.id ? "on" : ""} title={t.title} onClick={() => setTab( t.id )}>
              <BlIcon name={t.bl} />
            </button>
          ) ) }
        </div>
        <div className="props-body">{shown === "map" ? <MapProperties /> : shown === "brush" ? ( tool === "paint" || tool === "material" ? <PaintProperties /> : <BrushProperties /> ) : <Properties />}</div>
      </div>
    </>
  );
}

/**
 * The Assets workspace's Properties editor: Blender's tabs down the side, each with its part of the selected piece.
 * Modeling has Object, Modifiers, Physics, Data and Material; Material mode only Material ( and Tool while painting ).
**/
function AssetsPropertiesEditor() {
  const material      = useEditor( ( s ) => s.tool === "material"                               );
  const paint         = useEditor( ( s ) => s.tool === "material" && s.materialMode === "paint" );
  const [tab, setTab] = useState<AssetTab | "tool">( "object" );
  // ( a mode's own tab first: Tool when painting starts, Material in Material mode, Object in Modeling )
  useEffect( () => setTab( paint ? "tool" : material ? "material" : "object" ), [paint, material] );
  const tabs: { id: AssetTab | "tool"; icon: string; label: string }[] = [
    ...( paint ? [{ id: "tool" as const, icon: "tool_settings", label: "Tool" }] : [] ),
    ...( material
      ? []
      : [
          { id: "object"    as const, icon: "object_data", label: "Object"    },
          { id: "modifiers" as const, icon: "modifier",    label: "Modifiers" },
          { id: "physics"   as const, icon: "physics",     label: "Physics"   },
          { id: "data"      as const, icon: "mesh_data",   label: "Data"      },
        ] ),
    { id: "material", icon: "material", label: "Material" },
  ];
  const shown  = tabs.some( ( t ) => t.id === tab ) ? tab : tabs[0].id;
  const active = useEditor( ( s ) => {
    const last = s.selection[s.selection.length - 1];
    return last ? s.customObjects.find( ( o ) => o.uid === last.uid ) ?? null : null;
  } );
  useEditor( ( s ) => s.labels );
  return (
    <>
      <div className="area-header props-hdr">
        <span className="editor-icon" title="Properties"><BlIcon name="properties" /></span>
        <span className="ctx-path">
          <BlIcon name={tabs.find( ( t ) => t.id === shown )?.icon ?? "object_data"} size={14} />
          {active ? ( useEditor.getState().labels[active.uid] || customName( active ) ) : tabs.find( ( t ) => t.id === shown )?.label}
        </span>
      </div>
      <div className="props-editor">
        <div className="props-tabs">
          { tabs.map( ( t ) => (
            <button key={t.id} className={shown === t.id ? "on" : ""} title={t.label} onClick={() => setTab( t.id )}>
              <BlIcon name={t.icon} />
            </button>
          ) ) }
        </div>
        <div className="props-body">{shown === "tool" ? <PaintProperties /> : <Properties tab={shown} />}</div>
      </div>
    </>
  );
}

export function Properties( { tab }: { tab?: AssetTab } = {} ) {
  const selection     = useEditor( ( s ) => s.selection     );
  const objects       = useEditor( ( s ) => s.objects       );
  const spawns        = useEditor( ( s ) => s.spawns        );
  const customObjects = useEditor( ( s ) => s.customObjects );
  const shapes        = useEditor( ( s ) => s.shapes        );
  const trails        = useEditor( ( s ) => s.trails        );
  const tool          = useEditor( ( s ) => s.tool          );
  const live          = useLiveEdit();

  // the Trails tool: what's picked ( one run or point ), then the tool's own settings
  if ( tool === "trail" ) {
    const one = selection.length === 1 ? selection[0] : null;
    const r   = one?.kind === "trailRun" ? trails.runs.find( ( x ) => x.id === one.uid ) : null;
    const n   = one?.kind === "trailNode" ? trails.nodes.find( ( x ) => x.id === one.uid ) : null;
    return (
      <div className="panel-stack">
        {r && <TrailRunProperties r={r} />}
        {n && <TrailNodeProperties n={n} />}
        <TrailToolPanel />
      </div>
    );
  }

  if ( selection.length === 0 )
    return (
      <Panel icon="cursor" title="Nothing selected">
        <div className="props">
          <div className="note" style={{ gridColumn: "1 / -1" }}>Click something in the viewport or the Outliner to edit it. Map settings are in the Map tab.</div>
        </div>
      </Panel>
    );
  if ( selection.length > 1 )
    return (
      <Panel icon="cursor" title={`${selection.length} selected`}>
        <div className="props">
          <div className="note">{selection.length} items selected — use the gizmo to transform them together.</div>
        </div>
      </Panel>
    );

  const s = selection[0];
  if ( s.kind === "trailRun" ) {
    const r = trails.runs.find( ( x ) => x.id === s.uid );
    return r ? <TrailRunProperties r={r} /> : null;
  }
  if ( s.kind === "trailNode" ) {
    const n = trails.nodes.find( ( x ) => x.id === s.uid );
    return n ? <TrailNodeProperties n={n} /> : null;
  }
  if ( s.kind === "shape" ) {
    const sh = shapes.find( ( x ) => x.uid === s.uid );
    return sh ? <ShapeProperties s={sh} /> : null;
  }
  if ( s.kind === "custom" ) {
    const c = customObjects.find( ( x ) => x.uid === s.uid );
    return c ? isScenery( c ) ? <SceneryProperties o={c} /> : <CustomProperties o={c} live={live} tab={tab} /> : null;
  }
  if ( s.kind === "spawn" ) {
    const sp = spawns.find( ( x ) => x.uid === s.uid );
    return sp ? <SpawnProperties sp={sp} live={live} /> : null;
  }
  const o = objects.find( ( x ) => x.uid === s.uid );
  return o ? <ObjectProperties o={o} live={live} /> : null;
}

// The Assets workspace's Properties tabs ( Blender's ).
export type AssetTab = "object" | "modifiers" | "physics" | "data" | "material";
