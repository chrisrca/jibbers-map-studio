//! A Unity Mesh ( kept in an asset, or a model's once imported ) as Map-Tools' MeshData packs it: positions,
//! normals, tangents, colours, the four UV sets and each submesh's triangles ( its base vertex added, as
//! Mesh.GetTriangles does ).

use anyhow::{bail, Result};

use crate::jbrmap::MeshData;

use super::value::Value;

/// A vertex channel: its stream, byte offset in a vertex of that stream, format and how many components.
struct Channel {
    stream: usize,
    offset: usize,
    format: i32,
    dim: usize,
}

fn component_size(format: i32) -> usize {
    match format {
        0 | 10 | 11 => 4,
        1 | 4 | 5 | 8 | 9 => 2,
        _ => 1,
    }
}

fn component(format: i32, b: &[u8]) -> f32 {
    match format {
        0 => f32::from_le_bytes([b[0], b[1], b[2], b[3]]),
        1 => half(u16::from_le_bytes([b[0], b[1]])),
        2 => b[0] as f32 / 255.0,
        3 => (b[0] as i8 as f32 / 127.0).max(-1.0),
        4 => u16::from_le_bytes([b[0], b[1]]) as f32 / 65535.0,
        5 => (i16::from_le_bytes([b[0], b[1]]) as f32 / 32767.0).max(-1.0),
        6 => b[0] as f32,
        7 => b[0] as i8 as f32,
        8 => u16::from_le_bytes([b[0], b[1]]) as f32,
        9 => i16::from_le_bytes([b[0], b[1]]) as f32,
        10 => u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f32,
        _ => i32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f32,
    }
}

fn half(h: u16) -> f32 {
    let s = if h & 0x8000 != 0 { -1.0 } else { 1.0 };
    let e = ((h >> 10) & 0x1f) as i32;
    let m = (h & 0x3ff) as f32;
    s * match e {
        0 => m * 2f32.powi(-24),
        31 => f32::INFINITY,
        _ => (1.0 + m / 1024.0) * 2f32.powi(e - 15),
    }
}

/// A Mesh object read as MeshData.
pub fn mesh_data(m: &Value) -> Result<MeshData> {
    if m.get("m_MeshCompression").i32() != 0 && m.at("m_VertexData.m_VertexCount").i32() == 0 {
        bail!("mesh '{}' is compressed ( set its model's Mesh Compression off )", m.get("m_Name").str());
    }
    let vd = m.get("m_VertexData");
    let n = vd.get("m_VertexCount").i32().max(0) as usize;
    // ( a binary file keeps the vertices under m_DataSize, a text one gives their size there and the bytes after )
    let data = match vd.get("m_DataSize") {
        b @ (Value::Bytes(_) | Value::Prims(..)) => b.bytes(),
        _ => vd.get("_typelessdata").bytes(),
    };
    let channels: Vec<Channel> = vd
        .get("m_Channels")
        .list()
        .iter()
        .map(|c| Channel { stream: c.get("stream").i32() as usize, offset: c.get("offset").i32() as usize, format: c.get("format").i32(), dim: (c.get("dimension").i32() & 0xf) as usize })
        .collect();
    // ( the streams one after another, each 16-aligned )
    let streams = channels.iter().map(|c| c.stream + 1).max().unwrap_or(0);
    let mut stream_at = vec![(0usize, 0usize); streams];
    let mut offset = 0;
    for (s, slot) in stream_at.iter_mut().enumerate() {
        let stride: usize = channels.iter().filter(|c| c.stream == s && c.dim > 0).map(|c| c.dim * component_size(c.format)).sum();
        *slot = (offset, stride);
        offset += n * stride;
        offset = (offset + 15) & !15;
    }
    let read = |chn: usize, want: usize| -> Option<Vec<f32>> {
        let c = channels.get(chn).filter(|c| c.dim > 0)?;
        let (base, stride) = stream_at[c.stream];
        let cs = component_size(c.format);
        let mut out = Vec::with_capacity(n * want);
        for v in 0..n {
            let at = base + v * stride + c.offset;
            for k in 0..want {
                out.push(if k < c.dim && at + (k + 1) * cs <= data.len() { component(c.format, &data[at + k * cs..]) } else if k == 3 { 1.0 } else { 0.0 });
            }
        }
        Some(out)
    };
    let pack = |v: Option<Vec<f32>>| v.map(|v| v.iter().flat_map(|f| f.to_le_bytes()).collect::<Vec<u8>>());
    let colors = channels.get(3).filter(|c| c.dim > 0).map(|c| {
        let (base, stride) = stream_at[c.stream];
        let cs = component_size(c.format);
        let mut out = Vec::with_capacity(n * 4);
        for v in 0..n {
            let at = base + v * stride + c.offset;
            for k in 0..4 {
                let inside = k < c.dim && at + (k + 1) * cs <= data.len();
                let f = if inside { component(c.format, &data[at + k * cs..]) } else { 1.0 };
                out.push(if c.format == 2 && inside { data[at + k * cs] } else { (f.clamp(0.0, 1.0) * 255.0 + 0.5) as u8 });
            }
        }
        out
    });
    // indices
    let wide = m.get("m_IndexFormat").i32() == 1;
    let ib = m.get("m_IndexBuffer").bytes();
    let isz = if wide { 4 } else { 2 };
    let index = |i: usize| -> i64 {
        let o = i * isz;
        if o + isz > ib.len() {
            return 0;
        }
        if wide { u32::from_le_bytes([ib[o], ib[o + 1], ib[o + 2], ib[o + 3]]) as i64 } else { u16::from_le_bytes([ib[o], ib[o + 1]]) as i64 }
    };
    let mut submeshes = vec![];
    for sm in m.get("m_SubMeshes").list() {
        let first = sm.get("firstByte").i64() as usize / isz;
        let count = sm.get("indexCount").i64() as usize;
        let base = sm.get("baseVertex").i64();
        let mut tris: Vec<i32> = vec![];
        match sm.get("topology").i32() {
            0 => (first..first + count).for_each(|i| tris.push((index(i) + base) as i32)),
            2 => {
                for q in (first..first + count).step_by(4) {
                    let [a, b, c, d] = [0, 1, 2, 3].map(|k| (index(q + k) + base) as i32);
                    tris.extend([a, b, c, a, c, d]);
                }
            }
            1 => {
                for i in first..first + count.saturating_sub(2) {
                    let [a, b, c] = [0, 1, 2].map(|k| (index(i + k) + base) as i32);
                    if a == b || a == c || b == c {
                        continue;
                    }
                    if (i - first) & 1 == 1 { tris.extend([b, a, c]) } else { tris.extend([a, b, c]) }
                }
            }
            _ => {}
        }
        submeshes.push(Some(tris.iter().flat_map(|t| t.to_le_bytes()).collect()));
    }
    if submeshes.is_empty() {
        submeshes.push(Some(vec![]));
    }
    Ok(MeshData {
        vertex_count: n as i32,
        vertices: pack(read(0, 3)),
        normals: pack(read(1, 3)),
        tangents: pack(read(2, 4)),
        colors,
        uvs: pack(read(4, 2)),
        uv2s: pack(read(5, 2)),
        uv3s: pack(read(6, 2)),
        uv4s: pack(read(7, 2)),
        submeshes,
    })
}
