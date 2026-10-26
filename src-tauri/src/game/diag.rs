//! "Save game diagnostics": one text report of everything that decides whether the game sits properly inside the
//! studio (the studio's link, the game's display settings, Windows scaling, the live window state), to send to
//! whoever is helping. Read-only: nothing here changes any setting.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use windows_sys::Win32::Foundation::{HWND, LPARAM, RECT};
use windows_sys::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFOEXW};
use windows_sys::Win32::UI::HiDpi::{GetDpiForMonitor, GetDpiForWindow, MDT_EFFECTIVE_DPI};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetClientRect, GetParent, GetWindowLongPtrW, GetWindowRect, GWL_EXSTYLE, GWL_STYLE};

/// `frontend`: what the studio's UI knows (device pixel ratio, the Game tab's area, …), as text.
pub fn report(studio_hwnd: Option<HWND>, frontend: &str) -> String {
    let mut r = String::new();
    let _ = writeln!(r, "Jibbers Map Studio — game diagnostics");
    let _ = writeln!(r, "studio {} · {}", env!("CARGO_PKG_VERSION"), windows_version());
    let _ = writeln!(r, "time (unix) {}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0));

    section(&mut r, "Studio UI");
    r.push_str(frontend.trim_end());
    r.push('\n');

    section(&mut r, "Displays (Windows scaling)");
    displays(&mut r);
    if let Some(h) = studio_hwnd {
        let _ = writeln!(r, "studio window: {}", window_line(h));
    }

    section(&mut r, "Game window (live)");
    r.push_str(&super::embed::debug_info());

    section(&mut r, "Game install");
    let exe = super::find_game();
    let _ = writeln!(r, "Jibbers.exe: {}", exe.as_ref().map_or("NOT FOUND (looked in Steam libraries under steamapps\\common\\Jibbers Playtest)".into(), |p| p.display().to_string()));

    section(&mut r, "Studio ↔ game files (%APPDATA%\\Jibbers)");
    if let Ok(maps) = super::maps_dir() {
        let dir = maps.parent().unwrap().to_path_buf();
        for f in ["studio-game-size.json", "studio-play.json", "studio-link.json", "studio-game-status.json"] {
            let _ = writeln!(r, "{f}: {}", std::fs::read_to_string(dir.join(f)).map(|t| t.trim().to_string()).unwrap_or_else(|_| "(none)".into()));
        }
    }

    section(&mut r, "Studio link (studio-link.log, last 60 lines)");
    if let Ok(maps) = super::maps_dir() {
        let log = maps.parent().unwrap().join("studio-link.log");
        r.push_str(&if log.exists() { tail(&log, 60) } else { "(none: the link hasn't run)
".into() });
    }

    section(&mut r, "Game display settings (registry)");
    game_registry(&mut r);

    section(&mut r, "Game log (Player.log, last 120 lines)");
    match player_log() {
        Some(p) => {
            let _ = writeln!(r, "{}", p.display());
            r.push_str(&tail(&p, 120));
        }
        None => r.push_str("(not found under %USERPROFILE%\\AppData\\LocalLow)\n"),
    }
    r
}

fn section(r: &mut String, title: &str) {
    let _ = write!(r, "\n==== {title} ====\n");
}

fn windows_version() -> String {
    use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};
    let Ok(k) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion") else { return "Windows ?".into() };
    let get = |n: &str| k.get_value::<String, _>(n).unwrap_or_default();
    format!("{} {} (build {})", get("ProductName"), get("DisplayVersion"), get("CurrentBuild"))
}

fn displays(r: &mut String) {
    unsafe extern "system" fn visit(m: HMONITOR, _: HDC, _: *mut RECT, out: LPARAM) -> i32 {
        let out = unsafe { &mut *(out as *mut Vec<String>) };
        let mut info: MONITORINFOEXW = unsafe { std::mem::zeroed() };
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        unsafe { GetMonitorInfoW(m, &mut info as *mut MONITORINFOEXW as *mut _) };
        let (mut dx, mut dy) = (0u32, 0u32);
        unsafe { GetDpiForMonitor(m, MDT_EFFECTIVE_DPI, &mut dx, &mut dy) };
        let rc = info.monitorInfo.rcMonitor;
        let name = String::from_utf16_lossy(&info.szDevice).trim_end_matches('\0').to_string();
        out.push(format!(
            "{name}: {}x{} at ({}, {}), {} dpi = {}% scaling{}",
            rc.right - rc.left,
            rc.bottom - rc.top,
            rc.left,
            rc.top,
            dx,
            dx * 100 / 96,
            if info.monitorInfo.dwFlags & 1 != 0 { " (primary)" } else { "" }
        ));
        1
    }
    let mut lines: Vec<String> = vec![];
    unsafe { EnumDisplayMonitors(std::ptr::null_mut(), std::ptr::null(), Some(visit), &mut lines as *mut Vec<String> as LPARAM) };
    for l in lines {
        let _ = writeln!(r, "{l}");
    }
}

/// Position/size/style/DPI of a window, for the report.
pub fn window_line(h: HWND) -> String {
    unsafe {
        let mut w: RECT = std::mem::zeroed();
        let mut c: RECT = std::mem::zeroed();
        GetWindowRect(h, &mut w);
        GetClientRect(h, &mut c);
        format!(
            "hwnd {:#x}, window ({}, {}) {}x{}, client {}x{}, style {:#010x}, ex {:#010x}, parent {:#x}, dpi {}",
            h as usize,
            w.left,
            w.top,
            w.right - w.left,
            w.bottom - w.top,
            c.right - c.left,
            c.bottom - c.top,
            GetWindowLongPtrW(h, GWL_STYLE) as u32,
            GetWindowLongPtrW(h, GWL_EXSTYLE) as u32,
            GetParent(h) as usize,
            GetDpiForWindow(h)
        )
    }
}

/// Unity keeps the game's display settings (fullscreen mode, resolution) under HKCU\Software\<company>\<product>.
fn game_registry(r: &mut String) {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey, RegValue};
    let Ok(sw) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software") else { return };
    let mut found = false;
    for company in sw.enum_keys().flatten() {
        let Ok(ck) = sw.open_subkey(&company) else { continue };
        for product in ck.enum_keys().flatten().filter(|p| p.to_lowercase().contains("jibbers")) {
            let Ok(pk) = ck.open_subkey(&product) else { continue };
            found = true;
            let _ = writeln!(r, "HKCU\\Software\\{company}\\{product}");
            for (name, v) in pk.enum_values().flatten() {
                let l = name.to_lowercase();
                if !(l.contains("screenmanager") || l.contains("resolution") || l.contains("fullscreen") || l.contains("display") || l.contains("vsync") || l.contains("quality")) {
                    continue;
                }
                let RegValue { bytes, vtype } = v;
                let shown = match vtype {
                    winreg::enums::REG_DWORD if bytes.len() >= 4 => u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]).to_string(),
                    winreg::enums::REG_BINARY => String::from_utf8_lossy(&bytes).trim_end_matches('\0').to_string(),
                    _ => format!("{bytes:?}"),
                };
                let _ = writeln!(r, "  {name} = {shown}");
            }
        }
    }
    if !found {
        r.push_str("(no Jibbers key found)\n");
    }
}

fn player_log() -> Option<PathBuf> {
    let low = PathBuf::from(std::env::var("USERPROFILE").ok()?).join(r"AppData\LocalLow");
    for company in std::fs::read_dir(&low).ok()?.flatten() {
        let Ok(rd) = std::fs::read_dir(company.path()) else { continue };
        for product in rd.flatten() {
            if product.file_name().to_string_lossy().to_lowercase().contains("jibbers") {
                let p = product.path().join("Player.log");
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }
    None
}

fn tail(path: &Path, n: usize) -> String {
    let text = std::fs::read(path).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    let mut out = lines[lines.len().saturating_sub(n)..].join("\n");
    out.push('\n');
    out
}

#[cfg(test)]
mod tests {
    /// Prints a report for this machine: `cargo test --release diag_report -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn diag_report() {
        println!("{}", super::report(None, "(test run)"));
    }
}
