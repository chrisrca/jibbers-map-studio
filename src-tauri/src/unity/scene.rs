//! A scene as Unity has it in the editor: its own objects and its prefab instances' ( their prefabs' objects with the
//! instance's changes applied, nested prefabs and variants too ), GameObjects with their components, the transform
//! hierarchy, world transforms, and a reference from any of them followed to what it means.

use std::collections::HashMap;
use std::path::Path;
use std::rc::Rc;

use anyhow::{Context, Result};

use super::files::{UFile, UnityProject};
use super::math::{Mat4, Quat};
use super::value::{PPtr, Value};

// ( Unity's ids for a prefab instance's objects with no placeholder: the instance's xor the object's own )
const ID_MASK: i64 = 0x7fff_ffff_ffff_ffff;

/// An object of the scene: a GameObject, Transform or component, as read with its instance's changes.
#[derive(Clone, Debug)]
pub struct SObj {
    pub class_id: i32,
    pub value: Value,
    /// A MonoBehaviour's script guid.
    pub script: String,
    /// The file ( and keys ) its references are read in.
    ctx: usize,
    removed: bool,
    /// Holds a reference changed by a prefab instance ( read in that instance's file, `__ctx` ).
    marked: bool,
    /// Its id in the file it's from.
    id: i64,
}

#[derive(Clone)]
struct Ctx {
    file: Rc<UFile>,
    keys: HashMap<i64, usize>,
}

#[derive(Clone, Default)]
struct Graph {
    objs: Vec<SObj>,
    ctxs: Vec<Ctx>,
}

impl Graph {
    /// `other`'s objects and contexts added: where they start.
    fn append(&mut self, other: &Graph) -> (usize, usize) {
        let (o, c) = (self.objs.len(), self.ctxs.len());
        self.objs.extend(other.objs.iter().map(|x| {
            let mut y = SObj { ctx: x.ctx + c, ..x.clone() };
            // ( a changed reference says which file it's read in: renumbered as the files are )
            if c > 0 && x.marked {
                shift_ctx(&mut y.value, c as i64);
            }
            y
        }));
        self.ctxs.extend(other.ctxs.iter().map(|x| Ctx { file: x.file.clone(), keys: x.keys.iter().map(|(k, v)| (*k, v + o)).collect() }));
        (o, c)
    }
}

/// What's referred to: an object of the scene, or another asset's ( a mesh, a material, a texture ).
pub enum Target {
    Scene(usize),
    Asset(Rc<UFile>, i64),
    /// An asset Unity imports from a file of its own ( an image, a model ), and which of its objects.
    Source(std::path::PathBuf, i64),
}

pub struct GameObject {
    pub obj: usize,
    pub name: String,
    pub active_self: bool,
    pub components: Vec<usize>,
    pub transform: Option<usize>,
    pub parent: Option<usize>,
    pub children: Vec<usize>,
}

pub struct Scene<'p> {
    pub project: &'p UnityProject,
    g: Graph,
    pub gos: Vec<GameObject>,
    go_of_obj: HashMap<usize, usize>,
    world: Vec<Option<Mat4>>,
}

