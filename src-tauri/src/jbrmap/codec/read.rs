//! A .jbrmap read: its JSON (Map-Tools' layout: dictionaries as "value-N" keys with a count) into the map's types.

use super::*;

#[derive(Clone, Copy)]
pub(crate) struct R<'a>(&'a Map<String, Value>);

pub(crate) static EMPTY: std::sync::OnceLock<Map<String, Value>> = std::sync::OnceLock::new();

impl<'a> R<'a> {
    pub(crate) fn get(&self, k: &str) -> Option<&'a Value> {
        self.0.get(k)
    }
    pub(crate) fn f(&self, k: &str, d: f32) -> f32 {
        self.get(k).and_then(Value::as_f64).map_or(d, |v| v as f32)
    }
    pub(crate) fn i(&self, k: &str, d: i32) -> i32 {
        match self.get(k) {
            Some(Value::Number(n)) => n.as_i64().map(|v| v as i32).or(n.as_f64().map(|v| v as i32)).unwrap_or(d),
            _ => d,
        }
    }
    pub(crate) fn b(&self, k: &str, d: bool) -> bool {
        self.get(k).and_then(Value::as_bool).unwrap_or(d)
    }
    pub(crate) fn s(&self, k: &str) -> String {
        self.get(k).and_then(Value::as_str).unwrap_or("").to_string()
    }
    pub(crate) fn v2(&self, k: &str, d: Vec2) -> Vec2 {
        Vec2 { x: self.f(&format!("{k}-x"), d.x), y: self.f(&format!("{k}-y"), d.y) }
    }
    pub(crate) fn v3(&self, k: &str, d: Vec3) -> Vec3 {
        Vec3 {
            x: self.f(&format!("{k}-x"), d.x),
            y: self.f(&format!("{k}-y"), d.y),
            z: self.f(&format!("{k}-z"), d.z),
        }
    }
    pub(crate) fn block(&self, k: &str) -> R<'a> {
        match self.get(k) {
            Some(Value::Object(m)) => R(m),
            _ => R(EMPTY.get_or_init(Map::new)),
        }
    }
    pub(crate) fn bytes(&self, k: &str) -> Result<Option<Vec<u8>>> {
        match self.get(k) {
            Some(Value::String(s)) if !s.is_empty() => Ok(Some(decode_blob(s).with_context(|| format!("blob '{k}'"))?)),
            _ => Ok(None),
        }
    }
    /// `SerializeArray`: `<k>-count` then block `<k>` holding `value-0..N`.
    pub(crate) fn arr(&self, k: &str) -> Vec<R<'a>> {
        let n = self.i(&format!("{k}-count"), 0).max(0) as usize;
        let b = self.block(k);
        (0..n).map(|i| b.block(&format!("value-{i}"))).collect()
    }
}

pub fn read_map(json: &str) -> Result<MapData> {
    let root: Value = serde_json::from_str(json).context("parse JSON")?;
    let root = root.as_object().context("root is not an object")?;
    map_from(R(root))
}

