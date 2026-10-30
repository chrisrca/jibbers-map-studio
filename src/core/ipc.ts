// Typed wrappers for the Rust commands in src-tauri/src/commands/.
import { invoke } from "@tauri-apps/api/core";
import type { CustomMaterial, Project } from "./types";

export interface AppInfo {
  mapsDir:    string;
  gameExe:    string | null;
  libraryDir: string;
  // the studio's own data folder ( your library, caches )
  dataDir:    string;
}

export interface ExportResult {
  path:           string;
  bytes:          number;
  chunks:         number;
  objects:        number;
  spawns:         number;
  // objects whose negative/zero scale was made positive ( the game's physics can't handle them )
  fixedScales:    number;
  fixedColliders: number;
}

// An entry in the personal asset library ( src-tauri/src/library/userassets.rs ).
export interface UserAsset {
  path:        string;
  name:        string;
  parts:       number;
  textures:    number;
  // bounding box in metres
  size:        [number, number, number];
  surfaceType: "Generic" | "Snow" | "Jib";
}

// A light of one of the game's features, in its prefab's frame ( Unity's numbers ).
export interface GameLight {
  // 0 spot, 1 directional, 2 point
  type:           number;
  color:          [number, number, number, number];
  intensity:      number;
  range:          number;
  spotAngle:      number;
  innerSpotAngle: number;
  // column-major, Unity space
  matrix:         number[];
  variant?:       { param: string; option: string };
}

// The game's snow ( gamelook/terrain.rs ): its terrain textures ( files in `dir` ) and its material's numbers.
export interface GameTerrain {
  dir:                string;
  textures:           { snow?: string; rock?: string };
  baseColor:          [number, number, number] | null;
  rockColor:          [number, number, number] | null;
  thirdColor:         [number, number, number] | null;
  snowMaskContrast:   number | null;
  thirdCoverageDepth: number | null;
  thirdEdgeSharpness: number | null;
}

// A wheel the game turns on a piece ( a lift station's ) as its cable runs, in the piece's frame ( Unity space ).
export interface GameSpin {
  // the piece's part it is ( its mesh `…/g<part>` )
  part:   number;
  pivot:  [number, number, number];
  axis:   [number, number, number];
  // whole turns per 1000 m of cable, signed
  cycles: number;
}

// The test pad in the game ( src-tauri/gamelink/src/pad.rs ): what's held, the sticks ( -1..1, up and right positive )
// and triggers ( 0..1 ), and keyboard keys.
export interface GamePad {
  connected:   boolean;
  // Rewired left on its own input source ( the game as players have it )
  keepSource?: boolean;
  buttons?:    ( "dpad_up" | "dpad_down" | "dpad_left" | "dpad_right" | "start" | "back" | "left_thumb" | "right_thumb" | "lb" | "rb" | "guide" | "a" | "b" | "x" | "y" )[];
  lx?:         number;
  ly?:         number;
  rx?:         number;
  ry?:         number;
  lt?:         number;
  rt?:         number;
  // keyboard keys held ( a letter or digit, "escape", "enter", "space", "tab", "backspace", "f5" ), straight into the
  // game's window
  keys?:       string[];
}

// What the link sees of the game while the test pad is in ( gamelink/src/probe.rs ).
export interface GameProbe {
  scene:       string;
  frame:       number;
  // Unity's Application.isFocused ( the game's camera takes no look input without it ), null when it couldn't ask
  focused:     boolean | null;
  // the game's camera turning down look input ( no focus, a menu or the chat open ), null without a camera
  lookBlocked: boolean | null;
  // the game's chat open, null when it couldn't tell
  chatOpen:    boolean | null;
  // each camera's place, then its turn ( quaternion x y z w ), Unity space
  cameras:     [number, number, number, number, number, number, number][];
  drones:      number;
  // each drone's place and turn, as the cameras'
  dronePoses:  [number, number, number, number, number, number, number][];
  // Rewired's Windows input source ( 0 Raw Input, 1 DirectInput, 2 XInput, 3 Windows Gaming Input ), XInput on
  source:      number;
  xinput:      boolean;
  joysticks:   string[];
  // the game's Raw Input registrations: usage page, usage, flags, the window it goes to ( "game", "none", "other" )
  rawInput:    [number, number, string, string][];
  // every Rewired player: its joysticks and their maps
  players:     string[];
  // how many times the game has read the test pad, and what it has asked of the link ( pad.rs CALLS )
  padReads:    number;
  calls:       number[];
  ms:          number;
}

