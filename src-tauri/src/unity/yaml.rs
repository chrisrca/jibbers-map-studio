//! Unity's text asset files ( Force Text ): `--- !u!<class> &<id>` documents of block mappings and sequences, flow
//! maps for references and vectors. Plain values stay strings ( a guid or a hex blob isn't a number ); `Value` reads
//! them as numbers where it's asked to.

use super::value::Value;

/// One object of a text file.
#[derive(Clone, Debug)]
pub struct Doc {
    pub class_id: i32,
    pub file_id: i64,
    /// A placeholder for an object of a prefab instance ( its own data is the prefab's ).
    pub stripped: bool,
    pub type_name: String,
    pub value: Value,
}

struct Line<'a> {
    indent: usize,
    text: &'a str,
}

/// The file's objects.
pub fn parse(src: &str) -> Vec<Doc> {
    let mut docs = vec![];
    let mut head: Option<(i32, i64, bool)> = None;
    let mut body: Vec<Line> = vec![];
    let mut flush = |head: &mut Option<(i32, i64, bool)>, body: &mut Vec<Line>| {
        if let Some((class_id, file_id, stripped)) = head.take() {
            let mut i = 0;
            let v = if body.is_empty() { Value::Map(vec![]) } else { block(body, &mut i, body[0].indent) };
            // ( "TypeName:" holds the object's fields )
            let (type_name, value) = match v {
                Value::Map(mut m) if m.len() == 1 => m.pop().unwrap(),
                other => (String::new(), other),
            };
            docs.push(Doc { class_id, file_id, stripped, type_name, value });
        }
        body.clear();
    };
    for raw in src.lines() {
        let raw = raw.trim_end_matches('\r');
        if let Some(rest) = raw.strip_prefix("--- !u!") {
            flush(&mut head, &mut body);
            let mut it = rest.split_whitespace();
            let class_id = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let file_id = it.next().and_then(|s| s.trim_start_matches('&').parse().ok()).unwrap_or(0);
            head = Some((class_id, file_id, it.any(|s| s == "stripped")));
            continue;
        }
        if head.is_none() || raw.trim().is_empty() || raw.starts_with('%') {
            continue;
        }
        let indent = raw.len() - raw.trim_start().len();
        body.push(Line { indent, text: raw.trim_start() });
    }
    flush(&mut head, &mut body);
    docs
}

/// A plain YAML file ( a .meta ): its top-level mapping.
pub fn parse_plain(src: &str) -> Value {
    let lines: Vec<Line> = src
        .lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.trim().is_empty() && !l.starts_with('%') && !l.starts_with("---"))
        .map(|l| Line { indent: l.len() - l.trim_start().len(), text: l.trim_start() })
        .collect();
    if lines.is_empty() {
        return Value::Map(vec![]);
    }
    let mut i = 0;
    block(&lines, &mut i, lines[0].indent)
}

/// The block at `indent` from line `i`: a sequence ( "- " lines ) or a mapping.
fn block(lines: &[Line], i: &mut usize, indent: usize) -> Value {
    if *i < lines.len() && is_item(lines[*i].text) {
        sequence(lines, i, indent)
    } else {
        mapping(lines, i, indent, None)
    }
}

fn is_item(t: &str) -> bool {
    t == "-" || t.starts_with("- ")
}

fn sequence(lines: &[Line], i: &mut usize, indent: usize) -> Value {
    let mut items = vec![];
    while *i < lines.len() && lines[*i].indent == indent && is_item(lines[*i].text) {
        let rest = lines[*i].text[1..].trim_start();
        if rest.is_empty() {
            *i += 1;
            items.push(if *i < lines.len() && lines[*i].indent > indent { block(lines, i, lines[*i].indent) } else { Value::Null });
        } else if key_of(rest).is_some() && !rest.starts_with('{') && !rest.starts_with('"') && !rest.starts_with('\'') {
            // ( "- key: value": a mapping whose keys line up two past the dash )
            items.push(mapping(lines, i, indent + 2, Some(rest)));
        } else {
            let (v, used) = scalar(rest, &lines[*i + 1..], indent);
            *i += 1 + used;
            items.push(v);
        }
    }
    Value::List(items)
}

/// The key of a "key: value" or "key:" line.
fn key_of(t: &str) -> Option<(&str, &str)> {
    if let Some(k) = t.strip_suffix(':') {
        if !k.contains(": ") {
            return Some((k, ""));
        }
    }
    let p = t.find(": ")?;
    Some((&t[..p], t[p + 2..].trim()))
}

