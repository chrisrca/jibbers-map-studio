//! A controller for the studio's tests: an Xbox pad the game sees through XInput, its buttons and sticks set by the
//! studio (studio-pad.json). While the studio has it connected, the game's XInput calls are answered by the link: the
//! test pad in the first slot, the other slots empty (a real pad would take the player from it); and its Raw Input
//! device list (Rewired finds controllers there) has the test pad as an Xbox pad and no other game controller.
//! Disconnected, the game's XInput and Raw Input are put back as they were and real pads come back.
//!
//! studio-pad.json: {"connected": true, "buttons": ["dpad_up", "a", ...], "lx": -1..1, "ly", "rx", "ry", "lt": 0..1,
//! "rt", "keys": ["t", "escape", ...]} (sticks up and right are positive, as XInput has them; the keys are the
//! keyboard's, held: keys.rs).

mod keys;
pub(crate) mod raw;

use super::*;
use std::sync::atomic::{AtomicI64, AtomicU32, AtomicU64};
use windows_sys::Win32::System::Diagnostics::Debug::FlushInstructionCache;
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows_sys::Win32::System::Memory::{VirtualProtect, PAGE_EXECUTE_READWRITE};
use windows_sys::Win32::System::Threading::GetCurrentProcess;

/// XInput's button bits, by the names studio-pad.json uses.
const BUTTONS: [(&str, u16); 15] = [
    ("dpad_up", 0x0001), ("dpad_down", 0x0002), ("dpad_left", 0x0004), ("dpad_right", 0x0008), ("start", 0x0010),
    ("back", 0x0020), ("left_thumb", 0x0040), ("right_thumb", 0x0080), ("lb", 0x0100), ("rb", 0x0200),
    ("guide", 0x0400), ("a", 0x1000), ("b", 0x2000), ("x", 0x4000), ("y", 0x8000),
];

const ERROR_SUCCESS: u32 = 0;
const ERROR_DEVICE_NOT_CONNECTED: u32 = 1167;

/// The pad as the studio last set it: buttons (16 bits), triggers (8 each) and connected (bit 32); the four sticks
/// (16 bits each).
static KEYS: AtomicU64 = AtomicU64::new(0);
static STICKS: AtomicU64 = AtomicU64::new(0);
/// XInput's packet number: a new one each time the state changes
static PACKET: AtomicU32 = AtomicU32::new(0);
/// how many times the game asked for the test pad's state (for the studio: is the game reading it?)
pub(crate) static READS: AtomicI64 = AtomicI64::new(0);
/// what the game has asked of the link, for finding out how it reads controllers: XInput states (any slot), XInput
/// capabilities (any slot), the Raw Input device list (from the game's own code), and of the test pad's Raw Input
/// device its path, its device info, and anything else
pub(crate) static CALLS: [AtomicI64; 6] = [const { AtomicI64::new(0) }; 6];

pub(crate) fn connected() -> bool {
    KEYS.load(Ordering::Relaxed) >> 32 & 1 == 1
}

/// Rewired left on its own input source ("keepSource": a test of the game as players have it, without the test pad
/// reaching it).
pub(crate) fn keep_source() -> bool {
    KEYS.load(Ordering::Relaxed) >> 33 & 1 == 1
}

#[repr(C)]
struct Gamepad {
    buttons: u16,
    left_trigger: u8,
    right_trigger: u8,
    lx: i16,
    ly: i16,
    rx: i16,
    ry: i16,
}

#[repr(C)]
struct State {
    packet: u32,
    pad: Gamepad,
}

#[repr(C)]
struct Capabilities {
    kind: u8,
    sub_kind: u8,
    flags: u16,
    pad: Gamepad,
    vibration: [u16; 2],
}

fn current() -> Gamepad {
    let (k, s) = (KEYS.load(Ordering::Relaxed), STICKS.load(Ordering::Relaxed));
    Gamepad {
        buttons: k as u16,
        left_trigger: (k >> 16) as u8,
        right_trigger: (k >> 24) as u8,
        lx: s as i16,
        ly: (s >> 16) as i16,
        rx: (s >> 32) as i16,
        ry: (s >> 48) as i16,
    }
}

