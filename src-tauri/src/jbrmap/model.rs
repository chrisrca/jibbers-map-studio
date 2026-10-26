//! In-memory model of a .jbrmap, mirroring Map-Tools' C# classes (fun.jibbers.map-tools 0.4,
//! Scripts/MapData/*.cs). Field defaults match the C# initialisers, because the reader falls back
//! to them for missing keys exactly as the game does.

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

pub const FORMAT_VERSION: &str = "0.5";

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    pub const ZERO: Vec3 = Vec3 { x: 0.0, y: 0.0, z: 0.0 };
    pub const ONE: Vec3 = Vec3 { x: 1.0, y: 1.0, z: 1.0 };
    pub fn new(x: f32, y: f32, z: f32) -> Self {
        Vec3 { x, y, z }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Color {
    pub const WHITE: Color = Color { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
    pub const BLACK: Color = Color { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MapData {
    pub id: String,
    pub name: String,
    pub version: String,
    /// 0.5: the map's own version (raised before uploading an update to mod.io).
    pub mod_version: String,
    /// 0.5: who made it.
    pub author: String,
    /// 0.5: filled in by the game when a map is remixed ('>'-separated, oldest first).
    pub remix_authors: String,
    pub remix_ids: String,
    /// 0.5: the whole map scaled by this in game.
    pub scale: f32,
    pub cam_start_position: Vec3,
    pub allow_background_mountains: bool,
    pub override_time: bool,
    pub day_time: f32,
    /// Written only when >= 0 (C# `dayTimeHours`, default -1 = use raw `day_time`).
    pub day_time_hours: f32,
    pub sun_angle: f32,
    pub chunks: Vec<Chunk>,
    pub spawn_points: Vec<SpawnPoint>,
    pub mesh_library: IndexMap<String, MeshData>,
    pub texture_library: IndexMap<String, TextureData>,
}

impl Default for MapData {
    fn default() -> Self {
        MapData {
            id: String::new(),
            name: String::new(),
            version: FORMAT_VERSION.into(),
            mod_version: "1.0".into(),
            author: String::new(),
            remix_authors: String::new(),
            remix_ids: String::new(),
            scale: 1.0,
            cam_start_position: Vec3::ZERO,
            allow_background_mountains: false,
            override_time: false,
            day_time: 0.0,
            day_time_hours: -1.0,
            sun_angle: 0.0,
            chunks: vec![],
            spawn_points: vec![],
            mesh_library: IndexMap::new(),
            texture_library: IndexMap::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Chunk {
    pub position: Vec3,
    pub size: Vec3,
    /// 2^n + 1, 33..=4097.
    pub heightmap_resolution: i32,
    /// Raw R16 little-endian heights, row-major, rows along +Z, value = height / size.y * 65535.
    pub terrain_data: Option<Vec<u8>>,
    pub snow_mask: Option<TextureData>,
    pub snow_mask_4channel: bool,
    pub snow_mask_2: Option<TextureData>,
    pub objects: Vec<MapObject>,
    pub custom_objects: Vec<CustomObject>,
    pub tree_prototypes: Vec<TreePrototype>,
    pub repeats: i32,
    pub repeat_offset: Vec3,
}

impl Default for Chunk {
    fn default() -> Self {
        Chunk {
            position: Vec3::ZERO,
            size: Vec3::new(1000.0, 600.0, 1000.0),
            heightmap_resolution: 4097,
            terrain_data: None,
            snow_mask: None,
            snow_mask_4channel: false,
            snow_mask_2: None,
            objects: vec![],
            custom_objects: vec![],
            tree_prototypes: vec![],
            repeats: 1,
            repeat_offset: Vec3::ZERO,
        }
    }
}

impl Chunk {
    /// Heights in metres (relative to `position.y`), row-major `[z * res + x]`.
    pub fn heights(&self) -> Vec<f32> {
        let res = self.heightmap_resolution.max(0) as usize;
        let mut out = vec![0.0f32; res * res];
        if let Some(raw) = &self.terrain_data {
            let scale = self.size.y / 65535.0;
            for (i, px) in raw.chunks_exact(2).take(out.len()).enumerate() {
                out[i] = u16::from_le_bytes([px[0], px[1]]) as f32 * scale;
            }
        }
        out
    }

    /// Inverse of [`Chunk::heights`]; clamps to `0..=size.y` like `ExportHeightmapR16`.
    /// Rounds to the nearest step (C# truncates), so heights read with [`Chunk::heights`] encode
    /// back to exactly the same R16 values.
    pub fn set_heights(&mut self, heights: &[f32]) {
        let sy = if self.size.y > 0.0 { self.size.y } else { f32::INFINITY };
        let mut raw = Vec::with_capacity(heights.len() * 2);
        for &h in heights {
            let v = ((h / sy) * 65535.0).round().clamp(0.0, 65535.0) as u16;
            raw.extend_from_slice(&v.to_le_bytes());
        }
        self.terrain_data = Some(raw);
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SpawnPoint {
    pub name: String,
    pub position: Vec3,
    pub rotation: Vec3,
    pub velocity: Vec3,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MapObject {
    /// Placeholder id, e.g. "rail_long" (prefab name without `_placeholder`).
    pub id: String,
    pub position: Vec3,
    pub rotation: Vec3,
    pub scale: Vec3,
    pub parameters: IndexMap<String, ParamValue>,
    /// 0.5 lifts (chairlift / tbar / ropetow): the top station and the masts between, in the object's own space.
    #[serde(default)]
    pub lift: Option<LiftData>,
}

/// `LiftObjectData`: positions in the lift object's local space (Unity `TransformPoint`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiftData {
    pub end_position: Vec3,
    pub masts: Vec<Vec3>,
}

/// Map ids the game takes (`MapData.IsValidId`): letters, digits, '-' and '_', at most 36.
pub fn is_valid_map_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 36 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// `MapData.IdFromName`: "Super Lake Park" -> "super-lake-park".
pub fn map_id_from_name(name: &str) -> String {
    let mut id = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            id.push(c);
        } else if !id.is_empty() && !id.ends_with('-') {
            id.push('-');
        }
    }
    id.truncate(36);
    id.trim_end_matches('-').to_string()
}

/// Whether a map of format `version` carries the 0.5 header (mod version, author, remixes, scale).
pub fn has_v05_header(version: &str) -> bool {
    let mut it = version.split('.').map(|p| p.parse::<u32>().unwrap_or(0));
    let (a, b) = (it.next().unwrap_or(0), it.next().unwrap_or(0));
    (a, b) >= (0, 5)
}

/// `CustomParameter` values are stored bare under the parameter name; the JSON token type
/// decides the C# type on read (string / bool / integer / float).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum ParamValue {
    Int(i64),
    Float(f32),
    Bool(bool),
    String(String),
}

#[repr(i32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SurfaceType {
    Generic = 0,
    Snow = 1,
    Jib = 2,
}

impl SurfaceType {
    pub fn from_i32(v: i32) -> Self {
        match v {
            1 => SurfaceType::Snow,
            2 => SurfaceType::Jib,
            _ => SurfaceType::Generic,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CustomObject {
    pub surface_type: SurfaceType,
    pub can_stabilize: bool,
    pub can_rotate: bool,
    pub can_magnetize: bool,
    pub intended_up_method: i32,
    pub disable_distance_culling: bool,
    pub timed_visibility: bool,
    pub visible_from_hour: f32,
    pub visible_until_hour: f32,
    pub position: Vec3,
    pub rotation: Vec3,
    pub scale: Vec3,
    pub parts: Vec<Part>,
    pub colliders: Vec<Collider>,
    pub lod_groups: Vec<LodGroup>,
    pub lights: Vec<Light>,
    /// Fields this struct doesn't know, kept as they are: the studio's own data riding along with a piece (its grind
    /// rail) survives project saves. Never written to a map file (codec.rs writes the game's keys only).
    #[serde(flatten)]
    pub studio: serde_json::Map<String, serde_json::Value>,
}

impl Default for CustomObject {
    fn default() -> Self {
        CustomObject {
            surface_type: SurfaceType::Generic,
            can_stabilize: true,
            can_rotate: true,
            can_magnetize: true,
            intended_up_method: 0,
            disable_distance_culling: false,
            timed_visibility: false,
            visible_from_hour: 19.0,
            visible_until_hour: 6.0,
            position: Vec3::ZERO,
            rotation: Vec3::ZERO,
            scale: Vec3::ONE,
            parts: vec![],
            colliders: vec![],
            lod_groups: vec![],
            lights: vec![],
            studio: Default::default(),
        }
    }
}

/// A rendered mesh part. Despite the "local-" key names, transforms are world-space.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Part {
    pub mesh: String,
    pub local_position: Vec3,
    pub local_rotation: Vec3,
    pub local_scale: Vec3,
    pub materials: Vec<Material>,
    pub lod_group_index: i32,
    pub lod_index: i32,
    pub shadow_casting_mode: i32,
}

impl Default for Part {
    fn default() -> Self {
        Part {
            mesh: String::new(),
            local_position: Vec3::ZERO,
            local_rotation: Vec3::ZERO,
            local_scale: Vec3::ONE,
            materials: vec![],
            lod_group_index: -1,
            lod_index: 0,
            shadow_casting_mode: 1,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Material {
    pub base_tex: String,
    pub metallic_tex: String,
    pub roughness_tex: String,
    pub normal_tex: String,
    pub emission_tex: String,
    /// 0 opaque, 1 alpha clip, 2 transparent.
    pub render_mode: i32,
    pub alpha_cutoff: f32,
    pub tiling: Vec2,
    pub offset: Vec2,
    pub cull_mode: i32,
    pub base_color: Color,
    /// Alpha is not serialized; kept at 1.
    pub emission_color: Color,
    pub metallic: f32,
    pub smoothness: f32,
    pub lit: bool,
    pub extra_props: IndexMap<String, MaterialProp>,
    pub keywords: Vec<String>,
    /// The studio's name for it (Blender's material name; not in the map file).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub name: String,
}

impl Default for Material {
    fn default() -> Self {
        Material {
            base_tex: String::new(),
            metallic_tex: String::new(),
            roughness_tex: String::new(),
            normal_tex: String::new(),
            emission_tex: String::new(),
            render_mode: 0,
            alpha_cutoff: 0.5,
            tiling: Vec2 { x: 1.0, y: 1.0 },
            offset: Vec2::default(),
            cull_mode: 2,
            base_color: Color::WHITE,
            emission_color: Color::BLACK,
            metallic: 0.0,
            smoothness: 0.0,
            lit: true,
            extra_props: IndexMap::new(),
            keywords: vec![],
            name: String::new(),
        }
    }
}

/// `MaterialPropertyData`: type 0 float, 1 color, 2 vector, 3 texture ref.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum MaterialProp {
    Float(f32),
    Color([f32; 4]),
    Vector([f32; 4]),
    Texture(String),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LodGroup {
    pub local_position: Vec3,
    pub local_reference_point: Vec3,
    pub size: f32,
    pub fade_mode: i32,
    pub animate_crossfading: bool,
    pub transitions: Vec<f32>,
    pub fade_widths: Vec<f32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Light {
    /// UnityEngine.LightType (0 spot, 2 point).
    pub light_type: i32,
    pub local_position: Vec3,
    pub local_rotation: Vec3,
    pub color: Color,
    pub intensity: f32,
    pub range: f32,
    pub spot_angle: f32,
    pub inner_spot_angle: f32,
    pub shadows: i32,
    pub shadow_strength: f32,
}

#[repr(i32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ColliderShape {
    Box = 0,
    Sphere = 1,
    Capsule = 2,
    Mesh = 3,
}

impl ColliderShape {
    pub fn from_i32(v: i32) -> Self {
        match v {
            1 => ColliderShape::Sphere,
            2 => ColliderShape::Capsule,
            3 => ColliderShape::Mesh,
            _ => ColliderShape::Box,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Collider {
    pub shape: ColliderShape,
    pub surface_type: SurfaceType,
    pub local_position: Vec3,
    pub local_rotation: Vec3,
    pub local_scale: Vec3,
    pub center: Vec3,
    pub size: Vec3,
    pub radius: f32,
    pub height: f32,
    /// Capsule axis: 0 x, 1 y, 2 z.
    pub direction: i32,
    pub mesh_ref: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct TreePrototype {
    /// Placeholder id when the tree is an official map object; empty for mesh-built trees.
    pub object_id: String,
    pub parts: Vec<Part>,
    pub lod_groups: Vec<LodGroup>,
    pub colliders: Vec<Collider>,
    /// 28 bytes per instance: pos xyz, width scale, height scale, rotation (f32 LE), color rgba (u8).
    pub instances: Option<Vec<u8>>,
}

impl TreePrototype {
    pub const INSTANCE_STRIDE: usize = 28;
    pub fn instance_count(&self) -> usize {
        self.instances.as_ref().map_or(0, |b| b.len() / Self::INSTANCE_STRIDE)
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct MeshData {
    pub vertex_count: i32,
    /// f32 x3 per vertex.
    pub vertices: Option<Vec<u8>>,
    pub normals: Option<Vec<u8>>,
    /// f32 x4.
    pub tangents: Option<Vec<u8>>,
    /// Color32 (u8 x4).
    pub colors: Option<Vec<u8>>,
    /// f32 x2 each.
    pub uvs: Option<Vec<u8>>,
    pub uv2s: Option<Vec<u8>>,
    pub uv3s: Option<Vec<u8>>,
    pub uv4s: Option<Vec<u8>>,
    /// i32 indices per submesh.
    pub submeshes: Vec<Option<Vec<u8>>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TextureData {
    /// UnityEngine.TextureFormat (4 RGBA32, 10 DXT1, 12 DXT5, ...).
    pub format: i32,
    pub width: i32,
    pub height: i32,
    /// "png" or "raw".
    pub encoding: String,
    pub linear: bool,
    pub mipmaps: bool,
    /// 0 uncompressed, 1 normal, 2 high quality (game-side compression after decode).
    pub compression: i32,
    pub data: Option<Vec<u8>>,
}

impl Default for TextureData {
    fn default() -> Self {
        TextureData {
            format: 4,
            width: 0,
            height: 0,
            encoding: "png".into(),
            linear: true,
            mipmaps: false,
            compression: 1,
            data: None,
        }
    }
}
