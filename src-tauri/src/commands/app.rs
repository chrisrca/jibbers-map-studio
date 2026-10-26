//! The app itself: its folders, the self-tests, logs and lag reports, the recycle bin.

use std::path::PathBuf;
use serde::Serialize;
use crate::{bootlog, game};
use super::{err, library_dir, CmdResult};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    maps_dir: String,
    game_exe: Option<String>,
    library_dir: String,
    /// the studio's own data folder (your library, caches)
    data_dir: String,
}

#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> CmdResult<AppInfo> {
    Ok(AppInfo {
        maps_dir: game::maps_dir().map_err(err)?.display().to_string(),
        game_exe: game::find_game().map(|p| p.display().to_string()),
        library_dir: library_dir(&app).canonicalize().unwrap_or(library_dir(&app)).display().to_string(),
        data_dir: crate::library::userassets::data_dir().map_err(err)?.display().to_string(),
    })
}

/// Directory for the automated self-test run (env STUDIO_SELFTEST), if requested.
#[tauri::command]
pub fn selftest_dir() -> Option<String> {
    std::env::var("STUDIO_SELFTEST").ok().filter(|s| !s.is_empty())
}

/// Frontend console errors/warnings, mirrored to stdout so they show up in the dev terminal.
#[tauri::command]
pub fn frontend_log(level: String, message: String) {
    println!("[webview {level}] {message}");
    // release builds have no console: during a self-test also append to <dir>/selftest.log
    if let Some(dir) = selftest_dir() {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(PathBuf::from(dir).join("selftest.log")) {
            let _ = writeln!(f, "[{level}] {message}");
        }
    }
}

/// A step of the start done, from the page (bootlog.rs).
#[tauri::command]
pub fn boot_mark(what: String) {
    bootlog::mark(&what);
}

