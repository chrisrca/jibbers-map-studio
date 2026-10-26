//! Your pieces moved over from the first library's layout.

use super::*;

/// Once: brings what the library had before it was folders into your library folder — your imports (copied, the
/// old files are left as they were) and the pieces of the maps you had added (taken from those maps again, when
/// they're still where they were). The old built library is then deleted (it was only made from those).
pub fn migrate() -> Result<()> {
    // (the library is listed from two places as the studio starts: once is enough)
    static ONCE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _one = ONCE.lock().unwrap_or_else(|e| e.into_inner());
    let root = user_root()?;
    let done = root.join(".migrated");
    if done.exists() {
        return Ok(());
    }
    let data = userassets::data_dir()?;
    let imports = root.join(IMPORTS);
    for (old, ext) in [(data.join("assets"), OBJECT_EXT), (data.join("materials"), MATERIAL_EXT)] {
        let Ok(rd) = std::fs::read_dir(&old) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if !p.extension().is_some_and(|x| x == "jbrmap") {
                continue;
            }
            // named as the browser showed it (the name inside), not the file's slug
            let name = crate::jbrmap::load(&p).map(|m| m.name).unwrap_or_default();
            let name = if name.trim().is_empty() { p.file_stem().unwrap_or_default().to_string_lossy().into_owned() } else { name };
            std::fs::create_dir_all(&imports)?;
            std::fs::copy(&p, free_path(&imports, &name, ext))?;
        }
    }
    let old_lib = data.join("library");
    let maps: Vec<PathBuf> = std::fs::read(old_lib.join("maps.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let mut all_moved = true;
    for m in maps {
        match add_map(&m) {
            Ok(_) => {}
            Err(e) => {
                eprintln!("couldn't bring {} into the library folder: {e:#}", m.display());
                all_moved = false;
            }
        }
    }
    std::fs::write(&done, b"")?;
    // (never the library itself, whatever the folders' names come to)
    let same = old_lib.canonicalize().ok().zip(root.canonicalize().ok()).is_some_and(|(a, b)| b.starts_with(&a) || a.starts_with(&b));
    if all_moved && old_lib.exists() && !same {
        std::fs::remove_dir_all(&old_lib).ok();
        // and what the viewport had prepared from it
        for c in ["default-library", "user-library"] {
            std::fs::remove_dir_all(data.join("cache").join(c)).ok();
        }
    }
    Ok(())
}
