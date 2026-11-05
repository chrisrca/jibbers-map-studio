//! Unity's binary asset files (a scene, a prefab, a .asset saved as binary): the SerializedFile layout, its objects
//! read from the type trees it carries (an editor's files always do), as UnityPy reads them.

use anyhow::{bail, Context, Result};

use super::common::COMMON;
use super::value::{Prim, Value};

/// A node of a type tree: its type and name, depth, and whether what's read for it is padded to 4 after.
#[derive(Clone, Debug)]
struct Node {
    ty: String,
    name: String,
    level: u8,
    align: bool,
    children: Vec<usize>,
}

#[derive(Clone, Debug)]
struct Type {
    class_id: i32,
    script_index: i16,
    nodes: Vec<Node>,
}

/// An object in the file: its id, type and where its bytes are.
#[derive(Clone, Debug)]
pub struct ObjectInfo {
    pub path_id: i64,
    pub class_id: i32,
    start: usize,
    size: usize,
    ty: usize,
}

/// Another file an object here refers to ( a PPtr's `m_FileID` − 1 indexes these ).
#[derive(Clone, Debug)]
pub struct External {
    /// As in a .meta file ( Unity keeps it nibble-swapped in the file ).
    pub guid: String,
    pub path: String,
}

pub struct SerializedFile {
    data: Vec<u8>,
    big: bool,
    types: Vec<Type>,
    pub objects: Vec<ObjectInfo>,
    pub externals: Vec<External>,
    /// The MonoBehaviours' scripts: ( file index, path id ) per script type index.
    pub scripts: Vec<(i32, i64)>,
}

struct Reader<'a> {
    b: &'a [u8],
    p: usize,
    big: bool,
}

impl<'a> Reader<'a> {
    fn need(&self, n: usize) -> Result<()> {
        if self.p + n > self.b.len() {
            bail!("read past the end ({} + {} > {})", self.p, n, self.b.len());
        }
        Ok(())
    }
    fn bytes(&mut self, n: usize) -> Result<&'a [u8]> {
        self.need(n)?;
        let s = &self.b[self.p..self.p + n];
        self.p += n;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8> {
        Ok(self.bytes(1)?[0])
    }
    fn arr<const N: usize>(&mut self) -> Result<[u8; N]> {
        let mut a: [u8; N] = self.bytes(N)?.try_into().unwrap();
        if self.big {
            a.reverse();
        }
        Ok(a)
    }
    fn i16(&mut self) -> Result<i16> {
        Ok(i16::from_le_bytes(self.arr()?))
    }
    fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(self.arr()?))
    }
    fn i32(&mut self) -> Result<i32> {
        Ok(i32::from_le_bytes(self.arr()?))
    }
    fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.arr()?))
    }
    fn i64(&mut self) -> Result<i64> {
        Ok(i64::from_le_bytes(self.arr()?))
    }
    fn u64(&mut self) -> Result<u64> {
        Ok(u64::from_le_bytes(self.arr()?))
    }
    fn f32(&mut self) -> Result<f32> {
        Ok(f32::from_le_bytes(self.arr()?))
    }
    fn f64(&mut self) -> Result<f64> {
        Ok(f64::from_le_bytes(self.arr()?))
    }
    fn cstr(&mut self) -> Result<String> {
        let rest = &self.b[self.p.min(self.b.len())..];
        let n = rest.iter().position(|&c| c == 0).context("unterminated string")?;
        let s = String::from_utf8_lossy(&rest[..n]).into_owned();
        self.p += n + 1;
        Ok(s)
    }
    fn align(&mut self) {
        self.p = (self.p + 3) & !3;
    }
}

/// The string at `off` of a type tree's own strings, or Unity's built-in ones.
fn tree_string(own: &[u8], off: u32) -> String {
    let (buf, o) = if off & 0x8000_0000 != 0 { (COMMON.as_bytes(), (off & 0x7fff_ffff) as usize) } else { (own, off as usize) };
    let rest = buf.get(o..).unwrap_or(&[]);
    let n = rest.iter().position(|&c| c == 0).unwrap_or(rest.len());
    String::from_utf8_lossy(&rest[..n]).into_owned()
}

/// Whether a file starts like a binary SerializedFile ( not a text one ).
pub fn is_binary(head: &[u8]) -> bool {
    head.len() >= 20 && !head.starts_with(b"%YAML")
}

