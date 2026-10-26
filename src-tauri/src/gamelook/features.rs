//! The official features as pieces with the game's own look: the game's meshes (which have texture coordinates)
//! wearing its painted textures (colour, normal, metallic, roughness: grind wear and graphics are in the paint),
//! built on your machine from what gamelook/mod.rs read out of your Jibbers install
//! (`<studio data>\game-look`). Written to `<studio data>\Game features`, laid out as the app's library is
//! (`Features/Rails/Rail Long.jbrasset`…); the asset browser shows them in place of the app's one-colour pieces.
//!
//! Each stays an ordinary piece — every setting, its rail and colliders as editable as before: the colliders are the
//! app piece's own (the shapes the rails and grinding were worked out on), only what it looks like is the game's.
//! The game's paint is blue, its colour parameter turning the hue; each piece is painted in its feature's default
//! colour (blue, red…), with the brightness the game's material gives it. A feature whose setting picks one of
//! several children (the snow cannon's direction) is its default option, and a piece more for each other option
//! ("Snowcannon Flat", "Snowcannon Up 1"…) beside it.

mod look;
mod names;
mod mesh;
mod material;
pub(crate) use look::*;
pub(crate) use names::*;
pub(crate) use mesh::*;
pub(crate) use material::*;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use indexmap::IndexMap;
use crate::jbrmap::{Color, CustomObject, Material, MeshData, Part, TextureData, Vec3};
use rayon::prelude::*;
use serde::Deserialize;

use crate::library;

type Meshes = IndexMap<String, MeshData>;
type Textures = IndexMap<String, TextureData>;

/// Bump when what's built changes: the folder is built again.
const VERSION: u32 = 7;
/// The game's "blue": its paint as it comes (other colours turn the paint's hue from it).
const BLUE: u32 = 0x3b82f6;
/// The library piece is the game's prefab at half size (see jibbers-player-scale).
const SCALE: f32 = 0.5;

pub fn look_dir() -> Result<PathBuf> {
    Ok(crate::library::userassets::data_dir()?.join("game-look"))
}

pub fn root() -> Result<PathBuf> {
    Ok(crate::library::userassets::data_dir()?.join("Game features"))
}

/// Builds (or rebuilds, when the game's look was read again or this changed) the textured features; the folder, or
/// None when the game's look hasn't been read.
pub fn ensure(app_root: &Path, placeholders_json: &Path) -> Result<Option<PathBuf>> {
    static ONE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _one = ONE.lock().unwrap_or_else(|e| e.into_inner());
    let look = look_dir()?;
    let index_file = look.join("index.json");
    let Ok(meta) = std::fs::metadata(&index_file) else { return Ok(None) };
    let stamp = format!("{VERSION} {}", meta.modified()?.duration_since(std::time::UNIX_EPOCH)?.as_millis());
    let out = root()?;
    if std::fs::read_to_string(out.join(".built")).is_ok_and(|s| s == stamp) {
        return Ok(Some(out));
    }
    std::fs::remove_dir_all(&out).ok();
    let index: LookIndex = serde_json::from_slice(&std::fs::read(&index_file)?)?;
    let colours = default_colours(placeholders_json)?;
    let defaults = default_options(placeholders_json)?;
    let pieces: Vec<_> = library::list(app_root).into_iter().filter(|i| i.info.kind == library::Kind::Mesh).collect();
    let built: Vec<Result<Option<(String, String)>>> = pieces
        .par_iter()
        .map(|it| -> Result<Option<(String, String)>> {
            let obj = library::read_object(&it.path)?;
            let Some(id) = feature_of(&obj) else { return Ok(None) };
            let Some(look) = index.features.get(&id) else { return Ok(None) };
            let colour = colours.get(&id).copied();
            let rel = it.path.strip_prefix(app_root)?;
            for (k, v) in variants(look, defaults.get(&id)).iter().enumerate() {
                let (mut piece, meshes, textures) = build(app_root, rel, &id, look, v, colour)?;
                piece.lights = piece_lights(index.lights.get(&id).map_or(&[][..], Vec::as_slice), v);
                let file = if k == 0 { out.join(rel) } else { out.join(rel).with_file_name(format!("{} {}.jbrasset", it.name, option_label(&v.as_ref().unwrap().1))) };
                library::save_entry(&file, file.file_stem().unwrap_or_default().to_string_lossy().as_ref(), piece, meshes, textures)?;
            }
            Ok(Some((id, rel.to_string_lossy().replace('\\', "/"))))
        })
        .collect();
    let mut ids = HashMap::new();
    for b in built {
        if let Some((id, rel)) = b? {
            ids.insert(id, rel);
        }
    }
    let n = ids.len();
    std::fs::create_dir_all(&out)?;
    std::fs::write(out.join(IDS), serde_json::to_vec(&ids)?)?;
    std::fs::write(out.join(".built"), stamp)?;
    eprintln!("game features: {n} pieces built");
    Ok(Some(out))
}

