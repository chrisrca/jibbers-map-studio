//! Read against the Unity template on this machine, when it's there.

use std::path::Path;

use super::files::UnityProject;

const TEMPLATE: &str = "C:/Projects/jibbers-map/Jibbers_Template";

#[test]
fn reads_a_binary_scene() {
    let root = Path::new(TEMPLATE);
    if !root.join("Assets/Scenes/Main.unity").exists() {
        return;
    }
    let p = UnityProject::open(&root.join("Assets/Scenes/Main.unity")).unwrap();
    let f = p.file(&root.join("Assets/Scenes/Main.unity")).unwrap();
    let names: Vec<String> = f.objects.iter().filter(|o| o.class_id == 114).map(|o| p.script_name(&o.script)).collect();
    assert!(names.iter().any(|n| n == "BetterTerrainEditor"), "{names:?}");
    let ed = f.objects.iter().find(|o| p.script_name(&o.script) == "BetterTerrainEditor").unwrap();
    let curves: Vec<&str> = ed.value.get("curveInserts").list().iter().map(|c| c.get("name").str()).collect();
    assert_eq!(curves, ["Knuckle", "Jump"]);
    let td = f.objects.iter().find(|o| o.class_id == 156).unwrap();
    assert_eq!(td.value.at("m_Heightmap.m_Resolution").i32(), 4097);
}

#[test]
fn reads_a_text_scene() {
    let root = Path::new(TEMPLATE);
    let scene = root.join("Assets/Scenes/MLNZ_Reference.unity");
    if !scene.exists() {
        return;
    }
    let p = UnityProject::open(&scene).unwrap();
    let f = p.file(&scene).unwrap();
    let spawns = f.objects.iter().filter(|o| p.script_name(&o.script) == "MapSpawnPoint").count();
    assert_eq!(spawns, 22);
    assert!(f.objects.iter().filter(|o| o.class_id == 1001).count() > 200);
}

#[test]
#[ignore = "reads the 0.5 GB reference export"]
fn objects_as_map_tools_exports_them() {
    use super::scene;
    let root = Path::new(TEMPLATE);
    let scene_path = root.join("Assets/Scenes/MLNZ_Reference.unity");
    let p = UnityProject::open(&scene_path).unwrap();
    let s = scene::open(&p, &scene_path).unwrap();
    let ex = s.all(114, "MapExporter")[0];
    let chunks = s.obj(ex).value.get("chunks").list().to_vec();
    let cont = s.follow_scene(ex, chunks[0].get("mapObjectContainer")).and_then(|t| s.go_of(t)).expect("container");
    let mine: Vec<(String, [f32; 3], [f32; 3], [f32; 3])> = s
        .components_in_children(cont, 114, "MapObject", false)
        .into_iter()
        .map(|c| {
            let go = s.go_of(c).unwrap();
            (s.obj(c).value.get("id").str().to_string(), s.world(go).position(), s.rotation(go).euler_angles(), s.local(go).2)
        })
        .collect();
    let map = crate::jbrmap::load(root.join("MLNZ Park.jbrmap")).unwrap();
    let theirs = &map.chunks[0].objects;
    eprintln!("mine {} theirs {}", mine.len(), theirs.len());
    assert_eq!(mine.len(), theirs.len());
    let mut worst = (0.0f32, 0.0f32, 0.0f32);
    for (m, t) in mine.iter().zip(theirs) {
        assert_eq!(m.0, t.id);
        let d = |a: [f32; 3], b: crate::jbrmap::Vec3| (a[0] - b.x).abs().max((a[1] - b.y).abs()).max((a[2] - b.z).abs());
        let ang = |a: [f32; 3], b: crate::jbrmap::Vec3| {
            let w = |x: f32| ((x % 360.0) + 360.0) % 360.0;
            [(a[0], b.x), (a[1], b.y), (a[2], b.z)].iter().map(|&(p, q)| { let e = (w(p) - w(q)).abs(); e.min(360.0 - e) }).fold(0.0f32, f32::max)
        };
        worst.0 = worst.0.max(d(m.1, t.position));
        worst.1 = worst.1.max(ang(m.2, t.rotation));
        worst.2 = worst.2.max(d(m.3, t.scale));
    }
    eprintln!("worst position {} rotation {} scale {}", worst.0, worst.1, worst.2);
    assert!(worst.0 < 0.01 && worst.1 < 0.05 && worst.2 < 1e-4);
}

