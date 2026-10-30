//! Jibbers Studio's link into the game. The studio's Play saves the map in the game's settings (`map-id`, and
//! `next-scene` = Main), starts the game, and loads this DLL into it. It then:
//!   - starts the map as soon as the game is up: from its welcome screen (or the menu, or the controls screen) it
//!     loads the game's loading screen, which goes on to the map — the menus are never shown;
//!   - reloads it in place when Play is pressed again on the same map (studio-play.json rewritten with "reload"):
//!     the maps read again, back to the menu (the old map's physics torn down as the game does it), then the map;
//!   - runs the game inside the studio's Game tab when asked (`embed`): windowed at the tab's size, taking the
//!     controller and keyboard without having the focus, quiet and paced to the screen while out of sight;
//!   - reports how it's doing (studio-link.json) and how the game is running (studio-game-status.json);
//!   - for the studio's tests, plays a controller and a keyboard (pad.rs: an Xbox pad the game reads through XInput,
//!     keys posted to its windows) and reports what the game is doing with them (probe.rs).
//!
//! It only calls Unity's own classes (SceneManager, Time, Screen, Application, ...) and Rewired, by name: none of
//! the game's own (obfuscated, renamed with each update). Its work runs on the game's main thread, as Unity
//! requires: a thread of its own posts the game's window a message a few times a second, and the window's procedure
//! (replaced by one that handles that message first) does the work.

mod il2cpp;
mod files;
mod unity;
mod link;
mod pad;
mod probe;
pub(crate) use files::*;
pub(crate) use unity::*;
pub(crate) use link::*;

use il2cpp::{Api, Ptr};
use std::ffi::c_void;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use windows_sys::core::BOOL;
use windows_sys::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, TRUE, WPARAM};
use windows_sys::Win32::System::LibraryLoader::DisableThreadLibraryCalls;
use windows_sys::Win32::System::SystemServices::DLL_PROCESS_ATTACH;
use windows_sys::Win32::System::Threading::{CreateMutexW, CreateThread, GetCurrentProcessId, Sleep};
use windows_sys::Win32::UI::WindowsAndMessaging::*;

const VERSION: &str = env!("CARGO_PKG_VERSION");
/// The message that runs a tick on the game's main thread.
const WM_LINK: u32 = WM_APP + 0x5A1;

static WINDOW: AtomicIsize = AtomicIsize::new(0);
static OLD_PROC: AtomicIsize = AtomicIsize::new(0);
/// a tick posted and not yet run (while the game is busy loading they'd pile up and then all run at once)
static PENDING: AtomicBool = AtomicBool::new(false);
static LINK: Mutex<Option<Link>> = Mutex::new(None);
/// when the game's window was first found
static WINDOW_FOUND: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

/// # Safety
/// Called by Windows' loader only, with the arguments it gives.
#[no_mangle]
pub unsafe extern "system" fn DllMain(module: HINSTANCE, reason: u32, _: *mut c_void) -> BOOL {
    if reason == DLL_PROCESS_ATTACH {
        DisableThreadLibraryCalls(module);
        CreateThread(std::ptr::null(), 0, Some(watch), std::ptr::null(), 0, std::ptr::null_mut());
    }
    TRUE
}

