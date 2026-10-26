//! Features' names and their settings' options, readable (and the colours they come in).

use super::*;

/// The game's feature colours by name.
pub(crate) const NAMED: &[(&str, u32)] = &[
    ("blue", 0x3b82f6), ("red", 0xef4444), ("green", 0x22c55e), ("pink", 0xec4899), ("cyan", 0x06b6d4), ("orange", 0xf97316),
    ("yellow", 0xeab308), ("white", 0xf1f5f9), ("black", 0x334155),
];

/// A material's name as a person writes it: "RailLong" → "Rail Long", "Floodlight_Post" → "Floodlight Post".
pub(crate) fn readable(name: &str) -> String {
    let mut out = String::new();
    let mut prev: Option<char> = None;
    for c in name.chars() {
        let c = if c == '_' || c == '-' || c == '.' { ' ' } else { c };
        // a capital after a small letter starts a word
        if c.is_ascii_uppercase() && prev.is_some_and(|p| p.is_ascii_lowercase()) {
            out.push(' ');
        }
        if !(c == ' ' && (out.is_empty() || out.ends_with(' '))) {
            out.push(if out.is_empty() || out.ends_with(' ') { c.to_ascii_uppercase() } else { c });
        }
        prev = Some(c);
    }
    let out = out.trim().to_string();
    if out.is_empty() { "Game Material".into() } else { out }
}

/// Each feature's default colour (from its placeholder's "color" parameter), for those that have one.
pub(crate) fn default_colours(placeholders_json: &Path) -> Result<HashMap<String, u32>> {
    #[derive(Deserialize)]
    struct Info {
        id: String,
        #[serde(default)]
        parameters: Vec<serde_json::Value>,
    }
    let infos: Vec<Info> = serde_json::from_slice(&std::fs::read(placeholders_json)?)?;
    Ok(infos
        .into_iter()
        .filter_map(|i| {
            let p = i.parameters.iter().find(|p| p.get("name").and_then(|n| n.as_str()) == Some("color"))?;
            let name = p.get("default").and_then(|d| d.as_str()).unwrap_or("blue");
            Some((i.id, NAMED.iter().find(|(n, _)| *n == name).map_or(0x3b82f6, |(_, h)| *h)))
        })
        .collect())
}

/// An option as a name: "up1" → "Up 1", "down" → "Down".
pub(crate) fn option_label(o: &str) -> String {
    let mut out = String::new();
    let mut prev: Option<char> = None;
    for c in o.chars() {
        if c == '_' || c == '-' {
            out.push(' ');
        } else {
            if prev.is_some_and(|p| p.is_ascii_alphabetic() && c.is_ascii_digit()) {
                out.push(' ');
            }
            out.push(if prev.is_none_or(|p| p == ' ' || p == '_' || p == '-') { c.to_ascii_uppercase() } else { c });
        }
        prev = Some(c);
    }
    out
}

/// Each feature's settings' default options (placeholders.json), for the selection ones.
pub(crate) fn default_options(placeholders_json: &Path) -> Result<HashMap<String, HashMap<String, String>>> {
    #[derive(Deserialize)]
    struct Info {
        id: String,
        #[serde(default)]
        parameters: Vec<serde_json::Value>,
    }
    let infos: Vec<Info> = serde_json::from_slice(&std::fs::read(placeholders_json)?)?;
    Ok(infos
        .into_iter()
        .map(|i| {
            let d = i.parameters.iter().filter_map(|p| Some((p.get("name")?.as_str()?.to_string(), p.get("default")?.as_str()?.to_string()))).collect();
            (i.id, d)
        })
        .collect())
}
