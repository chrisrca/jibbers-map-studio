//! Your materials: images made into materials, materials saved from a project, and put into one.

use super::*;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MaterialInfo {
    pub path: String,
    pub name: String,
    pub material: Material,
}

pub(crate) fn material_of(obj: &CustomObject) -> Option<Material> {
    obj.parts.first()?.materials.first().cloned()
}

/// The personal materials, newest first.
pub fn list_materials() -> Result<Vec<MaterialInfo>> {
    let mut out = vec![];
    for e in std::fs::read_dir(materials_dir()?)?.flatten() {
        let p = e.path();
        if super::super::kind_of(&p) == Some(super::super::Kind::Material) {
            let Ok(map) = crate::jbrmap::load(&p) else { continue };
            let Some(mat) = map.chunks.first().and_then(|c| c.custom_objects.first()).and_then(material_of) else { continue };
            out.push((e.metadata().and_then(|m| m.modified()).ok(), MaterialInfo { path: p.display().to_string(), name: map.name, material: mat }));
        }
    }
    out.sort_by_key(|x| std::cmp::Reverse(x.0));
    Ok(out.into_iter().map(|(_, i)| i).collect())
}

pub(crate) fn save_material(name: &str, mat: Material, textures: IndexMap<String, TextureData>) -> Result<MaterialInfo> {
    let path = super::super::save_material(&materials_dir()?, name, mat.clone(), textures)?;
    Ok(MaterialInfo { path: path.display().to_string(), name: name.into(), material: mat })
}

/// A new material from an image file (it becomes the base texture).
pub fn import_material_image(file: &Path) -> Result<MaterialInfo> {
    let name = file.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Material".into());
    let img = image::open(file).with_context(|| format!("read {}", file.display()))?.to_rgba8();
    let mut b = Builder::new(&name);
    let key = b.texture("image", &name, img)?;
    let mat = Material { base_tex: key, smoothness: 0.2, ..Material::default() };
    save_material(&name, mat, b.textures)
}

/// Copies the textures `mat` uses from a project library into a personal material.
pub fn save_material_from_project(project_dir: &Path, library_rel: &str, mat: Material, name: &str) -> Result<MaterialInfo> {
    let lib = crate::jbrmap::load(project_dir.join(library_rel))?;
    let mut textures = IndexMap::new();
    for t in [&mat.base_tex, &mat.metallic_tex, &mat.roughness_tex, &mat.normal_tex, &mat.emission_tex] {
        if let Some(tex) = lib.texture_library.get(t) {
            textures.insert(t.clone(), tex.clone());
        }
    }
    save_material(name, mat, textures)
}

/// An image as a texture in the project's library (for a material's slot); returns its key. `linear` for data rather
/// than colour (normal, metallic and roughness maps).
pub fn add_texture_to_project(project_dir: &Path, file: &Path, linear: bool) -> Result<String> {
    let name = file.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Texture".into());
    let img = image::open(file).with_context(|| format!("read {}", file.display()))?.to_rgba8();
    let mut b = Builder::new(&name);
    let key = b.texture("image", &name, img)?;
    for t in b.textures.values_mut() {
        t.linear = linear;
    }
    merge_into_project(project_dir, IndexMap::new(), b.textures)?;
    Ok(key)
}

/// Copies a personal material's textures into the project library; returns the material to assign.
pub fn add_material_to_project(project_dir: &Path, material: &Path) -> Result<(Material, String)> {
    let entry = crate::jbrmap::load(material)?;
    let mat = entry.chunks.first().and_then(|c| c.custom_objects.first()).and_then(super::super::material_of).context("not a material")?;
    merge_into_project(project_dir, IndexMap::new(), entry.texture_library)?;
    Ok((mat, PROJECT_LIBRARY.into()))
}
