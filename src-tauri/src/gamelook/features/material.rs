//! A renderer's material as a piece's (Custom/CustomObjectLit): the game's maps with its numbers baked in (Custom/
//! MapObject's maths), painted the feature's colour.

use super::*;

/// Longest side a map's colour paint is kept at, and its other maps (detail that reads at a distance needs less).
pub(crate) const BASE_MAX: u32 = 1024;

pub(crate) const DETAIL_MAX: u32 = 512;

/** A texture's pixels, or the one value it has all over (then the material's number does instead). */
pub(crate) enum Tex {
    None,
    /// its red channel's stored byte
    Flat(u8),
    Image(image::RgbaImage),
}

pub(crate) fn load_tex(look: &Path, file: &Option<String>, max: u32) -> Result<Tex> {
    let Some(file) = file else { return Ok(Tex::None) };
    let img = image::load_from_memory(&std::fs::read(look.join(file)).with_context(|| file.clone())?)?.to_rgba8();
    // one value all over (to a couple of levels): no need to carry the picture
    let first = img.get_pixel(0, 0).0;
    if img.pixels().all(|p| (0..3).all(|k| (p[k] as i32 - first[k] as i32).abs() <= 2)) {
        return Ok(Tex::Flat(first[0]));
    }
    let (w, h) = img.dimensions();
    Ok(Tex::Image(if w.max(h) > max {
        let s = max as f32 / w.max(h) as f32;
        image::imageops::resize(&img, ((w as f32 * s) as u32).max(1), ((h as f32 * s) as u32).max(1), image::imageops::FilterType::Triangle)
    } else {
        img
    }))
}

pub(crate) fn png(img: &image::RgbaImage) -> Result<Vec<u8>> {
    let mut out = vec![];
    img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)?;
    Ok(out)
}

