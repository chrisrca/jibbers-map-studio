//! Your own pieces and materials: models you import (GLB/glTF/OBJ with textures), images made into materials, and
//! pieces or materials saved from a map — kept in your library's `My imports` folder (see library/mod.rs) and usable in
//! every project.
//!
//! An asset file is an ordinary .jbrmap holding one custom object (at the origin) plus the meshes and textures it
//! uses, so the game-side data model is reused as-is. Placing an asset copies those meshes/textures into the
//! project's library and hands the object to the editor.

mod import;
mod projects;
mod materials;
pub(crate) use import::*;
pub(crate) use projects::*;
pub(crate) use materials::*;

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use indexmap::IndexMap;
use crate::jbrmap::{Collider, ColliderShape, Color, CustomObject, MapData, Material, MeshData, Part, SurfaceType, TextureData, Vec2, Vec3};
use rayon::prelude::*;
use serde::Serialize;

/// Longest texture side kept on import (the game re-compresses on load; 2K is plenty for map pieces).
const MAX_TEXTURE: u32 = 2048;

/// `%APPDATA%\Jibbers Studio`, or `JIBBERS_STUDIO_DATA` when set (the self-test uses a scratch folder so it never
/// touches the real personal library).
pub fn data_dir() -> Result<PathBuf> {
    if let Some(d) = std::env::var_os("JIBBERS_STUDIO_DATA").filter(|d| !d.is_empty()) {
        return Ok(PathBuf::from(d));
    }
    Ok(PathBuf::from(std::env::var("APPDATA").context("APPDATA not set")?).join("Jibbers Studio"))
}

/// Where your imports go (pieces and materials alike).
pub fn library_dir() -> Result<PathBuf> {
    let d = super::user_root()?.join(super::IMPORTS);
    std::fs::create_dir_all(&d)?;
    Ok(d)
}

pub fn materials_dir() -> Result<PathBuf> {
    library_dir()
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AssetInfo {
    pub path: String,
    pub name: String,
    pub parts: usize,
    pub textures: usize,
    /// bounding box size in metres (x, y, z)
    pub size: [f32; 3],
    pub surface_type: SurfaceType,
}

fn info(path: &Path, map: &MapData) -> Option<AssetInfo> {
    let obj = map.chunks.first()?.custom_objects.first()?;
    let (lo, hi) = bounds(map, obj);
    Some(AssetInfo {
        path: path.display().to_string(),
        name: map.name.clone(),
        parts: obj.parts.len(),
        textures: map.texture_library.len(),
        size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]],
        surface_type: obj.surface_type,
    })
}

/// Everything in the personal library, newest first.
pub fn list() -> Result<Vec<AssetInfo>> {
    let mut out = vec![];
    for e in std::fs::read_dir(library_dir()?)?.flatten() {
        let p = e.path();
        if super::kind_of(&p) == Some(super::Kind::Mesh) {
            match crate::jbrmap::load(&p) {
                Ok(m) => out.extend(info(&p, &m).map(|i| (e.metadata().and_then(|m| m.modified()).ok(), i))),
                Err(err) => eprintln!("skipping asset {}: {err:#}", p.display()),
            }
        }
    }
    out.sort_by_key(|x| std::cmp::Reverse(x.0));
    Ok(out.into_iter().map(|(_, i)| i).collect())
}

/// Lower-case words joined by dashes (keys inside a piece's file).
fn slug(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let s = s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if s.is_empty() { "asset".into() } else { s }
}

