//! Projects: found, opened, saved, made new, exported to a .jbrmap, and what's put into them (scenery, meshes, textures, pieces copied between them).

use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use crate::{game, library, project};
use super::{err, CmdResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectListing {
    dir: String,
    map_id: String,
    name: String,
    /// the game map it was imported from, when that's not its own
    source_map_id: Option<String>,
}

/// The studio projects (`*.jbrproj` with a project.json) directly inside `root`.
#[tauri::command]
pub async fn find_projects(root: String) -> Vec<ProjectListing> {
    tauri::async_runtime::spawn_blocking(move || {
        #[derive(Deserialize)]
        struct Head {
            map: Map,
            #[serde(default)]
            editor: serde_json::Value,
        }
        #[derive(Deserialize)]
        struct Map {
            id: String,
            #[serde(default)]
            name: String,
        }
        let Ok(entries) = std::fs::read_dir(&root) else { return vec![] };
        entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("jbrproj")))
            .filter_map(|e| {
                let f = std::fs::File::open(e.path().join("project.json")).ok()?;
                let h: Head = serde_json::from_reader(std::io::BufReader::new(f)).ok()?;
                Some(ProjectListing {
                    dir: e.path().display().to_string(),
                    map_id: h.map.id,
                    name: h.map.name,
                    source_map_id: h.editor.get("sourceMapId").and_then(|v| v.as_str()).map(str::to_owned),
                })
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn load_project(dir: String) -> CmdResult<project::Project> {
    tauri::async_runtime::spawn_blocking(move || project::load(&PathBuf::from(dir)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

#[tauri::command]
pub async fn save_project(dir: String, project: project::Project) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || project::save(&PathBuf::from(dir), &project))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

#[tauri::command]
pub async fn import_jbrmap(map_path: String, project_dir: String) -> CmdResult<project::Project> {
    tauri::async_runtime::spawn_blocking(move || project::import_jbrmap(&PathBuf::from(map_path), &PathBuf::from(project_dir)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    path: String,
    bytes: u64,
    chunks: usize,
    objects: usize,
    spawns: usize,
    fixed_scales: usize,
    fixed_colliders: usize,
}

/// Export to an explicit path, or to the game's maps folder as `<id>.jbrmap` when `out_path` is None.
#[tauri::command]
pub async fn export_project(project_dir: String, out_path: Option<String>) -> CmdResult<ExportResult> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<ExportResult> {
        let dir = PathBuf::from(&project_dir);
        let out = match out_path {
            Some(p) => PathBuf::from(p),
            None => {
                let p = project::load(&dir)?;
                game::maps_dir()?.join(format!("{}.jbrmap", p.map.id))
            }
        };
        let s = project::export(&dir, &out)?;
        Ok(ExportResult {
            path: out.display().to_string(),
            bytes: s.bytes,
            chunks: s.chunks,
            objects: s.objects,
            spawns: s.spawns,
            fixed_scales: s.fixed_scales,
            fixed_colliders: s.fixed_colliders,
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// Generates a new map's terrain in parallel and writes a complete project folder.
#[tauri::command]
pub async fn generate_project(dir: String, name: String, id: String, options: crate::project::generate::GenOptions) -> CmdResult<project::Project> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<project::Project> {
        let dir = PathBuf::from(dir);
        let chunks = crate::project::generate::generate(&options);
        std::fs::create_dir_all(dir.join("heights"))?;
        use rayon::prelude::*;
        chunks
            .par_iter()
            .map(|c| project::write_f32(&dir.join(format!("heights/{}.f32", c.key)), &c.heights))
            .collect::<anyhow::Result<()>>()?;

        // first spawn near the top of the centre chunk, facing downhill (+Z)
        let c = &chunks[0];
        let (cx, cz) = (c.position[0] + c.size[0] / 2.0, c.position[2] + c.size[2] * 0.12);
        let n = c.res as usize;
        let sp = c.size[0] / (c.res - 1) as f32;
        let (i, j) = (((cx - c.position[0]) / sp).round() as usize, ((cz - c.position[2]) / sp).round() as usize);
        let h = c.heights[j.min(n - 1) * n + i.min(n - 1)] + c.position[1];

        let p = project::Project {
            format: project::FORMAT.into(),
            version: 1,
            map: project::MapSettings {
                id,
                name,
                cam_start: [cx, h + 25.0, cz - 30.0],
                allow_background_mountains: true,
                override_time: false,
                day_time: 1.0,
                day_time_hours: -1.0,
                sun_angle: 0.0,
                mod_version: "1.0".into(),
                author: String::new(),
                remix_authors: String::new(),
                remix_ids: String::new(),
                scale: 1.0,
            },
            chunks: chunks
                .iter()
                .map(|c| project::ChunkEntry {
                    key: c.key.clone(),
                    position: c.position,
                    size: c.size,
                    resolution: c.res,
                    heights: format!("heights/{}.f32", c.key),
                    snow_mask: None,
                    snow_mask_4_channel: false,
                    snow_mask_2: None,
                    tree_prototypes: vec![],
                    repeats: 1,
                    repeat_offset: [0.0; 3],
                })
                .collect(),
            objects: vec![],
            // as working maps have them: ~1.2 m up, tipped forward to the slope, moving down it (+Z)
            spawns: vec![{
                let at = |z: f32| {
                    let jj = (((z - c.position[2]) / sp).round() as usize).min(n - 1);
                    c.heights[jj * n + i.min(n - 1)] + c.position[1]
                };
                let drop = (at(cz - 3.0) - at(cz + 3.0)) / 6.0;
                let pitch = drop.atan();
                project::SpawnEntry {
                    uid: "spawn1".into(),
                    name: "Top".into(),
                    position: [cx, h + 1.2, cz],
                    rotation: [pitch.to_degrees().rem_euclid(360.0), 0.0, 0.0],
                    velocity: [0.0, -pitch.sin() * 10.0, pitch.cos() * 10.0],
                }
            }],
            custom_objects: vec![],
            library: None,
            editor: serde_json::Value::Null,
        };
        project::save(&dir, &p)?;
        Ok(p)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// An untitled map that was never given anything, deleted outright (the studio's own, in its Sessions folder: the
/// Recycle Bin took Windows ten seconds a time sizing up, and held the studio's start). Refuses anything else.
#[tauri::command]
pub async fn remove_empty_session(dir: String) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<()> {
        let sessions = crate::library::userassets::data_dir()?.join("Sessions");
        let p = PathBuf::from(&dir);
        anyhow::ensure!(p.parent() == Some(sessions.as_path()), "not an untitled map: {dir}");
        let pr: project::Project = serde_json::from_slice(&std::fs::read(p.join("project.json"))?)?;
        anyhow::ensure!(pr.chunks.is_empty() && pr.objects.is_empty() && pr.spawns.is_empty() && pr.custom_objects.is_empty(), "it has things in it: {dir}");
        std::fs::remove_dir_all(&p)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// An image as a texture in the project's library (a material's slot); returns its key.
#[tauri::command]
pub async fn add_texture_to_project(project_dir: String, file: String, linear: bool) -> CmdResult<String> {
    tauri::async_runtime::spawn_blocking(move || crate::library::userassets::add_texture_to_project(&PathBuf::from(project_dir), &PathBuf::from(file), linear))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

/// Pasting pieces copied from another map: their meshes and textures come along into this map's library.
#[tauri::command]
pub async fn copy_piece_assets(from_project: String, to_project: String, objects: Vec<crate::jbrmap::CustomObject>) -> CmdResult<String> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<String> {
        let lib = crate::jbrmap::load(PathBuf::from(&from_project).join(crate::library::userassets::PROJECT_LIBRARY))?;
        let (mut meshes, mut textures) = (indexmap::IndexMap::new(), indexmap::IndexMap::new());
        for o in &objects {
            let (m, t) = library::uses(o);
            for k in m {
                if let Some(v) = lib.mesh_library.get(&k) {
                    meshes.insert(k, v.clone());
                }
            }
            for k in t {
                if let Some(v) = lib.texture_library.get(&k) {
                    textures.insert(k, v.clone());
                }
            }
        }
        crate::library::userassets::merge_into_project(&PathBuf::from(&to_project), meshes, textures)?;
        Ok(crate::library::userassets::PROJECT_LIBRARY.into())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// Real-world maps: the land around the play area as one untouchable, always-visible object (see project/scenery.rs).
#[tauri::command]
pub async fn add_scenery(project_dir: String, name: String, strips: Vec<String>, texture: String) -> CmdResult<crate::jbrmap::CustomObject> {
    tauri::async_runtime::spawn_blocking(move || crate::project::scenery::add(&PathBuf::from(project_dir), &name, &strips, &texture))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

/// Paints a real-world map's scenery again with rock from `rock_angle` degrees (see crate::project::scenery::repaint); the texture's key.
#[tauri::command]
pub async fn repaint_scenery(project_dir: String, prefix: String, rock_angle: f32) -> CmdResult<String> {
    tauri::async_runtime::spawn_blocking(move || crate::project::scenery::repaint(&PathBuf::from(project_dir), &prefix, rock_angle))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

#[tauri::command]
pub async fn set_model_meshes(project_dir: String, meshes: Vec<crate::project::models::MeshFile>, textures: Vec<crate::project::models::TextureFile>) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || crate::project::models::set(&PathBuf::from(project_dir), &meshes, &textures))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

/// The play area's terrain as a coarse part of the scenery (see crate::project::scenery::set_inner); the mesh's key.
#[tauri::command]
pub async fn set_scenery_inner(project_dir: String, prefix: String, file: String) -> CmdResult<(String, [u8; 3])> {
    tauri::async_runtime::spawn_blocking(move || crate::project::scenery::set_inner(&PathBuf::from(project_dir), &prefix, &file))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}
