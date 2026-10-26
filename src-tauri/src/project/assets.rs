//! Viewport-ready copies of a project's custom-object library (meshes + textures from `assets/library.jbrmap`).
//!
//! The library stores Unity data: little-endian float arrays per mesh and mostly DXT-compressed textures with mip
//! chains. The viewport wants plain geometry and images, so each mesh is written as one flat binary file and each
//! texture as a PNG (at most `MAX_TEXTURE` px — it's an editor preview). Results are cached in
//! `<project>/cache/assets/` and rebuilt only when the library file changes.

use std::path::Path;

use anyhow::{Context, Result};
use indexmap::IndexMap;
use crate::jbrmap::{MeshData, TextureData};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

const MAX_TEXTURE: u32 = 1024;
const CACHE_VERSION: u32 = 3;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MeshEntry {
    /// File (relative to the cache dir): positions f32x3, normals f32x3, uvs f32x2 per vertex, then each
    /// submesh's u32 indices. Missing normals/uvs are written as zeros.
    pub file: String,
    pub vertex_count: u32,
    pub has_normals: bool,
    pub submeshes: Vec<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndex {
    pub version: u32,
    /// Library file's size + mtime the cache was built from.
    pub stamp: String,
    /// Absolute cache directory.
    pub dir: String,
    pub meshes: IndexMap<String, MeshEntry>,
    /// Texture key → PNG file (relative to `dir`).
    pub textures: IndexMap<String, String>,
    /// Texture key → whether its values are used as they are (true) or as sRGB colour, as the game reads it.
    #[serde(default)]
    pub linear: IndexMap<String, bool>,
}

fn stamp(lib: &Path) -> Result<String> {
    let m = std::fs::metadata(lib)?;
    let t = m.modified()?.duration_since(std::time::UNIX_EPOCH)?.as_millis();
    Ok(format!("{}-{}", m.len(), t))
}

/// Builds (or reuses) the viewport cache for the project at `dir`. Empty when it has no library.
/// `library`: the project's library file as the editor has it now (a map that hasn't been saved since its first
/// asset was placed doesn't have it in project.json yet); `None` = read it from project.json.
pub fn prepare(dir: &Path, library: Option<String>) -> Result<AssetIndex> {
    let lib_rel = match library {
        Some(l) => l,
        None => match super::load(dir)?.library {
            Some(l) => l,
            None => return Ok(AssetIndex::default()),
        },
    };
    if !dir.join(&lib_rel).exists() {
        return Ok(AssetIndex::default());
    }
    prepare_library(&dir.join(&lib_rel), &dir.join("cache").join("assets"))
}

/// Same, for a standalone library file (previews). Cached under `<studio data>\cache\<hash of path>`.
pub fn prepare_file(path: &Path) -> Result<AssetIndex> {
    let base = crate::library::userassets::data_dir()?.join("cache");
    let cache = base.join(format!("{:016x}", fnv(&[&path.display().to_string()])));
    prepare_library(path, &cache)
}

/// Converts the meshes/textures of the .jbrmap at `lib_path` into `cache` (incrementally).
pub fn prepare_library(lib_path: &Path, cache: &Path) -> Result<AssetIndex> {
    let lib_path = lib_path.to_path_buf();
    let cache = cache.to_path_buf();
    let index_path = cache.join("index.json");
    let stamp = stamp(&lib_path)?;
    let old = std::fs::read_to_string(&index_path)
        .ok()
        .and_then(|t| serde_json::from_str::<AssetIndex>(&t).ok())
        .filter(|idx| idx.version == CACHE_VERSION);
    if let Some(mut idx) = old.clone().filter(|idx| idx.stamp == stamp) {
        idx.dir = cache.display().to_string();
        return Ok(idx);
    }
    let old = old.unwrap_or_default();
    if old.version != CACHE_VERSION && cache.exists() {
        std::fs::remove_dir_all(&cache).ok(); // older layout
    }
    std::fs::create_dir_all(&cache)?;
    let lib = crate::jbrmap::load(&lib_path).with_context(|| format!("read {}", lib_path.display()))?;

    // Files are named after their source (key + a size signature), so after the library changes — e.g. an asset
    // was added — everything already converted is reused and only new entries are processed.
    let meshes: Vec<(String, MeshEntry)> = lib
        .mesh_library
        .iter()
        .collect::<Vec<_>>()
        .into_par_iter()
        .filter_map(|(key, mesh)| {
            // (what changes when a mesh is rebuilt: its sizes, and its data — sampled, as a whole library's worth is
            // looked at each time it changes)
            let mut sig = format!("{}|{}|", mesh.vertex_count, sampled(&mesh.vertices));
            for s in &mesh.submeshes {
                sig.push_str(&format!("{},", sampled(s)));
            }
            let file = format!("m{:016x}.bin", fnv(&[key, &sig]));
            if let Some(e) = old.meshes.get(key).filter(|e| e.file == file && cache.join(&file).exists()) {
                return Some((key.clone(), e.clone()));
            }
            match write_mesh(mesh, &cache.join(&file)) {
                Ok((vertex_count, has_normals, submeshes)) => Some((key.clone(), MeshEntry { file, vertex_count, has_normals, submeshes })),
                Err(e) => {
                    eprintln!("skipping mesh {key}: {e:#}");
                    None
                }
            }
        })
        .collect();
    let textures: Vec<(String, String)> = lib
        .texture_library
        .iter()
        .collect::<Vec<_>>()
        .into_par_iter()
        .filter_map(|(key, tex)| {
            let sig = format!("{}|{}|{}|{}|{}", tex.format, tex.width, tex.height, sampled(&tex.data), tex.linear);
            let file = format!("t{:016x}.png", fnv(&[key, &sig]));
            if old.textures.get(key).is_some_and(|f| *f == file) && cache.join(&file).exists() {
                return Some((key.clone(), file));
            }
            match write_texture(tex, &cache.join(&file)) {
                Ok(()) => Some((key.clone(), file)),
                Err(e) => {
                    eprintln!("skipping texture {key}: {e:#}");
                    None
                }
            }
        })
        .collect();

    let idx = AssetIndex {
        version: CACHE_VERSION,
        stamp,
        dir: cache.display().to_string(),
        meshes: meshes.into_iter().collect(),
        textures: textures.into_iter().collect(),
        linear: lib.texture_library.iter().map(|(k, t)| (k.clone(), t.linear)).collect(),
    };
    std::fs::write(&index_path, serde_json::to_vec(&idx)?)?;
    Ok(idx)
}

/// A data blob's length and a hash of its start and end (cheap, and changes with any rebuild in practice).
fn sampled(data: &Option<Vec<u8>>) -> String {
    let d = data.as_deref().unwrap_or(&[]);
    let (head, tail) = (&d[..d.len().min(4096)], &d[d.len().saturating_sub(4096)..]);
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in head.iter().chain(tail) {
        h ^= b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{}:{h:x}", d.len())
}

/// FNV-1a over a few strings (stable across runs, unlike std's hasher).
fn fnv(parts: &[&str]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for p in parts {
        for b in p.bytes().chain(std::iter::once(0)) {
            h ^= b as u64;
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    }
    h
}

fn floats(bytes: &Option<Vec<u8>>) -> Vec<f32> {
    bytes.as_deref().map_or(vec![], |b| b.chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect())
}

fn write_mesh(mesh: &MeshData, path: &Path) -> Result<(u32, bool, Vec<u32>)> {
    let n = mesh.vertex_count.max(0) as usize;
    let pos = floats(&mesh.vertices);
    anyhow::ensure!(pos.len() >= n * 3, "{} vertices but {} position floats", n, pos.len());
    let nrm = floats(&mesh.normals);
    let uv = floats(&mesh.uvs);
    let has_normals = nrm.len() >= n * 3;
    let mut out = Vec::with_capacity(n * 32);
    let mut put = |v: f32| out.extend_from_slice(&v.to_le_bytes());
    pos[..n * 3].iter().for_each(|&v| put(v));
    (0..n * 3).for_each(|i| put(if has_normals { nrm[i] } else { 0.0 }));
    (0..n * 2).for_each(|i| put(uv.get(i).copied().unwrap_or(0.0)));
    let mut counts = vec![];
    for sm in &mesh.submeshes {
        let idx: Vec<u8> = sm.clone().unwrap_or_default();
        let count = idx.len() / 4;
        // indices are i32 in the library; all valid ones are non-negative, so the bytes are the same as u32
        out.extend_from_slice(&idx[..count * 4]);
        counts.push(count as u32);
    }
    std::fs::write(path, out)?;
    Ok((n as u32, has_normals, counts))
}

fn write_texture(tex: &TextureData, path: &Path) -> Result<()> {
    let data = tex.data.as_deref().context("no data")?;
    let img = if tex.encoding == "png" {
        image::load_from_memory(data)?.to_rgba8()
    } else {
        decode_raw(tex, data)?
    };
    let img = if img.width() > MAX_TEXTURE || img.height() > MAX_TEXTURE {
        let s = MAX_TEXTURE as f32 / img.width().max(img.height()) as f32;
        let (w, h) = (((img.width() as f32 * s) as u32).max(1), ((img.height() as f32 * s) as u32).max(1));
        image::imageops::resize(&img, w, h, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    let file = std::fs::File::create(path)?;
    let enc = image::codecs::png::PngEncoder::new_with_quality(
        std::io::BufWriter::new(file),
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::Adaptive,
    );
    img.write_with_encoder(enc)?;
    Ok(())
}

/// Decodes the largest mip level that fits `MAX_TEXTURE` from Unity raw texture data (rows bottom-up, so the
/// result is flipped to the top-down order PNGs use).
fn decode_raw(tex: &TextureData, data: &[u8]) -> Result<image::RgbaImage> {
    let (mut w, mut h) = (tex.width.max(1) as u32, tex.height.max(1) as u32);
    let level_size = |w: u32, h: u32| -> Option<usize> {
        match tex.format {
            10 => Some((w.div_ceil(4) * h.div_ceil(4) * 8) as usize),  // DXT1
            12 => Some((w.div_ceil(4) * h.div_ceil(4) * 16) as usize), // DXT5
            4 => Some((w * h * 4) as usize),                          // RGBA32
            3 => Some((w * h * 3) as usize),                          // RGB24
            _ => None,
        }
    };
    let mut offset = 0usize;
    if tex.mipmaps {
        while (w > MAX_TEXTURE || h > MAX_TEXTURE) && w > 1 && h > 1 {
            offset += level_size(w, h).context("unsupported format")?;
            w = (w / 2).max(1);
            h = (h / 2).max(1);
        }
    }
    let size = level_size(w, h).with_context(|| format!("unsupported texture format {}", tex.format))?;
    let level = data.get(offset..offset + size).context("texture data too short")?;
    let mut rgba = vec![0u8; (w * h * 4) as usize];
    match tex.format {
        10 | 12 => decode_dxt(level, w, h, tex.format == 12, &mut rgba),
        4 => rgba.copy_from_slice(level),
        3 => {
            for (i, px) in level.chunks_exact(3).enumerate() {
                rgba[i * 4..i * 4 + 4].copy_from_slice(&[px[0], px[1], px[2], 255]);
            }
        }
        _ => unreachable!(),
    }
    let img = image::RgbaImage::from_raw(w, h, rgba).context("image size")?;
    Ok(image::imageops::flip_vertical(&img))
}

fn rgb565(c: u16) -> [u8; 3] {
    let r = ((c >> 11) & 31) as u32;
    let g = ((c >> 5) & 63) as u32;
    let b = (c & 31) as u32;
    [(r * 255 / 31) as u8, (g * 255 / 63) as u8, (b * 255 / 31) as u8]
}

/// BC1 (DXT1) / BC3 (DXT5) block decoder.
fn decode_dxt(src: &[u8], w: u32, h: u32, dxt5: bool, out: &mut [u8]) {
    let block = if dxt5 { 16 } else { 8 };
    let bw = w.div_ceil(4);
    for (bi, b) in src.chunks_exact(block).enumerate() {
        let (bx, by) = ((bi as u32 % bw) * 4, (bi as u32 / bw) * 4);
        let mut alpha = [255u8; 16];
        let color = if dxt5 {
            let (a0, a1) = (b[0] as u32, b[1] as u32);
            let mut table = [a0, a1, 0, 0, 0, 0, 0, 0];
            if a0 > a1 {
                for i in 1..7 {
                    table[i + 1] = ((7 - i as u32) * a0 + i as u32 * a1) / 7;
                }
            } else {
                for i in 1..5 {
                    table[i + 1] = ((5 - i as u32) * a0 + i as u32 * a1) / 5;
                }
                table[6] = 0;
                table[7] = 255;
            }
            let bits = u64::from_le_bytes([b[2], b[3], b[4], b[5], b[6], b[7], 0, 0]);
            for (i, a) in alpha.iter_mut().enumerate() {
                *a = table[((bits >> (3 * i)) & 7) as usize] as u8;
            }
            &b[8..16]
        } else {
            &b[0..8]
        };
        let c0 = u16::from_le_bytes([color[0], color[1]]);
        let c1 = u16::from_le_bytes([color[2], color[3]]);
        let (p0, p1) = (rgb565(c0), rgb565(c1));
        let mut pal = [[0u8; 4]; 4];
        pal[0] = [p0[0], p0[1], p0[2], 255];
        pal[1] = [p1[0], p1[1], p1[2], 255];
        let mix = |a: u8, b: u8, wa: u32, wb: u32, d: u32| ((a as u32 * wa + b as u32 * wb) / d) as u8;
        if c0 > c1 || dxt5 {
            pal[2] = [mix(p0[0], p1[0], 2, 1, 3), mix(p0[1], p1[1], 2, 1, 3), mix(p0[2], p1[2], 2, 1, 3), 255];
            pal[3] = [mix(p0[0], p1[0], 1, 2, 3), mix(p0[1], p1[1], 1, 2, 3), mix(p0[2], p1[2], 1, 2, 3), 255];
        } else {
            pal[2] = [mix(p0[0], p1[0], 1, 1, 2), mix(p0[1], p1[1], 1, 1, 2), mix(p0[2], p1[2], 1, 1, 2), 255];
            pal[3] = [0, 0, 0, 0];
        }
        let idx = u32::from_le_bytes([color[4], color[5], color[6], color[7]]);
        for py in 0..4 {
            for px in 0..4 {
                let (x, y) = (bx + px, by + py);
                if x >= w || y >= h {
                    continue;
                }
                let i = (py * 4 + px) as usize;
                let mut c = pal[((idx >> (2 * i)) & 3) as usize];
                if dxt5 {
                    c[3] = alpha[i];
                }
                let o = ((y * w + x) * 4) as usize;
                out[o..o + 4].copy_from_slice(&c);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dxt1_solid_block() {
        // c0 = pure red (0xF800), c1 = black, all indices 0 → every pixel red
        let block = [0x00, 0xF8, 0x00, 0x00, 0, 0, 0, 0];
        let mut out = vec![0u8; 4 * 4 * 4];
        decode_dxt(&block, 4, 4, false, &mut out);
        assert!(out.chunks_exact(4).all(|p| p == [255, 0, 0, 255]));
    }

    #[test]
    fn mlnz_library_converts() {
        let map = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../Jibbers_Template/MLNZ Park.jbrmap");
        if !map.exists() {
            return;
        }
        let lib = crate::jbrmap::load(&map).unwrap();
        let tmp = std::env::temp_dir().join("studio-assets-test");
        std::fs::create_dir_all(&tmp).unwrap();
        let (key, tex) = lib.texture_library.iter().find(|(_, t)| t.encoding == "raw" && t.format == 12).unwrap();
        write_texture(tex, &tmp.join("t.png")).unwrap_or_else(|e| panic!("{key}: {e:#}"));
        let img = image::open(tmp.join("t.png")).unwrap();
        assert!(img.width() <= MAX_TEXTURE && img.width() > 0);
        let (key, mesh) = lib.mesh_library.iter().next().unwrap();
        let (n, _, subs) = write_mesh(mesh, &tmp.join("m.bin")).unwrap_or_else(|e| panic!("{key}: {e:#}"));
        assert_eq!(n as i32, mesh.vertex_count);
        assert!(!subs.is_empty());
    }
}
