//! A Unity project's files: every asset found by the guid its .meta gives it ( Assets/, Packages/ and the package
//! cache ), each file read once, text or binary, and a reference from one object to another followed to it. A model
//! ( .fbx, .obj, … ) is read as Unity imported it: its import in the Library ( Unity's own meshes, materials, objects
//! and their ids ), else made here from the file ( model.rs ).

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use anyhow::{Context, Result};

use super::binary::{is_binary, SerializedFile};
use super::value::{PPtr, Value};
use super::yaml;

/// An object of a file: its class ( 1 GameObject, 4 Transform, 114 MonoBehaviour, … ), id in the file, fields, and
/// for a MonoBehaviour its script's guid.
#[derive(Clone, Debug)]
pub struct Obj {
    pub class_id: i32,
    pub id: i64,
    pub stripped: bool,
    pub value: Value,
    pub script: String,
}

pub struct UFile {
    pub path: PathBuf,
    pub objects: Vec<Obj>,
    index: HashMap<i64, usize>,
    /// A binary file's externals' guids ( a PPtr's m_FileID − 1 ).
    externals: Vec<String>,
}

impl UFile {
    pub fn get(&self, id: i64) -> Option<&Obj> {
        self.index.get(&id).map(|&i| &self.objects[i])
    }

    /// The guid of the file a reference from here points into ( empty: this one ).
    pub fn guid_of(&self, p: &PPtr) -> String {
        if !p.guid.is_empty() {
            return p.guid.clone();
        }
        if p.file > 0 { self.externals.get(p.file as usize - 1).cloned().unwrap_or_default() } else { String::new() }
    }
}

/// A model file's objects as Unity's import of it holds them ( `from`: that import ), or as made here from the file
/// ( `texture`: an image it names, found in the project ).
fn read_model(path: &Path, from: Option<&Path>, texture: &dyn Fn(&str) -> Option<String>) -> Result<UFile> {
    if let Some(a) = from {
        if let Ok(mut f) = read_file(a) {
            f.path = path.to_path_buf();
            return Ok(f);
        }
    }
    let objects = super::model::import(path, texture)?;
    let index = objects.iter().enumerate().map(|(i, o)| (o.id, i)).collect();
    Ok(UFile { path: path.to_path_buf(), objects, index, externals: vec![] })
}

#[cfg(test)]
pub fn read_file_for_test(path: &Path) -> Result<UFile> {
    read_file(path)
}

fn read_file(path: &Path) -> Result<UFile> {
    let data = std::fs::read(path).with_context(|| format!("reading {}", path.display()))?;
    let mut objects = vec![];
    let mut externals = vec![];
    if is_binary(&data[..data.len().min(32)]) {
        let f = SerializedFile::parse(data).with_context(|| format!("reading {}", path.display()))?;
        externals = f.externals.iter().map(|e| e.guid.clone()).collect();
        for o in &f.objects {
            let value = match f.read(o) {
                Ok(v) => v,
                Err(e) => {
                    log::warn(&format!("{}: object {} unreadable: {e:#}", path.display(), o.path_id));
                    continue;
                }
            };
            let sc = value.get("m_Script").pptr();
            let script = if o.class_id == 114 && sc.file > 0 { externals.get(sc.file as usize - 1).cloned().unwrap_or_default() } else { String::new() };
            objects.push(Obj { class_id: o.class_id, id: o.path_id, stripped: false, value, script });
        }
    } else {
        for d in yaml::parse(&String::from_utf8_lossy(&data)) {
            let script = d.value.get("m_Script").get("guid").str().to_string();
            objects.push(Obj { class_id: d.class_id, id: d.file_id, stripped: d.stripped, value: d.value, script });
        }
    }
    let index = objects.iter().enumerate().map(|(i, o)| (o.id, i)).collect();
    Ok(UFile { path: path.to_path_buf(), objects, index, externals })
}

pub struct UnityProject {
    pub root: PathBuf,
    /// guid → the asset's path, and back.
    pub guids: HashMap<String, PathBuf>,
    paths: HashMap<PathBuf, String>,
    cache: RefCell<HashMap<PathBuf, Rc<UFile>>>,
    // ( the Library's artifact database, read when a model's first needed )
    artifact_db: RefCell<Option<Vec<u8>>>,
}

