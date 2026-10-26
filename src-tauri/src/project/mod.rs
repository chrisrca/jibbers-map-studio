//! `.jbrproj` project folders and conversion to/from `.jbrmap`.
//!
//! ```text
//! MyMap.jbrproj/
//!   project.json          map settings, chunks, objects, spawns (Unity coordinates, like the game)
//!   heights/<key>.f32     raw little-endian f32, res*res, metres above chunk.position.y, rows along +Z
//!   masks/<key>.png       snow mask (R snow, G marking hue, B coverage, A powder)
//!   masks/<key>_2.png     optional flow mask (snow-mask-2)
//!   assets/library.jbrmap mesh + texture libraries (custom objects, trees), stored with the jbrmap codec
//! ```
//!
//! Export compiles this folder into a single `.jbrmap`; import does the reverse.

pub mod assets;
pub mod generate;
pub mod models;
pub mod scenery;
mod import;
mod export;
pub(crate) use import::*;
pub(crate) use export::*;

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use indexmap::IndexMap;
use crate::jbrmap::{Chunk, CustomObject, MapData, MapObject, ParamValue, SpawnPoint, TextureData, TreePrototype, Vec3};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

pub const PROJECT_FILE: &str = "project.json";
pub const FORMAT: &str = "jibbers-studio-project";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub format: String,
    pub version: u32,
    pub map: MapSettings,
    pub chunks: Vec<ChunkEntry>,
    #[serde(default)]
    pub objects: Vec<ObjectEntry>,
    #[serde(default)]
    pub spawns: Vec<SpawnEntry>,
    /// Custom objects carried through from imported maps (edited in M4).
    #[serde(default)]
    pub custom_objects: Vec<CustomObject>,
    #[serde(default)]
    pub library: Option<String>,
    /// Arbitrary editor-only state (camera, layers, ...), passed through untouched.
    #[serde(default)]
    pub editor: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MapSettings {
    pub id: String,
    pub name: String,
    pub cam_start: [f32; 3],
    pub allow_background_mountains: bool,
    pub override_time: bool,
    pub day_time: f32,
    pub day_time_hours: f32,
    pub sun_angle: f32,
    /// The map's own version (raised before uploading an update).
    #[serde(default = "first_version")]
    pub mod_version: String,
    #[serde(default)]
    pub author: String,
    /// Remixes it went through (the game fills these in; kept as they came).
    #[serde(default)]
    pub remix_authors: String,
    #[serde(default)]
    pub remix_ids: String,
    /// The whole map scaled by this in game (0.1 to 3).
    #[serde(default = "unit")]
    pub scale: f32,
}

fn first_version() -> String {
    "1.0".into()
}

