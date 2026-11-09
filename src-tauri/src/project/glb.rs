//! Pieces written out as a glTF binary (.glb), Blender's File › Export › glTF: every part where it is in the scene
//! ( baked into its points, one mesh each ), Unity's space turned into glTF's ( X mirrored, as the importer mirrors it
//! back: library/userassets/import.rs ), and its materials as glTF's metal-rough ones: colour and its texture, normal
//! map, metal and roughness, glow, cut-out or see-through, both sides.

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result};
use serde_json::{json, Value};

use crate::jbrmap::{CustomObject, Material, MeshData, TextureData};
use crate::unity::math::{Mat4, Quat};

/// The glTF document being built: its JSON arrays and the binary they point into.
#[derive(Default)]
struct Doc {
    bin: Vec<u8>,
    views: Vec<Value>,
    accessors: Vec<Value>,
    meshes: Vec<Value>,
    nodes: Vec<Value>,
    materials: Vec<Value>,
    textures: Vec<Value>,
    images: Vec<Value>,
    /// material and texture already written, by what they are
    mat_of: HashMap<String, usize>,
    tex_of: HashMap<String, usize>,
}

impl Doc {
    /// Bytes as a buffer view ( 4-byte aligned ); its index.
    fn view(&mut self, bytes: &[u8], target: Option<u32>) -> usize {
        while self.bin.len() % 4 != 0 {
            self.bin.push(0);
        }
        let mut v = json!({ "buffer": 0, "byteOffset": self.bin.len(), "byteLength": bytes.len() });
        if let Some(t) = target {
            v["target"] = json!(t);
        }
        self.bin.extend_from_slice(bytes);
        self.views.push(v);
        self.views.len() - 1
    }

    fn floats<const N: usize>(&mut self, data: &[[f32; N]], bounds: bool) -> usize {
        let bytes: Vec<u8> = data.iter().flat_map(|a| a.iter().flat_map(|f| f.to_le_bytes())).collect();
        let view = self.view(&bytes, Some(34962));
        let kind = ["", "SCALAR", "VEC2", "VEC3", "VEC4"][N];
        let mut a = json!({ "bufferView": view, "componentType": 5126, "count": data.len(), "type": kind });
        if bounds {
            let lo: Vec<f32> = (0..N).map(|k| data.iter().map(|v| v[k]).fold(f32::MAX, f32::min)).collect();
            let hi: Vec<f32> = (0..N).map(|k| data.iter().map(|v| v[k]).fold(f32::MIN, f32::max)).collect();
            a["min"] = json!(lo);
            a["max"] = json!(hi);
        }
        self.accessors.push(a);
        self.accessors.len() - 1
    }

    fn indices(&mut self, idx: &[u32]) -> usize {
        let bytes: Vec<u8> = idx.iter().flat_map(|i| i.to_le_bytes()).collect();
        let view = self.view(&bytes, Some(34963));
        self.accessors.push(json!({ "bufferView": view, "componentType": 5125, "count": idx.len(), "type": "SCALAR" }));
        self.accessors.len() - 1
    }

