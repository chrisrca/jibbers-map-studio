//! What the studio's tests read of the game while its test pad is in (studio-pad.json there): the scene, where the
//! cameras are and which way they look, whether a drone is out, the controllers Rewired has and how it reads them, and
//! how often the game has asked for the test pad. Written to studio-probe.json each tick.

use super::*;

/// The game's Raw Input registrations (who gets which devices' input, and how): each as usage page, usage, flags, and
/// the window it's sent to ("game", "none": the focused one, or "other").
fn registered() -> Vec<serde_json::Value> {
    let game = WINDOW.load(Ordering::Relaxed) as HWND;
    pad::raw::registrations()
        .iter()
        .map(|d| {
            let to = if d.hwndTarget.is_null() { "none" } else if d.hwndTarget == game { "game" } else { "other" };
            serde_json::json!([d.usUsagePage, d.usUsage, format!("{:#x}", d.dwFlags), to])
        })
        .collect()
}

/// The calls the probe makes, looked up once (any it can't find, left out).
pub(crate) struct Probe {
    all_cameras: Option<Ptr>,
    transform: Option<Ptr>,
    position: Option<Ptr>,
    rotation: Option<Ptr>,
    drone: Option<Ptr>,
    controllers: Option<Ptr>,
    players: Option<Ptr>,
    mapping: Option<Ptr>,
    focused: Option<Ptr>,
    follow_cam: Option<Ptr>,
    chat: Option<Ptr>,
    /// what Rewired was last found to have (logged when it changes)
    seen: String,
    /// Rewired switched to reading XInput (the test pad's) as its primary source
    switched: bool,
}

impl Probe {
    pub(crate) fn find(a: &Api) -> Probe {
        let m = |ns: &str, cls: &str, name: &str| a.class(ns, cls).and_then(|c| a.method(c, name, &[]));
        Probe {
            all_cameras: m("UnityEngine", "Camera", "get_allCameras"),
            transform: m("UnityEngine", "Component", "get_transform"),
            position: m("UnityEngine", "Transform", "get_position"),
            rotation: m("UnityEngine", "Transform", "get_rotation"),
            drone: a.class("", "Drone"),
            controllers: m("Rewired", "ReInput", "get_controllers"),
            players: m("Rewired", "ReInput", "get_players"),
            mapping: m("Rewired", "ReInput", "get_mapping"),
            focused: m("UnityEngine", "Application", "get_isFocused"),
            follow_cam: a.class("", "FollowCam"),
            chat: a.class("", "sj"),
            seen: String::new(),
            switched: false,
        }
    }

    pub(crate) unsafe fn tick(&mut self, a: &Api, link: &Link) {
        let u = link.unity.as_ref().unwrap();
        let cameras = self.cameras(a);
        // the drones out, and where each is and which way it looks
        let found = match (u.find_objects, self.drone) {
            (Some(find), Some(d)) => a.invoke(find, std::ptr::null_mut(), &mut [a.type_object(d)]).unwrap_or(std::ptr::null_mut()),
            _ => std::ptr::null_mut(),
        };
        let drones = a.array_length(found);
        // whether the game's camera is turning down look input this frame (its own flag, under the obfuscator's name:
        // no focus, a menu or the chat open, the cursor out)
        let look_blocked = self.first_flag(a, link, self.follow_cam, "prf");
        // whether the chat is open (the same: its class and flag under the obfuscator's names)
        let chat_open = self.first_flag(a, link, self.chat, "sxn");
        let drone_poses: Vec<[f32; 7]> = (0..drones).filter_map(|i| self.pose(a, *((found as *const u8).add(0x20) as *const Ptr).add(i as usize))).collect();
        if pad::connected() && !pad::keep_source() && !self.switched && link.rewired_ready(a) {
            self.switched = true;
            self.use_xinput(a, link);
        }
        let (source, xinput, joysticks) = self.rewired(a, link);
        let seen = format!("{source} {xinput} {joysticks:?}");
        if seen != self.seen {
            log(&format!("Rewired: input source {source} (0 Raw Input, 1 DirectInput, 2 XInput, 3 Windows Gaming Input), XInput {xinput}, joysticks {joysticks:?}"));
            self.seen = seen;
        }
        let v = serde_json::json!({
            "scene": link.scene(a),
            "frame": get::<i32>(a, u.frame_count),
            // (the game's camera takes no look input while it's false: FollowCam)
            "focused": self.focused.map(|f| get::<u8>(a, f) != 0),
            "lookBlocked": look_blocked,
            "chatOpen": chat_open,
            "cameras": cameras,
            "drones": drones,
            "dronePoses": drone_poses,
            "source": source,
            "xinput": xinput,
            "joysticks": joysticks,
            "rawInput": registered(),
            "players": self.players(a, link),
            "padReads": pad::READS.load(Ordering::Relaxed),
            "calls": pad::CALLS.iter().map(|c| c.load(Ordering::Relaxed)).collect::<Vec<_>>(),
            "ms": started().elapsed().as_millis() as u64,
        });
        let _ = std::fs::write(jibbers_dir().join("studio-probe.json"), v.to_string());
    }

