//! The game's scripting runtime (IL2CPP), through the C functions GameAssembly.dll exports: classes and methods
//! looked up by name, called on the game's main thread.

use std::ffi::{c_char, c_void, CStr, CString};
use std::sync::OnceLock;
use windows_sys::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};

pub type Ptr = *mut c_void;

#[allow(non_snake_case)]
pub struct Api {
    domain_get: unsafe extern "C" fn() -> Ptr,
    domain_get_assemblies: unsafe extern "C" fn(Ptr, *mut usize) -> *const Ptr,
    assembly_get_image: unsafe extern "C" fn(Ptr) -> Ptr,
    class_from_name: unsafe extern "C" fn(Ptr, *const c_char, *const c_char) -> Ptr,
    class_get_methods: unsafe extern "C" fn(Ptr, *mut Ptr) -> Ptr,
    method_get_name: unsafe extern "C" fn(Ptr) -> *const c_char,
    method_get_param_count: unsafe extern "C" fn(Ptr) -> u32,
    method_get_param: unsafe extern "C" fn(Ptr, u32) -> Ptr,
    type_get_name: unsafe extern "C" fn(Ptr) -> *mut c_char,
    free: unsafe extern "C" fn(Ptr),
    runtime_invoke: unsafe extern "C" fn(Ptr, Ptr, *mut Ptr, *mut Ptr) -> Ptr,
    string_new: unsafe extern "C" fn(*const c_char) -> Ptr,
    string_chars: unsafe extern "C" fn(Ptr) -> *const u16,
    string_length: unsafe extern "C" fn(Ptr) -> i32,
    object_unbox: unsafe extern "C" fn(Ptr) -> Ptr,
    object_get_class: unsafe extern "C" fn(Ptr) -> Ptr,
    class_get_type: unsafe extern "C" fn(Ptr) -> Ptr,
    type_get_object: unsafe extern "C" fn(Ptr) -> Ptr,
    array_length: unsafe extern "C" fn(Ptr) -> u32,
    image_get_name: unsafe extern "C" fn(Ptr) -> *const c_char,
    image_get_class_count: unsafe extern "C" fn(Ptr) -> usize,
    image_get_class: unsafe extern "C" fn(Ptr, usize) -> Ptr,
    class_get_method_from_name: unsafe extern "C" fn(Ptr, *const c_char, i32) -> Ptr,
    class_get_parent: unsafe extern "C" fn(Ptr) -> Ptr,
    class_get_field_from_name: unsafe extern "C" fn(Ptr, *const c_char) -> Ptr,
    field_get_value: unsafe extern "C" fn(Ptr, Ptr, *mut c_void),
    class_get_fields: unsafe extern "C" fn(Ptr, *mut Ptr) -> Ptr,
    field_get_name: unsafe extern "C" fn(Ptr) -> *const c_char,
    field_get_type: unsafe extern "C" fn(Ptr) -> Ptr,
    field_get_flags: unsafe extern "C" fn(Ptr) -> i32,
    class_from_type: unsafe extern "C" fn(Ptr) -> Ptr,
    class_is_enum: unsafe extern "C" fn(Ptr) -> bool,
    class_is_valuetype: unsafe extern "C" fn(Ptr) -> bool,
    field_static_get_value: unsafe extern "C" fn(Ptr, *mut c_void),
}

static API: OnceLock<Api> = OnceLock::new();

