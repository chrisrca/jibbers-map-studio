//! The game's textures decoded: BC1 / BC3 blocks, half floats, and normal maps unpacked (their X kept in the alpha).

use super::*;

/// Bytes a vertex component takes (Unity 2019+ formats: float, half, unorm8, snorm8, unorm16, snorm16, uint8, sint8,
/// uint16, sint16, uint32, sint32).
pub(crate) fn comp_size(format: u8) -> usize {
    match format {
        0 | 10 | 11 => 4,
        1 | 4 | 5 | 8 | 9 => 2,
        _ => 1,
    }
}

pub(crate) fn component_value(format: u8, b: &[u8]) -> f32 {
    match format {
        0 => f32::from_le_bytes(b.try_into().unwrap()),
        1 => half(u16::from_le_bytes(b.try_into().unwrap())),
        2 => b[0] as f32 / 255.0,
        3 => (b[0] as i8 as f32 / 127.0).max(-1.0),
        4 => u16::from_le_bytes(b.try_into().unwrap()) as f32 / 65535.0,
        5 => (i16::from_le_bytes(b.try_into().unwrap()) as f32 / 32767.0).max(-1.0),
        6 => b[0] as f32,
        7 => b[0] as i8 as f32,
        8 => u16::from_le_bytes(b.try_into().unwrap()) as f32,
        9 => i16::from_le_bytes(b.try_into().unwrap()) as f32,
        10 => u32::from_le_bytes(b.try_into().unwrap()) as f32,
        _ => i32::from_le_bytes(b.try_into().unwrap()) as f32,
    }
}

/// A half float as a float.
pub(crate) fn half(h: u16) -> f32 {
    let s = ((h >> 15) as u32) << 31;
    let e = ((h >> 10) & 0x1f) as u32;
    let m = (h & 0x3ff) as u32;
    let bits = if e == 0 {
        if m == 0 {
            s
        } else {
            // subnormal
            let mut e = 127 - 15 + 1;
            let mut m = m;
            while m & 0x400 == 0 {
                m <<= 1;
                e -= 1;
            }
            s | (e << 23) | ((m & 0x3ff) << 13)
        }
    } else if e == 31 {
        s | 0x7f80_0000 | (m << 13)
    } else {
        s | ((e + 127 - 15) << 23) | (m << 13)
    };
    f32::from_bits(bits)
}

/// A texture's most detailed level as RGBA, the right way up (Unity stores rows bottom first). The game's: DXT1,
/// DXT5, RGBA32, RGB24 (others: None).
pub fn decode_texture(g: &Game, t: &V) -> Result<Option<RgbaImage>> {
    let (w, h) = (t.get("m_Width").i() as u32, t.get("m_Height").i() as u32);
    let format = t.get("m_TextureFormat").i();
    let streamed = g.streamed(t.get("m_StreamData"))?;
    let data: &[u8] = streamed.as_deref().unwrap_or(t.get("image data").bytes());
    if w == 0 || h == 0 {
        return Ok(None);
    }
    let mut img = RgbaImage::new(w, h);
    match format {
        // RGB24, RGBA32
        3 | 4 => {
            let k = if format == 3 { 3 } else { 4 };
            for (i, px) in img.pixels_mut().enumerate() {
                let p = data.get(i * k..i * k + k).context("texture data too short")?;
                *px = image::Rgba([p[0], p[1], p[2], if k == 4 { p[3] } else { 255 }]);
            }
        }
        // DXT1 (BC1), DXT5 (BC3)
        10 | 12 => {
            let block = if format == 10 { 8 } else { 16 };
            let (bw, bh) = (w.div_ceil(4), h.div_ceil(4));
            for by in 0..bh {
                for bx in 0..bw {
                    let o = ((by * bw + bx) * block) as usize;
                    let b = data.get(o..o + block as usize).context("texture data too short")?;
                    let (alpha, colour) = if block == 16 { (Some(&b[..8]), &b[8..]) } else { (None, b) };
                    let px = bc_block(colour, alpha, block == 8);
                    for (k, p) in px.iter().enumerate() {
                        let (x, y) = (bx * 4 + k as u32 % 4, by * 4 + k as u32 / 4);
                        if x < w && y < h {
                            img.put_pixel(x, y, image::Rgba(*p));
                        }
                    }
                }
            }
        }
        _ => {
            eprintln!("game look: texture format {format} not read");
            return Ok(None);
        }
    }
    Ok(Some(image::imageops::flip_vertical(&img)))
}