    /// A texture of the library's as a PNG image in the file ( decoded first when it's stored raw ); its index.
    fn texture(&mut self, key: &str, lib: &HashMap<&str, &TextureData>) -> Option<usize> {
        if key.is_empty() {
            return None;
        }
        if let Some(&t) = self.tex_of.get(key) {
            return Some(t);
        }
        let t = lib.get(key)?;
        let data = t.data.as_deref()?;
        let png = if t.encoding == "png" {
            data.to_vec()
        } else {
            let img = super::assets::decode_raw(t, data).ok()?;
            let mut out = vec![];
            img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png).ok()?;
            out
        };
        let view = self.view(&png, None);
        let name = key.rsplit('/').next().unwrap_or(key);
        self.images.push(json!({ "bufferView": view, "mimeType": "image/png", "name": name }));
        self.textures.push(json!({ "source": self.images.len() - 1 }));
        self.tex_of.insert(key.into(), self.textures.len() - 1);
        Some(self.textures.len() - 1)
    }

    /// A piece's material as glTF's; its index.
    fn material(&mut self, m: &Material, lib: &HashMap<&str, &TextureData>) -> usize {
        let key = serde_json::to_string(m).unwrap_or_default();
        if let Some(&i) = self.mat_of.get(&key) {
            return i;
        }
        // ( the game's colours are as painted, sRGB: glTF's factors are linear )
        let lin = |c: f32| if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) };
        let c = m.base_color;
        let mut pbr = json!({
            "baseColorFactor": [lin(c.r), lin(c.g), lin(c.b), c.a],
            "metallicFactor": m.metallic,
            "roughnessFactor": 1.0 - m.smoothness,
        });
        let tiling = |t: usize| {
            let mut v = json!({ "index": t });
            if (m.tiling.x, m.tiling.y, m.offset.x, m.offset.y) != (1.0, 1.0, 0.0, 0.0) {
                v["extensions"] = json!({ "KHR_texture_transform": { "scale": [m.tiling.x, m.tiling.y], "offset": [m.offset.x, m.offset.y] } });
            }
            v
        };
        if let Some(t) = self.texture(&m.base_tex, lib) {
            pbr["baseColorTexture"] = tiling(t);
        }
        let mut v = json!({ "pbrMetallicRoughness": pbr, "doubleSided": m.cull_mode == 0 });
        if !m.name.is_empty() {
            v["name"] = json!(m.name);
        }
        if let Some(t) = self.texture(&m.normal_tex, lib) {
            v["normalTexture"] = tiling(t);
        }
        let e = m.emission_color;
        if e.r + e.g + e.b > 0.0 {
            v["emissiveFactor"] = json!([lin(e.r).min(1.0), lin(e.g).min(1.0), lin(e.b).min(1.0)]);
            if let Some(t) = self.texture(&m.emission_tex, lib) {
                v["emissiveTexture"] = tiling(t);
            }
        }
        match m.render_mode {
            1 => {
                v["alphaMode"] = json!("MASK");
                v["alphaCutoff"] = json!(m.alpha_cutoff);
            }
            2 => v["alphaMode"] = json!("BLEND"),
            _ => {}
        }
        self.materials.push(v);
        self.mat_of.insert(key, self.materials.len() - 1);
        self.materials.len() - 1
    }
}

fn f32s<const N: usize>(b: Option<&Vec<u8>>) -> Vec<[f32; N]> {
    b.map(|b| b.chunks_exact(4 * N).map(|c| std::array::from_fn(|k| f32::from_le_bytes(c[k * 4..k * 4 + 4].try_into().unwrap()))).collect()).unwrap_or_default()
}

