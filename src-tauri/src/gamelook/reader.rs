//! Reading a feature's renderers: each one's mesh (its most detailed level), materials and textures written out, its
//! place in the prefab, the setting's option it's drawn for, a wheel's spin; the lights beside them.

use super::*;

/// A mesh as written: its file, vertices, each submesh's index count, the game's name for it, and how it spins
/// (a wheel's piece: {"pivot", "axis", "cycles"} in the mesh's own space).
#[derive(Clone)]
pub(crate) struct MeshPiece {
    pub(crate) file: String,
    pub(crate) n: usize,
    pub(crate) subs: Vec<usize>,
    pub(crate) name: String,
    pub(crate) spin: Option<Value>,
}

pub(crate) struct Reader<'a> {
    pub(crate) g: &'a Game,
    pub(crate) out: PathBuf,
    pub(crate) meshes: HashMap<At, Vec<MeshPiece>>,
    pub(crate) textures: HashMap<At, String>,
    pub(crate) linear: HashMap<String, bool>,
    /// textures to decode and write (done together at the end, in parallel)
    pub(crate) jobs: Vec<(At, bool, String)>,
    /// the lights walked past (taken by the feature they're under)
    pub(crate) lights: Vec<Value>,
}

impl Reader<'_> {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn walk(&mut self, go_at: At, parent: Option<[[f64; 4]; 4]>, skip: &HashSet<At>, variants: &[(String, String)], variant: Option<(String, String)>, out: &mut Vec<Value>) -> Result<()> {
        let g = self.g;
        let go = g.read(go_at)?;
        // switched off: nothing under it is drawn
        if !go.get("m_IsActive").b() {
            return Ok(());
        }
        let Some(t_at) = component(g, go_at, &go, TRANSFORM) else { return Ok(()) };
        let t = g.read(t_at)?;
        // the prefab's own root is its frame
        let m = match parent {
            Some(p) => mul(&p, &trs(&t)),
            None => IDENTITY,
        };
        // a variant's child (by its name): what's under it is drawn for that option only
        let name = loose(go.get("m_Name").s());
        let variant = variant.or_else(|| variants.iter().find(|(_, o)| name.contains(&loose(o))).cloned());
        if let Some(l_at) = component(g, go_at, &go, LIGHT) {
            let l = g.read(l_at)?;
            if l.get("m_Enabled").b() {
                let c = l.get("m_Color");
                let matrix: Vec<f64> = (0..16).map(|k| m[k % 4][k / 4]).collect();
                let mut lv = json!({
                    "type": l.get("m_Type").i(),
                    "color": [c.get("r").f(), c.get("g").f(), c.get("b").f(), c.get("a").f()],
                    "intensity": l.get("m_Intensity").f(),
                    "range": l.get("m_Range").f(),
                    "spotAngle": l.get("m_SpotAngle").f(),
                    "innerSpotAngle": l.get("m_InnerSpotAngle").f(),
                    "matrix": matrix,
                });
                if let Some((param, option)) = &variant {
                    lv["variant"] = json!({ "param": param, "option": option });
                }
                self.lights.push(lv);
            }
        }
        let mf = component(g, go_at, &go, MESH_FILTER);
        let mr = component(g, go_at, &go, MESH_RENDERER);
        if let (Some(mf), Some(mr)) = (mf, mr) {
            if !skip.contains(&mr) {
                let r = g.read(mr)?;
                let mesh = g.resolve(mf.file, g.read(mf)?.get("m_Mesh").pptr());
                if let (Some(mesh), true) = (mesh, r.get("m_Enabled").b()) {
                    let pieces = self.mesh(mesh)?;
                    let mut mats = vec![];
                    for pm in r.get("m_Materials").arr() {
                        if let Some(at) = g.resolve(mr.file, pm.pptr()) {
                            mats.push(self.material(at)?);
                        }
                    }
                    // column-major
                    let matrix: Vec<f64> = (0..16).map(|k| m[k % 4][k / 4]).collect();
                    for pc in pieces {
                        let mut rv = json!({ "mesh": pc.file, "meshName": pc.name, "vertexCount": pc.n, "submeshes": pc.subs, "matrix": matrix, "materials": mats });
                        if let Some(sp) = pc.spin {
                            rv["spin"] = sp;
                        }
                        if let Some((param, option)) = &variant {
                            rv["variant"] = json!({ "param": param, "option": option });
                        }
                        out.push(rv);
                    }
                }
            }
        }
        for c in children(g, t_at, &t) {
            self.walk(c, Some(m), skip, variants, variant.clone(), out)?;
        }
        Ok(())
    }

    /// Everything drawn under a GameObject, in its frame, as the entry `name` — the GameObject itself drawn whether
    /// it's switched on or not (a lift's templates are off in its prefab).
    pub(crate) fn whole(&mut self, at: At, name: &str, features: &mut serde_json::Map<String, Value>) -> Result<()> {
        let g = self.g;
        let mut skip = HashSet::new();
        lower_lods(g, at, &mut skip)?;
        let go = g.read(at)?;
        let mut renderers = vec![];
        if let Some(t) = component(g, at, &go, TRANSFORM) {
            for c in children(g, t, &g.read(t)?) {
                self.walk(c, Some(IDENTITY), &skip, &[], None, &mut renderers)?;
            }
        }
        // (a lift's piece or carrier: no lights of its own to speak of)
        self.lights.clear();
        if !renderers.is_empty() {
            features.insert(name.to_string(), Value::Array(renderers));
        }
        Ok(())
    }

    pub(crate) fn key(at: At) -> String {
        format!("{}{:x}", if at.file == 0 { "" } else { "f" }, at.path & 0xFFFF_FFFF_FFFF)
    }

    /// A mesh written out: as one piece, or, when the game spins parts of it (a lift station's wheels: baked by
    /// Map-Tools' RotatingPartsBaker, turned by CustomObjectLit's _ROTATING_PARTS), its still part and each wheel.
    pub(crate) fn mesh(&mut self, at: At) -> Result<Vec<MeshPiece>> {
        if let Some(m) = self.meshes.get(&at) {
            return Ok(m.clone());
        }
        let g = self.g;
        let m = g.read(at)?;
        let vd = m.get("m_VertexData");
        let n = vd.get("m_VertexCount").i() as usize;
        let streamed = g.streamed(m.get("m_StreamData"))?;
        let raw: &[u8] = streamed.as_deref().unwrap_or(vd.get("m_DataSize").bytes());
        let channels: Vec<[u8; 4]> = vd.get("m_Channels").arr().iter().map(|c| [c.get("stream").i() as u8, c.get("offset").i() as u8, c.get("format").i() as u8, c.get("dimension").i() as u8]).collect();
        // the streams: one after another, each 16-byte aligned, a vertex's channels side by side in each
        let streams = 1 + channels.iter().map(|c| c[0] as usize).max().unwrap_or(0);
        let mut stream_off = vec![0usize; streams];
        let mut stride = vec![0usize; streams];
        let mut off = 0;
        for s in 0..streams {
            stride[s] = channels.iter().filter(|c| c[0] as usize == s && c[3] > 0).map(|c| (c[3] & 0xF) as usize * comp_size(c[2])).sum();
            stream_off[s] = off;
            off = (off + n * stride[s] + 15) & !15;
        }
        let channel = |ci: usize, k: usize| -> Vec<f32> {
            let mut out = vec![0f32; n * k];
            let Some(c) = channels.get(ci) else { return out };
            let dim = (c[3] & 0xF) as usize;
            if dim == 0 {
                return out;
            }
            let cs = comp_size(c[2]);
            for v in 0..n {
                let base = stream_off[c[0] as usize] + v * stride[c[0] as usize] + c[1] as usize;
                for j in 0..k.min(dim) {
                    let o = base + j * cs;
                    if let Some(b) = raw.get(o..o + cs) {
                        out[v * k + j] = component_value(c[2], b);
                    }
                }
            }
            out
        };
        // Unity's channels: 0 position, 1 normal, 2 tangent, 3 colour, 4 the first texture coordinates
        let (pos, nrm, tan, uv) = (channel(0, 3), channel(1, 3), channel(2, 4), channel(4, 2));
        let ib = m.get("m_IndexBuffer").bytes();
        let wide = m.get("m_IndexFormat").i() == 1;
        let width = if wide { 4 } else { 2 };
        let index = |i: usize| -> u32 {
            let o = i * width;
            match ib.get(o..o + width) {
                Some(b) if wide => u32::from_le_bytes(b.try_into().unwrap()),
                Some(b) => u16::from_le_bytes(b.try_into().unwrap()) as u32,
                None => 0,
            }
        };
        // Unity's mesh LODs: per submesh, each level's range of the index buffer (level 0 the most detailed)
        let lod = m.get("m_MeshLodInfo");
        let lod_subs = if lod.get("m_NumLevels").i() > 1 { lod.get("m_SubMeshes").arr() } else { &[] };
        let mut subs: Vec<Vec<u32>> = vec![];
        for (si, s) in m.get("m_SubMeshes").arr().iter().enumerate() {
            let (mut start, mut count) = (s.get("firstByte").i() as usize / width, s.get("indexCount").i() as usize);
            if let Some(l0) = lod_subs.get(si).and_then(|l| l.get("m_Levels").arr().first()) {
                let (ls, lc) = (l0.get("m_IndexStart").i() as usize, l0.get("m_IndexCount").i() as usize);
                if start <= ls && ls + lc <= start + count {
                    (start, count) = (ls, lc);
                } else if ls + lc <= count {
                    (start, count) = (start + ls, lc);
                }
            }
            let base = s.get("baseVertex").i() as u32;
            subs.push((start..start + count).map(|i| index(i) + base).collect());
        }
        let key = Self::key(at);
        let name = m.get("m_Name").s().to_string();
        // the wheels: uv2 their pivot's x and y, uv3 its z and their speed (1e6 + whole turns per 1000 of drive,
        // negative turning back), uv4 their axis as yaw and pitch, every vertex of a wheel alike
        let has = |ci: usize| channels.get(ci).is_some_and(|c| c[3] & 0xF > 0);
        let mut wheel_of = vec![None::<usize>; n];
        let mut wheels: Vec<Value> = vec![];
        if has(6) {
            let (u2, u3, u4) = (channel(5, 2), channel(6, 2), channel(7, 2));
            let mut seen: HashMap<[i64; 6], usize> = HashMap::new();
            for v in 0..n {
                let speed = u3[v * 2 + 1];
                if (speed.abs() / 1e6).floor() != 1.0 {
                    continue;
                }
                let k = [u2[v * 2], u2[v * 2 + 1], u3[v * 2], speed, u4[v * 2], u4[v * 2 + 1]].map(|x| (x as f64 * 1e5).round() as i64);
                let w = *seen.entry(k).or_insert_with(|| {
                    let (yaw, pitch) = (u4[v * 2], u4[v * 2 + 1]);
                    wheels.push(json!({
                        "pivot": [u2[v * 2], u2[v * 2 + 1], u3[v * 2]],
                        "axis": [yaw.sin() * pitch.cos(), pitch.sin(), yaw.cos() * pitch.cos()],
                        "cycles": speed.signum() * (speed.abs() - 1e6),
                    }));
                    wheels.len() - 1
                });
                wheel_of[v] = Some(w);
            }
        }
        // each triangle the wheel's its corners all are, else the still part's
        let mut split: Vec<Vec<Vec<u32>>> = vec![vec![vec![]; subs.len()]; wheels.len() + 1];
        for (si, sub) in subs.iter().enumerate() {
            for t in sub.chunks_exact(3) {
                let w = wheel_of[t[0] as usize].filter(|&w| t.iter().all(|&i| wheel_of[i as usize] == Some(w)));
                split[w.map_or(0, |w| w + 1)][si].extend_from_slice(t);
            }
        }
        let mut out = vec![];
        for (k, part) in split.iter().enumerate() {
            if k > 0 && part.iter().all(Vec::is_empty) {
                continue;
            }
            let file = if k == 0 { format!("meshes/{key}.bin") } else { format!("meshes/{key}-w{k}.bin") };
            // (split, each piece only the vertices it uses)
            let mut used: Vec<u32> = (0..n as u32).collect();
            let mut subs2 = part.clone();
            if !wheels.is_empty() {
                let mut map = vec![u32::MAX; n];
                used.clear();
                for &i in part.iter().flatten() {
                    if map[i as usize] == u32::MAX {
                        map[i as usize] = used.len() as u32;
                        used.push(i);
                    }
                }
                for i in subs2.iter_mut().flatten() {
                    *i = map[*i as usize];
                }
            }
            let mut bytes = Vec::with_capacity(used.len() * 32 + subs2.iter().map(|s| s.len() * 4).sum::<usize>());
            for (a, d) in [(&pos, 3), (&nrm, 3), (&uv, 2)] {
                for &v in &used {
                    for c in 0..d {
                        bytes.extend_from_slice(&a[v as usize * d + c].to_le_bytes());
                    }
                }
            }
            for i in subs2.iter().flatten() {
                bytes.extend_from_slice(&i.to_le_bytes());
            }
            std::fs::write(self.out.join(&file), bytes)?;
            let tb: Vec<u8> = used.iter().flat_map(|&v| tan[v as usize * 4..v as usize * 4 + 4].iter().flat_map(|f| f.to_le_bytes())).collect();
            std::fs::write(self.out.join(file.replace(".bin", ".tan")), tb)?;
            out.push(MeshPiece { file, n: used.len(), subs: subs2.iter().map(Vec::len).collect(), name: name.clone(), spin: (k > 0).then(|| wheels[k - 1].clone()) });
        }
        self.meshes.insert(at, out.clone());
        Ok(out)
    }

    pub(crate) fn texture(&mut self, from: usize, tex: &V, normal: bool) -> Result<Option<String>> {
        let Some(at) = self.g.resolve(from, tex.pptr()) else { return Ok(None) };
        if let Some(f) = self.textures.get(&at) {
            return Ok(Some(f.clone()));
        }
        let t = self.g.read(at)?;
        if !matches!(t.get("m_TextureFormat").i(), 3 | 4 | 10 | 12) {
            eprintln!("game look: texture format {} not read", t.get("m_TextureFormat").i());
            return Ok(None);
        }
        let file = format!("textures/{}.png", Self::key(at));
        self.jobs.push((at, normal, file.clone()));
        // (normal maps, and textures not in sRGB, are plain values)
        self.linear.insert(file.clone(), normal || t.get("m_ColorSpace").i() == 0);
        self.textures.insert(at, file.clone());
        Ok(Some(file))
    }

    pub(crate) fn material(&mut self, at: At) -> Result<Value> {
        let g = self.g;
        let mat = g.read(at)?;
        let sp = mat.get("m_SavedProperties");
        let pairs = |name: &str| -> Vec<(String, V)> { sp.get(name).arr().iter().filter_map(|p| p.pair()).map(|(k, v)| (k.s().to_string(), v.clone())).collect() };
        let tex_envs = pairs("m_TexEnvs");
        let floats: HashMap<String, f64> = pairs("m_Floats").into_iter().map(|(k, v)| (k, v.f())).collect();
        let fl = |k: &str, d: f64| floats.get(k).copied().unwrap_or(d);
        let env = |k: &str| tex_envs.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
        let tex_of = |ks: &[&str]| ks.iter().find_map(|k| env(k).filter(|e| !e.get("m_Texture").pptr().is_null()));
        let base_env = env("_BaseMap");
        let (tiling, offset) = match &base_env {
            Some(e) => ([e.get("m_Scale").get("x").f(), e.get("m_Scale").get("y").f()], [e.get("m_Offset").get("x").f(), e.get("m_Offset").get("y").f()]),
            None => ([1.0, 1.0], [0.0, 0.0]),
        };
        let mut kw: Vec<String> = mat.get("m_ValidKeywords").arr().iter().map(|k| k.s().to_string()).collect();
        kw.extend(mat.get("m_ShaderKeywords").s().split_whitespace().map(str::to_string));
        let clip = fl("_AlphaClip", 0.0) > 0.5 || kw.iter().any(|k| k == "_ALPHATEST_ON") || fl("_RenderMode", 0.0) == 1.0;
        // its glow (a floodlight's lamps): the emission map times its colour, when the colour isn't black
        let glow: Option<[f64; 3]> = pairs("m_Colors")
            .into_iter()
            .find(|(k, _)| k == "_EmissionColor")
            .map(|(_, c)| [c.get("r").f(), c.get("g").f(), c.get("b").f()])
            .filter(|c| c.iter().any(|v| *v > 1e-3));
        let mut maps = serde_json::Map::new();
        let emit: &[(&str, &[&str], bool)] = if glow.is_some() { &[("emit", &["_EmissionMap"], false)] } else { &[] };
        for &(name, keys, normal) in [("base", &["_BaseMap"][..], false), ("normal", &["_NormalMap", "_BumpMap"][..], true), ("metal", &["_MetallicMap", "_MetallicGlossMap"][..], false), ("rough", &["_RoughnessMap"][..], false)].iter().chain(emit) {
            let f = match tex_of(keys) {
                Some(e) => self.texture(at.file, e.get("m_Texture"), normal)?,
                None => None,
            };
            maps.insert(name.into(), f.map_or(Value::Null, Value::String));
        }
        let linear: serde_json::Map<String, Value> = maps.iter().filter_map(|(k, v)| v.as_str().map(|f| (k.clone(), json!(self.linear.get(f).copied().unwrap_or(false))))).collect();
        let shader = g.resolve(at.file, mat.get("m_Shader").pptr()).and_then(|s| g.read(s).ok()).map(|s| s.get("m_ParsedForm").get("m_Name").s().to_string()).unwrap_or_default();
        let mut v = Value::Object(maps);
        let o = v.as_object_mut().unwrap();
        o.insert("name".into(), json!(mat.get("m_Name").s()));
        o.insert("linear".into(), Value::Object(linear));
        o.insert("metallic".into(), json!(fl("_Metallic", 0.0)));
        o.insert("roughness".into(), json!(fl("_Roughness", 1.0 - fl("_Smoothness", 0.5))));
        o.insert("smoothness".into(), json!(fl("_Smoothness", 0.5)));
        o.insert("brightness".into(), json!(fl("_Brightness", 1.0)));
        o.insert("hueShift".into(), json!(fl("_HueShift", 0.0)));
        o.insert("cutoff".into(), if clip { json!(fl("_Cutoff", 0.5)) } else { Value::Null });
        o.insert("doubleSided".into(), json!(fl("_Cull", 2.0) == 0.0));
        o.insert("tiling".into(), json!(tiling));
        o.insert("offset".into(), json!(offset));
        o.insert("uvChannel".into(), json!(fl("_UVChannel", 0.0) as i64));
        o.insert("shader".into(), json!(shader));
        if let Some(c) = glow {
            o.insert("emissionColor".into(), json!(c));
        }
        Ok(v)
    }
}
