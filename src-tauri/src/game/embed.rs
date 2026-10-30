//! Hosting the running game's window inside the studio's Game tab.
//!
//! Jibbers' top-level window is re-parented into the studio window as a child, positioned over the Game tab's
//! area. When another tab is shown it is "parked": hidden and taken back out of the studio's window, because
//! windows of two processes, one inside the other, share one input queue — every mouse move in the editor would
//! wait for the game's next frame (measured: a 3 s drag in the 3D view delivered 18 of 700 moves with the game
//! hidden inside). Releasing restores it as a normal top-level window — this must happen before the studio closes,
//! or Windows would destroy the game's window along with ours.
//!
//! All window work on the game runs on one thread of its own ([`on_window_thread`]): Windows hands the game
//! messages for it and waits for the answers, and the game can be busy for seconds while loading a map. The
//! studio's own thread (the one the editor's input goes through) never waits on the game.

use std::sync::Mutex;

use windows_sys::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
use windows_sys::Win32::Graphics::Gdi::ClientToScreen;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::SetFocus;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetParent, GetWindowLongPtrW, PostMessageW, WM_CLOSE, GetWindowRect, GetWindowTextW, IsIconic, IsWindow, IsWindowVisible,
    SetForegroundWindow, SetParent, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, GWL_STYLE, HWND_TOP, SWP_FRAMECHANGED,
    SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOZORDER, SWP_SHOWWINDOW, SW_HIDE, SW_RESTORE, SW_SHOW, WS_CAPTION, WS_CHILD, WS_EX_APPWINDOW,
    WS_EX_DLGMODALFRAME, WS_EX_TOOLWINDOW, WS_EX_WINDOWEDGE, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_POPUP, WS_SYSMENU, WS_THICKFRAME,
};

const GAME_CLASS: &str = "UnityWndClass";
const GAME_TITLE: &str = "Jibbers";

struct Embedded {
    hwnd: isize,
    /// original top-level style/placement, restored on release
    style: isize,
    ex_style: isize,
    rect: RECT,
    /// where it belongs inside the studio, kept there by the watchdog
    parent: isize,
    area: Area,
    visible: bool,
    /// hidden and out of the studio's window (another tab is showing)
    parked: bool,
}

// SAFETY: only window handles (plain integers) and a RECT are stored.
unsafe impl Send for Embedded {}

static EMBEDDED: Mutex<Option<Embedded>> = Mutex::new(None);
static LAST_SIZE: Mutex<(i32, i32)> = Mutex::new((0, 0));
/// where the Game tab last was (the studio's window, and the area in it), game or no game
static LAST_TAB: Mutex<Option<(isize, Area)>> = Mutex::new(None);
/// the Game tab is hidden (another tab is showing): the studio's link mutes the game and leaves keys and mouse alone
static HIDDEN: Mutex<bool> = Mutex::new(false);
/// the game window is parked (hidden, outside the studio's window): the studio's link treats it as hidden even though it
/// isn't inside the studio, and shows it again should the studio go away
static PARKED: Mutex<bool> = Mutex::new(false);
/// whether the Game tab wants the game showing (set by [`set_visible`], even before the game is there)
static WANT_VISIBLE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

type Job = Box<dyn FnOnce() + Send>;
static JOBS: Mutex<Option<std::sync::mpsc::Sender<Job>>> = Mutex::new(None);

/// Runs `f` on the thread that does all window work on the game, after whatever was asked for before it, and
/// returns its result (None if it panicked).
pub fn on_window_thread<R: Send + 'static>(f: impl FnOnce() -> R + Send + 'static) -> Option<R> {
    let (tx, rx) = std::sync::mpsc::channel();
    let job: Job = Box::new(move || {
        let _ = tx.send(f());
    });
    {
        let mut jobs = JOBS.lock().unwrap();
        let sender = jobs.get_or_insert_with(|| {
            let (s, r) = std::sync::mpsc::channel::<Job>();
            std::thread::Builder::new()
                .name("game-window".into())
                .spawn(move || {
                    for job in r {
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job));
                    }
                })
                .expect("game window thread");
            s
        });
        sender.send(job).ok()?;
    }
    rx.recv().ok()
}

/// Tells the studio's link what resolution to render at (`%APPDATA%\Jibbers\studio-game-size.json`). The game
/// re-applies its own display settings when its menus load, so it can't be sized from outside alone.
fn publish_size(w: i32, h: i32) {
    let mut last = LAST_SIZE.lock().unwrap();
    if *last == (w, h) {
        return;
    }
    if write_state(w, h, *HIDDEN.lock().unwrap(), *PARKED.lock().unwrap()) {
        *last = (w, h);
    }
}

