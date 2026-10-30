//! The test pad in the game's Raw Input device list, where Rewired finds controllers: listed as an Xbox 360 pad (its
//! path says IG_00, as Windows names XInput pads, so it's read through XInput's first slot), the real game controllers
//! left out (the test pad takes the player). Only for the game's own code (GameAssembly.dll: Rewired is there): Unity's
//! input, which looks at the same list, sees Windows' (it crashed on a device it couldn't open).
//!
//! The studio's test keys come through here too (keys.rs): each a WM_INPUT posted to the window the game's keyboard
//! Raw Input goes to (Rewired's), its handle one of the link's, its RAWINPUT answered by the link.
//!
//! Answered at the bottom, in win32u's NtUserGetRawInputDeviceList and NtUserGetRawInputDeviceInfo, under user32's
//! GetRawInputDeviceList and GetRawInputDeviceInfoA/W: the Steam overlay hooks those user32 calls itself (its hook ran
//! into a patch there and crashed the game). Windows' own answers come from copies of the two (each a system call stub
//! that runs anywhere).

use super::super::*;
use super::CALLS;
use windows_sys::Win32::Foundation::SetLastError;
use windows_sys::Win32::System::Diagnostics::Debug::RtlCaptureStackBackTrace;
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
use windows_sys::Win32::System::Memory::{VirtualAlloc, MEM_COMMIT, MEM_RESERVE, PAGE_EXECUTE_READWRITE};
use windows_sys::Win32::UI::Input::{GetRegisteredRawInputDevices, RAWINPUTDEVICE};

/// RAWINPUTDEVICELIST
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct Device {
    handle: isize,
    kind: u32,
}

pub(crate) type List = unsafe extern "system" fn(*mut Device, *mut u32, u32) -> u32;
pub(crate) type Info = unsafe extern "system" fn(isize, u32, *mut c_void, *mut u32) -> u32;
pub(crate) type Data = unsafe extern "system" fn(isize, u32, *mut c_void, *mut u32, u32) -> u32;

/// The test pad's device handle (one no real device has).
const PAD: isize = 0x5A1D_0001;
const HID: u32 = 2;
const RIDI_DEVICENAME: u32 = 0x2000_0007;
const RIDI_DEVICEINFO: u32 = 0x2000_000B;
const FAILED: u32 = u32::MAX;
const ERROR_INSUFFICIENT_BUFFER: u32 = 122;
const ERROR_INVALID_PARAMETER: u32 = 87;
/// RID_INPUT and RID_HEADER: GetRawInputData's whole input, or its header only.
const RID_INPUT: u32 = 0x1000_0003;
const RID_HEADER: u32 = 0x1000_0005;
const RIM_TYPEKEYBOARD: u32 = 1;
/// The test keys' Raw Input handles (no real input has these): FAKE + a slot, the slots used in turn.
const FAKE: isize = 0x5A1D_1000;
const SLOTS: usize = 64;
/// A wired Xbox 360 pad's path, in XInput's first slot.
const PATH: &str = r"\\?\HID#VID_045E&PID_028E&IG_00#7&5a1d0001&0&0000#{4d1e55b2-f16f-11cf-88cb-001111000030}";
/// How long a win32u stub is: mov r10, rcx; mov eax, <call>; test the syscall flag; jne; syscall; ret; int 2e; ret.
const STUB: usize = 24;

/// Windows' own three calls: the stubs' copies.
static REAL: std::sync::OnceLock<(List, Info, Data)> = std::sync::OnceLock::new();

/// Where the three win32u stubs are (to patch), their copies made first; None when they aren't plain stubs.
pub(crate) unsafe fn prepare() -> Option<(usize, usize, usize)> {
    let name: Vec<u16> = "win32u.dll\0".encode_utf16().collect();
    let m = GetModuleHandleW(name.as_ptr());
    if m.is_null() {
        return None;
    }
    let list = GetProcAddress(m, c"NtUserGetRawInputDeviceList".as_ptr() as *const u8)? as usize;
    let info = GetProcAddress(m, c"NtUserGetRawInputDeviceInfo".as_ptr() as *const u8)? as usize;
    let data = GetProcAddress(m, c"NtUserGetRawInputData".as_ptr() as *const u8)? as usize;
    let plain = |at: usize| {
        let b = std::slice::from_raw_parts(at as *const u8, STUB);
        b[..4] == [0x4C, 0x8B, 0xD1, 0xB8] && b[STUB - 1] == 0xC3
    };
    if !plain(list) || !plain(info) || !plain(data) {
        log("Raw Input: win32u's calls aren't plain stubs: not answered");
        return None;
    }
    if REAL.get().is_none() {
        let copies = VirtualAlloc(std::ptr::null(), 3 * STUB, MEM_COMMIT | MEM_RESERVE, PAGE_EXECUTE_READWRITE) as *mut u8;
        if copies.is_null() {
            return None;
        }
        for (i, at) in [list, info, data].into_iter().enumerate() {
            std::ptr::copy_nonoverlapping(at as *const u8, copies.add(i * STUB), STUB);
        }
        let _ = REAL.set((
            std::mem::transmute::<*mut u8, List>(copies),
            std::mem::transmute::<*mut u8, Info>(copies.add(STUB)),
            std::mem::transmute::<*mut u8, Data>(copies.add(2 * STUB)),
        ));
    }
    Some((list, info, data))
}

