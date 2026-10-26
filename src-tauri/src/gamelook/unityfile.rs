//! Reading the game's own Unity files (Jibbers_Data/*.assets: SerializedFile format 22) for the few classes the
//! studio needs from them. Shipped games have their type trees stripped, so the layouts for the game's Unity version
//! come with the app (unity_typetrees.json, from tools/dump_unity_typetrees.py); an object is read field by field
//! as Unity wrote it (alignment, arrays, strings), as UnityPy's type tree reader does.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::Deserialize;

/// A value read from a file: what its layout says it is.
#[derive(Clone, Debug)]
pub enum V {
    Bool(bool),
    I(i64),
    U(u64),
    F(f64),
    S(String),
    Bytes(Vec<u8>),
    Arr(Vec<V>),
    Obj(Vec<(String, V)>),
    Pair(Box<V>, Box<V>),
}

static NONE: V = V::Arr(Vec::new());

impl V {
    /// A field (or the empty value when there's none).
    pub fn get(&self, k: &str) -> &V {
        match self {
            V::Obj(f) => f.iter().find(|(n, _)| n == k).map(|(_, v)| v).unwrap_or(&NONE),
            _ => &NONE,
        }
    }
    pub fn f(&self) -> f64 {
        match self {
            V::F(x) => *x,
            V::I(x) => *x as f64,
            V::U(x) => *x as f64,
            V::Bool(b) => *b as i32 as f64,
            _ => 0.0,
        }
    }
    pub fn i(&self) -> i64 {
        match self {
            V::I(x) => *x,
            V::U(x) => *x as i64,
            V::F(x) => *x as i64,
            V::Bool(b) => *b as i64,
            _ => 0,
        }
    }
    pub fn b(&self) -> bool {
        self.i() != 0
    }
    pub fn s(&self) -> &str {
        if let V::S(s) = self { s } else { "" }
    }
    pub fn arr(&self) -> &[V] {
        if let V::Arr(a) = self { a } else { &[] }
    }
    pub fn bytes(&self) -> &[u8] {
        if let V::Bytes(b) = self { b } else { &[] }
    }
    /// A pair's two halves (a map's entries are pairs).
    pub fn pair(&self) -> Option<(&V, &V)> {
        if let V::Pair(a, b) = self { Some((a, b)) } else { None }
    }
    /// A reference to another object (PPtr: its file, by the referring file's own list, and its id there).
    pub fn pptr(&self) -> PPtr {
        PPtr { file: self.get("m_FileID").i() as i32, path: self.get("m_PathID").i() }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct PPtr {
    pub file: i32,
    pub path: i64,
}

impl PPtr {
    pub fn is_null(&self) -> bool {
        self.path == 0
    }
}

// ---------------------------------------------------------------- layouts

#[derive(Debug)]
struct Node {
    ty: String,
    name: String,
    flags: u32,
    children: Vec<Node>,
}

const ALIGN: u32 = 0x4000;

/// A layout's node as stored, in order: (depth, type, name, size, flags).
type FlatNode = (u32, String, String, i32, u32);

#[derive(Deserialize)]
struct TreeFile {
    version: String,
    classes: HashMap<String, Vec<FlatNode>>,
}

/// The layouts the app has (for the game's Unity version), by class id.
pub struct Layouts {
    pub version: String,
    trees: HashMap<i32, Node>,
}

impl Layouts {
    pub fn load() -> Result<Layouts> {
        let f: TreeFile = serde_json::from_str(include_str!("unity_typetrees.json"))?;
        let mut trees = HashMap::new();
        for (id, flat) in f.classes {
            let mut it = flat.into_iter().peekable();
            let root = build(&mut it, 0).context("empty layout")?;
            trees.insert(id.parse()?, root);
        }
        Ok(Layouts { version: f.version, trees })
    }
}

fn build(it: &mut std::iter::Peekable<impl Iterator<Item = FlatNode>>, level: u32) -> Option<Node> {
    let (l, ty, name, _, flags) = it.next()?;
    debug_assert_eq!(l, level);
    let mut node = Node { ty, name, flags, children: vec![] };
    while it.peek().is_some_and(|n| n.0 == level + 1) {
        node.children.extend(build(it, level + 1));
    }
    Some(node)
}

// ---------------------------------------------------------------- reading values

struct R<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> R<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        let s = self.b.get(self.p..self.p + n).context("read past the end of an object")?;
        self.p += n;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into()?))
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into()?))
    }
    fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into()?))
    }
    fn i32(&mut self) -> Result<i32> {
        Ok(self.u32()? as i32)
    }
    fn align(&mut self) {
        self.p = (self.p + 3) & !3;
    }
    fn len(&mut self) -> Result<usize> {
        let n = self.i32()?;
        if n < 0 {
            bail!("negative length");
        }
        Ok(n as usize)
    }
}

