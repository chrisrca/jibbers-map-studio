//! A Unity project with everything Map-Tools makes in one scene, for the import's tests ( and the studio's self-test,
//! `unityfull`, which opens it ): four terrains of real-looking ground with snow masks, every terrain editor insert
//! worked into the heights as Map-Tools leaves them, formations over their builder's baseline, a ski line carved in
//! with its features, the game's features ( one a prefab instance, one a lift ), spawns, custom pieces with their
//! colliders, LODs and a light, and trees of both kinds. `expect.json` beside it says what should come in, and the
//! ground the inserts and the ski line were worked into ( to tell their ground came back when they're moved ).

use std::path::Path;

use serde_json::{json, Value as Json};

// ( the terrains: 129 samples a side, 2 m apart, 200 m high )
pub const RES: usize = 129;
pub const SP: f32 = 2.0;
pub const TOP: f32 = 200.0;
const SIZE: f32 = (RES - 1) as f32 * SP;

/// The ground before anything was worked into it ( world metres ).
pub fn base(x: f32, z: f32) -> f32 {
    40.0 + 12.0 * (x / 80.0).sin() * (z / 60.0).cos() + 0.05 * x
}

const SCRIPTS: [&str; 8] = ["MapExporter", "BetterTerrainEditor", "FormationBuilder", "SkiLineBuilder", "MapObject", "CustomMapObject", "MapSpawnPoint", "LiftSetup"];

fn guid(i: usize) -> String {
    format!("{i:032x}")
}

fn meta(path: &Path, g: &str) {
    std::fs::write(format!("{}.meta", path.display()), format!("fileFormatVersion: 2\nguid: {g}\n")).unwrap();
}

fn curve(name: &str, ind: &str, keys: &[(f32, f32)]) -> String {
    let mut s = format!("{ind}{name}:\n{ind}  serializedVersion: 2\n{ind}  m_Curve:\n");
    for &(t, v) in keys {
        s += &format!("{ind}  - serializedVersion: 3\n{ind}    time: {t}\n{ind}    value: {v}\n{ind}    inSlope: 0\n{ind}    outSlope: 0\n");
    }
    s
}

fn hex(bytes: impl IntoIterator<Item = u8>) -> String {
    bytes.into_iter().map(|b| format!("{b:02x}")).collect()
}

const HEAD: &str = "%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n";

/// A scene's objects as they're written: GameObjects with their transforms ( a tree of them ) and components.
#[derive(Default)]
struct Yaml {
    out: String,
    next: i64,
}

impl Yaml {
    fn id(&mut self) -> i64 {
        self.next += 1;
        self.next
    }
    /// A GameObject at `p` ( local ), under `parent`'s transform, with its components written after: ( go, transform ).
    fn go(&mut self, name: &str, parent: i64, p: [f32; 3], scale: f32, comps: &[(i64, String)], children: &[i64], active: bool) -> (i64, i64) {
        let (g, t) = (self.id(), self.id());
        self.go_as(g, t, name, parent, p, scale, comps, children, active);
        (g, t)
    }
    #[allow(clippy::too_many_arguments)]
    fn go_as(&mut self, g: i64, t: i64, name: &str, parent: i64, p: [f32; 3], scale: f32, comps: &[(i64, String)], children: &[i64], active: bool) {
        let list: String = std::iter::once(t).chain(comps.iter().map(|c| c.0)).map(|c| format!("  - component: {{fileID: {c}}}\n")).collect();
        self.out += &format!("--- !u!1 &{g}\nGameObject:\n  m_Name: {name}\n  m_IsActive: {}\n  m_TagString: Untagged\n  m_Component:\n{list}", active as i32);
        let kids: String = children.iter().map(|c| format!("\n  - {{fileID: {c}}}")).collect();
        self.out += &format!(
            "--- !u!4 &{t}\nTransform:\n  m_GameObject: {{fileID: {g}}}\n  m_LocalRotation: {{x: 0, y: 0, z: 0, w: 1}}\n  m_LocalPosition: {{x: {}, y: {}, z: {}}}\n  m_LocalScale: {{x: {scale}, y: {scale}, z: {scale}}}\n  m_Children:{}\n  m_Father: {{fileID: {parent}}}\n",
            p[0], p[1], p[2], if kids.is_empty() { " []".into() } else { kids }
        );
        for (id, body) in comps {
            self.out += &body.replace("{GO}", &g.to_string()).replace("{ID}", &id.to_string());
        }
    }
}

/// A MonoBehaviour of script `k` ( SCRIPTS ) on {GO}.
fn mb(k: usize, body: &str) -> String {
    format!("--- !u!114 &{{ID}}\nMonoBehaviour:\n  m_GameObject: {{fileID: {{GO}}}}\n  m_Enabled: 1\n  m_Script: {{fileID: 11500000, guid: {}, type: 3}}\n{body}", guid(k + 1))
}

fn mesh_filter(mesh: &str) -> String {
    format!("--- !u!33 &{{ID}}\nMeshFilter:\n  m_GameObject: {{fileID: {{GO}}}}\n  m_Mesh: {{fileID: 4300000, guid: {mesh}, type: 2}}\n")
}

fn renderer(mat: &str) -> String {
    format!("--- !u!23 &{{ID}}\nMeshRenderer:\n  m_GameObject: {{fileID: {{GO}}}}\n  m_Enabled: 1\n  m_CastShadows: 1\n  m_Materials:\n  - {{fileID: 2100000, guid: {mat}, type: 2}}\n")
}