/// The runtime, once GameAssembly.dll is loaded and its domain made (None before then).
// (each transmute's target is the Api field it fills)
#[allow(clippy::missing_transmute_annotations)]
pub fn api() -> Option<&'static Api> {
    if let Some(a) = API.get() {
        return Some(a);
    }
    unsafe {
        let name: Vec<u16> = "GameAssembly.dll\0".encode_utf16().collect();
        let module = GetModuleHandleW(name.as_ptr());
        if module.is_null() {
            return None;
        }
        macro_rules! f {
            ($n:literal) => {{
                let p = GetProcAddress(module, concat!($n, "\0").as_ptr())?;
                std::mem::transmute(p)
            }};
        }
        let a = Api {
            domain_get: f!("il2cpp_domain_get"),
            domain_get_assemblies: f!("il2cpp_domain_get_assemblies"),
            assembly_get_image: f!("il2cpp_assembly_get_image"),
            class_from_name: f!("il2cpp_class_from_name"),
            class_get_methods: f!("il2cpp_class_get_methods"),
            method_get_name: f!("il2cpp_method_get_name"),
            method_get_param_count: f!("il2cpp_method_get_param_count"),
            method_get_param: f!("il2cpp_method_get_param"),
            type_get_name: f!("il2cpp_type_get_name"),
            free: f!("il2cpp_free"),
            runtime_invoke: f!("il2cpp_runtime_invoke"),
            string_new: f!("il2cpp_string_new"),
            string_chars: f!("il2cpp_string_chars"),
            string_length: f!("il2cpp_string_length"),
            object_unbox: f!("il2cpp_object_unbox"),
            object_get_class: f!("il2cpp_object_get_class"),
            class_get_type: f!("il2cpp_class_get_type"),
            type_get_object: f!("il2cpp_type_get_object"),
            array_length: f!("il2cpp_array_length"),
            image_get_name: f!("il2cpp_image_get_name"),
            image_get_class_count: f!("il2cpp_image_get_class_count"),
            image_get_class: f!("il2cpp_image_get_class"),
            class_get_method_from_name: f!("il2cpp_class_get_method_from_name"),
            class_get_parent: f!("il2cpp_class_get_parent"),
            class_get_field_from_name: f!("il2cpp_class_get_field_from_name"),
            field_get_value: f!("il2cpp_field_get_value"),
            class_get_fields: f!("il2cpp_class_get_fields"),
            field_get_name: f!("il2cpp_field_get_name"),
            field_get_type: f!("il2cpp_field_get_type"),
            field_get_flags: f!("il2cpp_field_get_flags"),
            class_from_type: f!("il2cpp_class_from_type"),
            class_is_enum: f!("il2cpp_class_is_enum"),
            class_is_valuetype: f!("il2cpp_class_is_valuetype"),
            field_static_get_value: f!("il2cpp_field_static_get_value"),
        };
        if (a.domain_get)().is_null() {
            return None;
        }
        Some(API.get_or_init(|| a))
    }
}

impl Api {
    /// A class by namespace and name, from whichever of the game's assemblies has it.
    pub fn class(&self, ns: &str, name: &str) -> Option<Ptr> {
        let (ns, name) = (CString::new(ns).ok()?, CString::new(name).ok()?);
        unsafe {
            let mut n = 0usize;
            let list = (self.domain_get_assemblies)((self.domain_get)(), &mut n);
            if list.is_null() {
                return None;
            }
            (0..n).find_map(|i| {
                let image = (self.assembly_get_image)(*list.add(i));
                let c = (self.class_from_name)(image, ns.as_ptr(), name.as_ptr());
                (!c.is_null()).then_some(c)
            })
        }
    }

    /// A parameterless method by name on whichever class of assembly `image` (e.g. "Assembly-CSharp.dll") has one: for
    /// methods whose name the game's obfuscation keeps but whose class it renames.
    pub fn method_anywhere(&self, image: &str, name: &str) -> Option<Ptr> {
        let name = CString::new(name).ok()?;
        unsafe {
            let mut n = 0usize;
            let list = (self.domain_get_assemblies)((self.domain_get)(), &mut n);
            if list.is_null() {
                return None;
            }
            let img = (0..n)
                .map(|i| (self.assembly_get_image)(*list.add(i)))
                .find(|&img| CStr::from_ptr((self.image_get_name)(img)).to_bytes() == image.as_bytes())?;
            (0..(self.image_get_class_count)(img)).find_map(|i| {
                let m = (self.class_get_method_from_name)((self.image_get_class)(img, i), name.as_ptr(), 0);
                (!m.is_null()).then_some(m)
            })
        }
    }

    /// A method of `class` (or a class it comes from) by name and its parameters' type names (e.g. ["System.String"]):
    /// overloads told apart.
    pub fn method(&self, class: Ptr, name: &str, params: &[&str]) -> Option<Ptr> {
        let mut c = class;
        while !c.is_null() {
            if let Some(m) = self.own_method(c, name, params) {
                return Some(m);
            }
            c = unsafe { (self.class_get_parent)(c) };
        }
        None
    }