impl SerializedFile {
    pub fn parse(data: Vec<u8>) -> Result<SerializedFile> {
        let mut r = Reader { b: &data, p: 0, big: true };
        let _meta_size = r.u32()?;
        let mut file_size = r.u32()? as u64;
        let version = r.u32()?;
        let mut data_offset = r.u32()? as u64;
        if version < 9 {
            bail!("Unity file format {version} is too old");
        }
        let big = r.u8()? != 0;
        r.bytes(3)?;
        if version >= 22 {
            let _ = r.u32()?;
            file_size = r.u64()?;
            data_offset = r.u64()?;
            r.u64()?;
        }
        let _ = file_size;
        r.big = big;
        let _unity = r.cstr()?;
        let _platform = r.i32()?;
        let type_tree = if version >= 13 { r.u8()? != 0 } else { true };
        if !type_tree {
            bail!("this file has no type trees ( a built game's, not an editor's )");
        }
        let read_type = |r: &mut Reader, is_ref: bool| -> Result<Type> {
            let class_id = r.i32()?;
            if version >= 16 {
                r.u8()?;
            }
            let script_index = if version >= 17 { r.i16()? } else { -1 };
            if version >= 13 {
                if (is_ref && script_index >= 0) || (version < 16 && class_id < 0) || (version >= 16 && class_id == 114) {
                    r.bytes(16)?;
                }
                r.bytes(16)?;
            }
            let mut tree_size = 1;
            if version >= 23 {
                r.bytes(16)?;
                tree_size = r.i32()?;
            }
            let mut nodes = vec![];
            if version >= 12 || version == 10 {
                if version < 23 || tree_size != 0 {
                    if version >= 23 {
                        if r.bytes(4)? != b"mhtt" {
                            bail!("bad type tree");
                        }
                        r.i32()?;
                    }
                    let count = r.i32()? as usize;
                    let strings = r.i32()? as usize;
                    let stride = if version >= 19 { 32 } else { 24 };
                    let raw = r.bytes(count * stride)?;
                    let own = r.bytes(strings)?;
                    let mut nr = Reader { b: raw, p: 0, big };
                    for _ in 0..count {
                        let _ver = nr.u16()?;
                        let level = nr.u8()?;
                        let _flags = nr.u8()?;
                        let ty = nr.u32()?;
                        let name = nr.u32()?;
                        let _size = nr.i32()?;
                        let _index = nr.i32()?;
                        let meta = nr.i32()?;
                        if version >= 19 {
                            nr.u64()?;
                        }
                        nodes.push(Node { ty: tree_string(own, ty), name: tree_string(own, name), level, align: meta & 0x4000 != 0, children: vec![] });
                    }
                    // ( each node's children: the nodes after it one level down, till one at its level or above )
                    let mut stack: Vec<usize> = vec![];
                    for i in 0..nodes.len() {
                        while let Some(&top) = stack.last() {
                            if nodes[top].level >= nodes[i].level {
                                stack.pop();
                            } else {
                                break;
                            }
                        }
                        if let Some(&top) = stack.last() {
                            nodes[top].children.push(i);
                        }
                        stack.push(i);
                    }
                }
            } else {
                bail!("Unity file format {version}'s type trees aren't read");
            }
            if version >= 21 {
                if is_ref {
                    r.cstr()?;
                    r.cstr()?;
                    r.cstr()?;
                } else {
                    let n = r.i32()?;
                    for _ in 0..n {
                        r.i32()?;
                    }
                }
            }
            Ok(Type { class_id, script_index, nodes })
        };
        let n = r.i32()?;
        let mut types = vec![];
        for _ in 0..n {
            types.push(read_type(&mut r, false)?);
        }
        let big_ids = if (7..14).contains(&version) { r.i32()? != 0 } else { false };
        let n = r.i32()?;
        let mut objects = vec![];
        for _ in 0..n {
            let path_id = if big_ids {
                r.i64()?
            } else if version < 14 {
                r.i32()? as i64
            } else {
                r.align();
                r.i64()?
            };
            let start = if version >= 22 { r.i64()? as u64 } else { r.u32()? as u64 } + data_offset;
            let size = r.u32()? as usize;
            let tid = r.i32()?;
            let (ty, class_id) = if version < 16 {
                let c = r.u16()? as i32;
                (types.iter().position(|t| t.class_id == tid).unwrap_or(0), c)
            } else {
                (tid as usize, types.get(tid as usize).map(|t| t.class_id).unwrap_or(0))
            };
            if version < 11 {
                r.u16()?;
            }
            if (11..17).contains(&version) {
                r.i16()?;
            }
            if version == 15 || version == 16 {
                r.u8()?;
            }
            objects.push(ObjectInfo { path_id, class_id, start: start as usize, size, ty });
        }
        let mut scripts = vec![];
        if version >= 11 {
            let n = r.i32()?;
            for _ in 0..n {
                let file = r.i32()?;
                let id = if version < 14 {
                    r.i32()? as i64
                } else {
                    r.align();
                    r.i64()?
                };
                scripts.push((file, id));
            }
        }
        let n = r.i32()?;
        let mut externals = vec![];
        for _ in 0..n {
            if version >= 6 {
                r.cstr()?;
            }
            let g = r.bytes(16)?;
            r.i32()?;
            let path = r.cstr()?;
            // ( each byte's nibbles the other way round, as a .meta writes it )
            let guid = g.iter().map(|b| format!("{:x}{:x}", b & 15, b >> 4)).collect();
            externals.push(External { guid, path });
        }
        Ok(SerializedFile { big, types, objects, externals, scripts, data })
    }

