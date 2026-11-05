//! Map-Tools' MapExporter, here: the map a scene makes, as Export would write it ( its settings, each chunk's
//! heights, masks and objects, the spawns ), read from the scene's files instead of from Unity.

use anyhow::{Context, Result};
use indexmap::IndexMap;

use crate::jbrmap::{Chunk, LiftData, MapData, MapObject, ParamValue, SpawnPoint, TextureData, Vec3};

use super::custom::{custom_objects, trees, Libs};
use super::math::Quat;
use super::scene::{Scene, Target};
use super::texture;
use super::value::Value;

pub fn v3(a: [f32; 3]) -> Vec3 {
    Vec3::new(a[0], a[1], a[2])
}

/// A Value that's a reference's target, read ( a scene object's, or another asset's ).
pub fn target_value(s: &Scene, t: &Target) -> Option<Value> {
    match t {
        Target::Scene(i) => Some(s.obj(*i).value.clone()),
        Target::Asset(f, id) => f.get(*id).map(|o| o.value.clone()),
        Target::Source(..) => None,
    }
}

/// A material's saved properties of a kind ( m_TexEnvs, m_Floats, m_Colors ), by name: text files list them as
/// one-key maps, binary ones as pairs.
pub fn props<'a>(mat: &'a Value, kind: &str) -> Vec<(String, &'a Value)> {
    let list = mat.at("m_SavedProperties").get(kind);
    let items = match list {
        Value::List(l) => l.iter().collect::<Vec<_>>(),
        _ => list.get("Array").list().iter().collect(),
    };
    items
        .into_iter()
        .filter_map(|it| {
            if !it.get("first").is_null() {
                let k = it.get("first");
                let name = if k.get("name").is_null() { k.str().to_string() } else { k.get("name").str().to_string() };
                return Some((name, it.get("second")));
            }
            it.fields().first().map(|(k, v)| (k.clone(), v))
        })
        .collect()
}

pub fn mat_float(mat: &Value, name: &str) -> Option<f32> {
    props(mat, "m_Floats").into_iter().find(|(k, _)| k == name).map(|(_, v)| v.f32())
}

/// A texture a scene object refers to, as TextureData ( PNG of its pixels, bottom row first ).
pub fn texture_data(s: &Scene, from: usize, r: &Value) -> Option<TextureData> {
    let t = s.follow(from, r)?;
    let (img, linear, mipmaps, compression) = match &t {
        Target::Source(path, _) => match texture::from_source(path) {
            Ok(i) => (i.image, i.linear, i.mipmaps, i.compression),
            Err(e) => {
                eprintln!("[unity import] {e:#}");
                return None;
            }
        },
        _ => {
            let v = target_value(s, &t)?;
            match texture::from_object(&v) {
                Ok(i) => (i, !v.get("m_ColorSpace").bool_or(true), v.get("m_MipCount").i32() > 1, 1),
                Err(e) => {
                    eprintln!("[unity import] {}: {e:#}", v.get("m_Name").str());
                    return None;
                }
            }
        }
    };
    Some(TextureData { format: 4, width: img.w as i32, height: img.h as i32, encoding: "png".into(), linear, mipmaps, compression, data: Some(png(&img)) })
}

pub fn png(img: &texture::Image) -> Vec<u8> {
    let mut out = vec![];
    let enc = image::codecs::png::PngEncoder::new_with_quality(&mut out, image::codecs::png::CompressionType::Fast, image::codecs::png::FilterType::Adaptive);
    let _ = image::ImageEncoder::write_image(enc, &img.rgba, img.w, img.h, image::ExtendedColorType::Rgba8);
    out
}

/// The terrains the exporter makes chunks of, in its order ( chunk i is the i-th of these ).
pub fn chunk_terrains(s: &Scene) -> Vec<usize> {
    let Some(&ex) = s.all(114, "MapExporter").first() else { return vec![] };
    s.obj(ex)
        .value
        .get("chunks")
        .list()
        .iter()
        .filter(|c| c.get("export").bool_or(true))
        .filter_map(|c| s.follow_scene(ex, c.get("terrain")))
        .filter(|&t| s.go_of(t).map(|g| s.active_in_hierarchy(g)).unwrap_or(false))
        .collect()
}

