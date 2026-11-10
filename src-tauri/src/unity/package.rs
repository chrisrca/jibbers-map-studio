//! .unitypackage files: Unity's way of passing assets between projects. A gzipped tar with a folder per asset (named by
//! its guid) holding `asset` (the file; folders have none), `asset.meta` and `pathname` (where it goes: "Assets/…").
//! Unpacked into a project of its own (the studio's data, unity-packages/<name>-<hash>), which the importer then reads
//! as any other. A package never carries the project's packages (Packages/), so Map-Tools (what a map's scripts are,
//! and the game's objects it places) is put in beside it when it isn't there: its newest version, downloaded from its
//! repository when that's changed (the copy kept before when it can't be reached).

use std::io::Read;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde::Serialize;

/// Map-Tools, as a Unity project names it; its newest version (the commit), and its files at a commit.
const MAP_TOOLS: &str = "fun.jibbers.map-tools";
const MAP_TOOLS_LATEST: &str = "https://api.github.com/repos/jibbers-ski/Map-Tools/commits/main";
const MAP_TOOLS_FILES: &str = "https://codeload.github.com/jibbers-ski/Map-Tools/tar.gz/";

/// A package unpacked: its folder (a Unity project), the scenes in it ("Assets/…"), its models (full paths) and how
/// many assets it held; and what the studio has to say about it.
#[derive(Serialize)]
pub struct Unpacked {
    pub dir: PathBuf,
    pub scenes: Vec<String>,
    pub models: Vec<PathBuf>,
    pub assets: usize,
    pub notes: Vec<String>,
}

/// Unpacks `pkg` (again only when it's changed) and, when it hasn't Map-Tools, puts it in.
pub fn open(pkg: &Path) -> Result<Unpacked> {
    // ( kept by the package's name, size and date: opened again unchanged, not unpacked again )
    let m = std::fs::metadata(pkg).with_context(|| format!("read {}", pkg.display()))?;
    let stamp = format!("{}|{}|{:?}", pkg.display(), m.len(), m.modified().ok());
    let stem = pkg.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "package".into());
    let safe: String = stem.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).take(40).collect();
    let dir = crate::library::userassets::data_dir()?.join("unity-packages").join(format!("{safe}-{:016x}", fnv(stamp.as_bytes())));
    let done = dir.join("unpacked");
    let mut assets = 0;
    if !done.exists() {
        if dir.exists() {
            std::fs::remove_dir_all(&dir).ok();
        }
        assets = unpack(std::fs::File::open(pkg)?, &dir)?;
        std::fs::write(&done, assets.to_string())?;
    } else if let Ok(n) = std::fs::read_to_string(&done) {
        assets = n.trim().parse().unwrap_or(0);
    }
    let mut notes = vec![];
    // ( Map-Tools put in, or brought up to its newest, unless the package has its own )
    if !has_map_tools(&dir) {
        let ours = dir.join("Packages").join(MAP_TOOLS);
        match map_tools() {
            Ok((src, version)) => {
                if std::fs::read_to_string(dir.join("map-tools-version")).ok().as_deref() != Some(&version) {
                    if ours.exists() {
                        std::fs::remove_dir_all(&ours)?;
                    }
                    copy_dir(&src, &ours)?;
                    std::fs::write(dir.join("map-tools-version"), &version)?;
                }
            }
            Err(e) if !ours.exists() => notes.push(format!("Map-Tools couldn't be fetched ({e}): the game's own objects in it are left out")),
            Err(_) => {}
        }
    }
    let mut scenes = vec![];
    let mut models = vec![];
    walk(&dir.join("Assets"), &mut |p| {
        let rel = p.strip_prefix(&dir).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        match p.extension().and_then(|x| x.to_str()).map(|x| x.to_ascii_lowercase()).as_deref() {
            Some("unity") => scenes.push(rel),
            Some("fbx" | "obj" | "glb" | "gltf") => models.push(p.to_path_buf()),
            _ => {}
        }
    });
    scenes.sort();
    models.sort();
    Ok(Unpacked { dir, scenes, models, assets, notes })
}

