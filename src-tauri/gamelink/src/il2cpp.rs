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

    /// A method of `class` by name and its parameters' type names (e.g. ["System.String"]): overloads told apart.
    pub fn method(&self, class: Ptr, name: &str, params: &[&str]) -> Option<Ptr> {
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
