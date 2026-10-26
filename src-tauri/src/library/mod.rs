//! The asset library: folders of pieces and materials, one file each. The folders are its catalog: move, rename or
//! sort files in Explorer and the asset browser follows (no names or rules in here decide where anything goes).
//!
//! Two roots, shown as one:
//! - the app's, shipped with it (`library/Library` next to the studio, read-only): the official features;
//! - yours, `%APPDATA%\Jibbers Studio\Asset Library`: your imports (`My imports`), the pieces of maps you added (a folder
//!   each, laid out as the map's author had them), and anything else you put there.
//!
//! A piece is `<name>.jbrasset` and a material `<name>.jbrmat`: small .jbrmap files holding one custom object (pivot at
//! the origin) and the meshes and textures it uses; a material rides on a mesh-less part. Placing one copies what it
//! uses into the project.

pub mod userassets;
mod listing;
mod writing;
mod maps;
mod rotation;
mod migrate;
pub(crate) use listing::*;
pub(crate) use writing::*;
pub(crate) use maps::*;
pub(crate) use rotation::*;
pub(crate) use migrate::*;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use indexmap::IndexMap;
use crate::jbrmap::{Chunk, CustomObject, MapData, Material, MeshData, Part, TextureData, Vec3};
use serde::{Deserialize, Serialize};

pub const OBJECT_EXT: &str = "jbrasset";
pub const MATERIAL_EXT: &str = "jbrmat";
/// Where new imports go in your library.
pub const IMPORTS: &str = "My imports";
/// In a folder made from a map's pieces: which map (to list it, and not add it twice).
const FROM_MAP: &str = ".from-map.json";

/// Your library's folder. (Not "Library": the first library's built files are in "library", the same folder to
/// Windows.)
pub fn user_root() -> Result<PathBuf> {
    let d = userassets::data_dir()?.join("Asset Library");
    std::fs::create_dir_all(&d)?;
    Ok(d)
}

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Mesh,
    Material,
}

/// What the browser shows of an entry without opening it.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Info {
    pub kind: Kind,
    pub material: Option<Material>,
    /// a piece's bounding box in metres
    pub size: Option<[f32; 3]>,
}

pub struct Item {
    pub path: PathBuf,
    /// relative to its root, "/"-separated ("Features/Rails"); "" at the top
    pub folder: String,
    pub name: String,
    pub info: Info,
}

