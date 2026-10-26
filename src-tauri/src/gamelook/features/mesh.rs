//! A renderer's mesh out of the game-look folder, as a piece's mesh (Unity space, the prefab at half size).

use super::*;

pub(crate) fn floats(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect()
}

pub(crate) fn bytes(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

/// A renderer's mesh in the piece's frame: its prefab matrix and the half size baked in.
pub(crate) fn mesh(look: &Path, r: &LookRenderer) -> Result<MeshData> {
    let n = r.vertex_count;
    let b = std::fs::read(look.join(&r.mesh)).with_context(|| r.mesh.clone())?;
    let pos = floats(&b[..n * 12]);
    let nrm = floats(&b[n * 12..n * 24]);
    let uv = floats(&b[n * 24..n * 32]);
    let idx: Vec<u32> = b[n * 32..].chunks_exact(4).map(|c| u32::from_le_bytes(c.try_into().unwrap())).collect();
    let tan = std::fs::read(look.join(r.mesh.replace(".bin", ".tan"))).ok().map(|t| floats(&t)).filter(|t| t.len() == n * 4);
    let m = &r.matrix;
    // m[col * 4 + row]
    let a = |row: usize, col: usize| m[col * 4 + row];
    let lin = [[a(0, 0), a(0, 1), a(0, 2)], [a(1, 0), a(1, 1), a(1, 2)], [a(2, 0), a(2, 1), a(2, 2)]];
    let det = lin[0][0] * (lin[1][1] * lin[2][2] - lin[1][2] * lin[2][1]) - lin[0][1] * (lin[1][0] * lin[2][2] - lin[1][2] * lin[2][0]) + lin[0][2] * (lin[1][0] * lin[2][1] - lin[1][1] * lin[2][0]);
    // normals go by the inverse transpose (cofactors / det)
    let cof = [
        [lin[1][1] * lin[2][2] - lin[1][2] * lin[2][1], lin[1][2] * lin[2][0] - lin[1][0] * lin[2][2], lin[1][0] * lin[2][1] - lin[1][1] * lin[2][0]],
        [lin[0][2] * lin[2][1] - lin[0][1] * lin[2][2], lin[0][0] * lin[2][2] - lin[0][2] * lin[2][0], lin[0][1] * lin[2][0] - lin[0][0] * lin[2][1]],
        [lin[0][1] * lin[1][2] - lin[0][2] * lin[1][1], lin[0][2] * lin[1][0] - lin[0][0] * lin[1][2], lin[0][0] * lin[1][1] - lin[0][1] * lin[1][0]],
    ];
    let mul = |mm: &[[f32; 3]; 3], v: [f32; 3]| [0, 1, 2].map(|i| mm[i][0] * v[0] + mm[i][1] * v[1] + mm[i][2] * v[2]);
    let unit = |v: [f32; 3]| {
        let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt().max(1e-12);
        v.map(|c| c / l)
    };
    let sign = if det < 0.0 { -1.0 } else { 1.0 };
    let mut p2 = Vec::with_capacity(n * 3);
    let mut n2 = Vec::with_capacity(n * 3);
    let mut t2 = Vec::with_capacity(n * 4);
    for i in 0..n {
        let v = mul(&lin, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]);
        p2.extend([(v[0] + a(0, 3)) * SCALE, (v[1] + a(1, 3)) * SCALE, (v[2] + a(2, 3)) * SCALE]);
        n2.extend(unit(mul(&cof, [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]]).map(|c| c * sign)));
        if let Some(t) = &tan {
            let d = unit(mul(&lin, [t[i * 4], t[i * 4 + 1], t[i * 4 + 2]]));
            t2.extend([d[0], d[1], d[2], t[i * 4 + 3] * sign]);
        }
    }
    let mut start = 0;
    let mut subs = vec![];
    for &count in &r.submeshes {
        let mut s: Vec<u32> = idx[start..(start + count).min(idx.len())].to_vec();
        start += count;
        // mirrored: faces turned round, as Unity does it
        if det < 0.0 {
            for tri in s.chunks_exact_mut(3) {
                tri.swap(1, 2);
            }
        }
        subs.push(Some(s.iter().flat_map(|i| (*i as i32).to_le_bytes()).collect()));
    }
    Ok(MeshData {
        vertex_count: n as i32,
        vertices: Some(bytes(&p2)),
        normals: Some(bytes(&n2)),
        tangents: (!t2.is_empty()).then(|| bytes(&t2)),
        uvs: Some(bytes(&uv)),
        submeshes: subs,
        ..MeshData::default()
    })
}
