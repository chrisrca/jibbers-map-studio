//! The link itself: on the game's main thread each tick, the map the studio asks for loaded (in place where it can be),
//! the rider spawned, and what's happening reported back.

use super::*;

#[derive(PartialEq, Clone, Copy, Debug)]
pub(crate) enum Phase {
    /// waiting for the game to be up (its welcome screen, the menu, or the controls screen)
    Waiting,
    /// back to the menu to reload the map (the old one torn down as when a player leaves it)
    Menu(Instant),
    /// gone to the loading screen, which goes on to the map
    Loading(Instant),
    /// the loading screen didn't: the map loaded straight
    Direct,
    /// in the map (or nothing asked for)
    Done,
}

pub(crate) struct Link {
    pub(crate) unity: Option<Unity>,
    pub(crate) failed: bool,
    pub(crate) phase: Phase,
    /// the map asked for, and when that request was written
    pub(crate) map: String,
    pub(crate) request_stamp: Option<std::time::SystemTime>,
    pub(crate) embed: bool,
    pub(crate) ticks: u64,
    // the Game tab
    pub(crate) screen_ready: bool,
    pub(crate) studio: (i32, i32),
    pub(crate) studio_hidden: bool,
    pub(crate) studio_parked: bool,
    pub(crate) studio_pid: u32,
    pub(crate) size_stamp: Option<std::time::SystemTime>,
    pub(crate) size_changed: Instant,
    pub(crate) out_of_sight: bool,
    pub(crate) saved: (f32, i32, i32),
    pub(crate) input_without_focus: bool,
    pub(crate) status_at: Option<(Instant, i32)>,
    /// the size last asked of the game, and when (Unity only reports a new size a frame or so later)
    pub(crate) asked: Option<((i32, i32), Instant)>,
    /// what the studio's tests read of the game (while they have the test pad in)
    pub(crate) probe: Option<probe::Probe>,
}

impl Link {
    pub(crate) fn new() -> Link {
        let req = read_json("studio-play.json");
        let map = req.as_ref().and_then(|r| r.get("mapId")?.as_str().map(str::to_string)).unwrap_or_default();
        Link {
            unity: None,
            failed: false,
            phase: if map.is_empty() { Phase::Done } else { Phase::Waiting },
            map,
            request_stamp: std::fs::metadata(jibbers_dir().join("studio-play.json")).and_then(|m| m.modified()).ok(),
            embed: req.as_ref().and_then(|r| r.get("embed")?.as_bool()).unwrap_or(false),
            ticks: 0,
            screen_ready: false,
            studio: (0, 0),
            studio_hidden: false,
            studio_parked: false,
            studio_pid: 0,
            size_stamp: None,
            size_changed: Instant::now(),
            out_of_sight: false,
            saved: (1.0, 1, -1),
            input_without_focus: false,
            status_at: None,
            asked: None,
            probe: None,
        }
    }

    pub(crate) unsafe fn tick(&mut self, a: &Api) {
        self.ticks += 1;
        if self.failed {
            return;
        }
        if self.unity.is_none() {
            match Unity::find(a) {
                Ok(u) => {
                    log(&format!(
                        "Unity found{}{}",
                        if u.startup_menu.is_some() { "" } else { " (no StartupMenu: waiting for the menu instead)" },
                        if u.init_maps.is_some() { "" } else { " (no InitMaps: reloads use the maps as first read)" }
                    ));
                    report("ok", &self.map);
                    self.unity = Some(u);
                }
                Err(e) => {
                    // (the runtime may still be filling in: tried again for a while)
                    if self.ticks > 1200 {
                        log(&format!("gave up: {e}"));
                        report(&e, &self.map);
                        self.failed = true;
                    }
                    return;
                }
            }
        }
        if self.embed {
            if !self.screen_ready {
                self.screen_ready = true;
                self.prepare_screen(a);
            }
            self.fit_to_studio(a);
        }
        self.check_request();
        self.play(a);
        if jibbers_dir().join("studio-pad.json").exists() {
            let mut p = self.probe.take().unwrap_or_else(|| probe::Probe::find(a));
            p.tick(a, self);
            self.probe = Some(p);
        }
    }

