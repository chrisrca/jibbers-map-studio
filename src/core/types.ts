// Mirrors src-tauri/src/project/mod.rs ( serde camelCase ). All positions/rotations are Unity space.
import type { ModelData } from "../model/build";
import type { V3 } from "./coords";
import type { Curve } from "./curve";

export type ParamValue =
  | { type: "Int";    value: number  }
  | { type: "Float";  value: number  }
  | { type: "Bool";   value: boolean }
  | { type: "String"; value: string  };

// Smallest per-axis object scale; zero or negative ( mirrored ) scales break the game's physics.
export const MIN_SCALE = 0.01;
export const safeScale = ( s: number[] ): [number, number, number] => [0, 1, 2].map( ( i ) => Math.max( MIN_SCALE, Math.abs( s[i] ) ) ) as [number, number, number];

// Rust-serialized Vec3 / Color ( jbrmap model, snake_case fields ).
export type XYZ         = { x: number; y: number; z: number };
export type RGBA        = { r: number; g: number; b: number; a: number };
export type SurfaceType = "Generic" | "Snow" | "Jib";

export interface CustomMaterial {
  base_tex:       string;
  render_mode:    number; // 0 opaque, 1 alpha clip, 2 transparent
  alpha_cutoff:   number;
  tiling:         { x: number; y: number };
  offset:         { x: number; y: number };
  cull_mode:      number; // Unity CullMode: 0 off, 1 front, 2 back
  base_color:     RGBA;
  emission_color: RGBA;
  metallic:       number;
  smoothness:     number;
  [k: string]: unknown;
}

export interface CustomPart {
  mesh:            string;
  // world space despite the name ( the game's importer sets transform.position )
  local_position:  XYZ;
  local_rotation:  XYZ;
  local_scale:     XYZ;
  materials:       CustomMaterial[];
  lod_group_index: number;
  lod_index:       number;
  [k: string]: unknown;
}

export interface CustomCollider {
  shape:          "Box" | "Sphere" | "Capsule" | "Mesh";
  surface_type:   SurfaceType;
  local_position: XYZ; // world space, like parts
  local_rotation: XYZ;
  local_scale:    XYZ;
  center:         XYZ;
  size:           XYZ;
  radius:         number;
  height:         number;
  direction:      number;
  mesh_ref:       string;
}

export interface CustomLight {
  local_position: XYZ; // world space
  local_rotation: XYZ;
  [k: string]: unknown;
}

// A custom object ( imported map piece or user asset ) as stored in project.json, plus an editor-only uid.
export interface CustomObjectEntry {
  uid:                      string;
  surface_type:             SurfaceType;
  can_stabilize:            boolean;
  can_rotate:               boolean;
  can_magnetize:            boolean;
  intended_up_method:       number;
  disable_distance_culling: boolean;
  timed_visibility:         boolean;
  visible_from_hour:        number;
  visible_until_hour:       number;
  position:                 XYZ;
  rotation:                 XYZ;
  scale:                    XYZ;
  parts:                    CustomPart[];
  colliders:                CustomCollider[];
  lod_groups:               unknown[];
  lights:                   CustomLight[];
  // a grind rail drawn along the piece ( studio only; the game gets the colliders made from it: pieces/rail.ts )
  rail?:                    Rail;
  // a fence's colliders copied from the map's pieces it uses for posts or panels ( studio only, world space: kept
  // apart so a change of its model keeps them; pieces/fence.ts )
  kitColliders?:            CustomCollider[];
  // a map's surroundings: how its texture was last painted, how far out they reach, and how they were built ( studio
  // only; geo/scenery/inner.ts, geo/landGround.ts SurroundingsLook )
  // ( `detail`: the detail curve, geo/scenery/scenery.ts surroundingsPlan; a number from before it, read as none )
  scenery?:                 { rockAngle: number; radius?: number; detail?: Curve | number; texture?: number; drop?: number };
  // the library asset it was placed from, and that file's date then ( studio only: overwriting the asset brings the
  // piece up to date, pieces/assetFiles.ts )
  source?:                  { id: string; stamp: number };
  // a piece modelled in the studio: its mesh and modifiers ( studio only; model/objects.ts )
  model?:                   ModelData;
  tree?:                    TreeMark;
  // its paint turned round the colour wheel ( 0..1 ), as the game turns its own features' ( studio only: baked into
  // copies of its textures on export, project/export.rs )
  hue?:                     number;
  // and its paint's Saturation, Lightness, Brightness and Contrast ( Photoshop's: -1..1 each, 0 as it is; studio only,
  // baked with the Hue: project/hue.rs )
  adjust?:                  PieceAdjust;
}

