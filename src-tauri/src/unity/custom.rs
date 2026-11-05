//! MapExporter's custom pieces: each CustomMapObject's mesh parts ( meshes and textures into the map's libraries, by
//! Unity's asset keys ), materials as its shaders give them, colliders, LOD groups and lights; a terrain's trees.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use indexmap::IndexMap;

use crate::jbrmap::{Collider, ColliderShape, Color, CustomObject, LodGroup, Light, Material, MaterialProp, MeshData, Part, SurfaceType, TextureData, TreePrototype, Vec2};

use super::export::{props, v3};
use super::files::{UFile, UnityProject};
use super::math::{Mat4, Quat};
use super::mesh::mesh_data;
use super::scene::{follow_from_file, Scene, Target};
use super::shader::{self, Kind, Shader};
use super::texture;
use super::value::Value;

const CORE: [&str; 15] = ["_BaseMap", "_BaseColor", "_MetallicMap", "_Metallic", "_RoughnessMap", "_Smoothness", "_NormalMap", "_EmissionMap", "_EmissionColor", "_Cull", "_Cutoff", "_SrcBlend", "_DstBlend", "_ZWrite", "_RenderMode"];

/// The map's mesh and texture libraries, filled as pieces use them, and what's been read once.
#[derive(Default)]
pub struct Libs {
    pub meshes: IndexMap<String, MeshData>,
    pub textures: IndexMap<String, TextureData>,
    shaders: RefCell<HashMap<PathBuf, Option<Rc<Shader>>>>,
    pub warnings: Vec<String>,
}

/// AssetDatabase.GetAssetPath made Map-Tools' key: the path under Assets ( or Packages/… ), no extension, a
/// sub-asset's name after it; built-in assets "builtin/<name>".
pub fn asset_key(project: &UnityProject, path: &Path, main: bool, name: &str) -> String {
    let fname = path.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    if fname == "unity default resources" || fname == "unity_builtin_extra" {
        return format!("builtin/{name}");
    }
    let rel = path.strip_prefix(&project.root).unwrap_or(path).to_string_lossy().replace('\\', "/");
    let rel = rel.strip_prefix("Assets/").map(|s| s.to_string()).unwrap_or(rel);
    let rel = match rel.rfind('.') {
        Some(d) if d > 0 && !rel[d..].contains('/') => rel[..d].to_string(),
        _ => rel,
    };
    if main { rel } else { format!("{rel}/{name}") }
}

impl Libs {
    fn shader(&self, path: &Path) -> Option<Rc<Shader>> {
        self.shaders.borrow_mut().entry(path.to_path_buf()).or_insert_with(|| shader::read(path).map(Rc::new)).clone()
    }

    /// A mesh a renderer or collider refers to: into the library under its key.
    fn mesh(&mut self, s: &Scene, t: Option<Target>) -> Option<String> {
        let p = s.project;
        match t? {
            Target::Asset(f, id) => {
                let o = f.get(id)?;
                let name = o.value.get("m_Name").str().to_string();
                let key = asset_key(p, &f.path, o.id == o.class_id as i64 * 100000, &name);
                if !self.meshes.contains_key(&key) {
                    match mesh_data(&o.value) {
                        Ok(m) => {
                            self.meshes.insert(key.clone(), m);
                        }
                        Err(e) => {
                            self.warnings.push(format!("{e:#}"));
                            return None;
                        }
                    }
                }
                Some(key)
            }
            Target::Source(..) | Target::Scene(_) => None,
        }
    }

