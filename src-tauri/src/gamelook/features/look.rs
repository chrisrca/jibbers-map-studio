//! The game's look as read into the game-look folder (gamelook/mod.rs): its index, renderers, materials, lights, spins.

use super::*;

#[derive(Deserialize)]
pub(crate) struct LookIndex {
    pub(crate) features: HashMap<String, Vec<LookRenderer>>,
    /// each feature's lights (a floodlight's lamps, a snow cannon's)
    #[serde(default)]
    pub(crate) lights: HashMap<String, Vec<LookLight>>,
}

/// A light in a feature's prefab (gamelook/mod.rs), Unity's numbers.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LookLight {
    /// Unity's: 0 spot, 1 directional, 2 point
    #[serde(rename = "type")]
    pub(crate) kind: i32,
    pub(crate) color: [f32; 4],
    pub(crate) intensity: f32,
    pub(crate) range: f32,
    pub(crate) spot_angle: f32,
    pub(crate) inner_spot_angle: f32,
    /// column-major, in the prefab's frame
    pub(crate) matrix: [f32; 16],
    #[serde(default)]
    pub(crate) variant: Option<LookVariant>,
}

/// A feature's lights as the piece's own (Map-Tools' custom object lights: the game lights them, the view too), placed
/// as its meshes are — at half size — for one of its options.
pub(crate) fn piece_lights(lights: &[LookLight], v: &Option<(String, String)>) -> Vec<crate::jbrmap::Light> {
    lights
        .iter()
        .filter(|l| l.kind != 1)
        .filter(|l| match (&l.variant, v) {
            (None, _) => true,
            (Some(lv), Some((p, o))) => lv.param == *p && lv.option == *o,
            (Some(_), None) => false,
        })
        .map(|l| {
            let m = &l.matrix;
            // its turn: the matrix's columns, each made unit length (the prefab's scale taken out)
            let col = |c: usize| {
                let v = [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
                let n = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt().max(1e-12);
                v.map(|x| x / n)
            };
            let (x, y, z) = (col(0), col(1), col(2));
            // (r[row][col])
            let r = [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
            let q = quat_of(r);
            let e = library::unity_euler_from_quat(q);
            crate::jbrmap::Light {
                light_type: l.kind,
                local_position: Vec3 { x: m[12] * SCALE, y: m[13] * SCALE, z: m[14] * SCALE },
                local_rotation: Vec3 { x: e[0], y: e[1], z: e[2] },
                color: Color { r: l.color[0], g: l.color[1], b: l.color[2], a: 1.0 },
                intensity: l.intensity,
                range: l.range,
                spot_angle: l.spot_angle,
                inner_spot_angle: l.inner_spot_angle,
                shadows: 0,
                shadow_strength: 1.0,
            }
        })
        .collect()
}

/// A turn's quaternion (x, y, z, w) from its matrix.
pub(crate) fn quat_of(r: [[f32; 3]; 3]) -> [f32; 4] {
    let t = r[0][0] + r[1][1] + r[2][2];
    if t > 0.0 {
        let s = (t + 1.0).sqrt() * 2.0;
        [(r[2][1] - r[1][2]) / s, (r[0][2] - r[2][0]) / s, (r[1][0] - r[0][1]) / s, 0.25 * s]
    } else if r[0][0] > r[1][1] && r[0][0] > r[2][2] {
        let s = (1.0 + r[0][0] - r[1][1] - r[2][2]).sqrt() * 2.0;
        [0.25 * s, (r[0][1] + r[1][0]) / s, (r[0][2] + r[2][0]) / s, (r[2][1] - r[1][2]) / s]
    } else if r[1][1] > r[2][2] {
        let s = (1.0 + r[1][1] - r[0][0] - r[2][2]).sqrt() * 2.0;
        [(r[0][1] + r[1][0]) / s, 0.25 * s, (r[1][2] + r[2][1]) / s, (r[0][2] - r[2][0]) / s]
    } else {
        let s = (1.0 + r[2][2] - r[0][0] - r[1][1]).sqrt() * 2.0;
        [(r[0][2] + r[2][0]) / s, (r[1][2] + r[2][1]) / s, 0.25 * s, (r[1][0] - r[0][1]) / s]
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LookRenderer {
    pub(crate) mesh: String,
    pub(crate) vertex_count: usize,
    pub(crate) submeshes: Vec<usize>,
    /// column-major, the renderer in the prefab's frame
    pub(crate) matrix: [f32; 16],
    pub(crate) materials: Vec<LookMaterial>,
    #[serde(default)]
    pub(crate) variant: Option<LookVariant>,
    /// a wheel the game turns as the lift runs (gamelook/mod.rs)
    #[serde(default)]
    pub(crate) spin: Option<LookSpin>,
}

#[derive(Deserialize)]
pub(crate) struct LookSpin {
    pub(crate) pivot: [f32; 3],
    pub(crate) axis: [f32; 3],
    pub(crate) cycles: f32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LookMaterial {
    /// the game's name for it ("RailLong", "Curve Tube Blue")
    #[serde(default)]
    pub(crate) name: String,
    pub(crate) base: Option<String>,
    pub(crate) normal: Option<String>,
    pub(crate) metal: Option<String>,
    pub(crate) rough: Option<String>,
    /// its glow (a floodlight's lamps): the emission map, and the colour it's times
    #[serde(default)]
    pub(crate) emit: Option<String>,
    #[serde(default)]
    pub(crate) emission_color: Option<[f32; 3]>,
    pub(crate) metallic: f32,
    pub(crate) roughness: f32,
    #[serde(default)]
    pub(crate) smoothness: f32,
    pub(crate) brightness: f32,
    pub(crate) hue_shift: f32,
    pub(crate) cutoff: Option<f32>,
    pub(crate) double_sided: bool,
    /// per map ("base", "normal", "metal", "rough"): whether the game reads it as plain values rather than sRGB colour
    #[serde(default)]
    pub(crate) linear: HashMap<String, bool>,
    #[serde(default)]
    pub(crate) shader: String,
}

/// A renderer drawn for one option of a feature's setting only (gamelook/mod.rs).
#[derive(Deserialize, Clone)]
pub(crate) struct LookVariant {
    pub(crate) param: String,
    pub(crate) option: String,
}

/// The wheels the game turns on each piece (a lift station's), by piece id: each its part (`g<k>`, as `dressed`
/// names them), pivot and axis in the piece's frame (Unity space, as its meshes are) and whole turns per 1000 m of
/// cable (signed); nothing before the game's look is read.
pub fn spins() -> Result<serde_json::Value> {
    let Ok(b) = std::fs::read(look_dir()?.join("index.json")) else { return Ok(serde_json::json!({})) };
    let index: LookIndex = serde_json::from_slice(&b)?;
    let mut out = serde_json::Map::new();
    for (id, rs) in &index.features {
        let mut list = vec![];
        for (k, r) in rs.iter().enumerate() {
            let Some(s) = &r.spin else { continue };
            // as `mesh` places the renderer's vertices: its matrix, at half size (a mirroring one turns it back)
            let m = &r.matrix;
            let a = |row: usize, col: usize| m[col * 4 + row];
            let lin = |v: [f32; 3]| [0, 1, 2].map(|i| a(i, 0) * v[0] + a(i, 1) * v[1] + a(i, 2) * v[2]);
            let det = a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) - a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0)) + a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0));
            let p = lin(s.pivot);
            let ax = lin(s.axis);
            let l = (ax[0] * ax[0] + ax[1] * ax[1] + ax[2] * ax[2]).sqrt().max(1e-12);
            let (pivot, axis) = ([0, 1, 2].map(|i| (p[i] + a(i, 3)) * SCALE), ax.map(|c| c / l));
            list.push(serde_json::json!({
                "part": k,
                "pivot": pivot,
                "axis": axis,
                "cycles": if det < 0.0 { -s.cycles } else { s.cycles },
            }));
        }
        if !list.is_empty() {
            out.insert(id.clone(), list.into());
        }
    }
    Ok(out.into())
}