// A piece's paint adjusted ( beside its Hue ): each -1..1, 0 or missing as it is.
export interface PieceAdjust { saturation?: number; lightness?: number; brightness?: number; contrast?: number }

/**
 * A piece's paint adjustments, all five ( Hue a turn, 0..1; the others -1..1 ), or null when it has none.
**/
export function adjustOf( o: { hue?: number; adjust?: PieceAdjust } ): Required<PieceAdjust> & { hue: number } | null {
  const hue = ( ( ( o.hue ?? 0 ) % 1 ) + 1 ) % 1, a = o.adjust ?? {};
  const out = { hue: hue > 1e-4 && hue < 1 - 1e-4 ? hue : 0, saturation: a.saturation ?? 0, lightness: a.lightness ?? 0, brightness: a.brightness ?? 0, contrast: a.contrast ?? 0 };
  return Object.values( out ).some( ( v ) => Math.abs( v ) > 1e-4 ) ? out : null;
}

// A grind rail: a curve through control points in the piece's own coordinates ( Unity, before its scale ).
export interface Rail {
  points:      [number, number, number][];
  // the rail's thickness ( radius, piece units )
  radius:      number;
  // its colliders boxes, not capsules ( a box rail, a flat bar ): half their width and height ( piece units )
  box?:        [number, number];
  // the rail's way up ( piece coordinates ): the side the game grabs from; straight up when not set
  up?:         [number, number, number];
  // the piece's "intended up" before it had a rail ( put back when the rail is removed )
  prevMethod?: number;
  // the piece's own colliders stay with the rail as plain solid ( "Mesh collidable"; else they're set aside in `body` )
  solid?:      boolean;
  // the piece's own colliders, set aside while it has a rail ( world space, moved with the piece )
  body?:       CustomCollider[];
  // plain solid colliders fitted to the piece's visible parts ( its own coordinates; see pieces/rail.ts fitParts )
  parts?:      CustomCollider[];
  // the piece is one convex shape ( a box, a ledge, a hump ): its own collider is its solid body, exactly
  whole?:      boolean;
  // its colliders changed by hand ( Edit Points: one picked, then moved, turned or sized )
  tweaks?:     RailTweak[];
  // a curve piece's rail ( its curve sampled ): each point's place along the curve's own points, as RailTweak's `at`
  knots?:      number[];
}

// A rail collider changed by hand: where along the rail it is ( by its points: 1.5 is halfway from the second to the
// third ), and how far it's moved, turned and sized from how the rail makes it, in its own axes ( X across, Y along
// the rail, Z its way up ). Made again with the rail, each is the collider there: it moves, turns and scales with the
// piece, and keeps its place along the rail as points are moved, added or taken away.
export interface RailTweak {
  at:     number;
  shift?: [number, number, number];
  // ( a quaternion: x, y, z, w )
  turn?:  [number, number, number, number];
  size?:  [number, number, number];
}

export const xyz  = ( v: [number, number, number] | number[] ): XYZ => ( { x: v[0], y: v[1], z: v[2] } );
export const arr3 = ( v: XYZ ): [number, number, number] => [v.x, v.y, v.z];

/**
 * Whether a piece has anything to see: a part with a mesh ( a piece of colliders alone has none; exported, it's given a
 * part with no mesh, which the game needs: project/export.rs seen_by_game, and comes back with it imported again ).
**/
export const hasLook            = ( o: { parts: { mesh: string }[] } ) => o.parts.some( ( p ) => !!p.mesh );
/**
 * A real-world map's surroundings ( geo/scenery/scenery.ts ): its meshes are kept under "Scenery/".
**/
export const isScenery          = ( o: CustomObjectEntry ) => o.parts.some( ( p ) => p.mesh.startsWith( "Scenery/" ) );
/**
 * The surroundings' library prefix ( "Scenery/<name>" ).
**/
export const sceneryPrefix      = ( o: CustomObjectEntry ) => o.parts.find( ( p ) => p.mesh.startsWith( "Scenery/" ) )!.mesh.split( "/" ).slice( 0, 2 ).join( "/" );
// Slope ( degrees ) where the surroundings turn to rock when first built ( geo/scenery/scenery.ts ).
export const SCENERY_ROCK_ANGLE = 30;

