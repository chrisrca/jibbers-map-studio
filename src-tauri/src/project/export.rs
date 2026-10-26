//! A project made a .jbrmap for the game: its chunks, objects, pieces (with colliders the game's physics can take),
//! trees and settings.

use super::*;

pub struct ExportStats {
    pub bytes: u64,
    pub chunks: usize,
    pub objects: usize,
    pub spawns: usize,
    /// objects whose scale was negative (mirrored) or ~zero and had to be made positive
    pub fixed_scales: usize,
    /// colliders the game's physics would have refused (see `physics_safe`), made safe or left out
    pub fixed_colliders: usize,
}

/// Smallest scale the game accepts per axis.
pub(crate) const MIN_SCALE: f32 = 0.01;

/// The game's physics (MuJoCo) rejects the whole map's physics scene — the rider then falls forever or spawns at
/// random — if any collider ends up with a zero or negative size, so mirrored or flattened objects are made positive.
pub(crate) fn game_scale(s: [f32; 3]) -> [f32; 3] {
    s.map(|v| v.abs().max(MIN_SCALE))
}

pub(crate) fn needs_scale_fix(s: [f32; 3]) -> bool {
    game_scale(s) != s
}

pub fn export(dir: &Path, out: &Path) -> Result<ExportStats> {
    let p = load(dir)?;
    let mut map = to_map(dir, &p)?;
    let mut fixed_colliders = 0;
    for c in &mut map.chunks {
        for o in &mut c.custom_objects {
            fixed_colliders += physics_safe(&mut o.colliders);
        }
        for t in &mut c.tree_prototypes {
            fixed_colliders += physics_safe(&mut t.colliders);
        }
    }
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent)?;
    }
    crate::jbrmap::save(&map, out)?;
    Ok(ExportStats {
        bytes: std::fs::metadata(out)?.len(),
        chunks: map.chunks.len(),
        objects: map.chunks.iter().map(|c| c.objects.len() + c.custom_objects.len()).sum(),
        spawns: map.spawn_points.len(),
        fixed_scales: p.objects.iter().filter(|o| needs_scale_fix(o.scale)).count(),
        fixed_colliders,
    })
}

/// The game builds its physics (MuJoCo) from every collider of the map at once, and one it refuses — a capsule with
/// no straight part, a box with a flat side, a sphere with no size, a NaN anywhere — stops the whole of it: riders
/// fall through the world (Player.log: "Model compilation failed: Error: size 1 must be positive in geom"). Sizes
/// are made just big enough; colliders that can't be saved (not numbers) are left out. Returns how many changed.
pub(crate) fn physics_safe(colliders: &mut Vec<crate::jbrmap::Collider>) -> usize {
    use crate::jbrmap::ColliderShape;
    const MIN: f32 = 0.002;
    let finite = |v: &crate::jbrmap::Vec3| v.x.is_finite() && v.y.is_finite() && v.z.is_finite();
    let before = colliders.len();
    colliders.retain(|c| {
        finite(&c.local_position) && finite(&c.local_rotation) && finite(&c.local_scale) && finite(&c.center) && finite(&c.size) && c.radius.is_finite() && c.height.is_finite()
    });
    let mut fixed = before - colliders.len();
    for c in colliders.iter_mut() {
        let was = c.clone();
        let s = &mut c.local_scale;
        for v in [&mut s.x, &mut s.y, &mut s.z] {
            *v = v.abs().max(1e-3);
        }
        let s = [c.local_scale.x, c.local_scale.y, c.local_scale.z];
        match c.shape {
            ColliderShape::Capsule => {
                let axis = c.direction.clamp(0, 2) as usize;
                let across = (0..3).filter(|&i| i != axis).map(|i| s[i]).fold(0.0f32, f32::max);
                c.radius = c.radius.abs().max(MIN / across);
                // its straight part (height less the two round ends) must have some length
                let need = (2.0 * c.radius * across + MIN) / s[axis];
                if c.height < need {
                    c.height = need;
                }
            }
            ColliderShape::Box => {
                c.size.x = c.size.x.abs().max(MIN / s[0]);
                c.size.y = c.size.y.abs().max(MIN / s[1]);
                c.size.z = c.size.z.abs().max(MIN / s[2]);
            }
            ColliderShape::Sphere => {
                let most = s.iter().fold(0.0f32, |a, &b| a.max(b));
                c.radius = c.radius.abs().max(MIN / most);
            }
            ColliderShape::Mesh => {}
        }
        if *c != was {
            fixed += 1;
        }
    }
    fixed
}

