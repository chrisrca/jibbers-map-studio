//! A .jbrmap written: the map's types into Map-Tools' JSON, in its own key order.

use super::*;

/// Ordered JSON object builder mirroring `JsonSerializer.AddValue`.
#[derive(Default)]
pub(crate) struct W(Map<String, Value>);

pub(crate) fn num(v: f32) -> Value {
    if !v.is_finite() {
        return Value::from(0.0);
    }
    // Shortest decimal that round-trips the f32, so 0.1f prints as 0.1 rather than 0.10000000149.
    let shortest: f64 = format!("{v}").parse().unwrap_or(v as f64);
    Number::from_f64(shortest).map(Value::Number).unwrap_or(Value::from(0.0))
}

impl W {
    pub(crate) fn f(&mut self, k: &str, v: f32) -> &mut Self {
        self.0.insert(k.into(), num(v));
        self
    }
    pub(crate) fn i(&mut self, k: &str, v: i64) -> &mut Self {
        self.0.insert(k.into(), Value::from(v));
        self
    }
    pub(crate) fn b(&mut self, k: &str, v: bool) -> &mut Self {
        self.0.insert(k.into(), Value::Bool(v));
        self
    }
    pub(crate) fn s(&mut self, k: &str, v: &str) -> &mut Self {
        self.0.insert(k.into(), Value::String(v.into()));
        self
    }
    pub(crate) fn v2(&mut self, k: &str, v: Vec2) -> &mut Self {
        self.f(&format!("{k}-x"), v.x).f(&format!("{k}-y"), v.y)
    }
    pub(crate) fn v3(&mut self, k: &str, v: Vec3) -> &mut Self {
        self.f(&format!("{k}-x"), v.x).f(&format!("{k}-y"), v.y).f(&format!("{k}-z"), v.z)
    }
    pub(crate) fn raw(&mut self, k: &str, v: Value) -> &mut Self {
        self.0.insert(k.into(), v);
        self
    }
    /// Pre-encoded blob (base64 string) or null.
    pub(crate) fn blob(&mut self, k: &str, v: Option<String>) -> &mut Self {
        self.raw(k, v.map_or(Value::Null, Value::String))
    }
    pub(crate) fn arr<T>(&mut self, k: &str, items: &[T], f: impl Fn(&T) -> Value) -> &mut Self {
        self.i(&format!("{k}-count"), items.len() as i64);
        let mut block = Map::new();
        for (i, it) in items.iter().enumerate() {
            block.insert(format!("value-{i}"), f(it));
        }
        self.raw(k, Value::Object(block))
    }
    pub(crate) fn done(self) -> Value {
        Value::Object(self.0)
    }
}

pub(crate) fn enc(b: &Option<Vec<u8>>) -> Option<String> {
    b.as_ref().map(|b| encode_blob(b))
}

pub fn write_map(m: &MapData) -> Result<String> {
    let v = map_to(m);
    Ok(serde_json::to_string_pretty(&v)?)
}

pub fn write_map_to(m: &MapData, w: impl Write) -> Result<()> {
    let v = map_to(m);
    serde_json::to_writer_pretty(std::io::BufWriter::with_capacity(1 << 20, w), &v)?;
    Ok(())
}

pub(crate) fn map_to(m: &MapData) -> Value {
    // Encode the heavy blobs in parallel up front.
    let terrain: Vec<Option<String>> = m.chunks.par_iter().map(|c| enc(&c.terrain_data)).collect();
    let meshes: Vec<Value> = m.mesh_library.values().collect::<Vec<_>>().par_iter().map(|md| mesh_to(md)).collect();
    let textures: Vec<Value> = m.texture_library.values().collect::<Vec<_>>().par_iter().map(|t| texture_to(t)).collect();

    let mut w = W::default();
    w.s("id", &m.id).s("name", &m.name).s("version", &m.version);
    if has_v05_header(&m.version) {
        w.s("mod-version", &m.mod_version).s("author", &m.author);
        w.s("remix-authors", &m.remix_authors).s("remix-ids", &m.remix_ids);
        w.f("scale", m.scale);
    }
    w.v3("cam-start-position", m.cam_start_position);
    w.b("allow-background-mountains", m.allow_background_mountains);
    w.b("override-time", m.override_time);
    w.f("day-time", m.day_time);
    if m.day_time_hours >= 0.0 {
        w.f("day-time-hours", m.day_time_hours);
    }
    w.f("sun-angle", m.sun_angle);

    let chunks: Vec<(usize, &Chunk)> = m.chunks.iter().enumerate().collect();
    w.arr("chunks", &chunks, |(i, c)| chunk_to(c, terrain[*i].clone()));
    w.arr("spawnpoints", &m.spawn_points, spawn_to);

    let mut ml = Map::new();
    for (k, v) in m.mesh_library.keys().zip(meshes) {
        ml.insert(k.clone(), v);
    }
    w.raw("mesh-library", Value::Object(ml));
    let mut tl = Map::new();
    for (k, v) in m.texture_library.keys().zip(textures) {
        tl.insert(k.clone(), v);
    }
    w.raw("texture-library", Value::Object(tl));
    w.done()
}