    /// A flag of the first object of a class in the scene, None without one.
    unsafe fn first_flag(&self, a: &Api, link: &Link, class: Option<Ptr>, field: &str) -> Option<bool> {
        let found = a.invoke(link.unity.as_ref().unwrap().find_objects?, std::ptr::null_mut(), &mut [a.type_object(class?)]).ok()?;
        if a.array_length(found) == 0 {
            return None;
        }
        a.field::<u8>(*((found as *const u8).add(0x20) as *const Ptr), field).map(|b| b != 0)
    }

    /// Each enabled camera's place and turn (x y z, then the quaternion's x y z w): the game's own isn't tagged as
    /// Unity's main camera.
    unsafe fn cameras(&self, a: &Api) -> Vec<[f32; 7]> {
        let Some(all) = self.all_cameras.and_then(|m| a.invoke(m, std::ptr::null_mut(), &mut []).ok()) else { return Vec::new() };
        // (an array's elements start 0x20 in)
        (0..a.array_length(all)).filter_map(|i| self.pose(a, *((all as *const u8).add(0x20) as *const Ptr).add(i as usize))).collect()
    }

    unsafe fn pose(&self, a: &Api, cam: Ptr) -> Option<[f32; 7]> {
        if cam.is_null() {
            return None;
        }
        let t = a.invoke(self.transform?, cam, &mut []).ok()?;
        if t.is_null() {
            return None;
        }
        let p = a.unbox::<[f32; 3]>(a.invoke(self.position?, t, &mut []).ok()?)?;
        let q = a.unbox::<[f32; 4]>(a.invoke(self.rotation?, t, &mut []).ok()?)?;
        Some([p[0], p[1], p[2], q[0], q[1], q[2], q[3]])
    }