/// The lag watcher's report: the frontend's figures plus the machine's (game window, GPU, processes), saved under
/// `<studio data>\lag-reports\`. Returns the file's path.
#[tauri::command]
pub async fn save_lag_report(text: String) -> CmdResult<String> {
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<String> {
        let mut out = text;
        let run = |cmd: &str, args: &[&str]| -> String {
            use std::os::windows::process::CommandExt;
            match std::process::Command::new(cmd).args(args).creation_flags(0x0800_0000 /* CREATE_NO_WINDOW */).output() {
                Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
                Err(e) => format!("({cmd} unavailable: {e})"),
            }
        };
        out.push_str("== the game window\n");
        out.push_str(&crate::game::embed::debug_info());
        if let Ok(maps) = game::maps_dir() {
            let dir = maps.parent().unwrap();
            let state = std::fs::read_to_string(dir.join("studio-game-size.json")).unwrap_or_default();
            out.push_str(&format!("studio -> game: {state}\n"));
            let status = std::fs::read_to_string(dir.join("studio-game-status.json")).unwrap_or_default();
            out.push_str(&format!("game says: {status}\n"));
        }
        out.push_str("\n== GPU\n");
        out.push_str(&run("nvidia-smi", &["--query-gpu=name,memory.used,memory.total,utilization.gpu,clocks.gr,pstate", "--format=csv"]));
        out.push_str("\n\n== GPU use by process (3D engine, %)\n");
        out.push_str(&run("powershell", &["-NoProfile", "-Command",
            "(Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples | Where-Object { $_.CookedValue -gt 0.5 } | Sort-Object CookedValue -Descending | Select-Object -First 8 | ForEach-Object { $p = if ($_.InstanceName -match 'pid_(\\d+)') { (Get-Process -Id $Matches[1] -ErrorAction SilentlyContinue).ProcessName } ; '{0,6:N1}  {1}  {2}' -f $_.CookedValue, $p, $_.InstanceName }"]));
        out.push_str("\n\n== processes (CPU seconds, memory)\n");
        out.push_str(&run("powershell", &["-NoProfile", "-Command",
            "Get-Process jibbers-studio, Jibbers, msedgewebview2, parsecd -ErrorAction SilentlyContinue | Sort-Object CPU -Descending | Select-Object -First 12 | ForEach-Object { '{0,-16} pid {1,-6} cpu {2,8:N1}s  mem {3,6:N0} MB' -f $_.ProcessName, $_.Id, $_.CPU, ($_.WorkingSet64 / 1MB) }"]));
        out.push('\n');
        let dir = crate::library::userassets::data_dir()?.join("lag-reports");
        std::fs::create_dir_all(&dir)?;
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let path = dir.join(format!("lag-{stamp}.txt"));
        std::fs::write(&path, out)?;
        Ok(path.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(err)
}

/// Sends a studio project folder or a map in the game's Maps folder to the Recycle Bin (recoverable). Anything
/// else is refused.
///
/// Windows' own SHFileOperation, as Explorer uses: a 150 MB project goes in ~0.4 s — but the first in a while can take
/// much longer, while Windows sizes up the Recycle Bin (21 s with 12 GB in 18,000 files in it), which once froze the
/// whole app, run on the window's thread. So: on a thread of its own (the editor drops it from its list at once and
/// lets this finish); anything Windows has to ask (a project too big for the Recycle Bin) is asked over the studio's
/// window, not behind it.
#[tauri::command]
pub async fn recycle(window: tauri::WebviewWindow, path: String) -> CmdResult<()> {
    let p = PathBuf::from(&path);
    let is_project = p.is_dir() && p.join("project.json").is_file();
    let is_game_map = p.extension().is_some_and(|e| e == "jbrmap")
        && game::maps_dir().ok().zip(p.parent()).is_some_and(|(maps, parent)| maps == parent);
    if !is_project && !is_game_map {
        return Err(format!("not a studio project or a game map: {path}"));
    }
    // (a full path: given a relative one, Windows deletes outright instead of recycling)
    let abs = std::path::absolute(&p).map_err(|e| e.to_string())?;
    let owner = window.hwnd().map(|h| h.0 as isize).unwrap_or(0);
    let (tx, rx) = tauri::async_runtime::channel::<Result<(), String>>(1);
    std::thread::Builder::new()
        .name("recycle".into())
        .spawn(move || {
            // the shell's file operations expect a single-threaded COM apartment, as Explorer's own threads have
            unsafe { windows_sys::Win32::System::Com::CoInitializeEx(std::ptr::null(), windows_sys::Win32::System::Com::COINIT_APARTMENTTHREADED as _) };
            let r = to_recycle_bin(&abs, owner);
            unsafe { windows_sys::Win32::System::Com::CoUninitialize() };
            let _ = tx.blocking_send(r);
        })
        .map_err(|e| e.to_string())?;
    let mut rx = rx;
    rx.recv().await.unwrap_or_else(|| Err("the delete stopped without saying why".into()))
}

pub fn to_recycle_bin(path: &std::path::Path, owner: isize) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_SILENT, FOF_WANTNUKEWARNING, FO_DELETE, SHFILEOPSTRUCTW};
    // the path list ends in two nulls
    let mut from: Vec<u16> = path.as_os_str().encode_wide().collect();
    from.extend([0, 0]);
    let mut op = SHFILEOPSTRUCTW {
        hwnd: owner as _,
        wFunc: FO_DELETE,
        pFrom: from.as_ptr(),
        pTo: std::ptr::null(),
        // to the Recycle Bin, without the "are you sure" (the studio asked) or a progress window; if it can't be
        // recycled (too big), ask rather than delete it for good
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_WANTNUKEWARNING) as _,
        fAnyOperationsAborted: 0,
        hNameMappings: std::ptr::null_mut(),
        lpszProgressTitle: std::ptr::null(),
    };
    let r = unsafe { SHFileOperationW(&mut op) };
    if r != 0 {
        return Err(format!("Windows couldn't move it to the Recycle Bin (error {r:#x})"));
    }
    if op.fAnyOperationsAborted != 0 {
        return Err("cancelled".into());
    }
    Ok(())
}