/// A text Mesh asset: `verts` and triangles ( one submesh ).
fn mesh_asset(path: &Path, g: &str, verts: &[[f32; 3]], tris: &[u16]) {
    let vb = hex(verts.iter().flatten().flat_map(|f| f.to_le_bytes()));
    let ib = hex(tris.iter().flat_map(|i| i.to_le_bytes()));
    std::fs::write(
        path,
        format!(
            "{HEAD}--- !u!43 &4300000\nMesh:\n  m_Name: {}\n  m_SubMeshes:\n  - firstByte: 0\n    indexCount: {}\n    topology: 0\n    baseVertex: 0\n  m_IndexFormat: 0\n  m_IndexBuffer: {ib}\n  m_VertexData:\n    m_VertexCount: {}\n    m_Channels:\n    - stream: 0\n      offset: 0\n      format: 0\n      dimension: 3\n    m_DataSize: {}\n    _typelessdata: {vb}\n",
            path.file_stem().unwrap().to_string_lossy(),
            tris.len(),
            verts.len(),
            verts.len() * 12
        ),
    )
    .unwrap();
    meta(path, g);
}

/// A box's corners and faces ( `h` half a side ), standing on y = 0.
fn cube(h: f32) -> (Vec<[f32; 3]>, Vec<u16>) {
    let v: Vec<[f32; 3]> = (0..8).map(|k| [if k & 1 == 1 { h } else { -h }, if k & 2 == 2 { 2.0 * h } else { 0.0 }, if k & 4 == 4 { h } else { -h }]).collect();
    let f = [0u16, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5];
    (v, f.to_vec())
}

/// An RGBA picture as a text Texture2D ( RGBA32 ), `f( i, j )` its pixels.
fn rgba_asset(path: &Path, g: &str, n: usize, f: impl Fn(usize, usize) -> [u8; 4]) {
    let px = hex((0..n * n).flat_map(|k| f(k % n, k / n)));
    std::fs::write(path, format!("{HEAD}--- !u!28 &2800000\nTexture2D:\n  m_Name: {}\n  m_Width: {n}\n  m_Height: {n}\n  m_TextureFormat: 4\n  m_MipCount: 1\n  m_ColorSpace: 0\n  image data: {}\n  _typelessdata: {px}\n", path.file_stem().unwrap().to_string_lossy(), n * n * 4)).unwrap();
    meta(path, g);
}

fn material(path: &Path, g: &str, colour: [f32; 4], tex: Option<&str>, extra: &str) {
    let env = tex.map(|t| format!("    - _BaseMap:\n        m_Texture: {{fileID: 2800000, guid: {t}, type: 3}}\n        m_Scale: {{x: 1, y: 1}}\n        m_Offset: {{x: 0, y: 0}}\n")).unwrap_or_default();
    std::fs::write(
        path,
        format!(
            "{HEAD}--- !u!21 &2100000\nMaterial:\n  m_Name: {}\n  m_SavedProperties:\n    m_TexEnvs:\n{env}    m_Floats:\n    - _Smoothness: 0.3\n    - _Metallic: 0\n{extra}    m_Colors:\n    - _BaseColor: {{r: {}, g: {}, b: {}, a: {}}}\n",
            path.file_stem().unwrap().to_string_lossy(),
            colour[0],
            colour[1],
            colour[2],
            colour[3]
        ),
    )
    .unwrap();
    meta(path, g);
}

/// Where a heightmap pixel of terrain `t` ( its corner ) is in the world.
fn at(t: [f32; 3], px: f32, py: f32) -> [f32; 2] {
    [t[0] + px * SP, t[2] + py * SP]
}