    /// A texture a material refers to: into the library under its key.
    fn texture(&mut self, s: &Scene, t: Option<Target>) -> Option<String> {
        let p = s.project;
        let t = t?;
        let (key, data) = match &t {
            Target::Source(path, _) => {
                let key = asset_key(p, path, true, "");
                if self.textures.contains_key(&key) {
                    return Some(key);
                }
                match texture::from_source(path) {
                    Ok(i) => (key, TextureData { format: 4, width: i.image.w as i32, height: i.image.h as i32, encoding: "png".into(), linear: i.linear, mipmaps: i.mipmaps, compression: i.compression, data: Some(super::export::png(&i.image)) }),
                    Err(e) => {
                        self.warnings.push(format!("{e:#}"));
                        return None;
                    }
                }
            }
            Target::Asset(f, id) => {
                let o = f.get(*id)?;
                if o.class_id != 28 {
                    return None;
                }
                let key = asset_key(p, &f.path, o.id == 2800000, o.value.get("m_Name").str());
                if self.textures.contains_key(&key) {
                    return Some(key);
                }
                match texture::from_object(&o.value) {
                    Ok(i) => (key, TextureData { format: 4, width: i.w as i32, height: i.h as i32, encoding: "png".into(), linear: !o.value.get("m_ColorSpace").bool_or(true), mipmaps: o.value.get("m_MipCount").i32() > 1, compression: 1, data: Some(super::export::png(&i)) }),
                    Err(e) => {
                        self.warnings.push(format!("{}: {e:#}", o.value.get("m_Name").str()));
                        return None;
                    }
                }
            }
            Target::Scene(_) => return None,
        };
        self.textures.insert(key.clone(), data);
        Some(key)
    }

    /// A material slot, as ExtractPart fills CustomMapObjectMaterialData ( `mat`: none, Unity's defaults ).
    fn material(&mut self, s: &Scene, mat: Option<(Rc<UFile>, Value)>) -> Material {
        let Some((file, m)) = mat else { return Material::default() };
        let sh = follow_from_file(s.project, &file, m.get("m_Shader")).and_then(|t| match t {
            Target::Source(p, _) => self.shader(&p),
            _ => None,
        });
        let tex = props(&m, "m_TexEnvs");
        let floats: Vec<(String, &Value)> = props(&m, "m_Floats").into_iter().chain(props(&m, "m_Ints")).collect();
        let colors = props(&m, "m_Colors");
        let has = |n: &str| match &sh {
            Some(sh) => sh.prop(n).is_some(),
            None => tex.iter().any(|(k, _)| k == n) || floats.iter().any(|(k, _)| k == n) || colors.iter().any(|(k, _)| k == n),
        };
        let float = |n: &str| -> f32 {
            floats.iter().find(|(k, _)| k == n).map(|(_, v)| v.f32()).or_else(|| sh.as_ref().and_then(|s| s.prop(n)).map(|p| p.default[0])).unwrap_or(0.0)
        };
        let color = |n: &str| -> [f32; 4] {
            colors.iter().find(|(k, _)| k == n).map(|(_, v)| if v.get("r").is_null() { v.xyzw() } else { v.rgba() }).or_else(|| sh.as_ref().and_then(|s| s.prop(n)).map(|p| p.default)).unwrap_or([0.0, 0.0, 0.0, 1.0])
        };
        let env = |n: &str| tex.iter().find(|(k, _)| k == n).map(|(_, v)| *v);
        // ( Material.shaderKeywords: the ones its shader declares, then the ones it doesn't )
        let keywords: Vec<String> = if !m.get("m_ValidKeywords").is_null() {
            m.get("m_ValidKeywords").list().iter().chain(m.get("m_InvalidKeywords").list()).map(|k| k.str().to_string()).collect()
        } else {
            m.get("m_ShaderKeywords").str().split_whitespace().map(|s| s.to_string()).collect()
        };
        let queue = match m.get("m_CustomRenderQueue").i32_or(-1) {
            -1 => sh.as_ref().map(|s| s.queue).unwrap_or(2000),
            q => q,
        };
        let mut texkey = |me: &mut Self, n: &str| -> String {
            if !has(n) {
                return String::new();
            }
            let Some(e) = env(n) else { return String::new() };
            me.texture(s, follow_from_file(s.project, &file, e.get("m_Texture"))).unwrap_or_default()
        };
        let base = env("_BaseMap").filter(|_| has("_BaseMap"));
        let c = |a: [f32; 4]| Color { r: a[0], g: a[1], b: a[2], a: a[3] };
        let mut out = Material {
            base_tex: texkey(self, "_BaseMap"),
            metallic_tex: texkey(self, "_MetallicMap"),
            roughness_tex: texkey(self, "_RoughnessMap"),
            normal_tex: texkey(self, "_NormalMap"),
            emission_tex: texkey(self, "_EmissionMap"),
            render_mode: if queue >= 3000 { 2 } else if keywords.iter().any(|k| k == "_ALPHATEST_ON") { 1 } else { 0 },
            alpha_cutoff: if has("_Cutoff") { float("_Cutoff") } else { 0.5 },
            tiling: base.map(|e| { let v = e.get("m_Scale").xyz(); Vec2 { x: v[0], y: v[1] } }).unwrap_or(Vec2 { x: 1.0, y: 1.0 }),
            offset: base.map(|e| { let v = e.get("m_Offset").xyz(); Vec2 { x: v[0], y: v[1] } }).unwrap_or_default(),
            cull_mode: if has("_Cull") { float("_Cull") as i32 } else { 2 },
            base_color: if has("_BaseColor") { c(color("_BaseColor")) } else { Color::WHITE },
            emission_color: if has("_EmissionColor") { c(color("_EmissionColor")) } else { Color::BLACK },
            metallic: if has("_Metallic") { float("_Metallic") } else { 0.0 },
            smoothness: if has("_Smoothness") { float("_Smoothness") } else { 0.0 },
            lit: sh.as_ref().map(|s| s.name != "Custom/CustomObjectUnlit").unwrap_or(true),
            keywords,
            name: m.get("m_Name").str().to_string(),
            ..Default::default()
        };
        // ExtractExtras: every other property of the shader
        let mut extras = IndexMap::new();
        let list: Vec<(String, Kind)> = match &sh {
            Some(sh) => sh.props.iter().map(|p| (p.name.clone(), p.kind)).collect(),
            None => tex.iter().map(|(k, _)| (k.clone(), Kind::Texture)).chain(floats.iter().map(|(k, _)| (k.clone(), Kind::Float))).chain(colors.iter().map(|(k, _)| (k.clone(), Kind::Color))).collect(),
        };
        for (n, kind) in list {
            if CORE.contains(&n.as_str()) {
                continue;
            }
            match kind {
                Kind::Float => {
                    extras.insert(n.clone(), MaterialProp::Float(float(&n)));
                }
                Kind::Color => {
                    extras.insert(n.clone(), MaterialProp::Color(color(&n)));
                }
                Kind::Vector => {
                    extras.insert(n.clone(), MaterialProp::Vector(color(&n)));
                }
                Kind::Texture => {
                    let Some(e) = env(&n) else { continue };
                    if let Some(k) = self.texture(s, follow_from_file(s.project, &file, e.get("m_Texture"))) {
                        extras.insert(n.clone(), MaterialProp::Texture(k));
                    }
                }
            }
        }
        out.extra_props = extras;
        out
    }
}