impl<'p> Scene<'p> {
    pub fn load(project: &'p UnityProject, path: &Path) -> Result<Scene<'p>> {
        let mut cache = HashMap::new();
        let g = container(project, path, &mut cache, 0)?;
        let mut s = Scene { project, g, gos: vec![], go_of_obj: HashMap::new(), world: vec![] };
        s.build();
        Ok(s)
    }

    pub fn obj(&self, i: usize) -> &SObj {
        &self.g.objs[i]
    }

    /// Where a reference from scene object `from` leads ( an asset kept in a prefab's or model's own file — its mesh,
    /// its material — as that asset ).
    pub fn follow(&self, from: usize, v: &Value) -> Option<Target> {
        let ctx = v.get("__ctx");
        let ci = if ctx.is_null() { self.g.objs[from].ctx } else { ctx.i64() as usize };
        match follow_in(self.project, &self.g, ci, &v.pptr())? {
            Target::Scene(i) if [43, 21, 28, 156].contains(&self.g.objs[i].class_id) => {
                let o = &self.g.objs[i];
                Some(Target::Asset(self.g.ctxs[o.ctx].file.clone(), o.id))
            }
            t => Some(t),
        }
    }

    /// The scene object a reference from `from` leads to, if it's one.
    pub fn follow_scene(&self, from: usize, v: &Value) -> Option<usize> {
        match self.follow(from, v)? {
            Target::Scene(i) if !self.g.objs[i].removed => Some(i),
            _ => None,
        }
    }

    /// The GameObject a component belongs to.
    pub fn go_of(&self, comp: usize) -> Option<usize> {
        self.go_of_obj.get(&comp).copied()
    }

    /// A GameObject's component of class `class_id` ( 114 with `script` its script's name ).
    pub fn component(&self, go: usize, class_id: i32, script: &str) -> Option<usize> {
        self.gos[go].components.iter().copied().find(|&c| {
            let o = &self.g.objs[c];
            o.class_id == class_id && (script.is_empty() || self.project.script_name(&o.script) == script)
        })
    }

    /// Every component of `class_id` ( and `script` ) under GameObject `go`, it included, as Unity's
    /// GetComponentsInChildren finds them: in hierarchy order, only active ones unless `inactive`.
    pub fn components_in_children(&self, go: usize, class_id: i32, script: &str, inactive: bool) -> Vec<usize> {
        let mut out = vec![];
        let mut stack = vec![go];
        while let Some(g) = stack.pop() {
            if !inactive && !self.gos[g].active_self {
                continue;
            }
            for &c in &self.gos[g].components {
                let o = &self.g.objs[c];
                if o.class_id == class_id && (script.is_empty() || self.project.script_name(&o.script) == script) {
                    out.push(c);
                }
            }
            stack.extend(self.gos[g].children.iter().rev());
        }
        out
    }

    /// Every component of the scene of `class_id` ( and `script` ).
    pub fn all(&self, class_id: i32, script: &str) -> Vec<usize> {
        (0..self.gos.len())
            .flat_map(|g| self.gos[g].components.clone())
            .filter(|&c| {
                let o = &self.g.objs[c];
                o.class_id == class_id && (script.is_empty() || self.project.script_name(&o.script) == script)
            })
            .collect()
    }

    pub fn active_in_hierarchy(&self, mut go: usize) -> bool {
        loop {
            if !self.gos[go].active_self {
                return false;
            }
            match self.gos[go].parent {
                Some(p) => go = p,
                None => return true,
            }
        }
    }

    /// The GameObject's transform in the world.
    pub fn world(&self, go: usize) -> Mat4 {
        self.world.get(go).copied().flatten().unwrap_or(Mat4::IDENTITY)
    }

    /// Its local position, rotation and scale.
    pub fn local(&self, go: usize) -> ([f32; 3], Quat, [f32; 3]) {
        match self.gos[go].transform {
            Some(t) => trs(&self.g.objs[t].value),
            None => ([0.0; 3], Quat::IDENTITY, [1.0; 3]),
        }
    }

    /// Its world rotation ( the parents' rotations times its own ).
    pub fn rotation(&self, go: usize) -> Quat {
        let mut q = self.local(go).1;
        let mut p = self.gos[go].parent;
        while let Some(i) = p {
            q = self.local(i).1.mul(q);
            p = self.gos[i].parent;
        }
        q
    }

    fn build(&mut self) {
        let n = self.g.objs.len();
        // GameObjects
        let mut go_index = HashMap::new();
        for i in 0..n {
            let o = &self.g.objs[i];
            if o.class_id == 1 && !o.removed && !is_stub(&o.value) {
                go_index.insert(i, self.gos.len());
                self.gos.push(GameObject {
                    obj: i,
                    name: o.value.get("m_Name").str().to_string(),
                    active_self: o.value.get("m_IsActive").bool_or(true),
                    components: vec![],
                    transform: None,
                    parent: None,
                    children: vec![],
                });
            }
        }
        // components: each to the GameObject it says it's on
        for i in 0..n {
            let o = &self.g.objs[i];
            if o.class_id == 1 || o.class_id == 1001 || o.removed || is_stub(&o.value) {
                continue;
            }
            let Some(go) = self.follow_scene(i, o.value.get("m_GameObject")).and_then(|x| go_index.get(&x).copied()) else { continue };
            self.gos[go].components.push(i);
            self.go_of_obj.insert(i, go);
            if o.class_id == 4 || o.class_id == 224 {
                self.gos[go].transform = Some(i);
            }
        }
        // the hierarchy, children in their transform's order
        for go in 0..self.gos.len() {
            let Some(t) = self.gos[go].transform else { continue };
            let father = self.g.objs[t].value.get("m_Father").clone();
            if let Some(p) = self.follow_scene(t, &father).and_then(|f| self.go_of_obj.get(&f).copied()) {
                if p != go {
                    self.gos[go].parent = Some(p);
                }
            }
        }
        for go in 0..self.gos.len() {
            if let Some(p) = self.gos[go].parent {
                self.gos[p].children.push(go);
            }
        }
        for go in 0..self.gos.len() {
            let Some(t) = self.gos[go].transform else { continue };
            let order: Vec<usize> = self.g.objs[t].value.get("m_Children").list().iter().filter_map(|c| self.follow_scene(t, c)).collect();
            let mut kids = std::mem::take(&mut self.gos[go].children);
            kids.sort_by_key(|&k| self.gos[k].transform.and_then(|kt| order.iter().position(|&x| x == kt)).unwrap_or(usize::MAX));
            self.gos[go].children = kids;
        }
        // world transforms, parents first
        self.world = vec![None; self.gos.len()];
        for go in 0..self.gos.len() {
            self.world_of(go);
        }
    }

    fn world_of(&mut self, go: usize) -> Mat4 {
        if let Some(m) = self.world[go] {
            return m;
        }
        let (p, q, s) = self.local(go);
        let local = Mat4::trs(p, q, s);
        let m = match self.gos[go].parent {
            Some(par) => self.world_of(par).mul(&local),
            None => local,
        };
        self.world[go] = Some(m);
        m
    }

    /// The scene's root GameObjects.
    pub fn roots(&self) -> Vec<usize> {
        (0..self.gos.len()).filter(|&g| self.gos[g].parent.is_none()).collect()
    }
}

/// A transform's local position, rotation and scale.
pub fn trs(v: &Value) -> ([f32; 3], Quat, [f32; 3]) {
    let s = v.get("m_LocalScale");
    let q = v.get("m_LocalRotation").xyzw();
    (v.get("m_LocalPosition").xyz(), Quat(q[0], q[1], q[2], q[3]), if s.is_null() { [1.0; 3] } else { s.xyz() })
}

fn shift_ctx(v: &mut Value, by: i64) {
    match v {
        Value::Map(m) => {
            for (k, x) in m.iter_mut() {
                if k == "__ctx" {
                    *x = Value::Int(x.i64() + by);
                } else {
                    shift_ctx(x, by);
                }
            }
        }
        Value::List(l) => l.iter_mut().for_each(|x| shift_ctx(x, by)),
        _ => {}
    }
}

fn is_stub(v: &Value) -> bool {
    !v.get("m_PrefabInstance").pptr().is_null() && !v.get("m_CorrespondingSourceObject").pptr().is_null()
}

fn follow_in(project: &UnityProject, g: &Graph, ci: usize, p: &PPtr) -> Option<Target> {
    if p.is_null() {
        return None;
    }
    let ctx = &g.ctxs[ci];
    let guid = ctx.file.guid_of(p);
    let own = guid.is_empty() || project.path_of(&guid).map(|x| x == &ctx.file.path).unwrap_or(false);
    if own {
        return ctx.keys.get(&p.path).map(|&i| Target::Scene(i));
    }
    let path = project.path_of(&guid)?;
    if !super::files::is_unity_file(path) {
        return Some(Target::Source(path.clone(), p.path));
    }
    let f = project.file_of_guid(&guid)?;
    Some(Target::Asset(f, p.path))
}

/// Where a reference from an object of asset file `file` leads ( a material's to its textures and shader ).
pub fn follow_from_file(project: &UnityProject, file: &Rc<UFile>, v: &Value) -> Option<Target> {
    let p = v.pptr();
    if p.is_null() {
        return None;
    }
    let guid = file.guid_of(&p);
    if guid.is_empty() {
        return Some(Target::Asset(file.clone(), p.path));
    }
    let path = project.path_of(&guid)?;
    if !super::files::is_unity_file(path) {
        return Some(Target::Source(path.clone(), p.path));
    }
    Some(Target::Asset(project.file_of_guid(&guid)?, p.path))
}

/// A scene's or prefab's objects, its prefab instances' expanded.
fn container(project: &UnityProject, path: &Path, cache: &mut HashMap<std::path::PathBuf, Graph>, depth: usize) -> Result<Graph> {
    if let Some(g) = cache.get(path) {
        return Ok(g.clone());
    }
    if depth > 16 {
        anyhow::bail!("prefabs nested too deep at {}", path.display());
    }
    let file = project.file(path)?;
    let mut g = Graph::default();
    g.ctxs.push(Ctx { file: file.clone(), keys: HashMap::new() });
    for o in &file.objects {
        if o.class_id == 1001 || o.stripped || is_stub(&o.value) {
            continue;
        }
        let i = g.objs.len();
        g.objs.push(SObj { class_id: o.class_id, value: o.value.clone(), script: o.script.clone(), ctx: 0, removed: false, marked: false, id: o.id });
        g.ctxs[0].keys.insert(o.id, i);
    }
    // ( each instance: the source prefab's keys, as it numbers its objects, to where they are here now )
    let mut instances: HashMap<i64, HashMap<i64, usize>> = HashMap::new();
    for o in file.objects.iter().filter(|o| o.class_id == 1001) {
        let src = o.value.get("m_SourcePrefab").pptr();
        let guid = file.guid_of(&src);
        let Some(src_path) = project.path_of(&guid).cloned() else { continue };
        let Ok(sg) = container(project, &src_path, cache, depth + 1) else { continue };
        let (off, _) = g.append(&sg);
        let keys: HashMap<i64, usize> = sg.ctxs[0].keys.iter().map(|(k, v)| (*k, v + off)).collect();
        for (k, v) in &keys {
            g.ctxs[0].keys.entry((o.id ^ k) & ID_MASK).or_insert(*v);
        }
        let m = o.value.get("m_Modification");
        // the instance's changes, each to the object of the prefab it targets
        for md in m.get("m_Modifications").list() {
            let target = md.get("target").pptr().path;
            let pp = md.get("propertyPath").str();
            // ( a model made here, not read from Unity's import: a change to one of its objects whose id isn't
            // Unity's goes to the root's, by what it changes )
            let fallback = || -> Option<usize> {
                if !super::files::is_model(&src_path) {
                    return None;
                }
                let root_of = |class: i32| (off..off + sg.objs.len()).find(|&i| g.objs[i].class_id == class);
                let root_tr = (off..off + sg.objs.len()).find(|&i| g.objs[i].class_id == 4 && g.objs[i].value.get("m_Father").pptr().is_null());
                if pp.starts_with("m_Local") || pp == "m_RootOrder" {
                    root_tr
                } else if pp.starts_with("m_Materials") || pp.starts_with("m_CastShadows") {
                    root_of(23)
                } else if ["m_Name", "m_IsActive", "m_Layer", "m_TagString", "m_StaticEditorFlags"].contains(&pp) {
                    root_tr.and_then(|t| g.objs[t].value.get("m_GameObject").pptr().path.into()).and_then(|id: i64| keys.get(&id).copied())
                } else {
                    None
                }
            };
            let Some(ti) = keys.get(&target).copied().or_else(fallback) else { continue };
            let r = md.get("objectReference");
            let value = if !r.pptr().is_null() {
                let mut rv = r.clone();
                if let Value::Map(f) = &mut rv {
                    f.push(("__ctx".into(), Value::Int(0)));
                }
                rv
            } else {
                md.get("value").clone()
            };
            g.objs[ti].marked |= !r.pptr().is_null();
            set_path(&mut g.objs[ti].value, md.get("propertyPath").str(), value);
        }
        for rc in m.get("m_RemovedComponents").list().iter().chain(m.get("m_RemovedGameObjects").list()) {
            if let Some(&ti) = keys.get(&rc.pptr().path) {
                g.objs[ti].removed = true;
            }
        }
        // the instance's root under the transform it was put under ( or none )
        let parent = m.get("m_TransformParent").clone();
        let roots: Vec<usize> = (off..off + sg.objs.len()).filter(|&i| (g.objs[i].class_id == 4 || g.objs[i].class_id == 224) && g.objs[i].value.get("m_Father").pptr().is_null()).collect();
        for r in roots {
            let mut pv = parent.clone();
            if let Value::Map(f) = &mut pv {
                f.push(("__ctx".into(), Value::Int(0)));
            }
            g.objs[r].marked = true;
            set_path(&mut g.objs[r].value, "m_Father", pv);
        }
        instances.insert(o.id, keys);
    }
    // placeholders: to the instance's object they stand for
    for o in &file.objects {
        if !(o.stripped || is_stub(&o.value)) || o.class_id == 1001 {
            continue;
        }
        let inst = o.value.get("m_PrefabInstance").pptr().path;
        let src = o.value.get("m_CorrespondingSourceObject").pptr().path;
        if let Some(&i) = instances.get(&inst).and_then(|k| k.get(&src)) {
            g.ctxs[0].keys.insert(o.id, i);
        }
    }
    cache.insert(path.to_path_buf(), g.clone());
    Ok(g)
}

/// A modification's property path ( "m_LocalPosition.x", "parameters.Array.data[2].floatValue",
/// "chunks.Array.size" ) set to `v`.
fn set_path(root: &mut Value, path: &str, v: Value) {
    let parts: Vec<&str> = path.split('.').collect();
    let mut cur = root;
    let mut i = 0;
    while i < parts.len() {
        let last = i == parts.len() - 1;
        let p = parts[i];
        if p == "Array" && i + 1 < parts.len() {
            let next = parts[i + 1];
            if !matches!(cur, Value::List(_)) {
                *cur = Value::List(vec![]);
            }
            let Value::List(l) = cur else { return };
            if next == "size" {
                let n = v.i64().max(0) as usize;
                let fill = l.last().cloned().unwrap_or(Value::Map(vec![]));
                l.resize(n, fill);
                return;
            }
            let Some(idx) = next.strip_prefix("data[").and_then(|s| s.strip_suffix(']')).and_then(|s| s.parse::<usize>().ok()) else { return };
            if l.len() <= idx {
                let fill = l.last().cloned().unwrap_or(Value::Map(vec![]));
                l.resize(idx + 1, fill);
            }
            if i + 1 == parts.len() - 1 {
                l[idx] = v;
                return;
            }
            cur = &mut l[idx];
            i += 2;
            continue;
        }
        if !matches!(cur, Value::Map(_)) {
            *cur = Value::Map(vec![]);
        }
        let Value::Map(m) = cur else { return };
        let k = match m.iter().position(|(k, _)| k == p) {
            Some(k) => k,
            None => {
                m.push((p.to_string(), Value::Null));
                m.len() - 1
            }
        };
        if last {
            m[k].1 = v;
            return;
        }
        cur = &mut m[k].1;
        i += 1;
    }
}

/// The scene's file read as a scene.
pub fn open<'p>(project: &'p UnityProject, scene: &Path) -> Result<Scene<'p>> {
    Scene::load(project, scene).with_context(|| format!("reading the scene {}", scene.display()))
}