    /// Every Rewired player (the system one too): its name, and each joystick it has with that joystick's maps (each
    /// its category's name, and whether it's on).
    unsafe fn players(&self, a: &Api, link: &Link) -> Vec<String> {
        if !link.rewired_ready(a) {
            return Vec::new();
        }
        let call = |obj: Ptr, name: &str, params: &[&str], args: &mut [Ptr]| -> Option<Ptr> {
            if obj.is_null() {
                return None;
            }
            let r = a.invoke(a.method(a.class_of(obj), name, params)?, obj, args).ok()?;
            (!r.is_null()).then_some(r)
        };
        // an IList's items
        let items = |list: Option<Ptr>| -> Vec<Ptr> {
            let Some(list) = list else { return Vec::new() };
            let n = call(list, "get_Count", &[], &mut []).and_then(|o| a.unbox::<i32>(o)).unwrap_or(0);
            (0..n).filter_map(|mut i| call(list, "get_Item", &["System.Int32"], &mut [&mut i as *mut i32 as Ptr])).collect()
        };
        let text = |o: Ptr, name: &str| call(o, name, &[], &mut []).map(|s| a.read_string(s)).unwrap_or_default();
        let Some(helper) = self.players.and_then(|m| a.invoke(m, std::ptr::null_mut(), &mut []).ok()).filter(|p| !p.is_null()) else { return Vec::new() };
        let mapping = self.mapping.and_then(|m| a.invoke(m, std::ptr::null_mut(), &mut []).ok()).unwrap_or(std::ptr::null_mut());
        items(call(helper, "get_AllPlayers", &[], &mut []))
            .into_iter()
            .map(|p| {
                let controllers = a.field_object(p, "controllers").unwrap_or(std::ptr::null_mut());
                let maps = a.field_object(controllers, "maps").unwrap_or(std::ptr::null_mut());
                let joysticks: Vec<String> = items(call(controllers, "get_Joysticks", &[], &mut []))
                    .into_iter()
                    .map(|j| {
                        let each: Vec<String> = items(call(maps, "GetMaps", &["Rewired.Controller"], &mut [j]))
                            .into_iter()
                            .map(|m| {
                                let mut cat = call(m, "get_categoryId", &[], &mut []).and_then(|o| a.unbox::<i32>(o)).unwrap_or(-1);
                                let on = call(m, "get_enabled", &[], &mut []).and_then(|o| a.unbox::<u8>(o)).unwrap_or(0) != 0;
                                let name = call(mapping, "GetMapCategory", &["System.Int32"], &mut [&mut cat as *mut i32 as Ptr]).map(|c| text(c, "get_name")).unwrap_or_else(|| cat.to_string());
                                format!("{name}:{}", if on { "on" } else { "off" })
                            })
                            .collect();
                        format!("{} [{}]", text(j, "get_name"), each.join(", "))
                    })
                    .collect();
                format!("{}: {}", text(p, "get_name"), if joysticks.is_empty() { "no joysticks".to_string() } else { joysticks.join("; ") })
            })
            .collect()
    }

