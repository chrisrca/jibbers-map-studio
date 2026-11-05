//! A shader's source read for what a material asks of it: its name, its properties in order ( kind and default ),
//! and its render queue ( Tags "Queue" ).

use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Float,
    Color,
    Vector,
    Texture,
}

#[derive(Clone, Debug)]
pub struct Prop {
    pub name: String,
    pub kind: Kind,
    pub default: [f32; 4],
}

#[derive(Clone, Debug, Default)]
pub struct Shader {
    pub name: String,
    pub props: Vec<Prop>,
    pub queue: i32,
}

impl Shader {
    pub fn prop(&self, name: &str) -> Option<&Prop> {
        self.props.iter().find(|p| p.name == name)
    }
}

/// The shader of a .shader file ( None for one it can't read: a Shader Graph, a built-in one ).
pub fn read(path: &Path) -> Option<Shader> {
    if path.extension().map(|e| e != "shader").unwrap_or(true) {
        return None;
    }
    parse(&std::fs::read_to_string(path).ok()?)
}

pub fn parse(src: &str) -> Option<Shader> {
    let name = src.split("Shader").nth(1)?.split('"').nth(1)?.to_string();
    let mut props = vec![];
    if let Some(start) = src.find("Properties") {
        let body = &src[start..];
        let open = body.find('{')?;
        let mut depth = 0;
        let mut end = open;
        for (i, c) in body[open..].char_indices() {
            match c {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = open + i;
                        break;
                    }
                }
                _ => {}
            }
        }
        for line in body[open + 1..end].lines() {
            let mut l = line.trim();
            if l.starts_with("//") || l.is_empty() {
                continue;
            }
            // ( attributes first: [HDR], [Toggle], [Enum(...)] )
            while l.starts_with('[') {
                let Some(e) = l.find(']') else { break };
                l = l[e + 1..].trim_start();
            }
            let Some(paren) = l.find('(') else { continue };
            let pname = l[..paren].trim().to_string();
            if pname.is_empty() {
                continue;
            }
            let rest = &l[paren..];
            // ( "Label", Type ) = default
            let close = match_paren(rest)?;
            let inner = &rest[1..close];
            let ty = inner.rsplit_once(',').map(|(_, t)| t.trim()).unwrap_or("").to_lowercase();
            let ty = if inner.to_lowercase().contains("range(") { "range".to_string() } else { ty };
            let kind = match ty.as_str() {
                "color" => Kind::Color,
                "vector" => Kind::Vector,
                "2d" | "3d" | "cube" | "2darray" | "cubearray" | "any" => Kind::Texture,
                _ => Kind::Float,
            };
            let dv = rest[close + 1..].split('=').nth(1).unwrap_or("").trim();
            let default = if dv.starts_with('(') {
                let nums: Vec<f32> = dv.trim_start_matches('(').split(')').next().unwrap_or("").split(',').map(|x| x.trim().parse().unwrap_or(0.0)).collect();
                [0, 1, 2, 3].map(|i| nums.get(i).copied().unwrap_or(if i == 3 { 1.0 } else { 0.0 }))
            } else {
                let f = dv.split_whitespace().next().unwrap_or("0").trim_matches('"').parse().unwrap_or(0.0);
                [f, 0.0, 0.0, 0.0]
            };
            props.push(Prop { name: pname, kind, default });
        }
    }
    let queue = queue_of(src);
    Some(Shader { name, props, queue })
}

fn match_paren(s: &str) -> Option<usize> {
    let mut depth = 0;
    let mut quoted = false;
    for (i, c) in s.char_indices() {
        match c {
            '"' => quoted = !quoted,
            '(' if !quoted => depth += 1,
            ')' if !quoted => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

/// The first "Queue" tag's queue ( Geometry 2000 when there's none ).
fn queue_of(src: &str) -> i32 {
    let Some(i) = src.find("\"Queue\"") else { return 2000 };
    let v = src[i + 7..].split('"').nth(1).unwrap_or("Geometry");
    let (base, off) = match v.find(['+', '-']) {
        Some(p) => (&v[..p], v[p..].parse::<i32>().unwrap_or(0)),
        None => (v, 0),
    };
    off + match base.trim() {
        "Background" => 1000,
        "AlphaTest" => 2450,
        "Transparent" => 3000,
        "Overlay" => 4000,
        _ => 2000,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_properties() {
        let s = super::parse("Shader \"Custom/CustomObjectLit\"\n{\n Properties\n {\n  _BaseMap(\"Base Map\", 2D) = \"white\" {}\n  [HDR] _EmissionColor(\"Emission Color\", Color) = (0,0,0,1)\n  _Smoothness(\"Smoothness\", Range(0,1)) = 0.25\n  [Enum(UnityEngine.Rendering.CullMode)] _Cull(\"Cull Mode\", Float) = 2\n }\n SubShader { Tags { \"Queue\"=\"Transparent+5\" } }\n}").unwrap();
        assert_eq!(s.name, "Custom/CustomObjectLit");
        let names: Vec<_> = s.props.iter().map(|p| (p.name.as_str(), p.kind, p.default[0])).collect();
        assert_eq!(names, [("_BaseMap", super::Kind::Texture, 0.0), ("_EmissionColor", super::Kind::Color, 0.0), ("_Smoothness", super::Kind::Float, 0.25), ("_Cull", super::Kind::Float, 2.0)]);
        assert_eq!(s.queue, 3005);
    }
}
