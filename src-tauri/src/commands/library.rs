//! The asset library (the default one and yours): its entries and maps, and its pieces and materials placed.

use std::path::PathBuf;
use serde::Serialize;
use crate::{bootlog, gamelook, library};
use super::assets::{PlacedAsset, PlacedMaterial};
use super::{err, library_dir, CmdResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryPreview {
    index: crate::project::assets::AssetIndex,
    object: crate::jbrmap::CustomObject,
}

/// What a personal library entry (mesh or material) needs to be drawn for its preview.
#[tauri::command]
pub async fn library_entry_preview(path: String) -> CmdResult<EntryPreview> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<EntryPreview> {
        let p = PathBuf::from(path);
        Ok(EntryPreview { index: crate::project::assets::prepare_file(&p)?, object: crate::library::userassets::read_entry(&p)? })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// Your own library (built here from the features plus maps you added), in the app's data folder.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryMap {
    /// its folder in your library
    path: String,
    label: String,
}

/// The maps whose pieces are in your library (a folder each).
#[tauri::command]
pub async fn list_library_maps() -> CmdResult<Vec<LibraryMap>> {
    tauri::async_runtime::spawn_blocking(|| -> anyhow::Result<Vec<LibraryMap>> {
        Ok(library::library_maps()?.into_iter().map(|(dir, m)| LibraryMap { path: dir.display().to_string(), label: m.name }).collect())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// Adds a map's pieces to your library (`path` the map), or takes them out again (`path` its folder there). Returns
/// how many pieces were added.
#[tauri::command]
pub async fn set_library_map(path: String, add: bool) -> CmdResult<usize> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<usize> {
        let p = PathBuf::from(&path);
        if add {
            Ok(library::add_map(&p)?.1)
        } else {
            library::remove_map(&p)?;
            Ok(0)
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// Opens your library's folder in Explorer.
#[tauri::command]
pub fn show_library_folder() -> CmdResult<()> {
    let dir = library::user_root().map_err(err)?;
    std::process::Command::new("explorer").arg(dir).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// One item in the asset browser, whichever library it comes from.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    /// "default:<id>" or "user:<file path>"
    id: String,
    name: String,
    folder: String,
    kind: &'static str,
    /// mesh items: the object (pivot at the origin); personal meshes load theirs on demand
    object: Option<crate::jbrmap::CustomObject>,
    material: Option<crate::jbrmap::Material>,
    size: Option<[f32; 3]>,
}

/// Everything in the asset browser: the app's library (read-only) and yours. An item's folder is where its file is
/// (library/mod.rs).
#[tauri::command]
pub async fn list_library(app: tauri::AppHandle) -> CmdResult<Vec<LibraryEntry>> {
    let app_root = library_dir(&app).join("Library");
    let placeholders = library_dir(&app).join("placeholders").join("placeholders.json");
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<Vec<LibraryEntry>> {
        bootlog::mark("asset library: started");
        if let Err(e) = library::migrate() {
            eprintln!("couldn't move the old library over: {e:#}");
        }
        // the game's own look for its features, read from the player's install (again after a game update)
        if let Err(e) = crate::gamelook::features::look_dir().and_then(|d| gamelook::ensure(&d, &placeholders)) {
            eprintln!("game look: {e:#}");
        }
        bootlog::mark("asset library: the game's look checked");
        // the official features with the game's own look, when it's been read from the game (in place of the app's)
        let game = crate::gamelook::features::ensure(&app_root, &placeholders).unwrap_or_else(|e| {
            eprintln!("game features: {e:#}");
            None
        });
        bootlog::mark("asset library: the game's features checked");
        let mut out = vec![];
        let mut roots = vec![];
        if let Some(g) = &game {
            roots.push((g.clone(), "game"));
        }
        roots.push((app_root.clone(), "app"));
        roots.push((library::user_root()?, "user"));
        for (root, prefix) in roots {
            for it in library::list(&root) {
                // (an app piece the game's look stands in for)
                if prefix == "app" && game.as_ref().is_some_and(|g| it.path.strip_prefix(&app_root).is_ok_and(|rel| g.join(rel).exists())) {
                    continue;
                }
                let kind = match it.info.kind {
                    library::Kind::Mesh => "mesh",
                    library::Kind::Material => "material",
                };
                out.push(LibraryEntry { id: format!("{prefix}:{}", it.path.display()), name: it.name, folder: it.folder, kind, object: None, material: it.info.material, size: it.info.size });
            }
        }
        bootlog::mark(&format!("asset library: {} entries listed", out.len()));
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// Copies a library mesh into the project; returns its object (pivot at the origin) to place.
#[tauri::command]
pub async fn place_library_mesh(project_dir: String, id: String) -> CmdResult<PlacedAsset> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<PlacedAsset> {
        let project = PathBuf::from(project_dir);
        let object = match id.split_once(':') {
            Some(("app" | "game" | "user", path)) => crate::library::userassets::add_to_project(&project, &PathBuf::from(path))?.0,
            _ => anyhow::bail!("unknown library item {id}"),
        };
        Ok(PlacedAsset { object, library: "assets/library.jbrmap".into() })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// A library piece saved over since it was placed: what it uses brought into the project anew; its object.
#[tauri::command]
pub async fn refresh_library_mesh(project_dir: String, id: String) -> CmdResult<PlacedAsset> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<PlacedAsset> {
        let Some(("user", path)) = id.split_once(':') else { anyhow::bail!("not one of your assets: {id}") };
        let object = crate::library::userassets::refresh_in_project(&PathBuf::from(project_dir), &PathBuf::from(path))?;
        Ok(PlacedAsset { object, library: "assets/library.jbrmap".into() })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// Several library pieces copied into the project at once (its library read and written once); their objects.
#[tauri::command]
pub async fn place_library_meshes(project_dir: String, ids: Vec<String>) -> CmdResult<Vec<PlacedAsset>> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<Vec<PlacedAsset>> {
        let paths = ids
            .iter()
            .map(|id| match id.split_once(':') {
                Some(("app" | "game" | "user", path)) => Ok(PathBuf::from(path)),
                _ => Err(anyhow::anyhow!("unknown library item {id}")),
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
        let objects = crate::library::userassets::add_many_to_project(&PathBuf::from(project_dir), &paths)?;
        Ok(objects.into_iter().map(|object| PlacedAsset { object, library: "assets/library.jbrmap".into() }).collect())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// For each of the game's pieces (library ids "game:<path>", with the game-look textures the project's pieces of it
/// use): whether the project holds an older build of its look.
#[tauri::command]
pub async fn stale_game_look(project_dir: String, pieces: Vec<(String, Vec<String>)>) -> CmdResult<Vec<bool>> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<Vec<bool>> {
        let assets: Vec<(PathBuf, Vec<String>)> = pieces.into_iter().map(|(id, used)| (PathBuf::from(id.strip_prefix("game:").unwrap_or(&id)), used)).collect();
        crate::library::userassets::stale_game_look(&PathBuf::from(project_dir), &assets)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// Copies a library material's textures into the project; returns the material to assign.
#[tauri::command]
pub async fn place_library_material(project_dir: String, id: String) -> CmdResult<PlacedMaterial> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<PlacedMaterial> {
        let project = PathBuf::from(project_dir);
        let material = match id.split_once(':') {
            Some(("app" | "game" | "user", path)) => crate::library::userassets::add_material_to_project(&project, &PathBuf::from(path))?.0,
            _ => anyhow::bail!("unknown library item {id}"),
        };
        Ok(PlacedMaterial { material, library: "assets/library.jbrmap".into() })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}