    fn own_method(&self, class: Ptr, name: &str, params: &[&str]) -> Option<Ptr> {
        unsafe {
            let mut iter: Ptr = std::ptr::null_mut();
            loop {
                let m = (self.class_get_methods)(class, &mut iter);
                if m.is_null() {
                    return None;
                }
                if CStr::from_ptr((self.method_get_name)(m)).to_bytes() != name.as_bytes() || (self.method_get_param_count)(m) as usize != params.len() {
                    continue;
                }
                if params.iter().enumerate().all(|(i, want)| self.type_name((self.method_get_param)(m, i as u32)) == *want) {
                    return Some(m);
                }
            }
        }
    }

    fn type_name(&self, t: Ptr) -> String {
        unsafe {
            let p = (self.type_get_name)(t);
            if p.is_null() {
                return String::new();
            }
            let s = CStr::from_ptr(p).to_string_lossy().into_owned();
            (self.free)(p as Ptr);
            s
        }
    }

    /// Calls `method` (on `obj`, or null for a static one) with `args` (pointers to values, or objects themselves).
    /// Its result (a value type comes boxed), or the exception it threw as Err.
    pub unsafe fn invoke(&self, method: Ptr, obj: Ptr, args: &mut [Ptr]) -> Result<Ptr, String> {
        let mut exc: Ptr = std::ptr::null_mut();
        let r = (self.runtime_invoke)(method, obj, if args.is_empty() { std::ptr::null_mut() } else { args.as_mut_ptr() }, &mut exc);
        if exc.is_null() {
            Ok(r)
        } else {
            Err(format!("threw {}", self.type_name((self.class_get_type)((self.object_get_class)(exc)))))
        }
    }

    pub fn string(&self, s: &str) -> Ptr {
        let c = CString::new(s).unwrap_or_default();
        unsafe { (self.string_new)(c.as_ptr()) }
    }

    pub fn read_string(&self, s: Ptr) -> String {
        if s.is_null() {
            return String::new();
        }
        unsafe { String::from_utf16_lossy(std::slice::from_raw_parts((self.string_chars)(s), (self.string_length)(s).max(0) as usize)) }
    }

    /// The value inside a boxed value type, read as `T`.
    pub unsafe fn unbox<T: Copy>(&self, o: Ptr) -> Option<T> {
        (!o.is_null()).then(|| *((self.object_unbox)(o) as *const T))
    }

    /// An object's field by name, in its class or one it comes from, read as `T` (a `Ptr` for one holding an object).
    pub fn field<T: Copy>(&self, o: Ptr, name: &str) -> Option<T> {
        if o.is_null() {
            return None;
        }
        let n = CString::new(name).ok()?;
        unsafe {
            let mut c = (self.object_get_class)(o);
            while !c.is_null() {
                let f = (self.class_get_field_from_name)(c, n.as_ptr());
                if !f.is_null() {
                    let mut v = std::mem::MaybeUninit::<T>::zeroed();
                    (self.field_get_value)(o, f, v.as_mut_ptr() as *mut c_void);
                    return Some(v.assume_init());
                }
                c = (self.class_get_parent)(c);
            }
            None
        }
    }

