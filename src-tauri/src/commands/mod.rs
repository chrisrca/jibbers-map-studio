//! The commands the page calls (tauri's invoke), by area; what they share.

pub mod app;
pub mod files;
pub mod net;
pub mod projects;
pub mod assets;
pub mod library;
pub mod game;

use std::path::PathBuf;
use tauri::Manager;

pub type CmdResult<T> = Result<T, String>;

pub fn err(e: anyhow::Error) -> String {
    format!("{e:#}")
}

pub fn library_dir(app: &tauri::AppHandle) -> PathBuf {
    let bundled = app.path().resource_dir().map(|d| d.join("library")).ok();
    match bundled {
        Some(d) if d.join("placeholders").exists() => d,
        // dev: studio/library next to src-tauri
        _ => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("library"),
    }
}
