//! A compiled Direct3D pixel shader (shader model 4/5, as the game ships its shaders for D3D11) turned into one WGSL
//! function the view can run, instruction by instruction: Windows' own disassembler (d3dcompiler_47.dll, part of
//! Windows) gives its assembly, which is written out as WGSL with the same sums.
//!
//! The function is `fn shade(v0: vec4<f32>, v1: vec4<f32>, c<N>: vec4<f32>, …) -> vec4<f32>`: v0 the pixel, v1 the
//! first interpolated input, c<N> each constant register it reads (cb0[N]). Registers are vec4<f32>; integer and bit
//! operations reinterpret their bits, as the hardware does (comparisons give all-ones masks). A source's swizzle is by
//! the destination's components (`mul r1.zw, r1.xxxy, …`: z takes the third letter, w the fourth); one component is
//! all of them.

use std::collections::BTreeSet;

use anyhow::{bail, Context, Result};

/// The assembly of a compiled shader (its DXBC container), from Windows' disassembler.
#[cfg(windows)]
pub fn disassemble(dxbc: &[u8]) -> Result<String> {
    use std::ffi::c_void;
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    type Disassemble = unsafe extern "system" fn(*const c_void, usize, u32, *const u8, *mut *mut c_void) -> i32;
    type GetPtr = unsafe extern "system" fn(*mut c_void) -> *const u8;
    type GetSize = unsafe extern "system" fn(*mut c_void) -> usize;
    type Release = unsafe extern "system" fn(*mut c_void) -> u32;
    let name: Vec<u16> = "d3dcompiler_47.dll\0".encode_utf16().collect();
    unsafe {
        let lib = LoadLibraryW(name.as_ptr());
        if lib.is_null() {
            bail!("d3dcompiler_47.dll isn't there");
        }
        let f = GetProcAddress(lib, c"D3DDisassemble".as_ptr() as *const u8).context("no D3DDisassemble")?;
        let f: Disassemble = std::mem::transmute(f);
        let mut blob: *mut c_void = std::ptr::null_mut();
        let hr = f(dxbc.as_ptr() as *const c_void, dxbc.len(), 0, std::ptr::null(), &mut blob);
        if hr < 0 || blob.is_null() {
            bail!("D3DDisassemble failed ({hr:#x})");
        }
        // (an ID3DBlob: QueryInterface, AddRef, Release, GetBufferPointer, GetBufferSize)
        let vt = *(blob as *const *const usize);
        let ptr: GetPtr = std::mem::transmute(*vt.add(3));
        let size: GetSize = std::mem::transmute(*vt.add(4));
        let release: Release = std::mem::transmute(*vt.add(2));
        let text = std::slice::from_raw_parts(ptr(blob), size(blob));
        let s = String::from_utf8_lossy(text).trim_end_matches('\0').to_string();
        release(blob);
        Ok(s)
    }
}

#[cfg(not(windows))]
pub fn disassemble(_dxbc: &[u8]) -> Result<String> {
    bail!("the game's shaders are read on Windows")
}

/// The compiled shaders (DXBC containers) in a block of the game's shader data.
pub fn containers(data: &[u8]) -> Vec<&[u8]> {
    let mut out = vec![];
    let mut pos = 0;
    while let Some(k) = data[pos..].windows(4).position(|w| w == b"DXBC").map(|k| k + pos) {
        if let Some(sz) = data.get(k + 24..k + 28).map(|b| u32::from_le_bytes(b.try_into().unwrap()) as usize) {
            if let Some(c) = data.get(k..k + sz) {
                out.push(c);
            }
        }
        pos = k + 4;
    }
    out
}

const COMP: [char; 4] = ['x', 'y', 'z', 'w'];

