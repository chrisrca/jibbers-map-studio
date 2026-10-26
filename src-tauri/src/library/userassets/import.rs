//! Importing a model you give (glTF/GLB or OBJ, with its textures): converted into a piece (its meshes, materials and a
//! box collider), its axes and size as you chose.

use super::*;

/// How a model file maps into the game.
#[derive(Clone, Copy, Debug)]
pub struct ImportOpts {
    /// The file is in three.js-style space with Unity's Z mirrored (the studio's own placeholder GLBs), rather than
    /// glTF's convention. Either way one axis is mirrored to reach Unity's left-handed space.
    pub mirror_z: bool,
    /// Uniform scale baked into the vertices.
    pub scale: f32,
    /// Move the pivot to the bottom centre and add a box collider (user imports). Library features keep the
    /// pivot the game uses and get their colliders from the caller.
    pub recenter: bool,
}

impl Default for ImportOpts {
    fn default() -> Self {
        ImportOpts { mirror_z: false, scale: 1.0, recenter: true }
    }
}

impl ImportOpts {
    /// glTF/OBJ are right-handed (+Y up, +Z front); Unity is left-handed. Mirroring X keeps up and front.
    pub(crate) fn point(&self, p: [f32; 3]) -> [f32; 3] {
        let s = self.scale;
        if self.mirror_z { [p[0] * s, p[1] * s, -p[2] * s] } else { [-p[0] * s, p[1] * s, p[2] * s] }
    }
    pub(crate) fn normal(&self, n: [f32; 3]) -> [f32; 3] {
        if self.mirror_z { [n[0], n[1], -n[2]] } else { [-n[0], n[1], n[2]] }
    }
}

/// A converted model: one object (pivot at the origin) and the meshes/textures it uses.
pub struct Converted {
    pub name: String,
    pub object: CustomObject,
    pub meshes: IndexMap<String, MeshData>,
    pub textures: IndexMap<String, TextureData>,
}

pub(crate) struct Builder {
    pub(crate) name: String,
    pub(crate) opts: ImportOpts,
    /// key prefix keeping this asset's meshes/textures apart from everything else in a project library
    pub(crate) prefix: String,
    pub(crate) meshes: IndexMap<String, MeshData>,
    pub(crate) textures: IndexMap<String, TextureData>,
    pub(crate) parts: Vec<Part>,
    /// texture source id → library key
    pub(crate) texture_keys: IndexMap<String, String>,
}

/// Texture coordinates for a model that has none (the official features' models, many OBJs), so a texture can go on
/// it: each point takes the two coordinates across the way its surface faces, in metres (Blender's cube projection) —
/// a texture repeats once a metre, and stripes run along a rail.
pub(crate) fn box_uvs(pos: &[[f32; 3]], nrm: Option<&[[f32; 3]]>) -> Vec<[f32; 2]> {
    pos.iter()
        .enumerate()
        .map(|(i, p)| {
            let n = nrm.map_or([0.0, 1.0, 0.0], |n| n[i]);
            let (ax, ay, az) = (n[0].abs(), n[1].abs(), n[2].abs());
            if ax >= ay && ax >= az {
                [p[2], p[1]]
            } else if ay >= az {
                [p[0], p[2]]
            } else {
                [p[0], p[1]]
            }
        })
        .collect()
}

/// One mesh's geometry in Unity space, one index list per material.
#[derive(Default)]
pub(crate) struct Geo {
    pub(crate) pos: Vec<[f32; 3]>,
    pub(crate) nrm: Vec<[f32; 3]>,
    pub(crate) uv: Vec<[f32; 2]>,
    pub(crate) submeshes: Vec<Vec<u32>>,
}

pub(crate) fn bytes_f32<const N: usize>(v: &[[f32; N]]) -> Vec<u8> {
    v.iter().flat_map(|a| a.iter().flat_map(|f| f.to_le_bytes())).collect()
}

impl Builder {
    pub(crate) fn new(name: &str) -> Self {
        Builder::with(name, ImportOpts::default())
    }