/**
 * Display name: the folder the mesh came from ( "Custom Stuff/Stairset/Stairset/Cube" → "Stairset" ).
**/
export function customName( o: CustomObjectEntry ): string {
  // ( a piece modelled in the studio: Blender's names for what it is )
  if ( o.model ) return o.model.curve && !o.model.mesh.f.length ? "Curve" : "Mesh";
  const key  = o.parts[0]?.mesh ?? "";
  const segs = key.split( "/" ).filter( Boolean );
  return segs.length >= 2 ? segs[segs.length - 2] : segs[0] ?? "Custom object";
}

export interface MapSettings {
  id:                       string;
  name:                     string;
  camStart:                 V3;
  allowBackgroundMountains: boolean;
  overrideTime:             boolean;
  dayTime:                  number;
  dayTimeHours:             number;
  sunAngle:                 number;
  // the map's own version ( raised before uploading an update )
  modVersion?:              string;
  author?:                  string;
  remixAuthors?:            string;
  remixIds?:                string;
  // the whole map scaled by this in game ( 0.1 to 3 )
  scale?:                   number;
}

// A lift's top station and masts, in its own space ( Unity's: x right, y up, z forward ).
export interface LiftData {
  endPosition: XYZ;
  masts:       XYZ[];
}

export interface ChunkEntry {
  key:               string;
  position:          V3;
  size:              V3;
  resolution:        number;
  heights:           string;
  snowMask?:         string | null;
  snowMask4Channel?: boolean;
  snowMask2?:        string | null;
  treePrototypes?:   unknown[];
  repeats?:          number;
  repeatOffset?:     V3;
}

// A feature or piece that's a terrain tree ( studio only: saved back into its chunk's tree prototypes while it stands
// as one, map/trees.ts ): its tint.
export interface TreeMark {
  color: [number, number, number, number];
  // ( a piece tree: the prototype it came as, in its own space; this session only, map/trees.ts )
  kind?: { parts: CustomPart[]; colliders: CustomCollider[]; lod_groups: unknown[] };
}

export interface ObjectEntry {
  uid:       string;
  id:        string;
  position:  V3;
  rotation:  V3;
  scale:     V3;
  params:    Record<string, ParamValue>;
  lift?:     LiftData;
  tree?:     TreeMark;
  // a lift whose masts are spaced on the ground this many metres apart, again whenever its ends move ( none: where
  // they were put )
  liftAuto?: number;
}

export interface SpawnEntry {
  uid:      string;
  name:     string;
  position: V3;
  rotation: V3;
  velocity: V3;
}

export interface Project {
  format:        "jibbers-studio-project";
  version:       number;
  map:           MapSettings;
  chunks:        ChunkEntry[];
  objects:       ObjectEntry[];
  spawns:        SpawnEntry[];
  customObjects: unknown[];
  library?:      string | null;
  editor?:       unknown;
}

export interface PlaceholderParam {
  name:     string;
  // ( color: "#RRGGBB", Map-Tools 0.5 )
  type:     "int" | "float" | "bool" | "string" | "selection" | "color";
  default:  number | boolean | string;
  options?: string[];
}

export interface PlaceholderInfo {
  id:                string;
  name:              string;
  file:              string;
  forceUniformScale: boolean;
  parameters:        PlaceholderParam[];
  boundsMin:         V3;
  boundsMax:         V3;
  triangles:         number;
  // a lift: its pieces ( the base station is `file` )
  lift?:             LiftInfo;
}

// A point a lift's cable runs through, in its piece's space ( Unity axes ).
export interface LiftCablePoint {
  kind:    "wheel" | "slot" | "fixed";
  p:       V3;
  up?:     V3;
  fwd?:    V3;
  radius?: number;
  arc?:    number;
  min?:    number;
  max?:    number;
}

export interface LiftPartInfo {
  file:      string;
  boundsMin: V3;
  boundsMax: V3;
  // a station's route round its wheel; a mast's up and down paths
  cable:     { route?: LiftCablePoint[]; up?: LiftCablePoint[]; down?: LiftCablePoint[] };
}

export interface LiftInfo {
  base:  LiftPartInfo;
  top:   LiftPartInfo;
  // ( a rope tow has none )
  mast?: LiftPartInfo;
}
