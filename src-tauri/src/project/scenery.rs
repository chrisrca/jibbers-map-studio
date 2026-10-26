//! Scenery for real-world maps: the land around the play area as meshes the rider can't touch, never culled by
//! distance (the map format's way to show "decorative mountains"). The editor builds the strips (heights from an
//! elevation source) and a snow/rock texture; this turns them into one custom object in the project's library.

use anyhow::{bail, Context, Result};
use indexmap::IndexMap;
use crate::jbrmap::{CustomObject, Material, MeshData, Part, SurfaceType, TextureData};
use std::path::Path;

/// One strip as written by the editor: u32 vertex count, u32 index count, then f32 positions (x3), normals (x3),
/// uvs (x2) and u32 indices, all little-endian.
pub(crate) fn read_strip(bytes: &[u8]) -> Result<MeshData> {
    if bytes.len() < 8 {
        bail!("scenery strip too short");
    }
    let n = u32::from_le_bytes(bytes[0..4].try_into()?) as usize;
    let m = u32::from_le_bytes(bytes[4..8].try_into()?) as usize;
    let (pos, nrm, uv, idx) = (8, 8 + n * 12, 8 + n * 24, 8 + n * 32);
    if bytes.len() != idx + m * 4 {
        bail!("scenery strip has {} bytes, expected {}", bytes.len(), idx + m * 4);
    }
    Ok(MeshData {
        vertex_count: n as i32,
        vertices: Some(bytes[pos..nrm].to_vec()),
        normals: Some(bytes[nrm..uv].to_vec()),
        uvs: Some(bytes[uv..idx].to_vec()),
        // u32 and i32 share their bytes for every index a mesh can have
        submeshes: vec![Some(bytes[idx..].to_vec())],
        ..MeshData::default()
    })
}

/// Adds the strips (files relative to the project) and the texture (a PNG, likewise) to the project's library
/// under `Scenery/<name>/…` and returns the object that shows them. The files are removed afterwards.
pub fn add(project_dir: &Path, name: &str, strips: &[String], texture: &str) -> Result<CustomObject> {
    let prefix = format!("Scenery/{name}");
    let mut meshes = IndexMap::new();
    let tex_key = format!("{prefix}/albedo");
    let png = std::fs::read(project_dir.join(texture)).with_context(|| format!("read {texture}"))?;
    let img = image::load_from_memory(&png).context("scenery texture")?;
    let mut textures = IndexMap::new();
    textures.insert(
        tex_key.clone(),
        TextureData { format: 4, width: img.width() as i32, height: img.height() as i32, encoding: "png".into(), linear: false, mipmaps: true, compression: 1, data: Some(png) },
    );
    let material = Material { base_tex: tex_key, smoothness: 0.08, ..Material::default() };
    let mut parts = vec![];
    for (k, rel) in strips.iter().enumerate() {
        let bytes = std::fs::read(project_dir.join(rel)).with_context(|| format!("read {rel}"))?;
        let key = format!("{prefix}/strip-{k}");
        meshes.insert(key.clone(), read_strip(&bytes)?);
        // shadow casting off: kilometres of far terrain would cost the game more than they add
        parts.push(Part { mesh: key, materials: vec![material.clone()], shadow_casting_mode: 0, ..Part::default() });
    }
    crate::library::userassets::merge_into_project(project_dir, meshes, textures)?;
    for rel in strips.iter().chain(std::iter::once(&texture.to_string())) {
        std::fs::remove_file(project_dir.join(rel)).ok();
    }
    Ok(CustomObject {
        surface_type: SurfaceType::Generic,
        disable_distance_culling: true,
        parts,
        colliders: vec![],
        ..CustomObject::default()
    })
}

