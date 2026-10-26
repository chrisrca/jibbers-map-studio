//! The game's own look for its official features, read from the player's Jibbers install (Jibbers_Data/
//! resources.assets) by the app itself, on any machine: each feature (placeholders.json's ids) is a prefab there —
//! renderers with the game's meshes (which have texture coordinates) and materials on the game's shaders (painted
//! colour, metallic, normal and roughness textures plus a few numbers). Written to `<studio data>\game-look`, which
//! gamelook/features.rs dresses the app's pieces in:
//!
//!   index.json         {"version", "source", "features": {id: [renderer…]}}; a renderer is {"mesh", "meshName",
//!                      "vertexCount", "submeshes" (index counts), "matrix" (16, column-major, in the prefab's frame,
//!                      Unity space), "materials": […] (each its maps, numbers and shader; a glowing one its
//!                      "emit" map and "emissionColor"), "variant" (a setting's option it's drawn for, or none),
//!                      "spin" (a wheel the game turns as the lift runs: {"pivot", "axis" in the mesh's own space,
//!                      "cycles": whole turns per 1000 m of cable, signed}; each wheel a renderer of its own)}
//!   meshes/<id>.bin    positions f32x3, normals f32x3, uvs f32x2 per vertex, then each submesh's u32 indices
//!   meshes/<id>.tan    tangents f32x4 per vertex
//!   textures/<id>.png  at most 1024 a side
//!
//! Only what the game draws up close: renderers on objects switched on (with every parent), not a LOD group's lower
//! levels, and of each mesh its most detailed level. A feature whose setting picks one of several children (the
//! snow cannon's direction: MeshDown, MeshFlat…) has each of those renderers tagged with its option.
//!
//! A feature's lights (a floodlight's lamps, a snow cannon's) beside it in `lights`: {id: [light…]}, a light being
//! {"type" (Unity's: 0 spot, 1 directional, 2 point), "color", "intensity", "range", "spotAngle", "innerSpotAngle",
//! "matrix" (in the prefab's frame, as a renderer's), "variant"}.
//!
//! A lift is pieces put along its line, each its own entry: `<id>:base`, `<id>:top`, `<id>:mast` (its prefab's
//! templates, switched off in it, each in its own frame) and `<id>:carrier` (the chair or hanger the cable carries,
//! a prefab of its own).
//! Read again when the game's file changes (an update), or when what's read here does (VERSION).

pub mod dxbc;
pub mod features;
pub mod icon;
pub mod sky;
pub mod terrain;
pub mod unityfile;
mod scene;
mod reader;
mod texture;
pub(crate) use scene::*;
pub(crate) use reader::*;
pub(crate) use texture::*;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use image::{imageops::FilterType, DynamicImage, RgbImage, RgbaImage};
use serde::Deserialize;
use serde_json::{json, Value};

use unityfile::{At, Game, V};

/// Bump when what's read changes: the look is read again.
pub const VERSION: u32 = 11;
const MAX_TEX: u32 = 1024;
const GAME_FILES: [&str; 2] = ["resources.assets", "globalgamemanagers.assets"];

const GAME_OBJECT: i32 = 1;
const TRANSFORM: i32 = 4;
const MESH_RENDERER: i32 = 23;
const MESH_FILTER: i32 = 33;
const LOD_GROUP: i32 = 205;
const LIGHT: i32 = 108;

/// A lift's pieces: (the entry's part, the template's name in its prefab).
const LIFT_PARTS: [(&str, &str); 3] = [("base", "BaseStation"), ("top", "TopStation"), ("mast", "MastTemplate")];
/// What each lift's cable carries: (the lift, the carrier's prefab).
const LIFT_CARRIERS: [(&str, &str); 2] = [("chairlift", "chairlift_chair"), ("tbar", "tbar_hanger")];

/// The game's data folder (beside Jibbers.exe), when the game is installed.
pub fn data_dir() -> Option<PathBuf> {
    let exe = crate::game::find_game()?;
    let d = exe.parent()?.join("Jibbers_Data");
    d.join(GAME_FILES[0]).exists().then_some(d)
}

/// The game's file as read last (size and date): read again when it's changed.
fn source_stamp(data: &Path) -> Result<String> {
    let m = std::fs::metadata(data.join(GAME_FILES[0]))?;
    Ok(format!("{} {}", m.len(), m.modified()?.duration_since(std::time::UNIX_EPOCH)?.as_secs()))
}

