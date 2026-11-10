//! Your pieces into a project (their meshes and textures copied into its library) and back out of one, kept up to date
//! with the game's look.

use super::*;
use std::collections::HashSet;

pub(crate) fn bounds(map: &MapData, obj: &CustomObject) -> ([f32; 3], [f32; 3]) {
    let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
    for part in &obj.parts {
        let Some(m) = map.mesh_library.get(&part.mesh) else { continue };
        let s = [part.local_scale.x, part.local_scale.y, part.local_scale.z];
        let o = [part.local_position.x, part.local_position.y, part.local_position.z];
        for p in m.vertices.as_deref().unwrap_or_default().chunks_exact(12) {
            for k in 0..3 {
                let v = f32::from_le_bytes(p[k * 4..k * 4 + 4].try_into().unwrap()) * s[k].abs() + o[k];
                lo[k] = lo[k].min(v);
                hi[k] = hi[k].max(v);
            }
        }
    }
    if lo[0] > hi[0] { ([0.0; 3], [0.0; 3]) } else { (lo, hi) }
}

pub(crate) const PROJECT_LIBRARY: &str = "assets/library.jbrmap";

/// A library bigger than this (an imported map's: hundreds of MB) isn't written again for each piece placed: what's
/// added goes into a small file beside it (`added_path`), read with it (`load_project_library`). Writing the whole of
/// it each time held a placement up seconds.
const BIG_LIBRARY: u64 = 32 << 20;

/// One write to a project's libraries at a time: two at once (a piece placed while a stroke of the Scatter brush was
/// bringing its pieces in) each read it, added theirs, and wrote it back, the one written first lost.
pub(crate) static WRITING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Where what's added to the library `lib` is kept when it's big: `library.jbrmap` → `library.added.jbrmap`.
pub(crate) fn added_path(lib: &Path) -> PathBuf {
    lib.with_extension("added.jbrmap")
}

pub(crate) fn is_big(lib: &Path) -> bool {
    std::fs::metadata(lib).is_ok_and(|m| m.len() > BIG_LIBRARY)
}

/// A project's library as a whole: the file at `lib`, with what's been added beside it in its place where both have it.
pub fn load_project_library(lib: &Path) -> Result<MapData> {
    let mut map = crate::jbrmap::load(lib)?;
    let added = added_path(lib);
    if added.exists() {
        let a = crate::jbrmap::load(&added)?;
        map.mesh_library.extend(a.mesh_library);
        map.texture_library.extend(a.texture_library);
    }
    Ok(map)
}

/// Whether a big library keeps any modelled pieces' meshes or textures itself.
pub(crate) fn has_models(lib: &Path) -> Result<bool> {
    let k = keys_of(lib)?;
    Ok(k.0.iter().chain(&k.1).any(|x| x.starts_with("Models/")))
}

/// A big library's mesh and texture keys ( read once a session for a file as it is, not every time something's
/// placed ).
fn keys_of(lib: &Path) -> Result<std::sync::Arc<(HashSet<String>, HashSet<String>)>> {
    type Keys = std::sync::Arc<(HashSet<String>, HashSet<String>)>;
    static KNOWN: std::sync::Mutex<Option<(PathBuf, String, Keys)>> = std::sync::Mutex::new(None);
    let m = std::fs::metadata(lib)?;
    let stamp = format!("{}-{:?}", m.len(), m.modified()?);
    if let Some((p, s, k)) = KNOWN.lock().unwrap().as_ref() {
        if p == lib && *s == stamp {
            return Ok(k.clone());
        }
    }
    let map = crate::jbrmap::load(lib)?;
    let keys: Keys = std::sync::Arc::new((map.mesh_library.into_keys().collect(), map.texture_library.into_keys().collect()));
    *KNOWN.lock().unwrap() = Some((lib.to_path_buf(), stamp, keys.clone()));
    Ok(keys)
}

/// Copies an asset's meshes/textures into the project's library and returns its object (at the origin) plus the
/// library path to record in the project.
pub fn add_to_project(project_dir: &Path, asset: &Path) -> Result<(CustomObject, String)> {
    let a = crate::jbrmap::load(asset).with_context(|| format!("read asset {}", asset.display()))?;
    let obj = a.chunks.first().and_then(|c| c.custom_objects.first()).cloned().context("asset has no object")?;
    merge_into_project(project_dir, a.mesh_library, a.texture_library)?;
    Ok((obj, PROJECT_LIBRARY.into()))
}