/// The play area's own terrain as one more, coarse part of the scenery (`<prefix>/inner`, written by the editor at
/// export, under the real terrain everywhere): what shows where the game has culled distant terrain, like an LOD.
/// Its texture coordinates are set to match the strips' (their texture spans their whole extent), and it replaces
/// any earlier one. Returns the mesh's key and the snow colour of the scenery's texture (sRGB, its brightest tenth:
/// rock left out), for tinting it to match the game's terrain.
pub fn set_inner(project_dir: &Path, prefix: &str, file: &str) -> Result<(String, [u8; 3])> {
    let lib_path = project_dir.join(crate::library::userassets::PROJECT_LIBRARY);
    let mut lib = crate::jbrmap::load(&lib_path).context("the map's library")?;
    // the strips' extent in x and z: what their texture covers
    let (mut x0, mut z0, mut x1, mut z1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for (k, m) in &lib.mesh_library {
        if !k.starts_with(&format!("{prefix}/strip-")) {
            continue;
        }
        for p in m.vertices.as_deref().unwrap_or_default().chunks_exact(12) {
            let x = f32::from_le_bytes(p[0..4].try_into()?);
            let z = f32::from_le_bytes(p[8..12].try_into()?);
            (x0, x1, z0, z1) = (x0.min(x), x1.max(x), z0.min(z), z1.max(z));
        }
    }
    if x0 >= x1 || z0 >= z1 {
        bail!("no scenery strips under {prefix}");
    }
    let bytes = std::fs::read(project_dir.join(file)).with_context(|| format!("read {file}"))?;
    let mut mesh = read_strip(&bytes)?;
    let pos = mesh.vertices.clone().unwrap_or_default();
    let mut uvs = Vec::with_capacity(pos.len() / 12 * 8);
    for p in pos.chunks_exact(12) {
        let x = f32::from_le_bytes(p[0..4].try_into()?);
        let z = f32::from_le_bytes(p[8..12].try_into()?);
        uvs.extend(((x - x0) / (x1 - x0)).to_le_bytes());
        uvs.extend(((z - z0) / (z1 - z0)).to_le_bytes());
    }
    mesh.uvs = Some(uvs);
    let key = format!("{prefix}/inner");
    lib.mesh_library.insert(key.clone(), mesh);
    // (any of its paintings: the snow is the same in all of them)
    let snow = lib.texture_library.iter().find(|(k, _)| k.starts_with(&format!("{prefix}/albedo"))).and_then(|(_, t)| t.data.as_deref()).and_then(|png| image::load_from_memory(png).ok()).map(|img| {
        let img = img.to_rgb8();
        let mut chans = [vec![], vec![], vec![]];
        for p in img.pixels().step_by(7) {
            for c in 0..3 {
                chans[c].push(p[c]);
            }
        }
        chans.map(|mut v| {
            v.sort_unstable();
            v.get(v.len() * 9 / 10).copied().unwrap_or(250)
        })
    });
    crate::jbrmap::save(&lib, &lib_path)?;
    std::fs::remove_file(project_dir.join(file)).ok();
    Ok((key, snow.unwrap_or([250, 250, 250])))
}

/// Snow and rock (sRGB), as geo/scenery/scenery.ts paints them: matched to the game's terrain in its lighting.
const SNOW: f32 = 250.0;
const ROCK: [f32; 3] = [178.0, 176.0, 172.0];
/// Degrees of slope over which snow turns to rock, from the rock angle up.
const ROCK_BLEND: f32 = 14.0;

/// Smooth value noise in [-1, 1] (geo/scenery/scenery.ts valueNoise).
fn value_noise(x: f64, z: f64) -> f64 {
    let hash = |i: i64, j: i64| -> f64 {
        let mut h = i.wrapping_mul(374761393).wrapping_add(j.wrapping_mul(668265263)) as i32;
        h = (h ^ ((h as u32 >> 13) as i32)).wrapping_mul(1274126177);
        ((h ^ ((h as u32 >> 16) as i32)) as u32) as f64 / 4294967295.0
    };
    let (i, j) = (x.floor() as i64, z.floor() as i64);
    let (fx, fz) = (x - i as f64, z - j as f64);
    let (u, v) = (fx * fx * (3.0 - 2.0 * fx), fz * fz * (3.0 - 2.0 * fz));
    let (a, b, c, d) = (hash(i, j), hash(i + 1, j), hash(i, j + 1), hash(i + 1, j + 1));
    ((a * (1.0 - u) + b * u) * (1.0 - v) + (c * (1.0 - u) + d * u) * v) * 2.0 - 1.0
}

fn floats(b: Option<&Vec<u8>>) -> Vec<f32> {
    b.map(|b| b.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()).unwrap_or_default()
}

/// The texture key a painting with rock from `rock_angle` degrees is kept under.
pub fn albedo_key(prefix: &str, rock_angle: f32) -> String {
    format!("{prefix}/albedo-{}", (rock_angle * 10.0).round() as i32)
}

/// Paints the scenery's texture again with rock from `rock_angle` degrees of slope up (snow below), the slopes read
/// from its own meshes (the strips, and the play area's coarse stand-in where it has one): each texel gets the slope
/// of the surface drawn there. Kept under a key of its own (`albedo_key`), so the painting it replaces stays for
/// undo; returns that key. Texels no mesh covers stay snow.
pub fn repaint(project_dir: &Path, prefix: &str, rock_angle: f32) -> Result<String> {
    let lib_path = project_dir.join(crate::library::userassets::PROJECT_LIBRARY);
    let mut lib = crate::jbrmap::load(&lib_path).context("the map's library")?;
    let key = albedo_key(prefix, rock_angle);
    let albedo = format!("{prefix}/albedo");
    let size = lib.texture_library.iter().find(|(k, _)| k.starts_with(&albedo)).map(|(_, t)| t.width.max(16) as usize).unwrap_or(2048);
    // the strips' extent: what the texture spans (as set_inner reads it)
    let (mut x0, mut z0, mut x1, mut z1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for (k, m) in &lib.mesh_library {
        if k.starts_with(&format!("{prefix}/strip-")) {
            for p in floats(m.vertices.as_ref()).chunks_exact(3) {
                (x0, x1, z0, z1) = (x0.min(p[0]), x1.max(p[0]), z0.min(p[2]), z1.max(p[2]));
            }
        }
    }
    if x0 >= x1 || z0 >= z1 {
        bail!("no scenery strips under {prefix}");
    }
    // each texel's slope (degrees); NaN where nothing is drawn. Row 0 is the north edge (v = 1), as Unity reads images.
    let t = size as f32;
    let mut slope = vec![f32::NAN; size * size];
    let mut parts: Vec<&String> = lib.mesh_library.keys().filter(|k| k.starts_with(&format!("{prefix}/"))).collect();
    // the strips last: where the stand-in and the strips' collar overlap, the collar is what shows
    parts.sort_by_key(|k| !k.ends_with("/inner"));
    for k in parts {
        let m = &lib.mesh_library[k];
        let (pos, nrm, uv) = (floats(m.vertices.as_ref()), floats(m.normals.as_ref()), floats(m.uvs.as_ref()));
        let n = pos.len() / 3;
        if nrm.len() != n * 3 || uv.len() != n * 2 {
            continue;
        }
        let idx: Vec<usize> = m
            .submeshes
            .first()
            .and_then(|s| s.as_ref())
            .map(|b| b.chunks_exact(4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]]) as usize).collect())
            .unwrap_or_default();
        for tri in idx.chunks_exact(3) {
            if tri.iter().any(|&v| v >= n) {
                continue;
            }
            let p = [tri[0], tri[1], tri[2]].map(|v| (uv[v * 2] * t, (1.0 - uv[v * 2 + 1]) * t));
            let area = (p[1].0 - p[0].0) * (p[2].1 - p[0].1) - (p[2].0 - p[0].0) * (p[1].1 - p[0].1);
            // (the stand-in's skirt: walls, flat in the texture)
            if area.abs() < 1e-6 {
                continue;
            }
            let lx = p.iter().map(|q| q.0).fold(f32::MAX, f32::min);
            let hx = p.iter().map(|q| q.0).fold(f32::MIN, f32::max);
            let ly = p.iter().map(|q| q.1).fold(f32::MAX, f32::min);
            let hy = p.iter().map(|q| q.1).fold(f32::MIN, f32::max);
            if hx < 0.0 || hy < 0.0 || lx > t || ly > t {
                continue;
            }
            let (i0, i1) = ((lx - 0.5).floor().max(0.0) as usize, ((hx - 0.5).ceil().max(0.0) as usize).min(size - 1));
            let (j0, j1) = ((ly - 0.5).floor().max(0.0) as usize, ((hy - 0.5).ceil().max(0.0) as usize).min(size - 1));
            let nv = [tri[0], tri[1], tri[2]].map(|v| [nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]]);
            for j in j0..=j1 {
                for i in i0..=i1 {
                    let (cx, cy) = (i as f32 + 0.5, j as f32 + 0.5);
                    // barycentric weights of the texel's centre
                    let w1 = ((cx - p[0].0) * (p[2].1 - p[0].1) - (p[2].0 - p[0].0) * (cy - p[0].1)) / area;
                    let w2 = ((p[1].0 - p[0].0) * (cy - p[0].1) - (cx - p[0].0) * (p[1].1 - p[0].1)) / area;
                    let w0 = 1.0 - w1 - w2;
                    if w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4 {
                        continue;
                    }
                    let nn = [0, 1, 2].map(|d| nv[0][d] * w0 + nv[1][d] * w1 + nv[2][d] * w2);
                    let len = (nn[0] * nn[0] + nn[1] * nn[1] + nn[2] * nn[2]).sqrt();
                    if len > 1e-6 {
                        slope[j * size + i] = (nn[1].abs() / len).min(1.0).acos().to_degrees();
                    }
                }
            }
        }
    }
    let mut px = image::RgbaImage::new(size as u32, size as u32);
    for j in 0..size {
        let z = (z1 - (j as f32 + 0.5) / t * (z1 - z0)) as f64;
        for i in 0..size {
            let x = (x0 + (i as f32 + 0.5) / t * (x1 - x0)) as f64;
            let s = slope[j * size + i];
            let r = if s.is_nan() { 0.0 } else { ((s - rock_angle) / ROCK_BLEND).clamp(0.0, 1.0) };
            let k2 = r * r * (3.0 - 2.0 * r);
            // a little variation so big slopes aren't flat colour
            let grain = ((value_noise(x / 420.0, z / 420.0) * 0.6 + value_noise(x / 90.0, z / 90.0) * 0.4) * (3.0 + 9.0 * k2 as f64) - 2.0) as f32;
            let c = |k: usize| (SNOW + (ROCK[k] - SNOW) * k2 + grain).round().clamp(0.0, 255.0) as u8;
            px.put_pixel(i as u32, j as u32, image::Rgba([c(0), c(1), c(2), 255]));
        }
    }
    let mut png = vec![];
    px.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;
    lib.texture_library.insert(
        key.clone(),
        TextureData { format: 4, width: size as i32, height: size as i32, encoding: "png".into(), linear: false, mipmaps: true, compression: 1, data: Some(png) },
    );
    crate::jbrmap::save(&lib, &lib_path)?;
    Ok(key)
}

