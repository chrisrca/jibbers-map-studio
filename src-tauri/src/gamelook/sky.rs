//! The game's own sky, read from the player's copy of the game into `<game look>/sky.json` for the view
//! (src/viewport/render/gameSky.ts), as the game draws it in play (its Main scene):
//!  - its sky shader (the scene's skybox material's, Skybox/StylizedNew), its compiled pixel shader turned into WGSL
//!    (gamelook/dxbc.rs), and which of its constants each of its properties is;
//!  - that material's own numbers (clouds, stars, night colours…);
//!  - the scene's EnvironmentManager's settings (how the sun goes round, twilight, the moon, ambient) and its
//!    SkyConfig's sky states (the colours through the day).
//!
//! Scripts' fields have no layouts in the game's files: they're read in their declared order (and only used when
//! every byte of the object is accounted for).

use std::collections::HashMap;
use std::path::Path;

use anyhow::{bail, Context, Result};
use serde_json::{json, Map, Value};

use super::unityfile::{At, Game, V};

const SHADER: i32 = 48;
const RENDER_SETTINGS: i32 = 104;
const MONO_BEHAVIOUR: i32 = 114;
const MONO_SCRIPT: i32 = 115;
const BUILD_SETTINGS: i32 = 141;
/// The D3D11 platform, in a shader's compiled programs.
const D3D11: i64 = 4;

/// Writes `sky.json` into `out` from the game's data folder.
pub fn write(data: &Path, out: &Path) -> Result<()> {
    let sky = read(data)?;
    std::fs::write(out.join("sky.json"), serde_json::to_vec(&sky)?)?;
    Ok(())
}

/// A script's fields, read in order.
struct Fields<'a> {
    b: &'a [u8],
    p: usize,
}

impl<'a> Fields<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        let s = self.b.get(self.p..self.p + n).context("past the end")?;
        self.p += n;
        Ok(s)
    }
    fn i32(&mut self) -> Result<i32> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into()?))
    }
    fn f(&mut self) -> Result<f64> {
        Ok(f32::from_le_bytes(self.take(4)?.try_into()?) as f64)
    }
    fn align(&mut self) {
        self.p = (self.p + 3) & !3;
    }
    fn bool(&mut self) -> Result<bool> {
        let v = self.take(1)?[0] != 0;
        self.align();
        Ok(v)
    }
    fn string(&mut self) -> Result<String> {
        let n = self.i32()? as usize;
        let s = String::from_utf8_lossy(self.take(n)?).into_owned();
        self.align();
        Ok(s)
    }
    fn pptr(&mut self) -> Result<(i32, i64)> {
        let f = self.i32()?;
        let p = i64::from_le_bytes(self.take(8)?.try_into()?);
        Ok((f, p))
    }
    fn color(&mut self) -> Result<Value> {
        Ok(json!([self.f()?, self.f()?, self.f()?, self.f()?]))
    }
    fn v3(&mut self) -> Result<Value> {
        Ok(json!([self.f()?, self.f()?, self.f()?]))
    }
    /// A MonoBehaviour's own part (its object, enabled, its script, its name).
    fn header(&mut self) -> Result<(i32, i64)> {
        self.pptr()?;
        self.bool()?;
        let script = self.pptr()?;
        self.string()?;
        Ok(script)
    }
    fn done(&self) -> Result<()> {
        if self.p != self.b.len() {
            bail!("{} of {} bytes read (the game's script has changed?)", self.p, self.b.len());
        }
        Ok(())
    }
}

/// A sky state (SkyConfig.SkyState), its fields in order.
fn state(r: &mut Fields) -> Result<Value> {
    let mut m = Map::new();
    m.insert("name".into(), json!(r.string()?));
    m.insert("time".into(), json!(r.f()?));
    for k in ["dayTop", "dayMiddle", "dayBottom"] {
        m.insert(k.into(), r.color()?);
    }
    m.insert("gradientExponent".into(), json!(r.f()?));
    for k in ["ambientSky", "ambientEquator", "ambientGround", "horizonColor"] {
        m.insert(k.into(), r.color()?);
    }
    m.insert("horizonIntensity".into(), json!(r.f()?));
    m.insert("horizonWidth".into(), json!(r.f()?));
    m.insert("sunColor".into(), r.color()?);
    m.insert("sunEmission".into(), json!(r.f()?));
    m.insert("sunSize".into(), json!(r.f()?));
    m.insert("lightColor".into(), r.color()?);
    m.insert("lightEmission".into(), json!(r.f()?));
    m.insert("lightTemperature".into(), json!(r.f()?));
    Ok(Value::Object(m))
}