    pub(crate) fn with(name: &str, opts: ImportOpts) -> Self {
        Builder {
            name: name.into(),
            opts,
            prefix: format!("User/{}-{:08x}", slug(name), rand_id()),
            meshes: IndexMap::new(),
            textures: IndexMap::new(),
            parts: vec![],
            texture_keys: IndexMap::new(),
        }
    }

    pub(crate) fn texture(&mut self, source_id: &str, label: &str, img: image::RgbaImage) -> Result<String> {
        if let Some(k) = self.texture_keys.get(source_id) {
            return Ok(k.clone());
        }
        let img = if img.width() > MAX_TEXTURE || img.height() > MAX_TEXTURE {
            let s = MAX_TEXTURE as f32 / img.width().max(img.height()) as f32;
            image::imageops::resize(&img, ((img.width() as f32 * s) as u32).max(1), ((img.height() as f32 * s) as u32).max(1), image::imageops::FilterType::Lanczos3)
        } else {
            img
        };
        let mut png = vec![];
        img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;
        let key = format!("{}/{}", self.prefix, unique(&self.textures, &slug(label)));
        self.textures.insert(
            key.clone(),
            TextureData { format: 4, width: img.width() as i32, height: img.height() as i32, encoding: "png".into(), linear: false, mipmaps: true, compression: 1, data: Some(png) },
        );
        self.texture_keys.insert(source_id.into(), key.clone());
        Ok(key)
    }

    pub(crate) fn add_part(&mut self, label: &str, mut g: Geo, materials: Vec<Material>) {
        if g.pos.is_empty() || g.submeshes.iter().all(|s| s.is_empty()) {
            return;
        }
        let key = format!("{}/{}", self.prefix, unique(&self.meshes, &slug(label)));
        let has_n = g.nrm.len() == g.pos.len();
        // (none, or all at one point: what a model without them comes in as)
        if g.uv.len() != g.pos.len() || g.uv.iter().all(|t| *t == g.uv[0]) {
            g.uv = box_uvs(&g.pos, has_n.then_some(&g.nrm[..]));
        }
        let has_uv = g.uv.len() == g.pos.len();
        self.meshes.insert(
            key.clone(),
            MeshData {
                vertex_count: g.pos.len() as i32,
                vertices: Some(bytes_f32(&g.pos)),
                normals: has_n.then(|| bytes_f32(&g.nrm)),
                uvs: has_uv.then(|| bytes_f32(&g.uv)),
                submeshes: g.submeshes.iter().map(|s| Some(s.iter().flat_map(|i| (*i as i32).to_le_bytes()).collect())).collect(),
                ..MeshData::default()
            },
        );
        self.parts.push(Part { mesh: key, materials, ..Part::default() });
    }

    /// With `recenter`, moves the pivot to the bottom centre (it then sits on the ground where it's dropped) and
    /// adds a box collider around it.
    pub(crate) fn finish(mut self) -> Result<Converted> {
        if self.parts.is_empty() {
            bail!("no meshes found");
        }
        if !self.opts.recenter {
            let obj = CustomObject { parts: self.parts, ..CustomObject::default() };
            return Ok(Converted { name: self.name, object: obj, meshes: self.meshes, textures: self.textures });
        }
        let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
        for m in self.meshes.values() {
            for p in m.vertices.as_deref().unwrap_or_default().chunks_exact(12) {
                for k in 0..3 {
                    let v = f32::from_le_bytes(p[k * 4..k * 4 + 4].try_into().unwrap());
                    lo[k] = lo[k].min(v);
                    hi[k] = hi[k].max(v);
                }
            }
        }
        let shift = [-(lo[0] + hi[0]) / 2.0, -lo[1], -(lo[2] + hi[2]) / 2.0];
        for m in self.meshes.values_mut() {
            if let Some(v) = m.vertices.as_mut() {
                for p in v.chunks_exact_mut(12) {
                    for k in 0..3 {
                        let x = f32::from_le_bytes(p[k * 4..k * 4 + 4].try_into().unwrap()) + shift[k];
                        p[k * 4..k * 4 + 4].copy_from_slice(&x.to_le_bytes());
                    }
                }
            }
        }
        let size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
        let obj = CustomObject {
            surface_type: SurfaceType::Generic,
            position: Vec3::ZERO,
            rotation: Vec3::ZERO,
            scale: Vec3::ONE,
            parts: self.parts,
            colliders: vec![box_collider(size)],
            ..CustomObject::default()
        };
        Ok(Converted { name: self.name, object: obj, meshes: self.meshes, textures: self.textures })
    }
}