/// A value by its layout. `own_align`: the node's own alignment applies after it (not for an array's elements, which
/// align once after the whole array, as Unity writes them).
fn read(node: &Node, r: &mut R, own_align: bool) -> Result<V> {
    let mut align = own_align && node.flags & ALIGN != 0;
    let v = match node.ty.as_str() {
        "bool" => V::Bool(r.u8()? != 0),
        "SInt8" => V::I(r.u8()? as i8 as i64),
        "UInt8" | "char" => V::U(r.u8()? as u64),
        "short" | "SInt16" => V::I(r.u16()? as i16 as i64),
        "unsigned short" | "UInt16" => V::U(r.u16()? as u64),
        "int" | "SInt32" => V::I(r.i32()? as i64),
        "unsigned int" | "UInt32" | "Type*" => V::U(r.u32()? as u64),
        "long long" | "SInt64" => V::I(r.u64()? as i64),
        "unsigned long long" | "UInt64" | "FileSize" => V::U(r.u64()?),
        "float" => V::F(f32::from_le_bytes(r.take(4)?.try_into()?) as f64),
        "double" => V::F(f64::from_le_bytes(r.take(8)?.try_into()?)),
        "string" => {
            let n = r.len()?;
            let s = String::from_utf8_lossy(r.take(n)?).into_owned();
            r.align();
            V::S(s)
        }
        "TypelessData" => {
            let n = r.len()?;
            V::Bytes(r.take(n)?.to_vec())
        }
        "pair" => V::Pair(Box::new(read(&node.children[0], r, true)?), Box::new(read(&node.children[1], r, true)?)),
        _ if node.ty == "Array" || node.children.first().is_some_and(|c| c.ty == "Array") => {
            let arr = if node.ty == "Array" { node } else { &node.children[0] };
            if arr.flags & ALIGN != 0 {
                align = true;
            }
            let n = r.len()?;
            let el = &arr.children[1];
            if matches!(el.ty.as_str(), "UInt8" | "SInt8" | "char") {
                V::Bytes(r.take(n)?.to_vec())
            } else {
                let el_aligned = el.flags & ALIGN != 0;
                let mut out = Vec::with_capacity(n.min(1 << 20));
                for _ in 0..n {
                    out.push(read(el, r, !el_aligned)?);
                }
                if el_aligned {
                    r.align();
                }
                V::Arr(out)
            }
        }
        _ => {
            let mut fields = Vec::with_capacity(node.children.len());
            for c in &node.children {
                fields.push((c.name.clone(), read(c, r, true)?));
            }
            V::Obj(fields)
        }
    };
    if align {
        r.align();
    }
    Ok(v)
}

// ---------------------------------------------------------------- files

#[derive(Clone, Copy, Debug)]
pub struct ObjInfo {
    pub path_id: i64,
    pub start: usize,
    pub size: usize,
    pub class: i32,
}

/// One of the game's serialized files: its objects (where they are, of what class) and the files it refers to.
pub struct SFile {
    pub name: String,
    pub unity_version: String,
    data: Vec<u8>,
    pub objects: Vec<ObjInfo>,
    by_id: HashMap<i64, usize>,
    /// the other files its references point into (by file name), in its own order
    pub externals: Vec<String>,
}

impl SFile {
    pub fn open(path: &Path) -> Result<SFile> {
        let data = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
        let be32 = |o: usize| u32::from_be_bytes(data[o..o + 4].try_into().unwrap());
        let be64 = |o: usize| u64::from_be_bytes(data[o..o + 8].try_into().unwrap());
        let version = be32(8);
        if version < 22 {
            bail!("{}: serialized file version {version} (22 or later wanted)", path.display());
        }
        if data[16] != 0 {
            bail!("{}: big-endian file", path.display());
        }
        let data_offset = be64(32) as usize;
        let mut r = R { b: &data, p: 48 };
        let mut unity_version = String::new();
        loop {
            let c = r.u8()?;
            if c == 0 {
                break;
            }
            unity_version.push(c as char);
        }
        let _platform = r.i32()?;
        let type_tree = r.u8()? != 0;
        if type_tree {
            bail!("{}: has its own type trees (a development build?): not read", path.display());
        }
        let type_count = r.len()?;
        let mut classes = Vec::with_capacity(type_count);
        for _ in 0..type_count {
            let class = r.i32()?;
            let _stripped = r.u8()?;
            let _script_index = r.u16()?;
            if class == 114 {
                r.take(16)?;
            }
            r.take(16)?;
            classes.push(class);
        }
        let object_count = r.len()?;
        let mut objects = Vec::with_capacity(object_count);
        for _ in 0..object_count {
            r.align();
            let path_id = r.u64()? as i64;
            let start = r.u64()? as usize + data_offset;
            let size = r.u32()? as usize;
            let ty = r.i32()? as usize;
            objects.push(ObjInfo { path_id, start, size, class: *classes.get(ty).context("bad type index")? });
        }
        let scripts = r.len()?;
        for _ in 0..scripts {
            r.i32()?;
            r.align();
            r.u64()?;
        }
        let ext_count = r.len()?;
        let mut externals = Vec::with_capacity(ext_count);
        for _ in 0..ext_count {
            while r.u8()? != 0 {}
            r.take(16)?;
            r.i32()?;
            let mut p = Vec::new();
            loop {
                let c = r.u8()?;
                if c == 0 {
                    break;
                }
                p.push(c);
            }
            let p = String::from_utf8_lossy(&p).replace('\\', "/");
            externals.push(p.rsplit('/').next().unwrap_or_default().to_lowercase());
        }
        let by_id = objects.iter().enumerate().map(|(i, o)| (o.path_id, i)).collect();
        Ok(SFile { name: path.file_name().unwrap_or_default().to_string_lossy().to_lowercase(), unity_version, data, objects, by_id, externals })
    }

