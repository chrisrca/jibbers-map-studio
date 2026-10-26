// The editor's state as a type: the map being edited ( objects, pieces, terrain, trails, paint ) and the UI's ( tools,
// selection, views, workspaces ).

import type { LibraryEntry, UserAsset, UserMaterial } from "../../core/ipc";
import type { ChunkEntry, CustomObjectEntry, MapSettings, ObjectEntry, PlaceholderInfo, SpawnEntry } from "../../core/types";
import type { PaintSettings } from "../../paint/settings";
import type { BrushSettings, SculptState } from "../../sculpt/brushes";
import type { Shape } from "../../terrain/shapes/shapes";
import type { GroundSettings } from "../../trails/ground";
import type { TrailNet } from "../../trails/trails";

export type ToolId = "select" | "sculpt" | "shape" | "trail" | "paint" | "place" | "spawn" | "scatter" | "model" | "material";

export type CameraMode = "orbit" | "fly" | "rider";

export type Selection = { kind: "object" | "spawn" | "custom" | "shape" | "trailNode" | "trailRun"; uid: string };

// A folder in the Outliner ( Blender's collections ): the editor's own, nested and named by the user.
export interface Collection {
  id:     string;
  name:   string;
  // the collection it sits in; null = directly in the map
  parent: string | null;
}

export interface Toast {
  id:   number;
  text: string;
  kind: "info" | "error" | "success";
}

// chunk fields carried through that the editor doesn't edit yet ( trees, flow mask, repeats )
export type ChunkExtras = Omit<ChunkEntry, "key" | "position" | "size" | "resolution" | "heights" | "snowMask">;

export interface GameLaunch {
  stage:    string;
  // 0..1 when known
  progress: number | null;
  // when Play was pressed ( ms )
  since:    number;
  // the ( new ) game has been started: any game window from now on is it, not the one being replaced
  started:  boolean;
}

export interface EditorState {
  projectDir:       string | null;
  dirty:            boolean;
  map:              MapSettings | null;
  chunkExtras:      Record<string, ChunkExtras>;
  customObjects:    CustomObjectEntry[];
  // terrain shapes ( curves, circles ); see terrain/shapes/shapes.ts
  shapes:           Shape[];
  // the trails ( trails/trails.ts; changed through trails/edits.ts, the ground following )
  trails:           TrailNet;
  // how the ground round the trails is made ( trails/ground/ )
  trailGround:      GroundSettings;
  // the Trails tool's settings for new runs: their width, and whether they're shaped to the ground they're laid on
  trailTool:        { width: number; follow: boolean };
  // the picked point's run end whose handle the gizmo moves ( the Trails tool )
  trailHandle:      { run: string; end: "a" | "b" } | null;
  // what the Shapes tool draws
  shapeKind:        "curve" | "circle" | "stamp";
  // what the select tool's gizmo does
  gizmoMode:        "translate" | "rotate" | "scale";
  // the map's ground drawn to read its shape: slope colours ( degrees ), hillshade, contour lines ( metres apart )
  terrainView:      TerrainView;
  // the object brush: the library pieces it drops ( asset browser picks ), and how ( viewport/tools/scatter.ts )
  scatter:          { picks: string[]; radius: number; spacing: number; scaleJitter: number; followSlope: number; tilt: number };
  library:          string | null;
  objects:          ObjectEntry[];
  spawns:           SpawnEntry[];
  // Outliner folders
  collections:      Collection[];
  // the collection each item ( feature, spawn, piece or shape uid ) is in; missing = directly in the map
  membership:       Record<string, string>;
  // names given to features and pieces in the Outliner ( spawns and shapes carry their own )
  labels:           Record<string, string>;
  // where new things go ( Blender's active collection ); null = the map itself
  activeCollection: string | null;
  // items that can't be picked in the viewport or moved ( the Outliner's lock )
  locked:           Record<string, true>;

  selection:               Selection[];
  tool:                    ToolId;
  sculpt:                  SculptState;
  // ground paint ( snow/rock, markings, powder, flow )
  paint:                   PaintSettings;
  placeId:                 string | null;
  // library item ( asset browser ) the place tool puts down
  placeEntry:              string | null;
  alignToSurface:          boolean;
  defaultPlaceholderScale: number;
  cameraMode:              CameraMode;
  // what the main area shows: the 3D editor or the running game
  centerTab:               "editor" | "game";
  // the game was moved back to its own window from the Game tab
  gamePoppedOut:           boolean;
  // a piece's grind rail being edited in the 3D view, and its picked point
  railEdit:                { uid: string; point: number | null } | null;
  // a modelled piece in Edit Mode ( viewport/edit/model/modelEditor.ts ): its select mode, how much is selected, what the
  // running operator says
  modelEdit:               { uid: string; mode: "vert" | "edge" | "face"; verts: number; edges: number; faces: number; status: string } | null;
  // the Material workspace: choosing and editing materials, or painting the selected modelled piece
  materialMode:            "object" | "paint";
  // the Assets workspace's active tool ( Blender's toolbar )
  modelTool:               AssetTool;
  // pieces hidden in the 3D view ( the Outliner's eye, in the Assets workspace )
  hiddenInView:            Record<string, true>;
  // how a click or box adds to what's selected ( Blender's select mode )
  selectOp:                "set" | "extend" | "subtract";
  // Blender's 3D cursor ( Unity space ): where things are added, what Spin turns round
  cursor3d:                [number, number, number];
  // the Assets workspace's 3D view: Blender's shading, X-ray and overlays
  view3d:                  View3d;
  // Edit Mode's snapping ( Shift+Tab, Ctrl flips it while held ), proportional editing ( O ) and pivot point
  modelTools:              { snap: boolean; snapTo: "increment" | "vertex" | "surface"; proportional: boolean; propRadius: number; pivot: "median" | "bounds" | "individual" | "active" | "cursor" };