pub(crate) fn box_collider(size: [f32; 3]) -> Collider {
    Collider {
        shape: ColliderShape::Box,
        surface_type: SurfaceType::Generic,
        local_position: Vec3::ZERO,
        local_rotation: Vec3::ZERO,
        local_scale: Vec3::ONE,
        center: Vec3::new(0.0, size[1] / 2.0, 0.0),
        // the game's physics rejects zero-size geoms (flat planes, decals): give every axis some thickness
        size: Vec3::new(size[0].max(0.02), size[1].max(0.02), size[2].max(0.02)),
        radius: 0.5,
        height: 1.0,
        direction: 1,
        mesh_ref: String::new(),
    }
}

pub(crate) fn unique<V>(map: &IndexMap<String, V>, base: &str) -> String {
    let base = if base.is_empty() { "part" } else { base };
    let mut k = base.to_string();
    let mut n = 2;
    while map.keys().any(|x| x.ends_with(&format!("/{k}"))) {
        k = format!("{base}-{n}");
        n += 1;
    }
    k
}

pub(crate) fn rand_id() -> u32 {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
    (t.as_nanos() as u32) ^ std::process::id().rotate_left(16)
}

pub(crate) fn srgb(c: f32) -> f32 {
    // glTF colour factors are linear; Unity material colours are authored in sRGB
    if c <= 0.003_130_8 { c * 12.92 } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 }
}

/// Imports a model file into the personal library.
pub fn import(file: &Path) -> Result<AssetInfo> {
    let c = convert(file, ImportOpts::default())?;
    save_asset(&c.name, c.object, c.meshes, c.textures)
}

/// Converts a model file into the game's format without storing it.
pub fn convert(file: &Path, opts: ImportOpts) -> Result<Converted> {
    let name = file.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Asset".into());
    match file.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).as_deref() {
        Some("glb" | "gltf") => import_gltf(file, &name, opts),
        Some("obj") => import_obj(file, &name, opts),
        Some("fbx") => bail!("FBX isn't supported yet — export it as GLB (in Blender: File › Export › glTF 2.0) and import that"),
        _ => bail!("unsupported file type (use .glb, .gltf or .obj)"),
    }
}