/// The materials a renderer has ( each its file and fields ).
fn renderer_materials(s: &Scene, r: usize) -> Vec<Option<(Rc<UFile>, Value)>> {
    s.obj(r)
        .value
        .get("m_Materials")
        .list()
        .iter()
        .map(|m| match s.follow(r, m) {
            Some(Target::Asset(f, id)) => f.get(id).map(|o| (f.clone(), o.value.clone())),
            _ => None,
        })
        .collect()
}

/// ExtractPart: a mesh renderer's part, its transform world space ( as Map-Tools writes it ).
fn part(s: &Scene, libs: &mut Libs, comp: usize, renderer: Option<usize>) -> Option<Part> {
    let go = s.go_of(comp)?;
    let mesh_ref = s.obj(comp).value.get("m_Mesh").clone();
    let key = libs.mesh(s, s.follow(comp, &mesh_ref))?;
    let subs = libs.meshes.get(&key).map(|m| m.submeshes.len()).unwrap_or(1);
    let mats = renderer.map(|r| renderer_materials(s, r)).unwrap_or_default();
    let slots = subs.min(mats.len()).max(1);
    let materials = (0..slots).map(|i| libs.material(s, mats.get(i).cloned().flatten())).collect();
    let q = s.rotation(go);
    Some(Part {
        mesh: key,
        local_position: v3(s.world(go).position()),
        local_rotation: v3(q.euler_angles()),
        local_scale: v3(s.world(go).lossy_scale(q)),
        materials,
        shadow_casting_mode: renderer.map(|r| s.obj(r).value.get("m_CastShadows").i32_or(1)).unwrap_or(1),
        ..Default::default()
    })
}

const COLLIDERS: [i32; 4] = [65, 135, 136, 64];

