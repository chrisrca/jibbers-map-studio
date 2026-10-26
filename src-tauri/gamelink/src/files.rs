//! The files the link shares with the studio (in the game's Jibbers folder): its log, its state for the studio to
//! read, the studio's requests.

use super::*;

pub(crate) fn jibbers_dir() -> PathBuf {
    PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("Jibbers")
}

pub(crate) fn log(line: &str) {
    use std::io::Write;
    let path = jibbers_dir().join("studio-link.log");
    // (kept short: started afresh once it's grown)
    let append = std::fs::metadata(&path).map(|m| m.len() < 256 * 1024).unwrap_or(false);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).write(true).append(append).truncate(!append).open(path) {
        let _ = writeln!(f, "{:>9.1}  {line}", started().elapsed().as_secs_f32());
    }
}

pub(crate) fn started() -> Instant {
    static T: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    *T.get_or_init(Instant::now)
}

/// studio-link.json: the link's version, the game build it's in, how it's doing ("starting", "ok", or why not), the
/// map it was asked for and the game's process (the studio reloads in place only a game it knows is on that map).
pub(crate) fn report(state: &str, map: &str) {
    let game_ms = std::env::current_exe()
        .ok()
        .and_then(|e| std::fs::metadata(e.with_file_name("GameAssembly.dll")).ok())
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let v = serde_json::json!({ "version": VERSION, "gameMs": game_ms, "state": state, "map": map, "pid": unsafe { GetCurrentProcessId() } });
    let _ = std::fs::write(jibbers_dir().join("studio-link.json"), v.to_string());
}

pub(crate) fn read_json(name: &str) -> Option<serde_json::Value> {
    serde_json::from_slice(&std::fs::read(jibbers_dir().join(name)).ok()?).ok()
}
