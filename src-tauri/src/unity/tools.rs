//! What Map-Tools' exporter leaves out, made the studio's own editor data: the terrain editor's curve, circle and copy
//! inserts as shapes, the formation builder's formations ( their settings as they are ), each in world space.

use serde_json::{json, Value as Json};

use super::export::target_value;
use super::scene::Scene;
use super::value::Value;

/// Where a terrain is: its position, size and heightmap resolution.
struct Grid {
    pos: [f32; 3],
    size: [f32; 3],
    res: i32,
}

impl Grid {
    /// A heightmap pixel's place in the world ( x, z ).
    fn at(&self, px: f32, py: f32) -> [f32; 2] {
        let r = (self.res - 1).max(1) as f32;
        [self.pos[0] + px / r * self.size[0], self.pos[2] + py / r * self.size[2]]
    }
    /// Metres per heightmap pixel.
    fn spacing(&self) -> f32 {
        self.size[0] / (self.res - 1).max(1) as f32
    }
}

fn grid_of(s: &Scene, from: usize, terrain_ref: &Value) -> Option<Grid> {
    grid_of_terrain(s, s.follow_scene(from, terrain_ref)?)
}

/// A terrain's grid and its heights ( world metres, rows along +Z ).
fn heights_of(s: &Scene, t: usize) -> Option<(Grid, Vec<f32>)> {
    let g = grid_of_terrain(s, t)?;
    let td = s.follow(t, s.obj(t).value.get("m_TerrainData")).and_then(|x| target_value(s, &x))?;
    let h = td.at("m_Heightmap.m_Heights").numbers(super::value::Prim::I16);
    let hs = h.iter().map(|&v| g.pos[1] + v as f32 / 32766.0 * g.size[1]).collect();
    Some((g, hs))
}

fn grid_of_terrain(s: &Scene, t: usize) -> Option<Grid> {
    let go = s.go_of(t)?;
    let td = s.follow(t, s.obj(t).value.get("m_TerrainData")).and_then(|x| target_value(s, &x))?;
    let hm = td.get("m_Heightmap");
    let res = if hm.get("m_Resolution").is_null() { hm.get("m_Width").i32() } else { hm.get("m_Resolution").i32() };
    let sc = hm.get("m_Scale").xyz();
    Some(Grid { pos: s.world(go).position(), size: [sc[0] * (res - 1) as f32, sc[1], sc[2] * (res - 1) as f32], res })
}

/// An AnimationCurve as the studio's curve: its keys, each with Unity's slopes either side ( `flip`: 1 − v ).
pub fn curve(c: &Value, flip: bool) -> Json {
    let keys = c.get("m_Curve").list();
    let k = |v: f32| if flip { 1.0 - v } else { v };
    let s = |v: f32| {
        let v = if flip { -v } else { v };
        // ( Unity's infinite tangent: a step; kept steep )
        if v.is_finite() { v } else { v.signum() * 1e4 }
    };
    let list: Vec<Json> = keys
        .iter()
        .map(|key| json!({ "t": key.get("time").f32(), "v": k(key.get("value").f32()), "ti": s(key.get("inSlope").f32()), "to": s(key.get("outSlope").f32()) }))
        .collect();
    if list.is_empty() {
        return json!([{ "t": 0.0, "v": k(0.0) }, { "t": 1.0, "v": k(0.0) }]);
    }
    Json::Array(list)
}

// ( one of a few names, by a stored index, the last past the end )
fn pick(names: &[&str], i: i32) -> String {
    names[(i.max(0) as usize).min(names.len() - 1)].to_string()
}

fn uid(prefix: &str, i: usize) -> String {
    format!("{prefix}-unity-{i}")
}

/// A shape's change in the ground, as the studio keeps it ( shapes/<uid>.bin: "JSP1", one patch per chunk — its key,
/// rectangle, the height it added and the height it left ).
fn pack(key: &str, i0: usize, j0: usize, w: usize, h: usize, delta: &[f32], out: &[f32]) -> Vec<u8> {
    let mut b = Vec::with_capacity(32 + key.len() + w * h * 8);
    let u = |b: &mut Vec<u8>, v: u32| b.extend_from_slice(&v.to_le_bytes());
    u(&mut b, 0x3150_534a);
    u(&mut b, 1);
    u(&mut b, key.len() as u32);
    b.extend_from_slice(key.as_bytes());
    for v in [i0, j0, w, h] {
        u(&mut b, v as u32);
    }
    for f in delta.iter().chain(out) {
        b.extend_from_slice(&f.to_le_bytes());
    }
    u(&mut b, 0);
    b
}

