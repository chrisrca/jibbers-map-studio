//! A .jbrmap made a project: its chunks' heights and masks into files, its objects, pieces and settings kept.

use super::*;

/// Converts a `.jbrmap` into a new project folder.
pub fn import_jbrmap(map_path: &Path, dir: &Path) -> Result<Project> {
    let map = crate::jbrmap::load(map_path)?;
    std::fs::create_dir_all(dir.join("heights"))?;
    std::fs::create_dir_all(dir.join("masks"))?;

    let keys: Vec<String> = (0..map.chunks.len()).map(|i| format!("chunk_{i}")).collect();
    let powder_read = powder_from_alpha(&map.version);
    let chunks: Vec<ChunkEntry> = map
        .chunks
        .par_iter()
        .zip(keys.par_iter())
        .map(|(c, key)| -> Result<ChunkEntry> {
            let heights = c.heights();
            let hrel = format!("heights/{key}.f32");
            write_f32(&dir.join(&hrel), &heights)?;
            let snow_mask = save_mask(dir, &format!("masks/{key}.png"), c.snow_mask.as_ref(), !powder_read)?;
            let snow_mask_2 = save_mask(dir, &format!("masks/{key}_2.png"), c.snow_mask_2.as_ref(), false)?;
            Ok(ChunkEntry {
                key: key.clone(),
                position: a3(c.position),
                size: a3(c.size),
                resolution: c.heightmap_resolution,
                heights: hrel,
                snow_mask,
                snow_mask_4_channel: c.snow_mask_4channel,
                snow_mask_2,
                tree_prototypes: c.tree_prototypes.clone(),
                repeats: c.repeats,
                repeat_offset: a3(c.repeat_offset),
            })
        })
        .collect::<Result<_>>()?;

    let mut objects = vec![];
    let mut custom_objects = vec![];
    for (ci, c) in map.chunks.iter().enumerate() {
        for (oi, o) in c.objects.iter().enumerate() {
            objects.push(ObjectEntry {
                uid: format!("o{ci}_{oi}"),
                id: o.id.clone(),
                position: a3(o.position),
                rotation: a3(o.rotation),
                scale: a3(o.scale),
                params: o.parameters.clone(),
                lift: o.lift.clone(),
                lift_auto: None,
            });
        }
        custom_objects.extend(c.custom_objects.iter().cloned());
    }

    let library = if map.mesh_library.is_empty() && map.texture_library.is_empty() {
        None
    } else {
        std::fs::create_dir_all(dir.join("assets"))?;
        let lib = MapData {
            id: "library".into(),
            name: "library".into(),
            mesh_library: map.mesh_library.clone(),
            texture_library: map.texture_library.clone(),
            ..Default::default()
        };
        crate::jbrmap::save(&lib, dir.join("assets/library.jbrmap"))?;
        Some("assets/library.jbrmap".to_string())
    };

    let p = Project {
        format: FORMAT.into(),
        version: 1,
        map: MapSettings {
            id: map.id.clone(),
            name: map.name.clone(),
            cam_start: a3(map.cam_start_position),
            allow_background_mountains: map.allow_background_mountains,
            override_time: map.override_time,
            day_time: map.day_time,
            day_time_hours: map.day_time_hours,
            sun_angle: map.sun_angle,
            mod_version: map.mod_version.clone(),
            author: map.author.clone(),
            remix_authors: map.remix_authors.clone(),
            remix_ids: map.remix_ids.clone(),
            scale: map.scale,
        },
        chunks,
        objects,
        spawns: map
            .spawn_points
            .iter()
            .enumerate()
            .map(|(i, s)| SpawnEntry {
                uid: format!("s{i}"),
                name: s.name.clone(),
                position: a3(s.position),
                rotation: a3(s.rotation),
                velocity: a3(s.velocity),
            })
            .collect(),
        custom_objects,
        library,
        editor: serde_json::Value::Null,
    };
    save(dir, &p)?;
    Ok(p)
}

/// Whether the game reads powder depth from a map's snow-mask alpha: maps of version 0.4 on (System.Version, as
/// MapRuntimeImporter parses it; "0.4" is what this studio writes). The powder it then feels (RagdollController's
/// drag, from TerrainPainter's contact) goes by the alpha alone, the chunk's 4-channel flag or not.
pub fn powder_from_alpha(version: &str) -> bool {
    let parts: Vec<Option<u32>> = version.trim().split('.').map(|p| p.parse().ok()).collect();
    if !(2..=4).contains(&parts.len()) || parts.iter().any(|p| p.is_none()) {
        return false;
    }
    (parts[0].unwrap(), parts[1].unwrap()) >= (0, 4)
}

/// `clear_alpha`: the mask's alpha cleared — a map older than 0.4 whose alpha the game never read, which would turn
/// into powder once it's exported again (at 0.4).
pub(crate) fn save_mask(dir: &Path, rel: &str, t: Option<&TextureData>, clear_alpha: bool) -> Result<Option<String>> {
    let Some(t) = t else { return Ok(None) };
    let Some(data) = &t.data else { return Ok(None) };
    if t.encoding != "png" {
        // Raw-encoded masks don't occur in practice; drop rather than mis-decode.
        return Ok(None);
    }
    if clear_alpha {
        let mut img = image::load_from_memory(data)?.to_rgba8();
        img.pixels_mut().for_each(|p| p.0[3] = 0);
        img.save_with_format(dir.join(rel), image::ImageFormat::Png)?;
    } else {
        std::fs::write(dir.join(rel), data)?;
    }
    Ok(Some(rel.to_string()))
}
