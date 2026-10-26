//! JSON <-> model conversion. Key names, order and optional/conditional fields follow the C#
//! `Serialize` methods in Map-Tools 0.5 (0.4 maps keep their 0.4 header) (MapData, MapTerrainChunkData, CustomMapObjectData, ...)
//! and `JsonSerializer` (vectors as `<id>-x/-y/-z`, arrays as `<id>-count` + `{value-N}` blocks,
//! byte blobs as base64(gzip)).

mod read;
mod write;
pub use read::*;
pub use write::*;

use std::io::{Read, Write};

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use indexmap::IndexMap;
use rayon::prelude::*;
use serde_json::{Map, Number, Value};

use super::model::*;

// ------------------------------------------------------------------ blobs

pub fn decode_blob(s: &str) -> Result<Vec<u8>> {
    let raw = B64.decode(s.as_bytes()).context("base64")?;
    if raw.len() >= 2 && raw[0] == 0x1f && raw[1] == 0x8b {
        let mut out = Vec::with_capacity(raw.len() * 3);
        GzDecoder::new(&raw[..]).read_to_end(&mut out).context("gzip")?;
        Ok(out)
    } else {
        Ok(raw)
    }
}

pub fn encode_blob(bytes: &[u8]) -> String {
    let mut gz = GzEncoder::new(Vec::with_capacity(bytes.len() / 2), Compression::new(6));
    gz.write_all(bytes).expect("in-memory gzip");
    B64.encode(gz.finish().expect("in-memory gzip"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blob_roundtrip() {
        let data: Vec<u8> = (0..10_000u32).flat_map(|i| i.to_le_bytes()).collect();
        let s = encode_blob(&data);
        assert!(s.starts_with("H4sI"));
        assert_eq!(decode_blob(&s).unwrap(), data);
    }

    #[test]
    fn heights_r16_layout() {
        // Same layout as ExportHeightmapR16: h / size.y * 65535 as little-endian u16, clamped.
        let mut c = Chunk { heightmap_resolution: 2, size: Vec3::new(10.0, 100.0, 10.0), ..Default::default() };
        c.set_heights(&[0.0, 25.0, 100.0, 150.0]);
        let raw = c.terrain_data.clone().unwrap();
        assert_eq!(raw, vec![0x00, 0x00, 0x00, 0x40, 0xff, 0xff, 0xff, 0xff]);
        let h = c.heights();
        assert!((h[1] - 25.0).abs() < 0.01 && h[3] == 100.0);
    }

    #[test]
    fn heights_reencode_exactly() {
        let mut c = Chunk { heightmap_resolution: 256, size: Vec3::new(10.0, 600.0, 10.0), ..Default::default() };
        let raw: Vec<u8> = (0..65536u32).flat_map(|v| (v as u16).to_le_bytes()).collect();
        c.terrain_data = Some(raw.clone());
        let h = c.heights();
        c.set_heights(&h);
        assert_eq!(c.terrain_data.unwrap(), raw);
    }

    #[test]
    fn floats_print_shortest() {
        assert_eq!(num(0.1).to_string(), "0.1");
        assert_eq!(num(1.0).to_string(), "1.0");
        assert_eq!(num(-170.65).to_string(), "-170.65");
    }

    #[test]
    fn optional_fields_follow_csharp() {
        let mut m = MapData::default();
        let mut c = Chunk::default();
        c.custom_objects.push(CustomObject::default());
        c.objects.push(MapObject { id: "rail_long".into(), position: Vec3::ZERO, rotation: Vec3::ZERO, scale: Vec3::ONE, parameters: IndexMap::new(), lift: None });
        m.chunks.push(c);
        let v: Value = serde_json::from_str(&write_map(&m).unwrap()).unwrap();
        assert!(v.get("day-time-hours").is_none(), "day-time-hours only written when >= 0");
        let ch = &v["chunks"]["value-0"];
        assert_eq!(ch["snow-mask"], Value::Object(Map::new()));
        let co = &ch["custom-objects"]["value-0"];
        assert!(co.get("can-stabilize").is_none(), "jib flags only for Jib surfaces");
        assert!(co.get("visible-from-hour").is_none());
        assert!(ch["objects"]["value-0"].get("parameters").is_none());
    }
}