/// Writes the size, whether the game is out of sight (`hidden`: the studio's link mutes it) and parked, and which process
/// the studio is (so a parked game can come back if the studio goes away).
fn write_state(w: i32, h: i32, hidden: bool, parked: bool) -> bool {
    let Ok(maps) = super::maps_dir() else { return false };
    let path = maps.parent().unwrap().join("studio-game-size.json");
    let tmp = path.with_extension("tmp");
    let json = serde_json::json!({ "width": w, "height": h, "hidden": hidden, "parked": parked, "studio": std::process::id() });
    std::fs::write(&tmp, json.to_string()).is_ok() && std::fs::rename(&tmp, &path).is_ok()
}

fn publish_state(hidden: bool, parked: bool) {
    let (mut h, mut p) = (HIDDEN.lock().unwrap(), PARKED.lock().unwrap());
    if *h == hidden && *p == parked {
        return;
    }
    (*h, *p) = (hidden, parked);
    let (w, ht) = *LAST_SIZE.lock().unwrap();
    if w > 0 {
        write_state(w, ht, hidden, parked);
    }
}

/// Hides the game and takes it out of the studio's window (keeping it out of the taskbar and Alt+Tab).
unsafe fn park(hwnd: HWND) {
    unsafe {
        ShowWindow(hwnd, SW_HIDE);
        if !GetParent(hwnd).is_null() {
            SetParent(hwnd, std::ptr::null_mut());
        }
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        if style & WS_CHILD != 0 || style & WS_POPUP == 0 {
            SetWindowLongPtrW(hwnd, GWL_STYLE, ((style & !WS_CHILD) | WS_POPUP) as isize);
        }
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        if ex & WS_EX_TOOLWINDOW == 0 || ex & WS_EX_APPWINDOW != 0 {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ((ex & !WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW) as isize);
        }
    }
}

/// Physical-pixel rectangle in the studio window's client area.
#[derive(serde::Deserialize, Clone, Copy, Debug)]
pub struct Area {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// No game window exists.
    NotRunning,
    /// The game is running in its own window.
    Running,
    /// The game is inside the studio.
    Embedded,
}

fn wide_to_string(buf: &[u16], len: i32) -> String {
    String::from_utf16_lossy(&buf[..len.max(0) as usize])
}

/// The game's top-level window, if it's open.
fn find_game_window() -> Option<HWND> {
    unsafe extern "system" fn visit(hwnd: HWND, out: LPARAM) -> i32 {
        let mut buf = [0u16; 256];
        let n = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        let class = wide_to_string(&buf, n);
        if class == GAME_CLASS && unsafe { IsWindowVisible(hwnd) } != 0 {
            let n = unsafe { GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
            let title = wide_to_string(&buf, n);
            if title.starts_with(GAME_TITLE) {
                unsafe { *(out as *mut HWND) = hwnd };
                return 0; // stop
            }
        }
        1
    }
    let mut found: HWND = std::ptr::null_mut();
    unsafe { EnumWindows(Some(visit), &mut found as *mut HWND as LPARAM) };
    (!found.is_null()).then_some(found)
}

fn alive(e: &Embedded) -> bool {
    unsafe { IsWindow(e.hwnd as HWND) != 0 }
}

pub fn status() -> Status {
    let mut guard = EMBEDDED.lock().unwrap();
    if let Some(e) = guard.as_ref() {
        if alive(e) {
            return Status::Embedded;
        }
        *guard = None; // the game closed
    }
    if find_game_window().is_some() { Status::Running } else { Status::NotRunning }
}

/// Pulls the game window into `parent` at `area` (or just moves it there if it's already inside). Returns false
/// when the game isn't running yet. Run on the window thread.
/// The Game tab's place on the screen (x, y, width, height in physical pixels), if it's been shown: where a game
/// started for it is put from the first moment.
pub fn tab_screen_rect() -> Option<(i32, i32, i32, i32)> {
    let (parent, a) = (*LAST_TAB.lock().unwrap())?;
    let mut origin = POINT { x: 0, y: 0 };
    unsafe {
        if IsWindow(parent as HWND) == 0 || ClientToScreen(parent as HWND, &mut origin) == 0 {
            return None;
        }
    }
    (a.w > 64 && a.h > 64).then_some((origin.x + a.x, origin.y + a.y, a.w, a.h))
}

pub fn attach(parent: HWND, area: Area) -> bool {
    *LAST_TAB.lock().unwrap() = Some((parent as isize, area));
    let want = WANT_VISIBLE.load(std::sync::atomic::Ordering::SeqCst);
    let hwnd = {
        let mut guard = EMBEDDED.lock().unwrap();
        if guard.as_ref().is_some_and(|e| !alive(e)) {
            *guard = None;
        }
        if guard.is_none() {
            // only while the Game tab wants it: a pull still on its way after "Pop out" mustn't take it back
            if !want {
                return false;
            }
            let Some(hwnd) = find_game_window() else { return false };
            unsafe {
                let mut rect: RECT = std::mem::zeroed();
                GetWindowRect(hwnd, &mut rect);
                let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
                let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                *guard = Some(Embedded { hwnd: hwnd as isize, style, ex_style, rect, parent: parent as isize, area, visible: true, parked: false });
            }
            start_watchdog();
            // a new game window (e.g. a fresh start from Play): whatever was last said about the old one, it's in sight
            publish_state(false, false);
        }
        let e = guard.as_mut().unwrap();
        e.parent = parent as isize;
        e.area = area;
        // the Game tab was left while this was on its way: just remember where it goes (set_visible brings it in)
        if !want {
            e.parked = true;
            None
        } else {
            e.parked = false;
            Some(e.hwnd as HWND)
        }
    };
    publish_size(area.w.max(1), area.h.max(1));
    let Some(hwnd) = hwnd else { return true };
    // (Re)apply every time: the game re-adds its frame when it changes resolution or screen mode.
    unsafe {
        make_child(hwnd, parent);
        SetWindowPos(hwnd, HWND_TOP, area.x, area.y, area.w.max(1), area.h.max(1), SWP_FRAMECHANGED | SWP_SHOWWINDOW);
    }
    true
}

const FRAME: u32 = WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX;
const EX_FRAME: u32 = WS_EX_APPWINDOW | WS_EX_DLGMODALFRAME | WS_EX_WINDOWEDGE;

/// Strips the window frame and makes `hwnd` a child of `parent`, if it isn't already.
unsafe fn make_child(hwnd: HWND, parent: HWND) {
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        if style & FRAME != 0 || style & WS_CHILD == 0 {
            SetWindowLongPtrW(hwnd, GWL_STYLE, ((style & !FRAME) | WS_CHILD) as isize);
        }
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        if ex & (EX_FRAME | WS_EX_TOOLWINDOW) != 0 {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, (ex & !(EX_FRAME | WS_EX_TOOLWINDOW)) as isize);
        }
        if GetParent(hwnd) != parent {
            SetParent(hwnd, parent);
        }
    }
}