/// The EnvironmentManager's settings (its serialized fields, in order), and where its SkyConfig is.
fn environment(raw: &[u8]) -> Result<(Value, (i32, i64))> {
    let mut r = Fields { b: raw, p: 0 };
    r.header()?;
    let mut m = Map::new();
    m.insert("ignoreMap".into(), json!(r.bool()?));
    m.insert("fixedTime".into(), json!(r.bool()?));
    r.pptr()?; // bgMountainsPrefab
    m.insert("bgMountainsOffset".into(), r.v3()?);
    for k in ["sunYAngle", "sunPeakAngle", "sunSizeMultiplier"] {
        m.insert(k.into(), json!(r.f()?));
    }
    m.insert("updateTime".into(), json!(r.bool()?));
    for k in ["dayNightT", "nightStartT", "twilightWidth", "timeFlowSpeed"] {
        m.insert(k.into(), json!(r.f()?));
    }
    m.insert("updateReflections".into(), json!(r.bool()?));
    m.insert("reflectionSunAngleStep".into(), json!(r.f()?));
    let config = r.pptr()?;
    let n = r.i32()?;
    let own: Vec<Value> = (0..n).map(|_| state(&mut r)).collect::<Result<_>>()?;
    m.insert("skyStates".into(), Value::Array(own));
    m.insert("moonLightColor".into(), r.color()?);
    for k in ["lightIntensityMultiplier", "shadowStrength", "moonEmission", "moonPhase", "starOrbitSpeed", "cloudParallax"] {
        m.insert(k.into(), json!(r.f()?));
    }
    m.insert("randomizeCloudSeed".into(), json!(r.bool()?));
    for k in ["flareDiskScale", "flareZoomExponent", "cloudDimLight", "terrainDimLight", "lightCentroidShift"] {
        m.insert(k.into(), json!(r.f()?));
    }
    m.insert("lightOcclusionMask".into(), json!(r.i32()?));
    m.insert("syncFogColor".into(), json!(r.bool()?));
    for k in ["ambientIntensity", "ambientSaturation", "ambientMin"] {
        m.insert(k.into(), json!(r.f()?));
    }
    r.done()?;
    Ok((Value::Object(m), config))
}

/// A SkyConfig: its gradient mode and sky states.
fn config(raw: &[u8]) -> Result<Value> {
    let mut r = Fields { b: raw, p: 0 };
    r.header()?;
    let mode = r.i32()?;
    let separate = r.bool()?;
    let n = r.i32()?;
    let states: Vec<Value> = (0..n).map(|_| state(&mut r)).collect::<Result<_>>()?;
    r.done()?;
    Ok(json!({ "gradientMode": mode, "useSeparateAmbient": separate, "states": states }))
}

/// The scene file the game plays maps in (BuildSettings' Main.unity: level<its index>).
fn main_scene(data: &Path) -> Result<String> {
    let g = Game::open(data, &["globalgamemanagers"])?;
    let f = &g.files[0];
    let o = f.objects.iter().find(|o| o.class == BUILD_SETTINGS).context("no build settings")?;
    let bs = g.read(At { file: 0, path: o.path_id })?;
    let i = bs.get("scenes").arr().iter().position(|s| s.s().ends_with("/Main.unity")).context("no Main scene")?;
    Ok(format!("level{i}"))
}