    pub fn info(&self, path_id: i64) -> Option<ObjInfo> {
        self.by_id.get(&path_id).map(|&i| self.objects[i])
    }
}

/// The game's files that were opened, and what they're read with.
pub struct Game {
    pub data_dir: PathBuf,
    pub files: Vec<SFile>,
    layouts: Layouts,
}

/// Where an object is: which of the open files, and its id there.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct At {
    pub file: usize,
    pub path: i64,
}

impl Game {
    /// The named files in the game's data folder (the first is where the search starts).
    pub fn open(data_dir: &Path, names: &[&str]) -> Result<Game> {
        let layouts = Layouts::load()?;
        let files = names.iter().map(|n| SFile::open(&data_dir.join(n))).collect::<Result<Vec<_>>>()?;
        Ok(Game { data_dir: data_dir.to_path_buf(), files, layouts })
    }

    /// Whether the app's layouts are for the version the files were made with.
    pub fn layouts_match(&self) -> bool {
        self.files.iter().all(|f| f.unity_version == self.layouts.version)
    }

    pub fn class_of(&self, at: At) -> Option<i32> {
        self.files.get(at.file)?.info(at.path).map(|o| o.class)
    }

    /// Where a reference made from `from` points (None: null, or into a file that isn't open).
    pub fn resolve(&self, from: usize, p: PPtr) -> Option<At> {
        if p.is_null() {
            return None;
        }
        if p.file == 0 {
            return Some(At { file: from, path: p.path });
        }
        let name = self.files[from].externals.get(p.file as usize - 1)?;
        let file = self.files.iter().position(|f| &f.name == name)?;
        Some(At { file, path: p.path })
    }

    /// An object, read by its class's layout.
    pub fn read(&self, at: At) -> Result<V> {
        let f = &self.files[at.file];
        let o = f.info(at.path).with_context(|| format!("no object {} in {}", at.path, f.name))?;
        let tree = self.layouts.trees.get(&o.class).with_context(|| format!("no layout for class {}", o.class))?;
        let mut r = R { b: &f.data[o.start..o.start + o.size], p: 0 };
        let v = read(tree, &mut r, true)?;
        if r.p != o.size {
            bail!("{}: class {} object {} read {} of {} bytes (layouts for another Unity version?)", f.name, o.class, at.path, r.p, o.size);
        }
        Ok(v)
    }

    /// An object's bytes as stored (for classes without a layout: a script's fields, read by hand).
    pub fn raw(&self, at: At) -> Option<&[u8]> {
        let f = self.files.get(at.file)?;
        let o = f.info(at.path)?;
        f.data.get(o.start..o.start + o.size)
    }

    /// Data kept beside a file (StreamingInfo: offset, size, path), e.g. in resources.assets.resS.
    pub fn streamed(&self, info: &V) -> Result<Option<Vec<u8>>> {
        let size = info.get("size").i() as usize;
        let path = info.get("path").s();
        if size == 0 || path.is_empty() {
            return Ok(None);
        }
        let name = path.replace('\\', "/").rsplit('/').next().unwrap_or_default().to_string();
        let mut f = std::fs::File::open(self.data_dir.join(&name)).with_context(|| format!("open {name}"))?;
        f.seek(SeekFrom::Start(info.get("offset").i() as u64))?;
        let mut buf = vec![0; size];
        f.read_exact(&mut buf)?;
        Ok(Some(buf))
    }
}