/// Scenery paintings no piece uses any more (the ones left behind for undo by `repaint`), left out of a map.
pub fn unused_paintings(textures: &IndexMap<String, TextureData>, used: &std::collections::HashSet<&str>) -> Vec<String> {
    textures.keys().filter(|k| k.starts_with("Scenery/") && k.contains("/albedo") && !used.contains(k.as_str())).cloned().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_strip() {
        let (n, m) = (3u32, 3u32);
        let mut b = vec![];
        b.extend(n.to_le_bytes());
        b.extend(m.to_le_bytes());
        for v in [0f32, 0., 0., 1., 0., 0., 0., 0., 1.] {
            b.extend(v.to_le_bytes());
        }
        for v in [0f32, 1., 0., 0., 1., 0., 0., 1., 0.] {
            b.extend(v.to_le_bytes());
        }
        for v in [0f32, 0., 1., 0., 0., 1.] {
            b.extend(v.to_le_bytes());
        }
        for i in [0u32, 2, 1] {
            b.extend(i.to_le_bytes());
        }
        let mesh = read_strip(&b).unwrap();
        assert_eq!(mesh.vertex_count, 3);
        assert_eq!(mesh.vertices.unwrap().len(), 36);
        assert_eq!(mesh.submeshes[0].as_ref().unwrap().len(), 12);
        assert!(read_strip(&b[..b.len() - 1]).is_err());
    }

    /// A strip: one quad over 100 m square, its east half flat and its west half rising at 45 degrees.
    fn slope_strip() -> Vec<u8> {
        let mut pos = vec![];
        let mut nrm = vec![];
        let mut uvs = vec![];
        let s = std::f32::consts::FRAC_1_SQRT_2;
        // x = -50, 0, 50 by z = -50, 50; heights rise westwards from x = 0
        for z in [-50f32, 50.] {
            for (x, y, n) in [(-50f32, 50f32, [s, s, 0.]), (0., 0., [0., 1., 0.]), (50., 0., [0., 1., 0.])] {
                pos.extend([x, y, z]);
                nrm.extend(n);
                uvs.extend([(x + 50.) / 100., (z + 50.) / 100.]);
            }
        }
        let idx = [0u32, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2];
        let mut b = vec![];
        b.extend(6u32.to_le_bytes());
        b.extend((idx.len() as u32).to_le_bytes());
        for v in pos.iter().chain(&nrm).chain(&uvs) {
            b.extend(v.to_le_bytes());
        }
        for i in idx {
            b.extend(i.to_le_bytes());
        }
        b
    }

    #[test]
    fn repaints_rock_from_the_angle() {
        let dir = std::env::temp_dir().join(format!("scenery-repaint-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        let mut lib = crate::jbrmap::MapData::default();
        lib.mesh_library.insert("Scenery/S/strip-0".into(), read_strip(&slope_strip()).unwrap());
        let tex = TextureData { format: 4, width: 64, height: 64, encoding: "png".into(), linear: false, mipmaps: true, compression: 1, data: None };
        lib.texture_library.insert("Scenery/S/albedo".into(), tex);
        crate::jbrmap::save(&lib, dir.join(crate::library::userassets::PROJECT_LIBRARY)).unwrap();
        // the west quarter (all 45 degrees) and the east quarter (flat), on the middle row
        let shade = |angle: f32| {
            let key = repaint(&dir, "Scenery/S", angle).unwrap();
            assert_eq!(key, albedo_key("Scenery/S", angle));
            let lib = crate::jbrmap::load(dir.join(crate::library::userassets::PROJECT_LIBRARY)).unwrap();
            let img = image::load_from_memory(lib.texture_library[&key].data.as_deref().unwrap()).unwrap().to_rgb8();
            assert_eq!(img.width(), 64);
            (img.get_pixel(8, 32)[0], img.get_pixel(56, 32)[0])
        };
        let (west, east) = shade(20.);
        assert!(west < 195 && east > 240, "rock from 20 degrees: {west} {east}");
        let (west, east) = shade(50.);
        assert!(west > 240 && east > 240, "rock from 50 degrees: {west} {east}");
        // both paintings kept (undo goes back to the first); the unused one left out of a map
        let lib = crate::jbrmap::load(dir.join(crate::library::userassets::PROJECT_LIBRARY)).unwrap();
        let used = std::collections::HashSet::from([albedo_key("Scenery/S", 50.)]);
        let used = used.iter().map(|s| s.as_str()).collect();
        let mut unused = unused_paintings(&lib.texture_library, &used);
        unused.sort();
        assert_eq!(unused, vec!["Scenery/S/albedo".to_string(), albedo_key("Scenery/S", 20.)]);
        std::fs::remove_dir_all(&dir).ok();
    }
}