// One item of the asset library ( default library or the user's imports; src-tauri/src/commands/library.rs list_library ).
export interface LibraryEntry {
  // "app:<file>" ( comes with the studio ), "game:<file>" ( the features with the game's look, built from your
  // install ), "user:<file>" ( your library )
  id:       string;
  name:     string;
  // "Features/Rails", "Melon's park/Nature", "My imports", …
  folder:   string;
  kind:     "mesh" | "material";
  // mesh items from the default library carry their object; personal meshes load theirs on demand
  object:   unknown | null;
  material: CustomMaterial | null;
  size:     [number, number, number] | null;
}

// A personal material ( src-tauri/src/library/userassets.rs ).
export interface UserMaterial {
  path:     string;
  name:     string;
  material: CustomMaterial;
}

// Viewport cache of a project's custom-object library ( src-tauri/src/project/assets.rs ).
export interface AssetIndex {
  dir:      string;
  meshes:   Record<string, { file: string; vertexCount: number; hasNormals: boolean; submeshes: number[] }>;
  textures: Record<string, string>;
  // texture key → its values used as they are ( true ) or read as sRGB colour ( false ), as the game does
  linear?:  Record<string, boolean>;
}

export interface GenOptions {
  radius:      number;
  ringRes:     number[];
  chunkSize:   number;
  base:        "slope" | "hills" | "mountain" | "flat";
  slopeDeg:    number;
  heightRange: number;
  seed:        number;
}

export interface MapListing {
  path:     string;
  name:     string;
  id:       string;
  bytes:    number;
  modified: number;
}

/**
 * A step of the studio's start done ( written to boot.log with the time since it started ).
**/
export const bootMark = ( what: string ) => void invoke( "boot_mark", { what } ).catch( () => {} );