/// Whether pixel ( x, y ) is inside an outline of pixels.
fn inside(poly: &[[f32; 2]], x: f32, y: f32) -> bool {
    let mut c = false;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        let (a, b) = (poly[i], poly[j]);
        if (a[1] > y) != (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0] {
            c = !c;
        }
        j = i;
    }
    c
}

/// A formation builder's baseline ( the ground before its formations ) made each formation's change: where its
/// outline is ( the last one's, where they overlap ), the ground now less the baseline.
fn formation_patches(s: &Scene, fb: usize, g: &Grid, uids: &[(String, Vec<[f32; 2]>)]) -> Vec<(String, Vec<u8>)> {
    let v = &s.obj(fb).value;
    let Some(t) = s.follow_scene(fb, v.get("terrain")) else { return vec![] };
    let Some(ci) = super::export::chunk_terrains(s).iter().position(|&x| x == t) else { return vec![] };
    let Some(base) = s.follow(fb, v.get("baseline")).and_then(|x| target_value(s, &x)).and_then(|b| super::texture::floats(&b)) else { return vec![] };
    let res = g.res as usize;
    if base.len() != res * res {
        return vec![];
    }
    let Some(td) = s.follow(t, s.obj(t).value.get("m_TerrainData")).and_then(|x| target_value(s, &x)) else { return vec![] };
    let now = td.at("m_Heightmap.m_Heights").numbers(super::value::Prim::I16);
    if now.len() != res * res {
        return vec![];
    }
    let sy = g.size[1];
    // ( the heights as the import leaves them: R16, as Map-Tools exports them )
    let q = |n: f32| ((n * 65535.0).clamp(0.0, 65535.0) as u16) as f32 * sy / 65535.0;
    let px = |p: [f32; 2]| [(p[0] - g.pos[0]) / g.size[0] * (res - 1) as f32, (p[1] - g.pos[2]) / g.size[2] * (res - 1) as f32];
    let polys: Vec<Vec<[f32; 2]>> = uids.iter().map(|(_, pts)| pts.iter().map(|&p| px(p)).collect()).collect();
    let mut out = vec![];
    for (k, (uid, _)) in uids.iter().enumerate() {
        let poly = &polys[k];
        let (x0, x1) = poly.iter().fold((f32::MAX, f32::MIN), |(a, b), p| (a.min(p[0]), b.max(p[0])));
        let (y0, y1) = poly.iter().fold((f32::MAX, f32::MIN), |(a, b), p| (a.min(p[1]), b.max(p[1])));
        let (i0, i1) = ((x0.floor().max(0.0)) as usize, (x1.ceil() as usize).min(res - 1));
        let (j0, j1) = ((y0.floor().max(0.0)) as usize, (y1.ceil() as usize).min(res - 1));
        if i1 < i0 || j1 < j0 {
            continue;
        }
        let (w, h) = (i1 - i0 + 1, j1 - j0 + 1);
        let (mut delta, mut left) = (vec![0f32; w * h], vec![0f32; w * h]);
        for j in j0..=j1 {
            for i in i0..=i1 {
                let (x, y) = (i as f32, j as f32);
                // ( a later formation's where they overlap )
                if !inside(poly, x, y) || polys[k + 1..].iter().any(|p| inside(p, x, y)) {
                    continue;
                }
                let o = (j - j0) * w + (i - i0);
                let h_now = q((now[j * res + i] / 32766.0) as f32);
                delta[o] = h_now - base[j * res + i] * sy;
                left[o] = h_now;
            }
        }
        out.push((uid.clone(), pack(&format!("chunk_{ci}"), i0, j0, w, h, &delta, &left)));
    }
    out
}