    /// Play pressed again in the studio on this map: reloaded in place, once it's in the map.
    pub(crate) fn check_request(&mut self) {
        let path = jibbers_dir().join("studio-play.json");
        let Ok(stamp) = std::fs::metadata(&path).and_then(|m| m.modified()) else { return };
        if self.request_stamp == Some(stamp) {
            return;
        }
        self.request_stamp = Some(stamp);
        let Some(req) = read_json("studio-play.json") else { return };
        let map = req.get("mapId").and_then(|m| m.as_str()).unwrap_or_default();
        if req.get("reload").is_none() || map != self.map {
            return;
        }
        if self.phase == Phase::Done {
            log("reload asked: back to the menu");
            self.phase = Phase::Menu(Instant::now());
        }
    }

    /// The map started as soon as the game is up, and followed until it's in.
    pub(crate) unsafe fn play(&mut self, a: &Api) {
        if self.phase == Phase::Done {
            return;
        }
        let u = self.unity.as_ref().unwrap();
        let scene = self.scene(a);
        match self.phase {
            Phase::Menu(since) => {
                if since.elapsed() < Duration::from_millis(150) {
                    // (just asked: leave the map for the menu)
                    if scene != "MainMenu" {
                        self.load(a, "MainMenu");
                    }
                    self.phase = Phase::Menu(since - Duration::from_millis(150));
                } else if (scene == "MainMenu" && since.elapsed() > Duration::from_millis(1200)) || since.elapsed() > Duration::from_secs(20) {
                    if let Some(init) = u.init_maps {
                        if let Err(e) = a.invoke(init, std::ptr::null_mut(), &mut []) {
                            log(&format!("reading the maps again {e}"));
                        }
                    }
                    log(&format!("reloading the map (from '{scene}')"));
                    set(a, u.set_time_scale, 1.0f32);
                    self.load(a, "LoadingScreen");
                    self.phase = Phase::Loading(Instant::now());
                }
            }
            Phase::Waiting => {
                let up = match scene.as_str() {
                    "Startup" => self.welcome_up(a),
                    "MainMenu" | "Controls" => true,
                    "Main" => {
                        self.phase = Phase::Done;
                        return;
                    }
                    _ => false,
                };
                if up {
                    log(&format!("the game is up ({scene}): off to the map"));
                    // (the welcome screen stops the clock until it's closed)
                    set(a, u.set_time_scale, 1.0f32);
                    self.load(a, "LoadingScreen");
                    self.phase = Phase::Loading(Instant::now());
                }
            }
            Phase::Loading(since) => {
                if scene == "Main" {
                    log("in the map");
                    self.phase = Phase::Done;
                } else if (scene == "MainMenu" && since.elapsed() > Duration::from_secs(2)) || (scene == "LoadingScreen" && since.elapsed() > Duration::from_secs(12)) {
                    log(&format!("the loading screen went to '{scene}': loading the map straight"));
                    self.load(a, "Main");
                    self.phase = Phase::Direct;
                }
            }
            Phase::Direct => {
                if scene == "Main" {
                    log("in the map");
                    self.phase = Phase::Done;
                }
            }
            Phase::Done => {}
        }
    }

    pub(crate) unsafe fn load(&self, a: &Api, scene: &str) {
        let u = self.unity.as_ref().unwrap();
        if let Err(e) = a.invoke(u.load_scene, std::ptr::null_mut(), &mut [a.string(scene)]) {
            log(&format!("loading '{scene}' {e}"));
        }
    }

    pub(crate) unsafe fn scene(&self, a: &Api) -> String {
        let u = self.unity.as_ref().unwrap();
        let Ok(boxed) = a.invoke(u.active_scene, std::ptr::null_mut(), &mut []) else { return String::new() };
        let Some(mut handle) = a.unbox::<i32>(boxed) else { return String::new() };
        let (name, by_handle) = u.scene_name;
        let r = if by_handle {
            a.invoke(name, std::ptr::null_mut(), &mut [&mut handle as *mut i32 as Ptr])
        } else {
            // (a value type's own method runs on the value itself)
            a.invoke(name, &mut handle as *mut i32 as Ptr, &mut [])
        };
        r.map(|s| a.read_string(s)).unwrap_or_default()
    }