/// A mapping at `indent`; `first`: its first line's text when it starts after a sequence's dash.
fn mapping(lines: &[Line], i: &mut usize, indent: usize, mut first: Option<&str>) -> Value {
    let mut m = vec![];
    loop {
        let text = match first.take() {
            Some(t) => t,
            None => {
                if *i >= lines.len() || lines[*i].indent != indent || is_item(lines[*i].text) {
                    break;
                }
                lines[*i].text
            }
        };
        let Some((k, rest)) = key_of(text) else {
            *i += 1;
            continue;
        };
        let key = unquote(k);
        if rest.is_empty() {
            *i += 1;
            // the value: what's indented under it, or a sequence at its own indent ( Unity writes them so )
            let v = if *i < lines.len() && (lines[*i].indent > indent || (lines[*i].indent == indent && is_item(lines[*i].text))) {
                block(lines, i, lines[*i].indent)
            } else {
                Value::Null
            };
            m.push((key, v));
        } else {
            let (v, used) = scalar(rest, &lines[*i + 1..], indent);
            *i += 1 + used;
            m.push((key, v));
        }
    }
    Value::Map(m)
}

/// A value on a line ( and, for a quoted string or a plain one carried on, the lines after it more indented than
/// `indent` ): it and how many more lines it took.
fn scalar(t: &str, after: &[Line], indent: usize) -> (Value, usize) {
    let t = t.trim();
    if t.starts_with('{') || t.starts_with('[') {
        let mut s = t.to_string();
        let mut used = 0;
        // ( a long flow value carried onto the next lines )
        while !balanced(&s) && used < after.len() {
            s.push(' ');
            s.push_str(after[used].text);
            used += 1;
        }
        let mut p = 0;
        return (flow(s.as_bytes(), &mut p), used);
    }
    if t.starts_with('"') || t.starts_with('\'') {
        let q = t.as_bytes()[0];
        let mut s = t.to_string();
        let mut used = 0;
        while !closed(&s, q) && used < after.len() {
            if q == b'"' && s.ends_with('\\') {
                s.pop();
            } else {
                s.push(' ');
            }
            s.push_str(after[used].text);
            used += 1;
        }
        return (Value::Str(unquote(&s)), used);
    }
    let mut s = t.to_string();
    let mut used = 0;
    while used < after.len() && after[used].indent > indent && key_of(after[used].text).is_none() && !is_item(after[used].text) {
        s.push(' ');
        s.push_str(after[used].text);
        used += 1;
    }
    (if s == "~" || s == "null" { Value::Null } else { Value::Str(s) }, used)
}

fn closed(s: &str, q: u8) -> bool {
    let b = s.as_bytes();
    if b.len() < 2 || b[b.len() - 1] != q {
        return false;
    }
    if q == b'\'' {
        // ( '' is a quote inside )
        let n = b[1..].iter().filter(|&&c| c == b'\'').count();
        return n % 2 == 1;
    }
    let mut esc = 0;
    for &c in b[1..b.len() - 1].iter().rev() {
        if c == b'\\' { esc += 1 } else { break }
    }
    esc % 2 == 0
}

fn balanced(s: &str) -> bool {
    let (mut depth, mut q) = (0i32, 0u8);
    for &c in s.as_bytes() {
        if q != 0 {
            if c == q { q = 0 }
            continue;
        }
        match c {
            b'"' | b'\'' => q = c,
            b'{' | b'[' => depth += 1,
            b'}' | b']' => depth -= 1,
            _ => {}
        }
    }
    depth <= 0
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    if s.len() >= 2 && s.starts_with('\'') && s.ends_with('\'') {
        return s[1..s.len() - 1].replace("''", "'");
    }
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        let mut out = String::new();
        let mut it = s[1..s.len() - 1].chars();
        while let Some(c) = it.next() {
            if c != '\\' {
                out.push(c);
                continue;
            }
            match it.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('0') => out.push('\0'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some('/') => out.push('/'),
                Some(' ') => out.push(' '),
                Some('x') => {
                    let h: String = it.by_ref().take(2).collect();
                    if let Ok(n) = u32::from_str_radix(&h, 16) {
                        out.push(char::from_u32(n).unwrap_or('?'));
                    }
                }
                Some('u') => {
                    let h: String = it.by_ref().take(4).collect();
                    if let Ok(n) = u32::from_str_radix(&h, 16) {
                        out.push(char::from_u32(n).unwrap_or('?'));
                    }
                }
                Some(o) => out.push(o),
                None => {}
            }
        }
        return out;
    }
    s.to_string()
}