/// A stored byte as the game's shader gets it: as it is, or decoded from sRGB.
pub(crate) fn shader_value(byte: u8, linear: bool) -> f32 {
    let v = byte as f32 / 255.0;
    if linear {
        v
    } else if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

/// A grey map with each value (as the shader gets it) times `k`, stored as plain values.
pub(crate) fn times(img: &image::RgbaImage, linear: bool, k: f32) -> image::RgbaImage {
    let mut out = img.clone();
    for p in out.pixels_mut() {
        let v = ((shader_value(p[0], linear) * k).clamp(0.0, 1.0) * 255.0).round() as u8;
        *p = image::Rgba([v, v, v, 255]);
    }
    out
}

pub(crate) fn material(look: &Path, m: &LookMaterial, colour: Option<u32>, textures: &mut IndexMap<String, TextureData>) -> Result<Material> {
    // the piece's colour as a turn of the paint's hue, from the game's own blue (white and black: no colour, lighter
    // or darker)
    let (turn, sat, bright) = match colour {
        Some(hex) => {
            let (h, s, l) = hsl(hex);
            if s < 0.25 { (0.0, 0.0, if l > 0.5 { 1.6 } else { 0.5 }) } else { (h - hsl(BLUE).0, 1.0, 1.0) }
        }
        None => (0.0, 1.0, 1.0),
    };
    let turn = (turn + m.hue_shift).rem_euclid(1.0);
    let turn = if !(1e-3..=1.0 - 1e-3).contains(&turn) { 0.0 } else { turn };
    // (the game's brightness multiplies what its shader draws, in linear light: ×2 there is ×1.37 to the paint's
    // stored values, not ×2 — which burnt the paint to flat blue)
    let light = m.brightness;
    // what it's shown as: the game's material name, the map, and the piece's colour when it was painted in one
    let colour_name = colour.and_then(|hex| NAMED.iter().find(|(_, h)| *h == hex)).map(|(n, _)| readable(n));
    let mut put = |file: &Option<String>, img: &image::RgbaImage, linear: bool, suffix: &str, map: &str| -> Result<String> {
        let stem = Path::new(file.as_deref().unwrap_or("")).file_stem().unwrap_or_default().to_string_lossy().to_string();
        let mut label = readable(&m.name);
        if !map.is_empty() {
            label = format!("{label} {map}");
        }
        if map.is_empty() && turn + (1.0f32 - sat).abs() + (1.0f32 - bright).abs() + (1.0f32 - light).abs() > 1e-3 {
            if let Some(c) = &colour_name {
                label = format!("{label} ({c})");
            }
        }
        // (the key's middle keeps it apart from every other: the same name can be different pixels)
        let key = format!("GameLook/{stem}{suffix}/{label}");
        if !textures.contains_key(&key) {
            let data = png(img)?;
            textures.insert(key.clone(), TextureData { format: 4, width: img.width() as i32, height: img.height() as i32, encoding: "png".into(), linear, mipmaps: true, compression: 1, data: Some(data) });
        }
        Ok(key)
    };
    let mut mat = Material {
        render_mode: if m.cutoff.is_some() { 1 } else { 0 },
        alpha_cutoff: m.cutoff.unwrap_or(0.5),
        cull_mode: if m.double_sided { 0 } else { 2 },
        base_color: Color::WHITE,
        ..Material::default()
    };
    // (the colour spaces the game gives its textures: colour paint sRGB, the rest as stated)
    let linear = |map: &str, otherwise: bool| m.linear.get(map).copied().unwrap_or(otherwise);
    let painted = turn != 0.0 || sat != 1.0 || bright != 1.0 || light != 1.0;
    match load_tex(look, &m.base, BASE_MAX)? {
        Tex::Image(img) => {
            let img = if painted { repaint(img, turn, sat, bright, light) } else { img };
            let suffix = if painted { format!("-{:.0}-{:.0}-{:.0}-L{:.0}", turn * 100.0, sat * 100.0, bright * 100.0, light * 100.0) } else { String::new() };
            mat.base_tex = put(&m.base, &img, linear("base", false), &suffix, "")?;
        }
        Tex::Flat(v) => {
            let c = repaint(image::RgbaImage::from_pixel(1, 1, image::Rgba([v; 4])), turn, sat, bright, light);
            let p = c.get_pixel(0, 0).0;
            mat.base_color = Color { r: p[0] as f32 / 255.0, g: p[1] as f32 / 255.0, b: p[2] as f32 / 255.0, a: 1.0 };
        }
        Tex::None => {}
    }
    // (written out as plain directions by the extraction; flat: no bumps to show)
    if let Tex::Image(img) = load_tex(look, &m.normal, DETAIL_MAX)? {
        mat.normal_tex = put(&m.normal, &img, true, "", "Normal")?;
    }
    // its glow, as the game's (both shaders add the emission map times its colour)
    if let Some(c) = m.emission_color {
        let k = match load_tex(look, &m.emit, BASE_MAX)? {
            Tex::Image(img) => {
                mat.emission_tex = put(&m.emit, &img, linear("emit", false), "", "Emission")?;
                1.0
            }
            Tex::Flat(v) => shader_value(v, linear("emit", false)),
            Tex::None => 1.0,
        };
        mat.emission_color = Color { r: c[0] * k, g: c[1] * k, b: c[2] * k, a: 1.0 };
    }
    let (metal, rough) = (load_tex(look, &m.metal, DETAIL_MAX)?, load_tex(look, &m.rough, DETAIL_MAX)?);
    if m.shader == "Custom/CustomObjectLit" {
        // already drawn the way pieces are: as it is
        mat.metallic = m.metallic;
        mat.smoothness = m.smoothness;
        match metal {
            Tex::Image(img) => mat.metallic_tex = put(&m.metal, &img, linear("metal", true), "", "Metallic")?,
            Tex::Flat(v) => mat.metallic = (shader_value(v, linear("metal", true)) + m.metallic).clamp(0.0, 1.0),
            Tex::None => {}
        }
        match rough {
            Tex::Image(img) => mat.roughness_tex = put(&m.rough, &img, linear("rough", true), "", "Roughness")?,
            Tex::Flat(v) => mat.smoothness = (1.0 - shader_value(v, linear("rough", true)) + m.smoothness).clamp(0.0, 1.0),
            Tex::None => {}
        }
        return Ok(mat);
    }
    // The game draws its own features (Custom/MapObject) with metallic = metal map × _Metallic and smoothness =
    // 1 − roughness map × _Roughness, a missing map counting as white. Pieces are drawn with Custom/CustomObjectLit,
    // which adds instead: metallic = metal map + Metallic, smoothness = 1 − roughness map + Smoothness (missing: black
    // metal, white roughness). So the game's numbers go into the maps (as the shader reads them), the piece's
    // numbers stay 0, and the same values come out.
    match metal {
        Tex::Image(img) if m.metallic > 0.0 => {
            mat.metallic_tex = put(&m.metal, &times(&img, linear("metal", false), m.metallic), true, &format!("-x{:.0}", m.metallic * 100.0), "Metallic")?
        }
        Tex::Image(_) => {} // times nothing: no metal
        Tex::Flat(v) => mat.metallic = shader_value(v, linear("metal", false)) * m.metallic,
        Tex::None => mat.metallic = m.metallic,
    }
    match rough {
        Tex::Image(img) => mat.roughness_tex = put(&m.rough, &times(&img, linear("rough", false), m.roughness), true, &format!("-x{:.0}", m.roughness * 100.0), "Roughness")?,
        Tex::Flat(v) => mat.smoothness = (1.0 - shader_value(v, linear("rough", false)) * m.roughness).clamp(0.0, 1.0),
        Tex::None => mat.smoothness = (1.0 - m.roughness).clamp(0.0, 1.0),
    }
    Ok(mat)
}

pub(crate) fn hsl(hex: u32) -> (f32, f32, f32) {
    let c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(|v| v as f32 / 255.0);
    let (mx, mn) = (c.iter().cloned().fold(0.0, f32::max), c.iter().cloned().fold(1.0, f32::min));
    let l = (mx + mn) / 2.0;
    if mx == mn {
        return (0.0, 0.0, l);
    }
    let d = mx - mn;
    let s = if l > 0.5 { d / (2.0 - mx - mn) } else { d / (mx + mn) };
    let h = if mx == c[0] { (c[1] - c[2]) / d + if c[1] < c[2] { 6.0 } else { 0.0 } } else if mx == c[1] { (c[2] - c[0]) / d + 2.0 } else { (c[0] - c[1]) / d + 4.0 };
    (h / 6.0, s, l)
}

/// The paint turned round the colour wheel by `turn` (0..1), its colour kept to `sat`, its stored values times
/// `bright` (a piece's white or black), and its light times `light` (the game's MapObject brightness, in linear).
pub(crate) fn repaint(mut img: image::RgbaImage, turn: f32, sat: f32, bright: f32, light: f32) -> image::RgbaImage {
    let to_linear = |c: f32| if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) };
    let to_srgb = |c: f32| if c <= 0.0031308 { c * 12.92 } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 };
    for p in img.pixels_mut() {
        let [r, g, b] = [p[0], p[1], p[2]].map(|v| v as f32 / 255.0);
        let (mx, mn) = (r.max(g).max(b), r.min(g).min(b));
        let v = mx;
        let s = if mx > 0.0 { (mx - mn) / mx } else { 0.0 } * sat;
        let mut hh = if mx == mn {
            0.0
        } else if mx == r {
            ((g - b) / (mx - mn)).rem_euclid(6.0)
        } else if mx == g {
            (b - r) / (mx - mn) + 2.0
        } else {
            (r - g) / (mx - mn) + 4.0
        } / 6.0;
        hh = (hh + turn).rem_euclid(1.0);
        // back to RGB
        let i = (hh * 6.0).floor();
        let f = hh * 6.0 - i;
        let (pv, qv, tv) = (v * (1.0 - s), v * (1.0 - f * s), v * (1.0 - (1.0 - f) * s));
        let (r2, g2, b2) = match i as i32 % 6 {
            0 => (v, tv, pv),
            1 => (qv, v, pv),
            2 => (pv, v, tv),
            3 => (pv, qv, v),
            4 => (tv, pv, v),
            _ => (v, pv, qv),
        };
        for (k, c) in [r2, g2, b2].into_iter().enumerate() {
            let c = (c * bright).clamp(0.0, 1.0);
            let c = if light == 1.0 { c } else { to_srgb((to_linear(c) * light).clamp(0.0, 1.0)) };
            p[k] = (c * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
    img
}
