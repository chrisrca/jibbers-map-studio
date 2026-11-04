//! Moving parts (the studio's `motions` on a piece: Map-Tools 0.5's Moving Parts), baked at export as Map-Tools'
//! MovingPartsBaker does it: each part mesh of a moving piece copied with the motion in its vertices — uv2 the pivot's
//! x and y, uv3 its z and the encoded speed (band × 1e6 + whole cycles per 1000 of drive, negative spinning back),
//! uv4 the axis's yaw and pitch, the colours its amplitude and phase — all in the mesh's own space, vertices that
//! don't move left at zero (the shader leaves them be), and its materials set to move it (CustomObjectLit's
//! _MOVING_PARTS, Auto Speed 1: drive is seconds). Which vertices move with which part is worked out as the view does
//! it (src/pieces/motion.ts): regions in the piece's own space, whole loose parts or single vertices.

use crate::jbrmap::{Chunk, CustomObject, MaterialProp, MeshData, Vec3};
use indexmap::IndexMap;
use serde::Deserialize;
use std::collections::HashMap;

const MAX_SWING: f64 = 180.0;
const MAX_BOB: f64 = 2.5;

#[derive(Deserialize, Clone, Debug)]
pub struct Region {
    pub shape: String,
    pub center: [f64; 3],
    pub size: [f64; 3],
}

#[derive(Deserialize, Clone, Debug)]
pub struct MovingPart {
    pub kind: String,
    pub axis: String,
    #[serde(default)]
    pub region: Option<Region>,
    #[serde(default)]
    pub capture: String,
    #[serde(default)]
    pub exclude: Vec<Region>,
    #[serde(default)]
    pub pivot: String,
    #[serde(default)]
    pub speed: f64,
    #[serde(default)]
    pub reverse: bool,
    #[serde(default)]
    pub angle: f64,
    #[serde(default)]
    pub distance: f64,
    #[serde(default = "four")]
    pub period: f64,
    #[serde(default)]
    pub phase: Option<f64>,
}
fn four() -> f64 {
    4.0
}

type V = [f64; 3];
type Q = [f64; 4];