/// The game moves and resizes its own window (e.g. to the top-left corner during loading screens, when it
/// re-applies display settings), and while it's loading it can't be reached quickly. A background thread checks
/// ~60 times a second and moves it back without waiting on the game (asynchronous window positioning).
fn start_watchdog() {
    static STARTED: std::sync::Once = std::sync::Once::new();
    STARTED.call_once(|| {
        std::thread::spawn(|| loop {
            std::thread::sleep(std::time::Duration::from_millis(16));
            let target = EMBEDDED.lock().unwrap().as_ref().filter(|e| e.visible || e.parked).map(|e| (e.hwnd as HWND, e.parent as HWND, e.area, e.parked));
            let Some((hwnd, parent, a, parked)) = target else { continue };
            unsafe {
                if IsWindow(hwnd) == 0 {
                    continue;
                }
                if parked {
                    if IsWindowVisible(hwnd) != 0 || !GetParent(hwnd).is_null() {
                        park(hwnd);
                    }
                    continue;
                }
                let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
                if style & FRAME != 0 || style & WS_CHILD == 0 || GetParent(hwnd) != parent {
                    make_child(hwnd, parent);
                }
                let mut r: RECT = std::mem::zeroed();
                GetWindowRect(hwnd, &mut r);
                let mut origin = POINT { x: 0, y: 0 };
                ClientToScreen(parent, &mut origin);
                let (x, y, w, h) = (r.left - origin.x, r.top - origin.y, r.right - r.left, r.bottom - r.top);
                if (x, y, w, h) != (a.x, a.y, a.w.max(1), a.h.max(1)) {
                    SetWindowPos(hwnd, std::ptr::null_mut(), a.x, a.y, a.w.max(1), a.h.max(1),
                        SWP_ASYNCWINDOWPOS | SWP_NOZORDER | SWP_NOACTIVATE);
                }
            }
        });
    });
}