fn unit() -> f32 {
    1.0
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChunkEntry {
    pub key: String,
    pub position: [f32; 3],
    pub size: [f32; 3],
    pub resolution: i32,
    pub heights: String,
    #[serde(default)]
    pub snow_mask: Option<String>,
    #[serde(default)]
    pub snow_mask_4_channel: bool,
    #[serde(default)]
    pub snow_mask_2: Option<String>,
    #[serde(default)]
    pub tree_prototypes: Vec<TreePrototype>,
    #[serde(default = "one")]
    pub repeats: i32,
    #[serde(default)]
    pub repeat_offset: [f32; 3],
}

fn one() -> i32 {
    1
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ObjectEntry {
    pub uid: String,
    /// Placeholder id ("rail_long").
    pub id: String,
    pub position: [f32; 3],
    /// Unity euler degrees.
    pub rotation: [f32; 3],
    pub scale: [f32; 3],
    #[serde(default)]
    pub params: IndexMap<String, ParamValue>,
    /// A lift's top station and masts (its own space).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lift: Option<crate::jbrmap::LiftData>,
    /// A lift whose masts are spaced on the ground this many metres apart, again whenever its ends move (studio only;
    /// none: they're where they were put).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lift_auto: Option<f32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SpawnEntry {
    pub uid: String,
    pub name: String,
    pub position: [f32; 3],
    pub rotation: [f32; 3],
    pub velocity: [f32; 3],
}

fn v3(a: [f32; 3]) -> Vec3 {
    Vec3::new(a[0], a[1], a[2])
}
fn a3(v: Vec3) -> [f32; 3] {
    [v.x, v.y, v.z]
}

pub fn load(dir: &Path) -> Result<Project> {
    let text = std::fs::read_to_string(dir.join(PROJECT_FILE)).with_context(|| format!("read {}", dir.display()))?;
    let p: Project = serde_json::from_str(&text).context("parse project.json")?;
    if p.format != FORMAT {
        bail!("not a Jibbers Map Studio project");
    }
    Ok(p)
}

pub fn save(dir: &Path, p: &Project) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join("project.json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(p)?)?;
    std::fs::rename(&tmp, dir.join(PROJECT_FILE))?;
    Ok(())
}

// ------------------------------------------------------------------ helpers

pub fn write_f32(path: &PathBuf, v: &[f32]) -> Result<()> {
    let mut bytes = Vec::with_capacity(v.len() * 4);
    for f in v {
        bytes.extend_from_slice(&f.to_le_bytes());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, bytes)?;
    Ok(())
}

pub fn read_f32(path: &PathBuf) -> Result<Vec<f32>> {
    let bytes = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
    Ok(bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect())
}

#[cfg(test)]
mod studio_data_tests {
    /// A piece's studio-only data (its grind rail) comes through a save unchanged: the project goes through these
    /// structs on its way to disk, and a field they didn't know used to be dropped there.
    #[test]
    fn a_pieces_rail_survives_saving() {
        let rail = serde_json::json!({ "points": [[-1.0, 0.5, 0.0], [1.0, 0.5, 0.2]], "radius": 0.05, "solid": true, "body": [{ "shape": "Mesh" }] });
        let mut piece = serde_json::to_value(crate::jbrmap::CustomObject::default()).unwrap();
        piece["rail"] = rail.clone();
        let o: crate::jbrmap::CustomObject = serde_json::from_value(piece).unwrap();
        let back = serde_json::to_value(&o).unwrap();
        assert_eq!(back["rail"], rail);
        // and a piece without one doesn't grow an empty field
        assert!(serde_json::to_value(crate::jbrmap::CustomObject::default()).unwrap().get("rail").is_none());
    }
}

#[cfg(test)]
mod physics_tests {
    use crate::jbrmap::{Collider, ColliderShape, SurfaceType, Vec3};

    fn capsule(radius: f32, height: f32, scale: [f32; 3]) -> Collider {
        let v = |x: f32, y: f32, z: f32| Vec3 { x, y, z };
        Collider {
            shape: ColliderShape::Capsule, surface_type: SurfaceType::Jib,
            local_position: v(0.0, 0.0, 0.0), local_rotation: v(0.0, 0.0, 0.0), local_scale: v(scale[0], scale[1], scale[2]),
            center: v(0.0, 0.0, 0.0), size: v(0.0, 0.0, 0.0), radius, height, direction: 1, mesh_ref: String::new(),
        }
    }

    #[test]
    fn colliders_the_physics_refuses_are_made_safe_or_left_out() {
        let mut cs = vec![
            capsule(0.1, 0.2, [1.0, 1.0, 1.0]),  // no straight part: "size 1 must be positive"
            capsule(0.1, 0.5, [3.0, 1.0, 3.0]),  // only straight before scaling: round ends grow 3x, the length doesn't
            capsule(0.1, 1.0, [1.0, 1.0, 1.0]),  // fine
            capsule(f32::NAN, 1.0, [1.0, 1.0, 1.0]), // not a number: left out
        ];
        let mut b = capsule(0.0, 0.0, [1.0, 1.0, 1.0]);
        b.shape = ColliderShape::Box;
        b.size = Vec3 { x: 1.0, y: 0.0, z: 1.0 }; // flat
        cs.push(b);
        assert_eq!(super::physics_safe(&mut cs), 4);
        assert_eq!(cs.len(), 4);
        for c in &cs[..2] {
            let across = c.local_scale.x.max(c.local_scale.z);
            assert!(c.height * c.local_scale.y / 2.0 - c.radius * across > 0.0, "{c:?}");
        }
        assert_eq!(cs[2].height, 1.0);
        assert!(cs[3].size.y > 0.0);
    }

    #[test]
    fn a_flat_chunk_gets_a_height_range() {
        let mut c = crate::jbrmap::Chunk { position: Vec3::new(-500.0, -50.0, -500.0), size: Vec3::new(1000.0, 260.0, 1000.0), heightmap_resolution: 5, ..Default::default() };
        let distinct = |c: &crate::jbrmap::Chunk| {
            let mut v: Vec<u16> = c.terrain_data.as_ref().unwrap().chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])).collect();
            v.sort();
            v.dedup();
            v
        };
        c.set_heights(&[60.0; 25]);
        assert!(super::never_flat(&mut c));
        let d = distinct(&c);
        assert_eq!(d.len(), 2, "{d:?}");
        assert_eq!(d[1] - d[0], 1);
        // a chunk with any slope at all is left as it is
        let mut hs = [60.0; 25];
        hs[12] = 61.0;
        c.set_heights(&hs);
        let before = c.terrain_data.clone();
        assert!(!super::never_flat(&mut c));
        assert_eq!(c.terrain_data, before);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Import MLNZ Park into a project, export it again and compare with the original.
    #[test]
    fn mlnz_import_export_roundtrip() {
        let src = PathBuf::from(r"C:\Projects\jibbers-map\Jibbers_Template\MLNZ Park.jbrmap");
        if !src.exists() {
            return;
        }
        let dir = std::env::temp_dir().join("jibbers_studio_test.jbrproj");
        let _ = std::fs::remove_dir_all(&dir);
        let p = import_jbrmap(&src, &dir).unwrap();
        assert_eq!(p.objects.len(), 54);
        assert_eq!(p.custom_objects.len(), 214);
        let back = to_map(&dir, &p).unwrap();
        let orig = crate::jbrmap::load(&src).unwrap();
        assert_eq!(back.chunks[0].terrain_data, orig.chunks[0].terrain_data, "heights must survive u16 -> f32 -> u16");
        assert_eq!(back.chunks[0].objects, orig.chunks[0].objects);
        assert_eq!(back.chunks[0].custom_objects, orig.chunks[0].custom_objects);
        assert_eq!(back.chunks[0].tree_prototypes, orig.chunks[0].tree_prototypes);
        let (a, b) = (back.chunks[0].snow_mask.as_ref().unwrap(), orig.chunks[0].snow_mask.as_ref().unwrap());
        assert_eq!((a.width, a.height, &a.data), (b.width, b.height, &b.data), "snow mask PNG passes through unchanged");
        assert_eq!(back.spawn_points, orig.spawn_points);
        assert_eq!(back.mesh_library, orig.mesh_library);
        assert_eq!(back.texture_library, orig.texture_library);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_v05_map_keeps_its_author_scale_and_lifts() {
        let src = PathBuf::from(r"C:\Program Files (x86)\Steam\steamapps\common\Jibbers Playtest\Jibbers_Data\StreamingAssets\Maps\joyosa-park.jbrmap");
        if !src.exists() {
            return;
        }
        let dir = std::env::temp_dir().join("jibbers_studio_v05_test.jbrproj");
        let _ = std::fs::remove_dir_all(&dir);
        let mut p = import_jbrmap(&src, &dir).unwrap();
        let orig = crate::jbrmap::load(&src).unwrap();
        assert_eq!(p.objects.iter().filter(|o| o.lift.is_some()).count(), 2);
        let back = to_map(&dir, &p).unwrap();
        assert_eq!((back.version.as_str(), &back.mod_version, &back.author, back.scale), ("0.5", &orig.mod_version, &orig.author, orig.scale));
        let lifts = |m: &MapData| m.chunks.iter().flat_map(|c| &c.objects).filter_map(|o| o.lift.clone()).collect::<Vec<_>>();
        assert_eq!(lifts(&back), lifts(&orig));
        // an id the game won't take is made from the name
        p.map.id = "Joyosa Park!".into();
        assert_eq!(to_map(&dir, &p).unwrap().id, "joyosa-park");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn trees_go_in_as_the_games_trees() {
        use crate::jbrmap::Part;
        let tree = CustomObject {
            position: Vec3::new(250.0, 120.0, 750.0),
            rotation: Vec3::new(0.0, 90.0, 0.0),
            scale: Vec3::new(1.5, 2.0, 1.5),
            parts: vec![Part { mesh: "Features/tree_spruce/0".into(), ..Part::default() }],
            ..CustomObject::default()
        };
        assert_eq!(official_tree(&tree).as_deref(), Some("tree_spruce"));
        let rail = CustomObject { parts: vec![Part { mesh: "Features/rail_long/0".into(), ..Part::default() }], ..CustomObject::default() };
        assert_eq!(official_tree(&rail), None);
        let c = Chunk { position: Vec3::new(0.0, 100.0, 0.0), size: Vec3::new(1000.0, 400.0, 1000.0), ..Chunk::default() };
        let b = tree_instance(&tree, &c);
        let f = |i: usize| f32::from_le_bytes(b[i * 4..i * 4 + 4].try_into().unwrap());
        assert!((f(0) - 0.25).abs() < 1e-6 && (f(1) - 0.05).abs() < 1e-6 && (f(2) - 0.75).abs() < 1e-6);
        assert!((f(3) - 1.5).abs() < 1e-6 && (f(4) - 2.0).abs() < 1e-6 && (f(5) - std::f32::consts::FRAC_PI_2).abs() < 1e-5);
        assert_eq!(b[27], 255);
    }
}

#[cfg(test)]
mod powder_version_test {
    use super::powder_from_alpha;

    #[test]
    fn reads_versions_as_the_game_does() {
        for (v, want) in [("0.4", true), ("0.4.2", true), ("1.0", true), ("0.3.4", false), ("0.2", false), ("0", false), ("", false), ("0.4b", false)] {
            assert_eq!(powder_from_alpha(v), want, "{v}");
        }
    }
}