fn save_asset(name: &str, obj: CustomObject, meshes: IndexMap<String, MeshData>, textures: IndexMap<String, TextureData>) -> Result<AssetInfo> {
    let path = super::save_object(&library_dir()?, name, obj, meshes, textures)?;
    let map = crate::jbrmap::load(&path)?;
    info(&path, &map).context("asset has no object")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A map holding an older build of the game's look takes the newer one; its own meshes stay as they are.
    #[test]
    fn a_maps_copy_of_the_game_look_gives_way_to_a_newer_build() {
        let dir = std::env::temp_dir().join(format!("studio-gamelook-test-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        let mesh = |n: i32| MeshData { vertex_count: n, ..MeshData::default() };
        let tex = |w: i32| TextureData { format: 4, width: w, height: 1, encoding: "png".into(), linear: true, mipmaps: false, compression: 0, data: Some(vec![w as u8]) };
        let meshes = |game: i32, own: i32| IndexMap::from([("Features/rail_long/g0".to_string(), mesh(game)), ("Mine/rail".to_string(), mesh(own))]);
        merge_into_project(&dir, meshes(10, 1), IndexMap::from([("GameLook/a".to_string(), tex(1))])).unwrap();

        // the newer build, as a library piece
        let asset = dir.join("piece.jbrasset");
        let piece = MapData { mesh_library: meshes(20, 2), texture_library: IndexMap::from([("GameLook/a".to_string(), tex(1)), ("GameLook/a-x30".to_string(), tex(2))]), ..MapData::default() };
        crate::jbrmap::save(&piece, &asset).unwrap();
        assert_eq!(stale_game_look(&dir, &[(asset.clone(), vec![])]).unwrap(), vec![true]);

        merge_into_project(&dir, piece.mesh_library.clone(), piece.texture_library.clone()).unwrap();
        let lib = crate::jbrmap::load(dir.join(PROJECT_LIBRARY)).unwrap();
        assert_eq!(lib.mesh_library["Features/rail_long/g0"].vertex_count, 20, "the game's mesh is the newer one");
        assert_eq!(lib.mesh_library["Mine/rail"].vertex_count, 1, "the map's own mesh is kept");
        assert!(lib.texture_library.contains_key("GameLook/a-x30"));
        assert_eq!(stale_game_look(&dir, &[(asset.clone(), vec![])]).unwrap(), vec![false]);
        // pieces painted with a texture this build no longer uses (e.g. a metal map it now leaves out)
        assert_eq!(stale_game_look(&dir, &[(asset, vec!["GameLook/old-metal".into(), "Mine/tex".into()])]).unwrap(), vec![true]);
        assert!(from_game_look("Features/c_rail/g12") && !from_game_look("Features/c_rail/0") && !from_game_look("Features/c_rail/gx"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn imports_a_gltf_triangle() {
        // keep test output out of the real personal library
        let data = std::env::temp_dir().join("studio-userasset-test-data");
        unsafe { std::env::set_var("JIBBERS_STUDIO_DATA", &data) };
        // minimal glTF: one triangle, external buffer
        // counter-clockwise seen from +Z, normal +Z (a correct glTF front face)
        let positions: [f32; 9] = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 2.0, 0.0];
        let normals: [f32; 9] = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0];
        let bytes: Vec<u8> = positions.iter().chain(normals.iter()).flat_map(|f| f.to_le_bytes()).collect();
        let tmp = std::env::temp_dir().join("studio-userasset-test");
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(tmp.join("tri.bin"), &bytes).unwrap();
        let gltf = serde_json::json!({
            "asset": { "version": "2.0" },
            "scene": 0, "scenes": [{ "nodes": [0] }],
            "nodes": [{ "mesh": 0, "name": "Tri" }],
            "meshes": [{ "primitives": [{ "attributes": { "POSITION": 0, "NORMAL": 1 } }] }],
            "buffers": [{ "byteLength": 72, "uri": "tri.bin" }],
            "bufferViews": [{ "buffer": 0, "byteLength": 36 }, { "buffer": 0, "byteOffset": 36, "byteLength": 36 }],
            "accessors": [
                { "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3", "min": [0, 0, 0], "max": [1, 2, 0] },
                { "bufferView": 1, "componentType": 5126, "count": 3, "type": "VEC3" },
            ],
        });
        let f = tmp.join("Test Tri.gltf");
        std::fs::write(&f, gltf.to_string()).unwrap();
        let info = import(&f).unwrap();
        assert_eq!(info.parts, 1);
        assert!((info.size[1] - 2.0).abs() < 1e-5, "{:?}", info.size);
        let map = crate::jbrmap::load(&info.path).unwrap();
        let obj = &map.chunks[0].custom_objects[0];
        assert_eq!(obj.colliders.len(), 1);
        // pivot at bottom centre: x spans [-0.5, 0.5], y from 0
        let (lo, hi) = bounds(&map, obj);
        assert!((lo[0] + 0.5).abs() < 1e-5 && (hi[0] - 0.5).abs() < 1e-5 && lo[1].abs() < 1e-5, "{lo:?} {hi:?}");
        // Winding must match the normal the way Melon's (Unity-exported) meshes do: viewed the way the studio's
        // viewer converts them (mirror Z, reverse order → counter-clockwise front), the face points along the normal.
        let mesh = &map.mesh_library[&obj.parts[0].mesh];
        let f = |b: &[u8], i: usize| f32::from_le_bytes(b[i * 4..i * 4 + 4].try_into().unwrap());
        let v = mesh.vertices.as_deref().unwrap();
        let n = mesh.normals.as_deref().unwrap();
        let t = mesh.submeshes[0].as_deref().unwrap();
        let ix: Vec<usize> = (0..3).map(|k| i32::from_le_bytes(t[k * 4..k * 4 + 4].try_into().unwrap()) as usize).collect();
        let p = |i: usize| [f(v, i * 3), f(v, i * 3 + 1), -f(v, i * 3 + 2)];
        let (a, b, c) = (p(ix[0]), p(ix[2]), p(ix[1]));
        let e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let face = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        let normal = [f(n, 0), f(n, 1), -f(n, 2)];
        assert!(face[0] * normal[0] + face[1] * normal[1] + face[2] * normal[2] > 0.0, "inside-out: face {face:?} normal {normal:?}");
        delete(Path::new(&info.path)).unwrap();
    }
}