pub(crate) fn map_from(r: R) -> Result<MapData> {
    let mut m = MapData {
        id: r.s("id"),
        name: r.s("name"),
        version: r.s("version"),
        mod_version: r.get("mod-version").and_then(Value::as_str).unwrap_or("1.0").to_string(),
        author: r.s("author"),
        remix_authors: r.s("remix-authors"),
        remix_ids: r.s("remix-ids"),
        scale: r.f("scale", 1.0),
        cam_start_position: r.v3("cam-start-position", Vec3::ZERO),
        allow_background_mountains: r.b("allow-background-mountains", false),
        override_time: r.b("override-time", false),
        day_time: r.f("day-time", 0.0),
        day_time_hours: r.f("day-time-hours", -1.0),
        sun_angle: r.f("sun-angle", 0.0),
        ..Default::default()
    };
    m.chunks = r.arr("chunks").into_iter().map(chunk_from).collect::<Result<_>>()?;
    m.spawn_points = r.arr("spawnpoints").into_iter().map(spawn_from).collect();

    let meshes: Vec<(&String, &Value)> = match r.get("mesh-library") {
        Some(Value::Object(o)) => o.iter().collect(),
        _ => vec![],
    };
    let meshes: Vec<(String, MeshData)> = meshes
        .par_iter()
        .map(|(k, v)| Ok(((*k).clone(), mesh_from(R(v.as_object().context("mesh entry")?))?)))
        .collect::<Result<_>>()?;
    m.mesh_library = meshes.into_iter().collect();

    let textures: Vec<(&String, &Value)> = match r.get("texture-library") {
        Some(Value::Object(o)) => o.iter().collect(),
        _ => vec![],
    };
    let textures: Vec<(String, TextureData)> = textures
        .par_iter()
        .map(|(k, v)| Ok(((*k).clone(), texture_from(R(v.as_object().context("texture entry")?))?)))
        .collect::<Result<_>>()?;
    m.texture_library = textures.into_iter().collect();
    Ok(m)
}

pub(crate) fn chunk_from(r: R) -> Result<Chunk> {
    let tex = |k: &str| -> Result<Option<TextureData>> {
        let b = r.block(k);
        if b.0.is_empty() { Ok(None) } else { Ok(Some(texture_from(b)?)) }
    };
    Ok(Chunk {
        position: r.v3("position", Vec3::ZERO),
        size: r.v3("size", Vec3::ZERO),
        heightmap_resolution: r.i("heightmap-resolution", 0),
        terrain_data: r.bytes("terrain-data")?,
        snow_mask: tex("snow-mask")?,
        snow_mask_4channel: r.b("snow-mask-4channel", false),
        snow_mask_2: tex("snow-mask-2")?,
        objects: r.arr("objects").into_iter().map(object_from).collect(),
        custom_objects: r.arr("custom-objects").into_iter().map(custom_from).collect(),
        tree_prototypes: r.arr("tree-prototypes").into_iter().map(tree_from).collect::<Result<_>>()?,
        repeats: r.i("repeats", 0),
        repeat_offset: r.v3("repeat-offset", Vec3::ZERO),
    })
}

pub(crate) fn spawn_from(r: R) -> SpawnPoint {
    SpawnPoint {
        name: r.s("name"),
        position: r.v3("position", Vec3::ZERO),
        rotation: r.v3("rotation", Vec3::ZERO),
        velocity: r.v3("velocity", Vec3::ZERO),
    }
}

pub(crate) fn object_from(r: R) -> MapObject {
    let mut parameters = IndexMap::new();
    if let Some(Value::Object(p)) = r.get("parameters") {
        for (k, v) in p {
            let pv = match v {
                Value::String(s) => ParamValue::String(s.clone()),
                Value::Bool(b) => ParamValue::Bool(*b),
                Value::Number(n) if n.is_i64() || n.is_u64() => ParamValue::Int(n.as_i64().unwrap_or(0)),
                Value::Number(n) => ParamValue::Float(n.as_f64().unwrap_or(0.0) as f32),
                _ => continue,
            };
            parameters.insert(k.clone(), pv);
        }
    }
    MapObject {
        id: r.s("id"),
        position: r.v3("position", Vec3::ZERO),
        rotation: r.v3("rotation", Vec3::ZERO),
        scale: r.v3("scale", Vec3::ZERO),
        parameters,
        lift: match r.get("lift") {
            Some(Value::Object(_)) => {
                let l = r.block("lift");
                let n = l.i("masts-count", 0).max(0) as usize;
                let m = l.block("masts");
                Some(LiftData {
                    end_position: l.v3("end-position", Vec3 { x: 0.0, y: 0.0, z: 50.0 }),
                    masts: (0..n).map(|i| m.v3(&format!("value-{i}"), Vec3::ZERO)).collect(),
                })
            }
            _ => None,
        },
    }
}