/// MapExporter.Export: the map's settings, chunks ( their terrain, masks, objects, custom pieces and trees ) and
/// spawns, and what couldn't be brought over.
pub fn map_of(s: &Scene) -> Result<(MapData, Vec<String>)> {
    let ex = *s.all(114, "MapExporter").first().context("the scene has no MapExporter ( Map-Tools' Map Data object )")?;
    let e = &s.obj(ex).value;
    let exporter_go = s.go_of(ex).context("MapExporter on nothing")?;
    let mut map = MapData {
        name: e.get("mapName").str().to_string(),
        id: e.get("idOverride").str().to_string(),
        mod_version: if e.get("modVersion").str().trim().is_empty() { "1.0".into() } else { e.get("modVersion").str().trim().to_string() },
        author: e.get("author").str().trim().to_string(),
        remix_authors: e.get("remixAuthors").str().trim().to_string(),
        remix_ids: e.get("remixIds").str().trim().to_string(),
        cam_start_position: v3(e.get("camStartPosition").xyz()),
        allow_background_mountains: e.get("allowBackgroundMountains").bool_or(true),
        scale: e.get("scale").f32_or(1.0),
        override_time: e.get("overrideTime").bool(),
        day_time: e.get("dayTime").f32(),
        day_time_hours: if e.get("rawTime").bool() { -1.0 } else { e.get("dayTimeHours").f32_or(-1.0) },
        sun_angle: e.get("sunAngle").f32(),
        ..Default::default()
    };
    if map.name.is_empty() {
        map.name = "Cool Map Name".into();
    }
    if map.id.is_empty() {
        map.id = crate::jbrmap::map_id_from_name(&map.name);
    }
    let mut libs = Libs::default();
    for c in e.get("chunks").list() {
        if !c.get("export").bool_or(true) {
            continue;
        }
        let Some(terrain) = s.follow_scene(ex, c.get("terrain")) else { continue };
        let Some(tgo) = s.go_of(terrain) else { continue };
        if !s.active_in_hierarchy(tgo) {
            continue;
        }
        let mut chunk = chunk_of(s, ex, c, terrain, tgo)?;
        let container = s.follow_scene(ex, c.get("mapObjectContainer")).and_then(|t| s.go_of(t));
        chunk.custom_objects = custom_objects(s, &mut libs, tgo, container);
        let tv = &s.obj(terrain).value;
        if let Some(t) = s.follow(terrain, tv.get("m_TerrainData")) {
            let file = match &t {
                Target::Asset(f, _) => Some(f.clone()),
                _ => None,
            };
            if let Some(td) = target_value(s, &t) {
                chunk.tree_prototypes = trees(s, &mut libs, &td, file.as_ref(), terrain);
            }
        }
        map.chunks.push(chunk);
    }
    map.mesh_library = libs.meshes;
    map.texture_library = libs.textures;
    let warnings = libs.warnings;
    map.spawn_points = s
        .components_in_children(exporter_go, 114, "MapSpawnPoint", false)
        .into_iter()
        .filter_map(|sp| {
            let go = s.go_of(sp)?;
            let v = &s.obj(sp).value;
            let q = s.rotation(go);
            let f = q.rotate([0.0, 0.0, 1.0]);
            let velocity = if v.get("forwardVelocity").bool() {
                let k = v.get("speedKmh").f32_or(36.0) / 3.6;
                [f[0] * k, f[1] * k, f[2] * k]
            } else {
                v.get("velocity").xyz()
            };
            Some(SpawnPoint { name: s.gos[go].name.clone(), position: v3(s.world(go).position()), rotation: v3(look_rotation(f)), velocity: v3(velocity) })
        })
        .collect();
    Ok((map, warnings))
}

