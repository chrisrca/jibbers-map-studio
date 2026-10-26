//! The game: its look read from the player's copy (objects, lights, sky, snow), its maps, and playing in it (embedded in the studio or popped out).

use serde::Serialize;
use tauri::ipc::Response;
use crate::{game, gamelook};
use super::{err, library_dir, CmdResult};

/// The piece with the game's look a placed game object (a feature with its settings) is drawn as, or None.
#[tauri::command]
pub async fn game_object_look(app: tauri::AppHandle, id: String, params: std::collections::HashMap<String, String>) -> CmdResult<Option<String>> {
    let app_root = library_dir(&app).join("Library");
    let placeholders = library_dir(&app).join("placeholders").join("placeholders.json");
    tauri::async_runtime::spawn_blocking(move || crate::gamelook::features::piece_for(&app_root, &placeholders, &id, &params).map(|p| p.map(|p| p.to_string_lossy().into_owned())))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

/// The game's features' lights (gamelook/mod.rs's index): by feature id, or nothing before the game's look is read.
#[tauri::command]
pub async fn game_lights() -> CmdResult<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<serde_json::Value> {
        let index = crate::gamelook::features::look_dir()?.join("index.json");
        let v: serde_json::Value = std::fs::read(&index).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Ok(v.get("lights").cloned().unwrap_or_else(|| serde_json::json!({})))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// The game's mark (its icon, from the player's Jibbers.exe) as a PNG; empty without the game.
#[tauri::command]
pub async fn game_mark() -> CmdResult<Response> {
    tauri::async_runtime::spawn_blocking(|| crate::gamelook::icon::mark(64).map(|p| Response::new(p.unwrap_or_default())))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

/// The game's look read, when it hasn't been yet or is from an older reading (the asset list reads it too: the
/// second one waits for the first).
pub fn game_look_read(app: &tauri::AppHandle) {
    let placeholders = library_dir(app).join("placeholders").join("placeholders.json");
    if let Err(e) = crate::gamelook::features::look_dir().and_then(|d| gamelook::ensure(&d, &placeholders)) {
        eprintln!("game look: {e:#}");
    }
}

/// The game's sky (gamelook/sky.rs: its shader as WGSL, its sky states and settings), or null without the game.
#[tauri::command]
pub async fn game_sky(app: tauri::AppHandle) -> CmdResult<Option<serde_json::Value>> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<Option<serde_json::Value>> {
        game_look_read(&app);
        let f = crate::gamelook::features::look_dir()?.join("sky.json");
        Ok(std::fs::read(f).ok().and_then(|b| serde_json::from_slice(&b).ok()))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// The game's snow (gameterrain): its terrain textures and numbers, or null without the game.
#[tauri::command]
pub async fn game_terrain(app: tauri::AppHandle) -> CmdResult<Option<serde_json::Value>> {
    tauri::async_runtime::spawn_blocking(move || {
        game_look_read(&app);
        crate::gamelook::terrain::read()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// The wheels the game turns on its pieces (crate::gamelook::features::spins): by piece id.
#[tauri::command]
pub async fn game_spins() -> CmdResult<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(crate::gamelook::features::spins).await.map_err(|e| e.to_string())?.map_err(err)
}

#[tauri::command]
pub async fn game_status() -> crate::game::embed::Status {
    tauri::async_runtime::spawn_blocking(crate::game::embed::status).await.unwrap_or(crate::game::embed::Status::NotRunning)
}

/// Pulls the running game into the Game tab at `area`; false while the game hasn't opened its window yet.
/// (Like all window work on the game, on its own thread: see game/embed.rs.)
#[tauri::command]
pub async fn game_attach(window: tauri::WebviewWindow, area: crate::game::embed::Area) -> CmdResult<bool> {
    let parent = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    tauri::async_runtime::spawn_blocking(move || crate::game::embed::on_window_thread(move || crate::game::embed::attach(parent as _, area)).unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

/// Writes the game diagnostics report to `path` (see game/diag.rs).
#[tauri::command]
pub fn save_game_diagnostics(window: tauri::WebviewWindow, path: String, frontend: String) -> CmdResult<()> {
    let hwnd = window.hwnd().ok().map(|h| h.0 as windows_sys::Win32::Foundation::HWND);
    std::fs::write(&path, crate::game::diag::report(hwnd, &frontend)).map_err(|e| e.to_string())
}

/// Closes Jibbers (so it isn't left running in the background).
#[tauri::command]
pub async fn game_close() -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(game::close_game).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn game_set_visible(app: tauri::AppHandle, visible: bool) -> CmdResult<()> {
    let focus = tauri::async_runtime::spawn_blocking(move || crate::game::embed::on_window_thread(move || crate::game::embed::set_visible(visible)).unwrap_or(false))
        .await
        .map_err(|e| e.to_string())?;
    if focus {
        app.run_on_main_thread(crate::game::embed::focus).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn game_focus() {
    crate::game::embed::focus()
}

/// "Pop out": the game in a window of its own, left there (see crate::game::embed::pop_out).
#[tauri::command]
pub async fn game_pop_out() {
    let _ = tauri::async_runtime::spawn_blocking(|| crate::game::embed::on_window_thread(crate::game::embed::pop_out)).await;
}

#[tauri::command]
pub async fn game_release() {
    let _ = tauri::async_runtime::spawn_blocking(|| crate::game::embed::on_window_thread(crate::game::embed::release)).await;
}

/// How the studio's link is doing in the game started at `since_ms`: "ok", why it isn't working, or null (not reported yet).
#[tauri::command]
pub fn link_health(since_ms: u64) -> Option<String> {
    game::link_health(since_ms)
}

/// Exports must already be done; (re)starts the game on `map_id`. Async: closing a running game takes a moment.
#[tauri::command]
pub async fn play_in_game(map_id: String, embed: bool) -> CmdResult<game::PlayOutcome> {
    tauri::async_runtime::spawn_blocking(move || game::play(&map_id, embed))
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapListing {
    path: String,
    name: String,
    id: String,
    bytes: u64,
    modified: u64,
}

/// A top-level string field from the start of a map's JSON, however it's spaced (maps written by other tools have
/// `"name":"…"`, the game's `"name": "…"`).
pub fn head_field(head: &str, k: &str) -> String {
    let key = format!("\"{k}\"");
    let Some(i) = head.find(&key) else { return String::new() };
    let rest = head[i + key.len()..].trim_start();
    let Some(rest) = rest.strip_prefix(':') else { return String::new() };
    let Some(rest) = rest.trim_start().strip_prefix('"') else { return String::new() };
    // (up to the closing quote; an escaped one is part of it)
    let mut out = String::new();
    let mut chars = rest.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => return out,
            '\\' => match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some(c) => out.push(c),
                None => break,
            },
            c => out.push(c),
        }
    }
    out
}

/// Lists maps in the game's folder; only reads each file's first few KB for the name.
#[tauri::command]
pub fn list_game_maps() -> CmdResult<Vec<MapListing>> {
    use std::io::Read;
    let dir = game::maps_dir().map_err(err)?;
    let mut out = vec![];
    let Ok(rd) = std::fs::read_dir(&dir) else { return Ok(out) };
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|s| s.to_str()) != Some("jbrmap") {
            continue;
        }
        let mut head = vec![0u8; 4096];
        let n = std::fs::File::open(&p).and_then(|mut f| f.read(&mut head)).unwrap_or(0);
        let head = String::from_utf8_lossy(&head[..n]).to_string();
        let field = |k: &str| head_field(&head, k);
        let meta = e.metadata().ok();
        out.push(MapListing {
            path: p.display().to_string(),
            name: field("name"),
            id: field("id"),
            bytes: meta.as_ref().map_or(0, |m| m.len()),
            modified: meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_secs()),
        });
    }
    out.sort_by_key(|m| std::cmp::Reverse(m.modified));
    Ok(out)
}

#[cfg(test)]
mod head_field_test {
    use super::head_field;

    #[test]
    fn reads_names_however_spaced() {
        assert_eq!(head_field(r#"{ "id": "a1", "name": "MLNZ Park", "version": "0.4""#, "name"), "MLNZ Park");
        assert_eq!(head_field(r#"{"id":"b2","name":"We Ski - Mountain 1 (Day)","version":"0.4""#, "name"), "We Ski - Mountain 1 (Day)");
        assert_eq!(head_field(r#"{"id":"b2","name":"We Ski","version":"0.4""#, "id"), "b2");
        assert_eq!(head_field(r#"{"name":"The \"Big\" One"}"#, "name"), r#"The "Big" One"#);
        assert_eq!(head_field(r#"{"version":"0.4"}"#, "name"), "");
    }
}
