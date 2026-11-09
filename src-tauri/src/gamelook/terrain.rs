//! The game's snow, read from the player's copy: the terrain material a map's ground is drawn with ("NewSnowTerrain",
//! Custom/PisteSnow; the older "SnowTerrain", Custom/PisteSnowLegacy, where it isn't there) and the textures it lays
//! over it (`_SurfaceTex` the snow, `_SnowNormal` its bumps, `_RockSurfaceTex` the rock's boulders), written beside the
//! rest of its look as terrain/snow.png, terrain/snownormal.png, terrain/rock.png and terrain.json (the material's
//! numbers: its colours, how its snow is tiled and lit).

use super::decode_texture;
use super::unityfile::{At, Game};
use anyhow::{Context, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;

const MATERIAL: i32 = 21;

pub fn write(data: &Path, out: &Path) -> Result<()> {
    let mut names = vec!["resources.assets".to_string()];
    for e in std::fs::read_dir(data)?.flatten() {
        let n = e.file_name().to_string_lossy().to_string();
        if n.starts_with("sharedassets") && n.ends_with(".assets") {
            names.push(n);
        }
    }
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    let g = Game::open(data, &refs)?;
    let find = |name: &str| {
        g.files.iter().enumerate().find_map(|(file, f)| {
            f.objects.iter().filter(|o| o.class == MATERIAL).map(|o| At { file, path: o.path_id }).find(|&at| g.read(at).is_ok_and(|m| m.get("m_Name").s() == name))
        })
    };
    let mat = find("NewSnowTerrain").or_else(|| find("SnowTerrain")).context("no snow terrain material")?;
    let m = g.read(mat)?;
    let shader = g.resolve(mat.file, m.get("m_Shader").pptr()).and_then(|s| g.read(s).ok()).map(|s| s.get("m_ParsedForm").get("m_Name").s().to_string()).unwrap_or_default();
    let sp = m.get("m_SavedProperties");
    let pairs = |name: &str| -> HashMap<String, super::unityfile::V> {
        sp.get(name).arr().iter().filter_map(|p| p.pair()).map(|(k, v)| (k.s().to_string(), v.clone())).collect()
    };
    let (texs, floats, colours) = (pairs("m_TexEnvs"), pairs("m_Floats"), pairs("m_Colors"));
    std::fs::create_dir_all(out.join("terrain"))?;
    let mut files = serde_json::Map::new();
    for (prop, name) in [("_SurfaceTex", "snow"), ("_SnowNormal", "snownormal"), ("_RockSurfaceTex", "rock")] {
        let Some(at) = texs.get(prop).and_then(|t| g.resolve(mat.file, t.get("m_Texture").pptr())) else { continue };
        let Some(img) = decode_texture(&g, &g.read(at)?)? else { continue };
        let file = format!("terrain/{name}.png");
        img.save(out.join(&file))?;
        files.insert(name.into(), json!(file));
    }
    let f = |k: &str| floats.get(k).map(|v| v.f());
    let c = |k: &str| colours.get(k).map(|v| [v.get("r").f(), v.get("g").f(), v.get("b").f()]);
    let look = json!({
        "shader": shader,
        "textures": files,
        // how its snow is tiled ( world metres × worldScale × snowTexTiling ) and lit ( Custom/PisteSnow's own lighting:
        // wrapped, a highlight, a sheen at a glance, light scattered through )
        "worldScale": f("_WorldScale"),
        "snowTexTiling": f("_SnowTexTiling"),
        "snowNormalStrength": f("_SnowNormalStrength"),
        "snowWrap": f("_SnowWrap"),
        "snowSpecular": f("_SnowSpecular"),
        "snowRoughness": f("_SnowRoughness"),
        "sheen": f("_Sheen"),
        "snowScatter": f("_SnowScatter"),
        "usePbrLighting": f("_UsePBRLighting"),
        "rockTexTiling": f("_RockTexTiling"),
        "grooveStrength": f("_GrooveStrength"),
        "pisteTiling": f("_PisteTiling"),
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
        assert!(out.join("terrain/snow.png").exists() && out.join("terrain/rock.png").exists() && out.join("terrain/snownormal.png").exists());
        // ( the map's ground's: Custom/PisteSnow, its snow tiled every 1 / ( 0.01 × 12 ) m )
        assert_eq!(v["shader"], "Custom/PisteSnow");
        assert!((v["rockColor"][0].as_f64().unwrap() - 0.849).abs() < 0.01);
        assert!((v["snowTexTiling"].as_f64().unwrap() - 12.0).abs() < 1e-4);
    }
}