    /// The welcome screen is showing (the game has started up behind it). Without a way to look, a second's grace.
    pub(crate) unsafe fn welcome_up(&self, a: &Api) -> bool {
        let u = self.unity.as_ref().unwrap();
        match (u.find_objects, u.startup_menu) {
            (Some(find), Some(menu)) => {
                let found = a.invoke(find, std::ptr::null_mut(), &mut [a.type_object(menu)]).unwrap_or(std::ptr::null_mut());
                a.array_length(found) > 0
            }
            _ => get::<i32>(a, u.frame_count) > 60,
        }
    }

    // -------------------------------------------------------------- the Game tab

    /// Windowed and running while the studio has focus.
    pub(crate) unsafe fn prepare_screen(&mut self, a: &Api) {
        let u = self.unity.as_ref().unwrap();
        if let Some(m) = u.run_in_background {
            set(a, m, true as u8);
        }
        if let Some((get_mode, set_mode)) = u.full_screen_mode {
            let mode: i32 = get(a, get_mode);
            const WINDOWED: i32 = 3;
            // (the studio sets the game windowed before starting it, and puts the player's own mode back after)
            if mode != WINDOWED {
                set(a, set_mode, WINDOWED);
            }
            log(&format!("windowed for the studio (was mode {mode})"));
        }
    }

    pub(crate) unsafe fn fit_to_studio(&mut self, a: &Api) {
        self.write_status(a);
        self.read_studio_size();
        let rewired_ready = self.rewired_ready(a);
        if !self.out_of_sight && rewired_ready && !self.input_without_focus {
            self.input_without_focus = true;
            self.ignore_input_unfocused(a, false);
            log("input works without focus now");
        }
        let w = WINDOW.load(Ordering::Relaxed) as HWND;
        if w.is_null() {
            return;
        }
        if GetParent(w).is_null() {
            // parked (taken out of the studio while hidden), or popped out into its own window
            if self.studio_parked && !self.studio_alive() {
                self.studio_parked = false;
                ShowWindow(w, SW_SHOW);
                log("the studio is gone: showing the game again");
            }
            let parked = self.studio_parked;
            self.set_out_of_sight(a, parked);
            return;
        }
        let hidden = self.studio_hidden;
        self.set_out_of_sight(a, hidden);
        let (sw, sh) = self.studio;
        // (while a panel edge is dragged the size changes every frame: wait till it settles)
        if sw < 64 || sh < 64 || self.size_changed.elapsed() < Duration::from_millis(200) {
            return;
        }
        let u = self.unity.as_ref().unwrap();
        let (Some((gw, gh)), Some(set_res), Some((get_mode, _))) = (u.screen_size, u.set_resolution, u.full_screen_mode) else { return };
        if get::<i32>(a, gw) == sw && get::<i32>(a, gh) == sh && get::<i32>(a, get_mode) == 3 {
            return;
        }
        // asked for this size already: given a couple of seconds to take (each ask re-makes the game's swapchain)
        if self.asked.is_some_and(|(size, at)| size == (sw, sh) && at.elapsed() < Duration::from_secs(2)) {
            return;
        }
        self.asked = Some(((sw, sh), Instant::now()));
        let (mut x, mut y, mut mode) = (sw, sh, 3i32);
        let _ = a.invoke(set_res, std::ptr::null_mut(), &mut [&mut x as *mut i32 as Ptr, &mut y as *mut i32 as Ptr, &mut mode as *mut i32 as Ptr]);
        log(&format!("{sw}x{sh} windowed to fit the studio"));
    }

    pub(crate) fn read_studio_size(&mut self) {
        let path = jibbers_dir().join("studio-game-size.json");
        let Ok(stamp) = std::fs::metadata(&path).and_then(|m| m.modified()) else { return };
        if self.size_stamp == Some(stamp) {
            return;
        }
        let Some(v) = read_json("studio-game-size.json") else { return };
        let n = |k: &str| v.get(k).and_then(|x| x.as_i64()).unwrap_or(0);
        self.studio = (n("width") as i32, n("height") as i32);
        self.studio_hidden = v.get("hidden").and_then(|x| x.as_bool()).unwrap_or(false);
        self.studio_parked = v.get("parked").and_then(|x| x.as_bool()).unwrap_or(false);
        self.studio_pid = n("studio") as u32;
        self.size_stamp = Some(stamp);
        self.size_changed = Instant::now();
    }

