//! Textures as Unity has them once imported: an image file read and sized by its importer's settings ( its .meta:
//! the platform's max size, power-of-two rounding, colour space, mipmaps, compression ), or a Texture2D kept in an
//! asset decoded from its pixels. Rows top down, as a PNG of it has them ( Map-Tools' PNGs are, and an image file is;
//! a Texture2D's own pixels start at the bottom ).

use std::path::Path;

use anyhow::{bail, Context, Result};
use image::imageops::FilterType;

use super::value::Value;
use super::yaml;

pub struct Image {
    pub w: u32,
    pub h: u32,
    /// RGBA, rows from the top.
    pub rgba: Vec<u8>,
}

/// A texture and how Map-Tools' TextureData describes it.
pub struct Imported {
    pub image: Image,
    pub linear: bool,
    pub mipmaps: bool,
    /// 0 uncompressed, 1 normal, 2 high quality.
    pub compression: i32,
}

/// A .meta file's settings ( the importer's, under its type's name ).
pub fn meta(asset: &Path) -> Value {
    let mut p = asset.as_os_str().to_owned();
    p.push(".meta");
    std::fs::read_to_string(&p).map(|s| yaml::parse_plain(&s)).unwrap_or(Value::Null)
}

/// An image file imported as Unity's TextureImporter would ( the Standalone platform's settings, if they're its own,
/// else the default's ).
pub fn from_source(path: &Path) -> Result<Imported> {
    let m = meta(path);
    let ti = m.get("TextureImporter");
    let platforms = ti.get("platformSettings").list();
    let pick = platforms
        .iter()
        .find(|p| p.get("buildTarget").str() == "Standalone" && p.get("overridden").bool())
        .or_else(|| platforms.iter().find(|p| p.get("buildTarget").str() == "DefaultTexturePlatform"));
    let max = pick.map(|p| p.get("maxTextureSize").i32_or(2048)).unwrap_or(ti.get("maxTextureSize").i32_or(2048)).max(32) as u32;
    let compression = match pick.map(|p| p.get("textureCompression").i32_or(1)).unwrap_or(1) {
        0 => 0,
        2 => 2,
        _ => 1,
    };
    let img = image::open(path).with_context(|| format!("reading {}", path.display()))?.to_rgba8();
    let (mut w, mut h) = img.dimensions();
    // ( not a power of two: to the nearest, larger or smaller one, as set )
    let npot = ti.get("nPOTScale").i32_or(1);
    let pot = |v: u32| -> u32 {
        if v.is_power_of_two() {
            return v;
        }
        let up = v.next_power_of_two();
        let down = up / 2;
        match npot {
            2 => up,
            3 => down.max(1),
            _ => if v - down < up - v { down.max(1) } else { up },
        }
    };
    if npot != 0 && ti.get("textureType").i32() != 8 {
        w = pot(w);
        h = pot(h);
    }
    while w.max(h) > max {
        w = (w / 2).max(1);
        h = (h / 2).max(1);
    }
    let img = if (w, h) != img.dimensions() { image::imageops::resize(&img, w, h, FilterType::CatmullRom) } else { img };
    let rgba = img.into_raw();
    Ok(Imported {
        image: Image { w, h, rgba },
        linear: !ti.get("mipmaps").get("sRGBTexture").bool_or(true),
        mipmaps: ti.get("mipmaps").get("enableMipMap").bool_or(true),
        compression,
    })
}

pub fn flip_rows(rgba: &mut [u8], row: usize) {
    let n = rgba.len() / row;
    for y in 0..n / 2 {
        let (a, b) = rgba.split_at_mut((n - 1 - y) * row);
        a[y * row..(y + 1) * row].swap_with_slice(&mut b[..row]);
    }
}

/// A Texture2D kept in an asset ( or a scene ): its top mip decoded from the format it's stored in.
pub fn from_object(v: &Value) -> Result<Image> {
    let (w, h) = (v.get("m_Width").i32().max(0) as u32, v.get("m_Height").i32().max(0) as u32);
    let data = pixels(v);
    let n = (w * h) as usize;
    let fmt = v.get("m_TextureFormat").i32();
    if let Some(mut rgba) = compressed(fmt, &data, w as usize, h as usize)? {
        flip_rows(&mut rgba, w as usize * 4);
        return Ok(Image { w, h, rgba });
    }
    let px = |i: usize, f: &dyn Fn(usize) -> [u8; 4]| -> [u8; 4] { f(i) };
    let mut out = vec![0u8; n * 4];
    let need = |b: usize| -> Result<()> {
        if data.len() < n * b {
            bail!("texture data is short ( {} of {} bytes )", data.len(), n * b);
        }
        Ok(())
    };
    let half = |b: &[u8]| -> f32 { half_to_f32(u16::from_le_bytes([b[0], b[1]])) };
    let unit = |f: f32| (f.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
    let read: Box<dyn Fn(usize) -> [u8; 4]> = match fmt {
        1 => {
            need(1)?;
            Box::new(|i| [255, 255, 255, data[i]])
        }
        3 => {
            need(3)?;
            Box::new(|i| [data[i * 3], data[i * 3 + 1], data[i * 3 + 2], 255])
        }
        4 => {
            need(4)?;
            Box::new(|i| [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]])
        }
        5 => {
            need(4)?;
            Box::new(|i| [data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3], data[i * 4]])
        }
        14 => {
            need(4)?;
            Box::new(|i| [data[i * 4 + 2], data[i * 4 + 1], data[i * 4], data[i * 4 + 3]])
        }
        63 => {
            need(1)?;
            Box::new(|i| [data[i], 0, 0, 255])
        }
        62 => {
            need(2)?;
            Box::new(|i| [data[i * 2], data[i * 2 + 1], 0, 255])
        }
        15 => {
            need(2)?;
            Box::new(move |i| [unit(half(&data[i * 2..])), 0, 0, 255])
        }
        17 => {
            need(8)?;
            Box::new(move |i| [0, 1, 2, 3].map(|c| unit(half(&data[i * 8 + c * 2..]))))
        }
        18 => {
            need(4)?;
            Box::new(move |i| [unit(f32::from_le_bytes(data[i * 4..i * 4 + 4].try_into().unwrap())), 0, 0, 255])
        }
        20 => {
            need(16)?;
            Box::new(move |i| [0, 1, 2, 3].map(|c| unit(f32::from_le_bytes(data[i * 16 + c * 4..i * 16 + c * 4 + 4].try_into().unwrap()))))
        }
        other => bail!("texture format {other} isn't read"),
    };
    for i in 0..n {
        out[i * 4..i * 4 + 4].copy_from_slice(&px(i, &*read));
    }
    flip_rows(&mut out, w as usize * 4);
    Ok(Image { w, h, rgba: out })
}