/// The game's Raw Input registrations: who gets which devices' input, and how.
pub(crate) fn registrations() -> Vec<RAWINPUTDEVICE> {
    let size = std::mem::size_of::<RAWINPUTDEVICE>() as u32;
    let mut n = 0u32;
    unsafe {
        GetRegisteredRawInputDevices(std::ptr::null_mut(), &mut n, size);
        let mut list = vec![std::mem::zeroed::<RAWINPUTDEVICE>(); n as usize];
        let got = GetRegisteredRawInputDevices(list.as_mut_ptr(), &mut n, size);
        if got == u32::MAX {
            return Vec::new();
        }
        list.truncate(got as usize);
        list
    }
}

/// Whether the call came from the game's own code (GameAssembly.dll), a few calls up (user32 and the Steam overlay's
/// hook between).
unsafe fn from_game() -> bool {
    static RANGE: std::sync::OnceLock<(usize, usize)> = std::sync::OnceLock::new();
    let (lo, hi) = *RANGE.get_or_init(|| {
        let name: Vec<u16> = "GameAssembly.dll\0".encode_utf16().collect();
        let base = GetModuleHandleW(name.as_ptr()) as usize;
        if base == 0 {
            return (0, 0);
        }
        // (its size, from its PE header: SizeOfImage)
        let pe = *((base + 0x3C) as *const u32) as usize;
        (base, base + *((base + pe + 0x50) as *const u32) as usize)
    });
    let mut frames = [std::ptr::null_mut::<c_void>(); 8];
    let n = RtlCaptureStackBackTrace(1, frames.len() as u32, frames.as_mut_ptr(), std::ptr::null_mut()) as usize;
    frames[..n].iter().any(|&f| (lo..hi).contains(&(f as usize)))
}

/// RID_DEVICE_INFO of a HID device: (usage page, usage).
fn usage_of(h: isize) -> Option<(u16, u16)> {
    let (_, info, _) = *REAL.get()?;
    let mut b = [0u8; 32];
    b[..4].copy_from_slice(&32u32.to_le_bytes());
    let mut n = 32u32;
    if unsafe { info(h, RIDI_DEVICEINFO, b.as_mut_ptr() as *mut c_void, &mut n) } == FAILED || u32::from_le_bytes(b[4..8].try_into().ok()?) != HID {
        return None;
    }
    Some((u16::from_le_bytes([b[20], b[21]]), u16::from_le_bytes([b[22], b[23]])))
}

/// A game controller (a joystick, gamepad or multi-axis controller).
fn is_controller(h: isize) -> bool {
    usage_of(h).is_some_and(|(page, usage)| page == 1 && matches!(usage, 4 | 5 | 8))
}

/// `bytes` into the caller's buffer as GetRawInputDeviceInfo does (in `unit`s): its size asked (no buffer), too small,
/// or copied.
unsafe fn give(data: *mut c_void, size: *mut u32, bytes: &[u8], unit: usize) -> u32 {
    let want = (bytes.len() / unit) as u32;
    if data.is_null() {
        *size = want;
        return 0;
    }
    if *size < want {
        *size = want;
        SetLastError(ERROR_INSUFFICIENT_BUFFER);
        return FAILED;
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), data as *mut u8, bytes.len());
    want
}