/// A source operand as a vec4<f32> expression; the constant registers it reads are noted.
fn operand(op: &str, used: &mut BTreeSet<u32>) -> Result<String> {
    let mut op = op.trim();
    let neg = op.starts_with('-');
    if neg {
        op = &op[1..];
    }
    let abs = op.starts_with('|');
    if abs {
        op = op.trim_matches('|');
    }
    let mut e = if let Some(inner) = op.strip_prefix("l(").and_then(|s| s.strip_suffix(')')) {
        let mut vals: Vec<String> = inner.split(',').map(literal).collect::<Result<_>>()?;
        if vals.len() == 1 {
            vals = vec![vals[0].clone(); 4];
        }
        format!("vec4<f32>({})", vals.join(", "))
    } else {
        let (base, sw) = op.split_once('.').unwrap_or((op, "xyzw"));
        let base = if let Some(n) = base.strip_prefix("cb0[").and_then(|s| s.strip_suffix(']')) {
            let n: u32 = n.parse().with_context(|| format!("operand {op}"))?;
            used.insert(n);
            format!("c{n}")
        } else if base.starts_with('r') || base.starts_with('v') || base.starts_with('o') {
            base.to_string()
        } else {
            bail!("operand {op}");
        };
        match sw.len() {
            1 => format!("vec4<f32>({base}.{sw})"),
            4 => format!("{base}.{sw}"),
            _ => {
                let last = sw.chars().last().unwrap();
                let full: String = sw.chars().chain(std::iter::repeat(last)).take(4).collect();
                format!("{base}.{full}")
            }
        }
    };
    if abs {
        e = format!("abs({e})");
    }
    if neg {
        e = format!("(-{e})");
    }
    Ok(e)
}

/// A literal: a float, a hex bit pattern, or an integer (as its bits).
fn literal(t: &str) -> Result<String> {
    let t = t.trim();
    if let Some(h) = t.strip_prefix("0x") {
        return Ok(format!("bitcast<f32>(0x{}u)", h.to_lowercase()));
    }
    if t.contains('.') || t.contains('e') || t.contains("inf") || t.contains("nan") {
        let v: f64 = t.parse().with_context(|| format!("literal {t}"))?;
        return Ok(if v.fract() == 0.0 && v.abs() < 1e15 { format!("{v:.1}") } else { format!("{v}") });
    }
    let i: i64 = t.parse().with_context(|| format!("literal {t}"))?;
    Ok(format!("bitcast<f32>({}i)", i as i32))
}

fn dest(op: &str) -> (String, String) {
    match op.split_once('.') {
        Some((r, m)) => (r.to_string(), m.to_string()),
        None => (op.to_string(), "xyzw".into()),
    }
}