pub fn to_map(dir: &Path, p: &Project) -> Result<MapData> {
    if p.chunks.is_empty() {
        bail!("map has no terrain chunks");
    }
    let mut chunks: Vec<Chunk> = p
        .chunks
        .par_iter()
        .map(|e| -> Result<Chunk> {
            let res = e.resolution;
            let heights = read_f32(&dir.join(&e.heights))?;
            if heights.len() != (res * res) as usize {
                bail!("{}: expected {}x{} heights, found {}", e.key, res, res, heights.len());
            }
            let mut c = Chunk {
                position: v3(e.position),
                size: v3(e.size),
                heightmap_resolution: res,
                snow_mask: load_mask(dir, e.snow_mask.as_deref())?,
                snow_mask_4channel: e.snow_mask_4_channel,
                snow_mask_2: load_mask(dir, e.snow_mask_2.as_deref())?,
                tree_prototypes: e.tree_prototypes.clone(),
                repeats: e.repeats,
                repeat_offset: v3(e.repeat_offset),
                ..Default::default()
            };
            c.set_heights(&heights);
            never_flat(&mut c);
            Ok(c)
        })
        .collect::<Result<_>>()?;

    let chunk_of = |pos: [f32; 3]| -> usize {
        p.chunks
            .iter()
            .position(|c| {
                pos[0] >= c.position[0] && pos[0] < c.position[0] + c.size[0] && pos[2] >= c.position[2] && pos[2] < c.position[2] + c.size[2]
            })
            .unwrap_or(0)
    };
    for o in &p.objects {
        chunks[chunk_of(o.position)].objects.push(MapObject {
            id: o.id.clone(),
            position: v3(o.position),
            rotation: v3(o.rotation),
            scale: v3(game_scale(o.scale)),
            parameters: o.params.clone(),
            lift: o.lift.clone(),
        });
    }
    for o in &p.custom_objects {
        let k = chunk_of(a3(o.position));
        // the game's own trees go in as its trees (what its maps do): drawn by the game, textured, rather than as the
        // placeholder model in one colour
        if let Some(id) = official_tree(o) {
            let instance = tree_instance(o, &chunks[k]);
            let trees = &mut chunks[k].tree_prototypes;
            let i = match trees.iter().position(|t| t.object_id == id && t.parts.is_empty()) {
                Some(i) => i,
                None => {
                    trees.push(TreePrototype { object_id: id, ..TreePrototype::default() });
                    trees.len() - 1
                }
            };
            trees[i].instances.get_or_insert_with(Vec::new).extend_from_slice(&instance);
            continue;
        }
        chunks[k].custom_objects.push(o.clone());
    }

    let (mesh_library, texture_library) = match &p.library {
        Some(rel) => {
            let mut lib = crate::jbrmap::load(dir.join(rel))?;
            let used = p.custom_objects.iter().flat_map(|o| &o.parts).flat_map(|pt| &pt.materials).map(|m| m.base_tex.as_str()).collect();
            for k in scenery::unused_paintings(&lib.texture_library, &used) {
                lib.texture_library.shift_remove(&k);
            }
            (lib.mesh_library, lib.texture_library)
        }
        None => Default::default(),
    };

    // (an id the game won't take: made from the name, as Map-Tools does)
    let id = if crate::jbrmap::is_valid_map_id(&p.map.id) {
        p.map.id.clone()
    } else {
        Some(crate::jbrmap::map_id_from_name(&p.map.name)).filter(|i| !i.is_empty()).unwrap_or_else(|| {
            let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
            format!("map-{t:x}")
        })
    };
    Ok(MapData {
        id,
        name: p.map.name.clone(),
        version: crate::jbrmap::FORMAT_VERSION.into(),
        mod_version: Some(p.map.mod_version.trim()).filter(|v| !v.is_empty()).unwrap_or("1.0").to_string(),
        author: p.map.author.trim().to_string(),
        remix_authors: p.map.remix_authors.clone(),
        remix_ids: p.map.remix_ids.clone(),
        scale: p.map.scale.clamp(0.1, 3.0),
        cam_start_position: v3(p.map.cam_start),
        allow_background_mountains: p.map.allow_background_mountains,
        override_time: p.map.override_time,
        day_time: p.map.day_time,
        day_time_hours: p.map.day_time_hours,
        sun_angle: p.map.sun_angle,
        chunks,
        spawn_points: p
            .spawns
            .iter()
            .map(|s| SpawnPoint { name: s.name.clone(), position: v3(s.position), rotation: v3(s.rotation), velocity: v3(s.velocity) })
            .collect(),
        mesh_library,
        texture_library,
    })
}