/// Quaternion.LookRotation( forward ).eulerAngles: its pitch and heading, no roll.
fn look_rotation(f: [f32; 3]) -> [f32; 3] {
    let len = (f[0] * f[0] + f[1] * f[1] + f[2] * f[2]).sqrt().max(1e-9);
    let pitch = (-f[1] / len).clamp(-1.0, 1.0).asin().to_degrees();
    let yaw = f[0].atan2(f[2]).to_degrees();
    Quat::euler(pitch, yaw, 0.0).euler_angles()
}

/// MapTerrainChunkData( chunk ): the terrain's heights and size, its masks and the objects in its container.
fn chunk_of(s: &Scene, ex: usize, c: &Value, terrain: usize, tgo: usize) -> Result<Chunk> {
    let tv = &s.obj(terrain).value;
    let td = s.follow(terrain, tv.get("m_TerrainData")).and_then(|t| target_value(s, &t)).context("a chunk's terrain has no TerrainData")?;
    let hm = td.get("m_Heightmap");
    let res = if hm.get("m_Resolution").is_null() { hm.get("m_Width").i32() } else { hm.get("m_Resolution").i32() };
    let scale = hm.get("m_Scale").xyz();
    let size = [scale[0] * (res - 1) as f32, scale[1], scale[2] * (res - 1) as f32];
    // ( GetHeights: 0..32766 as 0..1; ExportHeightmapR16 then 0..65535, cut down )
    let h = hm.get("m_Heights").numbers(super::value::Prim::I16);
    let mut raw = Vec::with_capacity(h.len() * 2);
    for v in &h {
        let u = ((*v as f32 / 32766.0) * 65535.0).clamp(0.0, 65535.0) as u16;
        raw.extend_from_slice(&u.to_le_bytes());
    }
    let mut chunk = Chunk {
        position: v3(s.world(tgo).position()),
        size: v3(size),
        heightmap_resolution: res,
        terrain_data: Some(raw),
        repeats: c.get("repeats").i32_or(1),
        repeat_offset: v3(c.get("repeatOffset").xyz()),
        ..Default::default()
    };
    let mask = |key: &str| {
        let r = c.get(key);
        texture_data(s, ex, r).map(|mut t| {
            t.compression = 0;
            t
        })
    };
    chunk.snow_mask = mask("snowMask");
    chunk.snow_mask_2 = mask("snowMask2");
    chunk.snow_mask_4channel = s
        .follow(terrain, tv.get("m_MaterialTemplate"))
        .and_then(|t| target_value(s, &t))
        .and_then(|m| mat_float(&m, "_SnowMask4Channel"))
        .map(|f| f > 0.5)
        .unwrap_or(false);
    if let Some(cont) = s.follow_scene(ex, c.get("mapObjectContainer")).and_then(|t| s.go_of(t)) {
        chunk.objects = s.components_in_children(cont, 114, "MapObject", false).into_iter().filter_map(|m| map_object(s, m)).collect();
    }
    Ok(chunk)
}

/// MapObjectData( mapObject ).
fn map_object(s: &Scene, m: usize) -> Option<MapObject> {
    let go = s.go_of(m)?;
    let v = &s.obj(m).value;
    let mut parameters = IndexMap::new();
    for p in v.get("parameters").list() {
        let name = p.get("name").str().to_string();
        let val = match p.get("type").i32() {
            1 => ParamValue::Int(p.get("intValue").i64()),
            2 => ParamValue::Float(p.get("floatValue").f32()),
            3 => ParamValue::Bool(p.get("boolValue").bool()),
            4..=6 => ParamValue::String(p.get("stringValue").str().to_string()),
            _ => continue,
        };
        parameters.insert(name, val);
    }
    let lift = s.component(go, 114, "LiftSetup").map(|l| {
        let lv = &s.obj(l).value;
        LiftData { end_position: v3(lv.get("endPosition").xyz()), masts: lv.get("mastPositions").list().iter().map(|p| v3(p.xyz())).collect() }
    });
    Some(MapObject {
        id: v.get("id").str().to_string(),
        position: v3(s.world(go).position()),
        rotation: v3(s.rotation(go).euler_angles()),
        scale: v3(s.local(go).2),
        parameters,
        lift,
    })
}
