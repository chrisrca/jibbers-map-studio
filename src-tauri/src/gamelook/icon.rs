//! The game's mark (its icon), read from the player's own Jibbers.exe for the official features' cards: the studio
//! ships none of the game's art. A Windows program keeps its icon as resources: a group (RT_GROUP_ICON) listing each
//! size, each image (RT_ICON) a PNG or a bitmap.

use anyhow::{bail, Context, Result};
use image::{imageops::FilterType, RgbaImage};

const RT_ICON: u32 = 3;
const RT_GROUP_ICON: u32 = 14;

fn u16_at(b: &[u8], o: usize) -> Result<u16> {
    Ok(u16::from_le_bytes(b.get(o..o + 2).context("past the end")?.try_into()?))
}

fn u32_at(b: &[u8], o: usize) -> Result<u32> {
    Ok(u32::from_le_bytes(b.get(o..o + 4).context("past the end")?.try_into()?))
}

/// The program's resources: where their section is in the file, to find each one's bytes by its address.
struct Resources<'a> {
    b: &'a [u8],
    /// the resource directory's place in the file
    root: usize,
    /// (address, size, place in the file) of each section
    sections: Vec<(u32, u32, u32)>,
}

impl<'a> Resources<'a> {
    fn read(b: &'a [u8]) -> Result<Self> {
        let pe = u32_at(b, 0x3c)? as usize;
        if b.get(pe..pe + 4) != Some(b"PE\0\0") {
            bail!("not a Windows program");
        }
        let coff = pe + 4;
        let n_sections = u16_at(b, coff + 2)? as usize;
        let opt = coff + 20;
        let opt_size = u16_at(b, coff + 16)? as usize;
        // (the data directories: after 96 bytes in a 32-bit program's header, 112 in a 64-bit one's; resources third)
        let dirs = opt + if u16_at(b, opt)? == 0x20b { 112 } else { 96 };
        let rsrc = u32_at(b, dirs + 2 * 8)?;
        let sections = (0..n_sections)
            .map(|i| {
                let s = opt + opt_size + i * 40;
                Ok((u32_at(b, s + 12)?, u32_at(b, s + 8)?.max(u32_at(b, s + 16)?), u32_at(b, s + 20)?))
            })
            .collect::<Result<Vec<_>>>()?;
        let mut r = Resources { b, root: 0, sections };
        r.root = r.at(rsrc).context("no resources")?;
        Ok(r)
    }

    /// An address's place in the file.
    fn at(&self, rva: u32) -> Option<usize> {
        self.sections.iter().find(|(va, size, _)| rva >= *va && rva < va + size).map(|(va, _, raw)| (rva - va + raw) as usize)
    }

    /// A directory's entries: (id, its subdirectory or data entry, whether it's a directory), named ones left out.
    fn entries(&self, dir: usize) -> Result<Vec<(u32, usize, bool)>> {
        let named = u16_at(self.b, dir + 12)? as usize;
        let ids = u16_at(self.b, dir + 14)? as usize;
        (named..named + ids)
            .map(|k| {
                let e = dir + 16 + k * 8;
                let off = u32_at(self.b, e + 4)?;
                Ok((u32_at(self.b, e)?, self.root + (off & 0x7fff_ffff) as usize, off & 0x8000_0000 != 0))
            })
            .collect()
    }

    /// Every resource of a type: (id, its bytes), the first language of each.
    fn of_type(&self, ty: u32) -> Result<Vec<(u32, &'a [u8])>> {
        let mut out = vec![];
        let Some(&(_, d, true)) = self.entries(self.root)?.iter().find(|(id, _, dir)| *id == ty && *dir) else { return Ok(out) };
        for (id, sub, is_dir) in self.entries(d)? {
            let data = if is_dir { self.entries(sub)?.first().map(|e| e.1) } else { Some(sub) };
            let Some(data) = data else { continue };
            let (rva, size) = (u32_at(self.b, data)?, u32_at(self.b, data + 4)? as usize);
            let Some(at) = self.at(rva) else { continue };
            if let Some(bytes) = self.b.get(at..at + size) {
                out.push((id, bytes));
            }
        }
        Ok(out)
    }
}

/// An icon image as pixels: a PNG, or a 32-bit bitmap (rows from the bottom, blue first, its alpha used).
fn decode(img: &[u8]) -> Result<RgbaImage> {
    if img.starts_with(b"\x89PNG") {
        return Ok(image::load_from_memory(img)?.to_rgba8());
    }
    let header = u32_at(img, 0)? as usize;
    let (w, h2, bits) = (u32_at(img, 4)? as usize, u32_at(img, 8)? as usize, u16_at(img, 14)?);
    if bits != 32 {
        bail!("a {bits}-bit icon");
    }
    let h = h2 / 2;
    let mut out = RgbaImage::new(w as u32, h as u32);
    for y in 0..h {
        for x in 0..w {
            let o = header + ((h - 1 - y) * w + x) * 4;
            let p = img.get(o..o + 4).context("short icon")?;
            out.put_pixel(x as u32, y as u32, image::Rgba([p[2], p[1], p[0], p[3]]));
        }
    }
    Ok(out)
}

/// The game's mark as a PNG, `size` a side: its biggest icon, trimmed to what's drawn and centred. None without the
/// game.
pub fn mark(size: u32) -> Result<Option<Vec<u8>>> {
    let Some(exe) = crate::game::find_game() else { return Ok(None) };
    let b = std::fs::read(&exe).with_context(|| exe.display().to_string())?;
    let res = Resources::read(&b)?;
    let images = res.of_type(RT_ICON)?;
    // the sizes the group lists, biggest first (a width of 0 is 256)
    let mut sizes: Vec<(u32, u32)> = vec![];
    for (_, g) in res.of_type(RT_GROUP_ICON)? {
        for k in 0..u16_at(g, 4)? as usize {
            let e = 6 + k * 14;
            let w = match g.get(e) { Some(0) => 256, Some(&w) => w as u32, None => continue };
            sizes.push((w, u16_at(g, e + 12)? as u32));
        }
    }
    sizes.sort_by_key(|s| std::cmp::Reverse(s.0));
    let Some(full) = sizes.iter().find_map(|(_, id)| images.iter().find(|(i, _)| i == id).and_then(|(_, b)| decode(b).ok())) else { return Ok(None) };
    // trimmed to what's drawn, on a square
    let (mut x0, mut y0, mut x1, mut y1) = (u32::MAX, u32::MAX, 0, 0);
    for (x, y, p) in full.enumerate_pixels() {
        if p[3] > 0 {
            (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x + 1), y1.max(y + 1));
        }
    }
    if x0 >= x1 {
        return Ok(None);
    }
    let (w, h) = (x1 - x0, y1 - y0);
    let side = w.max(h);
    let mut sq = RgbaImage::new(side, side);
    image::imageops::overlay(&mut sq, &image::imageops::crop_imm(&full, x0, y0, w, h).to_image(), ((side - w) / 2) as i64, ((side - h) / 2) as i64);
    let out = image::imageops::resize(&sq, size, size, FilterType::Lanczos3);
    let mut png = vec![];
    out.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)?;
    Ok(Some(png))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (with the game installed) its mark comes out drawn: some of it see-through, some not
    #[test]
    #[ignore]
    fn reads_the_games_mark() {
        let png = mark(64).unwrap().expect("the game's icon");
        let im = image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!(im.dimensions(), (64, 64));
        let drawn = im.pixels().filter(|p| p[3] > 128).count();
        assert!(drawn > 100 && drawn < 64 * 64 - 100, "{drawn}");
    }
}