    /// The first player's maps for a controller: each its category's name, layout and whether it's on ("Drone:0:on").
    unsafe fn player_maps<'a>(&self, a: &'a Api) -> Result<impl Fn(Ptr) -> String + 'a, &'static str> {
        let call = move |obj: Ptr, name: &str, params: &[&str], args: &mut [Ptr]| -> Option<Ptr> {
            if obj.is_null() {
                return None;
            }
            let r = a.invoke(a.method(a.class_of(obj), name, params)?, obj, args).ok()?;
            (!r.is_null()).then_some(r)
        };
        let players = a.invoke(self.players.ok_or("no ReInput.players")?, std::ptr::null_mut(), &mut []).ok().filter(|p| !p.is_null()).ok_or("ReInput.players null")?;
        let mapping = a.invoke(self.mapping.ok_or("no ReInput.mapping")?, std::ptr::null_mut(), &mut []).ok().filter(|p| !p.is_null()).ok_or("ReInput.mapping null")?;
        let mut first = 0i32;
        let player = call(players, "GetPlayer", &["System.Int32"], &mut [&mut first as *mut i32 as Ptr]).ok_or("no player 0")?;
        // (fields, not properties)
        let helper = a.field_object(player, "controllers").ok_or("no player.controllers")?;
        let maps = a.field_object(helper, "maps").ok_or("no controllers.maps")?;
        Ok(move |controller: Ptr| {
            let Some(list) = call(maps, "GetMaps", &["Rewired.Controller"], &mut [controller]) else { return "none".into() };
            let n = call(list, "get_Count", &[], &mut []).and_then(|o| a.unbox::<i32>(o)).unwrap_or(0);
            let each: Vec<String> = (0..n)
                .filter_map(|mut i| {
                    let m = call(list, "get_Item", &["System.Int32"], &mut [&mut i as *mut i32 as Ptr])?;
                    let int = |name: &str| call(m, name, &[], &mut []).and_then(|o| a.unbox::<i32>(o)).unwrap_or(-1);
                    let mut cat = int("get_categoryId");
                    let on = call(m, "get_enabled", &[], &mut []).and_then(|o| a.unbox::<u8>(o)).unwrap_or(0) != 0;
                    let name = call(mapping, "GetMapCategory", &["System.Int32"], &mut [&mut cat as *mut i32 as Ptr])
                        .and_then(|c| call(c, "get_name", &[], &mut []))
                        .map(|s| a.read_string(s))
                        .unwrap_or_else(|| cat.to_string());
                    Some(format!("{name}:{}:{}", int("get_layoutId"), if on { "on" } else { "off" }))
                })
                .collect();
            format!("[{}]", each.join(", "))
        })
    }

    /// Rewired set to read controllers through XInput, where the test pad is (in Raw Input, its first choice, it only
    /// takes an XInput pad it can open as a device): as soon as it's up, before the map, for the whole of a test.
    unsafe fn use_xinput(&self, a: &Api, link: &Link) {
        let r = link.unity.as_ref().unwrap().rewired.as_ref().unwrap();
        let Ok(cfg) = a.invoke(r.configuration, std::ptr::null_mut(), &mut []) else { return };
        let Some(set) = (!cfg.is_null()).then(|| a.method(a.class_of(cfg), "set_windowsStandalonePrimaryInputSource", &["Rewired.Platforms.WindowsStandalonePrimaryInputSource"])).flatten() else {
            log("Rewired: no way to set its input source");
            return;
        };
        const XINPUT: i32 = 2;
        let mut v = XINPUT;
        match a.invoke(set, cfg, &mut [&mut v as *mut i32 as Ptr]) {
            Ok(_) => log("Rewired: input source set to XInput for the test pad"),
            Err(e) => log(&format!("Rewired: setting its input source {e}")),
        }
    }

    /// Rewired's Windows input source, whether it uses XInput, and the joysticks it has.
    unsafe fn rewired(&self, a: &Api, link: &Link) -> (i32, bool, Vec<String>) {
        if !link.rewired_ready(a) {
            return (-1, false, Vec::new());
        }
        let r = link.unity.as_ref().unwrap().rewired.as_ref().unwrap();
        let cfg = a.invoke(r.configuration, std::ptr::null_mut(), &mut []).unwrap_or(std::ptr::null_mut());
        let call = |obj: Ptr, name: &str| -> Option<Ptr> {
            if obj.is_null() {
                return None;
            }
            a.invoke(a.method(a.class_of(obj), name, &[])?, obj, &mut []).ok()
        };
        let source = call(cfg, "get_windowsStandalonePrimaryInputSource").and_then(|o| a.unbox::<i32>(o)).unwrap_or(-1);
        let xinput = call(cfg, "get_useXInput").and_then(|o| a.unbox::<u8>(o)).unwrap_or(0) != 0;
        let steam = call(cfg, "get_useSteamControllerSupport").and_then(|o| a.unbox::<u8>(o)).map(|v| v != 0);
        let helper = self.controllers.and_then(|m| a.invoke(m, std::ptr::null_mut(), &mut []).ok()).unwrap_or(std::ptr::null_mut());
        let list = call(helper, "GetJoysticks").unwrap_or(std::ptr::null_mut());
        let maps = self.player_maps(a);
        // each: its name, the hardware's, Rewired's class for it, and its maps on the first player (an array's
        // elements start 0x20 in)
        let mut joysticks: Vec<String> = (0..a.array_length(list))
            .map(|i| {
                let j = *((list as *const u8).add(0x20) as *const Ptr).add(i as usize);
                let s = |name: &str| call(j, name).map(|o| a.read_string(o)).unwrap_or_default();
                format!("{} | {} | {} | player 0 maps {}", s("get_name"), s("get_hardwareName"), a.class_name(j), match &maps { Ok(m) => m(j), Err(e) => e.to_string() })
            })
            .collect();
        let enhanced = call(cfg, "get_useEnhancedDeviceSupport").and_then(|o| a.unbox::<u8>(o)).map(|v| v != 0);
        joysticks.push(format!("(Steam controller support: {steam:?}, enhanced device support: {enhanced:?})"));
        (source, xinput, joysticks)
    }
}