/// The components of `classes` under `go` in hierarchy order ( a GameObject's in its component order ).
fn in_children(s: &Scene, go: usize, classes: &[i32], inactive: bool) -> Vec<usize> {
    let mut out = vec![];
    let mut stack = vec![go];
    while let Some(g) = stack.pop() {
        if !inactive && !s.gos[g].active_self {
            continue;
        }
        out.extend(s.gos[g].components.iter().copied().filter(|&c| classes.contains(&s.obj(c).class_id)));
        stack.extend(s.gos[g].children.iter().rev());
    }
    out
}

/// ColliderFromUnity.
fn collider(s: &Scene, libs: &mut Libs, c: usize) -> Option<Collider> {
    let go = s.go_of(c)?;
    let v = &s.obj(c).value;
    let q = s.rotation(go);
    let w = s.world(go);
    let mut cd = Collider {
        shape: ColliderShape::Box,
        surface_type: SurfaceType::Generic,
        local_position: v3([0.0; 3]),
        local_rotation: v3(q.euler_angles()),
        local_scale: v3(w.lossy_scale(q)),
        center: v3([0.0; 3]),
        size: v3([0.0; 3]),
        radius: 0.0,
        height: 0.0,
        direction: 0,
        mesh_ref: String::new(),
    };
    let mut center = [0.0; 3];
    match s.obj(c).class_id {
        65 => {
            cd.shape = ColliderShape::Box;
            center = v.get("m_Center").xyz();
            cd.size = v3(v.get("m_Size").xyz());
        }
        135 => {
            cd.shape = ColliderShape::Sphere;
            center = v.get("m_Center").xyz();
            cd.radius = v.get("m_Radius").f32();
        }
        136 => {
            cd.shape = ColliderShape::Capsule;
            center = v.get("m_Center").xyz();
            cd.radius = v.get("m_Radius").f32();
            cd.height = v.get("m_Height").f32();
            cd.direction = v.get("m_Direction").i32();
        }
        64 => {
            if !v.get("m_Convex").bool() {
                libs.warnings.push(format!("the MeshCollider on '{}' isn't convex: left out, as Map-Tools does", s.gos[go].name));
                return None;
            }
            cd.shape = ColliderShape::Mesh;
            cd.mesh_ref = libs.mesh(s, s.follow(c, v.get("m_Mesh")))?;
        }
        _ => return None,
    }
    cd.center = v3(center);
    cd.local_position = v3(w.point(center));
    Some(cd)
}

fn surface(s: &str) -> Option<SurfaceType> {
    match s {
        "Generic" => Some(SurfaceType::Generic),
        "Snow" => Some(SurfaceType::Snow),
        "Jib" => Some(SurfaceType::Jib),
        _ => None,
    }
}

/// LOD groups under `root` ( relative to it ), and each renderer's group and level.
fn lods(s: &Scene, root: usize, inactive: bool, inv: &Mat4) -> (Vec<LodGroup>, HashMap<usize, (i32, i32)>) {
    let mut groups = vec![];
    let mut map = HashMap::new();
    for (g, lg) in in_children(s, root, &[205], inactive).into_iter().enumerate() {
        let v = &s.obj(lg).value;
        let levels = v.get("m_LODs").list();
        for (l, lod) in levels.iter().enumerate() {
            for r in lod.get("renderers").list() {
                if let Some(ri) = s.follow_scene(lg, r.get("renderer")) {
                    map.insert(ri, (g as i32, l as i32));
                }
            }
        }
        let at = s.go_of(lg).map(|x| s.world(x).position()).unwrap_or([0.0; 3]);
        groups.push(LodGroup {
            local_position: v3(inv.point(at)),
            local_reference_point: v3(v.get("m_LocalReferencePoint").xyz()),
            size: v.get("m_Size").f32_or(1.0),
            fade_mode: v.get("m_FadeMode").i32(),
            animate_crossfading: v.get("m_AnimateCrossFading").bool(),
            transitions: levels.iter().map(|l| l.get("screenRelativeHeight").f32()).collect(),
            fade_widths: levels.iter().map(|l| l.get("fadeTransitionWidth").f32()).collect(),
        });
    }
    (groups, map)
}

