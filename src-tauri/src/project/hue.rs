//! A piece's paint adjusted (the studio's `hue` on a piece, 0..1, and `adjust`: Saturation, Lightness, Brightness and
//! Contrast, -1..1), baked at export: the game draws pieces with Custom/CustomObjectLit, which has none of these (only
//! its features' shader, Custom/MapObject, turns a paint). So each of the piece's materials gets a copy of its colour
//! texture with them in it — its texture times its colour; turned as MapObject turns its own features' paint, in linear
//! light, round the colour wheel in HSV (gamelook::features::hsv_turn); then the others in sRGB, as Photoshop has them —
//! and its colour set to white; one without a texture has its colour adjusted. The view draws them the same way
//! (src/viewport/render/customRenderer/materials.ts adjusted).

use std::collections::HashSet;

use anyhow::{Context, Result};
use indexmap::IndexMap;

use crate::gamelook::features::{hsv_turn, to_linear, to_srgb};
use crate::jbrmap::{Chunk, Color, TextureData};

/// A piece's paint adjustments: its Hue a turn (0..1), the others -1..1 (0: as it is).
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Adjust {
    hue: f32,
    saturation: f32,
    lightness: f32,
    brightness: f32,
    contrast: f32,
}

/// A piece's adjustments, None when it has none.
pub(crate) fn adjust_of(o: &crate::jbrmap::CustomObject) -> Option<Adjust> {
    let hue = o.studio.get("hue").and_then(|h| h.as_f64()).map(|h| (h as f32).rem_euclid(1.0)).filter(|h| (1e-4..1.0 - 1e-4).contains(h)).unwrap_or(0.0);
    let a = o.studio.get("adjust");
    let f = |k: &str| a.and_then(|a| a.get(k)).and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
    let adj = Adjust { hue, saturation: f("saturation"), lightness: f("lightness"), brightness: f("brightness"), contrast: f("contrast") };
    [adj.hue, adj.saturation, adj.lightness, adj.brightness, adj.contrast].iter().any(|v| v.abs() > 1e-4).then_some(adj)
}

/// A colour (linear) adjusted: turned, then in sRGB Brightness (a curve: its dark and light ends kept), Contrast (about
/// the middle), Saturation (from its grey, the luma) and Lightness (towards white, or black).
fn adjusted(c: [f32; 3], a: &Adjust) -> [f32; 3] {
    let c = if a.hue != 0.0 { hsv_turn(c, a.hue, 1.0) } else { c };
    if a.saturation == 0.0 && a.lightness == 0.0 && a.brightness == 0.0 && a.contrast == 0.0 {
        return c;
    }
    let s = c.map(|v| to_srgb(v.max(0.0)));
    let s = s.map(|v| v.max(0.0).powf(1.0 - a.brightness * 0.6));
    let s = s.map(|v| (v - 0.5) * (1.0 + a.contrast) + 0.5);
    let l = 0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2];
    let s = s.map(|v| l + (v - l) * (1.0 + a.saturation));
    s.map(|v| to_linear((if a.lightness > 0.0 { v + (1.0 - v) * a.lightness } else { v * (1.0 + a.lightness) }).clamp(0.0, 1.0)))
}

/// Bakes every piece's adjustments into its materials (their textures copied into `textures`, each copy made once); how
/// many pieces had any.
pub fn bake(chunks: &mut [Chunk], textures: &mut IndexMap<String, TextureData>) -> Result<usize> {
    let mut made: HashSet<String> = HashSet::new();
    let mut n = 0;
    for c in chunks.iter_mut() {
        for o in &mut c.custom_objects {
            let Some(adj) = adjust_of(o) else { continue };
            n += 1;
            for m in o.parts.iter_mut().flat_map(|p| p.materials.iter_mut()) {
                let col = m.base_color;
                let tex = (!m.base_tex.is_empty()).then(|| textures.get(&m.base_tex)).flatten().filter(|t| t.data.is_some());
                let Some(tex) = tex else {
                    let [r, g, b] = adjusted([col.r, col.g, col.b].map(to_linear), &adj).map(|c| to_srgb(c.clamp(0.0, 1.0)));
                    m.base_color = Color { r, g, b, a: col.a };
                    continue;
                };
                let key = format!(
                    "{}~adj{:.0},{:.3},{:.3},{:.3},{:.3}~{:.3},{:.3},{:.3}",
                    m.base_tex,
                    adj.hue * 360.0,
                    adj.saturation,
                    adj.lightness,
                    adj.brightness,
                    adj.contrast,
                    col.r,
                    col.g,
                    col.b
                );
                if !made.contains(&key) {
                    let baked = turned(tex, [col.r, col.g, col.b], &adj).with_context(|| format!("texture {}", m.base_tex))?;
                    textures.insert(key.clone(), baked);
                    made.insert(key.clone());
                }
                m.base_tex = key;
                m.base_color = Color { r: 1.0, g: 1.0, b: 1.0, a: col.a };
            }
        }
    }
    Ok(n)
}