#[test]
#[ignore = "reads the 0.5 GB reference export"]
fn map_as_map_tools_exports_it() {
    use super::{export, scene};
    let root = Path::new(TEMPLATE);
    let scene_path = root.join("Assets/Scenes/MLNZ_Reference.unity");
    let p = UnityProject::open(&scene_path).unwrap();
    let s = scene::open(&p, &scene_path).unwrap();
    let t0 = std::time::Instant::now();
    let mine = export::map_of(&s).unwrap().0;
    eprintln!("map read in {:?}", t0.elapsed());
    let theirs = crate::jbrmap::load(root.join("MLNZ Park.jbrmap")).unwrap();
    eprintln!("name {:?}/{:?} id {:?}/{:?} chunks {}/{} spawns {}/{}", mine.name, theirs.name, mine.id, theirs.id, mine.chunks.len(), theirs.chunks.len(), mine.spawn_points.len(), theirs.spawn_points.len());
    assert_eq!(mine.chunks.len(), theirs.chunks.len());
    for (a, b) in mine.chunks.iter().zip(&theirs.chunks) {
        eprintln!("chunk pos {:?}/{:?} size {:?}/{:?} res {}/{}", a.position, b.position, a.size, b.size, a.heightmap_resolution, b.heightmap_resolution);
        let (ha, hb) = (a.terrain_data.as_ref().unwrap(), b.terrain_data.as_ref().unwrap());
        assert_eq!(ha.len(), hb.len());
        let worst = ha.chunks_exact(2).zip(hb.chunks_exact(2)).map(|(x, y)| (u16::from_le_bytes([x[0], x[1]]) as i32 - u16::from_le_bytes([y[0], y[1]]) as i32).abs()).max().unwrap();
        eprintln!("heights: worst {worst} of 65535");
        assert!(worst <= 2);
        let ma = a.snow_mask.as_ref().expect("my mask");
        let mb = b.snow_mask.as_ref().expect("their mask");
        let (ia, ib) = (image::load_from_memory(ma.data.as_ref().unwrap()).unwrap().to_rgba8(), image::load_from_memory(mb.data.as_ref().unwrap()).unwrap().to_rgba8());
        let diff = ia.as_raw().iter().zip(ib.as_raw()).filter(|(x, y)| (**x as i32 - **y as i32).abs() > 2).count();
        eprintln!("mask {}x{} / {}x{} linear {}/{} mips {}/{} 4ch {}/{}: {} bytes off", ma.width, ma.height, mb.width, mb.height, ma.linear, mb.linear, ma.mipmaps, mb.mipmaps, a.snow_mask_4channel, b.snow_mask_4channel, diff);
        assert_eq!((ma.width, ma.height), (mb.width, mb.height));
        let w = ma.width as usize * 4;
        let flipped: Vec<u8> = ia.as_raw().chunks_exact(w).rev().flatten().copied().collect();
        let fdiff = flipped.iter().zip(ib.as_raw()).filter(|(x, y)| (**x as i32 - **y as i32).abs() > 2).count();
        let ch: Vec<usize> = (0..4).map(|c| ia.as_raw().iter().zip(ib.as_raw()).enumerate().filter(|(i, (x, y))| i % 4 == c && (**x as i32 - **y as i32).abs() > 2).count()).collect();
        eprintln!("flipped: {fdiff} off; by channel {ch:?}; first pixels {:?} / {:?}", &ia.as_raw()[..8], &ib.as_raw()[..8]);
        assert!(diff < ia.as_raw().len() / 1000);
        for (x, y) in a.objects.iter().zip(&b.objects) {
            assert_eq!(x.parameters, y.parameters, "{}", x.id);
            assert_eq!(x.lift, y.lift);
        }
    }
    for (a, b) in mine.spawn_points.iter().zip(&theirs.spawn_points) {
        let d = (a.position.x - b.position.x).abs() + (a.position.y - b.position.y).abs() + (a.position.z - b.position.z).abs();
        let r = |x: f32, y: f32| { let e = ((x - y) % 360.0 + 360.0) % 360.0; e.min(360.0 - e) };
        let dr = r(a.rotation.x, b.rotation.x) + r(a.rotation.y, b.rotation.y) + r(a.rotation.z, b.rotation.z);
        let dv = (a.velocity.x - b.velocity.x).abs() + (a.velocity.y - b.velocity.y).abs() + (a.velocity.z - b.velocity.z).abs();
        assert!(a.name == b.name && d < 0.01 && dr < 0.05 && dv < 0.01, "{a:?} / {b:?}");
    }
    assert_eq!(mine.spawn_points.len(), theirs.spawn_points.len());
    assert_eq!((mine.allow_background_mountains, mine.override_time, mine.day_time_hours, mine.sun_angle), (theirs.allow_background_mountains, theirs.override_time, theirs.day_time_hours, theirs.sun_angle));
}

