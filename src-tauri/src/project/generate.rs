//! New-map terrain generation (parallel). Mirrors src/terrain/generate.ts so previews and results
//! agree; the TS version remains for tests and small edits.

use rayon::prelude::*;
use serde::Deserialize;

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Base {
    Slope,
    Hills,
    Mountain,
    Flat,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GenOptions {
    pub radius: i32,
    pub ring_res: Vec<i32>,
    pub chunk_size: f32,
    pub base: Base,
    pub slope_deg: f32,
    pub height_range: f32,
    pub seed: i32,
}

/// Headroom kept below/above generated terrain so sculpting has room to dig and build.
const BELOW: f32 = 60.0;
const ABOVE: f32 = 200.0;
const MIN_RANGE: f32 = 400.0;

pub struct GenChunk {
    pub key: String,
    pub position: [f32; 3],
    pub size: [f32; 3],
    pub res: i32,
    pub heights: Vec<f32>,
}

fn hash(ix: i32, iz: i32, seed: i32) -> f32 {
    // identical integer mixing to generate.ts (Math.imul semantics)
    let mut h = (ix.wrapping_mul(0x8da6b343u32 as i32)) ^ (iz.wrapping_mul(0xd8163841u32 as i32)) ^ (seed.wrapping_mul(0x9e3779b9u32 as i32));
    h = (h ^ ((h as u32) >> 13) as i32).wrapping_mul(0x85ebca6bu32 as i32);
    h ^= ((h as u32) >> 16) as i32;
    (h & 0xffff) as f32 / 65535.0
}

fn value_noise(x: f32, z: f32, seed: i32) -> f32 {
    let (x0, z0) = (x.floor(), z.floor());
    let (fx, fz) = (x - x0, z - z0);
    let (sx, sz) = (fx * fx * (3.0 - 2.0 * fx), fz * fz * (3.0 - 2.0 * fz));
    let (ix, iz) = (x0 as i32, z0 as i32);
    let (a, b, c, d) = (hash(ix, iz, seed), hash(ix + 1, iz, seed), hash(ix, iz + 1, seed), hash(ix + 1, iz + 1, seed));
    ((a + (b - a) * sx) * (1.0 - sz) + (c + (d - c) * sx) * sz) * 2.0 - 1.0
}

fn fbm(mut x: f32, mut z: f32, octaves: i32, seed: i32) -> f32 {
    let (mut sum, mut amp, mut norm) = (0.0, 1.0, 0.0);
    for o in 0..octaves {
        sum += amp * value_noise(x, z, seed + o * 17);
        norm += amp;
        amp *= 0.5;
        x *= 2.0;
        z *= 2.0;
    }
    sum / norm
}

fn ridged(mut x: f32, mut z: f32, octaves: i32, seed: i32) -> f32 {
    let (mut sum, mut amp, mut norm, mut prev) = (0.0, 1.0, 0.0, 1.0);
    for o in 0..octaves {
        let n = 1.0 - value_noise(x, z, seed + o * 31).abs();
        sum += n * n * amp * prev;
        prev = n * n;
        norm += amp;
        amp *= 0.5;
        x *= 2.0;
        z *= 2.0;
    }
    sum / norm
}

fn smoothstep(a: f32, b: f32, v: f32) -> f32 {
    let t = ((v - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn height(o: &GenOptions, x: f32, z: f32) -> f32 {
    let g = (o.slope_deg.to_radians()).tan();
    let mid = o.height_range * 0.5;
    match o.base {
        Base::Flat => mid * 0.2,
        Base::Slope => mid - g * z,
        Base::Hills => mid * 0.5 + fbm(x / 600.0, z / 600.0, 6, o.seed) * 60.0,
        Base::Mountain => {
            let run = mid - g * z;
            let r = ((x * 1.4).powi(2) + (z * 0.5).powi(2)).sqrt();
            let rough = smoothstep(250.0, 1100.0, r);
            let bowl = 0.00005 * x * x;
            let peaks = ridged(x / 900.0, z / 900.0, 6, o.seed) * 260.0 + fbm(x / 300.0, z / 300.0, 5, o.seed + 7) * 40.0;
            run + bowl + rough * peaks
        }
    }
}

pub fn generate(o: &GenOptions) -> Vec<GenChunk> {
    let mut cells = vec![];
    for cz in -o.radius..=o.radius {
        for cx in -o.radius..=o.radius {
            let ring = cx.abs().max(cz.abs()) as usize;
            cells.push((cx, cz, o.ring_res[ring.min(o.ring_res.len() - 1)]));
        }
    }
    cells.sort_by_key(|(cx, cz, _)| cx.abs().max(cz.abs()));
    cells
        .into_iter()
        .map(|(cx, cz, res)| {
            let px = (cx as f32 - 0.5) * o.chunk_size;
            let pz = (cz as f32 - 0.5) * o.chunk_size;
            let n = res as usize;
            let spacing = o.chunk_size / (res - 1) as f32;
            let mut heights = vec![0f32; n * n];
            heights.par_chunks_mut(n).enumerate().for_each(|(j, row)| {
                let z = pz + j as f32 * spacing;
                for (i, h) in row.iter_mut().enumerate() {
                    *h = height(o, px + i as f32 * spacing, z);
                }
            });
            // Fit each chunk's vertical range to its own terrain (+ headroom for sculpting):
            // R16 precision is size.y / 65535, so tighter ranges give finer height steps.
            let (lo, hi) = heights.iter().fold((f32::MAX, f32::MIN), |(a, b), &h| (a.min(h), b.max(h)));
            let base = (lo - BELOW).floor();
            let range = ((hi - base) + ABOVE).ceil().max(o.height_range.min(MIN_RANGE));
            heights.iter_mut().for_each(|h| *h -= base);
            GenChunk {
                key: format!("c_{cx}_{cz}"),
                position: [px, base, pz],
                size: [o.chunk_size, range, o.chunk_size],
                res,
                heights,
            }
        })
        .collect()
}