fn read(data: &Path) -> Result<Value> {
    let level = main_scene(data)?;
    // the scene, and the files its references go into
    let mut names: Vec<String> = vec![level.clone()];
    for e in std::fs::read_dir(data)?.flatten() {
        let n = e.file_name().to_string_lossy().to_string();
        if (n.starts_with("sharedassets") && n.ends_with(".assets")) || n == "resources.assets" || n == "globalgamemanagers.assets" {
            names.push(n);
        }
    }
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    let g = Game::open(data, &refs)?;
    let scene = &g.files[0];
    // its sky material and shader
    let rs = scene.objects.iter().find(|o| o.class == RENDER_SETTINGS).context("no render settings")?;
    let rs = g.read(At { file: 0, path: rs.path_id })?;
    let mat_at = g.resolve(0, rs.get("m_SkyboxMaterial").pptr()).context("no skybox material")?;
    let mat = g.read(mat_at)?;
    let shader_at = g.resolve(mat_at.file, mat.get("m_Shader").pptr()).context("no sky shader")?;
    if g.class_of(shader_at) != Some(SHADER) {
        bail!("the sky material's shader isn't one");
    }
    let shader = g.read(shader_at)?;
    // the scene's EnvironmentManager (a script: by its class name)
    let mut env = None;
    for o in scene.objects.iter().filter(|o| o.class == MONO_BEHAVIOUR) {
        let Some(raw) = g.raw(At { file: 0, path: o.path_id }) else { continue };
        let Ok(script) = (Fields { b: raw, p: 0 }).header() else { continue };
        let Some(s_at) = g.resolve(0, super::unityfile::PPtr { file: script.0, path: script.1 }) else { continue };
        if g.class_of(s_at) != Some(MONO_SCRIPT) || g.read(s_at).map(|s| s.get("m_ClassName").s() == "EnvironmentManager").ok() != Some(true) {
            continue;
        }
        env = Some(environment(raw)?);
        break;
    }
    let (mut env, cfg) = env.context("no EnvironmentManager in the scene")?;
    let cfg_at = g.resolve(0, super::unityfile::PPtr { file: cfg.0, path: cfg.1 }).context("no sky config")?;
    let mut config = config(g.raw(cfg_at).context("sky config not readable")?)?;
    // (states of the scene's own, when it has them, over its config's)
    if let Some(own) = env.get("skyStates").and_then(Value::as_array).filter(|s| !s.is_empty()).cloned() {
        config["states"] = Value::Array(own);
    }
    env.as_object_mut().unwrap().remove("skyStates");
    // the shader: its properties' kinds, its constants' places, its pixel shader as WGSL
    let parsed = shader.get("m_ParsedForm");
    let kinds = ["color", "vector", "float", "float", "texture"];
    let props: Map<String, Value> = parsed
        .get("m_PropInfo")
        .get("m_Props")
        .arr()
        .iter()
        .map(|p| (p.get("m_Name").s().to_string(), json!(kinds.get(p.get("m_Type").i() as usize).copied().unwrap_or("float"))))
        .collect();
    let pass = parsed.get("m_SubShaders").arr().first().and_then(|s| s.get("m_Passes").arr().first()).context("no pass")?;
    let names: HashMap<i64, String> = pass.get("m_NameIndices").arr().iter().filter_map(|p| p.pair()).map(|(k, v)| (v.i(), k.s().to_string())).collect();
    let mut regs = Map::new();
    for cb in pass.get("progFragment").get("m_CommonParameters").get("m_ConstantBuffers").arr() {
        for v in cb.get("m_VectorParams").arr() {
            if let Some(n) = names.get(&v.get("m_NameIndex").i()) {
                let at = v.get("m_Index").i();
                regs.insert(n.clone(), json!([at / 16, (at % 16) / 4, v.get("m_Dim").i()]));
            }
        }
    }
    let wgsl = pixel_shader(&shader)?;
    // the material's own numbers
    let sp = mat.get("m_SavedProperties");
    let mut material = Map::new();
    for p in sp.get("m_Floats").arr() {
        if let Some((k, v)) = p.pair() {
            material.insert(k.s().to_string(), json!(v.f()));
        }
    }
    for p in sp.get("m_Colors").arr() {
        if let Some((k, c)) = p.pair() {
            material.insert(k.s().to_string(), json!([c.get("r").f(), c.get("g").f(), c.get("b").f(), c.get("a").f()]));
        }
    }
    Ok(json!({
        "version": 1,
        "wgsl": wgsl,
        "regs": regs,
        "props": props,
        "material": material,
        "config": config,
        "env": env,
    }))
}

/// The shader's D3D11 pixel shader as WGSL (its first; the sky has one).
fn pixel_shader(shader: &V) -> Result<String> {
    let plats: Vec<i64> = shader.get("platforms").arr().iter().map(V::i).collect();
    let k = plats.iter().position(|&p| p == D3D11).context("no D3D11 programs")?;
    let blob = shader.get("compressedBlob").bytes();
    let offs = shader.get("offsets").arr().get(k).context("no offsets")?;
    let clens = shader.get("compressedLengths").arr().get(k).context("no lengths")?;
    let dlens = shader.get("decompressedLengths").arr().get(k).context("no lengths")?;
    for seg in 0..offs.arr().len() {
        let (o, c, d) = (offs.arr()[seg].i() as usize, clens.arr()[seg].i() as usize, dlens.arr()[seg].i() as usize);
        let packed = blob.get(o..o + c).context("blob too short")?;
        let data = lz4_flex::block::decompress(packed, d).map_err(|e| anyhow::anyhow!("lz4: {e}"))?;
        for dx in super::dxbc::containers(&data) {
            let asm = super::dxbc::disassemble(dx)?;
            if asm.lines().any(|l| l.trim_start().starts_with("ps_")) {
                return super::dxbc::to_wgsl(&asm);
            }
        }
    }
    bail!("no pixel shader")
}

#[cfg(test)]
mod tests {
    /// (with the game installed) the sky comes out: its shader as WGSL, its states and settings
    #[test]
    #[ignore]
    fn reads_the_games_sky() {
        let data = crate::gamelook::data_dir().expect("the game");
        let v = super::read(&data).unwrap();
        let w = v["wgsl"].as_str().unwrap();
        assert!(w.starts_with("fn shade(") && w.lines().count() > 1000, "{}", &w[..200.min(w.len())]);
        assert_eq!(v["regs"]["_TopColor"][0], 130);
        assert!(v["config"]["states"].as_array().unwrap().len() >= 4);
        assert!(v["env"]["nightStartT"].as_f64().unwrap() > 0.3);
        assert!(v["material"]["_StarDensity"].as_f64().unwrap() > 0.0);
    }

    /// (with the game installed, SKY_OUT set) the sky written where it says, to look at
    #[test]
    #[ignore]
    fn dump_the_games_sky() {
        let Ok(out) = std::env::var("SKY_OUT") else { return };
        super::write(&crate::gamelook::data_dir().expect("the game"), std::path::Path::new(&out)).unwrap();
    }
}