unsafe extern "system" fn get_state(user: u32, out: *mut State) -> u32 {
    CALLS[0].fetch_add(1, Ordering::Relaxed);
    if user != 0 || out.is_null() {
        return ERROR_DEVICE_NOT_CONNECTED;
    }
    READS.fetch_add(1, Ordering::Relaxed);
    out.write(State { packet: PACKET.load(Ordering::Relaxed), pad: current() });
    ERROR_SUCCESS
}

unsafe extern "system" fn get_capabilities(user: u32, _flags: u32, out: *mut Capabilities) -> u32 {
    CALLS[1].fetch_add(1, Ordering::Relaxed);
    if user != 0 || out.is_null() {
        return ERROR_DEVICE_NOT_CONNECTED;
    }
    // (a wired Xbox gamepad, every button and the whole of every axis)
    let all = Gamepad { buttons: 0xF7FF, left_trigger: 255, right_trigger: 255, lx: -64, ly: -64, rx: -64, ry: -64 };
    out.write(Capabilities { kind: 1, sub_kind: 1, flags: 0, pad: all, vibration: [0xFFFF, 0xFFFF] });
    ERROR_SUCCESS
}

unsafe extern "system" fn set_state(user: u32, _vibration: *mut c_void) -> u32 {
    if user == 0 { ERROR_SUCCESS } else { ERROR_DEVICE_NOT_CONNECTED }
}

/// A function of the game's patched to jump to the link's: where, its first bytes as they were, and what it was.
struct Patch {
    at: usize,
    was: [u8; 12],
    xinput: bool,
}

static PATCHES: Mutex<Vec<Patch>> = Mutex::new(Vec::new());

/// `name` in module `m` (an ordinal as "#100") patched to jump to `to`, unless it is already, or too short to hold
/// the jump (a 6- or 7-byte jump stub is patched only where the padding after it is free).
unsafe fn patch(patches: &mut Vec<Patch>, m: windows_sys::Win32::Foundation::HMODULE, name: &str, to: usize, xinput: bool) {
    let f = match name.strip_prefix('#') {
        Some(n) => GetProcAddress(m, n.parse::<usize>().unwrap_or(0) as *const u8),
        None => GetProcAddress(m, format!("{name}\0").as_ptr()),
    };
    let Some(f) = f else { return };
    patch_at(patches, f as usize, name, to, xinput);
}

/// The function at `at` patched to jump to `to` (see patch).
unsafe fn patch_at(patches: &mut Vec<Patch>, at: usize, name: &str, to: usize, xinput: bool) {
    // (a forwarded export lands on a function already patched)
    if patches.iter().any(|p| p.at == at) {
        return;
    }
    let mut was = [0u8; 12];
    std::ptr::copy_nonoverlapping(at as *const u8, was.as_mut_ptr(), 12);
    let stub = if was[..2] == [0xFF, 0x25] { 6 } else if was[..3] == [0x48, 0xFF, 0x25] { 7 } else { 0 };
    if stub > 0 && was[stub..].iter().any(|&b| b != 0xCC) {
        log(&format!("{name}: too short to patch"));
        return;
    }
    // mov rax, <ours>; jmp rax
    let mut jump = [0x48u8, 0xB8, 0, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xE0];
    jump[2..10].copy_from_slice(&(to as u64).to_le_bytes());
    if write_code(at, &jump) {
        patches.push(Patch { at, was, xinput });
    }
}

