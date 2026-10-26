//! Jibbers `.jbrmap` reading and writing.
//!
//! ```no_run
//! use jibbers_studio_lib::jbrmap;
//! let map = jbrmap::load("MLNZ Park.jbrmap")?;
//! jbrmap::save(&map, "out.jbrmap")?;
//! # anyhow::Ok(())
//! ```

pub mod codec;
pub mod model;

use std::path::Path;

use anyhow::{Context, Result};

pub use codec::{decode_blob, encode_blob, read_map, write_map, write_map_to};
pub use model::*;

pub fn load(path: impl AsRef<Path>) -> Result<MapData> {
    let path = path.as_ref();
    let text = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    read_map(&text).with_context(|| format!("decode {}", path.display()))
}

/// Writes atomically (temp file + rename) so a failed export never leaves a half-written map.
pub fn save(map: &MapData, path: impl AsRef<Path>) -> Result<()> {
    let path = path.as_ref();
    let tmp = path.with_extension("jbrmap.tmp");
    {
        let f = std::fs::File::create(&tmp).with_context(|| format!("create {}", tmp.display()))?;
        write_map_to(map, f)?;
    }
    std::fs::rename(&tmp, path).with_context(|| format!("rename to {}", path.display()))?;
    Ok(())
}