pub(crate) fn custom_from(r: R) -> CustomObject {
    let d = CustomObject::default();
    let surface_type = SurfaceType::from_i32(r.i("surface-type", 0));
    let jib = surface_type == SurfaceType::Jib;
    let timed = r.b("timed-visibility", false);
    CustomObject {
        surface_type,
        can_stabilize: if jib { r.b("can-stabilize", d.can_stabilize) } else { d.can_stabilize },
        can_rotate: if jib { r.b("can-rotate", d.can_rotate) } else { d.can_rotate },
        can_magnetize: if jib { r.b("can-magnetize", d.can_magnetize) } else { d.can_magnetize },
        intended_up_method: if jib { r.i("intended-up-method", 0) } else { 0 },
        disable_distance_culling: r.b("disable-distance-culling", false),
        timed_visibility: timed,
        visible_from_hour: if timed { r.f("visible-from-hour", d.visible_from_hour) } else { d.visible_from_hour },
        visible_until_hour: if timed { r.f("visible-until-hour", d.visible_until_hour) } else { d.visible_until_hour },
        position: r.v3("position", Vec3::ZERO),
        rotation: r.v3("rotation", Vec3::ZERO),
        scale: r.v3("scale", Vec3::ZERO),
        parts: r.arr("parts").into_iter().map(part_from).collect(),
        colliders: r.arr("colliders").into_iter().map(collider_from).collect(),
        lod_groups: r.arr("lod-groups").into_iter().map(lod_from).collect(),
        lights: r.arr("lights").into_iter().map(light_from).collect(),
        studio: Default::default(),
    }
}

pub(crate) fn part_from(r: R) -> Part {
    Part {
        mesh: r.s("mesh"),
        local_position: r.v3("local-position", Vec3::ZERO),
        local_rotation: r.v3("local-rotation", Vec3::ZERO),
        local_scale: r.v3("local-scale", Vec3::ZERO),
        materials: r.arr("materials").into_iter().map(material_from).collect(),
        lod_group_index: r.i("lod-group-index", -1),
        lod_index: r.i("lod-index", 0),
        shadow_casting_mode: r.i("shadow-casting-mode", 1),
    }
}

pub(crate) fn material_from(r: R) -> Material {
    let d = Material::default();
    let mut extra_props = IndexMap::new();
    if let Some(Value::Object(p)) = r.get("extra-props") {
        for (k, v) in p {
            let Some(o) = v.as_object() else { continue };
            let pr = R(o);
            let v4 = [pr.f("x", 0.0), pr.f("y", 0.0), pr.f("z", 0.0), pr.f("w", 0.0)];
            let prop = match pr.i("type", 0) {
                1 => MaterialProp::Color(v4),
                2 => MaterialProp::Vector(v4),
                3 => MaterialProp::Texture(pr.s("ref")),
                _ => MaterialProp::Float(pr.f("v", 0.0)),
            };
            extra_props.insert(k.clone(), prop);
        }
    }
    let kw = r.block("keywords");
    let keywords = (0..r.i("keywords-count", 0).max(0)).map(|i| kw.s(&format!("value-{i}"))).collect();
    Material {
        base_tex: r.s("base-tex"),
        metallic_tex: r.s("metallic-tex"),
        roughness_tex: r.s("roughness-tex"),
        normal_tex: r.s("normal-tex"),
        emission_tex: r.s("emission-tex"),
        render_mode: r.i("render-mode", 0),
        alpha_cutoff: r.f("alpha-cutoff", d.alpha_cutoff),
        tiling: r.v2("tiling", d.tiling),
        offset: r.v2("offset", d.offset),
        cull_mode: r.i("cull-mode", d.cull_mode),
        base_color: Color {
            r: r.f("base-color-r", 1.0),
            g: r.f("base-color-g", 1.0),
            b: r.f("base-color-b", 1.0),
            a: r.f("base-color-a", 1.0),
        },
        emission_color: Color {
            r: r.f("emission-color-r", 0.0),
            g: r.f("emission-color-g", 0.0),
            b: r.f("emission-color-b", 0.0),
            a: 1.0,
        },
        metallic: r.f("metallic", 0.0),
        smoothness: r.f("smoothness", 0.0),
        lit: r.b("lit", true),
        extra_props,
        keywords,
        name: String::new(),
    }
}

