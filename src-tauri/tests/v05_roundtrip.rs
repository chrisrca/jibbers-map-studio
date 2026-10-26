//! Round-trips the game's own Map-Tools 0.5 maps (header with author / mod version / scale, lifts) through the
//! reader and writer. Skipped when the game isn't installed.

use std::path::PathBuf;

use serde_json::Value;

const MAPS: &str = r"C:\Program Files (x86)\Steam\steamapps\common\Jibbers Playtest\Jibbers_Data\StreamingAssets\Maps";

fn same(a: &Value, b: &Value, path: &str, diffs: &mut Vec<String>) {
    if diffs.len() > 20 {
        return;
    }
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            for k in x.keys() {
                match y.get(k) {
                    Some(v) => same(&x[k], v, &format!("{path}/{k}"), diffs),
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
            if x.as_f64().unwrap() as f32 != y.as_f64().unwrap() as f32 {
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
fn game_v05_maps_roundtrip() {
    for name in ["joyosa-park.jbrmap", "playtest.jbrmap"] {
        let path = PathBuf::from(MAPS).join(name);
        if !path.exists() {
            eprintln!("{name} not found; skipping");
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        let map = jibbers_studio_lib::jbrmap::read_map(&text).unwrap();
        assert_eq!(map.version, "0.5");
        assert!(!map.author.is_empty(), "{name}: author read");
        let lifts: Vec<_> = map.chunks.iter().flat_map(|c| &c.objects).filter(|o| o.lift.is_some()).collect();
        assert!(!lifts.is_empty(), "{name}: lifts read");
        let out = jibbers_studio_lib::jbrmap::write_map(&map).unwrap();
        let (a, b): (Value, Value) = (serde_json::from_str(&text).unwrap(), serde_json::from_str(&out).unwrap());
        let mut diffs = vec![];
        same(&a, &b, "", &mut diffs);
        assert!(diffs.is_empty(), "{name}: {diffs:#?}");
        eprintln!("{name}: {} lifts, round trip exact", lifts.len());
    }
}