/// Several assets at once: the project's library (which can be hundreds of MB) read and written once, not per asset.
pub fn add_many_to_project(project_dir: &Path, assets: &[PathBuf]) -> Result<Vec<CustomObject>> {
    let loaded: Vec<MapData> = assets
        .par_iter()
        .map(|asset| crate::jbrmap::load(asset).with_context(|| format!("read asset {}", asset.display())))
        .collect::<Result<_>>()?;
    let (mut meshes, mut textures, mut objects) = (IndexMap::new(), IndexMap::new(), vec![]);
    for a in loaded {
        objects.push(a.chunks.first().and_then(|c| c.custom_objects.first()).cloned().context("asset has no object")?);
        meshes.extend(a.mesh_library);
        textures.extend(a.texture_library);
    }
    merge_into_project(project_dir, meshes, textures)?;
    Ok(objects)
}

/// Adds meshes/textures to the project library file (creating it if needed); existing keys are kept, except the
/// game's look (see `from_game_look`), which is replaced by a newer build of it.
pub fn merge_into_project(project_dir: &Path, meshes: IndexMap<String, MeshData>, textures: IndexMap<String, TextureData>) -> Result<()> {
    merge(project_dir, meshes, textures, false)
}

/// An asset saved over since it was placed: its meshes and textures replace the project's copies of them; its object.
pub fn refresh_in_project(project_dir: &Path, asset: &Path) -> Result<CustomObject> {
    let a = crate::jbrmap::load(asset).with_context(|| format!("read asset {}", asset.display()))?;
    let obj = a.chunks.first().and_then(|c| c.custom_objects.first()).cloned().context("asset has no object")?;
    merge(project_dir, a.mesh_library, a.texture_library, true)?;
    Ok(obj)
}

pub(crate) fn merge(project_dir: &Path, meshes: IndexMap<String, MeshData>, textures: IndexMap<String, TextureData>, replace: bool) -> Result<()> {
    let _one = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let lib_path = project_dir.join(PROJECT_LIBRARY);
    // a big library: what's new goes beside it ( a key it has already kept, as it's kept there; the game's look, which
    // can't be told apart from its copy there without reading it all, added beside it once )
    if is_big(&lib_path) {
        let keys = keys_of(&lib_path)?;
        let added = added_path(&lib_path);
        let mut lib = if added.exists() { crate::jbrmap::load(&added)? } else { MapData { id: "library".into(), name: "library".into(), ..MapData::default() } };
        let mut changed = false;
        for (k, m) in meshes {
            let take = match lib.mesh_library.get(&k) {
                Some(old) => (replace || from_game_look(&k)) && *old != m,
                None => replace || from_game_look(&k) || !keys.0.contains(&k),
            };
            if take {
                lib.mesh_library.insert(k, m);
                changed = true;
            }
        }
        for (k, t) in textures {
            let take = match lib.texture_library.get(&k) {
                Some(old) => (replace || from_game_look(&k)) && *old != t,
                None => replace || from_game_look(&k) || !keys.1.contains(&k),
            };
            if take {
                lib.texture_library.insert(k, t);
                changed = true;
            }
        }
        if changed {
            crate::jbrmap::save(&lib, &added)?;
        }
        return Ok(());
    }
    let mut lib = if lib_path.exists() {
        crate::jbrmap::load(&lib_path)?
    } else {
        MapData { id: "library".into(), name: "library".into(), ..MapData::default() }
    };
    let mut changed = false;
    for (k, m) in meshes {
        if lib.mesh_library.get(&k).is_none_or(|old| (replace || from_game_look(&k)) && *old != m) {
            lib.mesh_library.insert(k, m);
            changed = true;
        }
    }
    for (k, t) in textures {
        if lib.texture_library.get(&k).is_none_or(|old| (replace || from_game_look(&k)) && *old != t) {
            lib.texture_library.insert(k, t);
            changed = true;
        }
    }
    if changed {
        std::fs::create_dir_all(lib_path.parent().unwrap())?;
        crate::jbrmap::save(&lib, &lib_path)?;
    }
    Ok(())
}

