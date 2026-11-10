//! What the studio's tests read of the game while its test pad is in (studio-pad.json there): the scene, where the
//! cameras are and which way they look, whether a drone is out, the controllers Rewired has and how it reads them, and
//! how often the game has asked for the test pad. Written to studio-probe.json each tick.
//!
//! A screenshot asked for ( studio-shot.json: {"path", "pose": [x, y, z, qx, qy, qz, qw]} ): the game's camera script
//! ( FollowCam ) switched off meanwhile, so nothing moves the cameras but this, held there a few frames, then the screen saved to `path` by Unity ( and the lights then beside it, `path`.lights.json: each
//! enabled one's type, intensity, colour and the way it shines ), and the request taken away.

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
    /// the map's pieces' materials written out ( studio-renderers.json ), once in the map
    renderers_done: bool,
    /// frames a screenshot's been asked for
    shot_frames: u32,
    /// the game's camera scripts switched off for it ( on again after )
    held: Vec<Ptr>,
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
            renderers_done: false,
            shot_frames: 0,
            held: vec![],
        }
    }

    /// How the game draws the scene: its post-processing volumes ( each one's components, whether on, and every
    /// setting overridden with its value ), its cameras ( HDR, post-processing, their URP data ), the render
    /// pipeline asset ( its plain settings, each renderer's features and theirs ), fog, and the colour space.
    unsafe fn look(&self, a: &Api, link: &Link) -> serde_json::Value {
        use serde_json::{json, Map, Value};
        let call = |obj: Ptr, name: &str| -> Option<Ptr> {
            let r = a.invoke(a.method(a.class_of(obj), name, &[])?, obj, &mut []).ok()?;
            (!r.is_null()).then_some(r)
        };
        let stat = |ns: &str, cls: &str, name: &str| -> Option<Ptr> {
            let r = a.invoke(a.method(a.class(ns, cls)?, name, &[])?, std::ptr::null_mut(), &mut []).ok()?;
            (!r.is_null()).then_some(r)
        };
        // an object's plain settings
        let plain = |o: Ptr| -> Value { Value::Object(a.fields(o).into_iter().filter_map(|(n, _, v, _)| v.map(|v| (n, v))).collect()) };
        // a List<T>'s items
        let items = |list: Ptr| -> Vec<Ptr> {
            let f = a.fields(list);
            let arr = f.iter().find(|x| x.0 == "_items").and_then(|x| x.3);
            let n = f.iter().find(|x| x.0 == "_size").and_then(|x| x.2.as_ref()).and_then(|v| v.as_i64()).unwrap_or(0) as usize;
            arr.map(|arr| (0..n.min(a.array_length(arr) as usize)).map(|k| *((arr as *const u8).add(0x20) as *const Ptr).add(k)).collect()).unwrap_or_default()
        };
        let array = |arr: Ptr| -> Vec<Ptr> { (0..a.array_length(arr) as usize).map(|k| *((arr as *const u8).add(0x20) as *const Ptr).add(k)).collect() };
        let find = |ns: &str, cls: &str| -> Vec<Ptr> {
            let (Some(f), Some(c)) = (link.unity.as_ref().and_then(|u| u.find_objects), a.class(ns, cls)) else { return vec![] };
            a.invoke(f, std::ptr::null_mut(), &mut [a.type_object(c)]).map(|arr| array(arr)).unwrap_or_default()
        };
        // a volume component: on or not, and each setting it overrides
        let component = |c: Ptr| -> Value {
            let mut set = Map::new();
            let mut active = Value::Null;
            for (n, _, v, obj) in a.fields(c) {
                if n == "active" {
                    active = v.unwrap_or(Value::Null);
                    continue;
                }
                let Some(p) = obj else { continue };
                if !a.class_name(p).contains("Parameter") {
                    continue;
                }
                let pf = a.fields(p);
                let over = pf.iter().find(|x| x.0 == "m_OverrideState").and_then(|x| x.2.clone()).unwrap_or(Value::Null);
                // ( a curve: its keys, time and value )
                let keys = |curve: Ptr| -> Value {
                    let Some(k) = call(curve, "get_keys") else { return Value::Null };
                    let n = a.array_length(k) as usize;
                    json!((0..n).map(|i| { let e = (k as *const u8).add(0x20 + i * 28) as *const f32; [*e, *e.add(1), *e.add(2), *e.add(3)] }).collect::<Vec<_>>())
                };
                let val = pf
                    .iter()
                    .find(|x| x.0 == "m_Value")
                    .map(|x| {
                        x.2.clone().unwrap_or_else(|| {
                            x.3.map(|o| {
                                let cn = a.class_name(o);
                                if cn.ends_with("TextureCurve") {
                                    let curve = a.fields(o).into_iter().find(|f| f.0 == "m_Curve").and_then(|f| f.3);
                                    json!({ "curve": curve.map(keys), "loop": a.fields(o).into_iter().find(|f| f.0 == "m_Loop").and_then(|f| f.2) })
                                } else {
                                    json!(cn)
                                }
                            })
                            .unwrap_or(Value::Null)
                        })
                    })
                    .unwrap_or(Value::Null);
                set.insert(n, json!({ "override": over, "value": val }));
            }
            json!({ "type": a.class_name(c), "active": active, "settings": set })
        };
        let volumes: Vec<Value> = find("UnityEngine.Rendering", "Volume")
            .into_iter()
            .map(|v| {
                let f = a.fields(v);
                let profile = f.iter().find(|x| x.0 == "sharedProfile").and_then(|x| x.3).or_else(|| f.iter().find(|x| x.0 == "m_InternalProfile").and_then(|x| x.3));
                let comps: Vec<Value> = profile.and_then(|p| a.fields(p).into_iter().find(|x| x.0 == "components").and_then(|x| x.3)).map(|l| items(l).into_iter().map(component).collect()).unwrap_or_default();
                json!({
                    "name": call(v, "get_name").map(|s| a.read_string(s)),
                    "settings": plain(v),
                    "profile": profile.and_then(|p| call(p, "get_name")).map(|s| a.read_string(s)),
                    "components": comps,
                })
            })
            .collect();
        let cameras: Vec<Value> = find("UnityEngine", "Camera")
            .into_iter()
            .map(|c| {
                let data = a.class("UnityEngine.Rendering.Universal", "UniversalAdditionalCameraData").and_then(|t| a.invoke(a.method(a.class_of(c), "GetComponent", &["System.Type"])?, c, &mut [a.type_object(t)]).ok()).filter(|d| !d.is_null());
                json!({
                    "name": call(c, "get_name").map(|s| a.read_string(s)),
                    "enabled": call(c, "get_isActiveAndEnabled").and_then(|b| a.unbox::<u8>(b)).map(|b| b != 0),
                    "hdr": call(c, "get_allowHDR").and_then(|b| a.unbox::<u8>(b)).map(|b| b != 0),
                    "fov": call(c, "get_fieldOfView").and_then(|f| a.unbox::<f32>(f)),
                    // ( where it is and how it's turned as the screen's saved: x y z, then the quaternion )
                    "pose": self.pose(a, c),
                    "aspect": call(c, "get_aspect").and_then(|f| a.unbox::<f32>(f)),
                    "physical": call(c, "get_usePhysicalProperties").and_then(|b| a.unbox::<u8>(b)).map(|b| b != 0),
                    "gateFit": call(c, "get_gateFit").and_then(|v| a.unbox::<i32>(v)),
                    "sensor": call(c, "get_sensorSize").and_then(|v| a.unbox::<[f32; 2]>(v)),
                    "lensShift": call(c, "get_lensShift").and_then(|v| a.unbox::<[f32; 2]>(v)),
                    "view": call(c, "get_worldToCameraMatrix").and_then(|v| a.unbox::<[f32; 16]>(v)),
                    // ( Unity's matrix, by columns )
                    "projection": call(c, "get_projectionMatrix").and_then(|v| a.unbox::<[f32; 16]>(v)),
                    "urp": data.map(plain),
                })
            })
            .collect();
        let pipeline = stat("UnityEngine.Rendering", "GraphicsSettings", "get_currentRenderPipeline").map(|asset| {
            let renderers: Vec<Value> = a
                .fields(asset)
                .into_iter()
                .find(|x| x.0 == "m_RendererDataList")
                .and_then(|x| x.3)
                .map(|arr| {
                    array(arr)
                        .into_iter()
                        .filter(|r| !r.is_null())
                        .map(|r| {
                            let feats: Vec<Value> = a
                                .fields(r)
                                .into_iter()
                                .find(|x| x.0 == "m_RendererFeatures")
                                .and_then(|x| x.3)
                                .map(|l| {
                                    items(l)
                                        .into_iter()
                                        .filter(|f| !f.is_null())
                                        .map(|f| {
                                            // ( its settings, a level down where it keeps them in an object; a material, by name and
                                            // shader )
                                            let sub: Map<String, Value> = a
                                                .fields(f)
                                                .into_iter()
                                                .filter_map(|(n, _, _, o)| {
                                                    let o = o?;
                                                    let cn = a.class_name(o);
                                                    if cn == "UnityEngine.Material" {
                                                        let shader = call(o, "get_shader").and_then(|s| call(s, "get_name")).map(|s| a.read_string(s));
                                                        return Some((n, json!({ "material": call(o, "get_name").map(|s| a.read_string(s)), "shader": shader, "keywords": call(o, "get_shaderKeywords").map(|k| array(k).into_iter().map(|s| a.read_string(s)).collect::<Vec<_>>()) })));
                                                    }
                                                    (!cn.starts_with("System.") && !cn.starts_with("UnityEngine.Rendering.RTHandle") && cn != "UnityEngine.Shader").then(|| (n, plain(o)))
                                                })
                                                .collect();
                                            json!({ "type": a.class_name(f), "plain": plain(f), "objects": sub })
                                        })
                                        .collect()
                                })
                                .unwrap_or_default();
                            json!({ "type": a.class_name(r), "plain": plain(r), "features": feats })
                        })
                        .collect()
                })
                .unwrap_or_default();
            json!({ "type": a.class_name(asset), "plain": plain(asset), "renderers": renderers })
        });
        let rs = |name: &str| stat("UnityEngine", "RenderSettings", name);
        // the game's day and night ( its clock, the sun as it has it now )
        let environment: Vec<Value> = find("", "EnvironmentManager").into_iter().map(plain).collect();
        // the light all round as the shaders get it ( spherical harmonics, 27 numbers: red's 9, green's, blue's )
        let probe_sh = rs("get_ambientProbe").and_then(|v| a.unbox::<[f32; 27]>(v));
        // the map's own pieces' materials ( their shader's every number, vector and colour ), a few
        let props = |m: Ptr, kind: i32| -> Value {
            let Some(names) = a.class("UnityEngine", "Material").and_then(|c| a.method(c, "GetPropertyNames", &["UnityEngine.MaterialPropertyType"])).and_then(|f| {
                let mut k = kind;
                a.invoke(f, m, &mut [&mut k as *mut i32 as Ptr]).ok()
            }) else {
                return Value::Null
            };
            let get = a.class("UnityEngine", "Material").and_then(|c| a.method(c, if kind == 0 { "GetFloat" } else { "GetVector" }, &["System.String"]));
            Value::Object(
                array(names)
                    .into_iter()
                    .filter_map(|n| {
                        let s = a.read_string(n);
                        let r = a.invoke(get?, m, &mut [n]).ok()?;
                        Some((s, if kind == 0 { json!(a.unbox::<f32>(r)) } else { json!(a.unbox::<[f32; 4]>(r)) }))
                    })
                    .collect(),
            )
        };
        // the ground's material ( the game's snow shader: its colours and numbers, by name )
        let terrain: Vec<Value> = find("UnityEngine", "Terrain")
            .into_iter()
            .filter_map(|t| Some((call(t, "get_name").map(|s| a.read_string(s)), call(t, "get_materialTemplate")?)))
            .take(12)
            .map(|(tname, m)| {
                let mc = a.class("UnityEngine", "Material");
                let get = |kind: &str, name: &str| -> Value {
                    let Some(f) = mc.and_then(|c| a.method(c, kind, &["System.String"])) else { return Value::Null };
                    let Ok(r) = a.invoke(f, m, &mut [a.string(name)]) else { return Value::Null };
                    if kind == "GetColor" { json!(a.unbox::<[f32; 4]>(r)) } else { json!(a.unbox::<f32>(r)) }
                };
                let mut o = Map::new();
                o.insert("terrain".into(), json!(tname));
                o.insert("material".into(), json!(call(m, "get_name").map(|s| a.read_string(s))));
                o.insert("shader".into(), json!(call(m, "get_shader").and_then(|s| call(s, "get_name")).map(|s| a.read_string(s))));
                for n in ["_BaseColor", "_SkidColor", "_RockColor", "_ThirdColor"] {
                    o.insert(n.into(), get("GetColor", n));
                }
                for n in ["_UseMasks", "_PisteTiling", "_GrooveStrength", "_Sheen", "_SnowMaskContrast", "_MarkingTint", "_ThirdTexTiling", "_ThirdCoverageDepth", "_ThirdEdgeSharpness"] {
                    o.insert(n.into(), get("GetFloat", n));
                }
                Value::Object(o)
            })
            .collect();
        let mut pieces = vec![];
        for r in find("UnityEngine", "MeshRenderer") {
            let Some(m) = call(r, "get_sharedMaterial") else { continue };
            let shader = call(m, "get_shader").and_then(|s| call(s, "get_name")).map(|s| a.read_string(s)).unwrap_or_default();
            if !shader.contains("CustomObject") || pieces.len() >= 3 {
                continue;
            }
            pieces.push(json!({
                "material": call(m, "get_name").map(|s| a.read_string(s)),
                "shader": shader,
                "keywords": call(m, "get_shaderKeywords").map(|k| array(k).into_iter().map(|s| a.read_string(s)).collect::<Vec<_>>()),
                "floats": props(m, 0),
                "vectors": props(m, 1),
            }));
        }
        json!({
            "environment": environment,
            "ambientProbe": probe_sh,
            "terrain": terrain,
            "pieces": pieces,
            "colorSpace": stat("UnityEngine", "QualitySettings", "get_activeColorSpace").and_then(|v| a.unbox::<i32>(v)),
            "fog": {
                "on": rs("get_fog").and_then(|v| a.unbox::<u8>(v)).map(|b| b != 0),
                "mode": rs("get_fogMode").and_then(|v| a.unbox::<i32>(v)),
                "color": rs("get_fogColor").and_then(|v| a.unbox::<[f32; 4]>(v)),
                "density": rs("get_fogDensity").and_then(|v| a.unbox::<f32>(v)),
                "start": rs("get_fogStartDistance").and_then(|v| a.unbox::<f32>(v)),
                "end": rs("get_fogEndDistance").and_then(|v| a.unbox::<f32>(v)),
            },
            "volumes": volumes,
            "cameras": cameras,
            "pipeline": pipeline,
        })
    }

    /// The scene's enabled lights: type ( 0 spot, 1 directional, 2 point ), intensity, colour, the way it shines
    /// ( its forward ), shadow strength; and the ambient light ( RenderSettings ).
    unsafe fn lights(&self, a: &Api) -> serde_json::Value {
        let call = |obj: Ptr, name: &str| -> Option<Ptr> {
            if obj.is_null() {
                return None;
            }
            let r = a.invoke(a.method(a.class_of(obj), name, &[])?, obj, &mut []).ok()?;
            (!r.is_null()).then_some(r)
        };
        let mut out = vec![];
        let find = a.class("UnityEngine", "Object").and_then(|c| a.method(c, "FindObjectsOfType", &["System.Type"]));
        if let (Some(find), Some(light)) = (find, a.class("UnityEngine", "Light")) {
            if let Ok(found) = a.invoke(find, std::ptr::null_mut(), &mut [a.type_object(light)]) {
                for i in 0..a.array_length(found) as usize {
                    let l = *((found as *const u8).add(0x20) as *const Ptr).add(i);
                    if call(l, "get_isActiveAndEnabled").and_then(|b| a.unbox::<u8>(b)).unwrap_or(0) == 0 {
                        continue;
                    }
                    let fwd = call(l, "get_transform").and_then(|t| call(t, "get_forward")).and_then(|v| a.unbox::<[f32; 3]>(v));
                    out.push(serde_json::json!({
                        "type": call(l, "get_type").and_then(|v| a.unbox::<i32>(v)),
                        "intensity": call(l, "get_intensity").and_then(|v| a.unbox::<f32>(v)),
                        "color": call(l, "get_color").and_then(|v| a.unbox::<[f32; 4]>(v)),
                        "forward": fwd,
                        "shadowStrength": call(l, "get_shadowStrength").and_then(|v| a.unbox::<f32>(v)),
                        "useColorTemperature": call(l, "get_useColorTemperature").and_then(|v| a.unbox::<u8>(v)).map(|b| b != 0),
                        "colorTemperature": call(l, "get_colorTemperature").and_then(|v| a.unbox::<f32>(v)),
                        "cookie": call(l, "get_cookie").and_then(|c| call(c, "get_name")).map(|s| a.read_string(s)),
                    }));
                }
            }
        }
        let rs = a.class("UnityEngine", "RenderSettings");
        let st = |name: &str| rs.and_then(|c| a.method(c, name, &[])).and_then(|m| a.invoke(m, std::ptr::null_mut(), &mut []).ok()).filter(|r| !r.is_null());
        let gs = |name: &str| a.class("UnityEngine.Rendering", "GraphicsSettings").and_then(|c| a.method(c, name, &[])).and_then(|m| a.invoke(m, std::ptr::null_mut(), &mut []).ok()).filter(|r| !r.is_null()).and_then(|v| a.unbox::<u8>(v)).map(|b| b != 0);
        serde_json::json!({
            "lightsUseColorTemperature": gs("get_lightsUseColorTemperature"),
            "lightsUseLinearIntensity": gs("get_lightsUseLinearIntensity"),
            "lights": out,
            "ambientMode": st("get_ambientMode").and_then(|v| a.unbox::<i32>(v)),
            "ambientLight": st("get_ambientLight").and_then(|v| a.unbox::<[f32; 4]>(v)),
            "ambientSky": st("get_ambientSkyColor").and_then(|v| a.unbox::<[f32; 4]>(v)),
            "ambientEquator": st("get_ambientEquatorColor").and_then(|v| a.unbox::<[f32; 4]>(v)),
            "ambientGround": st("get_ambientGroundColor").and_then(|v| a.unbox::<[f32; 4]>(v)),
            "ambientIntensity": st("get_ambientIntensity").and_then(|v| a.unbox::<f32>(v)),
            "reflectionIntensity": st("get_reflectionIntensity").and_then(|v| a.unbox::<f32>(v)),
        })
    }

    /// A screenshot asked for: the cameras put where it says each frame, the screen saved after a few.
    unsafe fn shot(&mut self, a: &Api, link: &Link) {
        let req = jibbers_dir().join("studio-shot.json");
        let Ok(text) = std::fs::read_to_string(&req) else {
            self.shot_frames = 0;
            self.release(a);
            return;
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else { return };
        let Some(path) = v["path"].as_str() else { return };
        // ( a pose asked for: the cameras put there; none, the game's own view as it is, its camera kept in the report )
        let f: Vec<f32> = v["pose"].as_array().map(|p| p.iter().filter_map(|x| x.as_f64()).map(|x| x as f32).collect()).unwrap_or_default();
        let posed = f.len() == 7;
        let (mut at, mut turn) = if posed { ([f[0], f[1], f[2]], [f[3], f[4], f[5], f[6]]) } else { ([0.0; 3], [0.0, 0.0, 0.0, 1.0]) };
        // ( the game's camera script off: it moves the camera itself every frame )
        if posed && self.held.is_empty() {
            if let (Some(find), Some(fc)) = (link.unity.as_ref().and_then(|u| u.find_objects), self.follow_cam) {
                if let Ok(found) = a.invoke(find, std::ptr::null_mut(), &mut [a.type_object(fc)]) {
                    for i in 0..a.array_length(found) as usize {
                        let c = *((found as *const u8).add(0x20) as *const Ptr).add(i);
                        if let Some(m) = a.method(a.class_of(c), "set_enabled", &["System.Boolean"]) {
                            let mut off = 0u8;
                            let _ = a.invoke(m, c, &mut [&mut off as *mut u8 as Ptr]);
                            self.held.push(c);
                        }
                    }
                }
            }
        }
        let set_pos = a.class("UnityEngine", "Transform").and_then(|c| a.method(c, "set_position", &["UnityEngine.Vector3"]));
        let set_rot = a.class("UnityEngine", "Transform").and_then(|c| a.method(c, "set_rotation", &["UnityEngine.Quaternion"]));
        if let Some(all) = self.all_cameras.filter(|_| posed).and_then(|m| a.invoke(m, std::ptr::null_mut(), &mut []).ok()) {
            for i in 0..a.array_length(all) as usize {
                let cam = *((all as *const u8).add(0x20) as *const Ptr).add(i);
                // ( a view the game set itself, not the transform's, let go: the transform's again )
                if let Some(m) = a.method(a.class_of(cam), "ResetWorldToCameraMatrix", &[]) {
                    let _ = a.invoke(m, cam, &mut []);
                }
                let Some(t) = self.transform.and_then(|m| a.invoke(m, cam, &mut []).ok()).filter(|t| !t.is_null()) else { continue };
                if let Some(m) = set_pos {
                    let _ = a.invoke(m, t, &mut [&mut at as *mut _ as Ptr]);
                }
                if let Some(m) = set_rot {
                    let _ = a.invoke(m, t, &mut [&mut turn as *mut _ as Ptr]);
                }
            }
        }
        self.shot_frames += 1;
        if self.shot_frames == 20 {
            if let Some(m) = a.class("UnityEngine", "ScreenCapture").and_then(|c| a.method(c, "CaptureScreenshot", &["System.String"])) {
                let _ = a.invoke(m, std::ptr::null_mut(), &mut [a.string(path)]);
            }
            let _ = std::fs::write(format!("{path}.lights.json"), self.lights(a).to_string());
            let _ = std::fs::write(format!("{path}.look.json"), self.look(a, link).to_string());
        }
        if self.shot_frames >= 40 {
            let _ = std::fs::remove_file(&req);
            self.shot_frames = 0;
            self.release(a);
        }
    }

    /// The game's camera scripts on again, as a shot left them.
    unsafe fn release(&mut self, a: &Api) {
        for c in std::mem::take(&mut self.held) {
            if let Some(m) = a.method(a.class_of(c), "set_enabled", &["System.Boolean"]) {
                let mut on = 1u8;
                let _ = a.invoke(m, c, &mut [&mut on as *mut u8 as Ptr]);
            }
        }
    }

    pub(crate) unsafe fn tick(&mut self, a: &Api, link: &Link) {
        let u = link.unity.as_ref().unwrap();
        if !self.renderers_done && link.scene(a) == "Main" {
            self.renderers_done = true;
            let v = self.renderers(a, link);
            let _ = std::fs::write(jibbers_dir().join("studio-renderers.json"), v.to_string());
        }
        self.shot(a, link);
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

    /// The map's pieces as the game draws them: every renderer with the game's map-object shader, by its object and
    /// two of its parents' names, with its material's name and the values that colour it ( how the game tells a red
    /// rail from a blue one: other materials, or the same one's hue shifted ).
    unsafe fn renderers(&self, a: &Api, link: &Link) -> serde_json::Value {
        let u = link.unity.as_ref().unwrap();
        let call = |obj: Ptr, name: &str, params: &[&str], args: &mut [Ptr]| -> Option<Ptr> {
            if obj.is_null() {
                return None;
            }
            let r = a.invoke(a.method(a.class_of(obj), name, params)?, obj, args).ok()?;
            (!r.is_null()).then_some(r)
        };
        let name = |o: Option<Ptr>| o.and_then(|o| call(o, "get_name", &[], &mut [])).map(|s| a.read_string(s)).unwrap_or_default();
        let Some(class) = a.class("UnityEngine", "Renderer") else { return serde_json::json!({ "error": "no Renderer" }) };
        let Some(find) = u.find_objects else { return serde_json::json!({ "error": "no FindObjectsOfType" }) };
        let Ok(found) = a.invoke(find, std::ptr::null_mut(), &mut [a.type_object(class)]) else { return serde_json::json!({ "error": "FindObjectsOfType failed" }) };
        let filter = a.class("UnityEngine", "MeshFilter");
        let props = ["_HueShift", "_Brightness", "_Saturation", "_Hue", "_Value", "_Contrast", "_Darken", "_Tint"];
        let mut out = vec![];
        for i in 0..a.array_length(found) as usize {
            let r = *((found as *const u8).add(0x20) as *const Ptr).add(i);
            let Some(mat) = call(r, "get_sharedMaterial", &[], &mut []) else { continue };
            let shader = name(call(mat, "get_shader", &[], &mut []));
            // ( the map's pieces: not the rider, the sky, the ground )
            if ["Terrain", "Sky", "GearPiece", "Cloth", "VFX"].iter().any(|s| shader.contains(s)) {
                continue;
            }
            let t = call(r, "get_transform", &[], &mut []);
            let at = t.and_then(|t| call(t, "get_position", &[], &mut [])).and_then(|p| a.unbox::<[f32; 3]>(p)).unwrap_or_default();
            let p1 = t.and_then(|t| call(t, "get_parent", &[], &mut []));
            let p2 = p1.and_then(|t| call(t, "get_parent", &[], &mut []));
            let values = |mat: Ptr| {
                let mut values = serde_json::Map::new();
                for p in props {
                    let has = call(mat, "HasProperty", &["System.String"], &mut [a.string(p)]).and_then(|b| a.unbox::<u8>(b)).unwrap_or(0) != 0;
                    if has {
                        if let Some(v) = call(mat, "GetFloat", &["System.String"], &mut [a.string(p)]).and_then(|f| a.unbox::<f32>(f)) {
                            values.insert(p.into(), v.into());
                        }
                    }
                }
                values
            };
            // its mesh ( the name the look's read under ), and each of its materials ( a submesh each )
            let mesh = filter.and_then(|f| call(r, "GetComponent", &["System.Type"], &mut [a.type_object(f)])).and_then(|f| call(f, "get_sharedMesh", &[], &mut []));
            let mats = call(r, "get_sharedMaterials", &[], &mut []);
            let all: Vec<serde_json::Value> = mats
                .map(|arr| (0..a.array_length(arr) as usize).map(|k| *((arr as *const u8).add(0x20) as *const Ptr).add(k)).collect::<Vec<_>>())
                .unwrap_or_default()
                .into_iter()
                .map(|m| serde_json::json!({ "material": name(Some(m)), "values": values(m) }))
                .collect();
            out.push(serde_json::json!({
                "object": [name(Some(r)), name(p1), name(p2)],
                "mesh": name(mesh),
                "at": at,
                "material": name(Some(mat)),
                "shader": shader,
                "values": values(mat),
                "materials": all,
            }));
            if out.len() >= 6000 {
                break;
            }
        }
        serde_json::Value::Array(out)
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