fn smooth(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

/// The project at `root`: Assets/Full.unity and what it uses, and expect.json.
pub fn full(root: &Path) -> Json {
    let _ = std::fs::remove_dir_all(root);
    let assets = root.join("Assets");
    std::fs::create_dir_all(assets.join("Scripts")).unwrap();
    for (i, n) in SCRIPTS.iter().enumerate() {
        let p = assets.join("Scripts").join(format!("{n}.cs"));
        std::fs::write(&p, "").unwrap();
        meta(&p, &guid(i + 1));
    }
    let mut probes = vec![];
    // ---- the four terrains' ground, and what's worked into it
    let corners = [[0.0, 0.0, 0.0], [SIZE, 0.0, 0.0], [0.0, 0.0, SIZE], [SIZE, 0.0, SIZE]];
    let mut ground: Vec<Vec<f32>> = corners.iter().map(|c| (0..RES * RES).map(|k| base(c[0] + (k % RES) as f32 * SP, c[2] + (k / RES) as f32 * SP)).collect()).collect();
    // chunk 0: a jump ( a curve insert, 20 m wide, 4 m up along its middle ), a mound ( a circle ), a copy of chunk 1's
    // ground 2 m up, a box's top ( a mesh insert ); each well inside what the studio takes it to reach
    let t0 = corners[0];
    for py in 32..=58 {
        for px in 17..=23 {
            let u = (py - 30) as f32 / 30.0;
            let k = py * RES + px;
            ground[0][k] += 4.0 * (std::f32::consts::PI * u).sin() * smooth(1.0 - (px as f32 - 20.0).abs() / 4.0);
        }
    }
    probes.push(json!({ "name": "Jump", "at": at(t0, 20.0, 45.0), "base": base(t0[0] + 40.0, t0[2] + 90.0) }));
    for py in 30..=50 {
        for px in 60..=80 {
            let d = ((px as f32 - 70.0).powi(2) + (py as f32 - 40.0).powi(2)).sqrt() / 8.0;
            if d < 0.8 {
                ground[0][py * RES + px] += 5.0 * (1.0 - d * d / 0.64);
            }
        }
    }
    probes.push(json!({ "name": "Mound", "at": at(t0, 70.0, 40.0), "base": base(t0[0] + 140.0, t0[2] + 80.0) }));
    for y in 3..9 {
        for x in 3..9 {
            let src = ground[1][(10 + y) * RES + 10 + x];
            ground[0][(90 + y) * RES + 90 + x] = src + 2.0;
        }
    }
    probes.push(json!({ "name": "Copy", "at": at(t0, 95.5, 95.5), "base": base(t0[0] + 191.0, t0[2] + 191.0) }));
    for py in 29..=31 {
        for px in 99..=101 {
            ground[0][py * RES + px] = 64.0;
        }
    }
    probes.push(json!({ "name": "Box", "at": at(t0, 100.0, 30.0), "base": base(t0[0] + 200.0, t0[2] + 60.0) }));
    // chunk 1: a formation 10 m over its builder's baseline ( the ground before it ), inside its outline
    let t1 = corners[1];
    let baseline1: Vec<f32> = ground[1].iter().map(|h| (h - t1[1]) / TOP).collect();
    let peak = [[60.0f32, 60.0], [160.0, 60.0], [160.0, 160.0], [60.0, 160.0]];
    for k in 0..RES * RES {
        let (x, z) = ((k % RES) as f32 * SP, (k / RES) as f32 * SP);
        if x > 62.0 && x < 158.0 && z > 62.0 && z < 158.0 {
            ground[1][k] += 10.0 * smooth(((x - 60.0).min(160.0 - x).min(z - 60.0).min(160.0 - z)) / 20.0);
        }
    }
    // chunk 2: a ski line carved 1.5 m down along its middle
    let t2 = corners[2];
    let line: Vec<[f32; 2]> = vec![[40.0, 30.0], [90.0, 120.0], [150.0, 200.0]];
    let to_seg = |p: [f32; 2], a: [f32; 2], b: [f32; 2]| {
        let (dx, dz) = (b[0] - a[0], b[1] - a[1]);
        let t = (((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)).clamp(0.0, 1.0);
        ((p[0] - a[0] - t * dx).powi(2) + (p[1] - a[1] - t * dz).powi(2)).sqrt()
    };
    // ( along the spline through its nodes, as Map-Tools' ski lines and the studio's trails both run )
    let pts: Vec<[f32; 3]> = line.iter().map(|p| [p[0], 0.0, p[1]]).collect();
    let path: Vec<[f32; 2]> = (0..pts.len() - 1).flat_map(|seg| (0..=40).map(move |k| (seg, k as f32 / 40.0))).map(|(seg, u)| { let q = super::tools::spline(&pts, seg, u); [q[0], q[2]] }).collect();
    for k in 0..RES * RES {
        let p = [(k % RES) as f32 * SP, (k / RES) as f32 * SP];
        let d = path.windows(2).map(|w| to_seg(p, w[0], w[1])).fold(f32::MAX, f32::min);
        if d < 6.0 {
            ground[2][k] -= 1.5 * smooth(1.0 - d / 6.0);
        }
    }
    probes.push(json!({ "name": "Line", "at": [t2[0] + 65.0, t2[2] + 75.0], "base": base(t2[0] + 65.0, t2[2] + 75.0) }));
    // ---- the terrains' data: heights, trees ( chunk 3 ), and their materials ( chunk 1's 4-channel )
    let tree_game = guid(300);
    let tree_mesh = guid(301);
    let mut game_trees = 0;
    let mut mesh_trees = 0;
    for (n, h) in ground.iter().enumerate() {
        let heights: String = h.iter().map(|v| format!("      - {}\n", ((v - corners[n][1]) / TOP * 32766.0).round() as i32)).collect();
        let mut trees = String::new();
        if n == 3 {
            trees += &format!("  m_TreeDatabase:\n    m_TreePrototypes:\n    - prefab: {{fileID: 100100000, guid: {tree_game}, type: 3}}\n    - prefab: {{fileID: 100100000, guid: {tree_mesh}, type: 3}}\n    m_TreeInstances:\n");
            for k in 0..30 {
                let (u, v) = (0.1 + 0.8 * ((k * 7) % 30) as f32 / 30.0, 0.1 + 0.8 * ((k * 11) % 30) as f32 / 30.0);
                let y = (base(corners[3][0] + u * SIZE, corners[3][2] + v * SIZE) - corners[3][1]) / TOP;
                let index = if k < 20 { 0 } else { 1 };
                if index == 0 { game_trees += 1 } else { mesh_trees += 1 }
                trees += &format!("    - position: {{x: {u}, y: {y}, z: {v}}}\n      widthScale: {}\n      heightScale: {}\n      rotation: {}\n      color: {{r: 255, g: 255, b: 255, a: 255}}\n      index: {index}\n", 0.8 + 0.02 * k as f32, 0.9 + 0.01 * k as f32, k as f32 * 0.2);
            }
        }
        let p = assets.join(format!("T{n}.asset"));
        std::fs::write(&p, format!("{HEAD}--- !u!156 &15600000\nTerrainData:\n  m_Name: T{n}\n  m_Heightmap:\n    m_Heights:\n{heights}    m_Resolution: {RES}\n    m_Scale: {{x: {SP}, y: {TOP}, z: {SP}}}\n{trees}")).unwrap();
        meta(&p, &guid(100 + n));
    }
    material(&assets.join("Terrain4.mat"), &guid(110), [1.0; 4], None, "    - _SnowMask4Channel: 1\n");
    // the snow masks: chunk 0 rock along a stripe, markings in a square; chunk 1's as its 4-channel one
    rgba_asset(&assets.join("Mask0.asset"), &guid(120), 64, |i, j| if (20..24).contains(&i) { [0, 0, 0, 255] } else if (40..50).contains(&i) && (40..50).contains(&j) { [255, 0, 180, 255] } else { [255, 0, 0, 255] });
    rgba_asset(&assets.join("Mask1.asset"), &guid(121), 64, |i, _| [255, (i * 4) as u8, 0, 255]);
    // the formation builder's baseline: the ground before it, 0..1 of the terrain's height
    let p = assets.join("Baseline1.asset");
    std::fs::write(&p, format!("{HEAD}--- !u!28 &2800000\nTexture2D:\n  m_Name: Baseline1\n  m_Width: {RES}\n  m_Height: {RES}\n  m_TextureFormat: 18\n  image data: {}\n  _typelessdata: {}\n", RES * RES * 4, hex(baseline1.iter().flat_map(|f| f.to_le_bytes())))).unwrap();
    meta(&p, &guid(130));
    // ---- the pieces' meshes, pictures and materials
    let (cv, cf) = cube(1.0);
    mesh_asset(&assets.join("Cube.asset"), &guid(200), &cv, &cf);
    let quad: [[f32; 3]; 4] = [[-1.0, 1.0, -1.0], [1.0, 1.0, -1.0], [1.0, 1.0, 1.0], [-1.0, 1.0, 1.0]];
    mesh_asset(&assets.join("Quad.asset"), &guid(201), &quad, &[0, 2, 1, 0, 3, 2]);
    let (tv, tf) = cube(0.5);
    let tall: Vec<[f32; 3]> = tv.iter().map(|p| [p[0], p[1] * 6.0, p[2]]).collect();
    mesh_asset(&assets.join("Trunk.asset"), &guid(202), &tall, &tf);
    rgba_asset(&assets.join("Wood.asset"), &guid(210), 16, |i, j| if (i + j) % 2 == 0 { [140, 90, 40, 255] } else { [110, 70, 30, 255] });
    material(&assets.join("Wood.mat"), &guid(220), [1.0, 1.0, 1.0, 1.0], Some(&guid(210)), "");
    material(&assets.join("Metal.mat"), &guid(221), [0.6, 0.6, 0.65, 1.0], None, "");
    material(&assets.join("Leaves.mat"), &guid(222), [0.2, 0.5, 0.25, 1.0], None, "");
    // ---- the trees' prefabs: the game's spruce ( a feature ), and one of the map's own meshes with two LODs
    {
        let mut y = Yaml::default();
        y.go("Spruce", 0, [0.0; 3], 1.0, &[(y.next + 3, mb(4, "  id: tree_spruce\n  parameters: []\n"))], &[], true);
        std::fs::write(assets.join("Spruce.prefab"), format!("{HEAD}{}", y.out)).unwrap();
        meta(&assets.join("Spruce.prefab"), &tree_game);
        let mut y = Yaml { next: 10, ..Default::default() };
        let (root_g, root_t) = (1, 2);
        let (l0, l0t, l0f, l0r) = (y.id(), y.id(), y.id(), y.id());
        let (l1, l1t, l1f, l1r) = (y.id(), y.id(), y.id(), y.id());
        let lg = y.id();
        let lod = format!("--- !u!205 &{{ID}}\nLODGroup:\n  m_GameObject: {{fileID: {{GO}}}}\n  m_LocalReferencePoint: {{x: 0, y: 3, z: 0}}\n  m_Size: 6\n  m_FadeMode: 0\n  m_AnimateCrossFading: 0\n  m_LODs:\n  - screenRelativeHeight: 0.4\n    fadeTransitionWidth: 0\n    renderers:\n    - renderer: {{fileID: {l0r}}}\n  - screenRelativeHeight: 0.05\n    fadeTransitionWidth: 0\n    renderers:\n    - renderer: {{fileID: {l1r}}}\n");
        y.go_as(root_g, root_t, "Birch", 0, [0.0; 3], 1.0, &[(lg, lod)], &[l0t, l1t], true);
        y.go_as(l0, l0t, "Birch_LOD0", root_t, [0.0; 3], 1.0, &[(l0f, mesh_filter(&guid(202))), (l0r, renderer(&guid(222)))], &[], true);
        y.go_as(l1, l1t, "Birch_LOD1", root_t, [0.0; 3], 1.0, &[(l1f, mesh_filter(&guid(200))), (l1r, renderer(&guid(222)))], &[], true);
        std::fs::write(assets.join("Birch.prefab"), format!("{HEAD}{}", y.out)).unwrap();
        meta(&assets.join("Birch.prefab"), &tree_mesh);
        // a feature's prefab, placed by an instance of it
        let mut y = Yaml::default();
        y.go("Picnic", 0, [0.0; 3], 1.0, &[(3, mb(4, "  id: picnic_table\n  parameters:\n  - name: color\n    type: 4\n    stringValue: red\n"))], &[], true);
        std::fs::write(assets.join("Picnic.prefab"), format!("{HEAD}{}", y.out)).unwrap();
        meta(&assets.join("Picnic.prefab"), &guid(302));
    }
    // ---- the scene
    let mut y = Yaml { next: 1000, ..Default::default() };
    let mut sc = String::from(HEAD);
    // the map's exporter, its spawns under it
    let (ex_g, ex_t) = (y.id(), y.id());
    let ex_mb = y.id();
    let mut spawn_ts = vec![];
    let mut spawn_out = String::new();
    for (k, (p, fwd)) in [([30.0, 70.0, 30.0], true), ([300.0, 60.0, 40.0], false), ([60.0, 55.0, 300.0], true)].iter().enumerate() {
        let body = if *fwd { "  forwardVelocity: 1\n  speedKmh: 30\n".to_string() } else { "  forwardVelocity: 0\n  velocity: {x: 2, y: 0, z: 5}\n".into() };
        let (g, t, c) = (y.id(), y.id(), y.id());
        let mut z = Yaml::default();
        z.go_as(g, t, &format!("Spawn {}", k + 1), ex_t, *p, 1.0, &[(c, mb(6, &body))], &[], true);
        spawn_ts.push(t);
        spawn_out += &z.out;
    }
    // the terrains, each with its object container
    let mut terrain_ids = vec![];
    let mut containers = vec![];
    let mut chunk_list = String::new();
    let mut terrain_out = String::new();
    for (n, c) in corners.iter().enumerate() {
        let (tg, tt, tc) = (y.id(), y.id(), y.id());
        let (cg, ct) = (y.id(), y.id());
        let mat = if n == 1 { format!("  m_MaterialTemplate: {{fileID: 2100000, guid: {}, type: 2}}\n", guid(110)) } else { String::new() };
        let terrain = format!("--- !u!218 &{{ID}}\nTerrain:\n  m_GameObject: {{fileID: {{GO}}}}\n  m_Enabled: 1\n  m_TerrainData: {{fileID: 15600000, guid: {}, type: 2}}\n{mat}", guid(100 + n));
        let mut z = Yaml::default();
        z.go_as(tg, tt, &format!("Terrain {n}"), 0, *c, 1.0, &[(tc, terrain)], &[], true);
        z.go_as(cg, ct, &format!("Objects {n}"), 0, [0.0; 3], 1.0, &[], &[], true);
        terrain_out += &z.out;
        terrain_ids.push(tc);
        containers.push((cg, ct));
        let masks = match n {
            0 => format!("    snowMask: {{fileID: 2800000, guid: {}, type: 2}}\n    snowMask2: {{fileID: 0}}\n", guid(120)),
            1 => format!("    snowMask: {{fileID: 2800000, guid: {}, type: 2}}\n    snowMask2: {{fileID: 0}}\n", guid(121)),
            _ => "    snowMask: {fileID: 0}\n    snowMask2: {fileID: 0}\n".into(),
        };
        chunk_list += &format!("  - export: 1\n    terrain: {{fileID: {tc}}}\n    mapObjectContainer: {{fileID: {ct}}}\n{masks}    repeats: 1\n");
    }
    let exporter = mb(0, &format!("  mapName: Full Test\n  author: Studio Tests\n  modVersion: 1.2\n  camStartPosition: {{x: 128, y: 120, z: -60}}\n  allowBackgroundMountains: 0\n  scale: 1\n  overrideTime: 1\n  rawTime: 0\n  dayTimeHours: 14\n  sunAngle: 30\n  chunks:\n{chunk_list}"));
    let mut z = Yaml::default();
    z.go_as(ex_g, ex_t, "Map Data", 0, [0.0; 3], 1.0, &[(ex_mb, exporter)], &spawn_ts, true);
    sc += &z.out;
    sc += &spawn_out;
    sc += &terrain_out;
    // the game's features: in chunk 0's container ( one a lift ), and one more placed by a prefab instance
    let feats: [(&str, [f32; 3], &str); 5] = [
        ("flat_box", [20.0, 45.0, 140.0], "  - name: color\n    type: 4\n    stringValue: blue\n"),
        ("rail_long", [40.0, 48.0, 150.0], "  - name: color\n    type: 4\n    stringValue: orange\n  - name: length\n    type: 2\n    floatValue: 8\n"),
        ("ball", [60.0, 50.0, 160.0], ""),
        ("snowcannon", [80.0, 52.0, 170.0], "  - name: direction\n    type: 4\n    stringValue: flat\n  - name: count\n    type: 1\n    intValue: 3\n  - name: on\n    type: 3\n    boolValue: 1\n"),
        ("chairlift", [120.0, 45.0, 120.0], ""),
    ];
    let mut feat_ts = vec![];
    for (id, p, params) in feats.iter() {
        let mut z = Yaml { next: y.next, ..Default::default() };
        let mo = z.next + 3;
        let mut comps = vec![(mo, mb(4, &format!("  id: {id}\n  parameters:{}\n{params}", if params.is_empty() { " []" } else { "" })))];
        if *id == "chairlift" {
            comps.push((mo + 1, mb(7, "  endPosition: {x: 200, y: 110, z: 200}\n  mastPositions:\n  - {x: 140, y: 60, z: 140}\n  - {x: 170, y: 85, z: 170}\n")));
        }
        let (_, t) = z.go(id, containers[0].1, *p, 1.0, &comps, &[], true);
        z.next = mo + 2;
        y.next = z.next;
        feat_ts.push(t);
        sc += &z.out;
    }
    let inst = y.id();
    sc += &format!(
        "--- !u!1001 &{inst}\nPrefabInstance:\n  m_ObjectHideFlags: 0\n  serializedVersion: 2\n  m_Modification:\n    serializedVersion: 3\n    m_TransformParent: {{fileID: {}}}\n    m_Modifications:\n    - target: {{fileID: 2, guid: {g}, type: 3}}\n      propertyPath: m_LocalPosition.x\n      value: 100\n      objectReference: {{fileID: 0}}\n    - target: {{fileID: 2, guid: {g}, type: 3}}\n      propertyPath: m_LocalPosition.y\n      value: 50\n      objectReference: {{fileID: 0}}\n    - target: {{fileID: 2, guid: {g}, type: 3}}\n      propertyPath: m_LocalPosition.z\n      value: 180\n      objectReference: {{fileID: 0}}\n    m_RemovedComponents: []\n  m_SourcePrefab: {{fileID: 100100000, guid: {g}, type: 3}}\n",
        containers[0].1,
        g = guid(302)
    );
    // the custom pieces: a jib box ( a cube, its box collider, a capsule rail ), a snow mound ( a sphere collider ), one
    // with LODs and a light, and an inactive one ( left out )
    let mut piece_ts = vec![];
    let pieces: [(&str, i32, [f32; 3], bool); 4] = [("Jib Box", 2, [150.0, 50.0, 60.0], true), ("Snow Mound", 1, [170.0, 50.0, 70.0], true), ("Lamp Post", 0, [190.0, 50.0, 80.0], true), ("Hidden", 0, [210.0, 50.0, 90.0], false)];
    for (name, surface, p, active) in pieces.iter() {
        let mut z = Yaml { next: y.next, ..Default::default() };
        let (g, t, cm) = (z.id(), z.id(), z.id());
        let (mg, mt, mf, mr) = (z.id(), z.id(), z.id(), z.id());
        let mut comps = vec![(cm, mb(5, &format!("  surfaceType: {surface}\n  canStabilize: 1\n")))];
        let mut kids = vec![mt];
        let mut extra = String::new();
        match *name {
            "Jib Box" => {
                comps.push((z.id(), "--- !u!65 &{ID}\nBoxCollider:\n  m_GameObject: {fileID: {GO}}\n  m_Enabled: 1\n  m_Size: {x: 2, y: 2, z: 2}\n  m_Center: {x: 0, y: 1, z: 0}\n".into()));
                comps.push((z.id(), "--- !u!136 &{ID}\nCapsuleCollider:\n  m_GameObject: {fileID: {GO}}\n  m_Enabled: 1\n  m_Radius: 0.1\n  m_Height: 2\n  m_Direction: 2\n  m_Center: {x: 0, y: 2.1, z: 0}\n".into()));
            }
            "Snow Mound" => {
                comps.push((z.id(), "--- !u!135 &{ID}\nSphereCollider:\n  m_GameObject: {fileID: {GO}}\n  m_Enabled: 1\n  m_Radius: 1.5\n  m_Center: {x: 0, y: 0.5, z: 0}\n".into()));
                comps.push((z.id(), format!("--- !u!64 &{{ID}}\nMeshCollider:\n  m_GameObject: {{fileID: {{GO}}}}\n  m_Enabled: 1\n  m_Convex: 1\n  m_Mesh: {{fileID: 4300000, guid: {}, type: 2}}\n", guid(200))));
            }
            "Lamp Post" => {
                let (lg2, lt2, lf2, lr2) = (z.id(), z.id(), z.id(), z.id());
                let (ig, it) = (z.id(), z.id());
                let light = z.id();
                let lod = format!("--- !u!205 &{{ID}}\nLODGroup:\n  m_GameObject: {{fileID: {{GO}}}}\n  m_LocalReferencePoint: {{x: 0, y: 2, z: 0}}\n  m_Size: 4\n  m_FadeMode: 0\n  m_AnimateCrossFading: 0\n  m_LODs:\n  - screenRelativeHeight: 0.3\n    fadeTransitionWidth: 0\n    renderers:\n    - renderer: {{fileID: {mr}}}\n  - screenRelativeHeight: 0.02\n    fadeTransitionWidth: 0\n    renderers:\n    - renderer: {{fileID: {lr2}}}\n");
                comps.push((z.id(), lod));
                kids.push(lt2);
                kids.push(it);
                let mut w = Yaml::default();
                w.go_as(lg2, lt2, "Lamp LOD1", t, [0.0; 3], 1.0, &[(lf2, mesh_filter(&guid(201))), (lr2, renderer(&guid(221)))], &[], true);
                w.go_as(ig, it, "Bulb", t, [0.0, 4.0, 0.0], 1.0, &[(light, "--- !u!108 &{ID}\nLight:\n  m_GameObject: {fileID: {GO}}\n  m_Enabled: 1\n  m_Type: 2\n  m_Color: {r: 1, g: 0.9, b: 0.7, a: 1}\n  m_Intensity: 2\n  m_Range: 12\n  m_SpotAngle: 30\n".into())], &[], true);
                extra = w.out;
            }
            _ => {}
        }
        let mat = if *name == "Jib Box" { guid(221) } else { guid(220) };
        z.go_as(g, t, name, containers[0].1, *p, 1.0, &comps, &kids, *active);
        z.go_as(mg, mt, &format!("{name} Mesh"), t, [0.0; 3], 1.0, &[(mf, mesh_filter(&guid(if *name == "Lamp Post" { 202 } else { 200 }))), (mr, renderer(&mat))], &[], true);
        y.next = z.next.max(y.next) + 20;
        piece_ts.push(t);
        sc += &z.out;
        sc += &extra;
    }
    // the containers' children, now they're known ( rewritten in place )
    let kids0: String = feat_ts.iter().chain(piece_ts.iter()).map(|c| format!("\n  - {{fileID: {c}}}")).collect();
    let (_, ct0) = containers[0];
    sc = sc.replace(&format!("--- !u!4 &{ct0}\nTransform:\n  m_GameObject: {{fileID: {}}}\n  m_LocalRotation: {{x: 0, y: 0, z: 0, w: 1}}\n  m_LocalPosition: {{x: 0, y: 0, z: 0}}\n  m_LocalScale: {{x: 1, y: 1, z: 1}}\n  m_Children: []", containers[0].0), &format!("--- !u!4 &{ct0}\nTransform:\n  m_GameObject: {{fileID: {}}}\n  m_LocalRotation: {{x: 0, y: 0, z: 0, w: 1}}\n  m_LocalPosition: {{x: 0, y: 0, z: 0}}\n  m_LocalScale: {{x: 1, y: 1, z: 1}}\n  m_Children:{kids0}", containers[0].0));
    // the terrain editor on chunk 0: every insert
    let mut ed = format!("  terrain: {{fileID: {}}}\n  curveInserts:\n  - name: Jump\n    startX: 20\n    startY: 30\n    endX: 20\n    endY: 60\n    width: 10\n    heightOverrides: {{x: -1, y: -1}}\n", terrain_ids[0]);
    ed += &curve("curve", "    ", &[(0.0, 1.0), (0.5, 0.0), (1.0, 1.0)]);
    ed += "    repeats: 1\n    repeatScaling: 1\n";
    ed += &curve("crossSection", "    ", &[(0.0, 0.0), (1.0, 0.0)]);
    ed += "    crossSectionDepth: 0\n";
    ed += &curve("tiltCurve", "    ", &[(0.0, 0.0), (1.0, 0.0)]);
    ed += "    tiltDepth: 0\n    edgeBlend: 0.2\n    edgeFalloff: 1\n    edgeBlendMode: 1\n";
    ed += &format!("  - name: Knuckle\n    startX: 40\n    startY: 100\n    endX: 70\n    endY: 100\n    width: 8\n    heightOverrides: {{x: {}, y: {}}}\n", base(80.0, 200.0) + 3.0, base(140.0, 200.0) - 1.0);
    ed += &curve("curve", "    ", &[(0.0, 1.0), (1.0, 0.0)]);
    ed += "    repeats: 2\n    repeatScaling: 0.8\n    repeatTransitionFade: 0.1\n";
    ed += &curve("crossSection", "    ", &[(0.0, 0.0), (0.5, 1.0), (1.0, 0.0)]);
    ed += "    crossSectionDepth: 0.5\n    crossSectionSideFlatten: 0.2\n";
    ed += &curve("tiltCurve", "    ", &[(0.0, 0.0), (1.0, 1.0)]);
    ed += "    tiltDepth: 1\n    edgeBlend: 0.15\n    edgeFalloff: 1\n    edgeBlendMode: 0\n";
    ed += "  circleInserts:\n  - name: Mound\n    centerX: 70\n    centerY: 40\n    radius: 8\n    heightOverride: -1\n    depth: 5\n    normal: {x: 0, y: 0}\n    edgeBlend: 0.2\n    edgeFalloff: 1\n";
    ed += &curve("radialCurve", "    ", &[(0.0, 1.0), (1.0, 0.0)]);
    ed += "  - name: Tilted Pad\n    centerX: 110\n    centerY: 70\n    radius: 6\n    heightOverride: 60\n    depth: 2\n    normal: {x: 0.2, y: 0.1}\n    edgeBlend: 0.3\n    edgeFalloff: 1\n";
    ed += &curve("radialCurve", "    ", &[(0.0, 1.0), (1.0, 1.0)]);
    ed += &format!("  copyInserts:\n  - name: Copy\n    sourceTerrain: {{fileID: {}}}\n    srcStartX: 10\n    srcStartY: 10\n    srcSizeX: 12\n    srcSizeY: 12\n    dstStartX: 90\n    dstStartY: 90\n    mirrorX: 0\n    mirrorZ: 0\n    blendFalloff: 0.2\n    heightOffset: 2\n    copySnowmask: 0\n", terrain_ids[1]);
    ed += &format!("  meshInserts:\n  - name: Box\n    mesh: {{fileID: 4300000, guid: {}, type: 2}}\n    centerX: 100\n    centerY: 30\n    rotation: {{x: 0, y: 0, z: 0}}\n    scale: 4\n    heightOffset: 60\n    blendFalloff: 0.1\n", guid(201));
    ed += "  paintInserts:\n";
    for (name, target, erase, colour) in [("Snow Line", 0, 0, 0), ("Blue Line", 1, 0, 11), ("Powder", 2, 0, 0), ("Erase Line", 1, 1, 0)] {
        ed += &format!("  - name: {name}\n    startX: {}\n    startY: 5\n    endX: {}\n    endY: 120\n    width: 2\n", 5 + target * 3 + erase * 2, 5 + target * 3 + erase * 2);
        ed += &curve("lengthCurve", "    ", &[(0.0, 1.0), (1.0, 1.0)]);
        ed += &curve("crossSectionCurve", "    ", &[(0.0, 1.0), (1.0, 1.0)]);
        ed += &format!("    repeats: 1\n    repeatScaling: 1\n    target: {target}\n    markingColorIdx: {colour}\n    powderDepth: 1\n    erase: {erase}\n    coverage: 0.8\n");
    }
    let mut z = Yaml { next: y.next, ..Default::default() };
    let c = z.next + 3;
    z.go("Terrain Editor", 0, [0.0; 3], 1.0, &[(c, mb(1, &ed))], &[], true);
    y.next = c + 1;
    sc += &z.out;
    // the formation builder on chunk 1: a formation over its baseline, and one switched off
    let mut fb = format!("  terrain: {{fileID: {}}}\n  baseline: {{fileID: 2800000, guid: {}, type: 2}}\n  formations:\n  - name: Peak\n    enabled: 1\n    area:\n", terrain_ids[1], guid(130));
    for p in peak {
        fb += &format!("    - {{x: {}, y: {}}}\n", p[0], p[1]);
    }
    fb += "    blendMode: 0\n    height: 10\n    noiseType: 1\n    hydraulicEnabled: 0\n";
    fb += &curve("domeProfile", "    ", &[(0.0, 0.0), (1.0, 1.0)]);
    fb += "  - name: Off\n    enabled: 0\n    area:\n    - {x: 10, y: 200}\n    - {x: 40, y: 200}\n    - {x: 40, y: 230}\n    blendMode: 1\n    height: 6\n    noiseType: 0\n";
    fb += &curve("domeProfile", "    ", &[(0.0, 0.0), (1.0, 1.0)]);
    let mut z = Yaml { next: y.next, ..Default::default() };
    let c = z.next + 3;
    z.go("Formations", 0, [0.0; 3], 1.0, &[(c, mb(2, &fb))], &[], true);
    y.next = c + 1;
    sc += &z.out;
    // the ski line on chunk 2: carved in, with a kicker, a table, a roller and a landing
    let mut ln = format!("  terrain: {{fileID: {}}}\n  lines:\n  - name: Line\n    enabled: 1\n    width: 12\n", terrain_ids[2]);
    ln += &curve("crossSection", "    ", &[(0.0, 0.0), (1.0, 0.0)]);
    ln += "    crossSectionDepth: 0\n    nodes:\n";
    for (k, p) in line.iter().enumerate() {
        ln += &format!("    - position: {{x: {}, y: {}, z: {}}}\n      widthOverride: {}\n      roll: {}\n", p[0], base(t2[0] + p[0], t2[2] + p[1]) - 1.5, p[1], if k == 1 { 10 } else { -1 }, k * 2);
    }
    ln += "    features:\n";
    for (name, start, h) in [("Kicker", 10, 2.5), ("Table", 40, 1.5), ("Roller", 70, 1.0), ("Landing", 100, 0.0)] {
        ln += &format!("    - name: {name}\n      enabled: 1\n      start: {start}\n      length: 14\n      height: {h}\n      lateralOffset: 0\n      width: 0\n      sideBlend: 0.25\n");
        ln += &curve("profile", "      ", &[(0.0, 0.0), (0.6, 0.5), (1.0, if name == "Kicker" { 1.0 } else { 0.0 })]);
        // ( the kicker's stripes, as its preset has them )
        ln += if name == "Kicker" { "      paintStripes:\n      - acrossLine: 0\n        position: 0.06\n        stripeWidth: 0.5\n        softness: 0.4\n        opacity: 0.7\n        inset: 0\n        colorIdx: 11\n      - acrossLine: 0\n        position: 0.94\n        stripeWidth: 0.5\n        softness: 0.4\n        opacity: 0.7\n        inset: 0\n        colorIdx: 11\n      - acrossLine: 1\n        position: 1\n        stripeWidth: 0.5\n        softness: 0.4\n        opacity: 0.85\n        inset: 0.06\n        colorIdx: 0\n" } else { "      paintStripes: []\n" };
    }
    let mut z = Yaml { next: y.next, ..Default::default() };
    let c = z.next + 3;
    z.go("Ski Lines", 0, [0.0; 3], 1.0, &[(c, mb(3, &ln))], &[], true);
    sc += &z.out;
    std::fs::write(assets.join("Full.unity"), sc).unwrap();
    let expect = json!({
        "name": "Full Test", "chunks": 4, "objects": feats.len() + 1, "lifts": 1, "spawns": 3, "pieces": 3,
        "gameTrees": game_trees, "meshTrees": mesh_trees,
        "shapes": { "curve": 2, "circle": 2, "stamp": 2, "paint": 4, "formation": 2 },
        "skiLines": 1, "lineFeatures": 4, "probes": probes,
    });
    std::fs::write(root.join("expect.json"), serde_json::to_string_pretty(&expect).unwrap()).unwrap();
    expect
}