/// Which app piece each feature's look was built on (feature id → its path in the app's library), beside the pieces.
const IDS: &str = ".features.json";

/// The feature an app piece is (its meshes are under `Features/<id>/`).
fn feature_of(obj: &CustomObject) -> Option<String> {
    obj.parts.first().and_then(|p| p.mesh.strip_prefix("Features/")).and_then(|r| r.split('/').next()).map(str::to_string)
}

/// The options a feature's look is drawn for (a setting picking one of several children: the snow cannon's
/// direction), its default first; just `None` for a feature without.
fn variants(look: &[LookRenderer], defaults: Option<&HashMap<String, String>>) -> Vec<Option<(String, String)>> {
    let mut options: Vec<(String, String)> = vec![];
    for v in look.iter().filter_map(|r| r.variant.as_ref()) {
        if !options.iter().any(|(p, o)| *p == v.param && *o == v.option) {
            options.push((v.param.clone(), v.option.clone()));
        }
    }
    options.sort_by_key(|(p, o)| defaults.and_then(|d| d.get(p)) != Some(o));
    if options.is_empty() { vec![None] } else { options.into_iter().map(Some).collect() }
}

/// The app piece at `rel` wearing the game's look for one option, painted `colour`: its parts, with the app piece's
/// colliders (and the meshes they use) unchanged.
fn build(app_root: &Path, rel: &Path, id: &str, look: &[LookRenderer], v: &Option<(String, String)>, colour: Option<u32>) -> Result<(CustomObject, Meshes, Textures)> {
    let path = app_root.join(rel);
    let mut piece = library::read_object(&path)?;
    let src = crate::jbrmap::load(&path)?;
    // (renderers by their place in the whole list: each mesh's key the same in every variant)
    let rs: Vec<(usize, &LookRenderer)> = look
        .iter()
        .enumerate()
        .filter(|(_, r)| match (&r.variant, v) {
            (None, _) => true,
            (Some(rv), Some((p, o))) => rv.param == *p && rv.option == *o,
            (Some(_), None) => false,
        })
        .collect();
    let (parts, mut meshes, textures) = dressed(&look_dir()?, id, &rs, colour)?;
    piece.parts = parts;
    for c in &piece.colliders {
        if let Some(m) = src.mesh_library.get(&c.mesh_ref) {
            meshes.insert(c.mesh_ref.clone(), m.clone());
        }
    }
    Ok((piece, meshes, textures))
}

/// A game object placed in a map (a feature, with its settings: colour, direction…) as a piece with the game's look,
/// to draw it by: the piece built for its option in its feature's own colour, or one painted in its colour on
/// demand (kept in `<Game features>\.painted`, out of the asset browser). None when the game's look has nothing for
/// it. A lift's pieces (`chairlift:mast`, `tbar:carrier`…) are asked for by those names.
pub fn piece_for(app_root: &Path, placeholders_json: &Path, id: &str, params: &HashMap<String, String>) -> Result<Option<PathBuf>> {
    // (a map can be open before the asset list has had the game's look read: a new user's first map)
    super::ensure(&look_dir()?, placeholders_json)?;
    let Some(out) = ensure(app_root, placeholders_json)? else { return Ok(None) };
    if id.contains(':') {
        return lift_piece(&out, id);
    }
    let ids: HashMap<String, String> = serde_json::from_slice(&std::fs::read(out.join(IDS)).unwrap_or_default()).unwrap_or_default();
    let Some(rel) = ids.get(id).map(PathBuf::from) else { return Ok(None) };
    let index: LookIndex = serde_json::from_slice(&std::fs::read(look_dir()?.join("index.json"))?)?;
    let Some(look) = index.features.get(id) else { return Ok(None) };
    let defaults = default_options(placeholders_json)?;
    let vs = variants(look, defaults.get(id));
    let k = vs.iter().position(|v| v.as_ref().is_some_and(|(p, o)| params.get(p) == Some(o))).unwrap_or(0);
    let own = default_colours(placeholders_json)?.get(id).copied();
    let named = params.get("color").and_then(|c| NAMED.iter().find(|(n, _)| n == c)).map(|(_, h)| *h);
    let name = rel.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let option = vs[k].as_ref().map(|(_, o)| option_label(o));
    if named.is_none() || named == own {
        let file = match &option {
            Some(o) if k > 0 => out.join(&rel).with_file_name(format!("{name} {o}.jbrasset")),
            _ => out.join(&rel),
        };
        return Ok(file.exists().then_some(file));
    }
    let colour = params.get("color").cloned().unwrap_or_default();
    let label = [Some(name.clone()), option, Some(readable(&colour))].into_iter().flatten().collect::<Vec<_>>().join(" ");
    let file = out.join(".painted").join(format!("{label}.jbrasset"));
    if !file.exists() {
        let (mut piece, meshes, textures) = build(app_root, &rel, id, look, &vs[k], named)?;
        piece.lights = piece_lights(index.lights.get(id).map_or(&[][..], Vec::as_slice), &vs[k]);
        let tmp = file.with_extension("partial");
        library::save_entry(&tmp, &label, piece, meshes, textures)?;
        std::fs::rename(&tmp, &file)?;
    }
    Ok(Some(file))
}