/// The live state of the game window, for the diagnostics report.
pub fn debug_info() -> String {
    let mut out = String::new();
    let last = *LAST_SIZE.lock().unwrap();
    out.push_str(&format!("size last sent to the game (studio-game-size.json): {}x{}
", last.0, last.1));
    match EMBEDDED.lock().unwrap().as_ref() {
        Some(e) => {
            out.push_str(&format!(
                "embedded: yes, alive {}, visible {}, wanted area ({}, {}) {}x{} in parent {:#x}
",
                alive(e), e.visible, e.area.x, e.area.y, e.area.w, e.area.h, e.parent as usize
            ));
            out.push_str(&format!("original top-level: style {:#010x}, ex {:#010x}, rect ({}, {}) {}x{}
",
                e.style as u32, e.ex_style as u32, e.rect.left, e.rect.top, e.rect.right - e.rect.left, e.rect.bottom - e.rect.top));
            if alive(e) {
                out.push_str(&format!("now: {}
", super::diag::window_line(e.hwnd as HWND)));
            }
        }
        None => out.push_str("embedded: no
"),
    }
    match find_game_window() {
        Some(h) => out.push_str(&format!("game window found: {}
", super::diag::window_line(h))),
        None => out.push_str("game window found: no (game not running, or its window title/class differs)
"),
    }
    out
}

/// Shows or hides the embedded game (when switching tabs). The game keeps running while hidden, parked outside the
/// studio's window. Run on the window thread; returns whether the game should now get the keyboard ([`focus`],
/// which has to be called on the studio's own thread).
pub fn set_visible(visible: bool) -> bool {
    WANT_VISIBLE.store(visible, std::sync::atomic::Ordering::SeqCst);
    let no_park = std::env::var_os("JIBBERS_NO_PARK").is_some(); // (for comparing: hidden but left inside)
    let (hwnd, parent, a, was_parked) = {
        let mut guard = EMBEDDED.lock().unwrap();
        let Some(e) = guard.as_mut().filter(|e| alive(e)) else {
            drop(guard);
            publish_state(!visible, false);
            return false;
        };
        let was_parked = e.parked;
        e.visible = visible;
        e.parked = !visible && !no_park;
        (e.hwnd as HWND, e.parent as HWND, e.area, was_parked)
    };
    unsafe {
        if visible {
            if was_parked {
                make_child(hwnd, parent);
                SetWindowPos(hwnd, HWND_TOP, a.x, a.y, a.w.max(1), a.h.max(1), SWP_FRAMECHANGED | SWP_SHOWWINDOW);
            }
            ShowWindow(hwnd, SW_SHOW);
            SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, 0x0001 | 0x0002 /* NOSIZE | NOMOVE */);
        } else if no_park {
            ShowWindow(hwnd, SW_HIDE);
        } else {
            park(hwnd);
        }
    }
    publish_state(!visible, !visible && !no_park);
    visible
}

/// Gives keyboard input to the game. On the studio's own thread (the one its window and the game's share input with).
/// Popped out, the game's window is brought to the front instead (the studio in front, having just been clicked,
/// Windows lets it hand that on).
pub fn focus() {
    if let Some(e) = EMBEDDED.lock().unwrap().as_ref().filter(|e| alive(e)) {
        unsafe { SetFocus(e.hwnd as HWND) };
        return;
    }
    if let Some(h) = find_game_window() {
        unsafe {
            if IsIconic(h) != 0 {
                ShowWindow(h, SW_RESTORE);
            }
            SetForegroundWindow(h);
        }
    }
}

/// Closes the game inside the studio, as if its own close button were pressed: when the studio closes, and when
/// Play starts it afresh. It's taken out of the studio's window first (so it isn't torn down with ours) but kept
/// hidden — shown on its own for the seconds it takes to quit, it looked popped out. Should it not quit, the studio's link
/// shows it again once the studio has gone.
pub fn close_embedded_game() {
    let Some(e) = EMBEDDED.lock().unwrap().take() else { return };
    if !alive(&e) {
        return;
    }
    let hwnd = e.hwnd as HWND;
    unsafe { park(hwnd) };
    publish_state(true, true);
    unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) };
}

/// "Pop out": the game becomes a normal window of its own and stays one — the Game tab doesn't pull it back in
/// until it's asked to show the game again ("Bring it back in"). Run on the window thread.
pub fn pop_out() {
    WANT_VISIBLE.store(false, std::sync::atomic::Ordering::SeqCst);
    release();
}

/// Turns the game back into a normal top-level window where it was before (popping out, closing the map). It's in
/// sight then: never muted or paced.
pub fn release() {
    let taken = EMBEDDED.lock().unwrap().take();
    if let Some(e) = taken.filter(alive) {
        unsafe {
            let hwnd = e.hwnd as HWND;
            SetParent(hwnd, std::ptr::null_mut());
            SetWindowLongPtrW(hwnd, GWL_STYLE, e.style);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, e.ex_style);
            let r = e.rect;
            SetWindowPos(hwnd, std::ptr::null_mut(), r.left, r.top, r.right - r.left, r.bottom - r.top,
                SWP_FRAMECHANGED | SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
    }
    publish_state(false, false);
}
