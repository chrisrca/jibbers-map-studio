//! The game's snow, read from the player's copy: its terrain material ("SnowTerrain", Custom/PisteSnowLegacy) and the
//! two textures it lays over a map's ground (`_SurfaceTex` the snow, `_RockSurfaceTex` the rock's boulders), written
//! beside the rest of its look as terrain/snow.png, terrain/rock.png and terrain.json (the material's numbers).

use super::decode_texture;
use super::unityfile::{At, Game};
use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;

const MATERIAL: i32 = 21;

pub fn write(data: &Path, out: &Path) -> Result<()> {
    let g = Game::open(data, &["resources.assets"])?;
    let mat = g.files[0]
        .objects
        .iter()
        .filter(|o| o.class == MATERIAL)
        .map(|o| At { file: 0, path: o.path_id })
        .find(|&at| g.read(at).is_ok_and(|m| m.get("m_Name").s() == "SnowTerrain"))
        .context("no SnowTerrain material")?;
    let m = g.read(mat)?;
    let sp = m.get("m_SavedProperties");
    let pairs = |name: &str| -> HashMap<String, super::unityfile::V> {
        sp.get(name).arr().iter().filter_map(|p| p.pair()).map(|(k, v)| (k.s().to_string(), v.clone())).collect()
    };
    let (texs, floats, colours) = (pairs("m_TexEnvs"), pairs("m_Floats"), pairs("m_Colors"));
    std::fs::create_dir_all(out.join("terrain"))?;
    let mut files = serde_json::Map::new();
    for (prop, name) in [("_SurfaceTex", "snow"), ("_RockSurfaceTex", "rock")] {
        let Some(at) = texs.get(prop).and_then(|t| g.resolve(0, t.get("m_Texture").pptr())) else { continue };
        let Some(img) = decode_texture(&g, &g.read(at)?)? else { continue };
        let file = format!("terrain/{name}.png");
        img.save(out.join(&file))?;
        files.insert(name.into(), json!(file));
    }
    let f = |k: &str| floats.get(k).map(|v| v.f());
    let c = |k: &str| colours.get(k).map(|v| [v.get("r").f(), v.get("g").f(), v.get("b").f()]);
    let look = json!({
        "textures": files,
        "baseColor": c("_BaseColor"),
        "rockColor": c("_RockColor"),
        "thirdColor": c("_ThirdColor"),
        "snowMaskContrast": f("_SnowMaskContrast"),
        "thirdCoverageDepth": f("_ThirdCoverageDepth"),
        "thirdEdgeSharpness": f("_ThirdEdgeSharpness"),
    });
    std::fs::write(out.join("terrain.json"), serde_json::to_vec_pretty(&look)?)?;
    Ok(())
}

/// The game's snow as read (`dir`: where its textures are), or None before it's been read.
pub fn read() -> Result<Option<Value>> {
    let dir = super::features::look_dir()?;
    let Some(mut v) = std::fs::read(dir.join("terrain.json")).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else {
        return Ok(None);
    };
    v["dir"] = json!(dir);
    Ok(Some(v))
}

#[cfg(test)]
mod tests {
    /// (needs the game installed)
    #[test]
    #[ignore]
    fn reads_the_games_snow() {
        let data = crate::gamelook::data_dir().expect("the game");
        let out = std::env::temp_dir().join("jibbers-snow-test");
        std::fs::create_dir_all(&out).unwrap();
        super::write(&data, &out).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(out.join("terrain.json")).unwrap()).unwrap();
        println!("{v:#}");
        assert!(out.join("terrain/snow.png").exists() && out.join("terrain/rock.png").exists());
        assert!((v["rockColor"][0].as_f64().unwrap() - 0.698).abs() < 0.01);
    }
}