    /// An object's fields ( its class's and those it comes from; not static ): each one's name, its type's name, and
    /// its value as JSON where it's a plain one ( a number, a flag, a colour or vector, an enum's number, a string ),
    /// else the object it holds ( to look into ), or nothing.
    pub fn fields(&self, o: Ptr) -> Vec<(String, String, Option<serde_json::Value>, Option<Ptr>)> {
        let mut out = vec![];
        if o.is_null() {
            return out;
        }
        unsafe {
            let mut c = (self.object_get_class)(o);
            while !c.is_null() {
                let mut iter: Ptr = std::ptr::null_mut();
                loop {
                    let f = (self.class_get_fields)(c, &mut iter);
                    if f.is_null() {
                        break;
                    }
                    // ( static fields are the class's, not the object's )
                    if (self.field_get_flags)(f) & 0x10 != 0 {
                        continue;
                    }
                    let name = CStr::from_ptr((self.field_get_name)(f)).to_string_lossy().into_owned();
                    let ty = (self.field_get_type)(f);
                    let tname = self.type_name(ty);
                    let fc = (self.class_from_type)(ty);
                    let mut buf = [0u8; 64];
                    let read = |buf: &mut [u8; 64]| (self.field_get_value)(o, f, buf.as_mut_ptr() as *mut c_void);
                    let f32s = |b: &[u8; 64], n: usize| serde_json::json!((0..n).map(|k| f32::from_le_bytes(b[k * 4..k * 4 + 4].try_into().unwrap())).collect::<Vec<_>>());
                    let value = match tname.as_str() {
                        "System.Single" => { read(&mut buf); Some(serde_json::json!(f32::from_le_bytes(buf[..4].try_into().unwrap()))) }
                        "System.Int32" | "System.UInt32" => { read(&mut buf); Some(serde_json::json!(i32::from_le_bytes(buf[..4].try_into().unwrap()))) }
                        "System.Boolean" => { read(&mut buf); Some(serde_json::json!(buf[0] != 0)) }
                        "UnityEngine.Color" | "UnityEngine.Vector4" => { read(&mut buf); Some(f32s(&buf, 4)) }
                        "UnityEngine.Vector3" => { read(&mut buf); Some(f32s(&buf, 3)) }
                        "UnityEngine.Vector2" => { read(&mut buf); Some(f32s(&buf, 2)) }
                        "System.String" => {
                            read(&mut buf);
                            let s = *(buf.as_ptr() as *const Ptr);
                            Some(serde_json::json!(self.read_string(s)))
                        }
                        _ if !fc.is_null() && (self.class_is_enum)(fc) => {
                            read(&mut buf);
                            let v = i32::from_le_bytes(buf[..4].try_into().unwrap());
                            // ( its name too: the enum's constant with that value )
                            let mut it: Ptr = std::ptr::null_mut();
                            let mut named = None;
                            loop {
                                let ef = (self.class_get_fields)(fc, &mut it);
                                if ef.is_null() {
                                    break;
                                }
                                if (self.field_get_flags)(ef) & 0x50 != 0x50 {
                                    continue;
                                }
                                let mut ev = [0u8; 8];
                                (self.field_static_get_value)(ef, ev.as_mut_ptr() as *mut c_void);
                                if i32::from_le_bytes(ev[..4].try_into().unwrap()) == v {
                                    named = Some(CStr::from_ptr((self.field_get_name)(ef)).to_string_lossy().into_owned());
                                    break;
                                }
                            }
                            Some(match named { Some(n) => serde_json::json!(format!("{n} ({v})")), None => serde_json::json!(v) })
                        }
                        _ => None,
                    };
                    let obj = if value.is_none() && !fc.is_null() && !(self.class_is_valuetype)(fc) {
                        read(&mut buf);
                        let p = *(buf.as_ptr() as *const Ptr);
                        (!p.is_null()).then_some(p)
                    } else {
                        None
                    };
                    out.push((name, tname, value, obj));
                }
                c = (self.class_get_parent)(c);
            }
        }
        out
    }

    /// An object's field holding an object, by name (see field).
    pub fn field_object(&self, o: Ptr, name: &str) -> Option<Ptr> {
        self.field::<Ptr>(o, name).filter(|v| !v.is_null())
    }

    /// The full name of an object's class.
    pub fn class_name(&self, o: Ptr) -> String {
        if o.is_null() {
            return String::new();
        }
        unsafe { self.type_name((self.class_get_type)((self.object_get_class)(o))) }
    }

    pub fn class_of(&self, o: Ptr) -> Ptr {
        unsafe { (self.object_get_class)(o) }
    }

    /// A class's System.Type object.
    pub fn type_object(&self, class: Ptr) -> Ptr {
        unsafe { (self.type_get_object)((self.class_get_type)(class)) }
    }

    pub fn array_length(&self, a: Ptr) -> u32 {
        if a.is_null() {
            0
        } else {
            unsafe { (self.array_length)(a) }
        }
    }
}