pub(crate) fn import_gltf(file: &Path, name: &str, opts: ImportOpts) -> Result<Converted> {
    let (model, buffers, images) = gltf::import(file).with_context(|| format!("read {}", file.display()))?;
    let mut b = Builder::with(name, opts);

    let mut materials = vec![];
    for m in model.materials() {
        let pbr = m.pbr_metallic_roughness();
        let f = pbr.base_color_factor();
        let mut mat = Material {
            base_color: Color { r: srgb(f[0]), g: srgb(f[1]), b: srgb(f[2]), a: f[3] },
            metallic: pbr.metallic_factor(),
            smoothness: 1.0 - pbr.roughness_factor(),
            cull_mode: if m.double_sided() { 0 } else { 2 },
            ..Material::default()
        };
        match m.alpha_mode() {
            gltf::material::AlphaMode::Opaque => {}
            gltf::material::AlphaMode::Mask => {
                mat.render_mode = 1;
                mat.alpha_cutoff = m.alpha_cutoff().unwrap_or(0.5);
            }
            gltf::material::AlphaMode::Blend => mat.render_mode = 2,
        }
        if let Some(info) = pbr.base_color_texture() {
            let tex = info.texture();
            let idx = tex.source().index();
            if let Some(img) = images.get(idx).and_then(gltf_image_rgba) {
                let label = tex.source().name().or(m.name()).unwrap_or("texture").to_string();
                mat.base_tex = b.texture(&format!("img{idx}"), &label, img)?;
            }
            if let Some(t) = info.texture_transform() {
                mat.tiling = Vec2 { x: t.scale()[0], y: t.scale()[1] };
                mat.offset = Vec2 { x: t.offset()[0], y: t.offset()[1] };
            }
        }
        materials.push(mat);
    }

    // Bake each node's world transform into its mesh, one part per mesh instance.
    fn walk<'a>(node: gltf::Node<'a>, parent: Mat4, out: &mut Vec<(gltf::Node<'a>, Mat4)>) {
        let m = mul(&parent, &node.transform().matrix());
        out.push((node.clone(), m));
        for c in node.children() {
            walk(c, m, out);
        }
    }
    let mut nodes = vec![];
    let scene = model.default_scene().or_else(|| model.scenes().next()).context("no scene")?;
    for n in scene.nodes() {
        walk(n, IDENTITY, &mut nodes);
    }
    for (node, world) in nodes {
        let Some(mesh) = node.mesh() else { continue };
        let normal_m = normal_matrix(&world);
        let mirrored = det3(&world) < 0.0;
        let mut g = Geo::default();
        let mut mats = vec![];
        for prim in mesh.primitives() {
            if prim.mode() != gltf::mesh::Mode::Triangles {
                continue;
            }
            let r = prim.reader(|buf| buffers.get(buf.index()).map(|d| &d.0[..]));
            let Some(pos) = r.read_positions() else { continue };
            let base = g.pos.len() as u32;
            let pos: Vec<[f32; 3]> = pos.collect();
            let n = pos.len();
            g.pos.extend(pos.iter().map(|p| opts.point(point(&world, *p))));
            match r.read_normals() {
                Some(ns) => g.nrm.extend(ns.map(|v| opts.normal(normalize(mat3_mul(&normal_m, v))))),
                None => g.nrm.extend(std::iter::repeat_n([0.0, 1.0, 0.0], n)),
            }
            match r.read_tex_coords(0) {
                // glTF UVs start top-left; Unity's start bottom-left
                Some(uv) => g.uv.extend(uv.into_f32().map(|[u, v]| [u, 1.0 - v])),
                None => g.uv.extend(std::iter::repeat_n([0.0, 0.0], n)),
            }
            let idx: Vec<u32> = match r.read_indices() {
                Some(i) => i.into_u32().collect(),
                None => (0..n as u32).collect(),
            };
            // Mirroring X flips handedness, so reverse the winding (unless the node itself was mirrored, which
            // flipped it already). The test below pins this against how Unity-exported meshes are wound.
            let tris = idx.chunks_exact(3).flat_map(|t| if mirrored { [base + t[0], base + t[1], base + t[2]] } else { [base + t[0], base + t[2], base + t[1]] });
            g.submeshes.push(tris.collect());
            mats.push(prim.material().index().and_then(|i| materials.get(i).cloned()).unwrap_or_default());
        }
        let label = node.name().or(mesh.name()).unwrap_or("mesh").to_string();
        b.add_part(&label, g, mats);
    }
    b.finish()
}

// Column-major 4x4 matrices, as glTF stores them (m[column][row]).
pub(crate) type Mat4 = [[f32; 4]; 4];

pub(crate) const IDENTITY: Mat4 = [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, 0.0, 0.0, 1.0]];

pub(crate) fn mul(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut r = [[0.0; 4]; 4];
    for c in 0..4 {
        for row in 0..4 {
            r[c][row] = (0..4).map(|k| a[k][row] * b[c][k]).sum();
        }
    }
    r
}

pub(crate) fn point(m: &Mat4, p: [f32; 3]) -> [f32; 3] {
    [0, 1, 2].map(|row| m[0][row] * p[0] + m[1][row] * p[1] + m[2][row] * p[2] + m[3][row])
}

pub(crate) fn det3(m: &Mat4) -> f32 {
    let a = |r: usize, c: usize| m[c][r];
    a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) - a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0))
        + a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0))
}

