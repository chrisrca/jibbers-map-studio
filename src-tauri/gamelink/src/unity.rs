//! The game's Unity objects, found by name through IL2CPP: the classes, methods and fields the link uses.

use super::*;

/// The Unity calls the link makes, looked up once.
pub(crate) struct Unity {
    pub(crate) load_scene: Ptr,
    pub(crate) active_scene: Ptr,
    /// Scene.GetNameInternal(handle) (static), else Scene.get_name (on the scene itself)
    pub(crate) scene_name: (Ptr, bool),
    pub(crate) set_time_scale: Ptr,
    pub(crate) frame_count: Ptr,
    pub(crate) find_objects: Option<Ptr>,
    pub(crate) startup_menu: Option<Ptr>,
    pub(crate) run_in_background: Option<Ptr>,
    pub(crate) full_screen_mode: Option<(Ptr, Ptr)>,
    pub(crate) current_resolution: Option<Ptr>,
    pub(crate) set_resolution: Option<Ptr>,
    pub(crate) screen_size: Option<(Ptr, Ptr)>,
    pub(crate) vsync: Option<(Ptr, Ptr)>,
    pub(crate) target_fps: Option<(Ptr, Ptr)>,
    pub(crate) volume: Option<(Ptr, Ptr)>,
    pub(crate) rewired: Option<Rewired>,
    /// the game's map list read again from its Maps folder (its class's name is the obfuscator's, the method's isn't)
    pub(crate) init_maps: Option<Ptr>,
}

pub(crate) struct Rewired {
    pub(crate) is_ready: Ptr,
    pub(crate) configuration: Ptr,
}

impl Unity {
    pub(crate) fn find(a: &Api) -> Result<Unity, String> {
        let need = |ns: &str, cls: &str| a.class(ns, cls).ok_or(format!("no class {ns}.{cls}"));
        let m = |c: Ptr, name: &str, params: &[&str]| a.method(c, name, params);
        let sm = need("UnityEngine.SceneManagement", "SceneManager")?;
        let scene = need("UnityEngine.SceneManagement", "Scene")?;
        let time = need("UnityEngine", "Time")?;
        let app = a.class("UnityEngine", "Application");
        let screen = a.class("UnityEngine", "Screen");
        let quality = a.class("UnityEngine", "QualitySettings");
        let audio = a.class("UnityEngine", "AudioListener");
        let pair = |c: Option<Ptr>, get: &str, set: &str, ty: &str| c.and_then(|c| Some((m(c, get, &[])?, m(c, set, &[ty])?)));
        let fsm = "UnityEngine.FullScreenMode";
        Ok(Unity {
            load_scene: m(sm, "LoadScene", &["System.String"]).ok_or("no SceneManager.LoadScene(string)")?,
            active_scene: m(sm, "GetActiveScene", &[]).ok_or("no SceneManager.GetActiveScene")?,
            scene_name: m(scene, "GetNameInternal", &["System.Int32"]).map(|f| (f, true)).or_else(|| m(scene, "get_name", &[]).map(|f| (f, false))).ok_or("no Scene name")?,
            set_time_scale: m(time, "set_timeScale", &["System.Single"]).ok_or("no Time.timeScale")?,
            frame_count: m(time, "get_frameCount", &[]).ok_or("no Time.frameCount")?,
            find_objects: a.class("UnityEngine", "Object").and_then(|c| m(c, "FindObjectsOfType", &["System.Type"])),
            startup_menu: a.class("", "StartupMenu"),
            run_in_background: app.and_then(|c| m(c, "set_runInBackground", &["System.Boolean"])),
            full_screen_mode: pair(screen, "get_fullScreenMode", "set_fullScreenMode", fsm),
            current_resolution: screen.and_then(|c| m(c, "get_currentResolution", &[])),
            set_resolution: screen.and_then(|c| m(c, "SetResolution", &["System.Int32", "System.Int32", fsm])),
            screen_size: screen.and_then(|c| Some((m(c, "get_width", &[])?, m(c, "get_height", &[])?))),
            vsync: pair(quality, "get_vSyncCount", "set_vSyncCount", "System.Int32"),
            target_fps: pair(app, "get_targetFrameRate", "set_targetFrameRate", "System.Int32"),
            volume: pair(audio, "get_volume", "set_volume", "System.Single"),
            rewired: a.class("Rewired", "ReInput").and_then(|c| {
                Some(Rewired { is_ready: m(c, "get_isReady", &[])?, configuration: m(c, "get_configuration", &[])? })
            }),
            init_maps: a.method_anywhere("Assembly-CSharp.dll", "InitMaps"),
        })
    }
}

/// A static call's result read as `T` (a value type, boxed by the runtime).
pub(crate) unsafe fn get<T: Copy + Default>(a: &Api, method: Ptr) -> T {
    a.invoke(method, std::ptr::null_mut(), &mut []).ok().and_then(|o| a.unbox::<T>(o)).unwrap_or_default()
}

pub(crate) unsafe fn set<T>(a: &Api, method: Ptr, mut v: T) {
    let _ = a.invoke(method, std::ptr::null_mut(), &mut [&mut v as *mut T as Ptr]);
}