/// The game's look read into `out` when it isn't there yet, is from an older reading, or the game has changed since.
/// Whether it's there (false: no game installed, or it couldn't be read).
pub fn ensure(out: &Path, placeholders_json: &Path) -> Result<bool> {
    // (one reading at a time: the asset list and the map's objects both ask for it)
    static ONE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _one = ONE.lock().unwrap_or_else(|e| e.into_inner());
    let Some(data) = data_dir() else {
        return Ok(out.join("index.json").exists());
    };
    let stamp = source_stamp(&data)?;
    let current = std::fs::read(out.join("index.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .is_some_and(|v| v["version"] == json!(VERSION) && v["source"] == json!(stamp));
    if current {
        return Ok(true);
    }
    let t0 = std::time::Instant::now();
    // written beside it, then swapped in (never half a reading)
    let tmp = out.with_extension("reading");
    std::fs::remove_dir_all(&tmp).ok();
    let n = read_look(&data, &tmp, placeholders_json, &stamp)?;
    // the game's sky beside it (none when it can't be read: the view keeps its own)
    if let Err(e) = sky::write(&data, &tmp) {
        eprintln!("game sky not read: {e:#}");
    }
    // and its snow (none: the view keeps its own)
    if let Err(e) = terrain::write(&data, &tmp) {
        eprintln!("game snow not read: {e:#}");
    }
    std::fs::remove_dir_all(out).ok();
    std::fs::rename(&tmp, out)?;
    eprintln!("game look: {n} features read in {:.1} s", t0.elapsed().as_secs_f32());
    Ok(true)
}

#[derive(Deserialize)]
struct Placeholder {
    id: String,
    #[serde(default)]
    parameters: Vec<Value>,
}

/// Lower case letters and digits only (names compared loosely).
fn loose(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_lowercase()).collect()
}

fn read_look(data: &Path, out: &Path, placeholders_json: &Path, stamp: &str) -> Result<usize> {
    let g = Game::open(data, &GAME_FILES)?;
    if !g.layouts_match() {
        eprintln!("game look: the game's Unity is {}, the app's layouts are for another: reading anyway", g.files[0].unity_version);
    }
    let infos: Vec<Placeholder> = serde_json::from_slice(&std::fs::read(placeholders_json)?)?;
    let mut ids: HashSet<&str> = infos.iter().map(|i| i.id.as_str()).collect();
    ids.extend(LIFT_CARRIERS.iter().map(|(_, c)| *c));
    std::fs::create_dir_all(out.join("meshes"))?;
    std::fs::create_dir_all(out.join("textures"))?;

    // each feature's prefab: the GameObject of that name with no parent
    let mut roots: HashMap<String, At> = HashMap::new();
    for o in &g.files[0].objects {
        if o.class != GAME_OBJECT {
            continue;
        }
        let at = At { file: 0, path: o.path_id };
        let go = g.read(at)?;
        let name = go.get("m_Name").s();
        if !ids.contains(name) || roots.contains_key(name) {
            continue;
        }
        if let Some(t) = component(&g, at, &go, TRANSFORM) {
            if g.read(t)?.get("m_Father").pptr().is_null() {
                roots.insert(name.to_string(), at);
            }
        }
    }

    let mut rd = Reader { g: &g, out: out.to_path_buf(), meshes: HashMap::new(), textures: HashMap::new(), linear: HashMap::new(), jobs: vec![], lights: vec![] };
    let mut features = serde_json::Map::new();
    let mut lights = serde_json::Map::new();
    let mut ids_sorted: Vec<_> = roots.keys().cloned().collect();
    ids_sorted.sort();
    for id in ids_sorted {
        let root = roots[&id];
        if let Some((lift, _)) = LIFT_CARRIERS.iter().find(|(_, c)| *c == id) {
            rd.whole(root, &format!("{lift}:carrier"), &mut features)?;
            continue;
        }
        // a lift: each of its templates (switched off, as the game copies them along the line) in its own frame
        let templates = lift_templates(&g, root)?;
        if !templates.is_empty() {
            for (part, at) in templates {
                rd.whole(at, &format!("{id}:{part}"), &mut features)?;
            }
            continue;
        }
        // a setting whose options each name a child: those children are its variants (only the chosen one is drawn)
        let mut names = vec![];
        all_names(&g, root, &mut names)?;
        let info = infos.iter().find(|i| i.id == id);
        let mut variant_opts: Vec<(String, String)> = vec![];
        for p in info.map(|i| i.parameters.as_slice()).unwrap_or(&[]) {
            if p["type"] != "selection" {
                continue;
            }
            let opts: Vec<String> = p["options"].as_array().map(|a| a.iter().filter_map(|o| o.as_str().map(str::to_string)).collect()).unwrap_or_default();
            let named: Vec<&String> = opts.iter().filter(|o| !loose(o).is_empty() && names.iter().any(|n| loose(n).contains(&loose(o)))).collect();
            if named.len() >= 2 {
                for o in named {
                    variant_opts.push((p["name"].as_str().unwrap_or_default().to_string(), o.clone()));
                }
            }
        }
        let mut skip = HashSet::new();
        lower_lods(&g, root, &mut skip)?;
        let mut renderers = vec![];
        rd.walk(root, None, &skip, &variant_opts, None, &mut renderers)?;
        if !rd.lights.is_empty() {
            lights.insert(id.clone(), Value::Array(std::mem::take(&mut rd.lights)));
        }
        if !renderers.is_empty() {
            features.insert(id, Value::Array(renderers));
        }
    }
    // the textures, decoded and written side by side
    use rayon::prelude::*;
    rd.jobs.par_iter().try_for_each(|(at, normal, file)| -> Result<()> {
        let t = g.read(*at)?;
        let Some(img) = decode_texture(&g, &t)? else { return Ok(()) };
        let mut img = DynamicImage::ImageRgba8(img);
        if img.width() > MAX_TEX || img.height() > MAX_TEX {
            img = img.resize(MAX_TEX, MAX_TEX, FilterType::Triangle);
        }
        let img = if *normal { DynamicImage::ImageRgb8(unpack_normal(&img.to_rgba8())) } else { img };
        img.save(out.join(file))?;
        Ok(())
    })?;
    let n = features.len();
    let index = json!({ "version": VERSION, "source": stamp, "features": features, "lights": lights });
    std::fs::write(out.join("index.json"), serde_json::to_vec_pretty(&index)?)?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reads the installed game's look into a scratch folder and compares it with the one the studio has (made by
    /// the earlier Python reader, or an earlier run): the same features, renderers, vertex counts and maps.
    #[test]
    #[ignore]
    fn reads_the_installed_game() {
        let data = data_dir().expect("the game isn't installed");
        let out = std::env::temp_dir().join("jibbers-game-look-test");
        std::fs::remove_dir_all(&out).ok();
        let placeholders = Path::new(env!("CARGO_MANIFEST_DIR")).join("../library/placeholders/placeholders.json");
        let t0 = std::time::Instant::now();
        let n = read_look(&data, &out, &placeholders, "test").unwrap();
        eprintln!("{n} features in {:.1} s", t0.elapsed().as_secs_f32());
        let mine: Value = serde_json::from_slice(&std::fs::read(out.join("index.json")).unwrap()).unwrap();
        let theirs_dir = crate::library::userassets::data_dir().unwrap().join("game-look");
        let Ok(b) = std::fs::read(theirs_dir.join("index.json")) else { return };
        let theirs: Value = serde_json::from_slice(&b).unwrap();
        let (a, b) = (mine["features"].as_object().unwrap(), theirs["features"].as_object().unwrap());
        let mut diff = 0;
        for (id, rs) in b {
            let Some(mr) = a.get(id) else {
                eprintln!("{id}: missing");
                diff += 1;
                continue;
            };
            let count = |v: &Value| v.as_array().unwrap().iter().map(|r| (r["meshName"].as_str().unwrap().to_string(), r["vertexCount"].as_u64().unwrap(), r["submeshes"].clone(), r["materials"].as_array().unwrap().iter().map(|m| (m["base"].is_string(), m["normal"].is_string(), m["shader"].as_str().unwrap_or("").to_string())).collect::<Vec<_>>())).collect::<Vec<_>>();
            if count(mr) != count(rs) {
                eprintln!("{id}: mine {:?}
   theirs {:?}", count(mr), count(rs));
                diff += 1;
            }
        }
        eprintln!("{} features compared, {diff} different", b.len());
        assert_eq!(diff, 0);
    }
}