/// Inverse-transpose of the upper 3x3 (row-major result), for transforming normals: cofactors / determinant.
pub(crate) fn normal_matrix(m: &Mat4) -> [[f32; 3]; 3] {
    let a = |r: usize, c: usize| m[c][r];
    let d = det3(m);
    let d = if d.abs() < 1e-12 { 1.0 } else { d };
    [
        [(a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) / d, -(a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0)) / d, (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0)) / d],
        [-(a(0, 1) * a(2, 2) - a(0, 2) * a(2, 1)) / d, (a(0, 0) * a(2, 2) - a(0, 2) * a(2, 0)) / d, -(a(0, 0) * a(2, 1) - a(0, 1) * a(2, 0)) / d],
        [(a(0, 1) * a(1, 2) - a(0, 2) * a(1, 1)) / d, -(a(0, 0) * a(1, 2) - a(0, 2) * a(1, 0)) / d, (a(0, 0) * a(1, 1) - a(0, 1) * a(1, 0)) / d],
    ]
}

pub(crate) fn mat3_mul(m: &[[f32; 3]; 3], v: [f32; 3]) -> [f32; 3] {
    [0, 1, 2].map(|r| m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2])
}

pub(crate) fn normalize(v: [f32; 3]) -> [f32; 3] {
    let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if l < 1e-12 { [0.0, 1.0, 0.0] } else { [v[0] / l, v[1] / l, v[2] / l] }
}

pub(crate) fn gltf_image_rgba(img: &gltf::image::Data) -> Option<image::RgbaImage> {
    use gltf::image::Format;
    let (w, h) = (img.width, img.height);
    let px = &img.pixels;
    let rgba: Vec<u8> = match img.format {
        Format::R8G8B8A8 => px.clone(),
        Format::R8G8B8 => px.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
        Format::R8 => px.iter().flat_map(|&c| [c, c, c, 255]).collect(),
        Format::R8G8 => px.chunks_exact(2).flat_map(|c| [c[0], c[0], c[0], c[1]]).collect(),
        _ => return None,
    };
    image::RgbaImage::from_raw(w, h, rgba)
}

pub(crate) fn import_obj(file: &Path, name: &str, opts: ImportOpts) -> Result<Converted> {
    let (models, mtl) = tobj::load_obj(file, &tobj::LoadOptions { triangulate: true, single_index: true, ..Default::default() })
        .with_context(|| format!("read {}", file.display()))?;
    let mtls = mtl.unwrap_or_default();
    let dir = file.parent().unwrap_or(Path::new("."));
    let mut b = Builder::with(name, opts);
    let mut materials = vec![];
    for m in &mtls {
        let d = m.diffuse.unwrap_or([0.8, 0.8, 0.8]);
        let mut mat = Material {
            base_color: Color { r: d[0], g: d[1], b: d[2], a: m.dissolve.unwrap_or(1.0) },
            smoothness: m.shininess.map_or(0.2, |s| (s / 1000.0).clamp(0.0, 1.0)),
            ..Material::default()
        };
        if mat.base_color.a < 0.999 {
            mat.render_mode = 2;
        }
        if let Some(tex) = &m.diffuse_texture {
            let p = dir.join(tex.replace('\\', "/"));
            match image::open(&p) {
                Ok(img) => mat.base_tex = b.texture(&p.display().to_string(), Path::new(tex).file_stem().map_or("texture".into(), |s| s.to_string_lossy()).as_ref(), img.to_rgba8())?,
                Err(e) => eprintln!("texture {}: {e}", p.display()),
            }
        }
        materials.push(mat);
    }
    for model in models {
        let m = &model.mesh;
        let n = m.positions.len() / 3;
        let mut g = Geo { pos: (0..n).map(|i| opts.point([m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]])).collect(), ..Geo::default() };
        if m.normals.len() == n * 3 {
            g.nrm = (0..n).map(|i| opts.normal([m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]])).collect();
        }
        if m.texcoords.len() == n * 2 {
            // OBJ UVs already start bottom-left like Unity's
            g.uv = (0..n).map(|i| [m.texcoords[i * 2], m.texcoords[i * 2 + 1]]).collect();
        }
        // mirroring X flips handedness: reverse the winding
        g.submeshes.push(m.indices.chunks_exact(3).flat_map(|t| [t[0], t[2], t[1]]).collect());
        let mat = m.material_id.and_then(|i| materials.get(i).cloned()).unwrap_or_default();
        b.add_part(&model.name, g, vec![mat]);
    }
    b.finish()
}
