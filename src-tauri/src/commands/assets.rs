//! Your own assets and materials: imported, listed, saved from a project, put into one.

use std::path::PathBuf;
use serde::Serialize;
use super::{err, CmdResult};

/// Viewport copies of the project's custom-object meshes and textures (built once, then cached).
#[tauri::command]
pub async fn prepare_assets(project_dir: String, library: Option<String>) -> CmdResult<crate::project::assets::AssetIndex> {
    tauri::async_runtime::spawn_blocking(move || crate::project::assets::prepare(&PathBuf::from(project_dir), library))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

#[tauri::command]
pub async fn list_user_assets() -> CmdResult<Vec<crate::library::userassets::AssetInfo>> {
    tauri::async_runtime::spawn_blocking(crate::library::userassets::list).await.map_err(|e| e.to_string())?.map_err(err)
}

/// Imports a GLB/glTF/OBJ file into the personal asset library.
#[tauri::command]
pub async fn import_user_asset(file: String) -> CmdResult<crate::library::userassets::AssetInfo> {
    tauri::async_runtime::spawn_blocking(move || crate::library::userassets::import(&PathBuf::from(file)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacedAsset {
    pub object: crate::jbrmap::CustomObject,
    pub library: String,
}

/// Copies an asset into the project's library; returns its object (at the origin) to place.
#[tauri::command]
pub async fn add_asset_to_project(project_dir: String, asset: String) -> CmdResult<PlacedAsset> {
    tauri::async_runtime::spawn_blocking(move || crate::library::userassets::add_to_project(&PathBuf::from(project_dir), &PathBuf::from(asset)))
        .await
        .map_err(|e| e.to_string())?
        .map(|(object, library)| PlacedAsset { object, library })
        .map_err(err)
}

/// Saves a project's custom object (moved to the origin by the editor) to the personal library.
#[tauri::command]
pub async fn save_custom_as_asset(project_dir: String, library: String, object: crate::jbrmap::CustomObject, name: String, over: Option<String>) -> CmdResult<crate::library::userassets::AssetInfo> {
    tauri::async_runtime::spawn_blocking(move || crate::library::userassets::save_from_project(&PathBuf::from(project_dir), &library, object, &name, over.as_deref().map(std::path::Path::new)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

#[tauri::command]
pub fn delete_user_asset(path: String) -> CmdResult<()> {
    crate::library::userassets::delete(&PathBuf::from(path)).map_err(err)
}

#[tauri::command]
pub async fn list_user_materials() -> CmdResult<Vec<crate::library::userassets::MaterialInfo>> {
    tauri::async_runtime::spawn_blocking(crate::library::userassets::list_materials).await.map_err(|e| e.to_string())?.map_err(err)
}

/// A new personal material from an image file.
#[tauri::command]
pub async fn import_material_image(file: String) -> CmdResult<crate::library::userassets::MaterialInfo> {
    tauri::async_runtime::spawn_blocking(move || crate::library::userassets::import_material_image(&PathBuf::from(file)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

#[tauri::command]
pub async fn save_material_from_project(project_dir: String, library: String, material: crate::jbrmap::Material, name: String) -> CmdResult<crate::library::userassets::MaterialInfo> {
    tauri::async_runtime::spawn_blocking(move || crate::library::userassets::save_material_from_project(&PathBuf::from(project_dir), &library, material, &name))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacedMaterial {
    pub material: crate::jbrmap::Material,
    pub library: String,
}

/// Copies a personal material's textures into the project; returns the material to assign.
#[tauri::command]
pub async fn add_material_to_project(project_dir: String, material: String) -> CmdResult<PlacedMaterial> {
    tauri::async_runtime::spawn_blocking(move || crate::library::userassets::add_material_to_project(&PathBuf::from(project_dir), &PathBuf::from(material)))
        .await
        .map_err(|e| e.to_string())?
        .map(|(material, library)| PlacedMaterial { material, library })
        .map_err(err)
}
