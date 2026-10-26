//! Files the page reads and writes (text, bytes, images), and folders copied.

use std::path::PathBuf;
use tauri::ipc::{InvokeBody, Request, Response};
use super::{err, CmdResult};

#[tauri::command]
pub fn read_text(path: String) -> CmdResult<String> {
    std::fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))
}

#[tauri::command]
pub fn write_text(path: String, text: String) -> CmdResult<()> {
    if let Some(p) = PathBuf::from(&path).parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, text).map_err(|e| format!("write {path}: {e}"))
}

/// Raw binary read; the frontend receives an ArrayBuffer.
#[tauri::command]
pub fn read_binary(path: String) -> CmdResult<Response> {
    std::fs::read(&path).map(Response::new).map_err(|e| format!("read {path}: {e}"))
}

/// An image's exact RGBA bytes (snow masks: every channel as stored, no premultiplying), after an 8-byte header of
/// width and height (little-endian u32).
#[tauri::command]
pub fn read_image_rgba(path: String) -> CmdResult<Response> {
    let img = image::open(&path).map_err(|e| format!("read {path}: {e}"))?.to_rgba8();
    let mut out = Vec::with_capacity(8 + img.as_raw().len());
    out.extend_from_slice(&img.width().to_le_bytes());
    out.extend_from_slice(&img.height().to_le_bytes());
    out.extend_from_slice(img.as_raw());
    Ok(Response::new(out))
}

/// Raw binary write: body is the bytes, target path in the `x-path` header (URI-encoded).
#[tauri::command]
pub fn write_binary(request: Request<'_>) -> CmdResult<()> {
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .ok_or("missing x-path header")?;
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw body".into()) };
    let path = PathBuf::from(path);
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

pub fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    PathBuf::from(path).exists()
}

/// A file's size and when it was last written (ms since 1970), if it's there: tells whether a map in the game is
/// still the one this studio wrote.
#[tauri::command]
pub fn file_stamp(path: String) -> Option<(u64, u64)> {
    let m = std::fs::metadata(path).ok()?;
    let ms = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
    Some((m.len(), ms))
}

/// A folder copied, everything in it (an untitled map saved somewhere of its own). Refuses to write over a folder
/// that's there.
#[tauri::command]
pub async fn copy_dir(from: String, to: String) -> CmdResult<()> {
    fn copy(from: &std::path::Path, to: &std::path::Path) -> anyhow::Result<()> {
        std::fs::create_dir_all(to)?;
        for e in std::fs::read_dir(from)? {
            let e = e?;
            let dest = to.join(e.file_name());
            if e.file_type()?.is_dir() {
                copy(&e.path(), &dest)?;
            } else {
                std::fs::copy(e.path(), dest)?;
            }
        }
        Ok(())
    }
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<()> {
        let to = PathBuf::from(&to);
        if to.exists() {
            anyhow::bail!("{} is already there", to.display());
        }
        copy(&PathBuf::from(&from), &to)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}