/// A flow value: `{a: 1, b: {c: 2}}`, `[1, 2]` or a plain or quoted scalar inside one.
fn flow(b: &[u8], p: &mut usize) -> Value {
    let ws = |p: &mut usize| {
        while *p < b.len() && b[*p].is_ascii_whitespace() {
            *p += 1;
        }
    };
    ws(p);
    if *p >= b.len() {
        return Value::Null;
    }
    match b[*p] {
        b'{' => {
            *p += 1;
            let mut m = vec![];
            loop {
                ws(p);
                if *p >= b.len() {
                    break;
                }
                if b[*p] == b'}' {
                    *p += 1;
                    break;
                }
                if b[*p] == b',' {
                    *p += 1;
                    continue;
                }
                let k0 = *p;
                while *p < b.len() && b[*p] != b':' && b[*p] != b',' && b[*p] != b'}' {
                    *p += 1;
                }
                let key = unquote(&String::from_utf8_lossy(&b[k0..*p]));
                if *p < b.len() && b[*p] == b':' {
                    *p += 1;
                    let v = flow(b, p);
                    m.push((key, v));
                } else {
                    m.push((key, Value::Null));
                }
            }
            Value::Map(m)
        }
        b'[' => {
            *p += 1;
            let mut l = vec![];
            loop {
                ws(p);
                if *p >= b.len() {
                    break;
                }
                if b[*p] == b']' {
                    *p += 1;
                    break;
                }
                if b[*p] == b',' {
                    *p += 1;
                    continue;
                }
                l.push(flow(b, p));
            }
            Value::List(l)
        }
        q @ (b'"' | b'\'') => {
            let s0 = *p;
            *p += 1;
            while *p < b.len() {
                if b[*p] == b'\\' && q == b'"' {
                    *p += 2;
                    continue;
                }
                if b[*p] == q {
                    if q == b'\'' && *p + 1 < b.len() && b[*p + 1] == b'\'' {
                        *p += 2;
                        continue;
                    }
                    *p += 1;
                    break;
                }
                *p += 1;
            }
            Value::Str(unquote(&String::from_utf8_lossy(&b[s0..(*p).min(b.len())])))
        }
        _ => {
            let s0 = *p;
            while *p < b.len() && b[*p] != b',' && b[*p] != b'}' && b[*p] != b']' {
                *p += 1;
            }
            let s = String::from_utf8_lossy(&b[s0..*p]).trim().to_string();
            if s.is_empty() || s == "~" { Value::Null } else { Value::Str(s) }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRC: &str = "%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!1 &100\nGameObject:\n  m_Name: Rail\n  m_Component:\n  - component: {fileID: 400}\n  - component: {fileID: 500}\n  m_IsActive: 1\n--- !u!4 &400 stripped\nTransform:\n  m_LocalPosition: {x: 1.5, y: -2, z: 3}\n  m_Children: []\n--- !u!114 &500\nMonoBehaviour:\n  m_Script: {fileID: 11500000, guid: 00000000000000001000000000000000, type: 3}\n  id: rail_long\n  parameters:\n  - name: length\n    value: 4\n  title: \"a long\n    title\"\n";

    #[test]
    fn reads_unity_text() {
        let d = parse(SRC);
        assert_eq!(d.len(), 3);
        assert_eq!((d[0].class_id, d[0].file_id, d[0].type_name.as_str()), (1, 100, "GameObject"));
        assert_eq!(d[0].value.get("m_Name").str(), "Rail");
        assert_eq!(d[0].value.get("m_Component").list().len(), 2);
        assert_eq!(d[0].value.get("m_Component").list()[1].get("component").pptr().path, 500);
        assert!(d[1].stripped);
        assert_eq!(d[1].value.get("m_LocalPosition").xyz(), [1.5, -2.0, 3.0]);
        let mb = &d[2].value;
        assert_eq!(mb.get("m_Script").get("guid").str(), "00000000000000001000000000000000");
        assert_eq!(mb.get("parameters").list()[0].get("value").i32(), 4);
        assert_eq!(mb.get("title").str(), "a long title");
    }
}