/// The package's assets written out under `dir` as a Unity project has them (each beside its .meta); how many. Read
/// as it's decompressed, each entry straight to a file (a package can be most of a gigabyte): into a folder per guid
/// first, then each moved to its path once that's known (its `pathname` may come after it).
fn unpack(gz: impl Read, dir: &Path) -> Result<usize> {
    let parts = dir.join(".parts");
    std::fs::create_dir_all(&parts)?;
    let mut r = std::io::BufReader::with_capacity(1 << 20, flate2::read::GzDecoder::new(gz));
    let mut long: Option<String> = None;
    let mut any = false;
    loop {
        let mut h = [0u8; 512];
        if r.read_exact(&mut h).is_err() || h.iter().all(|&b| b == 0) {
            break;
        }
        let text = |r: std::ops::Range<usize>| String::from_utf8_lossy(&h[r]).trim_end_matches('\0').to_string();
        let size = u64::from_str_radix(text(124..136).trim().trim_matches('\0'), 8).context("not a .unitypackage (a broken tar header)")?;
        let mut name = text(0..100);
        if &h[257..262] == b"ustar" {
            let prefix = text(345..500);
            if !prefix.is_empty() {
                name = format!("{prefix}/{name}");
            }
        }
        let padded = size.div_ceil(512) * 512;
        let mut body = (&mut r).take(padded);
        match h[156] {
            b'L' | b'x' => {
                let mut data = vec![];
                body.read_to_end(&mut data)?;
                data.truncate(size as usize);
                let text = String::from_utf8_lossy(&data).trim_end_matches('\0').to_string();
                long = if h[156] == b'L' { Some(text) } else { text.lines().find_map(|rec| rec.split_once(' ').and_then(|(_, kv)| kv.strip_prefix("path=")).map(String::from)) };
            }
            b'0' | 0 => {
                let name = long.take().unwrap_or(name).replace('\\', "/");
                let mut it = name.trim_start_matches("./").splitn(2, '/');
                let (guid, what) = (it.next().unwrap_or(""), it.next().unwrap_or(""));
                let keep = matches!(what, "pathname" | "asset" | "asset.meta") && !guid.is_empty() && guid.chars().all(|c| c.is_ascii_alphanumeric());
                if keep {
                    std::fs::create_dir_all(parts.join(guid))?;
                    let mut f = std::fs::File::create(parts.join(guid).join(what))?;
                    std::io::copy(&mut (&mut body).take(size), &mut f)?;
                    any = true;
                }
                std::io::copy(&mut body, &mut std::io::sink())?;
            }
            _ => {
                long = None;
                std::io::copy(&mut body, &mut std::io::sink())?;
            }
        }
    }
    if !any {
        bail!("not a .unitypackage (nothing in it)");
    }
    let mut n = 0;
    for e in std::fs::read_dir(&parts)?.flatten() {
        let g = e.path();
        let Some(path) = std::fs::read_to_string(g.join("pathname")).ok().and_then(|t| t.lines().next().map(|l| l.trim().to_string())).as_deref().and_then(safe_path) else { continue };
        let at = dir.join(&path);
        if let Some(parent) = at.parent() {
            std::fs::create_dir_all(parent)?;
        }
        if g.join("asset").exists() {
            std::fs::rename(g.join("asset"), &at)?;
        } else {
            // ( a folder )
            std::fs::create_dir_all(&at)?;
        }
        if g.join("asset.meta").exists() {
            std::fs::rename(g.join("asset.meta"), at.with_file_name(format!("{}.meta", at.file_name().unwrap_or_default().to_string_lossy())))?;
        }
        n += 1;
    }
    std::fs::remove_dir_all(&parts).ok();
    // ( a project, as the importer finds one: the folder with Assets in it )
    std::fs::create_dir_all(dir.join("Assets"))?;
    Ok(n)
}