pub(crate) fn chunk_to(c: &Chunk, terrain: Option<String>) -> Value {
    let mut w = W::default();
    w.v3("position", c.position).v3("size", c.size);
    w.i("heightmap-resolution", c.heightmap_resolution as i64);
    w.blob("terrain-data", terrain);
    w.raw("snow-mask", c.snow_mask.as_ref().map_or(Value::Object(Map::new()), texture_to));
    w.b("snow-mask-4channel", c.snow_mask_4channel);
    w.raw("snow-mask-2", c.snow_mask_2.as_ref().map_or(Value::Object(Map::new()), texture_to));
    w.arr("objects", &c.objects, object_to);
    w.arr("custom-objects", &c.custom_objects, custom_to);
    w.arr("tree-prototypes", &c.tree_prototypes, tree_to);
    w.i("repeats", c.repeats as i64);
    w.v3("repeat-offset", c.repeat_offset);
    w.done()
}

pub(crate) fn spawn_to(s: &SpawnPoint) -> Value {
    let mut w = W::default();
    w.s("name", &s.name).v3("position", s.position).v3("rotation", s.rotation).v3("velocity", s.velocity);
    w.done()
}

pub(crate) fn object_to(o: &MapObject) -> Value {
    let mut w = W::default();
    w.s("id", &o.id).v3("position", o.position).v3("rotation", o.rotation).v3("scale", o.scale);
    if !o.parameters.is_empty() {
        let mut p = Map::new();
        for (k, v) in &o.parameters {
            p.insert(
                k.clone(),
                match v {
                    ParamValue::Int(i) => Value::from(*i),
                    ParamValue::Float(f) => num(*f),
                    ParamValue::Bool(b) => Value::Bool(*b),
                    ParamValue::String(s) => Value::String(s.clone()),
                },
            );
        }
        w.raw("parameters", Value::Object(p));
    }
    if let Some(l) = &o.lift {
        let mut lw = W::default();
        lw.v3("end-position", l.end_position);
        lw.i("masts-count", l.masts.len() as i64);
        let mut masts = W::default();
        for (i, v) in l.masts.iter().enumerate() {
            masts.v3(&format!("value-{i}"), *v);
        }
        lw.raw("masts", masts.done());
        w.raw("lift", lw.done());
    }
    w.done()
}

pub(crate) fn custom_to(o: &CustomObject) -> Value {
    let mut w = W::default();
    w.i("surface-type", o.surface_type as i64);
    if o.surface_type == SurfaceType::Jib {
        w.b("can-stabilize", o.can_stabilize).b("can-rotate", o.can_rotate).b("can-magnetize", o.can_magnetize);
        w.i("intended-up-method", o.intended_up_method as i64);
    }
    w.b("disable-distance-culling", o.disable_distance_culling);
    w.b("timed-visibility", o.timed_visibility);
    if o.timed_visibility {
        w.f("visible-from-hour", o.visible_from_hour).f("visible-until-hour", o.visible_until_hour);
    }
    w.v3("position", o.position).v3("rotation", o.rotation).v3("scale", o.scale);
    w.arr("parts", &o.parts, part_to);
    w.arr("colliders", &o.colliders, collider_to);
    w.arr("lod-groups", &o.lod_groups, lod_to);
    w.arr("lights", &o.lights, light_to);
    w.done()
}

pub(crate) fn part_to(p: &Part) -> Value {
    let mut w = W::default();
    w.s("mesh", &p.mesh);
    w.v3("local-position", p.local_position).v3("local-rotation", p.local_rotation).v3("local-scale", p.local_scale);
    w.arr("materials", &p.materials, material_to);
    w.i("lod-group-index", p.lod_group_index as i64);
    w.i("lod-index", p.lod_index as i64);
    w.i("shadow-casting-mode", p.shadow_casting_mode as i64);
    w.done()
}