impl UnityProject {
    /// The project round `any` ( a scene, or the folder itself ): the folder that has an Assets folder.
    pub fn open(any: &Path) -> Result<UnityProject> {
        let mut root = if any.is_dir() { any.to_path_buf() } else { any.parent().context("no folder")?.to_path_buf() };
        while !root.join("Assets").is_dir() {
            root = root.parent().context("not inside a Unity project ( no Assets folder above it )")?.to_path_buf();
        }
        let mut guids = HashMap::new();
        for sub in ["Assets", "Packages", "Library/PackageCache"] {
            index_metas(&root.join(sub), &mut guids);
        }
        // ( Unity's built-in meshes and materials: from the editor the project was made with, else any )
        if let Some(res) = editor_resources(&root) {
            guids.insert("0000000000000000e000000000000000".into(), res.join("unity default resources"));
            guids.insert("0000000000000000f000000000000000".into(), res.join("unity_builtin_extra"));
        }
        let paths = guids.iter().map(|(g, p)| (p.clone(), g.clone())).collect();
        Ok(UnityProject { root, guids, paths, cache: RefCell::new(HashMap::new()), artifact_db: RefCell::new(None) })
    }

    /// Unity's import of a model in the Library: of the artifacts the database lists beside the model's guid, the
    /// newest that holds a mesh or a GameObject.
    pub fn artifact(&self, path: &Path) -> Option<PathBuf> {
        self.artifact_with(path, &[1, 43])
    }

    /// Unity's import of an asset in the Library that holds an object of one of `classes`.
    pub fn artifact_with(&self, path: &Path, classes: &[i32]) -> Option<PathBuf> {
        let guid = self.paths.get(path)?;
        let lib = self.root.join("Library");
        if self.artifact_db.borrow().is_none() {
            *self.artifact_db.borrow_mut() = Some(std::fs::read(lib.join("ArtifactDB")).unwrap_or_default());
        }
        let db = self.artifact_db.borrow();
        let db = db.as_ref()?;
        // ( a binary file's guid: each byte's nibbles the other way round )
        let g: Vec<u8> = (0..16).filter_map(|i| u8::from_str_radix(guid.get(i * 2..i * 2 + 2)?, 16).ok()).map(|b| (b << 4) | (b >> 4)).collect();
        if g.len() != 16 || db.is_empty() {
            return None;
        }
        let mut found: Vec<(std::time::SystemTime, PathBuf)> = vec![];
        let mut at = 0;
        while let Some(i) = db[at..].windows(16).position(|w| w == g.as_slice()) {
            let i = at + i;
            let win = &db[i + 16..(i + 400).min(db.len())];
            for k in 0..win.len().saturating_sub(16) {
                let h: String = win[k..k + 16].iter().map(|b| format!("{b:02x}")).collect();
                let p = lib.join("Artifacts").join(&h[..2]).join(&h);
                if !found.iter().any(|(_, q)| q == &p) {
                    if let Ok(m) = std::fs::metadata(&p) {
                        found.push((m.modified().unwrap_or(std::time::UNIX_EPOCH), p));
                    }
                }
            }
            at = i + 1;
        }
        found.sort_by(|a, b| b.0.cmp(&a.0));
        found.into_iter().map(|(_, p)| p).find(|p| read_file(p).map(|f| f.objects.iter().any(|o| classes.contains(&o.class_id))).unwrap_or(false))
    }

    /// The guid of the image a model names ( by its file name: beside the model first, then anywhere ).
    pub fn image_near(&self, model: &Path, name: &str) -> Option<String> {
        let file = Path::new(name).file_name()?.to_string_lossy().to_lowercase();
        let dir = model.parent();
        let mut best: Option<(bool, &String)> = None;
        for (p, g) in &self.paths {
            if p.file_name().map(|f| f.to_string_lossy().to_lowercase() == file).unwrap_or(false) {
                let near = dir.map(|d| p.starts_with(d)).unwrap_or(false);
                if best.map(|(n, _)| !n && near).unwrap_or(true) {
                    best = Some((near, g));
                }
            }
        }
        best.map(|(_, g)| g.clone())
    }