pub fn kind_of(p: &Path) -> Option<Kind> {
    let e = p.extension()?.to_str()?.to_ascii_lowercase();
    if e == OBJECT_EXT {
        Some(Kind::Mesh)
    } else if e == MATERIAL_EXT {
        Some(Kind::Material)
    } else {
        None
    }
}

 // x, y, z, w

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jbrmap::{Collider, ColliderShape, Color, SurfaceType};
    use serde::Deserialize;
    use userassets::ImportOpts;

    #[test]
    fn euler_round_trip() {
        for e in [[10.0, 20.0, 30.0], [0.0, 270.0, 0.0], [350.0, 45.0, 5.0]] {
            let back = unity_euler_from_quat(quat_from_unity_euler(e));
            let q1 = quat_from_unity_euler(e);
            let q2 = quat_from_unity_euler(back);
            let dot: f32 = (0..4).map(|i| q1[i] * q2[i]).sum();
            assert!(dot.abs() > 0.9999, "{e:?} -> {back:?}");
        }
    }

    #[test]
    fn local_frame_keeps_the_part_where_it_was() {
        let mut o = CustomObject { position: Vec3::new(10.0, 2.0, -5.0), rotation: Vec3::new(0.0, 90.0, 0.0), ..CustomObject::default() };
        o.parts.push(Part { mesh: "m".into(), local_position: Vec3::new(10.0, 2.0, -6.0), local_rotation: Vec3::new(0.0, 90.0, 0.0), ..Part::default() });
        let l = to_local(&o);
        // world offset (0,0,-1) seen from a root turned 90° about Y is local (+1, 0, 0)
        let p = l.parts[0].local_position;
        assert!((p.x - 1.0).abs() < 1e-4 && p.y.abs() < 1e-4 && p.z.abs() < 1e-4, "{p:?}");
        assert!(l.parts[0].local_rotation.y.abs() < 1e-3 || (l.parts[0].local_rotation.y - 360.0).abs() < 1e-3);
    }

    #[test]
    fn piece_folders_come_from_the_authors_paths() {
        let o = |k: &str| CustomObject { parts: vec![Part { mesh: k.into(), ..Part::default() }], ..CustomObject::default() };
        assert_eq!(piece_group_and_name(&o("Melonz's Custom Rails/Flat Down/flat_down_rail_3")), ("Melonz's Custom Rails".into(), "Flat Down Rail".into()));
        assert_eq!(piece_group_and_name(&o("Assets/Props/Bench.fbx:Bench")), ("Props".into(), "Bench".into()));
        assert_eq!(piece_group_and_name(&o("Cube")).0, "");
    }

    #[test]
    fn file_names_windows_takes() {
        assert_eq!(file_name("a<b>c"), "a_b_c");
        assert_eq!(file_name("  rail. "), "rail");
        assert_eq!(file_name(""), "Piece");
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct PlaceholderInfo {
        id: String,
        file: String,
        #[serde(default)]
        parameters: Vec<serde_json::Value>,
        /// a lift: placed as the game's own object (its carriers run on it), never as a piece
        #[serde(default)]
        lift: Option<serde_json::Value>,
    }

    /// The game places its features at half the size of Map-Tools' placeholder models (see jibbers-player-scale).
    const FEATURE_SCALE: f32 = 0.5;

    /// Feature colours as the game draws them (matches PLACEHOLDER_COLORS in the viewport).
    const FEATURE_COLOURS: &[(&str, u32)] = &[
        ("blue", 0x3b82f6), ("red", 0xef4444), ("green", 0x22c55e), ("pink", 0xec4899), ("cyan", 0x06b6d4), ("orange", 0xf97316),
        ("yellow", 0xeab308), ("white", 0xf1f5f9), ("black", 0x334155),
    ];

    fn colour_material(hex: u32) -> Material {
        let c = |shift: u32| ((hex >> shift) & 0xff) as f32 / 255.0;
        Material { base_color: Color { r: c(16), g: c(8), b: c(0), a: 1.0 }, smoothness: 0.35, ..Material::default() }
    }

    /// Same grouping as the asset browser used for the official features.
    fn feature_folder(id: &str) -> &'static str {
        let has = |k: &str| id.contains(k);
        if has("tube") {
            "Features/Tubes"
        } else if has("spine") {
            "Features/Spines & hips"
        } else if has("box") || has("banana") {
            "Features/Boxes"
        } else if has("rail") || has("dfd") || has("donkeydick") || has("shotgun") || has("nipple") || has("firecracker") || has("flat_down") || has("cannon") {
            "Features/Rails"
        } else if has("street") || has("stairs") || has("bike_rack") || has("picnic") || has("ball") {
            "Features/Street"
        } else if has("floodlight") || has("snowcannon") || has("sign") || has("tree") {
            "Features/Props"
        } else {
            "Features/Other"
        }
    }

    /// The official features (the template's placeholder models) as pieces in `out_root/Features/<kind>/`, and their
    /// colours as materials in `out_root/Features/Colours/`. Made once into the app's library folder (see
    /// `make_app_library`); from then on the folders are the catalog, and this grouping isn't used by the app.
    fn build_features(placeholders_dir: &Path, out_root: &Path) -> Result<()> {
        // --- official features, as custom pieces with a mesh collider (Jib, so they grind like the real ones)
        let infos: Vec<PlaceholderInfo> = serde_json::from_str(&std::fs::read_to_string(placeholders_dir.join("placeholders.json"))?)?;
        let opts = ImportOpts { mirror_z: true, scale: FEATURE_SCALE, recenter: false };
        for info in infos.iter().filter(|i| i.lift.is_none()) {
            let mut c = userassets::convert(&placeholders_dir.join(&info.file), opts).with_context(|| format!("feature {}", info.id))?;
            let folder = feature_folder(&info.id);
            let props = folder == "Features/Props";
            // the feature's default colour (most have a colour parameter)
            let colour = info
                .parameters
                .iter()
                .find(|p| p.get("name").and_then(|n| n.as_str()) == Some("color"))
                .and_then(|p| p.get("default").and_then(|d| d.as_str()))
                .and_then(|name| FEATURE_COLOURS.iter().find(|(n, _)| *n == name))
                .map_or(if info.id.starts_with("tree") { 0x3d6b45 } else { 0xb8bec8 }, |(_, hex)| *hex);
            // re-key the meshes so they read well and can't clash
            let mut meshes = IndexMap::new();
            for (i, part) in c.object.parts.iter_mut().enumerate() {
                let key = format!("Features/{}/{}", info.id, i);
                meshes.insert(key.clone(), c.meshes.swap_remove(&part.mesh).unwrap());
                part.mesh = key;
                part.materials = vec![colour_material(colour)];
            }
            let surface = if props { SurfaceType::Generic } else { SurfaceType::Jib };
            c.object.surface_type = surface;
            c.object.colliders = c
                .object
                .parts
                .iter()
                .map(|p| Collider {
                    shape: ColliderShape::Mesh,
                    surface_type: surface,
                    local_position: Vec3::ZERO,
                    local_rotation: Vec3::ZERO,
                    local_scale: Vec3::ONE,
                    center: Vec3::ZERO,
                    size: Vec3::ONE,
                    radius: 0.5,
                    height: 1.0,
                    direction: 1,
                    mesh_ref: p.mesh.clone(),
                })
                .collect();
            save_object(&out_root.join(folder), &title(&info.id), c.object, meshes, IndexMap::new())?;
        }

        for (name, hex) in FEATURE_COLOURS {
            save_material(&out_root.join("Features").join("Colours"), &title(name), colour_material(*hex), IndexMap::new())?;
        }
        Ok(())
    }

    /// (Re)makes the app's library folder, `library/Library`, from the placeholder models. Run with
    /// `cargo test --release make_app_library -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn make_app_library() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("library");
        let out = root.join("Library");
        std::fs::remove_dir_all(out.join("Features")).ok();
        build_features(&root.join("placeholders"), &out).unwrap();
        println!("{} entries", list(&out).len());
    }

    #[test]
    fn the_app_library_lists() {
        let out = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("library").join("Library");
        let items = list(&out);
        assert!(items.iter().filter(|i| i.info.kind == Kind::Mesh).count() > 90, "{} entries", items.len());
        assert!(items.iter().any(|i| i.folder == "Features/Rails"));
        assert!(items.iter().any(|i| i.info.kind == Kind::Material && i.folder == "Features/Colours"));
    }
}

#[cfg(test)]
mod map_trees_test {
    /// A map with trees built from its own meshes (MLNZ Park, from Downloads) added to a scratch library: each kind of
    /// tree is a piece there.
    #[test]
    #[ignore]
    fn adds_a_maps_own_trees() {
        let map = dirs_map();
        let data = std::env::temp_dir().join("jibbers-map-trees-test");
        std::fs::remove_dir_all(&data).ok();
        std::env::set_var("JIBBERS_STUDIO_DATA", &data);
        let (dir, n) = super::add_map(&map).unwrap();
        let trees: Vec<String> = std::fs::read_dir(dir.join("Trees")).map(|r| r.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect()).unwrap_or_default();
        eprintln!("{n} pieces; trees: {trees:?}");
        assert!(trees.len() >= 5);
    }

    fn dirs_map() -> std::path::PathBuf {
        std::path::PathBuf::from(std::env::var("USERPROFILE").unwrap()).join("Downloads").join("MLNZ Park.jbrmap")
    }
}