/// The game's tree a piece is (the official feature it was placed as: its meshes are "Features/<tree id>/…"), if any.
pub(crate) fn official_tree(o: &CustomObject) -> Option<String> {
    let id = o.parts.first()?.mesh.strip_prefix("Features/")?.split('/').next()?.to_string();
    (id.starts_with("tree") && o.parts.iter().all(|p| p.mesh.starts_with(&format!("Features/{id}/")))).then_some(id)
}

/// One tree as the format stores it (28 bytes): its position as fractions of the chunk (height of its height range),
/// width and height scale, turn about up (radians), and a tint — a little lighter or darker each, as the game's own
/// maps have them.
pub(crate) fn tree_instance(o: &CustomObject, c: &Chunk) -> [u8; 28] {
    let f = [
        (o.position.x - c.position.x) / c.size.x,
        (o.position.y - c.position.y) / c.size.y,
        (o.position.z - c.position.z) / c.size.z,
        ((o.scale.x.abs() + o.scale.z.abs()) / 2.0).max(0.01),
        o.scale.y.abs().max(0.01),
        o.rotation.y.to_radians().rem_euclid(std::f32::consts::TAU),
    ];
    let mut out = [0u8; 28];
    for (i, v) in f.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_le_bytes());
    }
    let h = (o.position.x * 73.0 + o.position.z * 151.0).abs() as u32 % 61;
    let tint = 170 + h as u8;
    out[24..28].copy_from_slice(&[tint, tint, tint, 255]);
    out
}

/// A chunk whose heights are all the same can't be stood on in the game: its physics ground (MuJoCo's height field,
/// made by the game's MjHeightFieldShape) is scaled by the chunk's height range, and with none (PrepareHeightMap:
/// max − min < 1e-6 → MaximumHeight 0) it lies at the bottom of the chunk (position.y), not at the snow, so riders
/// fall straight through. One corner sample one step (size.y / 65535, millimetres) off gives it a range. Returns
/// whether the chunk was flat.
pub(crate) fn never_flat(c: &mut Chunk) -> bool {
    let Some(raw) = c.terrain_data.as_mut() else { return false };
    if raw.len() < 4 || raw.chunks_exact(2).any(|v| v != &raw[..2]) {
        return false;
    }
    let v = u16::from_le_bytes([raw[0], raw[1]]);
    raw[..2].copy_from_slice(&(if v < u16::MAX { v + 1 } else { v - 1 }).to_le_bytes());
    true
}

pub(crate) fn load_mask(dir: &Path, rel: Option<&str>) -> Result<Option<TextureData>> {
    let Some(rel) = rel else { return Ok(None) };
    let bytes = std::fs::read(dir.join(rel)).with_context(|| format!("read {rel}"))?;
    let (w, h) = image::ImageReader::new(std::io::Cursor::new(&bytes)).with_guessed_format()?.into_dimensions()?;
    Ok(Some(TextureData {
        format: 4,
        width: w as i32,
        height: h as i32,
        encoding: "png".into(),
        linear: true,
        mipmaps: false,
        compression: 0,
        data: Some(bytes),
    }))
}