/// The terrain editors' inserts and the formation builders' formations, as the studio's shapes, and the formations'
/// changes in the ground where their builder kept the ground from before them.
pub fn shapes(s: &Scene, notes: &mut Vec<String>) -> (Vec<Json>, Vec<(String, Vec<u8>)>) {
    let mut patches = vec![];
    let mut out = vec![];
    let mut n = 0;
    for ed in s.all(114, "BetterTerrainEditor") {
        let v = &s.obj(ed).value;
        let Some(g) = grid_of(s, ed, v.get("terrain")) else { continue };
        let sp = g.spacing();
        let level = |h: f32| if h < 0.0 { Json::Null } else { json!(g.pos[1] + h) };
        for c in v.get("curveInserts").list() {
            n += 1;
            let ho = c.get("heightOverrides").xyz();
            out.push(json!({
                "uid": uid("curve", n), "kind": "curve", "name": c.get("name").str(),
                "start": g.at(c.get("startX").f32(), c.get("startY").f32()), "end": g.at(c.get("endX").f32(), c.get("endY").f32()),
                "width": c.get("width").f32_or(20.0) * sp,
                "startHeight": level(ho[0]), "endHeight": level(ho[1]),
                "heightMode": "between", "bump": 0,
                // ( Map-Tools runs from the start's height at 1 to the end's at 0 )
                "profile": curve(c.get("curve"), true),
                "repeats": c.get("repeats").i32_or(1), "repeatScaling": c.get("repeatScaling").f32_or(1.0), "repeatFade": c.get("repeatTransitionFade").f32(),
                "cross": curve(c.get("crossSection"), false), "crossDepth": c.get("crossSectionDepth").f32(),
                "sideFlatten": c.get("crossSectionSideFlatten").f32(),
                "tilt": curve(c.get("tiltCurve"), false), "tiltDepth": c.get("tiltDepth").f32(),
                "edgeBlend": c.get("edgeBlend").f32(), "edgeFalloff": c.get("edgeFalloff").f32_or(1.0),
                "edgeMode": pick(&["all", "sides", "ends"], c.get("edgeBlendMode").i32()),
            }));
        }
        for c in v.get("circleInserts").list() {
            n += 1;
            // the tilt plane's normal ( its x and z, at most √0.98 of it ) → how steep and which way it rises
            let nv = c.get("normal").xyz();
            let (mut hx, mut hz) = (nv[0], nv[1]);
            let m2 = hx * hx + hz * hz;
            if m2 > 0.98 {
                let k = (0.98 / m2).sqrt();
                hx *= k;
                hz *= k;
            }
            let ny = (1.0 - hx * hx - hz * hz).max(1e-6).sqrt();
            let (sx, sz) = (hx / ny, hz / ny);
            out.push(json!({
                "uid": uid("circle", n), "kind": "circle", "name": c.get("name").str(),
                "center": g.at(c.get("centerX").f32(), c.get("centerY").f32()),
                "radius": c.get("radius").f32_or(20.0) * sp,
                "height": level(c.get("heightOverride").f32_or(-1.0)),
                "radial": curve(c.get("radialCurve"), false), "depth": c.get("depth").f32_or(10.0),
                "tiltAngle": (sx * sx + sz * sz).sqrt().atan().to_degrees(),
                "tiltDirection": (-sx).atan2(-sz).to_degrees(),
                "edgeBlend": c.get("edgeBlend").f32(), "edgeFalloff": c.get("edgeFalloff").f32_or(1.0),
            }));
        }
        let here = s.follow_scene(ed, v.get("terrain")).and_then(|t| heights_of(s, t));
        // copy inserts: the piece of ground they copy, kept at its heights, placed where it goes
        for c in v.get("copyInserts").list() {
            let Some(src) = s.follow_scene(ed, c.get("sourceTerrain")).and_then(|t| heights_of(s, t)) else { continue };
            let (sg, sh) = &src;
            let sres = sg.res as usize;
            let (sx0, sy0) = (c.get("srcStartX").i32().clamp(0, sg.res - 1) as usize, c.get("srcStartY").i32().clamp(0, sg.res - 1) as usize);
            let (sw, shh) = (c.get("srcSizeX").i32_or(100).clamp(1, sg.res - sx0 as i32) as usize, c.get("srcSizeY").i32_or(100).clamp(1, sg.res - sy0 as i32) as usize);
            let step = g.spacing() / sg.spacing();
            let (dx0, dy0) = (c.get("dstStartX").i32().clamp(0, g.res - 1), c.get("dstStartY").i32().clamp(0, g.res - 1));
            let dw = (((sw - 1) as f32 / step).round() as i32 + 1).min(g.res - dx0) as usize;
            let dh = (((shh - 1) as f32 / step).round() as i32 + 1).min(g.res - dy0) as usize;
            let at = |x: usize, y: usize| sh[(sy0 + y.min(shh - 1)) * sres + sx0 + x.min(sw - 1)];
            let mut heights = Vec::with_capacity(dw * dh);
            for y in 0..dh {
                let fy = (y as f32 * step).min((shh - 1) as f32);
                for x in 0..dw {
                    let fx = (x as f32 * step).min((sw - 1) as f32);
                    let (xi, yi) = (fx.floor() as usize, fy.floor() as usize);
                    let (tx, ty) = (fx - xi as f32, fy - yi as f32);
                    let a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * tx;
                    let b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * tx;
                    heights.push(json!(a + (b - a) * ty));
                }
            }
            n += 1;
            let sp = g.spacing();
            out.push(json!({
                "uid": uid("copy", n), "kind": "stamp", "name": c.get("name").str(),
                "center": g.at(dx0 as f32 + (dw - 1) as f32 / 2.0, dy0 as f32 + (dh - 1) as f32 / 2.0),
                "rotation": 0, "mirrorX": c.get("mirrorX").bool(), "mirrorZ": c.get("mirrorZ").bool(),
                "heightOffset": c.get("heightOffset").f32(),
                "blend": c.get("blendFalloff").f32_or(0.2) * ((dw.min(dh) - 1) as f32 * sp),
                "relative": false,
                "grid": { "w": dw, "h": dh, "spacing": sp, "heights": heights, "origin": 0 },
            }));
            if c.get("copySnowmask").bool() {
                notes.push(format!("copy insert '{}': its copied snow mask kept as it is", c.get("name").str()));
            }
        }
        // mesh inserts: the ground set to the top of the mesh ( as a ray from above meets it ), where it covers
        for c in v.get("meshInserts").list() {
            let Some(mesh) = s.follow(ed, c.get("mesh")).and_then(|t| target_value(s, &t)).and_then(|m| super::mesh::mesh_data(&m).ok()) else { continue };
            let Some((_, hs)) = &here else { continue };
            let (cx, cy) = (c.get("centerX").i32().clamp(0, g.res - 1), c.get("centerY").i32().clamp(0, g.res - 1));
            let cw = g.at(cx as f32, cy as f32);
            let ho = c.get("heightOffset").f32_or(-1.0);
            let base = if ho >= 0.0 { g.pos[1] + ho } else { hs[(cy * g.res + cx) as usize] };
            let r = c.get("rotation").xyz();
            let q = super::math::Quat::euler(r[0], r[1], r[2]);
            let k = c.get("scale").f32_or(1.0);
            let f = |b: &Option<Vec<u8>>| b.as_ref().map(|b| b.chunks_exact(4).map(|q| f32::from_le_bytes(q.try_into().unwrap())).collect::<Vec<f32>>()).unwrap_or_default();
            let vs: Vec<[f32; 3]> = f(&mesh.vertices).chunks_exact(3).map(|p| { let w = q.rotate([p[0] * k, p[1] * k, p[2] * k]); [cw[0] + w[0], base + w[1], cw[1] + w[2]] }).collect();
            if vs.is_empty() {
                continue;
            }
            let sp = g.spacing();
            let (mut x0, mut x1, mut z0, mut z1) = (f32::MAX, f32::MIN, f32::MAX, f32::MIN);
            for p in &vs {
                x0 = x0.min(p[0]);
                x1 = x1.max(p[0]);
                z0 = z0.min(p[2]);
                z1 = z1.max(p[2]);
            }
            let (i0, j0) = (((x0 - g.pos[0]) / sp).floor() as i64, ((z0 - g.pos[2]) / sp).floor() as i64);
            let (i1, j1) = (((x1 - g.pos[0]) / sp).ceil() as i64, ((z1 - g.pos[2]) / sp).ceil() as i64);
            // ( two samples across at least: the stamp is looked up between them )
            let (i1, j1) = (i1.max(i0 + 1), j1.max(j0 + 1));
            let (w, h) = ((i1 - i0 + 1) as usize, (j1 - j0 + 1) as usize);
            let mut top = vec![f32::MIN; w * h];
            for sub in &mesh.submeshes {
                let idx: Vec<usize> = sub.as_ref().map(|b| b.chunks_exact(4).map(|q| i32::from_le_bytes(q.try_into().unwrap()) as usize).collect()).unwrap_or_default();
                for t in idx.chunks_exact(3) {
                    let (Some(a), Some(b), Some(cc)) = (vs.get(t[0]), vs.get(t[1]), vs.get(t[2])) else { continue };
                    let lo = |v: f32, o: f32| ((v - o) / sp).floor() as i64;
                    let hi = |v: f32, o: f32| ((v - o) / sp).ceil() as i64;
                    let d = (b[0] - a[0]) * (cc[2] - a[2]) - (cc[0] - a[0]) * (b[2] - a[2]);
                    if d.abs() < 1e-12 {
                        continue;
                    }
                    for j in lo(a[2].min(b[2]).min(cc[2]), g.pos[2]).max(j0)..=hi(a[2].max(b[2]).max(cc[2]), g.pos[2]).min(j1) {
                        for i in lo(a[0].min(b[0]).min(cc[0]), g.pos[0]).max(i0)..=hi(a[0].max(b[0]).max(cc[0]), g.pos[0]).min(i1) {
                            let (x, z) = (g.pos[0] + i as f32 * sp, g.pos[2] + j as f32 * sp);
                            let u = ((b[0] - x) * (cc[2] - z) - (cc[0] - x) * (b[2] - z)) / d;
                            let vv = ((cc[0] - x) * (a[2] - z) - (a[0] - x) * (cc[2] - z)) / d;
                            let ww = 1.0 - u - vv;
                            if u < -1e-5 || vv < -1e-5 || ww < -1e-5 {
                                continue;
                            }
                            let y = a[1] * u + b[1] * vv + cc[1] * ww;
                            let o = (j - j0) as usize * w + (i - i0) as usize;
                            top[o] = top[o].max(y);
                        }
                    }
                }
            }
            n += 1;
            out.push(json!({
                "uid": uid("mesh", n), "kind": "stamp", "name": c.get("name").str(),
                "center": [g.pos[0] + (i0 as f32 + (w - 1) as f32 / 2.0) * sp, g.pos[2] + (j0 as f32 + (h - 1) as f32 / 2.0) * sp],
                "rotation": 0, "mirrorX": false, "mirrorZ": false, "heightOffset": 0,
                "blend": c.get("blendFalloff").f32_or(0.1) * ((w.min(h) - 1) as f32 * sp),
                "relative": false,
                "grid": { "w": w, "h": h, "spacing": sp, "heights": top.iter().map(|&t| if t == f32::MIN { Json::Null } else { json!(t) }).collect::<Vec<_>>(), "origin": 0 },
            }));
        }
        // paint inserts: strokes painted into the snow mask
        for c in v.get("paintInserts").list() {
            n += 1;
            out.push(json!({
                "uid": uid("paint", n), "kind": "paint", "name": c.get("name").str(),
                "start": g.at(c.get("startX").f32(), c.get("startY").f32()), "end": g.at(c.get("endX").f32(), c.get("endY").f32()),
                "width": c.get("width").f32_or(20.0) * g.spacing(),
                "along": curve(c.get("lengthCurve"), false), "repeats": c.get("repeats").i32_or(1), "repeatScaling": c.get("repeatScaling").f32_or(1.0),
                "cross": curve(c.get("crossSectionCurve"), false),
                "target": pick(&["snow", "marking", "powder"], c.get("target").i32_or(1)),
                "colour": c.get("markingColorIdx").i32().clamp(0, 15), "depth": c.get("powderDepth").f32_or(1.0),
                "erase": c.get("erase").bool(), "coverage": c.get("coverage").f32_or(1.0),
            }));
        }
    }
    for fb in s.all(114, "FormationBuilder") {
        let v = &s.obj(fb).value;
        let Some(g) = grid_of(s, fb, v.get("terrain")) else { continue };
        let mut mine: Vec<(String, Vec<[f32; 2]>)> = vec![];
        for (i, f) in v.get("formations").list().iter().enumerate() {
            let area: Vec<[f32; 2]> = f.get("area").list().iter().map(|p| { let q = p.xyz(); [g.pos[0] + q[0], g.pos[2] + q[1]] }).collect();
            if area.len() < 3 {
                continue;
            }
            n += 1;
            if f.get("enabled").bool_or(true) {
                mine.push((uid("formation", n), area.clone()));
            }
            out.push(json!({
                "uid": uid("formation", n), "kind": "formation", "name": f.get("name").str(), "points": area,
                "enabled": f.get("enabled").bool_or(true), "fitted": f.get("fitted").bool(),
                "mode": pick(&["add", "raise", "carve", "set"], f.get("blendMode").i32()),
                "style": pick(&["smooth", "ridged", "billow"], f.get("noiseType").i32()),
                "height": f.get("height").f32_or(55.0), "baseY": f.get("baseHeight").f32(),
                "peakWidth": f.get("domeReach").f32_or(100.0), "edgeBlend": f.get("edgeFalloff").f32_or(14.0),
                "profile": curve(f.get("domeProfile"), false),
                "featureSize": f.get("noiseScale").f32_or(60.0), "roughness": f.get("noiseHeight").f32_or(12.0), "detail": f.get("octaves").i32_or(4),
                "lacunarity": f.get("lacunarity").f32_or(2.0), "gain": f.get("gain").f32_or(0.5), "warp": f.get("warp").f32_or(0.25),
                "seed": f.get("seed").i32(), "onPeak": f.get("noiseFollowsDome").f32_or(0.4),
                "smooth": f.get("smooth").f32_or(0.2), "smoothSteps": f.get("smoothIterations").i32_or(2),
                "thermal": { "on": f.get("thermalEnabled").bool(), "amount": f.get("thermalStrength").f32_or(0.5), "iterations": f.get("thermalIterations").i32_or(50), "repose": f.get("thermalRepose").f32_or(36.0) },
                "hydraulic": {
                    "on": f.get("hydraulicEnabled").bool(), "droplets": f.get("rain").f32_or(0.5), "lifetime": f.get("hydraulicIterations").i32_or(250),
                    "inertia": f.get("dropletInertia").f32_or(0.05), "capacity": f.get("sedimentCapacity").f32_or(4.0), "erode": f.get("erosionRate").f32_or(0.3),
                    "deposit": f.get("depositionRate").f32_or(0.3), "evaporate": f.get("evaporation").f32_or(0.01), "radius": f.get("erosionRadius").i32_or(3),
                },
                "snow": {
                    "on": f.get("snowEnabled").bool(), "rockFrom": f.get("snowSlopeStart").f32_or(30.0), "rockFull": f.get("snowSlopeFull").f32_or(54.0),
                    "rock": f.get("rockStrength").f32_or(1.0), "crevices": f.get("snowCrevice").f32_or(0.5),
                    "lineLow": f.get("snowLineLow").f32_or(-1.0), "lineHigh": f.get("snowLineHigh").f32_or(-1.0),
                    "depth": f.get("snowAmount").f32_or(1.2), "addsHeight": f.get("snowAddsHeight").f32_or(0.4), "soften": f.get("snowSettleIterations").i32_or(2),
                },
                // ( its noise read from the terrain's corner, as Map-Tools reads it )
                "noiseOffset": [g.pos[0], g.pos[2]],
                "v": 2,
            }));
            let _ = i;
        }
        let made = formation_patches(s, fb, &g, &mine);
        if made.is_empty() && !mine.is_empty() {
            notes.push("formations without their builder's baseline: an edit to one builds on the ground as it is".into());
        }
        patches.extend(made);
    }
    (out, patches)
}