/// `objects` ( their meshes and textures in `meshes` and `textures` ) written to `out` as a .glb, `name` its scene's
/// name; how many meshes went in.
pub fn write(objects: &[CustomObject], meshes: &indexmap::IndexMap<String, MeshData>, textures: &indexmap::IndexMap<String, TextureData>, name: &str, out: &Path) -> Result<usize> {
    let tex: HashMap<&str, &TextureData> = textures.iter().map(|(k, v)| (k.as_str(), v)).collect();
    let mut d = Doc::default();
    let mirror = |p: [f32; 3]| [-p[0], p[1], p[2]];
    for o in objects {
        for part in &o.parts {
            // ( the most detailed level only )
            if part.lod_index > 0 {
                continue;
            }
            let Some(mesh) = meshes.get(&part.mesh) else { continue };
            let r = part.local_rotation;
            let m = Mat4::trs([part.local_position.x, part.local_position.y, part.local_position.z], Quat::euler(r.x, r.y, r.z), [part.local_scale.x, part.local_scale.y, part.local_scale.z]);
            let inv = m.inverse();
            let pos: Vec<[f32; 3]> = f32s::<3>(mesh.vertices.as_ref()).into_iter().map(|p| mirror(m.point(p))).collect();
            if pos.is_empty() {
                continue;
            }
            let nrm: Vec<[f32; 3]> = f32s::<3>(mesh.normals.as_ref())
                .into_iter()
                .map(|n| {
                    let v = [0, 1, 2].map(|r| inv.0[r][0] * n[0] + inv.0[r][1] * n[1] + inv.0[r][2] * n[2]);
                    let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt().max(1e-12);
                    mirror(v.map(|x| x / l))
                })
                .collect();
            // ( glTF's texture rows run down, Unity's up )
            let uv: Vec<[f32; 2]> = f32s::<2>(mesh.uvs.as_ref()).into_iter().map(|t| [t[0], 1.0 - t[1]]).collect();
            // ( mirrored once into glTF's space: wound the other way, unless its own scale mirrors it back )
            let (x, y, z) = (m.0[0], m.0[1], m.0[2]);
            let flips = x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0]) >= 0.0;
            let pa = d.floats(&pos, true);
            let na = (nrm.len() == pos.len()).then(|| d.floats(&nrm, false));
            let ua = (uv.len() == pos.len()).then(|| d.floats(&uv, false));
            let mut prims = vec![];
            for (k, sub) in mesh.submeshes.iter().enumerate() {
                let Some(b) = sub else { continue };
                let mut idx: Vec<u32> = b.chunks_exact(4).map(|c| i32::from_le_bytes(c.try_into().unwrap()) as u32).collect();
                if idx.is_empty() {
                    continue;
                }
                if flips {
                    for t in idx.chunks_exact_mut(3) {
                        t.swap(1, 2);
                    }
                }
                let ia = d.indices(&idx);
                let mut attrs = json!({ "POSITION": pa });
                if let Some(n) = na {
                    attrs["NORMAL"] = json!(n);
                }
                if let Some(u) = ua {
                    attrs["TEXCOORD_0"] = json!(u);
                }
                let mat = part.materials.get(k).or(part.materials.last()).cloned().unwrap_or_default();
                let mi = d.material(&mat, &tex);
                prims.push(json!({ "attributes": attrs, "indices": ia, "material": mi }));
            }
            if prims.is_empty() {
                continue;
            }
            let label = part.mesh.rsplit('/').next().unwrap_or(&part.mesh).to_string();
            d.meshes.push(json!({ "name": label, "primitives": prims }));
            d.nodes.push(json!({ "name": label, "mesh": d.meshes.len() - 1 }));
        }
    }
    let n = d.meshes.len();
    anyhow::ensure!(n > 0, "nothing to export: no meshes");
    let mut doc = json!({
        "asset": { "version": "2.0", "generator": "Jibbers Map Studio" },
        "scene": 0,
        "scenes": [{ "name": name, "nodes": (0..d.nodes.len()).collect::<Vec<_>>() }],
        "nodes": d.nodes,
        "meshes": d.meshes,
        "materials": d.materials,
        "accessors": d.accessors,
        "bufferViews": d.views,
        "buffers": [{ "byteLength": d.bin.len() }],
    });
    if !d.textures.is_empty() {
        doc["textures"] = json!(d.textures);
        doc["images"] = json!(d.images);
        doc["samplers"] = json!([{ "wrapS": 10497, "wrapT": 10497 }]);
        for t in doc["textures"].as_array_mut().unwrap() {
            t["sampler"] = json!(0);
        }
    }
    if doc.to_string().contains("KHR_texture_transform") {
        doc["extensionsUsed"] = json!(["KHR_texture_transform"]);
    }
    // the binary: "glTF", version 2, length; the JSON chunk ( padded with spaces ), the BIN chunk ( with zeros )
    let mut js = doc.to_string().into_bytes();
    while js.len() % 4 != 0 {
        js.push(b' ');
    }
    let mut bin = d.bin;
    while bin.len() % 4 != 0 {
        bin.push(0);
    }
    let total = 12 + 8 + js.len() + 8 + bin.len();
    let mut f = Vec::with_capacity(total);
    f.extend_from_slice(b"glTF");
    f.extend_from_slice(&2u32.to_le_bytes());
    f.extend_from_slice(&(total as u32).to_le_bytes());
    f.extend_from_slice(&(js.len() as u32).to_le_bytes());
    f.extend_from_slice(b"JSON");
    f.extend_from_slice(&js);
    f.extend_from_slice(&(bin.len() as u32).to_le_bytes());
    f.extend_from_slice(b"BIN\0");
    f.extend_from_slice(&bin);
    if let Some(p) = out.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(out, f).with_context(|| format!("write {}", out.display()))?;
    Ok(n)
}

