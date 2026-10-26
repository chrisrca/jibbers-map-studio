//! The library listed: its folders walked (an item's name and kind cached by its file's time), and an entry read.

use super::*;

/// Everything under `root` (folders and file names as they are on disk).
pub fn list(root: &Path) -> Vec<Item> {
    let mut cache = Cache::load();
    let mut out = vec![];
    walk(root, root, &mut cache, &mut out);
    cache.save();
    out
}

pub(crate) fn walk(root: &Path, dir: &Path, cache: &mut Cache, out: &mut Vec<Item>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());
    for e in entries {
        let p = e.path();
        if e.file_name().to_string_lossy().starts_with('.') {
            continue;
        }
        if p.is_dir() {
            walk(root, &p, cache, out);
        } else if kind_of(&p).is_some() {
            let Some(info) = cache.info(&p) else { continue };
            let folder = p
                .parent()
                .and_then(|d| d.strip_prefix(root).ok())
                .map(|r| r.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/"))
                .unwrap_or_default();
            out.push(Item { name: p.file_stem().unwrap_or_default().to_string_lossy().into(), folder, path: p, info });
        }
    }
}

/// What each entry is, remembered by file (size and time): opening every file on each listing would take seconds.
#[derive(Serialize, Deserialize, Default)]
pub(crate) struct Cache {
    pub(crate) version: u32,
    pub(crate) entries: HashMap<String, Cached>,
    #[serde(skip)]
    pub(crate) changed: bool,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct Cached {
    pub(crate) len: u64,
    pub(crate) modified: u64,
    pub(crate) info: Info,
}

pub(crate) const CACHE_VERSION: u32 = 1;

impl Cache {
    pub(crate) fn path() -> Option<PathBuf> {
        Some(userassets::data_dir().ok()?.join("cache").join("library-files.json"))
    }

    pub(crate) fn load() -> Self {
        Self::path()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|b| serde_json::from_slice::<Cache>(&b).ok())
            .filter(|c| c.version == CACHE_VERSION)
            .unwrap_or(Cache { version: CACHE_VERSION, ..Cache::default() })
    }

    pub(crate) fn info(&mut self, p: &Path) -> Option<Info> {
        let meta = std::fs::metadata(p).ok()?;
        let modified = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
        let key = p.display().to_string();
        if let Some(c) = self.entries.get(&key).filter(|c| c.len == meta.len() && c.modified == modified) {
            return Some(c.info.clone());
        }
        let info = match read_info(p) {
            Ok(i) => i,
            Err(e) => {
                eprintln!("skipping library entry {}: {e:#}", p.display());
                return None;
            }
        };
        self.entries.insert(key, Cached { len: meta.len(), modified, info: info.clone() });
        self.changed = true;
        Some(info)
    }

    /// Saved when something was read anew; entries for files that are gone are dropped then.
    pub(crate) fn save(mut self) {
        if !self.changed {
            return;
        }
        self.entries.retain(|k, _| Path::new(k).exists());
        if let Some(p) = Self::path() {
            if let Some(d) = p.parent() {
                std::fs::create_dir_all(d).ok();
            }
            if let Ok(b) = serde_json::to_vec(&self) {
                std::fs::write(p, b).ok();
            }
        }
    }
}

pub(crate) fn read_info(p: &Path) -> Result<Info> {
    let map = crate::jbrmap::load(p)?;
    let obj = first_object(&map).context("no object in it")?;
    Ok(match kind_of(p).context("not a library entry")? {
        Kind::Mesh => Info { kind: Kind::Mesh, material: None, size: Some(bounds(&map.mesh_library, obj)) },
        Kind::Material => Info { kind: Kind::Material, material: Some(material_of(obj).context("no material in it")?), size: None },
    })
}

pub(crate) fn first_object(map: &MapData) -> Option<&CustomObject> {
    map.chunks.first()?.custom_objects.first()
}

pub fn material_of(obj: &CustomObject) -> Option<Material> {
    obj.parts.first()?.materials.first().cloned()
}

/// The object in a library entry (a piece, or a material's carrier).
pub fn read_object(path: &Path) -> Result<CustomObject> {
    let map = crate::jbrmap::load(path)?;
    map.chunks.into_iter().next().and_then(|c| c.custom_objects.into_iter().next()).context("empty library entry")
}