// ---- ski lines

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn dist(a: [f32; 3], b: [f32; 3]) -> f32 {
    let d = sub(a, b);
    (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt()
}

/// SkiLineSpline.GetPoint: the centripetal Catmull-Rom through the nodes, segment `seg` at `u`.
pub(crate) fn spline(p: &[[f32; 3]], seg: usize, u: f32) -> [f32; 3] {
    let (p1, p2) = (p[seg], p[seg + 1]);
    let refl = |a: [f32; 3], b: [f32; 3]| [a[0] * 2.0 - b[0], a[1] * 2.0 - b[1], a[2] * 2.0 - b[2]];
    let p0 = if seg > 0 { p[seg - 1] } else { refl(p1, p2) };
    let p3 = if seg + 2 < p.len() { p[seg + 2] } else { refl(p2, p1) };
    let knot = |a, b| dist(a, b).sqrt().max(1e-4);
    let (t0, t1) = (0.0, knot(p0, p1));
    let t2 = t1 + knot(p1, p2);
    let t3 = t2 + knot(p2, p3);
    let t = t1 + (t2 - t1) * u;
    let remap = |a: [f32; 3], b: [f32; 3], ta: f32, tb: f32| if tb - ta > 1e-6 { let k = (t - ta) / (tb - ta); [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k] } else { a };
    let a1 = remap(p0, p1, t0, t1);
    let a2 = remap(p1, p2, t1, t2);
    let a3 = remap(p2, p3, t2, t3);
    let b1 = remap(a1, a2, t0, t2);
    let b2 = remap(a2, a3, t1, t3);
    remap(b1, b2, t1, t2)
}

/// The ski line builders' lines as the studio's ski lines ( Map-Tools' Ski Line Builder, ported:
/// terrain/shapes/shapes/skiline.ts ), every setting as Map-Tools has it, the points in world space.
pub fn ski_lines(s: &Scene, notes: &mut Vec<String>) -> Vec<Json> {
    let mut out = vec![];
    for b in s.all(114, "SkiLineBuilder") {
        let v = &s.obj(b).value;
        let Some(g) = grid_of(s, b, v.get("terrain")) else { continue };
        for line in v.get("lines").list() {
            let nodes: Vec<Json> = line
                .get("nodes")
                .list()
                .iter()
                .map(|n| {
                    let p = n.get("position").xyz();
                    let w = n.get("widthOverride").f32_or(-1.0);
                    json!({ "p": [g.pos[0] + p[0], g.pos[1] + p[1], g.pos[2] + p[2]], "width": if w > 0.0 { json!(w) } else { Json::Null }, "roll": n.get("roll").f32() })
                })
                .collect();
            let features: Vec<Json> = line
                .get("features")
                .list()
                .iter()
                .map(|f| {
                    let stripes: Vec<Json> = f
                        .get("paintStripes")
                        .list()
                        .iter()
                        .map(|st| json!({
                            "across": st.get("acrossLine").bool(), "position": st.get("position").f32_or(0.5), "width": st.get("stripeWidth").f32_or(0.6),
                            "softness": st.get("softness").f32_or(0.4), "opacity": st.get("opacity").f32_or(0.7), "inset": st.get("inset").f32(), "colour": st.get("colorIdx").i32_or(11),
                        }))
                        .collect();
                    json!({
                        "name": f.get("name").str(), "enabled": f.get("enabled").bool_or(true), "start": f.get("start").f32_or(20.0), "length": f.get("length").f32_or(12.0),
                        "height": f.get("height").f32_or(3.0), "lateral": f.get("lateralOffset").f32(), "width": f.get("width").f32(), "sideBlend": f.get("sideBlend").f32_or(0.5),
                        "profile": curve(f.get("profile"), false), "stripes": stripes,
                    })
                })
                .collect();
            out.push(json!({
                "uid": uid("skiline", out.len() + 1), "kind": "skiline", "name": line.get("name").str(), "enabled": line.get("enabled").bool_or(true),
                "width": line.get("width").f32_or(14.0), "cross": curve(line.get("crossSection"), false), "crossDepth": line.get("crossSectionDepth").f32(),
                "sideFlatten": line.get("sideFlatten").f32_or(0.15), "autoBank": line.get("autoBank").f32(), "edgeBlend": line.get("edgeBlend").f32_or(0.25),
                "edgeFalloff": line.get("edgeFalloff").f32_or(1.0), "endBlend": line.get("endBlend").f32_or(10.0), "detail": line.get("bakeResolution").i32_or(1024),
                "nodes": nodes, "features": features,
            }));
        }
    }
    if !out.is_empty() {
        notes.push(format!("{} ski line(s) brought over as the studio's ski lines", out.len()));
    }
    out
}