    pub(crate) fn studio_alive(&self) -> bool {
        use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        if self.studio_pid == 0 {
            return true;
        }
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, self.studio_pid);
            if h.is_null() {
                return false;
            }
            let mut code = 0u32;
            let ok = GetExitCodeProcess(h, &mut code);
            windows_sys::Win32::Foundation::CloseHandle(h);
            ok == 0 || code == 259 // STILL_ACTIVE
        }
    }

    pub(crate) unsafe fn rewired_ready(&self, a: &Api) -> bool {
        self.unity.as_ref().unwrap().rewired.as_ref().is_some_and(|r| get::<u8>(a, r.is_ready) != 0)
    }

    pub(crate) unsafe fn ignore_input_unfocused(&self, a: &Api, ignore: bool) {
        let Some(r) = &self.unity.as_ref().unwrap().rewired else { return };
        let Ok(cfg) = a.invoke(r.configuration, std::ptr::null_mut(), &mut []) else { return };
        if cfg.is_null() {
            return;
        }
        if let Some(setter) = a.method(a.class_of(cfg), "set_ignoreInputWhenAppNotInFocus", &["System.Boolean"]) {
            let mut v = ignore as u8;
            let _ = a.invoke(setter, cfg, &mut [&mut v as *mut u8 as Ptr]);
        }
    }

    /// Out of sight in the studio (another tab showing): quiet, the keyboard and mouse left to the editor, and paced
    /// to the screen's refresh (Windows doesn't pace a window nobody can see: 1400+ fps for frames no one sees).
    pub(crate) unsafe fn set_out_of_sight(&mut self, a: &Api, hidden: bool) {
        if hidden == self.out_of_sight {
            return;
        }
        self.out_of_sight = hidden;
        let ready = self.rewired_ready(a);
        let u = self.unity.as_ref().unwrap();
        let (Some((get_vol, set_vol)), Some((get_vs, set_vs)), Some((get_fps, set_fps))) = (u.volume, u.vsync, u.target_fps) else { return };
        if hidden {
            self.saved = (get(a, get_vol), get(a, get_vs), get(a, get_fps));
            set(a, set_vol, 0f32);
            let hz = u
                .current_resolution
                .and_then(|m| a.invoke(m, std::ptr::null_mut(), &mut []).ok())
                .and_then(|o| a.unbox::<[u32; 4]>(o))
                .map(|r| if r[3] > 0 { (r[2] as f64 / r[3] as f64).round() as i32 } else { 0 })
                .unwrap_or(0);
            set(a, set_vs, 0i32);
            set(a, set_fps, if hz >= 30 { hz } else { 60 });
        } else {
            set(a, set_vol, self.saved.0);
            set(a, set_vs, self.saved.1);
            set(a, set_fps, self.saved.2);
        }
        if ready {
            self.ignore_input_unfocused(a, hidden);
        }
        log(if hidden { "out of sight in the studio: muted, paced to the screen" } else { "back in sight: sound and input on" });
    }

    /// Every couple of seconds: how fast the game runs and what it thinks its state is (for the studio's lag reports).
    pub(crate) unsafe fn write_status(&mut self, a: &Api) {
        let u = self.unity.as_ref().unwrap();
        let frame: i32 = get(a, u.frame_count);
        let now = Instant::now();
        let fps = match self.status_at {
            Some((t, _)) if now.duration_since(t) < Duration::from_secs(2) => return,
            Some((t, f)) => (frame - f) as f32 / now.duration_since(t).as_secs_f32(),
            None => 0.0,
        };
        self.status_at = Some((now, frame));
        let w = WINDOW.load(Ordering::Relaxed) as HWND;
        let (vs, tf) = (u.vsync.map(|(g, _)| get::<i32>(a, g)).unwrap_or(-1), u.target_fps.map(|(g, _)| get::<i32>(a, g)).unwrap_or(-1));
        let (gw, gh) = u.screen_size.map(|(x, y)| (get::<i32>(a, x), get::<i32>(a, y))).unwrap_or((0, 0));
        let v = serde_json::json!({
            "fps": (fps * 10.0).round() / 10.0,
            "outOfSight": self.out_of_sight,
            "insideStudio": !w.is_null() && !GetParent(w).is_null(),
            "vSync": vs,
            "targetFrameRate": tf,
            "size": format!("{gw}x{gh}"),
            "link": VERSION,
        });
        let _ = std::fs::write(jibbers_dir().join("studio-game-status.json"), v.to_string());
    }
}
