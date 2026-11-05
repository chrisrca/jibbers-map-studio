//! Maps made in Unity with the official Map-Tools, imported straight from the project: its scene read as Map-Tools'
//! exporter reads it ( terrain, objects, spawns, custom pieces ), and what the exporter leaves out ( the terrain's
//! inserts, formations, ski lines ) made the studio's own.

mod binary;
mod common;
mod custom;
mod fbx;
pub mod export;
pub mod files;
pub mod math;
pub mod mesh;
pub mod model;
pub mod scene;
mod shader;
pub mod texture;
pub mod value;
mod yaml;

mod tools;

#[cfg(test)]
mod tests;

use std::path::Path;

use anyhow::Result;

/// A Unity scene made a new project folder: the map as Map-Tools would export it, the inserts and formations as the
/// studio's shapes; and what was kept as it is or left out.
pub fn import(scene_path: &Path, dir: &Path) -> Result<(crate::project::Project, Vec<String>)> {
    let project = files::UnityProject::open(scene_path)?;
    let s = scene::open(&project, scene_path)?;
    let (map, mut notes) = export::map_of(&s)?;
    let (shapes, patches) = tools::shapes(&s, &mut notes);
    let mut editor = serde_json::json!({ "shapes": shapes, "shapePatches": patches.iter().map(|(u, _)| u.clone()).collect::<Vec<_>>() });
    if let Some(t) = tools::trails(&s, &mut notes) {
        editor["trails"] = t;
    }
    let p = crate::project::import_map(&map, editor, dir)?;
    // ( each formation's change in the ground, so an edit takes it out before putting the new one in )
    for (uid, bytes) in &patches {
        std::fs::create_dir_all(dir.join("shapes"))?;
        std::fs::write(dir.join("shapes").join(format!("{uid}.bin")), bytes)?;
    }
    Ok((p, notes))
}