/// A lift's piece (its station, mast or carrier: nothing to ride on, so no colliders) with the game's look, kept in
/// `<Game features>\.lifts`; None when the game's look has nothing for it.
fn lift_piece(out: &Path, id: &str) -> Result<Option<PathBuf>> {
    let file = out.join(".lifts").join(format!("{}.jbrasset", id.replace(':', " ")));
    if file.exists() {
        return Ok(Some(file));
    }
    let look = look_dir()?;
    let index: LookIndex = serde_json::from_slice(&std::fs::read(look.join("index.json"))?)?;
    let Some(rs) = index.features.get(id) else { return Ok(None) };
    let rs: Vec<(usize, &LookRenderer)> = rs.iter().enumerate().collect();
    let (parts, meshes, textures) = dressed(&look, id, &rs, None)?;
    let piece = CustomObject { parts, ..CustomObject::default() };
    let tmp = file.with_extension("partial");
    library::save_entry(&tmp, id, piece, meshes, textures)?;
    std::fs::rename(&tmp, &file)?;
    Ok(Some(file))
}

/// The game's renderers for a feature as the piece's parts (in its frame: the prefab at half size), with their
/// meshes and textures. (Each renderer's key is by its place among all the feature's.)
fn dressed(look: &Path, id: &str, rs: &[(usize, &LookRenderer)], colour: Option<u32>) -> Result<(Vec<Part>, Meshes, Textures)> {
    let mut parts = vec![];
    let mut meshes = IndexMap::new();
    let mut textures = IndexMap::new();
    for &(k, r) in rs {
        let key = format!("Features/{id}/g{k}");
        meshes.insert(key.clone(), mesh(look, r)?);
        let mut mats = vec![];
        for m in &r.materials {
            mats.push(material(look, m, colour, &mut textures)?);
        }
        // a material a submesh (the last one again when there are fewer)
        while mats.len() < r.submeshes.len() && !mats.is_empty() {
            mats.push(mats.last().unwrap().clone());
        }
        parts.push(Part { mesh: key, materials: mats, ..Part::default() });
    }
    Ok((parts, meshes, textures))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repaint_turns_blue_to_red() {
        let img = image::RgbaImage::from_pixel(1, 1, image::Rgba([40, 60, 200, 255]));
        let out = repaint(img, (hsl(0xef4444).0 - hsl(BLUE).0).rem_euclid(1.0), 1.0, 1.0, 1.0);
        let p = out.get_pixel(0, 0).0;
        assert!(p[0] > p[2] && p[0] > p[1], "{p:?}");
    }

    /// Placed game objects come out as the pieces for their settings (reads the installed game's look).
    #[test]
    #[ignore]
    fn game_objects_find_their_pieces() {
        let lib = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../library");
        let (app, ph) = (lib.join("Library"), lib.join("placeholders/placeholders.json"));
        let p = |id: &str, kv: &[(&str, &str)]| piece_for(&app, &ph, id, &kv.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()).unwrap();
        let name = |f: Option<PathBuf>| f.map(|f| f.file_stem().unwrap().to_string_lossy().into_owned());
        assert_eq!(name(p("rail_long", &[("color", "blue")])).as_deref(), Some("Rail Long"));
        assert_eq!(name(p("snowcannon", &[("color", "orange+blue"), ("direction", "up1")])).as_deref(), Some("Snowcannon Up 1"));
        assert_eq!(name(p("snowcannon", &[("color", "orange+blue"), ("direction", "down")])).as_deref(), Some("Snowcannon"));
        let red = p("rail_long", &[("color", "red")]).unwrap();
        assert_eq!(red.file_stem().unwrap(), "Rail Long Red");
        assert!(library::read_object(&red).unwrap().parts[0].materials[0].base_tex.contains("(Red)"));
        assert_eq!(p("no_such_feature", &[]), None);
    }

    /// The game's brightness of 2 is twice the light, not twice the stored value: the paint's detail stays.
    #[test]
    fn brightness_is_in_linear_light() {
        let img = image::RgbaImage::from_fn(2, 1, |x, _| if x == 0 { image::Rgba([48, 45, 104, 255]) } else { image::Rgba([187, 187, 187, 255]) });
        let out = repaint(img, 0.0, 1.0, 1.0, 2.0);
        let (navy, stripe) = (out.get_pixel(0, 0).0, out.get_pixel(1, 0).0);
        assert!((140..=146).contains(&navy[2]), "{navy:?}");
        assert!(stripe[0] < 255 && stripe[0] > 240, "{stripe:?}");
        assert!(navy[2] > navy[0] * 2, "still navy: {navy:?}");
    }

    /// What the game's piece shader makes of the converted material equals what its feature shader makes of the
    /// original, texel for texel (to a byte's rounding).
    #[test]
    fn pieces_come_out_as_metallic_and_smooth_as_the_games_features() {
        let look = std::env::temp_dir().join(format!("jibbers-gf-test-{}", std::process::id()));
        std::fs::create_dir_all(look.join("textures")).unwrap();
        // grey maps, stored sRGB as the game's are, with a few different values
        let values = [0u8, 60, 128, 200, 255, 90, 30, 170, 220];
        let grey = image::RgbaImage::from_fn(3, 3, |x, y| {
            let v = values[(y * 3 + x) as usize];
            image::Rgba([v, v, v, 255])
        });
        grey.save(look.join("textures/metal.png")).unwrap();
        grey.save(look.join("textures/rough.png")).unwrap();
        let m = LookMaterial {
            name: String::new(),
            base: None,
            normal: None,
            metal: Some("textures/metal.png".into()),
            rough: Some("textures/rough.png".into()),
            emit: None,
            emission_color: None,
            metallic: 0.3,
            roughness: 0.92,
            smoothness: 0.5,
            brightness: 1.0,
            hue_shift: 0.0,
            cutoff: None,
            double_sided: false,
            linear: HashMap::from([("metal".to_string(), false), ("rough".to_string(), false)]),
            shader: "Custom/MapObject".into(),
        };
        let mut textures = IndexMap::new();
        let mat = material(&look, &m, None, &mut textures).unwrap();
        let read = |key: &str| {
            let t = &textures[key];
            (image::load_from_memory(t.data.as_ref().unwrap()).unwrap().to_rgba8(), t.linear)
        };
        let (metal, metal_linear) = read(&mat.metallic_tex);
        let (rough, rough_linear) = read(&mat.roughness_tex);
        for (i, v) in values.iter().enumerate() {
            let (x, y) = (i as u32 % 3, i as u32 / 3);
            // the game's own feature (Custom/MapObject)
            let official_metallic = shader_value(*v, false) * 0.3;
            let official_smoothness = 1.0 - shader_value(*v, false) * 0.92;
            // the piece (Custom/CustomObjectLit)
            let metallic = (shader_value(metal.get_pixel(x, y)[0], metal_linear) + mat.metallic).clamp(0.0, 1.0);
            let smoothness = (1.0 - shader_value(rough.get_pixel(x, y)[0], rough_linear) + mat.smoothness).clamp(0.0, 1.0);
            assert!((metallic - official_metallic).abs() < 0.003, "metallic at {v}: {metallic} vs {official_metallic}");
            assert!((smoothness - official_smoothness).abs() < 0.003, "smoothness at {v}: {smoothness} vs {official_smoothness}");
        }
        std::fs::remove_dir_all(&look).ok();
    }
}
