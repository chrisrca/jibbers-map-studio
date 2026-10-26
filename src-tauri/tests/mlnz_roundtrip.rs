//! Round-trips MLNZ Park (a real map exported by Map-Tools 0.4) through the reader and writer.
//! Skipped when the file isn't present; override the path with JBRMAP_SAMPLE.

use std::path::PathBuf;

use serde_json::Value;

fn sample() -> Option<PathBuf> {
    let p = std::env::var("JBRMAP_SAMPLE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(r"C:\Projects\jibbers-map\Jibbers_Template\MLNZ Park.jbrmap"));
    p.exists().then_some(p)
}

/// Structural comparison: same keys everywhere, numbers equal as f32, long base64 strings equal
/// after decoding (gzip output may differ byte-wise between .NET and flate2).
fn compare(a: &Value, b: &Value, path: &str, diffs: &mut Vec<String>) {
    if diffs.len() > 20 {
        return;
    }
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for k in x.keys() {
                match y.get(k) {
                    Some(v) => compare(&x[k], v, &format!("{path}/{k}"), diffs),
                    None => diffs.push(format!("missing in output: {path}/{k}")),
                }
            }
            for k in y.keys() {
                if !x.contains_key(k) {
                    diffs.push(format!("extra in output: {path}/{k}"));
                }
            }
        }
        (Value::Number(x), Value::Number(y)) => {
            let (fx, fy) = (x.as_f64().unwrap() as f32, y.as_f64().unwrap() as f32);
            if fx != fy || x.is_f64() != y.is_f64() {
                diffs.push(format!("{path}: {x} vs {y}"));
            }
        }
        (Value::String(x), Value::String(y)) if x.starts_with("H4sI") && y.starts_with("H4sI") => {
            if jibbers_studio_lib::jbrmap::decode_blob(x).unwrap() != jibbers_studio_lib::jbrmap::decode_blob(y).unwrap() {
                diffs.push(format!("{path}: blob differs"));
            }
        }
        _ => {
            if a != b {
                diffs.push(format!("{path}: {a} vs {b}"));
            }
        }
    }
}

#[test]
fn mlnz_park_roundtrip() {
    let Some(path) = sample() else {
        eprintln!("MLNZ Park.jbrmap not found; skipping");
        return;
    };
    let text = std::fs::read_to_string(&path).unwrap();
    let t = std::time::Instant::now();
    let map = jibbers_studio_lib::jbrmap::read_map(&text).unwrap();
    eprintln!("read in {:?}", t.elapsed());

    assert_eq!(map.name, "MLNZ Park");
    assert_eq!(map.chunks.len(), 1);
    let c = &map.chunks[0];
    assert_eq!(c.heightmap_resolution, 4097);
    assert_eq!(c.terrain_data.as_ref().unwrap().len(), 4097 * 4097 * 2);
    assert_eq!(c.objects.len(), 54);
    assert_eq!(c.custom_objects.len(), 214);
    assert_eq!(c.tree_prototypes.len(), 5);
    assert!(c.snow_mask.is_some());
    assert_eq!(map.spawn_points.len(), 22);
    assert_eq!(map.mesh_library.len(), 137);
    assert_eq!(map.texture_library.len(), 171);

    let t = std::time::Instant::now();
    let out = jibbers_studio_lib::jbrmap::write_map(&map).unwrap();
    eprintln!("wrote {} MB in {:?}", out.len() / 1_000_000, t.elapsed());

    let again = jibbers_studio_lib::jbrmap::read_map(&out).unwrap();
    assert!(again == map, "model changed across write/read");

    let original: Value = serde_json::from_str(&text).unwrap();
    let written: Value = serde_json::from_str(&out).unwrap();
    let mut diffs = vec![];
    compare(&original, &written, "", &mut diffs);
    assert!(diffs.is_empty(), "JSON differs from Map-Tools output:\n{}", diffs.join("\n"));
}