/// The link's own thread: waits for the game's window, then keeps the window's procedure ours and posts it a tick ten
/// times a second. It never calls into the game's runtime itself: loaded while the game is still starting, asking the
/// runtime from here while the main thread was making it crashed the game (the ticks ask it, on the main thread).
unsafe extern "system" fn watch(_: *mut c_void) -> u32 {
    // (once per game: loaded again, the second copy stands down)
    let name: Vec<u16> = format!("JibbersStudioLink-{}\0", GetCurrentProcessId()).encode_utf16().collect();
    let m = CreateMutexW(std::ptr::null(), TRUE, name.as_ptr());
    if m.is_null() || windows_sys::Win32::Foundation::GetLastError() == windows_sys::Win32::Foundation::ERROR_ALREADY_EXISTS {
        return 0;
    }
    report("starting", "");
    log(&format!("link {VERSION} loaded"));
    loop {
        let mut w = WINDOW.load(Ordering::Relaxed) as HWND;
        if w.is_null() || IsWindow(w) == 0 {
            w = own_window();
            WINDOW.store(w as isize, Ordering::Relaxed);
        }
        if !w.is_null() {
            let ours = wndproc as unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT as usize as isize;
            if GetWindowLongPtrW(w, GWLP_WNDPROC) != ours {
                let old = SetWindowLongPtrW(w, GWLP_WNDPROC, ours);
                if old != 0 {
                    // (the first time: the test pad's thread too, the game well under way by now)
                    if OLD_PROC.swap(old, Ordering::Relaxed) == 0 {
                        let _ = WINDOW_FOUND.set(Instant::now());
                        CreateThread(std::ptr::null(), 0, Some(pad::watch_pad), std::ptr::null(), 0, std::ptr::null_mut());
                    }
                    log("window found");
                }
            }
            if !PENDING.swap(true, Ordering::AcqRel) && PostMessageW(w, WM_LINK, 0, 0) == 0 {
                PENDING.store(false, Ordering::Release);
            }
        }
        Sleep(100);
    }
}

unsafe extern "system" fn wndproc(h: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    if msg == WM_LINK {
        PENDING.store(false, Ordering::Release);
        // (the runtime left alone for a second after the window shows: the game is still starting up)
        let settled = WINDOW_FOUND.get().is_some_and(|t| t.elapsed() > Duration::from_secs(1));
        if let (true, Ok(mut link)) = (settled, LINK.try_lock()) {
            if let Some(api) = il2cpp::api() {
                link.get_or_insert_with(Link::new).tick(api);
            }
        }
        return 0;
    }
    let old: WNDPROC = std::mem::transmute(OLD_PROC.load(Ordering::Relaxed));
    let r = CallWindowProcW(old, h, msg, w, l);
    // Inside the studio the game's window is a child, which Windows never activates: given the keyboard (a click in
    // it, or the studio handing it over) it's told it's active too, or Unity goes on thinking it's in the background
    // once it has lost the focus (and the game's camera takes no look input then: FollowCam)
    if msg == WM_SETFOCUS && !GetParent(h).is_null() {
        CallWindowProcW(old, h, WM_ACTIVATE, WA_ACTIVE as WPARAM, 0);
    }
    r
}

/// The game's own window (Unity's), top-level or already inside the studio.
unsafe fn own_window() -> HWND {
    struct Find {
        pid: u32,
        found: HWND,
    }
    unsafe fn mine(h: HWND, f: &Find) -> bool {
        let mut pid = 0u32;
        GetWindowThreadProcessId(h, &mut pid);
        if pid != f.pid {
            return false;
        }
        let mut cls = [0u16; 64];
        let n = GetClassNameW(h, cls.as_mut_ptr(), cls.len() as i32);
        String::from_utf16_lossy(&cls[..n.max(0) as usize]) == "UnityWndClass"
    }
    unsafe extern "system" fn child(h: HWND, l: LPARAM) -> BOOL {
        let f = &mut *(l as *mut Find);
        if mine(h, f) {
            f.found = h;
            return 0;
        }
        1
    }
    unsafe extern "system" fn top(h: HWND, l: LPARAM) -> BOOL {
        let f = &mut *(l as *mut Find);
        if mine(h, f) {
            f.found = h;
            return 0;
        }
        EnumChildWindows(h, Some(child), l);
        (f.found.is_null()) as BOOL
    }
    let mut f = Find { pid: GetCurrentProcessId(), found: std::ptr::null_mut() };
    EnumWindows(Some(top), &mut f as *mut Find as LPARAM);
    f.found
}

// (only ever used on the game's main thread; the lock is for Rust's sake)
unsafe impl Send for Link {}