/// Operands split at the top-level commas (a literal's own commas kept).
fn operands(s: &str) -> Vec<String> {
    let (mut out, mut depth, mut cur) = (vec![], 0, String::new());
    for ch in s.chars() {
        match ch {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }
        if ch == ',' && depth == 0 {
            out.push(cur.trim().to_string());
            cur.clear();
        } else {
            cur.push(ch);
        }
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

fn u(x: &str) -> String {
    format!("bitcast<u32>({x})")
}
fn i(x: &str) -> String {
    format!("bitcast<i32>({x})")
}
fn mask(c: &str) -> String {
    format!("bitcast<f32>(select(0u, 0xffffffffu, {c}))")
}

/// One component's sum for an opcode on its sources (s0, s1, s2 at component `c`); None: not one of these.
fn per_component(op: &str, c: char) -> Option<String> {
    let (a, b, d) = (format!("s0.{c}"), format!("s1.{c}"), format!("s2.{c}"));
    Some(match op {
        "mov" => a,
        "add" => format!("({a} + {b})"),
        "mul" => format!("({a} * {b})"),
        "div" => format!("({a} / {b})"),
        "min" => format!("min({a}, {b})"),
        "max" => format!("max({a}, {b})"),
        "mad" => format!("fma({a}, {b}, {d})"),
        "movc" => format!("select({d}, {b}, {} != 0u)", u(&a)),
        "ge" => mask(&format!("{a} >= {b}")),
        "lt" => mask(&format!("{a} < {b}")),
        "eq" => mask(&format!("{a} == {b}")),
        "ne" => mask(&format!("{a} != {b}")),
        "and" => format!("bitcast<f32>({} & {})", u(&a), u(&b)),
        "or" => format!("bitcast<f32>({} | {})", u(&a), u(&b)),
        "xor" => format!("bitcast<f32>({} ^ {})", u(&a), u(&b)),
        "not" => format!("bitcast<f32>(~{})", u(&a)),
        "iadd" => format!("bitcast<f32>({} + {})", i(&a), i(&b)),
        "imul" => format!("bitcast<f32>({} * {})", i(&a), i(&b)),
        "imad" => format!("bitcast<f32>({} * {} + {})", i(&a), i(&b), i(&d)),
        "ineg" => format!("bitcast<f32>(-{})", i(&a)),
        "ishl" => format!("bitcast<f32>({} << ({} & 31u))", i(&a), u(&b)),
        "ishr" => format!("bitcast<f32>({} >> ({} & 31u))", i(&a), u(&b)),
        "ushr" => format!("bitcast<f32>({} >> ({} & 31u))", u(&a), u(&b)),
        "ige" => mask(&format!("{} >= {}", i(&a), i(&b))),
        "ilt" => mask(&format!("{} < {}", i(&a), i(&b))),
        "ieq" => mask(&format!("{} == {}", i(&a), i(&b))),
        "ine" => mask(&format!("{} != {}", i(&a), i(&b))),
        "uge" => mask(&format!("{} >= {}", u(&a), u(&b))),
        "ult" => mask(&format!("{} < {}", u(&a), u(&b))),
        "imin" => format!("bitcast<f32>(min({}, {}))", i(&a), i(&b)),
        "imax" => format!("bitcast<f32>(max({}, {}))", i(&a), i(&b)),
        "frc" => format!("fract({a})"),
        "round_ni" => format!("floor({a})"),
        "round_pi" => format!("ceil({a})"),
        "round_ne" => format!("round({a})"),
        "round_z" => format!("trunc({a})"),
        "log" => format!("log2({a})"),
        "exp" => format!("exp2({a})"),
        "sqrt" => format!("sqrt({a})"),
        "rsq" => format!("inverseSqrt({a})"),
        "rcp" => format!("(1.0 / {a})"),
        "itof" => format!("f32({})", i(&a)),
        "utof" => format!("f32({})", u(&a)),
        "ftoi" => format!("bitcast<f32>(i32({a}))"),
        "ftou" => format!("bitcast<f32>(u32({a}))"),
        "deriv_rtx" | "deriv_rtx_coarse" | "deriv_rtx_fine" => format!("dpdx({a})"),
        "deriv_rty" | "deriv_rty_coarse" | "deriv_rty_fine" => format!("dpdy({a})"),
        _ => return None,
    })
}

/// A pixel shader's assembly as one WGSL function.
pub fn to_wgsl(asm: &str) -> Result<String> {
    let mut used = BTreeSet::new();
    let mut temps = 0;
    let mut body: Vec<String> = vec![];
    let mut depth = 1usize;
    let pad = |d: usize| "  ".repeat(d);
    for raw in asm.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with("//") || !line.starts_with(|c: char| c.is_ascii_lowercase()) {
            continue;
        }
        if let Some(n) = line.strip_prefix("dcl_temps ") {
            temps = n.trim().parse()?;
            continue;
        }
        if line.starts_with("dcl_") || line.starts_with("ps_") || line.starts_with("vs_") {
            continue;
        }
        let (opc, rest) = line.split_once(char::is_whitespace).unwrap_or((line, ""));
        let (op, sat) = match opc.strip_suffix("_sat") {
            Some(o) => (o, true),
            None => (opc, false),
        };
        let ops = operands(rest);
        let cond = |k: usize, used: &mut BTreeSet<u32>| -> Result<String> { Ok(u(&format!("{}.x", operand(&ops[k], used)?))) };
        match op {
            "ret" => body.push(format!("{}return o0;", pad(depth))),
            "if_nz" | "if_z" => {
                body.push(format!("{}if ({} {} 0u) {{", pad(depth), cond(0, &mut used)?, if op == "if_nz" { "!=" } else { "==" }));
                depth += 1;
            }
            "else" => body.push(format!("{}}} else {{", pad(depth - 1))),
            "endif" | "endloop" => {
                depth -= 1;
                body.push(format!("{}}}", pad(depth)));
            }
            "loop" => {
                body.push(format!("{}loop {{", pad(depth)));
                depth += 1;
            }
            "break" => body.push(format!("{}break;", pad(depth))),
            "breakc_nz" | "breakc_z" => body.push(format!("{}if ({} {} 0u) {{ break; }}", pad(depth), cond(0, &mut used)?, if op == "breakc_nz" { "!=" } else { "==" })),
            "discard_nz" | "discard_z" => body.push(format!("{}if ({} {} 0u) {{ discard; }}", pad(depth), cond(0, &mut used)?, if op == "discard_nz" { "!=" } else { "==" })),
            "sincos" => {
                let src = operand(&ops[2], &mut used)?;
                for (k, f) in [(0usize, "sin"), (1, "cos")] {
                    if ops[k] == "null" {
                        continue;
                    }
                    let (reg, m) = dest(&ops[k]);
                    let w: Vec<String> = m.chars().map(|c| format!("{reg}.{c} = {f}(s.{c});")).collect();
                    body.push(format!("{}{{ let s = {src}; {} }}", pad(depth), w.join(" ")));
                }
            }
            "dp2" | "dp3" | "dp4" => {
                let n = (op.as_bytes()[2] - b'0') as usize;
                let (reg, m) = dest(&ops[0]);
                let (a, b) = (operand(&ops[1], &mut used)?, operand(&ops[2], &mut used)?);
                let sw: String = COMP[..n].iter().collect();
                let mut e = format!("dot(s0.{sw}, s1.{sw})");
                if sat {
                    e = format!("clamp({e}, 0.0, 1.0)");
                }
                let w: Vec<String> = m.chars().map(|c| format!("{reg}.{c} = d;")).collect();
                body.push(format!("{}{{ let s0 = {a}; let s1 = {b}; let d = {e}; {} }}", pad(depth), w.join(" ")));
            }
            _ => {
                let (reg, m) = dest(&ops[0]);
                let srcs: Vec<String> = ops[1..].iter().map(|o| operand(o, &mut used)).collect::<Result<_>>()?;
                let lets: Vec<String> = srcs.iter().enumerate().map(|(k, s)| format!("let s{k} = {s};")).collect();
                let mut w = vec![];
                for c in m.chars() {
                    let mut e = per_component(op, c).with_context(|| format!("opcode {opc} in: {line}"))?;
                    if sat {
                        e = format!("clamp({e}, 0.0, 1.0)");
                    }
                    w.push(format!("{reg}.{c} = {e};"));
                }
                body.push(format!("{}{{ {} {} }}", pad(depth), lets.join(" "), w.join(" ")));
            }
        }
    }
    let params: Vec<String> = used.iter().map(|n| format!("c{n}: vec4<f32>")).collect();
    let mut out = vec![format!("fn shade(v0: vec4<f32>, v1: vec4<f32>, {}) -> vec4<f32> {{", params.join(", "))];
    for r in 0..temps {
        out.push(format!("  var r{r}: vec4<f32> = vec4<f32>(0.0);"));
    }
    out.push("  var o0: vec4<f32> = vec4<f32>(0.0);".into());
    out.extend(body);
    out.push("}".into());
    Ok(out.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn swizzles_go_by_the_destination_and_literals_broadcast() {
        let w = to_wgsl("ps_4_0\ndcl_temps 2\nmul r1.zw, r1.xxxy, l(0.000000, 0.000000, 0.100000, 0.100000)\nmul r0.w, cb0[156].z, l(5.000000)\nret\n").unwrap();
        assert!(w.contains("let s0 = r1.xxxy; let s1 = vec4<f32>(0.0, 0.0, 0.1, 0.1); r1.z = (s0.z * s1.z); r1.w = (s0.w * s1.w);"), "{w}");
        assert!(w.contains("let s0 = vec4<f32>(c156.z); let s1 = vec4<f32>(5.0, 5.0, 5.0, 5.0); r0.w = (s0.w * s1.w);"), "{w}");
        assert!(w.starts_with("fn shade(v0: vec4<f32>, v1: vec4<f32>, c156: vec4<f32>) -> vec4<f32> {"), "{w}");
    }

    #[test]
    fn comparisons_are_masks_and_branches_test_bits() {
        let w = to_wgsl("ps_4_0\ndcl_temps 1\nge r0.x, r0.y, l(0.000000)\nif_nz r0.x\nmov_sat r0.y, -|r0.z|\nelse\nloop\nbreakc_nz r0.x\niadd r0.x, r0.x, l(1)\nendloop\nendif\nret\n").unwrap();
        assert!(w.contains("r0.x = bitcast<f32>(select(0u, 0xffffffffu, s0.x >= s1.x));"), "{w}");
        assert!(w.contains("if (bitcast<u32>(vec4<f32>(r0.x).x) != 0u) {"), "{w}");
        assert!(w.contains("let s0 = (-abs(vec4<f32>(r0.z))); r0.y = clamp(s0.y, 0.0, 1.0);"), "{w}");
        assert!(w.contains("} else {") && w.contains("loop {") && w.contains("{ break; }"), "{w}");
        assert!(w.contains("bitcast<f32>(1i)"), "{w}");
    }
}