fn qmul(a: Q, b: Q) -> Q {
    [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}
fn axis_angle(axis: V, deg: f64) -> Q {
    let h = deg.to_radians() / 2.0;
    [axis[0] * h.sin(), axis[1] * h.sin(), axis[2] * h.sin(), h.cos()]
}
/// Unity's Quaternion.Euler (Z, then X, then Y).
fn euler(e: Vec3) -> Q {
    qmul(qmul(axis_angle([0.0, 1.0, 0.0], e.y as f64), axis_angle([1.0, 0.0, 0.0], e.x as f64)), axis_angle([0.0, 0.0, 1.0], e.z as f64))
}
fn rotate(q: Q, v: V) -> V {
    let p = qmul(qmul(q, [v[0], v[1], v[2], 0.0]), [-q[0], -q[1], -q[2], q[3]]);
    [p[0], p[1], p[2]]
}
fn inv(q: Q) -> Q {
    [-q[0], -q[1], -q[2], q[3]]
}
fn v(a: Vec3) -> V {
    [a.x as f64, a.y as f64, a.z as f64]
}
fn axis_of(a: &str) -> V {
    match a {
        "x" => [1.0, 0.0, 0.0],
        "z" => [0.0, 0.0, 1.0],
        _ => [0.0, 1.0, 0.0],
    }
}

/// The piece's moving parts, if it has any.
pub fn parts_of(o: &CustomObject) -> Vec<MovingPart> {
    o.studio.get("motions").and_then(|m| serde_json::from_value(m.clone()).ok()).unwrap_or_default()
}

fn in_region(r: &Region, p: V, axis: V) -> bool {
    let d = [p[0] - r.center[0], p[1] - r.center[1], p[2] - r.center[2]];
    match r.shape.as_str() {
        "box" => d[0].abs() <= r.size[0] / 2.0 && d[1].abs() <= r.size[1] / 2.0 && d[2].abs() <= r.size[2] / 2.0,
        "cylinder" => {
            let along = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
            let off = ((d[0] - axis[0] * along).powi(2) + (d[1] - axis[1] * along).powi(2) + (d[2] - axis[2] * along).powi(2)).sqrt();
            along.abs() <= r.size[1] / 2.0 && off <= r.size[0]
        }
        _ => (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt() <= r.size[0],
    }
}

/// Where in its cycle it starts, as the baker hashes its pivot (FNV over millimetres) or as given; a byte's worth.
fn phase(m: &MovingPart, pivot: V) -> u8 {
    let p = match m.phase {
        Some(p) => p.clamp(0.0, 1.0),
        None => {
            let mut h: u32 = 2166136261;
            for f in pivot {
                h ^= (f * 1000.0).round() as i64 as u32;
                h = h.wrapping_mul(16777619);
            }
            (h & 0xFFFFFF) as f64 / 16777216.0
        }
    };
    (p * 255.0).round() as u8
}

/// The encoded speed: the motion's band (1 spin, 2 swing, 3 bob) and its whole cycles per 1000 of drive.
fn speed(m: &MovingPart) -> f32 {
    let (band, per) = match m.kind.as_str() {
        "swing" => (2.0, m.period.max(1e-6)),
        "bob" => (3.0, m.period.max(1e-6)),
        _ => (1.0, 1.0 / m.speed.max(1e-6)),
    };
    let cycles = (1000.0 / per).round().max(1.0);
    let s = band * 1_000_000.0 + cycles;
    (if m.kind == "spin" && m.reverse { -s } else { s }) as f32
}

fn amplitude(m: &MovingPart) -> u8 {
    let a = match m.kind.as_str() {
        "swing" => m.angle / MAX_SWING,
        "bob" => m.distance / MAX_BOB,
        _ => 0.0,
    };
    (a.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn floats(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect()
}
fn bytes(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

/// A mesh's triangles (every submesh's indices).
fn triangles(md: &MeshData) -> Vec<usize> {
    md.submeshes.iter().flatten().flat_map(|b| b.chunks_exact(4).map(|c| i32::from_le_bytes(c.try_into().unwrap()).max(0) as usize)).collect()
}

/// Which part each vertex of each mesh moves with (-1: none; the first part that takes it), and each part's pivot (the
/// piece's own space; None: it took nothing). `meshes`: each mesh's vertices in the piece's own space and its
/// triangles.
pub fn capture(parts: &[MovingPart], meshes: &[(Vec<V>, Vec<usize>)], origin: V) -> (Vec<Vec<i32>>, Vec<Option<V>>) {
    let mut offsets = Vec::new();
    let mut total = 0;
    for (pts, _) in meshes {
        offsets.push(total);
        total += pts.len();
    }
    // loose parts: joined by triangles, and where vertices sit at the same place (a mesh split along its UV seams)
    let mut up: Vec<usize> = (0..total).collect();
    fn find(up: &mut [usize], mut i: usize) -> usize {
        while up[i] != i {
            up[i] = up[up[i]];
            i = up[i];
        }
        i
    }
    let join = |up: &mut Vec<usize>, a: usize, b: usize| {
        let (x, y) = (find(up, a), find(up, b));
        if x != y {
            up[x] = y;
        }
    };
    let mut at: HashMap<(i64, i64, i64), usize> = HashMap::new();
    for (k, (pts, tris)) in meshes.iter().enumerate() {
        let o = offsets[k];
        for t in tris.chunks_exact(3) {
            if t.iter().all(|&i| i < pts.len()) {
                join(&mut up, o + t[0], o + t[1]);
                join(&mut up, o + t[0], o + t[2]);
            }
        }
        for (i, p) in pts.iter().enumerate() {
            let key = ((p[0] * 1e4).round() as i64, (p[1] * 1e4).round() as i64, (p[2] * 1e4).round() as i64);
            match at.get(&key) {
                Some(&was) => join(&mut up, was, o + i),
                None => {
                    at.insert(key, o + i);
                }
            }
        }
    }
    let id: Vec<usize> = (0..total).map(|i| find(&mut up, i)).collect();
    let all: Vec<V> = meshes.iter().flat_map(|(pts, _)| pts.iter().copied()).collect();
    let mut sums: HashMap<usize, [f64; 4]> = HashMap::new();
    for (i, p) in all.iter().enumerate() {
        let s = sums.entry(id[i]).or_insert([0.0; 4]);
        s[0] += p[0];
        s[1] += p[1];
        s[2] += p[2];
        s[3] += 1.0;
    }
    let mid = |i: usize| -> V {
        let s = sums[&id[i]];
        [s[0] / s[3], s[1] / s[3], s[2] / s[3]]
    };
    let mut part = vec![-1i32; total];
    for (k, m) in parts.iter().enumerate() {
        let axis = axis_of(&m.axis);
        let islands = m.capture != "vertices";
        let mut out = std::collections::HashSet::new();
        if islands {
            for (i, p) in all.iter().enumerate() {
                if m.exclude.iter().any(|r| in_region(r, *p, axis)) {
                    out.insert(id[i]);
                }
            }
        }
        for (i, p) in all.iter().enumerate() {
            if part[i] >= 0 {
                continue;
            }
            let excluded = if islands { out.contains(&id[i]) } else { m.exclude.iter().any(|r| in_region(r, *p, axis)) };
            if excluded {
                continue;
            }
            let probe = if islands { mid(i) } else { *p };
            if m.region.as_ref().is_none_or(|r| in_region(r, probe, axis)) {
                part[i] = k as i32;
            }
        }
    }
    let pivots = parts
        .iter()
        .enumerate()
        .map(|(k, m)| {
            let mut lo = [f64::INFINITY; 3];
            let mut hi = [f64::NEG_INFINITY; 3];
            for (i, p) in all.iter().enumerate() {
                if part[i] == k as i32 {
                    for a in 0..3 {
                        lo[a] = lo[a].min(p[a]);
                        hi[a] = hi[a].max(p[a]);
                    }
                }
            }
            if lo[0] > hi[0] {
                return None;
            }
            let c = [(lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0, (lo[2] + hi[2]) / 2.0];
            Some(match m.pivot.as_str() {
                "top" => [c[0], hi[1], c[2]],
                "bottom" => [c[0], lo[1], c[2]],
                "origin" => origin,
                "region" => m.region.as_ref().map_or(c, |r| r.center),
                _ => c,
            })
        })
        .collect();
    let split = meshes.iter().enumerate().map(|(k, (pts, _))| part[offsets[k]..offsets[k] + pts.len()].to_vec()).collect();
    (split, pivots)
}

/// Every moving piece in the chunks given its moving meshes (added to `meshes`, beside the ones it was made from: other
/// pieces may use those standing still) and materials. How many were.
pub fn bake(chunks: &mut [Chunk], meshes: &mut IndexMap<String, MeshData>) -> usize {
    let mut n = 0;
    for c in chunks {
        for o in &mut c.custom_objects {
            let parts = parts_of(o);
            if !parts.is_empty() && bake_one(o, &parts, meshes) {
                n += 1;
            }
        }
    }
    n
}

fn bake_one(o: &mut CustomObject, parts: &[MovingPart], meshes: &mut IndexMap<String, MeshData>) -> bool {
    // a point of a part's mesh in the piece's own space (parts are placed in the world: the piece's place undone)
    let (oq, os, ot) = (euler(o.rotation), v(o.scale), v(o.position));
    let to_piece = |p: &crate::jbrmap::Part, local: V| -> V {
        let (q, s, t) = (euler(p.local_rotation), v(p.local_scale), v(p.local_position));
        let r = rotate(q, [local[0] * s[0], local[1] * s[1], local[2] * s[2]]);
        let w = [r[0] + t[0] - ot[0], r[1] + t[1] - ot[1], r[2] + t[2] - ot[2]];
        let u = rotate(inv(oq), w);
        [u[0] / os[0], u[1] / os[1], u[2] / os[2]]
    };
    let used: Vec<usize> = (0..o.parts.len()).filter(|&k| meshes.get(&o.parts[k].mesh).is_some_and(|m| m.vertices.is_some())).collect();
    let input: Vec<(Vec<V>, Vec<usize>)> = used
        .iter()
        .map(|&k| {
            let md = &meshes[&o.parts[k].mesh];
            let pts = floats(md.vertices.as_ref().unwrap()).chunks_exact(3).map(|c| to_piece(&o.parts[k], [c[0] as f64, c[1] as f64, c[2] as f64])).collect();
            (pts, triangles(md))
        })
        .collect();
    let (assigned, pivots) = capture(parts, &input, [0.0, 0.0, 0.0]);
    let mut any = false;
    for (j, &k) in used.iter().enumerate() {
        let who = &assigned[j];
        if who.iter().all(|&w| w < 0) {
            continue;
        }
        let p = &o.parts[k];
        let src = meshes[&p.mesh].clone();
        let n = who.len();
        // a piece-space point and direction in the mesh's own space (the part's place and the piece's undone)
        let (pq, ps, pt) = (euler(p.local_rotation), v(p.local_scale), v(p.local_position));
        let to_mesh = |x: V| -> V {
            let r = rotate(oq, [x[0] * os[0], x[1] * os[1], x[2] * os[2]]);
            let w = [r[0] + ot[0] - pt[0], r[1] + ot[1] - pt[1], r[2] + ot[2] - pt[2]];
            let u = rotate(inv(pq), w);
            [u[0] / ps[0], u[1] / ps[1], u[2] / ps[2]]
        };
        let dir_to_mesh = |d: V| -> V {
            let a = rotate(inv(pq), rotate(oq, d));
            let a = [a[0] / ps[0], a[1] / ps[1], a[2] / ps[2]];
            let l = (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt().max(1e-12);
            [a[0] / l, a[1] / l, a[2] / l]
        };
        let mut uv2 = vec![0f32; n * 2];
        let mut uv3 = vec![0f32; n * 2];
        let mut uv4 = vec![0f32; n * 2];
        let mut col = vec![0u8; n * 4];
        for (i, &w) in who.iter().enumerate() {
            col[i * 4 + 3] = 255;
            if w < 0 {
                continue;
            }
            let m = &parts[w as usize];
            let Some(pivot) = pivots[w as usize] else { continue };
            let pv = to_mesh(pivot);
            let a = dir_to_mesh(axis_of(&m.axis));
            uv2[i * 2] = pv[0] as f32;
            uv2[i * 2 + 1] = pv[1] as f32;
            uv3[i * 2] = pv[2] as f32;
            uv3[i * 2 + 1] = speed(m);
            uv4[i * 2] = a[0].atan2(a[2]) as f32;
            uv4[i * 2 + 1] = a[1].clamp(-1.0, 1.0).asin() as f32;
            col[i * 4] = amplitude(m);
            col[i * 4 + 1] = phase(m, pivot);
        }
        let mut md = src;
        md.uv2s = Some(bytes(&uv2));
        md.uv3s = Some(bytes(&uv3));
        md.uv4s = Some(bytes(&uv4));
        md.colors = Some(col);
        // its own key, by what's in it (a piece standing still using the same mesh keeps the plain one)
        let mut h: u64 = 0xcbf29ce484222325;
        for b in [md.uv2s.as_ref().unwrap(), md.uv3s.as_ref().unwrap(), md.uv4s.as_ref().unwrap(), md.colors.as_ref().unwrap()].into_iter().flat_map(|x| x.iter()) {
            h = (h ^ *b as u64).wrapping_mul(0x100000001b3);
        }
        let key = format!("{}#move-{:012x}", p.mesh, h & 0xFFFF_FFFF_FFFF);
        meshes.insert(key.clone(), md);
        let p = &mut o.parts[k];
        p.mesh = key;
        for mat in &mut p.materials {
            if !mat.keywords.iter().any(|k| k == "_MOVING_PARTS") {
                mat.keywords.push("_MOVING_PARTS".into());
            }
            mat.extra_props.insert("_UseMovingParts".into(), MaterialProp::Float(1.0));
            mat.extra_props.insert("_MoveAutoSpeed".into(), MaterialProp::Float(1.0));
        }
        any = true;
    }
    any
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jbrmap::Part;

    /// Two loose quads side by side along X ( a "wheel" at x = 2..4, a "post" at x = -1..1 ), welded nowhere.
    fn two_shells() -> MeshData {
        let p: Vec<f32> = vec![
            -1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, -1.0, 1.0, 0.0, //
            2.0, 0.0, 0.0, 4.0, 0.0, 0.0, 4.0, 2.0, 0.0, 2.0, 2.0, 0.0,
        ];
        let idx: Vec<i32> = vec![0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
        MeshData { vertex_count: 8, vertices: Some(bytes(&p)), submeshes: vec![Some(idx.iter().flat_map(|i| i.to_le_bytes()).collect())], ..MeshData::default() }
    }

    fn piece(motions: serde_json::Value) -> CustomObject {
        let mut o = CustomObject { position: Vec3 { x: 10.0, y: 0.0, z: 0.0 }, scale: Vec3 { x: 1.0, y: 1.0, z: 1.0 }, ..CustomObject::default() };
        o.parts.push(Part { mesh: "m".into(), local_position: Vec3 { x: 10.0, y: 0.0, z: 0.0 }, local_scale: Vec3 { x: 1.0, y: 1.0, z: 1.0 }, materials: vec![crate::jbrmap::Material::default()], ..Part::default() });
        o.studio.insert("motions".into(), motions);
        o
    }

    #[test]
    fn a_region_takes_the_loose_part_in_it_and_leaves_the_rest_still() {
        let mut chunks = vec![Chunk::default()];
        chunks[0].custom_objects.push(piece(serde_json::json!([{ "name": "wheel", "kind": "spin", "axis": "z", "region": { "shape": "sphere", "center": [3.0, 1.0, 0.0], "size": [0.5, 0.0, 0.0] }, "capture": "islands", "exclude": [], "pivot": "center", "speed": 0.5, "reverse": false, "angle": 0, "distance": 0, "period": 4, "phase": null }])));
        let mut meshes = IndexMap::new();
        meshes.insert("m".to_string(), two_shells());
        assert_eq!(bake(&mut chunks, &mut meshes), 1);
        let p = &chunks[0].custom_objects[0].parts[0];
        assert!(p.mesh.starts_with("m#move-"));
        let md = &meshes[&p.mesh];
        let uv3 = floats(md.uv3s.as_ref().unwrap());
        let uv2 = floats(md.uv2s.as_ref().unwrap());
        // the post's four vertices still ( band 0 ), the wheel's spinning half a turn a second about its middle ( 3, 1 )
        for i in 0..4 {
            assert_eq!(uv3[i * 2 + 1], 0.0);
        }
        for i in 4..8 {
            assert_eq!(uv3[i * 2 + 1], 1_000_500.0);
            assert!((uv2[i * 2] - 3.0).abs() < 1e-5 && (uv2[i * 2 + 1] - 1.0).abs() < 1e-5, "{uv2:?}");
        }
        let m = &p.materials[0];
        assert!(m.keywords.contains(&"_MOVING_PARTS".to_string()));
        assert_eq!(m.extra_props.get("_MoveAutoSpeed"), Some(&MaterialProp::Float(1.0)));
    }

    #[test]
    fn vertices_mode_takes_only_the_vertices_inside_and_exclusions_take_them_out() {
        let parts: Vec<MovingPart> = serde_json::from_value(serde_json::json!([{ "name": "a", "kind": "bob", "axis": "y", "region": { "shape": "box", "center": [0.0, 1.0, 0.0], "size": [10.0, 0.5, 1.0] }, "capture": "vertices", "exclude": [{ "shape": "sphere", "center": [4.0, 0.0, 0.0], "size": [3.0, 0.0, 0.0] }], "pivot": "bottom", "distance": 1.25, "period": 4, "phase": 0.5 }])).unwrap();
        let pts: Vec<V> = vec![[-1.0, 1.0, 0.0], [1.0, 1.0, 0.0], [1.0, 0.0, 0.0], [3.0, 1.0, 0.0]];
        let (who, pivots) = capture(&parts, &[(pts, vec![0, 1, 2])], [0.0; 3]);
        // ( the top two of the post moved, its foot not, the vertex near ( 4, 0 ) excluded )
        assert_eq!(who[0], vec![0, 0, -1, -1]);
        assert_eq!(pivots[0], Some([0.0, 1.0, 0.0]));
        assert_eq!(speed(&parts[0]), 3_000_250.0);
        assert_eq!(amplitude(&parts[0]), 128);
    }

    #[test]
    fn pieces_that_dont_move_are_left_alone() {
        let mut chunks = vec![Chunk::default()];
        let mut o = piece(serde_json::json!(null));
        o.studio.clear();
        chunks[0].custom_objects.push(o);
        let mut meshes = IndexMap::new();
        meshes.insert("m".to_string(), two_shells());
        assert_eq!(bake(&mut chunks, &mut meshes), 0);
        assert_eq!(chunks[0].custom_objects[0].parts[0].mesh, "m");
        assert_eq!(meshes.len(), 1);
    }
}