    /// A file of the project, read ( once ).
    pub fn file(&self, path: &Path) -> Result<Rc<UFile>> {
        if let Some(f) = self.cache.borrow().get(path) {
            return Ok(f.clone());
        }
        let f = Rc::new(if is_model(path) { read_model(path, self.artifact(path).as_deref(), &|name| self.image_near(path, name))? } else { read_file(path)? });
        self.cache.borrow_mut().insert(path.to_path_buf(), f.clone());
        Ok(f)
    }

    pub fn file_of_guid(&self, guid: &str) -> Option<Rc<UFile>> {
        let p = self.guids.get(guid)?;
        self.file(p).ok()
    }

    /// The object a reference from `from` points to, and the file it's in.
    pub fn follow(&self, from: &Rc<UFile>, p: &PPtr) -> Option<(Rc<UFile>, Obj)> {
        if p.is_null() {
            return None;
        }
        let g = from.guid_of(p);
        let f = if g.is_empty() { from.clone() } else { self.file_of_guid(&g)? };
        let o = f.get(p.path)?.clone();
        Some((f, o))
    }

    /// An asset's path from its guid.
    pub fn path_of(&self, guid: &str) -> Option<&PathBuf> {
        self.guids.get(guid)
    }

    /// The name of a script from its guid ( its file's name ).
    pub fn script_name(&self, guid: &str) -> String {
        self.guids.get(guid).and_then(|p| p.file_stem()).map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
    }
}

/// The Unity editor's Resources folder: the project's version's, installed by the Hub, else the newest there.
fn editor_resources(root: &Path) -> Option<PathBuf> {
    let version = std::fs::read_to_string(root.join("ProjectSettings/ProjectVersion.txt")).ok().and_then(|s| s.lines().find_map(|l| l.strip_prefix("m_EditorVersion:").map(|v| v.trim().to_string())));
    let mut hubs = vec![PathBuf::from("C:/Program Files/Unity/Hub/Editor")];
    if let Ok(s) = std::fs::read_to_string(std::env::var("APPDATA").unwrap_or_default() + "/UnityHub/secondaryInstallPath.json") {
        let p = s.trim().trim_matches('"').replace("\\\\", "/");
        if !p.is_empty() {
            hubs.push(PathBuf::from(p));
        }
    }
    let res = |d: &Path| d.join("Editor/Data/Resources");
    for h in &hubs {
        if let Some(v) = &version {
            let r = res(&h.join(v));
            if r.join("unity default resources").exists() {
                return Some(r);
            }
        }
    }
    let mut all: Vec<PathBuf> = hubs.iter().filter_map(|h| std::fs::read_dir(h).ok()).flatten().flatten().map(|e| res(&e.path())).filter(|r| r.join("unity default resources").exists()).collect();
    all.sort();
    all.pop()
}

/// Whether a file is a model Unity imports ( read as its import has it ).
pub fn is_model(p: &Path) -> bool {
    let e = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    matches!(e.as_str(), "fbx" | "obj" | "dae" | "blend" | "3ds" | "dxf" | "ma" | "mb" | "max")
}

/// Whether a file is one of Unity's own ( text or binary ) or a model read as Unity imported it, not an image.
pub fn is_unity_file(p: &Path) -> bool {
    if is_model(p) {
        return true;
    }
    let f = p.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    if f == "unity default resources" || f == "unity_builtin_extra" {
        return true;
    }
    let e = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    matches!(e.as_str(), "unity" | "prefab" | "asset" | "mat" | "terrainlayer" | "anim" | "controller" | "physicmaterial" | "lighting" | "mask" | "preset" | "cubemap" | "rendertexture")
}

fn index_metas(dir: &Path, out: &mut HashMap<String, PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            index_metas(&p, out);
        } else if p.extension().map(|x| x == "meta").unwrap_or(false) {
            let Ok(s) = std::fs::read_to_string(&p) else { continue };
            if let Some(g) = s.lines().find_map(|l| l.strip_prefix("guid: ")) {
                out.insert(g.trim().to_string(), p.with_extension(""));
            }
        }
    }
}

mod log {
    pub fn warn(s: &str) {
        eprintln!("[unity import] {s}");
    }
}
