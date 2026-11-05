//! A model file ( .fbx, .obj ) made the objects Unity's ModelImporter would make of it, for a project with no Library
//! to read Unity's own import from: a GameObject per node ( one named after the file at the root ), its transform in
//! Unity's space ( X mirrored, the file's axes turned to Y up at the root, its units made metres ), a mesh per node
//! that has geometry ( triangulated, its vertices welded, a submesh per material, normals made where it has none ),
//! a renderer with its materials ( the .meta's remaps, else made from the file's ), as Unity numbers them where it can:
//! meshes and materials by xxHash64 of "Type:<class>-><name><n>", the root by Unity's fixed ids.

use std::collections::HashMap;
use std::path::Path;

use anyhow::{bail, Context, Result};

use super::fbx::{self, Node};
use super::files::Obj;
use super::math::{Mat4, Quat};
use super::value::Value;

// Unity's ids for a model's root GameObject, its Transform, and the root's MeshFilter and MeshRenderer.
const ROOT_GO: i64 = 919132149155446097;
const ROOT_TR: i64 = -8679921383154817045;
const ROOT_MF: i64 = -5754084199372789682;
const ROOT_MR: i64 = -7511558181221131132;

/// xxHash64 ( seed 0 ).
pub fn xxh64(input: &[u8]) -> u64 {
    const P1: u64 = 11400714785074694791;
    const P2: u64 = 14029467366897019727;
    const P3: u64 = 1609587929392839161;
    const P4: u64 = 9650029242287828579;
    const P5: u64 = 2870177450012600261;
    let rd64 = |b: &[u8]| u64::from_le_bytes(b[..8].try_into().unwrap());
    let rd32 = |b: &[u8]| u32::from_le_bytes(b[..4].try_into().unwrap()) as u64;
    let round = |acc: u64, v: u64| acc.wrapping_add(v.wrapping_mul(P2)).rotate_left(31).wrapping_mul(P1);
    let merge = |acc: u64, v: u64| (acc ^ round(0, v)).wrapping_mul(P1).wrapping_add(P4);
    let n = input.len();
    let mut p = 0;
    let mut h = if n >= 32 {
        let (mut v1, mut v2, mut v3, mut v4) = (P1.wrapping_add(P2), P2, 0u64, 0u64.wrapping_sub(P1));
        while p + 32 <= n {
            v1 = round(v1, rd64(&input[p..]));
            v2 = round(v2, rd64(&input[p + 8..]));
            v3 = round(v3, rd64(&input[p + 16..]));
            v4 = round(v4, rd64(&input[p + 24..]));
            p += 32;
        }
        let mut h = v1.rotate_left(1).wrapping_add(v2.rotate_left(7)).wrapping_add(v3.rotate_left(12)).wrapping_add(v4.rotate_left(18));
        h = merge(h, v1);
        h = merge(h, v2);
        h = merge(h, v3);
        merge(h, v4)
    } else {
        P5
    };
    h = h.wrapping_add(n as u64);
    while p + 8 <= n {
        h ^= round(0, rd64(&input[p..]));
        h = h.rotate_left(27).wrapping_mul(P1).wrapping_add(P4);
        p += 8;
    }
    if p + 4 <= n {
        h ^= rd32(&input[p..]).wrapping_mul(P1);
        h = h.rotate_left(23).wrapping_mul(P2).wrapping_add(P3);
        p += 4;
    }
    while p < n {
        h ^= (input[p] as u64).wrapping_mul(P5);
        h = h.rotate_left(11).wrapping_mul(P1);
        p += 1;
    }
    h ^= h >> 33;
    h = h.wrapping_mul(P2);
    h ^= h >> 29;
    h = h.wrapping_mul(P3);
    h ^ (h >> 32)
}

/// Unity's id for an imported object of a type by name ( the n-th of that name ).
pub fn import_id(class: &str, name: &str, n: usize) -> i64 {
    xxh64(format!("Type:{class}->{name}{n}").as_bytes()) as i64
}

// ---- what's built: nodes, each with its mesh and materials

/// A mesh as built: positions, normals, UV sets and colours per vertex, and triangles per submesh.
#[derive(Default, Clone)]
pub struct Built {
    pub pos: Vec<[f32; 3]>,
    pub nrm: Vec<[f32; 3]>,
    pub uv: Vec<Vec<[f32; 2]>>,
    pub col: Vec<[u8; 4]>,
    pub tan: Vec<[f32; 4]>,
    pub subs: Vec<Vec<u32>>,
}

struct BNode {
    name: String,
    parent: Option<usize>,
    t: [f32; 3],
    r: Quat,
    s: [f32; 3],
    mesh: Option<Built>,
    // material names per submesh, and texture file names ( diffuse ) and colours
    mats: Vec<(String, Option<String>, [f32; 4])>,
}