/// The game's XInput (each it has loaded) and its Raw Input device list answered by the link.
unsafe fn hook() {
    let mut patches = PATCHES.lock().unwrap();
    if !patches.iter().any(|p| !p.xinput) {
        if let Some((list, info, data)) = raw::prepare() {
            patch_at(&mut patches, list, "NtUserGetRawInputDeviceList", raw::device_list as raw::List as usize, false);
            patch_at(&mut patches, info, "NtUserGetRawInputDeviceInfo", raw::device_info as raw::Info as usize, false);
            patch_at(&mut patches, data, "NtUserGetRawInputData", raw::input_data as raw::Data as usize, false);
        }
    }
    let before = patches.len();
    let state = get_state as unsafe extern "system" fn(u32, *mut State) -> u32 as usize;
    let caps = get_capabilities as unsafe extern "system" fn(u32, u32, *mut Capabilities) -> u32 as usize;
    let vibrate = set_state as unsafe extern "system" fn(u32, *mut c_void) -> u32 as usize;
    let mut names = Vec::new();
    for dll in ["xinput1_4.dll", "xinput1_3.dll", "xinput9_1_0.dll", "xinput1_2.dll", "xinput1_1.dll"] {
        let w: Vec<u16> = format!("{dll}\0").encode_utf16().collect();
        let m = GetModuleHandleW(w.as_ptr());
        if m.is_null() {
            continue;
        }
        names.push(dll);
        // (GetStateEx is ordinal 100)
        for (name, to) in [("XInputGetState", state), ("#100", state), ("XInputGetCapabilities", caps), ("XInputSetState", vibrate)] {
            patch(&mut patches, m, name, to, true);
        }
    }
    // (each XInput the game loads, as it loads it)
    if patches.len() == before && before > 0 {
        return;
    }
    log(&format!(
        "test pad connected: answered by the link ({} XInput functions in {}, {} Raw Input)",
        patches.iter().filter(|p| p.xinput).count(),
        if names.is_empty() { "no XInput loaded yet".to_string() } else { names.join(", ") },
        patches.iter().filter(|p| !p.xinput).count(),
    ));
}

/// The game's XInput and Raw Input put back as they were.
unsafe fn unhook() {
    let mut patches = PATCHES.lock().unwrap();
    if patches.is_empty() {
        return;
    }
    for p in patches.drain(..) {
        write_code(p.at, &p.was);
    }
    log("test pad disconnected: the game's own XInput and Raw Input back");
}

unsafe fn write_code(at: usize, bytes: &[u8]) -> bool {
    let mut old = 0u32;
    if VirtualProtect(at as *const c_void, bytes.len(), PAGE_EXECUTE_READWRITE, &mut old) == 0 {
        return false;
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), at as *mut u8, bytes.len());
    VirtualProtect(at as *const c_void, bytes.len(), old, &mut old);
    FlushInstructionCache(GetCurrentProcess(), at as *const c_void, bytes.len());
    true
}

/// The studio's pad as written: what's held, where the sticks are.
fn apply(v: &serde_json::Value) {
    let f = |k: &str| v.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0).clamp(-1.0, 1.0);
    let axis = |k: &str| ((f(k) * 32767.0).round() as i16) as u16 as u64;
    let trigger = |k: &str| ((f(k).max(0.0) * 255.0).round() as u64) & 0xFF;
    let held = v.get("buttons").and_then(|b| b.as_array()).map(|b| b.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>()).unwrap_or_default();
    let buttons = BUTTONS.iter().filter(|(n, _)| held.contains(n)).fold(0u64, |m, (_, bit)| m | *bit as u64);
    let on = v.get("connected").and_then(|x| x.as_bool()).unwrap_or(false) as u64;
    let keep = v.get("keepSource").and_then(|x| x.as_bool()).unwrap_or(false) as u64;
    KEYS.store(buttons | trigger("lt") << 16 | trigger("rt") << 24 | on << 32 | keep << 33, Ordering::Relaxed);
    STICKS.store(axis("lx") | axis("ly") << 16 | axis("rx") << 32 | axis("ry") << 48, Ordering::Relaxed);
    PACKET.fetch_add(1, Ordering::Relaxed);
    let keys = v.get("keys").and_then(|b| b.as_array()).map(|b| b.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>()).unwrap_or_default();
    unsafe { keys::hold(&keys) };
}

/// The pad's own thread: studio-pad.json read as soon as it changes (a test's presses last a frame or two).
pub(crate) unsafe extern "system" fn watch_pad(_: *mut c_void) -> u32 {
    let path = jibbers_dir().join("studio-pad.json");
    let mut stamp = None;
    let mut tried = Instant::now();
    loop {
        let now = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
        // (connected before the game had loaded its XInput: tried again every second)
        // (while connected, an XInput the game loads later answered too: looked for every second)
        let retry = connected() && tried.elapsed() > Duration::from_secs(1);
        if now != stamp || retry {
            stamp = now;
            tried = Instant::now();
            match read_json("studio-pad.json") {
                Some(v) => apply(&v),
                None => {
                    KEYS.store(0, Ordering::Relaxed);
                    keys::hold(&[]);
                }
            }
            if connected() { hook() } else { unhook() }
        }
        Sleep(5);
    }
}
