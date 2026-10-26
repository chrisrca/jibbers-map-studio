//! Pieces and materials written into the library (one file each, a free name found), and deleted.

use super::*;

/// A file name Windows accepts for `name`.
pub(crate) fn file_name(name: &str) -> String {
    let s: String = name.chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c }).collect();
    let s = s.trim().trim_end_matches('.').trim().to_string();
    if s.is_empty() { "Piece".into() } else { s }
}

/// `dir/<name>.<ext>`, or `<name> 2`, `<name> 3`… when that's taken.
pub(crate) fn free_path(dir: &Path, name: &str, ext: &str) -> PathBuf {
    let base = file_name(name);
    let mut p = dir.join(format!("{base}.{ext}"));
    let mut n = 2;
    while p.exists() {
        p = dir.join(format!("{base} {n}.{ext}"));
        n += 1;
    }
    p
}

pub(crate) fn save_entry(path: &Path, name: &str, obj: CustomObject, meshes: IndexMap<String, MeshData>, textures: IndexMap<String, TextureData>) -> Result<()> {
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d)?;
    }
    let map = MapData {
        id: path.file_stem().unwrap_or_default().to_string_lossy().into(),
        name: name.into(),
        chunks: vec![Chunk { custom_objects: vec![obj], terrain_data: None, ..Chunk::default() }],
        mesh_library: meshes,
        texture_library: textures,
        ..MapData::default()
    };
    crate::jbrmap::save(&map, path)
}

/// Saves a piece into `dir` as `<name>.jbrasset` (a free name); returns its path.
pub fn save_object(dir: &Path, name: &str, obj: CustomObject, meshes: IndexMap<String, MeshData>, textures: IndexMap<String, TextureData>) -> Result<PathBuf> {
    let path = free_path(dir, name, OBJECT_EXT);
    save_entry(&path, name, obj, meshes, textures)?;
    Ok(path)
}

/// Saves an object over one of your library's entries (the Assets workspace's Save); returns its path.
pub fn save_object_over(path: &Path, name: &str, obj: CustomObject, meshes: IndexMap<String, MeshData>, textures: IndexMap<String, TextureData>) -> Result<PathBuf> {
    let root = user_root()?.canonicalize()?;
    let p = path.canonicalize().with_context(|| format!("{} isn't there", path.display()))?;
    anyhow::ensure!(p.starts_with(&root) && kind_of(&p).is_some(), "not in your library");
    save_entry(&p, name, obj, meshes, textures)?;
    Ok(path.to_path_buf())
}

/// Saves a material into `dir` as `<name>.jbrmat` (a free name); returns its path.
pub fn save_material(dir: &Path, name: &str, mat: Material, textures: IndexMap<String, TextureData>) -> Result<PathBuf> {
    let path = free_path(dir, name, MATERIAL_EXT);
    let obj = CustomObject { parts: vec![Part { mesh: String::new(), materials: vec![mat], ..Part::default() }], ..CustomObject::default() };
    save_entry(&path, name, obj, IndexMap::new(), textures)?;
    Ok(path)
}

/// Removes an entry from your library (nothing outside it).
pub fn delete(path: &Path) -> Result<()> {
    let root = user_root()?.canonicalize()?;
    let p = path.canonicalize().with_context(|| format!("{} isn't there", path.display()))?;
    anyhow::ensure!(p.starts_with(&root) && kind_of(&p).is_some(), "not in your library");
    std::fs::remove_file(&p)?;
    Ok(())
}

/// Mesh and texture keys an object needs.
pub(crate) fn uses(obj: &CustomObject) -> (HashSet<String>, HashSet<String>) {
    let mut meshes = HashSet::new();
    let mut textures = HashSet::new();
    for p in &obj.parts {
        if !p.mesh.is_empty() {
            meshes.insert(p.mesh.clone());
        }
        for m in &p.materials {
            textures.extend(material_textures(m));
        }
    }
    for c in &obj.colliders {
        if !c.mesh_ref.is_empty() {
            meshes.insert(c.mesh_ref.clone());
        }
    }
    (meshes, textures)
}

pub(crate) fn material_textures(m: &Material) -> impl Iterator<Item = String> + '_ {
    [&m.base_tex, &m.metallic_tex, &m.roughness_tex, &m.normal_tex, &m.emission_tex].into_iter().filter(|t| !t.is_empty()).cloned()
}