pub(crate) fn lod_from(r: R) -> LodGroup {
    let n = r.i("transition-count", 0).max(0);
    LodGroup {
        local_position: r.v3("local-position", Vec3::ZERO),
        local_reference_point: r.v3("local-reference-point", Vec3::ZERO),
        size: r.f("size", 1.0),
        fade_mode: r.i("fade-mode", 0),
        animate_crossfading: r.b("animate-crossfading", false),
        transitions: (0..n).map(|i| r.f(&format!("transition-{i}"), 0.0)).collect(),
        fade_widths: (0..n).map(|i| r.f(&format!("fade-width-{i}"), 0.0)).collect(),
    }
}

pub(crate) fn light_from(r: R) -> Light {
    Light {
        light_type: r.i("type", 2),
        local_position: r.v3("local-position", Vec3::ZERO),
        local_rotation: r.v3("local-rotation", Vec3::ZERO),
        color: Color { r: r.f("color-r", 1.0), g: r.f("color-g", 1.0), b: r.f("color-b", 1.0), a: 1.0 },
        intensity: r.f("intensity", 1.0),
        range: r.f("range", 10.0),
        spot_angle: r.f("spot-angle", 30.0),
        inner_spot_angle: r.f("inner-spot-angle", 21.8),
        shadows: r.i("shadows", 0),
        shadow_strength: r.f("shadow-strength", 1.0),
    }
}

pub(crate) fn collider_from(r: R) -> Collider {
    Collider {
        shape: ColliderShape::from_i32(r.i("shape", 0)),
        surface_type: SurfaceType::from_i32(r.i("surface-type", 0)),
        local_position: r.v3("local-position", Vec3::ZERO),
        local_rotation: r.v3("local-rotation", Vec3::ZERO),
        local_scale: r.v3("local-scale", Vec3::ZERO),
        center: r.v3("center", Vec3::ZERO),
        size: r.v3("size", Vec3::ZERO),
        radius: r.f("radius", 0.0),
        height: r.f("height", 0.0),
        direction: r.i("direction", 0),
        mesh_ref: r.s("mesh-ref"),
    }
}

pub(crate) fn tree_from(r: R) -> Result<TreePrototype> {
    Ok(TreePrototype {
        object_id: r.s("object-id"),
        parts: r.arr("parts").into_iter().map(part_from).collect(),
        lod_groups: r.arr("lod-groups").into_iter().map(lod_from).collect(),
        colliders: r.arr("colliders").into_iter().map(collider_from).collect(),
        instances: r.bytes("instances")?,
    })
}

pub(crate) fn mesh_from(r: R) -> Result<MeshData> {
    let n = r.i("submesh-count", 0).max(0);
    Ok(MeshData {
        vertex_count: r.i("vertex-count", 0),
        vertices: r.bytes("vertices")?,
        normals: r.bytes("normals")?,
        tangents: r.bytes("tangents")?,
        colors: r.bytes("colors")?,
        uvs: r.bytes("uvs")?,
        uv2s: r.bytes("uv2s")?,
        uv3s: r.bytes("uv3s")?,
        uv4s: r.bytes("uv4s")?,
        submeshes: (0..n).map(|i| r.bytes(&format!("triangles-{i}"))).collect::<Result<_>>()?,
    })
}

pub(crate) fn texture_from(r: R) -> Result<TextureData> {
    let legacy_compressed = r.b("compressed", true);
    Ok(TextureData {
        format: r.i("format", 0),
        width: r.i("width", 0),
        height: r.i("height", 0),
        encoding: r.s("encoding"),
        linear: r.b("linear", true),
        mipmaps: r.b("mipmaps", false),
        compression: r.i("compression", if legacy_compressed { 1 } else { 0 }),
        data: r.bytes("data")?,
    })
}