    /// The object's MonoBehaviour script ( its file index and id ), when it says through its type.
    pub fn script_of(&self, o: &ObjectInfo) -> Option<(i32, i64)> {
        let t = &self.types[o.ty];
        if t.script_index >= 0 { self.scripts.get(t.script_index as usize).copied() } else { None }
    }

    /// The object read out.
    pub fn read(&self, o: &ObjectInfo) -> Result<Value> {
        let t = self.types.get(o.ty).context("object of no type")?;
        if t.nodes.is_empty() {
            bail!("object {} has no type tree", o.path_id);
        }
        let end = (o.start + o.size).min(self.data.len());
        let mut r = Reader { b: &self.data[..end], p: o.start, big: self.big };
        read_node(&t.nodes, 0, &mut r)
    }
}

fn prim_of(ty: &str) -> Option<Prim> {
    Some(match ty {
        "SInt8" => Prim::I8,
        "UInt8" | "char" => Prim::U8,
        "short" | "SInt16" => Prim::I16,
        "unsigned short" | "UInt16" => Prim::U16,
        "int" | "SInt32" => Prim::I32,
        "unsigned int" | "UInt32" | "Type*" => Prim::U32,
        "long long" | "SInt64" => Prim::I64,
        "unsigned long long" | "UInt64" | "FileSize" => Prim::U64,
        "float" => Prim::F32,
        "double" => Prim::F64,
        "bool" => Prim::Bool,
        _ => return None,
    })
}

fn read_prim(p: Prim, r: &mut Reader) -> Result<Value> {
    Ok(match p {
        Prim::I8 => Value::Int(r.u8()? as i8 as i64),
        Prim::U8 => Value::Int(r.u8()? as i64),
        Prim::Bool => Value::Bool(r.u8()? != 0),
        Prim::I16 => Value::Int(r.i16()? as i64),
        Prim::U16 => Value::Int(r.u16()? as i64),
        Prim::I32 => Value::Int(r.i32()? as i64),
        Prim::U32 => Value::Int(r.u32()? as i64),
        Prim::I64 => Value::Int(r.i64()?),
        Prim::U64 => Value::Int(r.u64()? as i64),
        Prim::F32 => Value::Float(r.f32()? as f64),
        Prim::F64 => Value::Float(r.f64()?),
    })
}

fn read_node(nodes: &[Node], i: usize, r: &mut Reader) -> Result<Value> {
    let n = &nodes[i];
    let mut align = n.align;
    let v = if let Some(p) = prim_of(&n.ty) {
        read_prim(p, r)?
    } else if n.ty == "string" {
        let len = r.i32()?.max(0) as usize;
        let s = String::from_utf8_lossy(r.bytes(len)?).into_owned();
        align = true;
        Value::Str(s)
    } else if n.ty == "TypelessData" {
        let len = r.i32()?.max(0) as usize;
        Value::Bytes(r.bytes(len)?.to_vec())
    } else if n.ty == "pair" {
        let a = read_node(nodes, n.children[0], r)?;
        let b = read_node(nodes, n.children[1], r)?;
        Value::Map(vec![("first".into(), a), ("second".into(), b)])
    } else if n.children.first().map(|&c| nodes[c].ty == "Array").unwrap_or(false) {
        let arr = &nodes[n.children[0]];
        align |= arr.align;
        let len = r.i32()?;
        if len < 0 {
            bail!("negative array length in {}", n.name);
        }
        let len = len as usize;
        let el = arr.children[1];
        let e = &nodes[el];
        match prim_of(&e.ty).filter(|_| e.children.is_empty() && !e.align) {
            Some(p) => {
                let b = r.bytes(len * p.size())?;
                let mut b = b.to_vec();
                if r.big && p.size() > 1 {
                    for c in b.chunks_exact_mut(p.size()) {
                        c.reverse();
                    }
                }
                Value::Prims(p, b)
            }
            None => {
                let mut l = Vec::with_capacity(len.min(1 << 20));
                for _ in 0..len {
                    l.push(read_node(nodes, el, r)?);
                }
                Value::List(l)
            }
        }
    } else {
        let mut m = Vec::with_capacity(n.children.len());
        for &c in &n.children {
            let v = read_node(nodes, c, r)?;
            m.push((nodes[c].name.clone(), v));
        }
        Value::Map(m)
    };
    if align {
        r.align();
    }
    Ok(v)
}
