//! Maps' pieces in your library: a map's custom pieces and materials taken into a folder of its own (each piece in
//! its own frame, grouped and named), or the folder removed.

use super::*;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FromMap {
    /// the map file the pieces were taken from
    pub path: String,
    pub map_id: String,
    pub name: String,
}

/// The folders in your library made from maps' pieces.
pub fn library_maps() -> Result<Vec<(PathBuf, FromMap)>> {
    let mut out = vec![];
    for e in std::fs::read_dir(user_root()?)?.flatten() {
        let f = e.path().join(FROM_MAP);
        if let Some(m) = std::fs::read(&f).ok().and_then(|b| serde_json::from_slice::<FromMap>(&b).ok()) {
            out.push((e.path(), m));
        }
    }
    out.sort_by_key(|a| a.1.name.to_lowercase());
    Ok(out)
}

/// A map's name without the game's rich-text tags, else its file's name.
pub(crate) fn map_label(map: &MapData, path: &Path) -> String {
    let mut name = String::new();
    let mut tag = false;
    for c in map.name.chars() {
        match c {
            '<' => tag = true,
            '>' if tag => tag = false,
            _ if !tag => name.push(c),
            _ => {}
        }
    }
    let name = name.trim().to_string();
    if name.is_empty() { path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Map".into()) } else { name }
}

/// Takes every distinct custom piece of a map (pivot moved to the origin) and each of its materials into a folder of
/// their own in your library: `<map name>/<the author's folder>/<piece>`, materials in `<map name>/Materials`.
/// Returns the folder and how many pieces.
pub fn add_map(map_path: &Path) -> Result<(PathBuf, usize)> {
    let root = user_root()?;
    let map = crate::jbrmap::load(map_path).with_context(|| format!("read {}", map_path.display()))?;
    if let Some((dir, _)) = library_maps()?.into_iter().find(|(_, f)| f.map_id == map.id) {
        anyhow::bail!("its pieces are already in your library ({})", dir.file_name().unwrap_or_default().to_string_lossy());
    }
    let label = map_label(&map, map_path);
    let mut dest = root.join(file_name(&label));
    let mut n = 2;
    while dest.exists() {
        dest = root.join(format!("{} {n}", file_name(&label)));
        n += 1;
    }
    // keys under the map's id, so two maps' "Cube" meshes can't take each other's place in a project
    let rekey = |k: &str| if k.is_empty() { String::new() } else { format!("{}/{k}", map.id) };
    let objects: Vec<CustomObject> = map.chunks.iter().flat_map(|c| c.custom_objects.iter().cloned()).collect();
    // Some exports also wrote each part of a multi-part piece as its own object; keep the whole pieces only.
    let in_multi: HashSet<&str> = objects.iter().filter(|o| o.parts.len() > 1).flat_map(|o| o.parts.iter().map(|p| p.mesh.as_str())).collect();
    let mut seen = HashSet::new();
    let mut count = 0;
    for o in &objects {
        if o.parts.iter().all(|p| p.mesh.is_empty()) || (o.parts.len() == 1 && in_multi.contains(o.parts[0].mesh.as_str())) {
            continue;
        }
        let local = to_local(o);
        if !seen.insert(signature(&local)) {
            continue; // another copy of a piece we already have
        }
        let (group, name) = piece_group_and_name(&local);
        let (mesh_keys, tex_keys) = uses(&local);
        let meshes = mesh_keys.iter().filter_map(|k| map.mesh_library.get(k).map(|m| (rekey(k), m.clone()))).collect();
        let textures = tex_keys.iter().filter_map(|k| map.texture_library.get(k).map(|t| (rekey(k), t.clone()))).collect();
        let mut object = local;
        rekey_object(&mut object, &rekey);
        save_object(&dest.join(group), &name, object, meshes, textures)?;
        count += 1;
    }
    // its trees built from its own meshes (tree prototypes, any map's): each kind a piece to place like any other
    for t in map.chunks.iter().flat_map(|c| &c.tree_prototypes).filter(|t| t.object_id.is_empty() && t.parts.iter().any(|p| !p.mesh.is_empty())) {
        let local = CustomObject { parts: t.parts.clone(), colliders: t.colliders.clone(), lod_groups: t.lod_groups.clone(), ..CustomObject::default() };
        if !seen.insert(signature(&local)) {
            continue;
        }
        let (_, name) = piece_group_and_name(&local);
        let (mesh_keys, tex_keys) = uses(&local);
        let meshes = mesh_keys.iter().filter_map(|k| map.mesh_library.get(k).map(|m| (rekey(k), m.clone()))).collect();
        let textures = tex_keys.iter().filter_map(|k| map.texture_library.get(k).map(|t| (rekey(k), t.clone()))).collect();
        let mut object = local;
        rekey_object(&mut object, &rekey);
        save_object(&dest.join("Trees"), &name, object, meshes, textures)?;
        count += 1;
    }
    // its materials, each once
    let mut mat_seen = HashSet::new();
    for o in &objects {
        for p in &o.parts {
            for m in &p.materials {
                if !mat_seen.insert(serde_json::to_string(m)?) {
                    continue;
                }
                let textures = material_textures(m).filter_map(|k| map.texture_library.get(&k).map(|t| (rekey(&k), t.clone()))).collect();
                let mut material = m.clone();
                rekey_material(&mut material, &rekey);
                save_material(&dest.join("Materials"), &material_name(m), material, textures)?;
            }
        }
    }
    std::fs::create_dir_all(&dest)?;
    let from = FromMap { path: map_path.display().to_string(), map_id: map.id.clone(), name: label };
    std::fs::write(dest.join(FROM_MAP), serde_json::to_vec_pretty(&from)?)?;
    Ok((dest, count))
}

/// Takes a map's folder (made by `add_map`) out of your library.
pub fn remove_map(dir: &Path) -> Result<()> {
    let root = user_root()?.canonicalize()?;
    let d = dir.canonicalize()?;
    anyhow::ensure!(d.parent() == Some(root.as_path()) && d.join(FROM_MAP).is_file(), "not a map's folder in your library");
    std::fs::remove_dir_all(&d)?;
    Ok(())
}

pub(crate) fn rekey_object(o: &mut CustomObject, rekey: &impl Fn(&str) -> String) {
    for p in &mut o.parts {
        p.mesh = rekey(&p.mesh);
        for m in &mut p.materials {
            rekey_material(m, rekey);
        }
    }
    for c in &mut o.colliders {
        c.mesh_ref = rekey(&c.mesh_ref);
    }
}

pub(crate) fn rekey_material(m: &mut Material, rekey: &impl Fn(&str) -> String) {
    for t in [&mut m.base_tex, &mut m.metallic_tex, &mut m.roughness_tex, &mut m.normal_tex, &mut m.emission_tex] {
        *t = rekey(t);
    }
}

pub(crate) fn material_name(m: &Material) -> String {
    match m.base_tex.rsplit('/').next().filter(|s| !s.is_empty()) {
        Some(t) => {
            let lower = t.to_lowercase();
            let mut t = t.to_string();
            for suffix in ["_basecolor", "_base_color", "_albedo", "_diffuse", "_color", "basecolor"] {
                if lower.ends_with(suffix) {
                    t.truncate(t.len() - suffix.len());
                    break;
                }
            }
            title(&t)
        }
        None => {
            let c = m.base_color;
            format!("Colour #{:02x}{:02x}{:02x}", (c.r.clamp(0.0, 1.0) * 255.0) as u8, (c.g.clamp(0.0, 1.0) * 255.0) as u8, (c.b.clamp(0.0, 1.0) * 255.0) as u8)
        }
    }
}

/// Folder and name for a map's piece, from its first mesh's key — the path the mesh had in its author's project:
/// the folder is the first folder there that says something ("Melonz's Custom Rails/…" → "Melonz's Custom Rails",
/// "Assets/Props/…" → "Props"), the name the last part of the path that does.
pub(crate) fn piece_group_and_name(o: &CustomObject) -> (String, String) {
    let key = &o.parts[0].mesh;
    let segs: Vec<&str> = key.split('/').filter(|s| !s.is_empty()).collect();
    // words that say nothing about the piece (Unity project folders, default mesh names)
    let generic = |s: &str| {
        let l = s.to_lowercase();
        ["cube", "plane", "sphere", "mesh", "rails merge", "posts merge", "subposts merge", "assets", "sources", "meshes", "models", "prefabs", "builtin"].iter().any(|g| l.starts_with(g))
    };
    let group = segs[..segs.len().saturating_sub(1)].iter().find(|s| !generic(s)).map(|s| file_name(s)).unwrap_or_default();
    let clean = |s: &str| {
        let s = s.split(['.', ':']).next().unwrap_or(s);
        let s = s.trim_end_matches(|c: char| c.is_ascii_digit() || c == '_');
        let s = s.strip_suffix("_LOD").unwrap_or(s);
        s.replace("_LOD", "")
    };
    let name = segs.iter().rev().map(|s| clean(s)).find(|s| !s.is_empty() && !generic(s)).unwrap_or_else(|| "Piece".into());
    (group, title(&name))
}

pub(crate) fn title(s: &str) -> String {
    let s = s.replace(['_', '-'], " ");
    let mut out = String::new();
    for (i, w) in s.split_whitespace().enumerate() {
        if i > 0 {
            out.push(' ');
        }
        let mut c = w.chars();
        if let Some(f) = c.next() {
            out.extend(f.to_uppercase());
            out.push_str(c.as_str());
        }
    }
    out
}

pub(crate) fn bounds(meshes: &IndexMap<String, MeshData>, obj: &CustomObject) -> [f32; 3] {
    let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
    for p in &obj.parts {
        let Some(m) = meshes.get(&p.mesh) else { continue };
        let q = quat_from_unity_euler([p.local_rotation.x, p.local_rotation.y, p.local_rotation.z]);
        for v in m.vertices.as_deref().unwrap_or_default().chunks_exact(12) {
            let f = |k: usize| f32::from_le_bytes(v[k * 4..k * 4 + 4].try_into().unwrap());
            let w = rotate(q, [f(0) * p.local_scale.x, f(1) * p.local_scale.y, f(2) * p.local_scale.z]);
            let w = [w[0] + p.local_position.x, w[1] + p.local_position.y, w[2] + p.local_position.z];
            for k in 0..3 {
                lo[k] = lo[k].min(w[k]);
                hi[k] = hi[k].max(w[k]);
            }
        }
    }
    if lo[0] > hi[0] { [0.0; 3] } else { [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] }
}

/// Re-expresses parts/colliders/lights relative to the object's root, and puts the root at the origin with no
/// rotation or scale. (The game reads part transforms as world space, so this is the object "at the origin".)
pub(crate) fn to_local(o: &CustomObject) -> CustomObject {
    let rp = [o.position.x, o.position.y, o.position.z];
    let rq = conj(quat_from_unity_euler([o.rotation.x, o.rotation.y, o.rotation.z]));
    let rs = [o.scale.x, o.scale.y, o.scale.z].map(|s| if s.abs() < 1e-6 { 1.0 } else { s });
    let pos = |p: &Vec3| {
        let v = rotate(rq, [p.x - rp[0], p.y - rp[1], p.z - rp[2]]);
        Vec3::new(v[0] / rs[0], v[1] / rs[1], v[2] / rs[2])
    };
    let rot = |r: &Vec3| {
        let e = unity_euler_from_quat(quat_mul(rq, quat_from_unity_euler([r.x, r.y, r.z])));
        Vec3::new(e[0], e[1], e[2])
    };
    let scl = |s: &Vec3| Vec3::new(s.x / rs[0], s.y / rs[1], s.z / rs[2]);
    let mut l = o.clone();
    l.position = Vec3::ZERO;
    l.rotation = Vec3::ZERO;
    l.scale = Vec3::ONE;
    for p in &mut l.parts {
        p.local_position = pos(&p.local_position);
        p.local_rotation = rot(&p.local_rotation);
        p.local_scale = scl(&p.local_scale);
    }
    for c in &mut l.colliders {
        c.local_position = pos(&c.local_position);
        c.local_rotation = rot(&c.local_rotation);
        c.local_scale = scl(&c.local_scale);
    }
    for li in &mut l.lights {
        li.local_position = pos(&li.local_position);
        li.local_rotation = rot(&li.local_rotation);
    }
    l
}

/// Identity of a piece regardless of where it was placed (positions to 1 cm, angles to 0.1°).
pub(crate) fn signature(o: &CustomObject) -> String {
    let r = |v: &Vec3, k: f32| format!("{:.0},{:.0},{:.0}", v.x * k, v.y * k, v.z * k);
    let mut parts: Vec<String> = o
        .parts
        .iter()
        .map(|p| format!("{}|{}|{}|{}|{}", p.mesh, r(&p.local_position, 100.0), r(&p.local_rotation, 10.0), r(&p.local_scale, 100.0), serde_json::to_string(&p.materials).unwrap_or_default()))
        .collect();
    parts.sort();
    parts.join(";")
}