/// A project's pieces ( as the editor has them ) written to `out` as a .glb, their meshes and textures from the
/// project's library.
pub fn export(project_dir: &Path, library: &str, objects: &[CustomObject], name: &str, out: &Path) -> Result<usize> {
    let lib = crate::library::userassets::load_project_library(&project_dir.join(library))?;
    write(objects, &lib.mesh_library, &lib.texture_library, name, out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jbrmap::{Color, Part, Vec3};

    /// A piece written out reads back with the gltf crate the importer uses, as many triangles, the same size, its
    /// colour; and imported again it lands where it was ( the two mirrorings undo each other ).
    #[test]
    fn a_piece_goes_out_as_glb_and_comes_back() {
        // a unit cube: 6 faces of 4 corners, each its normal, 2 triangles a face wound to face out ( Unity: clockwise )
        let mut pos = vec![];
        let mut nrm = vec![];
        let mut idx: Vec<i32> = vec![];
        for (n, u, v) in [([1.0f32, 0.0, 0.0], [0.0f32, 1.0, 0.0], [0.0f32, 0.0, 1.0]), ([-1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0]), ([0.0, 1.0, 0.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]), ([0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]), ([0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]), ([0.0, 0.0, -1.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0])] {
            let b = pos.len() as i32;
            for (a, c) in [(-0.5f32, -0.5f32), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)] {
                pos.push([0, 1, 2].map(|k| n[k] * 0.5 + u[k] * a + v[k] * c));
                nrm.push(n);
            }
            idx.extend([b, b + 2, b + 1, b, b + 3, b + 2]);
        }
        let cube = MeshData {
            vertex_count: 24,
            vertices: Some(pos.iter().flat_map(|p| p.iter().flat_map(|f| f.to_le_bytes())).collect()),
            normals: Some(nrm.iter().flat_map(|p| p.iter().flat_map(|f| f.to_le_bytes())).collect()),
            submeshes: vec![Some(idx.iter().flat_map(|i| i.to_le_bytes()).collect())],
            ..MeshData::default()
        };
        let mut meshes = indexmap::IndexMap::new();
        meshes.insert("Cube".to_string(), cube);
        let part = Part { mesh: "Cube".into(), local_position: Vec3 { x: 3.0, y: 1.0, z: -2.0 }, materials: vec![Material { base_color: Color { r: 1.0, g: 0.0, b: 0.0, a: 1.0 }, ..Material::default() }], ..Part::default() };
        let o = CustomObject { parts: vec![part], ..CustomObject::default() };
        let out = std::env::temp_dir().join(format!("jibbers-glb-test-{}.glb", std::process::id()));
        assert_eq!(write(&[o], &meshes, &indexmap::IndexMap::new(), "Test", &out).unwrap(), 1);
        let (doc, buffers, _) = gltf::import(&out).unwrap();
        let prim = doc.meshes().next().unwrap().primitives().next().unwrap();
        let r = prim.reader(|b| Some(&buffers[b.index()]));
        let pos: Vec<[f32; 3]> = r.read_positions().unwrap().collect();
        assert_eq!(pos.len(), 24);
        assert_eq!(r.read_indices().unwrap().into_u32().count(), 36);
        // ( at x = 3 in Unity: −3 in glTF )
        let mx = pos.iter().map(|p| p[0]).sum::<f32>() / pos.len() as f32;
        assert!((mx + 3.0).abs() < 1e-4, "{mx}");
        assert_eq!(prim.material().pbr_metallic_roughness().base_color_factor(), [1.0, 0.0, 0.0, 1.0]);
        // ( back in: where it was, its faces out )
        let back = crate::library::userassets::convert(&out, crate::library::userassets::ImportOpts { recenter: false, ..Default::default() }).unwrap();
        let v: Vec<f32> = back.meshes.values().next().unwrap().vertices.as_ref().unwrap().chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect();
        let cx = v.chunks_exact(3).map(|p| p[0]).sum::<f32>() / (v.len() / 3) as f32;
        assert!((cx - 3.0).abs() < 1e-4, "{cx}");
        std::fs::remove_file(&out).ok();
    }
}