/// A Texture2D's pixel bytes ( a binary file keeps them under "image data", a text one gives their count there and the
/// bytes in _typelessdata ).
pub fn pixels(v: &Value) -> Vec<u8> {
    match v.get("image data") {
        b @ (Value::Bytes(_) | Value::Prims(..)) => b.bytes(),
        _ if !v.get("_typelessdata").is_null() => v.get("_typelessdata").bytes(),
        _ => v.get("m_ImageData").bytes(),
    }
}

/// An RFloat Texture2D's values ( a formation baseline: heights 0..1 ), rows from the bottom as Unity keeps them.
pub fn floats(v: &Value) -> Option<Vec<f32>> {
    if v.get("m_TextureFormat").i32() != 18 {
        return None;
    }
    let n = (v.get("m_Width").i32().max(0) * v.get("m_Height").i32().max(0)) as usize;
    let b = pixels(v);
    if b.len() < n * 4 {
        return None;
    }
    Some((0..n).map(|i| f32::from_le_bytes(b[i * 4..i * 4 + 4].try_into().unwrap())).collect())
}

/// A compressed texture's top mip ( Unity's TextureFormat ), decoded, rows as stored ( None: not a compressed one ).
fn compressed(fmt: i32, data: &[u8], w: usize, h: usize) -> Result<Option<Vec<u8>>> {
    use texture2ddecoder as t;
    let mut px = vec![0u32; w * h];
    let r: std::result::Result<(), &str> = match fmt {
        10 => t::decode_bc1(data, w, h, &mut px),
        12 => t::decode_bc3(data, w, h, &mut px),
        24 => t::decode_bc6_unsigned(data, w, h, &mut px),
        25 => t::decode_bc7(data, w, h, &mut px),
        26 => t::decode_bc4(data, w, h, &mut px),
        27 => t::decode_bc5(data, w, h, &mut px),
        28 | 29 | 64 | 65 => t::decode_unity_crunch(data, w, h, &mut px),
        34 => t::decode_etc1(data, w, h, &mut px),
        41 => t::decode_eacr(data, w, h, &mut px),
        42 => t::decode_eacr_signed(data, w, h, &mut px),
        43 => t::decode_eacrg(data, w, h, &mut px),
        44 => t::decode_eacrg_signed(data, w, h, &mut px),
        45 => t::decode_etc2_rgb(data, w, h, &mut px),
        46 => t::decode_etc2_rgba1(data, w, h, &mut px),
        47 => t::decode_etc2_rgba8(data, w, h, &mut px),
        48..=53 | 54..=59 => {
            let b = [4, 5, 6, 8, 10, 12][((fmt - 48) % 6) as usize];
            t::decode_astc(data, w, h, b, b, &mut px)
        }
        // 16-bit packed colours
        2 | 7 | 13 => {
            if data.len() < w * h * 2 {
                bail!("texture data is short");
            }
            let mut out = Vec::with_capacity(w * h * 4);
            for i in 0..w * h {
                let v = u16::from_le_bytes([data[i * 2], data[i * 2 + 1]]) as u32;
                let e4 = |x: u32| ((x & 15) * 17) as u8;
                out.extend(match fmt {
                    7 => [(((v >> 11) & 31) * 255 / 31) as u8, (((v >> 5) & 63) * 255 / 63) as u8, ((v & 31) * 255 / 31) as u8, 255],
                    13 => [e4(v >> 12), e4(v >> 8), e4(v >> 4), e4(v)],
                    _ => [e4(v >> 8), e4(v >> 4), e4(v), e4(v >> 12)],
                });
            }
            return Ok(Some(out));
        }
        _ => return Ok(None),
    };
    r.map_err(|e| anyhow::anyhow!("compressed texture ( format {fmt} ): {e}"))?;
    // ( its pixels as bytes b, g, r, a )
    Ok(Some(px.iter().flat_map(|p| { let b = p.to_le_bytes(); [b[2], b[1], b[0], b[3]] }).collect()))
}

fn half_to_f32(h: u16) -> f32 {
    let s = if h & 0x8000 != 0 { -1.0 } else { 1.0 };
    let e = ((h >> 10) & 0x1f) as i32;
    let m = (h & 0x3ff) as f32;
    s * match e {
        0 => m * 2f32.powi(-24),
        31 => f32::INFINITY,
        _ => (1.0 + m / 1024.0) * 2f32.powi(e - 15),
    }
}