/// Meshes ("Features/<id>/g<n>") and textures ("GameLook/…") made from the game's own look by gamelook/features.rs. Built
/// again whenever the reading of the game improves, and never edited in a map (a changed material is a new texture
/// key), so a map's copies give way to a newer build rather than being kept.
pub fn from_game_look(key: &str) -> bool {
    key.starts_with("GameLook/")
        || (key.starts_with("Features/") && key.rsplit('/').next().is_some_and(|n| n.len() > 1 && n.starts_with('g') && n[1..].bytes().all(|b| b.is_ascii_digit())))
}

/// For each of the game's pieces in the library (`assets`, with the game-look textures the project's pieces of it
/// use): whether the project holds an older build of its look — its meshes differ, textures its paint uses are
/// missing, or the pieces use game-look textures it no longer does (the paint was converted differently).
pub fn stale_game_look(project_dir: &Path, assets: &[(PathBuf, Vec<String>)]) -> Result<Vec<bool>> {
    let lib_path = project_dir.join(PROJECT_LIBRARY);
    if !lib_path.exists() {
        return Ok(vec![false; assets.len()]);
    }
    let lib = load_project_library(&lib_path)?;
    assets
        .iter()
        .map(|(asset, in_use)| -> Result<bool> {
            let a = crate::jbrmap::load(asset).with_context(|| format!("read asset {}", asset.display()))?;
            let meshes_differ = a.mesh_library.iter().any(|(k, m)| from_game_look(k) && lib.mesh_library.get(k) != Some(m));
            let textures_missing = a.texture_library.keys().any(|k| from_game_look(k) && !lib.texture_library.contains_key(k));
            let uses: std::collections::HashSet<&str> = a
                .chunks
                .iter()
                .flat_map(|c| &c.custom_objects)
                .flat_map(|o| &o.parts)
                .flat_map(|p| &p.materials)
                .flat_map(|m| [&m.base_tex, &m.normal_tex, &m.metallic_tex, &m.roughness_tex, &m.emission_tex])
                .map(|k| k.as_str())
                .collect();
            let dropped = in_use.iter().any(|k| from_game_look(k) && !uses.contains(k.as_str()));
            Ok(meshes_differ || textures_missing || dropped)
        })
        .collect()
}

/// Saves a custom object from a project (e.g. one of Melon's pieces) to the personal library. `obj` is expected
/// at the origin (the editor moves it there before sending).
pub fn save_from_project(project_dir: &Path, library_rel: &str, obj: CustomObject, name: &str, over: Option<&Path>) -> Result<AssetInfo> {
    let lib = load_project_library(&project_dir.join(library_rel))?;
    let mut meshes = IndexMap::new();
    let mut textures = IndexMap::new();
    for p in &obj.parts {
        if let Some(m) = lib.mesh_library.get(&p.mesh) {
            meshes.insert(p.mesh.clone(), m.clone());
        }
        for mat in &p.materials {
            for t in [&mat.base_tex, &mat.metallic_tex, &mat.roughness_tex, &mat.normal_tex, &mat.emission_tex] {
                if let Some(tex) = lib.texture_library.get(t) {
                    textures.insert(t.clone(), tex.clone());
                }
            }
        }
    }
    for c in &obj.colliders {
        if let Some(m) = lib.mesh_library.get(&c.mesh_ref) {
            meshes.insert(c.mesh_ref.clone(), m.clone());
        }
    }
    match over {
        Some(path) => {
            let path = super::super::save_object_over(path, name, obj, meshes, textures)?;
            let map = crate::jbrmap::load(&path)?;
            info(&path, &map).context("asset has no object")
        }
        None => save_asset(name, obj, meshes, textures),
    }
}

/// Removes a piece or material from your library.
pub fn delete(entry: &Path) -> Result<()> {
    super::super::delete(entry)
}

/// The object stored in a library entry (a piece, or a material's carrier object).
pub fn read_entry(path: &Path) -> Result<CustomObject> {
    super::super::read_object(path)
}
