//! Modelled pieces (src/model) into the map's library at export: each piece's mesh (a submesh per material slot) and
//! its convex colliders' meshes, under `Models/<uid>/…`, replacing the last export's.

use anyhow::{bail, Context, Result};
use crate::jbrmap::{MapData, MeshData, TextureData};
use serde::Deserialize;
use std::path::Path;

/// One mesh's file (relative to the project): u32 vertex count, u32 index count, then f32 positions (x3), normals
/// (x3), uvs (x2) and u32 indices, all little-endian; `submeshes`: how many of the indices each submesh takes.
#[derive(Deserialize, Debug)]
pub struct MeshFile {
    pub key: String,
    pub file: String,
    pub submeshes: Vec<u32>,
}

fn read(bytes: &[u8], submeshes: &[u32]) -> Result<MeshData> {
    if bytes.len() < 8 {
        bail!("model mesh too short");
    }
    let n = u32::from_le_bytes(bytes[0..4].try_into()?) as usize;
    let m = u32::from_le_bytes(bytes[4..8].try_into()?) as usize;
    let (pos, nrm, uv, idx) = (8, 8 + n * 12, 8 + n * 24, 8 + n * 32);
    if bytes.len() != idx + m * 4 {
        bail!("model mesh has {} bytes, expected {}", bytes.len(), idx + m * 4);
    }
    if submeshes.iter().map(|&c| c as usize).sum::<usize>() != m {
        bail!("model mesh's submeshes don't add up to its {m} indices");
    }
    let mut subs = vec![];
    let mut at = idx;
    for &c in submeshes {
        let end = at + c as usize * 4;
        subs.push(Some(bytes[at..end].to_vec()));
        at = end;
    }
    Ok(MeshData {
        vertex_count: n as i32,
        vertices: Some(bytes[pos..nrm].to_vec()),
        normals: Some(bytes[nrm..uv].to_vec()),
        uvs: Some(bytes[uv..idx].to_vec()),
        submeshes: subs,
        ..MeshData::default()
    })
}

/// A painted piece's texture: a PNG (relative to the project).
#[derive(Deserialize, Debug)]
pub struct TextureFile {
    pub key: String,
    pub file: String,
    /// values, not colour (metallic, roughness, normal maps)
    #[serde(default)]
    pub linear: bool,
}

/// Replaces the library's `Models/…` meshes and textures with these; the files are removed afterwards.
pub fn set(project_dir: &Path, meshes: &[MeshFile], textures: &[TextureFile]) -> Result<()> {
    let lib_path = project_dir.join(crate::library::userassets::PROJECT_LIBRARY);
    let mut lib = if lib_path.exists() {
        crate::jbrmap::load(&lib_path).context("the map's library")?
    } else {
        MapData { id: "library".into(), name: "library".into(), ..MapData::default() }
    };
    lib.mesh_library.retain(|k, _| !k.starts_with("Models/"));
    lib.texture_library.retain(|k, _| !k.starts_with("Models/"));
    for m in meshes {
        let bytes = std::fs::read(project_dir.join(&m.file)).with_context(|| format!("read {}", m.file))?;
        lib.mesh_library.insert(m.key.clone(), read(&bytes, &m.submeshes)?);
    }
    for t in textures {
        let png = std::fs::read(project_dir.join(&t.file)).with_context(|| format!("read {}", t.file))?;
        let img = image::load_from_memory(&png).context("painted texture")?;
        lib.texture_library.insert(
            t.key.clone(),
            TextureData { format: 4, width: img.width() as i32, height: img.height() as i32, encoding: "png".into(), linear: t.linear, mipmaps: true, compression: 1, data: Some(png) },
        );
    }
    std::fs::create_dir_all(lib_path.parent().unwrap())?;
    crate::jbrmap::save(&lib, &lib_path)?;
    for f in meshes.iter().map(|m| &m.file).chain(textures.iter().map(|t| &t.file)) {
        std::fs::remove_file(project_dir.join(f)).ok();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_submeshes() {
        let (n, m) = (3u32, 6u32);
        let mut b = vec![];
        b.extend(n.to_le_bytes());
        b.extend(m.to_le_bytes());
        for v in [0f32; 24] {
            b.extend(v.to_le_bytes());
        }
        for i in [0u32, 1, 2, 2, 1, 0] {
            b.extend(i.to_le_bytes());
        }
        let mesh = read(&b, &[3, 3]).unwrap();
        assert_eq!(mesh.submeshes.len(), 2);
        assert_eq!(mesh.submeshes[1].as_ref().unwrap().len(), 12);
        assert!(read(&b, &[3, 2]).is_err());
    }
}