/// A path from a package kept inside its project: "Assets/…" or "Packages/…", nothing climbing out.
fn safe_path(p: &str) -> Option<PathBuf> {
    let p = p.replace('\\', "/");
    if !(p.starts_with("Assets/") || p == "Assets" || p.starts_with("Packages/")) {
        return None;
    }
    if p.split('/').any(|c| c == ".." || c.contains(':')) {
        return None;
    }
    Some(PathBuf::from(p))
}

/// A tar's files: (name, bytes). ustar's name prefix, GNU long names and pax paths are read; folders and links left out.
fn entries(tar: &[u8]) -> Result<Vec<(String, &[u8])>> {
    let mut out = vec![];
    let mut at = 0;
    let mut long: Option<String> = None;
    while at + 512 <= tar.len() {
        let h = &tar[at..at + 512];
        if h.iter().all(|&b| b == 0) {
            break;
        }
        let text = |r: std::ops::Range<usize>| String::from_utf8_lossy(&h[r]).trim_end_matches('\0').to_string();
        let size = usize::from_str_radix(text(124..136).trim().trim_matches('\0'), 8).context("a broken tar header")?;
        let kind = h[156];
        let mut name = text(0..100);
        if &h[257..262] == b"ustar" {
            let prefix = text(345..500);
            if !prefix.is_empty() {
                name = format!("{prefix}/{name}");
            }
        }
        let body = at + 512;
        let data = tar.get(body..body + size).context("a tar cut short")?;
        match kind {
            // ( GNU's long name: the next entry's )
            b'L' => long = Some(String::from_utf8_lossy(data).trim_end_matches('\0').to_string()),
            // ( pax: a path for the next entry, among "<len> key=value" records )
            b'x' => {
                for rec in String::from_utf8_lossy(data).lines() {
                    if let Some(p) = rec.split_once(' ').and_then(|(_, kv)| kv.strip_prefix("path=")) {
                        long = Some(p.to_string());
                    }
                }
            }
            b'0' | 0 => out.push((long.take().unwrap_or(name), data)),
            _ => long = None,
        }
        at = body + size.div_ceil(512) * 512;
    }
    Ok(out)
}

/// Whether the package came with Map-Tools of its own (its assembly definition anywhere but where the studio puts its).
fn has_map_tools(dir: &Path) -> bool {
    let ours = dir.join("Packages").join(MAP_TOOLS);
    let mut found = false;
    for sub in ["Assets", "Packages"] {
        walk(&dir.join(sub), &mut |p| found |= !p.starts_with(&ours) && p.file_name().is_some_and(|n| n == "fun.jibbers.map-tools.asmdef"));
    }
    found
}

/// Map-Tools' files at its newest version, and that version: downloaded from its repository when it's changed since
/// the last time (kept in the studio's data), the copy kept before when the repository can't be reached.
fn map_tools() -> Result<(PathBuf, String)> {
    let root = crate::library::userassets::data_dir()?.join("map-tools");
    let dir = root.join("package");
    let have = std::fs::read_to_string(root.join("version")).ok().filter(|_| dir.join("package.json").exists());
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(120))
        .user_agent(concat!("JibbersMapStudio/", env!("CARGO_PKG_VERSION"), " (map editor for the game Jibbers)"))
        .build();
    // ( its newest commit, the bare hash )
    let latest = agent.get(MAP_TOOLS_LATEST).set("Accept", "application/vnd.github.sha").call().ok().and_then(|r| r.into_string().ok()).map(|s| s.trim().to_string()).filter(|s| s.len() == 40 && s.chars().all(|c| c.is_ascii_hexdigit()));
    let Some(latest) = latest else {
        // ( offline, or GitHub not answering: the copy kept before )
        return have.map(|v| (dir, v)).context("GitHub couldn't be reached");
    };
    if have.as_deref() == Some(latest.as_str()) {
        return Ok((dir, latest));
    }
    let fetched = (|| -> Result<()> {
        let mut gz = vec![];
        agent.get(&format!("{MAP_TOOLS_FILES}{latest}")).call()?.into_reader().take(64 << 20).read_to_end(&mut gz)?;
        let mut tar = vec![];
        flate2::read::GzDecoder::new(&gz[..]).read_to_end(&mut tar)?;
        let next = root.join("package.next");
        if next.exists() {
            std::fs::remove_dir_all(&next)?;
        }
        // ( the repository's files under its one top folder, "Map-Tools-<commit>/" )
        for (name, data) in entries(&tar)? {
            let Some((_, rel)) = name.split_once('/') else { continue };
            if rel.is_empty() || rel.split('/').any(|c| c == ".." || c.contains(':')) {
                continue;
            }
            let at = next.join(rel);
            std::fs::create_dir_all(at.parent().unwrap_or(&next))?;
            std::fs::write(at, data)?;
        }
        if !next.join("package.json").exists() {
            bail!("not Map-Tools");
        }
        if dir.exists() {
            std::fs::remove_dir_all(&dir)?;
        }
        std::fs::rename(&next, &dir)?;
        std::fs::write(root.join("version"), &latest)?;
        Ok(())
    })();
    match fetched {
        Ok(()) => Ok((dir, latest)),
        Err(e) => have.map(|v| (dir, v)).ok_or(e),
    }
}

fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from)?.flatten() {
        let p = e.path();
        if p.is_dir() {
            copy_dir(&p, &to.join(e.file_name()))?;
        } else {
            std::fs::copy(&p, to.join(e.file_name()))?;
        }
    }
    Ok(())
}

fn walk(dir: &Path, f: &mut dyn FnMut(&Path)) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, f);
        } else {
            f(&p);
        }
    }
}

fn fnv(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325u64, |h, &b| (h ^ b as u64).wrapping_mul(0x100000001b3))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tar entry ( ustar header, data padded ).
    fn entry(name: &str, data: &[u8]) -> Vec<u8> {
        let mut h = [0u8; 512];
        h[..name.len()].copy_from_slice(name.as_bytes());
        h[100..108].copy_from_slice(b"0000644\0");
        h[124..136].copy_from_slice(format!("{:011o}\0", data.len()).as_bytes());
        h[156] = b'0';
        h[257..263].copy_from_slice(b"ustar\0");
        h[148..156].copy_from_slice(b"        ");
        let sum: u32 = h.iter().map(|&b| b as u32).sum();
        h[148..156].copy_from_slice(format!("{sum:06o}\0 ").as_bytes());
        let mut out = h.to_vec();
        out.extend_from_slice(data);
        out.resize(out.len().div_ceil(512) * 512, 0);
        out
    }

    #[test]
    fn unpacks_a_package_as_a_project() {
        let mut tar = vec![];
        tar.extend(entry("aaaa/pathname", b"Assets/Scenes/Park.unity\n00"));
        tar.extend(entry("aaaa/asset", b"%YAML 1.1"));
        tar.extend(entry("aaaa/asset.meta", b"guid: aaaa\n"));
        tar.extend(entry("bbbb/pathname", b"Assets/Scenes"));
        tar.extend(entry("bbbb/asset.meta", b"guid: bbbb\n"));
        // ( one climbing out of the project: left out )
        tar.extend(entry("cccc/pathname", b"Assets/../../evil.txt"));
        tar.extend(entry("cccc/asset", b"no"));
        tar.extend([0u8; 1024]);
        let mut gz = vec![];
        {
            let mut w = flate2::write::GzEncoder::new(&mut gz, flate2::Compression::fast());
            std::io::Write::write_all(&mut w, &tar).unwrap();
            w.finish().unwrap();
        }
        let dir = std::env::temp_dir().join(format!("jibbers-unitypackage-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(unpack(&gz[..], &dir).unwrap(), 2);
        assert_eq!(std::fs::read_to_string(dir.join("Assets/Scenes/Park.unity")).unwrap(), "%YAML 1.1");
        assert!(dir.join("Assets/Scenes/Park.unity.meta").exists() && dir.join("Assets/Scenes.meta").exists());
        assert!(!dir.parent().unwrap().join("evil.txt").exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}