/// A colour texture times `colour`, adjusted, as a new texture (sRGB, its alpha kept).
fn turned(tex: &TextureData, colour: [f32; 3], adj: &Adjust) -> Result<TextureData> {
    let data = tex.data.as_deref().context("no data")?;
    let mut img = if tex.encoding == "png" { image::load_from_memory(data)?.to_rgba8() } else { super::assets::decode_raw(tex, data)? };
    let colour = colour.map(to_linear);
    for p in img.pixels_mut() {
        let c = [p[0], p[1], p[2]].map(|v| v as f32 / 255.0);
        // (as the game's shader gets it: an sRGB texture decoded)
        let c = if tex.linear { c } else { c.map(to_linear) };
        let c = adjusted([c[0] * colour[0], c[1] * colour[1], c[2] * colour[2]], adj);
        for k in 0..3 {
            p[k] = (to_srgb(c[k].clamp(0.0, 1.0)) * 255.0).round() as u8;
        }
    }
    let mut png = vec![];
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;
    Ok(TextureData { format: 4, width: img.width() as i32, height: img.height() as i32, encoding: "png".into(), linear: false, mipmaps: tex.mipmaps, compression: tex.compression, data: Some(png) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jbrmap::{CustomObject, Material, Part};

    fn png(px: [u8; 4]) -> TextureData {
        let img = image::RgbaImage::from_pixel(2, 2, image::Rgba(px));
        let mut data = vec![];
        img.write_to(&mut std::io::Cursor::new(&mut data), image::ImageFormat::Png).unwrap();
        TextureData { width: 2, height: 2, linear: false, data: Some(data), ..TextureData::default() }
    }

    /// A blue piece with a Hue of 0.4 (the game's red) comes out red: its texture copied with the turn in it, its own
    /// texture left for the pieces without; a piece without a texture has its colour turned.
    #[test]
    fn a_pieces_hue_is_baked_into_its_textures() {
        let mut textures = IndexMap::new();
        textures.insert("Blue".to_string(), png([40, 60, 200, 128]));
        let piece = |tex: &str, hue: Option<f64>| {
            let mut o = CustomObject { parts: vec![Part { materials: vec![Material { base_tex: tex.into(), base_color: Color { r: 1.0, g: 1.0, b: 1.0, a: 0.5 }, ..Material::default() }], ..Part::default() }], ..CustomObject::default() };
            if let Some(h) = hue {
                o.studio.insert("hue".into(), serde_json::json!(h));
            }
            o
        };
        let mut chunks = vec![Chunk { custom_objects: vec![piece("Blue", Some(0.4)), piece("Blue", None), piece("Blue", Some(0.4)), piece("", Some(0.4))], ..Chunk::default() }];
        assert_eq!(bake(&mut chunks, &mut textures).unwrap(), 3);
        let m = |k: usize| chunks[0].custom_objects[k].parts[0].materials[0].clone();
        let (a, plain, b, flat) = (m(0), m(1), m(2), m(3));
        assert_eq!(plain.base_tex, "Blue");
        assert_ne!(a.base_tex, "Blue");
        assert_eq!(a.base_tex, b.base_tex, "one copy for both");
        assert_eq!(textures.len(), 2);
        assert_eq!(a.base_color.a, 0.5);
        let px = image::load_from_memory(textures[&a.base_tex].data.as_ref().unwrap()).unwrap().to_rgba8().get_pixel(0, 0).0;
        assert!(px[0] > px[1] && px[0] > px[2] && px[3] == 128, "red, its alpha kept: {px:?}");
        // white turned is white
        assert!((flat.base_color.r - 1.0).abs() < 1e-3 && (flat.base_color.g - 1.0).abs() < 1e-3);
    }

    /// The other adjustments as Photoshop has them: no Saturation is grey, Lightness all the way is white or black,
    /// Contrast all the way down is mid-grey; and a piece with only these is baked too.
    #[test]
    fn saturation_lightness_brightness_contrast() {
        let red = [0.8, 0.1, 0.1].map(to_linear);
        let a = |saturation, lightness, brightness, contrast| Adjust { hue: 0.0, saturation, lightness, brightness, contrast };
        let grey = adjusted(red, &a(-1.0, 0.0, 0.0, 0.0)).map(to_srgb);
        assert!((grey[0] - grey[1]).abs() < 1e-3 && (grey[1] - grey[2]).abs() < 1e-3, "{grey:?}");
        assert!(adjusted(red, &a(0.0, 1.0, 0.0, 0.0)).iter().all(|&v| (v - 1.0).abs() < 1e-3));
        assert!(adjusted(red, &a(0.0, -1.0, 0.0, 0.0)).iter().all(|&v| v.abs() < 1e-3));
        assert!(adjusted(red, &a(0.0, 0.0, 0.0, -1.0)).map(to_srgb).iter().all(|&v| (v - 0.5).abs() < 1e-3));
        let lighter = adjusted(red, &a(0.0, 0.0, 0.5, 0.0));
        assert!(lighter[0] > red[0] && lighter[1] > red[1]);
        let mut o = CustomObject::default();
        o.studio.insert("adjust".into(), serde_json::json!({ "saturation": -1.0 }));
        assert!(adjust_of(&o).is_some());
        assert!(adjust_of(&CustomObject::default()).is_none());
    }
}