/// The chunk's custom pieces: those under its terrain, then those under its object container.
pub fn custom_objects(s: &Scene, libs: &mut Libs, terrain_go: usize, container: Option<usize>) -> Vec<CustomObject> {
    let mut found = s.components_in_children(terrain_go, 114, "CustomMapObject", false);
    if let Some(c) = container {
        for o in s.components_in_children(c, 114, "CustomMapObject", false) {
            if !found.contains(&o) {
                found.push(o);
            }
        }
    }
    let mut out = vec![];
    for obj in found {
        let Some(root) = s.go_of(obj) else { continue };
        let v = &s.obj(obj).value;
        let inv = s.world(root).inverse();
        let (lod_groups, lod_of) = lods(s, root, false, &inv);
        let mut parts = vec![];
        for mf in in_children(s, root, &[33], false) {
            let go = s.go_of(mf).unwrap();
            let mr = s.component(go, 23, "");
            if let Some(mut p) = part(s, libs, mf, mr) {
                if let Some(&(g, l)) = mr.and_then(|r| lod_of.get(&r)) {
                    p.lod_group_index = g;
                    p.lod_index = l;
                }
                parts.push(p);
            }
        }
        for smr in in_children(s, root, &[137], false) {
            if let Some(mut p) = part(s, libs, smr, Some(smr)) {
                if let Some(&(g, l)) = lod_of.get(&smr) {
                    p.lod_group_index = g;
                    p.lod_index = l;
                }
                parts.push(p);
            }
        }
        let st = SurfaceType::from_i32(v.get("surfaceType").i32());
        let colliders: Vec<Collider> = in_children(s, root, &COLLIDERS, false)
            .into_iter()
            .filter_map(|c| {
                let mut cd = collider(s, libs, c)?;
                let tag = s.go_of(c).map(|g| s.obj(s.gos[g].obj).value.get("m_TagString").str().to_string()).unwrap_or_default();
                cd.surface_type = surface(&tag).unwrap_or(st);
                Some(cd)
            })
            .collect();
        let lights: Vec<Light> = in_children(s, root, &[108], false)
            .into_iter()
            .filter_map(|l| {
                let lv = &s.obj(l).value;
                let ty = lv.get("m_Type").i32();
                if ty != 0 && ty != 2 {
                    return None;
                }
                let go = s.go_of(l)?;
                let c = lv.get("m_Color").rgba();
                Some(Light {
                    light_type: ty,
                    local_position: v3(s.world(go).position()),
                    local_rotation: v3(s.rotation(go).euler_angles()),
                    color: Color { r: c[0], g: c[1], b: c[2], a: c[3] },
                    intensity: lv.get("m_Intensity").f32_or(1.0),
                    range: lv.get("m_Range").f32_or(10.0),
                    spot_angle: lv.get("m_SpotAngle").f32_or(30.0),
                    inner_spot_angle: lv.get("m_InnerSpotAngle").f32_or(21.8),
                    shadows: lv.at("m_Shadows.m_Type").i32(),
                    shadow_strength: lv.at("m_Shadows.m_Strength").f32_or(1.0),
                })
            })
            .collect();
        if parts.is_empty() && lights.is_empty() {
            continue;
        }
        let q = s.rotation(root);
        out.push(CustomObject {
            surface_type: st,
            can_stabilize: v.get("canStabilize").bool_or(true),
            can_rotate: v.get("canRotate").bool_or(true),
            can_magnetize: v.get("canMagnetize").bool_or(true),
            intended_up_method: v.get("intendedUpMethod").i32(),
            disable_distance_culling: v.get("disableDistanceCulling").bool(),
            timed_visibility: v.get("timedVisibility").bool(),
            visible_from_hour: v.get("visibleFromHour").f32_or(19.0),
            visible_until_hour: v.get("visibleUntilHour").f32_or(6.0),
            position: v3(s.world(root).position()),
            rotation: v3(q.euler_angles()),
            scale: v3(s.world(root).lossy_scale(q)),
            parts,
            colliders,
            lod_groups,
            lights,
            studio: Default::default(),
        });
    }
    out
}