  placeholders:    PlaceholderInfo[];
  // the personal asset library ( see pieces/userAssets.ts )
  userAssets:      UserAsset[];
  userMaterials:   UserMaterial[];
  // the asset library shown in the bottom panel ( see pieces/library.ts )
  assetLibrary:    LibraryEntry[];
  libraryDir:      string;
  toasts:          Toast[];
  busy:            string | null;
  // the "import a real mountain" dialog is open
  mountainImport:  boolean;
  // the start window ( Blender's splash ) shown
  splash:          boolean;
  // a .jbrmap was imported with a project open: asking whether to open it or take its pieces
  mapImportChoice: string | null;
  // the piece of a lift picked ( its station or mast: what the gizmo and its Transform are on )
  liftPick:        { uid: string; which: "base" | "top" | number } | null;
  // when the project was last saved ( this session )
  lastSavedAt:     number | null;
  saveState:       "idle" | "saving";
  // the map in the game's Maps folder: not exported yet, up to date, or older than the edits since
  gameCopy:        "none" | "current" | "stale";
  // Play in progress, until the game shows up: what's happening
  gameLaunch:      GameLaunch | null;

  // ---- actions
  setTool(      t:    ToolId ): void;
  setCenterTab( t:    "editor" | "game" ): void;
  setSculpt(    p:    Partial<SculptState> ): void;
  // changes the current brush's own settings
  setBrush(     p:    Partial<BrushSettings> ): void;
  setPaint(     p:    Partial<PaintSettings> ): void;
  setSelection( s:    Selection[] ): void;
  toast(        text: string, kind?: Toast["kind"] ): void;
  setBusy(      text: string | null ): void;
  markDirty(): void;

  // Applies an object/spawn change as one undoable step.
  commit(        label: string, next: Partial<Undoable> ): void;
  addObject(     o:     ObjectEntry ): void;
  updateObjects( label: string, uids: string[], f: ( o: ObjectEntry ) => ObjectEntry ): void;
  removeSelected():    void;
  duplicateSelected(): string[];
  addSpawn(     s:     SpawnEntry ): void;
  updateSpawn(  label: string, uid: string, f: ( s: SpawnEntry ) => SpawnEntry ): void;
  updateCustom( label: string, uids: string[], f: ( o: CustomObjectEntry ) => CustomObjectEntry ): void;
  // a piece added, named `name` ( Blender's way: ".001" when it's taken; else what it's made of )
  addCustom(    o:     CustomObjectEntry, name?: string ): void;
  setMap(       label: string, p: Partial<MapSettings> ): void;

  // ---- Outliner
  newCollection(       parent: string | null, name?: string ): string;
  renameCollection(    id:     string, name: string ): void;
  // removes the collection; what was in it moves up to its parent
  deleteCollection(    id:     string ): void;
  moveToCollection(    uids:   string[], to: string | null ): void;
  moveCollection(      id:     string, to: string | null ): void;
  renameItem(          item:   Selection, name: string ): void;
  setActiveCollection( id:     string | null ): void;
  setLocked(           uids:   string[], on: boolean ): void;
}

// What one undo step puts back.
export interface Undoable {
  objects:       ObjectEntry[];
  spawns:        SpawnEntry[];
  customObjects: CustomObjectEntry[];
  map:           MapSettings | null;
  collections:   Collection[];
  membership:    Record<string, string>;
  labels:        Record<string, string>;
  shapes:        Shape[];
  locked:        Record<string, true>;
}

export interface TerrainView {
  slope:          boolean;
  slopeMin:       number;
  slopeMax:       number;
  // bands of this many degrees ( 0: smooth )
  slopeStep:      number;
  slopeOpacity:   number;
  // 0 off … 1
  hillshade:      number;
  exaggeration:   number;
  // degrees round from north ( the map's +Z ), and up from the ground
  sunDir:         number;
  sunHeight:      number;
  // metres between lines ( 0: none )
  contours:       number;
  contourOpacity: number;
}

export type Shading = "wire" | "solid" | "material" | "rendered";

export type AssetTool = "select" | "cursor" | "move" | "rotate" | "scale" | "transform" | "add" | "extrude" | "inset" | "bevel" | "loopcut" | "knife" | "spin" | "smooth" | "slide" | "shrink";

export interface View3d {
  shading:     Shading;
  xray:        boolean;
  // the transform gizmos shown at all
  gizmos:      boolean;
  // the gizmo's axes: the world's, or the piece's own
  orientation: "global" | "local";
  overlays:    { grid: boolean; faceOrientation: boolean; stats: boolean };
}