pub(crate) fn material_to(m: &Material) -> Value {
    let mut w = W::default();
    w.s("base-tex", &m.base_tex)
        .s("metallic-tex", &m.metallic_tex)
        .s("roughness-tex", &m.roughness_tex)
        .s("normal-tex", &m.normal_tex)
        .s("emission-tex", &m.emission_tex);
    w.i("render-mode", m.render_mode as i64);
    w.f("alpha-cutoff", m.alpha_cutoff);
    w.v2("tiling", m.tiling).v2("offset", m.offset);
    w.i("cull-mode", m.cull_mode as i64);
    w.f("base-color-r", m.base_color.r).f("base-color-g", m.base_color.g).f("base-color-b", m.base_color.b).f("base-color-a", m.base_color.a);
    w.f("emission-color-r", m.emission_color.r).f("emission-color-g", m.emission_color.g).f("emission-color-b", m.emission_color.b);
    w.f("metallic", m.metallic).f("smoothness", m.smoothness).b("lit", m.lit);
    let mut ep = Map::new();
    for (k, v) in &m.extra_props {
        let mut p = W::default();
        match v {
            MaterialProp::Float(f) => {
                p.i("type", 0).f("v", *f);
            }
            MaterialProp::Color(c) | MaterialProp::Vector(c) => {
                p.i("type", if matches!(v, MaterialProp::Color(_)) { 1 } else { 2 });
                p.f("x", c[0]).f("y", c[1]).f("z", c[2]).f("w", c[3]);
            }
            MaterialProp::Texture(t) => {
                p.i("type", 3).s("ref", t);
            }
        }
        ep.insert(k.clone(), p.done());
    }
    w.raw("extra-props", Value::Object(ep));
    w.arr("keywords", &m.keywords, |s| Value::String(s.clone()));
    w.done()
}

pub(crate) fn lod_to(l: &LodGroup) -> Value {
    let mut w = W::default();
    w.v3("local-position", l.local_position).v3("local-reference-point", l.local_reference_point);
    w.f("size", l.size).i("fade-mode", l.fade_mode as i64).b("animate-crossfading", l.animate_crossfading);
    w.i("transition-count", l.transitions.len() as i64);
    for (i, t) in l.transitions.iter().enumerate() {
        w.f(&format!("transition-{i}"), *t);
        w.f(&format!("fade-width-{i}"), l.fade_widths.get(i).copied().unwrap_or(0.0));
    }
    w.done()
}

pub(crate) fn light_to(l: &Light) -> Value {
    let mut w = W::default();
    w.i("type", l.light_type as i64);
    w.v3("local-position", l.local_position).v3("local-rotation", l.local_rotation);
    w.f("color-r", l.color.r).f("color-g", l.color.g).f("color-b", l.color.b);
    w.f("intensity", l.intensity).f("range", l.range).f("spot-angle", l.spot_angle).f("inner-spot-angle", l.inner_spot_angle);
    w.i("shadows", l.shadows as i64).f("shadow-strength", l.shadow_strength);
    w.done()
}

pub(crate) fn collider_to(c: &Collider) -> Value {
    let mut w = W::default();
    w.i("shape", c.shape as i64).i("surface-type", c.surface_type as i64);
    w.v3("local-position", c.local_position).v3("local-rotation", c.local_rotation).v3("local-scale", c.local_scale);
    w.v3("center", c.center).v3("size", c.size);
    w.f("radius", c.radius).f("height", c.height).i("direction", c.direction as i64);
    w.s("mesh-ref", &c.mesh_ref);
    w.done()
}

pub(crate) fn tree_to(t: &TreePrototype) -> Value {
    let mut w = W::default();
    w.s("object-id", &t.object_id);
    w.arr("parts", &t.parts, part_to);
    w.arr("lod-groups", &t.lod_groups, lod_to);
    w.arr("colliders", &t.colliders, collider_to);
    w.blob("instances", enc(&t.instances));
    w.done()
}

pub(crate) fn mesh_to(m: &MeshData) -> Value {
    let mut w = W::default();
    w.i("vertex-count", m.vertex_count as i64);
    w.blob("vertices", enc(&m.vertices))
        .blob("normals", enc(&m.normals))
        .blob("tangents", enc(&m.tangents))
        .blob("colors", enc(&m.colors))
        .blob("uvs", enc(&m.uvs))
        .blob("uv2s", enc(&m.uv2s))
        .blob("uv3s", enc(&m.uv3s))
        .blob("uv4s", enc(&m.uv4s));
    w.i("submesh-count", m.submeshes.len() as i64);
    for (i, s) in m.submeshes.iter().enumerate() {
        w.blob(&format!("triangles-{i}"), enc(s));
    }
    w.done()
}

pub(crate) fn texture_to(t: &TextureData) -> Value {
    let mut w = W::default();
    w.i("format", t.format as i64).i("width", t.width as i64).i("height", t.height as i64);
    w.s("encoding", &t.encoding).b("linear", t.linear).b("mipmaps", t.mipmaps);
    w.i("compression", t.compression as i64);
    w.blob("data", enc(&t.data));
    w.done()
}