export const ipc = {
  appInfo:       () => invoke<AppInfo>( "app_info" ),
  readText:      ( path: string ) => invoke<string>( "read_text", { path } ),
  /**
   * an OpenStreetMap Overpass query, sent from the studio ( src-tauri overpass_query ): the answer's JSON text
  **/
  overpassQuery: ( query: string ) => invoke<string>( "overpass_query", { query } ),
  writeText:     ( path: string, text: string ) => invoke<void>( "write_text", { path, text } ),
  readBinary:    ( path: string ) => invoke<ArrayBuffer>( "read_binary", { path } ),
  /**
   * a web address fetched by the studio ( src-tauri http_fetch: for servers that don't let a web page read them )
  **/
  httpFetch:     ( url: string, range?: string ) => invoke<ArrayBuffer>( "http_fetch", { url, range: range ?? null } ),
  writeBinary: ( path: string, data: ArrayBuffer | Uint8Array ) =>
    invoke<void>( "write_binary", data instanceof Uint8Array ? data : new Uint8Array( data ), {
      headers: { "x-path": encodeURIComponent( path ) },
    } ),
  pathExists:   ( path: string ) => invoke<boolean>( "path_exists", { path } ),
  /**
   * a file's size and last write ( ms ), or null when it isn't there
  **/
  fileStamp:    ( path: string ) => invoke<[number, number] | null>( "file_stamp", { path } ),
  /**
   * the studio projects directly inside a folder
  **/
  findProjects: ( root: string ) => invoke<{ dir: string; mapId: string; name: string; sourceMapId: string | null }[]>( "find_projects", { root } ),
  /**
   * an image's exact RGBA pixels ( no premultiplying ): width, height, data
  **/
  readImageRgba: async ( path: string ) => {
    const buf = new Uint8Array( await invoke<ArrayBuffer>( "read_image_rgba", { path } ) );
    const dv  = new DataView( buf.buffer, buf.byteOffset, 8 );
    return { width: dv.getUint32( 0, true ), height: dv.getUint32( 4, true ), data: buf.subarray( 8 ) };
  },
  loadProject:  ( dir: string ) => invoke<Project>( "load_project", { dir } ),
  saveProject:  ( dir: string, project: Project ) => invoke<void>( "save_project", { dir, project } ),
  importJbrmap: ( mapPath: string, projectDir: string ) => invoke<Project>( "import_jbrmap", { mapPath, projectDir } ),
  exportProject: ( projectDir: string, outPath?: string ) =>
    invoke<ExportResult>( "export_project", { projectDir, outPath: outPath ?? null } ),
  generateProject: ( dir: string, name: string, id: string, options: GenOptions ) =>
    invoke<Project>( "generate_project", { dir, name, id, options } ),
  playInGame: ( mapId: string, embed: boolean ) =>
    invoke<"reloaded" | "restarted" | "launched">( "play_in_game", { mapId, embed } ),
  /**
   * how the studio's link is doing in the game started at `sinceMs`: "ok", why it isn't working, or null ( not yet known )
  **/
  linkHealth:          ( sinceMs: number ) => invoke<string | null>( "link_health", { sinceMs } ),
  /**
   * to the Recycle Bin: a studio project folder or a map in the game's Maps folder
  **/
  recycle:             ( path: string ) => invoke<void>( "recycle", { path } ),
  /**
   * an untitled map never given anything, deleted ( only those: src-tauri remove_empty_session )
  **/
  removeEmptySession:  ( dir: string ) => invoke<void>( "remove_empty_session", { dir } ),
  /**
   * a folder copied, everything in it ( refuses one that's there )
  **/
  copyDir:             ( from: string, to: string ) => invoke<void>( "copy_dir", { from, to } ),
  listLibrary:         () => invoke<LibraryEntry[]>( "list_library" ),
  /**
   * maps whose pieces are in your library ( path: their folder there )
  **/
  listLibraryMaps:     () => invoke<{ path: string; label: string }[]>( "list_library_maps" ),
  /**
   * adds a map's pieces to your library ( path: the map ), or takes them out ( path: their folder ); returns how many were added
  **/
  setLibraryMap:       ( path: string, add: boolean ) => invoke<number>( "set_library_map", { path, add } ),
  /**
   * an image as a texture in the project's library ( a material's slot ); its key. `linear` for normal/metallic/roughness maps
  **/
  addTextureToProject: ( projectDir: string, file: string, linear: boolean ) => invoke<string>( "add_texture_to_project", { projectDir, file, linear } ),
  /**
   * opens your library's folder in Explorer
  **/
  showLibraryFolder:   () => invoke<void>( "show_library_folder" ),
  addScenery:          ( projectDir: string, name: string, strips: string[], texture: string ) => invoke<unknown>( "add_scenery", { projectDir, name, strips, texture } ),
  /**
   * the play area's terrain as a coarse part of the scenery ( src-tauri scenery::set_inner ): the mesh's key
  **/
  setSceneryInner:     ( projectDir: string, prefix: string, file: string ) => invoke<[string, [number, number, number]]>( "set_scenery_inner", { projectDir, prefix, file } ),
  /**
   * the scenery painted again with rock from `rockAngle` degrees ( src-tauri scenery::repaint ): the texture's key
  **/
  repaintScenery:      ( projectDir: string, prefix: string, rockAngle: number ) => invoke<string>( "repaint_scenery", { projectDir, prefix, rockAngle } ),
  /**
   * modelled pieces' meshes into the project's library at export ( src-tauri project/models.rs )
  **/
  setModelMeshes: ( projectDir: string, meshes: { key: string; file: string; submeshes: number[] }[], textures: { key: string; file: string; linear?: boolean }[] = [] ) =>
    invoke<void>( "set_model_meshes", { projectDir, meshes, textures } ),
  /**
   * brings the meshes/textures `objects` use from one project's library into another's; returns the library path
  **/
  copyPieceAssets:    ( fromProject: string, toProject: string, objects: unknown[] ) => invoke<string>( "copy_piece_assets", { fromProject, toProject, objects } ),
  placeLibraryMesh:   ( projectDir: string, id: string ) => invoke<{ object: unknown; library: string }>( "place_library_mesh", { projectDir, id } ),
  refreshLibraryMesh: ( projectDir: string, id: string ) => invoke<{ object: unknown; library: string }>( "refresh_library_mesh", { projectDir, id } ),
  /**
   * several library pieces copied into the project at once ( its library read and written once )
  **/
  placeLibraryMeshes: ( projectDir: string, ids: string[] ) => invoke<{ object: unknown; library: string }[]>( "place_library_meshes", { projectDir, ids } ),
  /**
   * for each of the game's pieces ( "game:" id, game-look textures its pieces use ): whether the project holds an older build of its look
  **/
  staleGameLook:      ( projectDir: string, pieces: [string, string[]][] ) => invoke<boolean[]>( "stale_game_look", { projectDir, pieces } ),
  placeLibraryMaterial: ( projectDir: string, id: string ) =>
    invoke<{ material: CustomMaterial; library: string }>( "place_library_material", { projectDir, id } ),
  /**
   * `library`: the project's library file as the editor has it ( null: read project.json )
  **/
  prepareAssets:     ( projectDir: string, library: string | null = null ) => invoke<AssetIndex>( "prepare_assets", { projectDir, library } ),
  listUserAssets:    () => invoke<UserAsset[]>( "list_user_assets" ),
  importUserAsset:   ( file: string ) => invoke<UserAsset>( "import_user_asset", { file } ),
  addAssetToProject: ( projectDir: string, asset: string ) => invoke<{ object: unknown; library: string }>( "add_asset_to_project", { projectDir, asset } ),
  saveCustomAsAsset: ( projectDir: string, library: string, object: unknown, name: string, over?: string ) =>
    invoke<UserAsset>( "save_custom_as_asset", { projectDir, library, object, name, over: over ?? null } ),
  deleteUserAsset:     ( path: string ) => invoke<void>( "delete_user_asset", { path } ),
  /**
   * the file of the piece ( game look ) a placed game object is drawn as: its feature id and its settings
  **/
  gameObjectLook:      ( id: string, params: Record<string, string> ) => invoke<string | null>( "game_object_look", { id, params } ),
  /**
   * the game's features' lights, by feature id ( gamelook/mod.rs )
  **/
  gameLights:          () => invoke<Record<string, GameLight[]>>( "game_lights" ),
  gameSpins:           () => invoke<Record<string, GameSpin[]>>( "game_spins" ),
  gameMark:            () => invoke<ArrayBuffer>( "game_mark" ),
  gameSky:             () => invoke<import( "../viewport/render/gameSky" ).GameSkyData | null>( "game_sky" ),
  /**
   * the game's snow ( its terrain textures and numbers ), once its look has been read
  **/
  gameTerrain:         () => invoke<GameTerrain | null>( "game_terrain" ),
  libraryEntryPreview: ( path: string ) => invoke<{ index: AssetIndex; object: unknown }>( "library_entry_preview", { path } ),
  listUserMaterials:   () => invoke<UserMaterial[]>( "list_user_materials" ),
  importMaterialImage: ( file: string ) => invoke<UserMaterial>( "import_material_image", { file } ),
  saveMaterialFromProject: ( projectDir: string, library: string, material: CustomMaterial, name: string ) =>
    invoke<UserMaterial>( "save_material_from_project", { projectDir, library, material, name } ),
  addMaterialToProject: ( projectDir: string, material: string ) =>
    invoke<{ material: CustomMaterial; library: string }>( "add_material_to_project", { projectDir, material } ),
  gameStatus:     () => invoke<"notRunning" | "running" | "embedded">( "game_status" ),
  /**
   * Physical pixels in the window's client area. Resolves false until the game has opened its window.
  **/
  gameAttach:     ( area: { x: number; y: number; w: number; h: number } ) => invoke<boolean>( "game_attach", { area } ),
  gameSetVisible: ( visible: boolean ) => invoke<void>( "game_set_visible", { visible } ),
  gameFocus:      () => invoke<void>( "game_focus" ),
  gameRelease:    () => invoke<void>( "game_release" ),
  gamePopOut:     () => invoke<void>( "game_pop_out" ),
  /**
   * closes Jibbers
  **/
  gameClose:      () => invoke<void>( "game_close" ),
  /**
   * the test pad in the game ( the link's ) as `pad` says; null takes it out
  **/
  gamePad:        ( pad: GamePad | null ) => invoke<void>( "game_pad", { pad } ),
  gameProbe:      () => invoke<GameProbe | null>( "game_probe" ),
  listGameMaps:   () => invoke<MapListing[]>( "list_game_maps" ),
};

export const joinPath = ( ...parts: string[] ) =>
  parts
    .filter( Boolean )
    .map( ( p, i ) => ( i === 0 ? p.replace( /[\\/]+$/, "" ) : p.replace( /^[\\/]+|[\\/]+$/g, "" ) ) )
    .join( "\\" );

/**
 * Discord's status line ( "Playing Jibbers Map Studio" ): what's being done, or null for nothing.
**/
export const discordPresence = ( details: string | null, state: string | null ) => void invoke( "discord_presence", { details, state } ).catch( () => {} );