pub(crate) unsafe extern "system" fn device_list(list: *mut Device, count: *mut u32, size: u32) -> u32 {
    let Some(&(real, _, _)) = REAL.get() else { return FAILED };
    if count.is_null() || size as usize != std::mem::size_of::<Device>() || !from_game() {
        return real(list, count, size);
    }
    CALLS[2].fetch_add(1, Ordering::Relaxed);
    // Windows' own, the game controllers left out, the test pad added
    let mut n = 0u32;
    real(std::ptr::null_mut(), &mut n, size);
    let mut all = vec![Device { handle: 0, kind: 0 }; n as usize + 8];
    let mut cap = all.len() as u32;
    let got = real(all.as_mut_ptr(), &mut cap, size);
    if got == FAILED {
        return real(list, count, size);
    }
    all.truncate(got as usize);
    all.retain(|d| d.kind != HID || !is_controller(d.handle));
    all.push(Device { handle: PAD, kind: HID });
    let want = all.len() as u32;
    if list.is_null() {
        *count = want;
        return 0;
    }
    if *count < want {
        *count = want;
        SetLastError(ERROR_INSUFFICIENT_BUFFER);
        return FAILED;
    }
    std::ptr::copy_nonoverlapping(all.as_ptr(), list, all.len());
    want
}

pub(crate) unsafe extern "system" fn device_info(h: isize, cmd: u32, data: *mut c_void, size: *mut u32) -> u32 {
    let Some(&(_, real, _)) = REAL.get() else { return FAILED };
    if h != PAD || size.is_null() {
        return real(h, cmd, data, size);
    }
    CALLS[match cmd { RIDI_DEVICENAME => 3, RIDI_DEVICEINFO => 4, _ => 5 }].fetch_add(1, Ordering::Relaxed);
    match cmd {
        RIDI_DEVICENAME => {
            let path: Vec<u8> = PATH.encode_utf16().chain([0]).flat_map(|c| c.to_le_bytes()).collect();
            give(data, size, &path, 2)
        }
        RIDI_DEVICEINFO => {
            // RID_DEVICE_INFO: HID, a wired Xbox 360 pad (vendor 045E, product 028E), a gamepad (page 1, usage 5)
            let mut b = [0u8; 32];
            for (i, v) in [(0, 32u32), (4, HID), (8, 0x045E), (12, 0x028E), (16, 0x0114)] {
                b[i..i + 4].copy_from_slice(&v.to_le_bytes());
            }
            b[20..22].copy_from_slice(&1u16.to_le_bytes());
            b[22..24].copy_from_slice(&5u16.to_le_bytes());
            give(data, size, &b, 1)
        }
        _ => {
            SetLastError(ERROR_INVALID_PARAMETER);
            FAILED
        }
    }
}

/// Each slot's key: its virtual-key code, scan code and whether it's let go.
static KEYS: Mutex<[(u16, u16, bool); SLOTS]> = Mutex::new([(0, 0, false); SLOTS]);
static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// A test key's Raw Input handle, for a WM_INPUT posted to the window the game's keyboard Raw Input goes to.
pub(crate) fn key_input(vk: u16, scan: u16, up: bool) -> isize {
    let slot = NEXT.fetch_add(1, Ordering::Relaxed) % SLOTS;
    KEYS.lock().unwrap()[slot] = (vk, scan, up);
    FAKE + slot as isize
}

/// A test key's RAWINPUT, as Windows makes one for a key typed (on no device in particular, as with keys sent in by a
/// program): its header (type, size, device, wParam), then RAWKEYBOARD (make code, flags, reserved, virtual key,
/// message, extra information).
fn key_record(slot: usize) -> [u8; 40] {
    let (vk, scan, up) = KEYS.lock().unwrap()[slot];
    let mut b = [0u8; 40];
    b[0..4].copy_from_slice(&RIM_TYPEKEYBOARD.to_le_bytes());
    b[4..8].copy_from_slice(&40u32.to_le_bytes());
    b[24..26].copy_from_slice(&scan.to_le_bytes());
    // (RI_KEY_BREAK)
    b[26..28].copy_from_slice(&(up as u16).to_le_bytes());
    b[30..32].copy_from_slice(&vk.to_le_bytes());
    b[32..36].copy_from_slice(&(if up { WM_KEYUP } else { WM_KEYDOWN }).to_le_bytes());
    b
}

pub(crate) unsafe extern "system" fn input_data(h: isize, cmd: u32, data: *mut c_void, size: *mut u32, header: u32) -> u32 {
    let Some(&(_, _, real)) = REAL.get() else { return FAILED };
    if !(FAKE..FAKE + SLOTS as isize).contains(&h) || size.is_null() {
        return real(h, cmd, data, size, header);
    }
    let record = key_record((h - FAKE) as usize);
    let bytes = match cmd {
        RID_INPUT => &record[..],
        RID_HEADER => &record[..24],
        _ => {
            SetLastError(ERROR_INVALID_PARAMETER);
            return FAILED;
        }
    };
    give(data, size, bytes, 1)
}