/// A 4x4 block of BC1 colour (with BC3's alpha block before it when there is one).
pub(crate) fn bc_block(c: &[u8], alpha: Option<&[u8]>, bc1: bool) -> [[u8; 4]; 16] {
    let c0 = u16::from_le_bytes([c[0], c[1]]);
    let c1 = u16::from_le_bytes([c[2], c[3]]);
    let rgb = |v: u16| -> [i32; 3] {
        let (r, g, b) = ((v >> 11) & 31, (v >> 5) & 63, v & 31);
        [(r as i32 * 255 + 15) / 31, (g as i32 * 255 + 31) / 63, (b as i32 * 255 + 15) / 31]
    };
    let (a, b) = (rgb(c0), rgb(c1));
    let mut pal = [[0u8; 4]; 4];
    pal[0] = [a[0] as u8, a[1] as u8, a[2] as u8, 255];
    pal[1] = [b[0] as u8, b[1] as u8, b[2] as u8, 255];
    if c0 > c1 || !bc1 {
        for i in 0..3 {
            pal[2][i] = ((2 * a[i] + b[i]) / 3) as u8;
            pal[3][i] = ((a[i] + 2 * b[i]) / 3) as u8;
        }
        pal[2][3] = 255;
        pal[3][3] = 255;
    } else {
        for i in 0..3 {
            pal[2][i] = ((a[i] + b[i]) / 2) as u8;
        }
        pal[2][3] = 255;
        pal[3] = [0, 0, 0, 0];
    }
    let bits = u32::from_le_bytes([c[4], c[5], c[6], c[7]]);
    let mut out = [[0u8; 4]; 16];
    for (k, o) in out.iter_mut().enumerate() {
        *o = pal[((bits >> (2 * k)) & 3) as usize];
    }
    if let Some(al) = alpha {
        let (a0, a1) = (al[0] as i32, al[1] as i32);
        let mut ap = [0i32; 8];
        ap[0] = a0;
        ap[1] = a1;
        if a0 > a1 {
            for i in 1..7i32 {
                ap[i as usize + 1] = ((7 - i) * a0 + i * a1) / 7;
            }
        } else {
            for i in 1..5i32 {
                ap[i as usize + 1] = ((5 - i) * a0 + i * a1) / 5;
            }
            ap[6] = 0;
            ap[7] = 255;
        }
        let mut idx: u64 = 0;
        for (i, &x) in al[2..8].iter().enumerate() {
            idx |= (x as u64) << (8 * i);
        }
        for (k, o) in out.iter_mut().enumerate() {
            o[3] = ap[((idx >> (3 * k)) & 7) as usize] as u8;
        }
    }
    out
}

/// A normal map as plain RGB (x, y, z). Most of the game's are stored the way Unity compresses normal maps: x in
/// alpha, y in green (red 1, blue a copy of green) — read as RGB, every surface comes out tilted. z is worked out.
pub(crate) fn unpack_normal(img: &RgbaImage) -> RgbImage {
    let n = (img.width() * img.height()).max(1) as f64;
    let (mut red, mut a_sum, mut a_sq, mut bg) = (0.0, 0.0, 0.0, 0.0);
    for p in img.pixels() {
        let a = p[3] as f64 / 255.0;
        red += p[0] as f64 / 255.0;
        a_sum += a;
        a_sq += a * a;
        bg += (p[2] as f64 - p[1] as f64).abs() / 255.0;
    }
    let a_mean = a_sum / n;
    let a_std = (a_sq / n - a_mean * a_mean).max(0.0).sqrt();
    let packed = red / n > 0.98 && a_std > 0.002 && bg / n < 0.02;
    RgbImage::from_fn(img.width(), img.height(), |x, y| {
        let p = img.get_pixel(x, y);
        if !packed {
            return image::Rgb([p[0], p[1], p[2]]);
        }
        let (nx, ny) = (p[3] as f64 / 255.0 * 2.0 - 1.0, p[1] as f64 / 255.0 * 2.0 - 1.0);
        let nz = (1.0 - nx * nx - ny * ny).clamp(0.0, 1.0).sqrt();
        let c = |v: f64| ((v * 0.5 + 0.5) * 255.0 + 0.5).clamp(0.0, 255.0) as u8;
        image::Rgb([c(nx), c(ny), c(nz)])
    })
}