#[test]
#[ignore = "reads the 0.5 GB reference export"]
fn custom_pieces_as_map_tools_exports_them() {
    use super::{export, scene};
    let root = Path::new(TEMPLATE);
    let scene_path = root.join("Assets/Scenes/MLNZ_Reference.unity");
    let p = UnityProject::open(&scene_path).unwrap();
    let s = scene::open(&p, &scene_path).unwrap();
    let t0 = std::time::Instant::now();
    let mine = export::map_of(&s).unwrap().0;
    eprintln!("map read in {:?}", t0.elapsed());
    let theirs = crate::jbrmap::load(root.join("MLNZ Park.jbrmap")).unwrap();
    let (a, b) = (&mine.chunks[0], &theirs.chunks[0]);
    eprintln!("custom {}/{} trees {}/{} meshes {}/{} textures {}/{}", a.custom_objects.len(), b.custom_objects.len(), a.tree_prototypes.len(), b.tree_prototypes.len(), mine.mesh_library.len(), theirs.mesh_library.len(), mine.texture_library.len(), theirs.texture_library.len());
    fn only<T>(x: &indexmap::IndexMap<String, T>, y: &indexmap::IndexMap<String, T>) -> Vec<String> {
        x.keys().filter(|k| !y.contains_key(*k)).take(5).cloned().collect()
    }
    eprintln!("meshes only mine {:?}\n only theirs {:?}", only(&mine.mesh_library, &theirs.mesh_library), only(&theirs.mesh_library, &mine.mesh_library));
    eprintln!("textures only mine {:?}\n only theirs {:?}", only(&mine.texture_library, &theirs.texture_library), only(&theirs.texture_library, &mine.texture_library));
    // ( this template keeps its assets under Assets/MLNZ/: the export was made where they were under Assets/ )
    let key = |k: &str| {
        let k = k.strip_prefix("MLNZ/").unwrap_or(k);
        k.strip_prefix("Meshes/").or_else(|| k.strip_prefix("Textures/")).or_else(|| k.strip_prefix("Prefabs/")).unwrap_or(k).to_string()
    };
    let mut mine = mine;
    mine.mesh_library = mine.mesh_library.into_iter().map(|(k, v)| (key(&k), v)).collect();
    mine.texture_library = mine.texture_library.into_iter().map(|(k, v)| (key(&k), v)).collect();
    for c in &mut mine.chunks {
        for o in &mut c.custom_objects {
            for p in &mut o.parts {
                p.mesh = key(&p.mesh);
                for m in &mut p.materials {
                    for t in [&mut m.base_tex, &mut m.metallic_tex, &mut m.roughness_tex, &mut m.normal_tex, &mut m.emission_tex] {
                        *t = key(t);
                    }
                    for v in m.extra_props.values_mut() {
                        if let crate::jbrmap::MaterialProp::Texture(t) = v {
                            *t = key(t);
                        }
                    }
                }
            }
            for c in &mut o.colliders {
                c.mesh_ref = key(&c.mesh_ref);
            }
        }
    }
    let (a, b) = (&mine.chunks[0], &theirs.chunks[0]);
    eprintln!("after keys: meshes only theirs {:?}
 textures only theirs {:?}", only(&theirs.mesh_library, &mine.mesh_library), theirs.texture_library.keys().filter(|k| !mine.texture_library.contains_key(*k)).collect::<Vec<_>>());
    let mut bad = 0;
    for (i, (x, y)) in a.custom_objects.iter().zip(&b.custom_objects).enumerate() {
        let d = |p: crate::jbrmap::Vec3, q: crate::jbrmap::Vec3| (p.x - q.x).abs().max((p.y - q.y).abs()).max((p.z - q.z).abs());
        let mut why = vec![];
        if d(x.position, y.position) > 0.01 { why.push(format!("position {:?}/{:?}", x.position, y.position)); }
        // ( a root's scale: this template moved it onto the children, its parts' world transforms the same )
        if x.parts.len() != y.parts.len() { why.push(format!("parts {}/{}", x.parts.len(), y.parts.len())); }
        if x.colliders.len() != y.colliders.len() { why.push(format!("colliders {}/{}", x.colliders.len(), y.colliders.len())); }
        if x.lod_groups.len() != y.lod_groups.len() { why.push(format!("lods {}/{}", x.lod_groups.len(), y.lod_groups.len())); }
        if (x.surface_type, x.can_stabilize, x.intended_up_method) != (y.surface_type, y.can_stabilize, y.intended_up_method) { why.push("flags".into()); }
        for (pa, pb) in x.parts.iter().zip(&y.parts) {
            if pa.mesh != pb.mesh { why.push(format!("mesh {}/{}", pa.mesh, pb.mesh)); }
            if d(pa.local_position, pb.local_position) > 0.01 { why.push(format!("part at {:?}/{:?}", pa.local_position, pb.local_position)); }
            if pa.materials.len() != pb.materials.len() { why.push(format!("materials {}/{}", pa.materials.len(), pb.materials.len())); }
            for (ma, mb) in pa.materials.iter().zip(&pb.materials) {
                let mut mb2 = mb.clone();
                mb2.name = ma.name.clone();
                // ( the extras and keywords this project's newer shader has: compared where both have them )
                mb2.extra_props = ma.extra_props.iter().map(|(k, v)| (k.clone(), mb.extra_props.get(k).cloned().unwrap_or(v.clone()))).collect();
                mb2.keywords = ma.keywords.clone();
                if *ma != mb2 {
                    why.push(format!("material {:?} vs {:?}", (ma.base_tex.as_str(), ma.render_mode, ma.cull_mode, ma.base_color, ma.lit, ma.extra_props.len(), ma.keywords.len(), ma.alpha_cutoff, ma.smoothness), (mb.base_tex.as_str(), mb.render_mode, mb.cull_mode, mb.base_color, mb.lit, mb.extra_props.len(), mb.keywords.len(), mb.alpha_cutoff, mb.smoothness)));
                    let diff: Vec<_> = ma.extra_props.iter().filter(|(k, v)| mb.extra_props.get(*k) != Some(*v)).map(|(k, v)| (k.clone(), v.clone(), mb.extra_props.get(k).cloned())).take(3).collect();
                    if !diff.is_empty() { why.push(format!("  extras {diff:?}")); }
                    break;
                }
            }
        }
        for (ca, cb) in x.colliders.iter().zip(&y.colliders) {
            if ca.shape != cb.shape || d(ca.local_position, cb.local_position) > 0.01 || d(ca.size, cb.size) > 1e-3 || (ca.radius - cb.radius).abs() > 1e-3 || ca.surface_type != cb.surface_type {
                why.push(format!("collider {:?}/{:?}", (ca.shape, ca.local_position, ca.size, ca.surface_type), (cb.shape, cb.local_position, cb.size, cb.surface_type)));
                break;
            }
        }
        if !why.is_empty() {
            bad += 1;
            if bad <= 6 { eprintln!("piece {i}: {}", why.join("; ")); }
        }
    }
    eprintln!("{bad} pieces differ");
    let mut mbad = 0;
    for (k, ma) in &mine.mesh_library {
        let Some(mb) = theirs.mesh_library.get(k) else { continue };
        if ma != mb {
            mbad += 1;
            if mbad <= 3 {
                let vd = ma.vertices.as_ref().zip(mb.vertices.as_ref()).map(|(x, y)| x.chunks_exact(4).zip(y.chunks_exact(4)).map(|(p, q)| (f32::from_le_bytes(p.try_into().unwrap()) - f32::from_le_bytes(q.try_into().unwrap())).abs()).fold(0.0f32, f32::max));
                let f = |b: &Option<Vec<u8>>| b.as_ref().map(|b| b.chunks_exact(4).take(9).map(|q| f32::from_le_bytes(q.try_into().unwrap())).collect::<Vec<f32>>());
                eprintln!("  mine {:?}
  theirs {:?}
  n {:?} / {:?}", f(&ma.vertices), f(&mb.vertices), f(&ma.normals), f(&mb.normals));
                eprintln!("mesh {k}: verts {}/{} worst {:?} normals {}/{} tangents {}/{} colors {}/{} uv {}/{} uv2 {}/{} subs {}/{} same subs {}", ma.vertex_count, mb.vertex_count, vd, ma.normals.is_some(), mb.normals.is_some(), ma.tangents.is_some(), mb.tangents.is_some(), ma.colors.is_some(), mb.colors.is_some(), ma.uvs.is_some(), mb.uvs.is_some(), ma.uv2s.is_some(), mb.uv2s.is_some(), ma.submeshes.len(), mb.submeshes.len(), ma.submeshes == mb.submeshes);
            }
        }
    }
    eprintln!("{mbad} meshes differ");
    let mut tbad = 0;
    for (k, ta) in &mine.texture_library {
        let Some(tb) = theirs.texture_library.get(k) else { continue };
        if (ta.width, ta.height, ta.linear, ta.mipmaps, ta.compression) != (tb.width, tb.height, tb.linear, tb.mipmaps, tb.compression) {
            tbad += 1;
            if tbad <= 3 { eprintln!("texture {k}: {:?}/{:?}", (ta.width, ta.height, ta.linear, ta.mipmaps, ta.compression, &ta.encoding), (tb.width, tb.height, tb.linear, tb.mipmaps, tb.compression, &tb.encoding)); }
        }
    }
    eprintln!("{tbad} textures differ");
    // ( what's left is the template's own: it was rebuilt from this export, Maya's ':' in mesh names made '_', one
    // unused piece dropped, a newer shader's properties; the counts kept as they are, so a change shows )
    assert!(a.custom_objects.len() + 1 >= b.custom_objects.len());
    assert!(bad <= 51, "{bad} pieces differ");
    assert!(mbad <= 2 && tbad == 0);
}

/// A small Unity project written out here: a terrain ( 33 samples, 100 m, all at 50 m ), Map-Tools' exporter, a
/// terrain editor with a curve and a circle insert, a formation builder with a formation and its baseline ( 40 m ),
/// and a ski line builder with a line of three nodes and a kicker.
fn synthetic(root: &Path) {
    let _ = std::fs::remove_dir_all(root);
    let scripts = root.join("Assets/Scripts");
    std::fs::create_dir_all(&scripts).unwrap();
    let guid = |i: usize| format!("{i:032x}");
    for (i, n) in ["MapExporter", "BetterTerrainEditor", "FormationBuilder", "SkiLineBuilder"].iter().enumerate() {
        std::fs::write(scripts.join(format!("{n}.cs")), "").unwrap();
        std::fs::write(scripts.join(format!("{n}.cs.meta")), format!("fileFormatVersion: 2\nguid: {}\n", guid(i + 1))).unwrap();
    }
    let res = 33;
    let heights: String = (0..res * res).map(|_| "      - 16383\n").collect();
    std::fs::write(root.join("Assets/T.asset"), format!("%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!156 &15600000\nTerrainData:\n  m_Name: T\n  m_Heightmap:\n    m_Heights:\n{heights}    m_Resolution: {res}\n    m_Scale: {{x: 3.125, y: 100, z: 3.125}}\n")).unwrap();
    std::fs::write(root.join("Assets/T.asset.meta"), format!("fileFormatVersion: 2\nguid: {}\n", guid(100))).unwrap();
    let floats: String = (0..res * res).flat_map(|_| 0.4f32.to_le_bytes()).map(|b| format!("{b:02x}")).collect();
    std::fs::write(root.join("Assets/B.asset"), format!("%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!28 &2800000\nTexture2D:\n  m_Name: B\n  m_Width: {res}\n  m_Height: {res}\n  m_TextureFormat: 18\n  image data: {}\n  _typelessdata: {floats}\n", res * res * 4)).unwrap();
    std::fs::write(root.join("Assets/B.asset.meta"), format!("fileFormatVersion: 2\nguid: {}\n", guid(101))).unwrap();
    let curve = |name: &str, ind: &str, keys: &[(f32, f32)]| {
        let mut s = format!("{ind}{name}:\n{ind}  serializedVersion: 2\n{ind}  m_Curve:\n");
        for &(t, v) in keys {
            s += &format!("{ind}  - serializedVersion: 3\n{ind}    time: {t}\n{ind}    value: {v}\n{ind}    inSlope: 0\n{ind}    outSlope: 0\n");
        }
        s
    };
    let go = |id: i64, name: &str, comps: &[i64]| format!("--- !u!1 &{id}\nGameObject:\n  m_Name: {name}\n  m_IsActive: 1\n  m_Component:\n{}", comps.iter().map(|c| format!("  - component: {{fileID: {c}}}\n")).collect::<String>());
    let tr = |id: i64, go: i64, p: [f32; 3]| format!("--- !u!4 &{id}\nTransform:\n  m_GameObject: {{fileID: {go}}}\n  m_LocalRotation: {{x: 0, y: 0, z: 0, w: 1}}\n  m_LocalPosition: {{x: {}, y: {}, z: {}}}\n  m_LocalScale: {{x: 1, y: 1, z: 1}}\n  m_Children: []\n  m_Father: {{fileID: 0}}\n", p[0], p[1], p[2]);
    let mb = |id: i64, go: i64, script: usize, body: &str| format!("--- !u!114 &{id}\nMonoBehaviour:\n  m_GameObject: {{fileID: {go}}}\n  m_Script: {{fileID: 11500000, guid: {}, type: 3}}\n{body}", guid(script));
    let mut sc = String::from("%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n");
    sc += &go(1, "Terrain", &[2, 3]);
    sc += &tr(2, 1, [100.0, 10.0, 200.0]);
    sc += &format!("--- !u!218 &3\nTerrain:\n  m_GameObject: {{fileID: 1}}\n  m_TerrainData: {{fileID: 15600000, guid: {}, type: 2}}\n", guid(100));
    sc += &go(10, "Map", &[11, 12]);
    sc += &tr(11, 10, [0.0; 3]);
    sc += &mb(12, 10, 1, "  mapName: Synthetic\n  chunks:\n  - export: 1\n    terrain: {fileID: 3}\n    mapObjectContainer: {fileID: 0}\n    snowMask: {fileID: 0}\n    snowMask2: {fileID: 0}\n    repeats: 1\n");
    sc += &go(20, "Editor", &[21, 22]);
    sc += &tr(21, 20, [0.0; 3]);
    let mut ed = String::from("  terrain: {fileID: 3}\n  curveInserts:\n  - name: Kick\n    startX: 4\n    startY: 4\n    endX: 4\n    endY: 20\n    width: 4\n    heightOverrides: {x: -1, y: 12}\n");
    ed += &curve("curve", "    ", &[(0.0, 1.0), (1.0, 0.0)]);
    ed += "    repeats: 1\n    repeatScaling: 1\n";
    ed += &curve("crossSection", "    ", &[(0.0, 0.0), (1.0, 0.0)]);
    ed += "    crossSectionDepth: 0\n";
    ed += &curve("tiltCurve", "    ", &[(0.0, 0.0), (1.0, 0.0)]);
    ed += "    tiltDepth: 0\n    edgeBlend: 0.1\n    edgeFalloff: 1\n    edgeBlendMode: 1\n  circleInserts:\n  - name: Mound\n    centerX: 20\n    centerY: 20\n    radius: 3\n    heightOverride: -1\n    depth: 5\n    normal: {x: 0.3, y: 0}\n    edgeBlend: 0.2\n    edgeFalloff: 1\n";
    ed += &curve("radialCurve", "    ", &[(0.0, 1.0), (1.0, 0.0)]);
    ed += "  copyInserts:\n  - name: Copy\n    sourceTerrain: {fileID: 3}\n    srcStartX: 2\n    srcStartY: 2\n    srcSizeX: 5\n    srcSizeY: 4\n    dstStartX: 10\n    dstStartY: 12\n    mirrorX: 1\n    mirrorZ: 0\n    blendFalloff: 0.2\n    heightOffset: 1.5\n    copySnowmask: 0\n";
    ed += &format!("  meshInserts:\n  - name: Box\n    mesh: {{fileID: 4300000, guid: {}, type: 2}}\n    centerX: 16\n    centerY: 16\n    rotation: {{x: 0, y: 0, z: 0}}\n    scale: 2\n    heightOffset: 30\n    blendFalloff: 0.1\n", guid(102));
    ed += "  paintInserts:\n  - name: Line\n    startX: 1\n    startY: 1\n    endX: 1\n    endY: 30\n    width: 2\n";
    ed += &curve("lengthCurve", "    ", &[(0.0, 1.0), (1.0, 1.0)]);
    ed += &curve("crossSectionCurve", "    ", &[(0.0, 1.0), (1.0, 1.0)]);
    ed += "    repeats: 1\n    repeatScaling: 1\n    target: 1\n    markingColorIdx: 11\n    powderDepth: 1\n    erase: 0\n    coverage: 0.8\n";
    // ( a 2 m square at height 1, two triangles, as a text Mesh asset )
    let quad: [[f32; 3]; 4] = [[-1.0, 1.0, -1.0], [1.0, 1.0, -1.0], [1.0, 1.0, 1.0], [-1.0, 1.0, 1.0]];
    let vb: String = quad.iter().flatten().flat_map(|f| f.to_le_bytes()).map(|b| format!("{b:02x}")).collect();
    let ib: String = [0u16, 2, 1, 0, 3, 2].iter().flat_map(|i| i.to_le_bytes()).map(|b| format!("{b:02x}")).collect();
    std::fs::write(root.join("Assets/Q.asset"), format!("%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!43 &4300000\nMesh:\n  m_Name: Q\n  m_SubMeshes:\n  - firstByte: 0\n    indexCount: 6\n    topology: 0\n    baseVertex: 0\n  m_IndexFormat: 0\n  m_IndexBuffer: {ib}\n  m_VertexData:\n    m_VertexCount: 4\n    m_Channels:\n    - stream: 0\n      offset: 0\n      format: 0\n      dimension: 3\n    m_DataSize: 48\n    _typelessdata: {vb}\n")).unwrap();
    std::fs::write(root.join("Assets/Q.asset.meta"), format!("fileFormatVersion: 2\nguid: {}\n", guid(102))).unwrap();
    sc += &mb(22, 20, 2, &ed);
    sc += &go(30, "Formations", &[31, 32]);
    sc += &tr(31, 30, [0.0; 3]);
    let mut fb = format!("  terrain: {{fileID: 3}}\n  baseline: {{fileID: 2800000, guid: {}, type: 2}}\n  formations:\n  - name: Peak\n    enabled: 1\n    area:\n    - {{x: 30, y: 30}}\n    - {{x: 70, y: 30}}\n    - {{x: 70, y: 70}}\n    - {{x: 30, y: 70}}\n    blendMode: 0\n    height: 40\n    noiseType: 1\n    hydraulicEnabled: 1\n    rain: 0.7\n", guid(101));
    fb += &curve("domeProfile", "    ", &[(0.0, 0.0), (1.0, 1.0)]);
    sc += &mb(32, 30, 3, &fb);
    sc += &go(40, "Lines", &[41, 42]);
    sc += &tr(41, 40, [0.0; 3]);
    let mut ln = String::from("  terrain: {fileID: 3}\n  lines:\n  - name: Line\n    enabled: 1\n    width: 14\n");
    ln += &curve("crossSection", "    ", &[(0.0, 0.0), (1.0, 0.0)]);
    ln += "    crossSectionDepth: 0\n    nodes:\n    - position: {x: 10, y: 40, z: 10}\n      widthOverride: -1\n      roll: 5\n    - position: {x: 10, y: 38, z: 50}\n      widthOverride: 10\n      roll: 5\n    - position: {x: 30, y: 36, z: 90}\n      widthOverride: -1\n      roll: 0\n    features:\n    - name: Kicker\n      enabled: 1\n      start: 5\n      length: 12\n      height: 3\n      lateralOffset: 0\n      width: 0\n      sideBlend: 0.25\n";
    ln += &curve("profile", "      ", &[(0.0, 0.0), (0.5, 0.3), (1.0, 1.0)]);
    ln += "      paintStripes:\n      - acrossLine: 1\n        position: 1\n        stripeWidth: 0.5\n        softness: 0.4\n        opacity: 0.85\n        colorIdx: 0\n";
    sc += &mb(42, 40, 4, &ln);
    std::fs::write(root.join("Assets/S.unity"), sc).unwrap();
}

#[test]
fn map_tools_tools_made_the_studios() {
    use super::{export, scene, tools};
    let root = std::env::temp_dir().join("jibbers-unity-synthetic");
    synthetic(&root);
    let p = UnityProject::open(&root.join("Assets/S.unity")).unwrap();
    let s = scene::open(&p, &root.join("Assets/S.unity")).unwrap();
    let (map, _) = export::map_of(&s).unwrap();
    assert_eq!((map.name.as_str(), map.chunks.len(), map.chunks[0].heightmap_resolution), ("Synthetic", 1, 33));
    let mut notes = vec![];
    let (shapes, patches) = tools::shapes(&s, &mut notes);
    let by = |k: &str| shapes.iter().find(|x| x["kind"] == k).unwrap_or_else(|| panic!("no {k}: {shapes:?}")).clone();
    let c = by("curve");
    assert_eq!(c["start"], serde_json::json!([112.5, 212.5]));
    assert_eq!(c["width"], 12.5);
    assert_eq!((c["startHeight"].is_null(), c["endHeight"].as_f64()), (true, Some(22.0)));
    assert_eq!(c["profile"][0]["v"], 0.0);
    assert_eq!(c["edgeMode"], "sides");
    let ci = by("circle");
    assert!((ci["radius"].as_f64().unwrap() - 9.375).abs() < 1e-6);
    let t = ci["tiltAngle"].as_f64().unwrap();
    assert!((t - (0.3f64 / (1.0f64 - 0.09).sqrt()).atan().to_degrees()).abs() < 1e-3, "{t}");
    let f = by("formation");
    assert_eq!((f["style"].as_str(), f["hydraulic"]["on"].as_bool(), f["hydraulic"]["droplets"].as_f64().map(|x| (x * 10.0).round())), (Some("ridged"), Some(true), Some(7.0)));
    assert_eq!(f["noiseOffset"], serde_json::json!([100.0, 200.0]));
    assert_eq!(f["points"][0], serde_json::json!([130.0, 230.0]));
    // ( its change: the ground now, 50 m, less its baseline's 40, inside its outline )
    assert_eq!(patches.len(), 1);
    let b = &patches[0].1;
    let rd = |o: usize| u32::from_le_bytes(b[o..o + 4].try_into().unwrap());
    assert_eq!(rd(0), 0x3150_534a);
    let kl = rd(8) as usize;
    let at = 12 + kl;
    let (w, h) = (rd(at + 8) as usize, rd(at + 12) as usize);
    let delta: Vec<f32> = (0..w * h).map(|k| f32::from_le_bytes(b[at + 16 + k * 4..at + 20 + k * 4].try_into().unwrap())).collect();
    let mid = delta[(h / 2) * w + w / 2];
    assert!((mid - 10.0).abs() < 0.01, "{mid}");
    // the copy: 5×4 samples of the ground ( 50 m ) placed at ( 10, 12 ), 1.5 m up, mirrored along x
    let cp = by("stamp");
    assert_eq!((cp["grid"]["w"].as_u64(), cp["grid"]["h"].as_u64(), cp["mirrorX"].as_bool(), cp["heightOffset"].as_f64()), (Some(5), Some(4), Some(true), Some(1.5)));
    assert!((cp["grid"]["heights"][0].as_f64().unwrap() - 60.0).abs() < 0.01, "{}", cp["grid"]["heights"][0]);
    assert_eq!(cp["center"], serde_json::json!([100.0 + 12.0 * 3.125, 200.0 + 13.5 * 3.125]));
    // the mesh: a 4 m square ( scaled 2 ) at 30 m over the terrain's base, 2 m up: the top at 42 m, nothing past it
    let ms = shapes.iter().filter(|x| x["kind"] == "stamp").nth(1).expect("the mesh insert").clone();
    let hs = ms["grid"]["heights"].as_array().unwrap();
    let covered: Vec<f64> = hs.iter().filter_map(|h| h.as_f64()).collect();
    assert!(!covered.is_empty() && covered.iter().all(|&h| (h - 42.0).abs() < 1e-3), "{covered:?}");
    // the paint: a 6.25 m wide line, a marking, 0.8 of the way
    let pa = by("paint");
    assert_eq!((pa["target"].as_str(), pa["colour"].as_i64(), pa["width"].as_f64(), pa["coverage"].as_f64().map(|c| (c * 10.0).round())), (Some("marking"), Some(11), Some(6.25), Some(8.0)));
    // the ski line: the studio's own, every setting as it was
    let lines = tools::ski_lines(&s, &mut notes);
    assert_eq!(lines.len(), 1);
    let l = &lines[0];
    assert_eq!((l["kind"].as_str(), l["width"].as_f64(), l["nodes"].as_array().unwrap().len()), (Some("skiline"), Some(14.0), 3));
    assert_eq!(l["nodes"][0]["p"], serde_json::json!([110.0, 50.0, 210.0]));
    assert_eq!((l["nodes"][0]["width"].is_null(), l["nodes"][1]["width"].as_f64(), l["nodes"][0]["roll"].as_f64()), (true, Some(10.0), Some(5.0)));
    let f = &l["features"][0];
    assert_eq!((f["name"].as_str(), f["start"].as_f64(), f["length"].as_f64(), f["height"].as_f64(), f["sideBlend"].as_f64()), (Some("Kicker"), Some(5.0), Some(12.0), Some(3.0), Some(0.25)));
    assert_eq!((f["stripes"][0]["across"].as_bool(), f["stripes"][0]["position"].as_f64(), f["stripes"][0]["colour"].as_i64()), (Some(true), Some(1.0), Some(0)));
    assert_eq!(f["profile"].as_array().unwrap().len(), 3);
}

#[test]
#[ignore = "prints a model's FBX tree"]
fn fbx_tree() {
    let p = std::env::var("FBX").unwrap_or("C:/Projects/jibbers-map/Jibbers_Template/Library/PackageCache/com.unity.render-pipelines.core@d6dfd1e235d5/Runtime/RenderPipelineResources/Mesh/SamplesFixture.fbx".into());
    let root = super::fbx::parse(&std::fs::read(p).unwrap()).unwrap();
    fn show(n: &super::fbx::Node, depth: usize) {
        if depth > 3 || n.name == "Properties70" && depth > 2 { return; }
        let ps: Vec<String> = n.props.iter().take(4).map(|p| match p { super::fbx::Prop::Ints(v) => format!("ints[{}]", v.len()), super::fbx::Prop::Floats(v) => format!("floats[{}]", v.len()), o => format!("{o:?}").chars().take(400).collect() }).collect();
        eprintln!("{}{} {:?}", "  ".repeat(depth), n.name, ps);
        for c in &n.children { show(c, depth + 1); }
    }
    for c in &root.children {
        if ["Objects", "Connections", "GlobalSettings"].contains(&c.name.as_str()) { show(c, 0); }
    }
}

#[test]
#[ignore = "compares this machine's Unity imports"]
fn models_made_as_unity_imports_them() {
    use super::value::Value;
    let root = Path::new(TEMPLATE);
    let p = UnityProject::open(&root.join("Assets/Scenes/Main.unity")).unwrap();
    let dir = root.join("Library/PackageCache/com.unity.render-pipelines.core@d6dfd1e235d5/Runtime/RenderPipelineResources/Mesh");
    for name in ["SamplesFixture", "UnityMaterialBall", "BackgroundMesh", "SamplesFloorSpotlight", "SamplesSpotlightModel"] {
        let path = dir.join(format!("{name}.fbx"));
        let art = p.artifact(&path).expect("Unity's import");
        let unity = super::files::read_file_for_test(&art).unwrap();
        let mine = super::model::import(&path, &|_| None).unwrap();
        let meshes = |objs: &[super::files::Obj]| -> Vec<(i64, String, i64, usize)> {
            let mut v: Vec<_> = objs.iter().filter(|o| o.class_id == 43).map(|o| (o.id, o.value.get("m_Name").str().to_string(), o.value.at("m_VertexData.m_VertexCount").i64(), o.value.get("m_SubMeshes").list().len())).collect();
            v.sort();
            v
        };
        let (mu, mm) = (meshes(&unity.objects), meshes(&mine));
        eprintln!("{name}: unity {mu:?}\n  mine {mm:?}");
        let ids_u: Vec<i64> = mu.iter().map(|m| m.0).collect();
        for m in &mm {
            assert!(ids_u.contains(&m.0), "{name}: mesh {} id {} not Unity's", m.1, m.0);
        }
        // the meshes' extents and triangle counts
        for o in mine.iter().filter(|o| o.class_id == 43) {
            let u = unity.objects.iter().find(|x| x.id == o.id).unwrap();
            let (a, b) = (super::mesh::mesh_data(&o.value).unwrap(), super::mesh::mesh_data(&u.value).unwrap());
            let ext = |m: &crate::jbrmap::MeshData| {
                let v = m.vertices.as_ref().unwrap();
                let f: Vec<f32> = v.chunks_exact(4).map(|q| f32::from_le_bytes(q.try_into().unwrap())).collect();
                let mut lo = [f32::MAX; 3];
                let mut hi = [f32::MIN; 3];
                for p in f.chunks_exact(3) {
                    for k in 0..3 {
                        lo[k] = lo[k].min(p[k]);
                        hi[k] = hi[k].max(p[k]);
                    }
                }
                (lo, hi)
            };
            let tris = |m: &crate::jbrmap::MeshData| m.submeshes.iter().map(|s| s.as_ref().map(|b| b.len() / 12).unwrap_or(0)).collect::<Vec<_>>();
            let (ea, eb) = (ext(&a), ext(&b));
            eprintln!("  {}: verts {}/{} tris {:?}/{:?} lo {:?}/{:?} hi {:?}/{:?}", o.value.get("m_Name").str(), a.vertex_count, b.vertex_count, tris(&a), tris(&b), ea.0, eb.0, ea.1, eb.1);
            for k in 0..3 {
                assert!((ea.0[k] - eb.0[k]).abs() < 1e-3 && (ea.1[k] - eb.1[k]).abs() < 1e-3, "{name}: extents");
            }
            assert_eq!(tris(&a), tris(&b), "{name}: triangles");
        }
        // the nodes' transforms, by name
        let trs = |objs: &[super::files::Obj]| -> Vec<(String, [f32; 3], [f32; 4], [f32; 3])> {
            let go_name = |id: i64| objs.iter().find(|o| o.class_id == 1 && o.id == id).map(|o| o.value.get("m_Name").str().to_string()).unwrap_or_default();
            let mut v: Vec<_> = objs.iter().filter(|o| o.class_id == 4).map(|o| (go_name(o.value.get("m_GameObject").pptr().path), o.value.get("m_LocalPosition").xyz(), o.value.get("m_LocalRotation").xyzw(), o.value.get("m_LocalScale").xyz())).collect();
            v.sort_by(|a, b| a.0.cmp(&b.0));
            v
        };
        let (tu, tm) = (trs(&unity.objects), trs(&mine));
        for (a, b) in tm.iter().zip(&tu) {
            let dq = (a.2[0] * b.2[0] + a.2[1] * b.2[1] + a.2[2] * b.2[2] + a.2[3] * b.2[3]).abs();
            let dp = (0..3).map(|k| (a.1[k] - b.1[k]).abs()).fold(0.0f32, f32::max);
            if a.0 != b.0 || dq < 0.999 || dp > 1e-3 {
                eprintln!("  node {:?} vs {:?}", a, b);
            }
            assert!(a.0 == b.0 && dq > 0.999 && dp < 1e-3, "{name}: node {}", a.0);
        }
        let _ = Value::Null;
    }
}

#[test]
fn model_instances_in_a_scene() {
    use super::{export, scene};
    let src = Path::new(TEMPLATE).join("Library/PackageCache/com.unity.render-pipelines.core@d6dfd1e235d5/Runtime/RenderPipelineResources/Mesh");
    if !src.join("UnityMaterialBall.fbx").exists() {
        return;
    }
    let root = std::env::temp_dir().join("jibbers-unity-models");
    synthetic(&root);
    std::fs::copy(src.join("UnityMaterialBall.fbx"), root.join("Assets/Ball.fbx")).unwrap();
    std::fs::copy(src.join("UnityMaterialBall.fbx.meta"), root.join("Assets/Ball.fbx.meta")).unwrap();
    let g = std::fs::read_to_string(root.join("Assets/Ball.fbx.meta")).unwrap().lines().find_map(|l| l.strip_prefix("guid: ").map(|s| s.trim().to_string())).unwrap();
    std::fs::write(root.join("Assets/Scripts/CustomMapObject.cs"), "").unwrap();
    std::fs::write(root.join("Assets/Scripts/CustomMapObject.cs.meta"), format!("fileFormatVersion: 2\nguid: {:032x}\n", 9)).unwrap();
    let mut sc = std::fs::read_to_string(root.join("Assets/S.unity")).unwrap();
    // ( the map's objects under the Map object; the ball under them, moved 5 m along x )
    sc = sc.replace("    mapObjectContainer: {fileID: 0}\n", "    mapObjectContainer: {fileID: 11}\n");
    sc += &format!("--- !u!1001 &500\nPrefabInstance:\n  m_Modification:\n    m_TransformParent: {{fileID: 11}}\n    m_Modifications:\n    - target: {{fileID: -8679921383154817045, guid: {g}, type: 3}}\n      propertyPath: m_LocalPosition.x\n      value: 5\n      objectReference: {{fileID: 0}}\n    m_RemovedComponents: []\n  m_SourcePrefab: {{fileID: 100100000, guid: {g}, type: 3}}\n");
    sc += &format!("--- !u!1 &501 stripped\nGameObject:\n  m_CorrespondingSourceObject: {{fileID: 919132149155446097, guid: {g}, type: 3}}\n  m_PrefabInstance: {{fileID: 500}}\n");
    sc += &format!("--- !u!114 &502\nMonoBehaviour:\n  m_GameObject: {{fileID: 501}}\n  m_Script: {{fileID: 11500000, guid: {:032x}, type: 3}}\n  surfaceType: 2\n  canStabilize: 1\n", 9);
    std::fs::write(root.join("Assets/S.unity"), sc).unwrap();
    let p = UnityProject::open(&root.join("Assets/S.unity")).unwrap();
    let s = scene::open(&p, &root.join("Assets/S.unity")).unwrap();
    match p.file(&root.join("Assets/Ball.fbx")) {
        Ok(f) => eprintln!("ball: {} objects, gos {:?}", f.objects.len(), f.objects.iter().filter(|o| o.class_id == 1).map(|o| (o.id, o.value.get("m_Name").str().to_string())).take(3).collect::<Vec<_>>()),
        Err(e) => eprintln!("ball: {e:#}"),
    }
    eprintln!("gos {:?}", s.gos.iter().map(|g| (g.name.clone(), g.parent, g.components.len())).collect::<Vec<_>>());
    let (map, warn) = export::map_of(&s).unwrap();
    let c = &map.chunks[0];
    assert_eq!(c.custom_objects.len(), 1, "{warn:?}");
    let o = &c.custom_objects[0];
    assert!((o.position.x - 5.0).abs() < 1e-4, "{:?}", o.position);
    assert_eq!(o.parts.len(), 11);
    assert!(map.mesh_library.contains_key("Ball/Stand_Logo"), "{:?}", map.mesh_library.keys().collect::<Vec<_>>());
    assert_eq!(o.surface_type, crate::jbrmap::SurfaceType::Jib);
}

#[test]
#[ignore = "decodes this machine's Unity texture imports"]
fn compressed_textures_decode() {
    let root = Path::new(TEMPLATE);
    let p = UnityProject::open(&root.join("Assets/Scenes/Main.unity")).unwrap();
    let mut seen = std::collections::HashSet::new();
    for (_, path) in p.guids.iter().filter(|(_, p)| p.extension().map(|e| e == "png").unwrap_or(false) && p.starts_with(root.join("Assets"))).take(400) {
        // ( a normal map is stored swizzled: not its source's pixels )
        if super::texture::meta(path).at("TextureImporter.textureType").i32() == 1 {
            continue;
        }
        let Some(a) = p.artifact_with(path, &[28]) else { continue };
        let f = super::files::read_file_for_test(&a).unwrap();
        let Some(t) = f.objects.iter().find(|o| o.class_id == 28) else { continue };
        let fmt = t.value.get("m_TextureFormat").i32();
        if !seen.insert(fmt) {
            continue;
        }
        let img = super::texture::from_object(&t.value);
        let src = super::texture::from_source(path).unwrap();
        match img {
            Ok(i) => {
                let (w, h) = (i.w.min(src.image.w) as usize, i.h.min(src.image.h) as usize);
                let mut diff = 0u64;
                if (i.w, i.h) == (src.image.w, src.image.h) {
                    for k in 0..w * h * 4 {
                        diff += (i.rgba[k] as i32 - src.image.rgba[k] as i32).unsigned_abs() as u64;
                    }
                }
                let mean = diff as f64 / (w * h * 4) as f64;
                eprintln!("format {fmt}: {}x{} vs source {}x{}, mean difference {mean:.2}", i.w, i.h, src.image.w, src.image.h);
                if (i.w, i.h) == (src.image.w, src.image.h) {
                    assert!(mean < 12.0, "format {fmt} decodes far from its source");
                }
            }
            Err(e) => eprintln!("format {fmt}: {e:#}"),
        }
    }
    assert!(!seen.is_empty());
}

#[test]
#[ignore = "prints the reference export's rock pieces"]
fn rock_surfaces_in_the_export() {
    let map = crate::jbrmap::load(Path::new(TEMPLATE).join("MLNZ Park.jbrmap")).unwrap();
    for o in &map.chunks[0].custom_objects {
        if o.parts.iter().any(|p| p.mesh.contains("Rock5A") || p.mesh.contains("polySurface250")) {
            let cs: Vec<_> = o.colliders.iter().map(|c| (c.shape, c.surface_type)).collect();
            eprintln!("piece surface {:?} stabilize {} parts {} colliders {:?}", o.surface_type, o.can_stabilize, o.parts.len(), cs);
        }
    }
    eprintln!("trees: {:?}", map.chunks[0].tree_prototypes.iter().map(|t| (t.object_id.clone(), t.parts.len(), t.colliders.len(), t.instance_count())).collect::<Vec<_>>());
}

#[test]
fn a_full_project_comes_in_whole() {
    use super::{export, scene, tools};
    let root = std::env::temp_dir().join("jibbers-unity-full");
    let want = super::fixture::full(&root);
    let scene_path = root.join("Assets/Full.unity");
    let p = UnityProject::open(&scene_path).unwrap();
    let s = scene::open(&p, &scene_path).unwrap();
    let (map, notes) = export::map_of(&s).unwrap();
    assert_eq!((map.name.as_str(), map.author.as_str(), map.chunks.len()), ("Full Test", "Studio Tests", 4), "{notes:?}");
    assert_eq!((map.allow_background_mountains, map.override_time, map.day_time_hours), (false, true, 14.0));
    let objects: Vec<_> = map.chunks.iter().flat_map(|c| c.objects.iter()).collect();
    assert_eq!(objects.len(), want["objects"].as_u64().unwrap() as usize, "{:?}", objects.iter().map(|o| &o.id).collect::<Vec<_>>());
    assert!(objects.iter().any(|o| o.id == "picnic_table" && (o.position.x - 100.0).abs() < 1e-3), "the prefab instance: {:?}", objects.iter().map(|o| (&o.id, o.position.x)).collect::<Vec<_>>());
    assert_eq!(objects.iter().filter(|o| o.lift.is_some()).count(), 1);
    let cannon = objects.iter().find(|o| o.id == "snowcannon").unwrap();
    assert_eq!(cannon.parameters.len(), 3);
    assert_eq!(map.spawn_points.len(), 3);
    let pieces: Vec<_> = map.chunks.iter().flat_map(|c| c.custom_objects.iter()).collect();
    assert_eq!(pieces.len(), 3, "the inactive one left out");
    let jib = &pieces[0];
    assert_eq!((jib.colliders.len(), format!("{:?}", jib.surface_type)), (2, "Jib".to_string()));
    assert!(pieces.iter().any(|p| p.lights.len() == 1 && !p.lod_groups.is_empty()), "the lamp post: its light and LODs");
    assert!(pieces.iter().any(|p| p.colliders.iter().any(|c| format!("{:?}", c.shape) == "Mesh")), "a convex mesh collider");
    let protos = &map.chunks[3].tree_prototypes;
    assert_eq!(protos.len(), 2);
    assert_eq!((protos[0].object_id.as_str(), protos[0].instance_count()), ("tree_spruce", want["gameTrees"].as_u64().unwrap() as usize));
    assert_eq!((protos[1].parts.len(), protos[1].lod_groups.len(), protos[1].instance_count()), (2, 1, want["meshTrees"].as_u64().unwrap() as usize));
    assert!(map.chunks[0].snow_mask.is_some() && map.chunks[1].snow_mask_4channel && !map.chunks[0].snow_mask_4channel);
    let mut notes = vec![];
    let (shapes, patches) = tools::shapes(&s, &mut notes);
    for (k, n) in want["shapes"].as_object().unwrap() {
        assert_eq!(shapes.iter().filter(|x| x["kind"] == k.as_str()).count() as u64, n.as_u64().unwrap(), "{k}: {notes:?}");
    }
    assert!(!patches.is_empty(), "the formation's change over its baseline");
    let lines = tools::ski_lines(&s, &mut notes);
    assert_eq!(lines.len() as u64, want["skiLines"].as_u64().unwrap());
    let names: Vec<&str> = lines[0]["features"].as_array().unwrap().iter().map(|f| f["name"].as_str().unwrap_or("")).collect();
    assert_eq!(names, ["Kicker", "Table", "Roller", "Landing"]);
    assert_eq!(lines[0]["features"][0]["stripes"].as_array().unwrap().len(), 3, "the kicker's stripes");
    // and as the studio gets it: a project, the inserts to be taken as made
    let dir = std::env::temp_dir().join("jibbers-unity-full-project");
    let _ = std::fs::remove_dir_all(&dir);
    let (proj, _) = super::import(&scene_path, &dir).unwrap();
    let ed = &proj.editor;
    assert_eq!(ed["unbake"].as_array().unwrap().len(), 7, "the inserts and the ski line: {}", ed["unbake"]);
    assert!(ed.get("trails").is_none());
}