/// ExtractTrees: the terrain's tree prototypes that have trees, each built from its prefab ( or, an official
/// object's, by its id ), with its trees packed.
pub fn trees(s: &Scene, libs: &mut Libs, td: &Value, td_file: Option<&Rc<UFile>>, terrain: usize) -> Vec<TreePrototype> {
    // ( kept with the details since 2019, in a database of their own before )
    let db = if td.get("m_TreeDatabase").is_null() { td.get("m_DetailDatabase") } else { td.get("m_TreeDatabase") };
    let protos = db.get("m_TreePrototypes").list();
    let insts = if db.get("m_TreeInstances").is_null() { db.get("m_Trees").list() } else { db.get("m_TreeInstances").list() };
    let mut out = vec![];
    for (pi, proto) in protos.iter().enumerate() {
        let mine: Vec<&Value> = insts.iter().filter(|t| t.get("index").i32() as usize == pi).collect();
        if mine.is_empty() {
            continue;
        }
        let target = match td_file {
            Some(f) => follow_from_file(s.project, f, proto.get("prefab")),
            None => s.follow(terrain, proto.get("prefab")),
        };
        let Some(path) = (match target {
            Some(Target::Asset(f, _)) => Some(f.path.clone()),
            _ => None,
        }) else {
            continue;
        };
        let Ok(ps) = super::scene::Scene::load(s.project, &path) else { continue };
        let Some(root) = ps.roots().into_iter().next() else { continue };
        let mut data = TreePrototype::default();
        if let Some(mo) = ps.component(root, 114, "MapObject") {
            let id = ps.obj(mo).value.get("id").str().to_string();
            if !id.is_empty() {
                data.object_id = id;
                data.instances = Some(pack_trees(&mine));
                out.push(data);
                continue;
            }
        }
        let rw = ps.world(root);
        let inv = rw.inverse();
        let rq = ps.rotation(root);
        let rs = rw.lossy_scale(rq);
        let rel = |a: [f32; 3]| [0, 1, 2].map(|i| if rs[i] != 0.0 { a[i] / rs[i] } else { a[i] });
        let local_rot = |q: Quat| Quat(-rq.0, -rq.1, -rq.2, rq.3).mul(q).euler_angles();
        let (lod_groups, lod_of) = lods(&ps, root, true, &inv);
        for mf in in_children(&ps, root, &[33], true) {
            let go = ps.go_of(mf).unwrap();
            let mr = ps.component(go, 23, "");
            if let Some(mut p) = part(&ps, libs, mf, mr) {
                let q = ps.rotation(go);
                p.local_position = v3(inv.point(ps.world(go).position()));
                p.local_rotation = v3(local_rot(q));
                p.local_scale = v3(rel(ps.world(go).lossy_scale(q)));
                if let Some(&(g, l)) = mr.and_then(|r| lod_of.get(&r)) {
                    p.lod_group_index = g;
                    p.lod_index = l;
                }
                data.parts.push(p);
            }
        }
        data.lod_groups = lod_groups;
        for c in in_children(&ps, root, &COLLIDERS, true) {
            let Some(mut cd) = collider(&ps, libs, c) else { continue };
            let go = ps.go_of(c).unwrap();
            let q = ps.rotation(go);
            cd.surface_type = SurfaceType::Generic;
            cd.local_position = v3(inv.point([cd.local_position.x, cd.local_position.y, cd.local_position.z]));
            cd.local_rotation = v3(local_rot(q));
            cd.local_scale = v3(rel(ps.world(go).lossy_scale(q)));
            data.colliders.push(cd);
        }
        data.instances = Some(pack_trees(&mine));
        out.push(data);
    }
    out
}

/// PackTreeInstances: position ( 0..1 of the terrain ), width and height scale, rotation, colour.
fn pack_trees(list: &[&Value]) -> Vec<u8> {
    let mut b = Vec::with_capacity(list.len() * TreePrototype::INSTANCE_STRIDE);
    for t in list {
        let p = t.get("position").xyz();
        for f in [p[0], p[1], p[2], t.get("widthScale").f32_or(1.0), t.get("heightScale").f32_or(1.0), t.get("rotation").f32()] {
            b.extend_from_slice(&f.to_le_bytes());
        }
        let c = t.get("color");
        let ch = |k: &str| c.get(k).i64().clamp(0, 255) as u8;
        if c.get("r").is_null() {
            // ( a ColorRGBA kept as one packed number, r in its low byte )
            b.extend_from_slice(&(c.get("rgba").i64() as u32).to_le_bytes());
        } else {
            b.extend([ch("r"), ch("g"), ch("b"), ch("a")]);
        }
    }
    b
}
