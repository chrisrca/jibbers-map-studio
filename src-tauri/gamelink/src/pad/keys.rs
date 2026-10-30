//! The keyboard for the studio's tests: keys pressed and let go, studio-pad.json's "keys" being what's held. Each
//! goes to the game the two ways Windows would give it a key typed: the key message to its window (Unity's input,
//! which the chat's typing and its menus read) and Raw Input to the window that gets its keyboard's (Rewired's, which
//! the game's own keys, T for the chat among them, go through: raw.rs answers for these). Both posted to the game
//! straight, nothing through Windows' input: keys can never land in another program, whatever is in front.

use super::super::*;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{MapVirtualKeyW, MAPVK_VK_TO_VSC};

/// the keys held now (virtual-key codes)
static HELD: Mutex<Vec<u16>> = Mutex::new(Vec::new());

/// A key's virtual-key code, by the name studio-pad.json uses: a letter or digit, or one of a few named keys.
fn code(name: &str) -> Option<u16> {
    let named = [("escape", 0x1B), ("enter", 0x0D), ("space", 0x20), ("tab", 0x09), ("backspace", 0x08), ("f5", 0x74)];
    if let Some(&(_, vk)) = named.iter().find(|(n, _)| *n == name) {
        return Some(vk);
    }
    match name.as_bytes() {
        [c @ (b'a'..=b'z' | b'0'..=b'9')] => Some(c.to_ascii_uppercase() as u16),
        _ => None,
    }
}

/// The window the game's keyboard Raw Input goes to, if it has one of its own.
fn keyboard_target() -> Option<HWND> {
    super::raw::registrations().iter().find(|d| d.usUsagePage == 1 && d.usUsage == 6).map(|d| d.hwndTarget).filter(|h| !h.is_null())
}

/// The keys as now held: those let go released, those new pressed.
pub(crate) unsafe fn hold(names: &[&str]) {
    let want: Vec<u16> = names.iter().filter_map(|n| code(n)).collect();
    let mut held = HELD.lock().unwrap();
    let w = WINDOW.load(Ordering::Relaxed) as HWND;
    if w.is_null() {
        return;
    }
    // (lParam: a repeat count of 1, the scan code, and for a key let go its "was down" and "going up" bits)
    let post = |vk: u16, up: bool| {
        let scan = MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) as isize;
        let l = 1 | scan << 16 | if up { 3 << 30 } else { 0 };
        PostMessageW(w, if up { WM_KEYUP } else { WM_KEYDOWN }, vk as WPARAM, l as LPARAM);
        // (RIM_INPUT: typed with the game in front)
        if let Some(to) = keyboard_target() {
            PostMessageW(to, WM_INPUT, 0, super::raw::key_input(vk, scan as u16, up));
        }
    };
    for &k in held.iter().filter(|k| !want.contains(k)) {
        post(k, true);
    }
    for &k in want.iter().filter(|k| !held.contains(k)) {
        post(k, false);
    }
    *held = want;
}
