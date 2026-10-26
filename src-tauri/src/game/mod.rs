//! Locating the Jibbers install and its maps folder, and launching the game.

pub mod diag;
pub mod embed;

use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

/// `%APPDATA%\Jibbers\Maps` — where the game loads custom maps from (Map-Tools `Utility.DataPath`).
pub fn maps_dir() -> Result<PathBuf> {
    Ok(PathBuf::from(std::env::var("APPDATA").context("APPDATA not set")?).join("Jibbers").join("Maps"))
}

const GAME_DIR: &str = r"steamapps\common\Jibbers Playtest";
const GAME_EXE: &str = "Jibbers.exe";

fn steam_root() -> Option<PathBuf> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Valve\Steam").ok()?;
    let path: String = key.get_value("SteamPath").ok()?;
    Some(PathBuf::from(path.replace('/', "\\")))
}

/// Steam library roots: the Steam install plus every `"path"` in `libraryfolders.vdf`.
fn steam_libraries() -> Vec<PathBuf> {
    let mut libs = vec![];
    let root = steam_root().unwrap_or_else(|| PathBuf::from(r"C:\Program Files (x86)\Steam"));
    libs.push(root.clone());
    if let Ok(vdf) = std::fs::read_to_string(root.join(r"steamapps\libraryfolders.vdf")) {
        for line in vdf.lines() {
            let t = line.trim();
            if let Some(rest) = t.strip_prefix("\"path\"") {
                let p = rest.trim().trim_matches('"').replace("\\\\", "\\");
                libs.push(PathBuf::from(p));
            }
        }
    }
    libs
}

pub fn find_game() -> Option<PathBuf> {
    steam_libraries().into_iter().map(|l| l.join(GAME_DIR).join(GAME_EXE)).find(|p| p.exists())
}

/// Steam app id of the installed Jibbers build, read from its `appmanifest_<id>.acf`.
fn steam_app_id() -> Option<String> {
    for lib in steam_libraries() {
        let Ok(rd) = std::fs::read_dir(lib.join("steamapps")) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !(name.starts_with("appmanifest_") && name.ends_with(".acf")) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
            if text.lines().any(|l| l.trim().starts_with("\"installdir\"") && l.contains("Jibbers Playtest")) {
                return Some(name.trim_start_matches("appmanifest_").trim_end_matches(".acf").to_string());
            }
        }
    }
    None
}

/// Launches through Steam: the game calls SteamAPI_Init and quits immediately when its exe is
/// started directly.
pub fn launch() -> Result<()> {
    let id = steam_app_id().context("Jibbers isn't installed in any Steam library")?;
    std::process::Command::new("explorer.exe")
        .arg(format!("steam://rungameid/{id}"))
        .spawn()
        .context("ask Steam to launch Jibbers")?;
    Ok(())
}

/// What `play` did, for the UI to report.
#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PlayOutcome {
    /// The running game, already on this map, reloaded it in place.
    Reloaded,
    /// The running game was closed and started again on the map.
    Restarted,
    /// The game was started on the map.
    Launched,
}

/// `%APPDATA%\Jibbers\studio-link.json`: written by the link as it loads (version, the game build it loaded into,
/// and whether it's working).
fn link_report_path() -> Result<PathBuf> {
    Ok(maps_dir()?.parent().unwrap().join("studio-link.json"))
}

/// How the link is doing in the game started at `since` (ms since 1970): "ok", a reason it isn't working, or None
/// while it hasn't reported yet.
pub fn link_health(since_ms: u64) -> Option<String> {
    let since = std::time::UNIX_EPOCH + std::time::Duration::from_millis(since_ms);
    let report = link_report_path().ok()?;
    if !std::fs::metadata(&report).and_then(|m| m.modified()).is_ok_and(|t| t >= since) {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(report).ok()?).ok()?;
    match v.get("state").and_then(|s| s.as_str()) {
        Some("starting") | None => None,
        Some(s) => Some(s.to_string()),
    }
}

/// `%APPDATA%\Jibbers\studio-play.json`: what the link is to do (the map, and whether it's shown in the studio).
fn request_path() -> Result<PathBuf> {
    Ok(maps_dir()?.parent().unwrap().join("studio-play.json"))
}

fn game_pid() -> Option<u32> {
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap.is_null() || snap == windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE {
            return None;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = None;
        let mut ok = Process32FirstW(snap, &mut e);
        while ok != 0 {
            let n = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            if String::from_utf16_lossy(&e.szExeFile[..n]).eq_ignore_ascii_case(GAME_EXE) {
                found = Some(e.th32ProcessID);
                break;
            }
            ok = Process32NextW(snap, &mut e);
        }
        windows_sys::Win32::Foundation::CloseHandle(snap);
        found
    }
}