fn v(m: Vec<(&str, Value)>) -> Value {
    Value::Map(m.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

fn r(id: i64) -> Value {
    v(vec![("m_FileID", Value::Int(0)), ("m_PathID", Value::Int(id))])
}

fn xyz(a: [f32; 3]) -> Value {
    v(vec![("x", Value::Float(a[0] as f64)), ("y", Value::Float(a[1] as f64)), ("z", Value::Float(a[2] as f64))])
}

/// A built mesh as Unity's Mesh object ( one stream: position, normal, colour, UVs ), for mesh.rs to read.
fn mesh_value(name: &str, m: &Built) -> Value {
    let n = m.pos.len();
    let has_n = m.nrm.len() == n;
    let has_c = m.col.len() == n;
    let has_t = m.tan.len() == n;
    let uvs: Vec<&Vec<[f32; 2]>> = m.uv.iter().filter(|u| u.len() == n).take(8).collect();
    let mut chans = vec![];
    let mut off = 0;
    let mut ch = |stream: i32, fmt: i32, dim: i32, size: i32| -> Value {
        let c = v(vec![("stream", Value::Int(stream as i64)), ("offset", Value::Int(off as i64)), ("format", Value::Int(fmt as i64)), ("dimension", Value::Int(dim as i64))]);
        off += size;
        c
    };
    let none = || v(vec![("stream", Value::Int(0)), ("offset", Value::Int(0)), ("format", Value::Int(0)), ("dimension", Value::Int(0))]);
    chans.push(ch(0, 0, 3, 12));
    chans.push(if has_n { ch(0, 0, 3, 12) } else { none() });
    chans.push(if has_t { ch(0, 0, 4, 16) } else { none() });
    chans.push(if has_c { ch(0, 2, 4, 4) } else { none() });
    for k in 0..8 {
        chans.push(if k < uvs.len() { ch(0, 0, 2, 8) } else { none() });
    }
    chans.push(none());
    chans.push(none());
    let stride = off as usize;
    let mut data = Vec::with_capacity(n * stride);
    for i in 0..n {
        data.extend(m.pos[i].iter().flat_map(|f| f.to_le_bytes()));
        if has_n {
            data.extend(m.nrm[i].iter().flat_map(|f| f.to_le_bytes()));
        }
        if has_t {
            data.extend(m.tan[i].iter().flat_map(|f| f.to_le_bytes()));
        }
        if has_c {
            data.extend(m.col[i]);
        }
        for u in &uvs {
            data.extend(u[i].iter().flat_map(|f| f.to_le_bytes()));
        }
    }
    let mut ib = vec![];
    let mut subs = vec![];
    for s in &m.subs {
        subs.push(v(vec![("firstByte", Value::Int(ib.len() as i64)), ("indexCount", Value::Int(s.len() as i64)), ("topology", Value::Int(0)), ("baseVertex", Value::Int(0))]));
        ib.extend(s.iter().flat_map(|i| i.to_le_bytes()));
    }
    v(vec![
        ("m_Name", Value::Str(name.into())),
        ("m_SubMeshes", Value::List(subs)),
        ("m_IndexFormat", Value::Int(1)),
        ("m_IndexBuffer", Value::Bytes(ib)),
        ("m_VertexData", v(vec![("m_VertexCount", Value::Int(n as i64)), ("m_Channels", Value::List(chans)), ("m_DataSize", Value::Bytes(data))])),
    ])
}

/// The model's objects ( `texture`: the guid of an image the file names, found in the project ).
pub fn import(path: &Path, texture: &dyn Fn(&str) -> Option<String>) -> Result<Vec<Obj>> {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let meta = super::texture::meta(path);
    let mi = meta.get("ModelImporter");
    let scale = mi.at("meshes.globalScale").f32_or(1.0);
    let use_file = mi.at("meshes.useFileScale").bool_or(true);
    let nodes = match ext.as_str() {
        "fbx" => fbx_nodes(&std::fs::read(path)?, scale, use_file)?,
        "obj" => obj_nodes(path, scale)?,
        other => bail!("{other} models are read from the project's Library only ( open it in Unity once )"),
    };
    // ( the .meta's remapped materials, by name )
    let remap: HashMap<String, Value> = mi
        .get("externalObjects")
        .list()
        .iter()
        .filter(|e| e.at("first.type").str().ends_with("Material"))
        .map(|e| (e.at("first.name").str().to_string(), e.get("second").clone()))
        .collect();
    let import_mats = mi.at("materials.materialImportMode").i32_or(1) != 0;
    let file_name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    // one node at the top: it is the root, named after the file; else a root of that name over them
    let tops: Vec<usize> = (0..nodes.len()).filter(|&i| nodes[i].parent.is_none()).collect();
    let mut nodes = nodes;
    let single = tops.len() == 1;
    if !single {
        for n in nodes.iter_mut() {
            if n.parent.is_none() {
                n.parent = Some(usize::MAX);
            }
        }
    }
    let mut objs = vec![];
    let mut names: HashMap<(String, String), usize> = HashMap::new();
    let mut id_of = |class: &str, name: &str| {
        let k = names.entry((class.to_string(), name.to_string())).or_insert(0);
        let id = import_id(class, name, *k);
        *k += 1;
        id
    };
    let mut mat_ids: HashMap<String, i64> = HashMap::new();
    // ( each node's ids: GameObject, Transform, filter, renderer )
    let mut ids = vec![];
    for (i, n) in nodes.iter().enumerate() {
        let root = single && n.parent.is_none();
        let name = if root { file_name.clone() } else { n.name.clone() };
        let (go, tr, mf, mr) = if root { (ROOT_GO, ROOT_TR, ROOT_MF, ROOT_MR) } else { (id_of("GameObject", &name), id_of("Transform", &name), id_of("MeshFilter", &name), id_of("MeshRenderer", &name)) };
        ids.push((go, tr, mf, mr, name));
        let _ = i;
    }
    let (root_go, root_tr) = (ROOT_GO, ROOT_TR);
    if !single {
        objs.push(Obj { class_id: 1, id: root_go, stripped: false, script: String::new(), value: v(vec![("m_Name", Value::Str(file_name.clone())), ("m_IsActive", Value::Int(1)), ("m_Component", Value::List(vec![v(vec![("component", r(root_tr))])]))]) });
        let kids: Vec<Value> = (0..nodes.len()).filter(|&i| nodes[i].parent == Some(usize::MAX)).map(|i| r(ids[i].1)).collect();
        objs.push(Obj { class_id: 4, id: root_tr, stripped: false, script: String::new(), value: v(vec![("m_GameObject", r(root_go)), ("m_LocalPosition", xyz([0.0; 3])), ("m_LocalRotation", v(vec![("x", Value::Float(0.0)), ("y", Value::Float(0.0)), ("z", Value::Float(0.0)), ("w", Value::Float(1.0))])), ("m_LocalScale", xyz([1.0; 3])), ("m_Children", Value::List(kids)), ("m_Father", r(0))]) });
    }
    for (i, n) in nodes.iter().enumerate() {
        let (go, tr, mf, mr, name) = ids[i].clone();
        let father = match n.parent {
            Some(usize::MAX) => root_tr,
            Some(p) => ids[p].1,
            None => 0,
        };
        let kids: Vec<Value> = (0..nodes.len()).filter(|&k| nodes[k].parent == Some(i)).map(|k| r(ids[k].1)).collect();
        let mut comps = vec![v(vec![("component", r(tr))])];
        if n.mesh.is_some() {
            comps.push(v(vec![("component", r(mf))]));
            comps.push(v(vec![("component", r(mr))]));
        }
        objs.push(Obj { class_id: 1, id: go, stripped: false, script: String::new(), value: v(vec![("m_Name", Value::Str(name.clone())), ("m_IsActive", Value::Int(1)), ("m_Component", Value::List(comps))]) });
        // ( the root keeps the file's axes turned, its own placement Unity zeroes )
        objs.push(Obj {
            class_id: 4,
            id: tr,
            stripped: false,
            script: String::new(),
            value: v(vec![
                ("m_GameObject", r(go)),
                ("m_LocalPosition", xyz(n.t)),
                ("m_LocalRotation", v(vec![("x", Value::Float(n.r.0 as f64)), ("y", Value::Float(n.r.1 as f64)), ("z", Value::Float(n.r.2 as f64)), ("w", Value::Float(n.r.3 as f64))])),
                ("m_LocalScale", xyz(n.s)),
                ("m_Children", Value::List(kids)),
                ("m_Father", r(father)),
            ]),
        });
        let Some(m) = &n.mesh else { continue };
        let mesh_name = n.name.clone();
        let mid = id_of("Mesh", &mesh_name);
        objs.push(Obj { class_id: 43, id: mid, stripped: false, script: String::new(), value: mesh_value(&mesh_name, m) });
        objs.push(Obj { class_id: 33, id: mf, stripped: false, script: String::new(), value: v(vec![("m_GameObject", r(go)), ("m_Mesh", r(mid))]) });
        let mut mats = vec![];
        for (mname, tex, color) in &n.mats {
            if let Some(ext) = remap.get(mname) {
                mats.push(ext.clone());
                continue;
            }
            if !import_mats {
                mats.push(r(0));
                continue;
            }
            let id = *mat_ids.entry(mname.clone()).or_insert_with(|| import_id("Material", mname, 0));
            if !objs.iter().any(|o| o.id == id) {
                let mut envs = vec![];
                if let Some(t) = tex.as_deref().and_then(texture) {
                    let tv = v(vec![("m_Texture", v(vec![("fileID", Value::Int(2800000)), ("guid", Value::Str(t.clone()))])), ("m_Scale", v(vec![("x", Value::Float(1.0)), ("y", Value::Float(1.0))])), ("m_Offset", v(vec![("x", Value::Float(0.0)), ("y", Value::Float(0.0))]))]);
                    envs.push(v(vec![("_BaseMap", tv)]));
                }
                let col = v(vec![("r", Value::Float(color[0] as f64)), ("g", Value::Float(color[1] as f64)), ("b", Value::Float(color[2] as f64)), ("a", Value::Float(color[3] as f64))]);
                objs.push(Obj {
                    class_id: 21,
                    id,
                    stripped: false,
                    script: String::new(),
                    value: v(vec![
                        ("m_Name", Value::Str(mname.clone())),
                        ("m_SavedProperties", v(vec![("m_TexEnvs", Value::List(envs)), ("m_Floats", Value::List(vec![])), ("m_Colors", Value::List(vec![v(vec![("_BaseColor", col)])]))])),
                    ]),
                });
            }
            mats.push(r(id));
        }
        objs.push(Obj { class_id: 23, id: mr, stripped: false, script: String::new(), value: v(vec![("m_GameObject", r(go)), ("m_Materials", Value::List(mats)), ("m_CastShadows", Value::Int(1))]) });
    }
    Ok(objs)
}

// ---- FBX

/// An FBX's Euler rotation ( degrees ) in its rotation order ( 0 XYZ … 5 ZYX: the first applied first ).
fn fbx_euler(e: [f64; 3], order: i64) -> Mat4 {
    let rx = Mat4::trs([0.0; 3], axis_q([1.0, 0.0, 0.0], e[0]), [1.0; 3]);
    let ry = Mat4::trs([0.0; 3], axis_q([0.0, 1.0, 0.0], e[1]), [1.0; 3]);
    let rz = Mat4::trs([0.0; 3], axis_q([0.0, 0.0, 1.0], e[2]), [1.0; 3]);
    // ( the first named turns first: XYZ is Rz·Ry·Rx )
    match order {
        1 => ry.mul(&rz).mul(&rx),
        2 => rx.mul(&rz).mul(&ry),
        3 => rz.mul(&rx).mul(&ry),
        4 => ry.mul(&rx).mul(&rz),
        5 => rx.mul(&ry).mul(&rz),
        _ => rz.mul(&ry).mul(&rx),
    }
}

fn axis_q(a: [f64; 3], deg: f64) -> Quat {
    let (s, c) = ((deg.to_radians() * 0.5).sin() as f32, (deg.to_radians() * 0.5).cos() as f32);
    Quat(a[0] as f32 * s, a[1] as f32 * s, a[2] as f32 * s, c)
}

fn tm(t: [f64; 3]) -> Mat4 {
    Mat4::trs([t[0] as f32, t[1] as f32, t[2] as f32], Quat::IDENTITY, [1.0; 3])
}

fn sm(s: [f64; 3]) -> Mat4 {
    Mat4::trs([0.0; 3], Quat::IDENTITY, [s[0] as f32, s[1] as f32, s[2] as f32])
}

/// A model node's local matrix, FBX's way: T · Roff · Rp · Rpre · R · Rpost⁻¹ · Rp⁻¹ · Soff · Sp · S · Sp⁻¹.
fn local(m: &Node) -> Mat4 {
    let order = m.p70_i("RotationOrder", 0);
    let t = m.p70_vec("Lcl Translation", [0.0; 3]);
    let r = m.p70_vec("Lcl Rotation", [0.0; 3]);
    let s = m.p70_vec("Lcl Scaling", [1.0; 3]);
    let roff = m.p70_vec("RotationOffset", [0.0; 3]);
    let rp = m.p70_vec("RotationPivot", [0.0; 3]);
    let pre = m.p70_vec("PreRotation", [0.0; 3]);
    let post = m.p70_vec("PostRotation", [0.0; 3]);
    let soff = m.p70_vec("ScalingOffset", [0.0; 3]);
    let sp = m.p70_vec("ScalingPivot", [0.0; 3]);
    let neg = |a: [f64; 3]| [-a[0], -a[1], -a[2]];
    tm(t).mul(&tm(roff)).mul(&tm(rp)).mul(&fbx_euler(pre, 0)).mul(&fbx_euler(r, order)).mul(&fbx_euler(post, 0).inverse()).mul(&tm(neg(rp))).mul(&tm(soff)).mul(&tm(sp)).mul(&sm(s)).mul(&tm(neg(sp)))
}

/// A matrix's translation, rotation and scale ( no shear ).
fn decompose(m: &Mat4) -> ([f32; 3], Quat, [f32; 3]) {
    let c = |i: usize| [m.0[i][0], m.0[i][1], m.0[i][2]];
    let len = |a: [f32; 3]| (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt();
    let (x, y, z) = (c(0), c(1), c(2));
    let det = x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0]);
    let mut s = [len(x), len(y), len(z)];
    if det < 0.0 {
        s[0] = -s[0];
    }
    let nx = x.map(|v| v / s[0].abs().max(1e-12) * s[0].signum());
    let ny = y.map(|v| v / s[1].max(1e-12));
    let nz = z.map(|v| v / s[2].max(1e-12));
    // ( rows of the rotation: columns nx, ny, nz )
    let (m00, m01, m02, m10, m11, m12, m20, m21, m22) = (nx[0], ny[0], nz[0], nx[1], ny[1], nz[1], nx[2], ny[2], nz[2]);
    let tr = m00 + m11 + m22;
    let q = if tr > 0.0 {
        let k = (tr + 1.0).sqrt() * 2.0;
        Quat((m21 - m12) / k, (m02 - m20) / k, (m10 - m01) / k, 0.25 * k)
    } else if m00 > m11 && m00 > m22 {
        let k = (1.0 + m00 - m11 - m22).sqrt() * 2.0;
        Quat(0.25 * k, (m01 + m10) / k, (m02 + m20) / k, (m21 - m12) / k)
    } else if m11 > m22 {
        let k = (1.0 + m11 - m00 - m22).sqrt() * 2.0;
        Quat((m01 + m10) / k, 0.25 * k, (m12 + m21) / k, (m02 - m20) / k)
    } else {
        let k = (1.0 + m22 - m00 - m11).sqrt() * 2.0;
        Quat((m02 + m20) / k, (m12 + m21) / k, 0.25 * k, (m10 - m01) / k)
    };
    (m.position(), q.normalized(), s)
}

/// The file's axes ( GlobalSettings ) as a turn to Y up, Z the file's front ( right-handed ).
fn axis_matrix(g: Option<&Node>) -> Mat4 {
    let Some(g) = g else { return Mat4::IDENTITY };
    let up = g.p70_i("UpAxis", 1) as usize;
    let ups = g.p70_i("UpAxisSign", 1) as f32;
    let front = g.p70_i("FrontAxis", 2) as usize;
    let fs = g.p70_i("FrontAxisSign", 1) as f32;
    let coord = g.p70_i("CoordAxis", 0) as usize;
    let cs = g.p70_i("CoordAxisSign", 1) as f32;
    // the file's x, y, z axes each become one of Unity's ( right-handed ): coord → +X, up → +Y, front → +Z
    let mut m = Mat4::IDENTITY;
    for c in 0..3 {
        m.0[c] = [0.0, 0.0, 0.0, 0.0];
    }
    m.0[coord.min(2)][0] = cs;
    m.0[up.min(2)][1] = ups;
    m.0[front.min(2)][2] = fs;
    m.0[3] = [0.0, 0.0, 0.0, 1.0];
    m
}

fn fbx_name(p: Option<&fbx::Prop>) -> String {
    let s = p.map(|p| p.str()).unwrap_or("");
    // ( "Name\0\x01Class" in binary files, "Class::Name" in ASCII ones )
    if let Some(i) = s.find('\0') {
        return s[..i].to_string();
    }
    s.split("::").last().unwrap_or(s).to_string()
}

fn fbx_nodes(data: &[u8], global_scale: f32, use_file_scale: bool) -> Result<Vec<BNode>> {
    let root = fbx::parse(data)?;
    let objects = root.child("Objects").context("an FBX without objects")?;
    let gs = root.child("GlobalSettings");
    let unit = gs.map(|g| g.p70_f("UnitScaleFactor", 1.0)).unwrap_or(1.0);
    // ( centimetres the file's units are, made metres, as "Use File Scale" does )
    let s = global_scale * if use_file_scale { (unit / 100.0) as f32 } else { 1.0 };
    let axes = axis_matrix(gs);
    let by_id: HashMap<i64, &Node> = objects.children.iter().filter_map(|n| n.prop(0).map(|p| (p.i64(), n))).collect();
    // connections: child → parent ( object to object ), and object → [ children ] in order
    let mut parent_of: HashMap<i64, i64> = HashMap::new();
    let mut kids: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut tex_of: HashMap<i64, i64> = HashMap::new();
    if let Some(conns) = root.child("Connections") {
        for c in conns.all("C") {
            let kind = c.prop(0).map(|p| p.str()).unwrap_or("");
            let (a, b) = (c.prop(1).map(|p| p.i64()).unwrap_or(0), c.prop(2).map(|p| p.i64()).unwrap_or(0));
            if kind == "OO" {
                kids.entry(b).or_default().push(a);
                if by_id.get(&a).map(|n| n.name == "Model").unwrap_or(false) && (b == 0 || by_id.get(&b).map(|n| n.name == "Model").unwrap_or(false)) {
                    parent_of.insert(a, b);
                }
            } else if kind == "OP" && c.prop(3).map(|p| p.str().contains("DiffuseColor") || p.str() == "Maya|baseColor").unwrap_or(false) {
                tex_of.insert(b, a);
            }
        }
    }
    let models: Vec<i64> = objects.all("Model").filter_map(|m| m.prop(0).map(|p| p.i64())).collect();
    let index: HashMap<i64, usize> = models.iter().enumerate().map(|(i, &id)| (id, i)).collect();
    let h = Mat4::trs([0.0; 3], Quat::IDENTITY, [-1.0, 1.0, 1.0]);
    let mut out = vec![];
    for &id in &models {
        let m = by_id[&id];
        let parent = parent_of.get(&id).and_then(|p| index.get(p).copied());
        let mut l = local(m);
        // ( units into the translation; the file's axes, at the top; X mirrored either side )
        l.0[3][0] *= s;
        l.0[3][1] *= s;
        l.0[3][2] *= s;
        if parent.is_none() {
            l = axes.mul(&l);
        }
        let lu = h.mul(&l).mul(&h);
        let (t, q, sc) = decompose(&lu);
        let geo = kids.get(&id).and_then(|k| k.iter().find_map(|c| by_id.get(c).filter(|n| n.name == "Geometry" && n.prop(2).map(|p| p.str() == "Mesh").unwrap_or(true)).copied()));
        let mats: Vec<(String, Option<String>, [f32; 4])> = kids
            .get(&id)
            .map(|k| {
                k.iter()
                    .filter_map(|c| by_id.get(c).filter(|n| n.name == "Material").map(|n| (c, n)))
                    .map(|(c, n)| {
                        let col = n.p70_vec("DiffuseColor", [1.0; 3]);
                        let tex = tex_of.get(c).and_then(|t| by_id.get(t)).and_then(|t| t.child("RelativeFilename").or_else(|| t.child("FileName"))).and_then(|f| f.prop(0)).map(|p| p.str().replace('\\', "/"));
                        (fbx_name(n.prop(1)), tex, [col[0] as f32, col[1] as f32, col[2] as f32, 1.0])
                    })
                    .collect()
            })
            .unwrap_or_default();
        let gt = m.p70_vec("GeometricTranslation", [0.0; 3]);
        let gr = m.p70_vec("GeometricRotation", [0.0; 3]);
        let gsc = m.p70_vec("GeometricScaling", [1.0; 3]);
        let geom = tm(gt).mul(&fbx_euler(gr, 0)).mul(&sm(gsc));
        let mats = if mats.is_empty() { vec![("No Name".into(), None, [1.0; 4])] } else { mats };
        let (mesh, mats) = match geo.map(|g| fbx_mesh(g, &geom, s, mats.len())) {
            Some((mut b, order)) => {
                // ( Unity's submeshes: the materials in the order the polygons first use them, unused ones left out )
                let subs = std::mem::take(&mut b.subs);
                b.subs = order.iter().map(|&k| subs[k].clone()).collect();
                tangents(&mut b);
                (Some(b), order.iter().map(|&k| mats[k].clone()).collect())
            }
            None => (None, mats),
        };
        out.push(BNode { name: fbx_name(m.prop(1)), parent, t, r: q, s: sc, mesh, mats });
    }
    Ok(out)
}

/// A layer element's value for a polygon corner ( `pv`: the corner's index, `cp` its control point, `poly` its
/// polygon ), as its mapping and reference say.
fn layer_index(e: &Node, values: &str, index: &str, pv: usize, cp: usize, poly: usize) -> Option<usize> {
    let map = e.child("MappingInformationType").and_then(|n| n.prop(0)).map(|p| p.str().to_string()).unwrap_or_default();
    let refr = e.child("ReferenceInformationType").and_then(|n| n.prop(0)).map(|p| p.str().to_string()).unwrap_or_default();
    let _ = values;
    let i = match map.as_str() {
        "ByPolygonVertex" => pv,
        "ByVertex" | "ByVertice" | "ByControlPoint" => cp,
        "ByPolygon" => poly,
        _ => 0,
    };
    if refr == "IndexToDirect" || refr == "Index" {
        let idx = e.child(index)?.prop(0)?.ints();
        idx.get(i).map(|&v| v.max(0) as usize)
    } else {
        Some(i)
    }
}

/// A geometry's mesh, a submesh per material, and the materials in the order its polygons first use them.
fn fbx_mesh(g: &Node, geom: &Mat4, s: f32, mats: usize) -> (Built, Vec<usize>) {
    let verts = g.child("Vertices").and_then(|n| n.prop(0)).map(|p| p.floats()).unwrap_or_default();
    let pvi = g.child("PolygonVertexIndex").and_then(|n| n.prop(0)).map(|p| p.ints()).unwrap_or_default();
    let normals = g.child("LayerElementNormal");
    let nvals = normals.and_then(|e| e.child("Normals")).and_then(|n| n.prop(0)).map(|p| p.floats()).unwrap_or_default();
    let uv_layers: Vec<&Node> = g.all("LayerElementUV").collect();
    let uv_vals: Vec<Vec<f64>> = uv_layers.iter().map(|e| e.child("UV").and_then(|n| n.prop(0)).map(|p| p.floats()).unwrap_or_default()).collect();
    let colors = g.child("LayerElementColor");
    let cvals = colors.and_then(|e| e.child("Colors")).and_then(|n| n.prop(0)).map(|p| p.floats()).unwrap_or_default();
    let mat_layer = g.child("LayerElementMaterial");
    let mat_vals = mat_layer.and_then(|e| e.child("Materials")).and_then(|n| n.prop(0)).map(|p| p.ints()).unwrap_or_default();
    let h = |p: [f32; 3]| [-p[0], p[1], p[2]];
    let gn = geom.inverse();
    let cpos = |i: usize| -> [f32; 3] {
        let p = [verts.get(i * 3).copied().unwrap_or(0.0) as f32, verts.get(i * 3 + 1).copied().unwrap_or(0.0) as f32, verts.get(i * 3 + 2).copied().unwrap_or(0.0) as f32];
        let p = geom.point(p);
        h([p[0] * s, p[1] * s, p[2] * s])
    };
    // polygons: their corners ( corner index, control point )
    let mut polys: Vec<Vec<(usize, usize)>> = vec![];
    let mut cur = vec![];
    for (k, &v) in pvi.iter().enumerate() {
        let (cp, end) = if v < 0 { ((-v - 1) as usize, true) } else { (v as usize, false) };
        cur.push((k, cp));
        if end {
            polys.push(std::mem::take(&mut cur));
        }
    }
    // the polygons' own normals ( for those it has none of, made from the faces round them )
    let face_n: Vec<[f32; 3]> = polys
        .iter()
        .map(|p| {
            let mut n = [0f32; 3];
            for i in 0..p.len() {
                let (a, b) = (cpos(p[i].1), cpos(p[(i + 1) % p.len()].1));
                n[0] += (a[1] - b[1]) * (a[2] + b[2]);
                n[1] += (a[2] - b[2]) * (a[0] + b[0]);
                n[2] += (a[0] - b[0]) * (a[1] + b[1]);
            }
            let l = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt().max(1e-12);
            n.map(|x| x / l)
        })
        .collect();
    let mut faces_at: HashMap<usize, Vec<usize>> = HashMap::new();
    if normals.is_none() {
        for (pi, p) in polys.iter().enumerate() {
            for &(_, cp) in p {
                faces_at.entry(cp).or_default().push(pi);
            }
        }
    }
    let cos_limit = (60f32).to_radians().cos();
    let mut out = Built { uv: vec![vec![]; uv_layers.len()], subs: vec![vec![]; mats], ..Default::default() };
    let mut weld: HashMap<Vec<u32>, u32> = HashMap::new();
    let mut order: Vec<usize> = vec![];
    for (pi, p) in polys.iter().enumerate() {
        // ( its material: one for all, or each polygon's )
        let all_same = mat_layer.and_then(|e| e.child("MappingInformationType")).and_then(|n| n.prop(0)).map(|p| p.str() == "AllSame").unwrap_or(true);
        let mi = (if all_same { mat_vals.first() } else { mat_vals.get(pi) }).map(|&v| v.max(0) as usize).unwrap_or(0).min(mats - 1);
        if !order.contains(&mi) {
            order.push(mi);
        }
        let mut corner_ids = vec![];
        let cps: Vec<usize> = p.iter().map(|c| c.1).collect();
        for &(pv, cp) in p {
            let pos = cpos(cp);
            let nrm = if let Some(e) = normals {
                let i = layer_index(e, "Normals", "NormalsIndex", pv, cp, pi).unwrap_or(0);
                let n = [nvals.get(i * 3).copied().unwrap_or(0.0) as f32, nvals.get(i * 3 + 1).copied().unwrap_or(0.0) as f32, nvals.get(i * 3 + 2).copied().unwrap_or(1.0) as f32];
                // ( by the inverse transpose of the geometric transform )
                let t = [0, 1, 2].map(|r| gn.0[r][0] * n[0] + gn.0[r][1] * n[1] + gn.0[r][2] * n[2]);
                let l = (t[0] * t[0] + t[1] * t[1] + t[2] * t[2]).sqrt().max(1e-12);
                h(t.map(|x| x / l))
            } else {
                let me = face_n[pi];
                let mut acc = [0f32; 3];
                for &f in faces_at.get(&cp).map(|v| v.as_slice()).unwrap_or(&[]) {
                    let o = face_n[f];
                    if o[0] * me[0] + o[1] * me[1] + o[2] * me[2] >= cos_limit {
                        acc = [acc[0] + o[0], acc[1] + o[1], acc[2] + o[2]];
                    }
                }
                let l = (acc[0] * acc[0] + acc[1] * acc[1] + acc[2] * acc[2]).sqrt().max(1e-12);
                acc.map(|x| x / l)
            };
            let uvs: Vec<[f32; 2]> = uv_layers
                .iter()
                .enumerate()
                .map(|(k, e)| {
                    let i = layer_index(e, "UV", "UVIndex", pv, cp, pi).unwrap_or(0);
                    [uv_vals[k].get(i * 2).copied().unwrap_or(0.0) as f32, uv_vals[k].get(i * 2 + 1).copied().unwrap_or(0.0) as f32]
                })
                .collect();
            let col = colors.map(|e| {
                let i = layer_index(e, "Colors", "ColorIndex", pv, cp, pi).unwrap_or(0);
                [0, 1, 2, 3].map(|c| (cvals.get(i * 4 + c).copied().unwrap_or(1.0).clamp(0.0, 1.0) * 255.0 + 0.5) as u8)
            });
            // ( a vertex for each different corner: the same ones welded )
            // ( corners alike to within float noise are one vertex, as Unity welds them )
            let q = |f: f32, k: f32| ((f * k).round() as i64) as u32;
            let mut key: Vec<u32> = pos.iter().map(|&f| q(f, 1e6)).chain(nrm.iter().map(|&f| q(f, 1e4))).collect();
            key.extend(uvs.iter().flat_map(|u| [q(u[0], 1e5), q(u[1], 1e5)]));
            if let Some(c) = col {
                key.push(u32::from_le_bytes(c));
            }
            let id = *weld.entry(key).or_insert_with(|| {
                out.pos.push(pos);
                out.nrm.push(nrm);
                for (k, u) in uvs.iter().enumerate() {
                    out.uv[k].push(*u);
                }
                if let Some(c) = col {
                    out.col.push(c);
                }
                out.pos.len() as u32 - 1
            });
            corner_ids.push(id);
        }
        // a fan, wound the other way ( X is mirrored ), triangles with two corners at one place left out
        for i in 1..corner_ids.len().saturating_sub(1) {
            let (a, b, c) = (cpos(cps[0]), cpos(cps[i + 1]), cpos(cps[i]));
            if a == b || b == c || a == c {
                continue;
            }
            out.subs[mi].extend([corner_ids[0], corner_ids[i + 1], corner_ids[i]]);
        }
    }
    (out, order)
}

/// Tangents ( a normal map's direction along U ), each vertex's from the triangles round it, made square to its
/// normal, w the side its V runs.
fn tangents(b: &mut Built) {
    let n = b.pos.len();
    let Some(uv) = b.uv.first().filter(|u| u.len() == n) else { return };
    if b.nrm.len() != n {
        return;
    }
    let (mut t, mut bt) = (vec![[0f32; 3]; n], vec![[0f32; 3]; n]);
    for sub in &b.subs {
        for tri in sub.chunks_exact(3) {
            let [i, j, k] = [tri[0] as usize, tri[1] as usize, tri[2] as usize];
            let (p0, p1, p2) = (b.pos[i], b.pos[j], b.pos[k]);
            let (u0, u1, u2) = (uv[i], uv[j], uv[k]);
            let e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
            let e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
            let (s1, t1, s2, t2) = (u1[0] - u0[0], u1[1] - u0[1], u2[0] - u0[0], u2[1] - u0[1]);
            let d = s1 * t2 - s2 * t1;
            if d.abs() < 1e-12 {
                continue;
            }
            let r = 1.0 / d;
            let sd = [0, 1, 2].map(|c| (e1[c] * t2 - e2[c] * t1) * r);
            let td = [0, 1, 2].map(|c| (e2[c] * s1 - e1[c] * s2) * r);
            for v in [i, j, k] {
                for c in 0..3 {
                    t[v][c] += sd[c];
                    bt[v][c] += td[c];
                }
            }
        }
    }
    let mut out = Vec::with_capacity(n);
    for v in 0..n {
        let nn = b.nrm[v];
        let d = nn[0] * t[v][0] + nn[1] * t[v][1] + nn[2] * t[v][2];
        let mut x = [t[v][0] - nn[0] * d, t[v][1] - nn[1] * d, t[v][2] - nn[2] * d];
        let l = (x[0] * x[0] + x[1] * x[1] + x[2] * x[2]).sqrt();
        x = if l < 1e-12 { [1.0, 0.0, 0.0] } else { x.map(|c| c / l) };
        let cr = [nn[1] * x[2] - nn[2] * x[1], nn[2] * x[0] - nn[0] * x[2], nn[0] * x[1] - nn[1] * x[0]];
        let w = if cr[0] * bt[v][0] + cr[1] * bt[v][1] + cr[2] * bt[v][2] < 0.0 { -1.0 } else { 1.0 };
        out.push([x[0], x[1], x[2], w]);
    }
    b.tan = out;
}

// ---- OBJ

fn obj_nodes(path: &Path, global_scale: f32) -> Result<Vec<BNode>> {
    let (models, mats) = tobj::load_obj(path, &tobj::LoadOptions { triangulate: true, single_index: true, ..Default::default() })?;
    let mats = mats.unwrap_or_default();
    let mut out = vec![];
    for m in models {
        let me = &m.mesh;
        let n = me.positions.len() / 3;
        let mut b = Built::default();
        for i in 0..n {
            b.pos.push([-me.positions[i * 3] * global_scale, me.positions[i * 3 + 1] * global_scale, me.positions[i * 3 + 2] * global_scale]);
        }
        if me.normals.len() == n * 3 {
            b.nrm = (0..n).map(|i| [-me.normals[i * 3], me.normals[i * 3 + 1], me.normals[i * 3 + 2]]).collect();
        }
        if me.texcoords.len() == n * 2 {
            b.uv = vec![(0..n).map(|i| [me.texcoords[i * 2], me.texcoords[i * 2 + 1]]).collect()];
        }
        let tris: Vec<u32> = me.indices.chunks_exact(3).flat_map(|t| [t[0], t[2], t[1]]).collect();
        b.subs = vec![tris];
        tangents(&mut b);
        let mat = me.material_id.and_then(|i| mats.get(i));
        let mname = mat.map(|m| m.name.clone()).unwrap_or_else(|| "defaultMat".into());
        let tex = mat.and_then(|m| m.diffuse_texture.clone());
        let col = mat.and_then(|m| m.diffuse).map(|d| [d[0], d[1], d[2], 1.0]).unwrap_or([1.0; 4]);
        out.push(BNode { name: if m.name.is_empty() { "default".into() } else { m.name.clone() }, parent: None, t: [0.0; 3], r: Quat::IDENTITY, s: [1.0; 3], mesh: Some(b), mats: vec![(mname, tex, col)] });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    #[test]
    fn hashes_as_unity_numbers_imported_objects() {
        // ( from a Unity import of URP's SamplesFixture.fbx )
        assert_eq!(super::import_id("Mesh", "SamplesFixture", 0), -4111048765868826698);
        assert_eq!(super::import_id("Material", "Steel", 0), -3155047780354543793);
        assert_eq!(super::xxh64(b""), 0xEF46DB3751D8E999);
    }
}