fn game_running() -> bool {
    game_pid().is_some()
}

/// The game's own settings (`%APPDATA%\Jibbers\config.jbrconf`) set to start on `map_id`: the map the game's map
/// picker would have chosen, and the loading screen's way on to it. Only while the game is closed (it keeps its
/// settings in memory and writes them back on quitting).
fn set_game_map(map_id: &str) -> Result<()> {
    let path = maps_dir()?.parent().unwrap().join("config.jbrconf");
    let mut cfg: serde_json::Value = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_else(|| serde_json::json!({}));
    let root = cfg.as_object_mut().context("the game's settings aren't an object")?;
    let strings = root.entry("strings").or_insert_with(|| serde_json::json!({}));
    let strings = strings.as_object_mut().context("the game's settings have no strings")?;
    strings.insert("map-id".into(), map_id.into());
    strings.insert("next-scene".into(), "Main".into());
    let tmp = path.with_extension("studio-tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&cfg)?.replace('\n', "\r\n"))?;
    std::fs::rename(&tmp, &path).context("write the game's settings")?;
    Ok(())
}

/// Plays `map_id`: the game started fresh on it (closed first if it's running: reloading a map inside a running
/// game leaves it in odd states, a fresh start is always clean), with the studio's link loaded into it, which takes
/// it straight to the map. `embed`: the game is shown in the studio's Game tab, so the link runs it windowed.
pub fn play(map_id: &str, embed: bool) -> Result<PlayOutcome> {
    let pid = game_pid();
    // the game already on this map, shown the same way, with the link working: the map reloaded in place
    if let Some(pid) = pid {
        if link_on(pid, map_id) && last_embed() == Some(embed) {
            write_request(map_id, embed, true)?;
            return Ok(PlayOutcome::Reloaded);
        }
        stop_game();
    }
    let generation = PLAY_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    set_game_map(map_id)?;
    write_request(map_id, embed, false)?;
    // in the Game tab: started windowed where the tab is, so it never fills the screen first; else as the player has it
    // (the Game tab opens as Play is pressed: a moment for it to say where it is)
    let t0 = std::time::Instant::now();
    while embed && embed::tab_screen_rect().is_none() && t0.elapsed() < std::time::Duration::from_millis(1500) {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    match embed::tab_screen_rect().filter(|_| embed) {
        Some(rect) => screen_for_studio(rect),
        None => restore_screen(),
    }
    let dll = link_dll()?;
    launch()?;
    // the link loaded into the game as soon as it's there (it waits for the game to be up itself); the player's own
    // screen mode put back once the game has closed
    std::thread::spawn(move || {
        let t0 = std::time::Instant::now();
        while t0.elapsed() < std::time::Duration::from_secs(180) {
            if let Some(pid) = game_pid() {
                if let Err(e) = load_into(pid, &dll) {
                    eprintln!("couldn't load the studio link into the game: {e:#}");
                    if let Ok(p) = link_report_path() {
                        std::fs::write(p, serde_json::json!({ "state": format!("couldn't load into the game: {e:#}") }).to_string()).ok();
                    }
                }
                while game_pid() == Some(pid) {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
                // (unless another Play has started the game again since)
                if PLAY_GENERATION.load(std::sync::atomic::Ordering::SeqCst) == generation {
                    restore_screen();
                }
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
    });
    Ok(if pid.is_some() { PlayOutcome::Restarted } else { PlayOutcome::Launched })
}

/// Each Play that starts the game: a game closing after a newer Play has started doesn't put the screen back.
static PLAY_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// studio-play.json: the map, whether it's shown in the studio, and (`reload`) a reload of the running game.
fn write_request(map_id: &str, embed: bool, reload: bool) -> Result<()> {
    let path = request_path()?;
    let tmp = path.with_extension("tmp");
    let mut v = serde_json::json!({ "mapId": map_id, "embed": embed });
    if reload {
        v["reload"] = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0).into();
    }
    std::fs::write(&tmp, v.to_string()).context("write play request")?;
    std::fs::rename(&tmp, &path).context("write play request")?;
    Ok(())
}

/// Whether the link is working in game process `pid`, on map `map_id`.
fn link_on(pid: u32, map_id: &str) -> bool {
    let Some(v) = link_report_path().ok().and_then(|p| std::fs::read(p).ok()).and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok()) else { return false };
    v["state"] == "ok" && v["map"] == map_id && v["pid"].as_u64() == Some(pid as u64)
}

/// Whether the last Play showed the game in the studio.
fn last_embed() -> Option<bool> {
    let v: serde_json::Value = serde_json::from_slice(&std::fs::read(request_path().ok()?).ok()?).ok()?;
    v["embed"].as_bool()
}

// ------------------------------------------------------------------ the game's screen mode, while it's in the studio

/// `%APPDATA%\Jibbers\studio-screen-restore.txt`: the player's own screen mode ("mode width height") while the
/// studio has the game windowed.
fn screen_restore_path() -> Result<PathBuf> {
    Ok(maps_dir()?.parent().unwrap().join("studio-screen-restore.txt"))
}

/// The game's display settings: Unity keeps them under HKCU\Software\<company>\<product>, each value's name ending
/// in a hash (`Screenmanager Fullscreen mode_h3630240806`). The key, and the full names of the values wanted.
fn screen_values(wanted: &[&str]) -> Option<(winreg::RegKey, Vec<Option<String>>)> {
    use winreg::{enums::*, RegKey};
    let sw = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software").ok()?;
    for company in sw.enum_keys().flatten() {
        let Ok(ck) = sw.open_subkey(&company) else { continue };
        for product in ck.enum_keys().flatten().filter(|p| p.eq_ignore_ascii_case("jibbers")) {
            let Ok(key) = ck.open_subkey_with_flags(&product, KEY_READ | KEY_WRITE) else { continue };
            let names: Vec<String> = key.enum_values().flatten().map(|(n, _)| n).collect();
            let found = wanted.iter().map(|w| names.iter().find(|n| n.starts_with(&format!("{w}_h"))).cloned()).collect();
            return Some((key, found));
        }
    }
    None
}

const SCREEN_MODE: &str = "Screenmanager Fullscreen mode";
const SCREEN_W: &str = "Screenmanager Resolution Width";
const SCREEN_H: &str = "Screenmanager Resolution Height";
const SCREEN_X: &str = "Screenmanager Window Position X";
const SCREEN_Y: &str = "Screenmanager Window Position Y";

/// The game's next start windowed at the Game tab's place and size (`rect`: x, y, width, height on the screen), the
/// player's own mode kept to put back (the first time only: a restart from the studio keeps the original).
fn screen_for_studio((x, y, w, h): (i32, i32, i32, i32)) {
    let Some((key, names)) = screen_values(&[SCREEN_MODE, SCREEN_W, SCREEN_H, SCREEN_X, SCREEN_Y]) else { return };
    let get = |i: usize| names[i].as_ref().and_then(|n| key.get_value::<u32, _>(n).ok());
    if let Ok(restore) = screen_restore_path() {
        if !restore.exists() {
            if let (Some(mode), Some(rw), Some(rh)) = (get(0), get(1), get(2)) {
                std::fs::write(restore, format!("{mode} {rw} {rh}")).ok();
            }
        }
    }
    for (i, v) in [(0, 3u32), (1, w as u32), (2, h as u32), (3, x as u32), (4, y as u32)] {
        if let Some(n) = &names[i] {
            key.set_value(n, &v).ok();
        }
    }
}

/// The player's own screen mode put back (when the studio has changed it and the game isn't running).
pub fn restore_screen() {
    let Ok(path) = screen_restore_path() else { return };
    let Ok(text) = std::fs::read_to_string(&path) else { return };
    if game_running() {
        return;
    }
    let nums: Vec<u32> = text.split_whitespace().filter_map(|t| t.parse().ok()).collect();
    if let (Some((key, names)), [mode, w, h, ..]) = (screen_values(&[SCREEN_MODE, SCREEN_W, SCREEN_H]), nums.as_slice()) {
        for (n, v) in names.iter().zip([*mode, *w, *h]) {
            if let Some(n) = n {
                key.set_value(n, &v).ok();
            }
        }
    }
    std::fs::remove_file(path).ok();
}

/// The studio's link (src-tauri/gamelink), built with the studio.
const LINK_DLL: &[u8] = include_bytes!(env!("JIBBERS_LINK_DLL"));

/// The link written out to load: in the studio's data folder, named by its contents (a game still running an older
/// one keeps that file locked; this one sits beside it).
fn link_dll() -> Result<PathBuf> {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in LINK_DLL {
        h = (h ^ *b as u64).wrapping_mul(0x100000001b3);
    }
    let dir = crate::library::userassets::data_dir()?.join("link");
    let path = dir.join(format!("jibbers-link-{h:016x}.dll"));
    if std::fs::read(&path).ok().as_deref() != Some(LINK_DLL) {
        std::fs::create_dir_all(&dir)?;
        std::fs::write(&path, LINK_DLL).context("write the studio link")?;
    }
    Ok(path)
}

/// Loads `dll` into process `pid` (the game): a thread of the game's runs LoadLibraryW on its path.
fn load_into(pid: u32, dll: &Path) -> Result<()> {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows_sys::Win32::System::Diagnostics::Debug::WriteProcessMemory;
    use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
    use windows_sys::Win32::System::Memory::{VirtualAllocEx, VirtualFreeEx, MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE};
    use windows_sys::Win32::System::Threading::{
        CreateRemoteThread, GetExitCodeThread, OpenProcess, WaitForSingleObject, PROCESS_CREATE_THREAD, PROCESS_QUERY_INFORMATION, PROCESS_VM_OPERATION, PROCESS_VM_READ, PROCESS_VM_WRITE,
    };
    let wide: Vec<u16> = dll.as_os_str().encode_wide().chain([0]).collect();
    unsafe {
        let process = OpenProcess(PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION | PROCESS_VM_WRITE | PROCESS_VM_READ, 0, pid);
        anyhow::ensure!(!process.is_null(), "can't open the game's process ({})", std::io::Error::last_os_error());
        let result = (|| -> Result<()> {
            let bytes = wide.len() * 2;
            let remote = VirtualAllocEx(process, std::ptr::null(), bytes, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
            anyhow::ensure!(!remote.is_null(), "no room in the game's memory ({})", std::io::Error::last_os_error());
            let done = (|| -> Result<()> {
                anyhow::ensure!(WriteProcessMemory(process, remote, wide.as_ptr().cast(), bytes, std::ptr::null_mut()) != 0, "can't write the path ({})", std::io::Error::last_os_error());
                let k32: Vec<u16> = "kernel32.dll\0".encode_utf16().collect();
                let load = GetProcAddress(GetModuleHandleW(k32.as_ptr()), c"LoadLibraryW".as_ptr().cast()).context("no LoadLibraryW")?;
                let start: unsafe extern "system" fn(*mut std::ffi::c_void) -> u32 = std::mem::transmute(load);
                let thread = CreateRemoteThread(process, std::ptr::null(), 0, Some(start), remote, 0, std::ptr::null_mut());
                anyhow::ensure!(!thread.is_null(), "can't start a thread in the game ({})", std::io::Error::last_os_error());
                let waited = WaitForSingleObject(thread, 15_000);
                let mut module = 0u32;
                GetExitCodeThread(thread, &mut module);
                CloseHandle(thread);
                anyhow::ensure!(waited == WAIT_OBJECT_0, "the game didn't load it in time");
                anyhow::ensure!(module != 0, "the game couldn't load it");
                Ok(())
            })();
            VirtualFreeEx(process, remote, 0, MEM_RELEASE);
            done
        })();
        CloseHandle(process);
        result
    }
}

fn taskkill(force: bool) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = std::process::Command::new("taskkill");
    if force {
        cmd.arg("/F");
    }
    cmd.args(["/IM", GAME_EXE]).creation_flags(CREATE_NO_WINDOW).output().ok();
}

/// Closes the game like its close button would, and forcefully if it hasn't gone within a few seconds.
/// Closes the game (like its close button would; forcefully if it doesn't go within a few seconds).
pub fn close_game() {
    if game_running() {
        stop_game();
    }
}

fn stop_game() {
    embed::close_embedded_game();
    taskkill(false);
    for i in 0..40 {
        if !game_running() {
            return;
        }
        if i == 24 {
            taskkill(true); // ~6 s and still there
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
}

#[cfg(test)]
mod tests {
    /// The link loaded into a process of our own (Notepad, started here and closed by its id): it loads, says so in
    /// its log, and waits harmlessly for a game runtime that never comes.
    #[test]
    #[ignore]
    fn loads_the_link_into_a_process() {
        let log = super::maps_dir().unwrap().parent().unwrap().join("studio-link.log");
        let before = std::fs::read_to_string(&log).unwrap_or_default().len();
        let mut child = std::process::Command::new("notepad.exe").spawn().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(800));
        let dll = super::link_dll().unwrap();
        let r = super::load_into(child.id(), &dll);
        std::thread::sleep(std::time::Duration::from_millis(800));
        let alive = child.try_wait().unwrap().is_none();
        child.kill().ok();
        let text = std::fs::read_to_string(&log).unwrap_or_default();
        println!("load: {r:?}; still running after: {alive}; log since: {:?}", text.get(before..).unwrap_or(""));
        r.unwrap();
        assert!(alive && text[before..].contains("loaded"));
    }

    #[test]
    fn finds_installed_app_id() {
        // Only meaningful on a machine with Jibbers installed.
        if super::find_game().is_some() {
            assert_eq!(super::steam_app_id().as_deref(), Some("4397910"));
        }
    }
}
