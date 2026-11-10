//! FBX files read into their node tree: binary ( Kaydara FBX Binary, 7.x, arrays zlib-compressed or not ) and ASCII.

use std::io::Read;

use anyhow::{bail, Context, Result};

#[derive(Clone, Debug)]
pub enum Prop {
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    Raw(Vec<u8>),
    Ints(Vec<i64>),
    Floats(Vec<f64>),
}

impl Prop {
    pub fn f64(&self) -> f64 {
        match self {
            Prop::Bool(b) => *b as i32 as f64,
            Prop::Int(i) => *i as f64,
            Prop::Float(f) => *f,
            Prop::Str(s) => s.trim().parse().unwrap_or(0.0),
            _ => 0.0,
        }
    }
    pub fn i64(&self) -> i64 {
        match self {
            Prop::Bool(b) => *b as i64,
            Prop::Int(i) => *i,
            Prop::Float(f) => *f as i64,
            Prop::Str(s) => s.trim().parse().unwrap_or(0),
            _ => 0,
        }
    }
    pub fn str(&self) -> &str {
        match self {
            Prop::Str(s) => s,
            _ => "",
        }
    }
    pub fn floats(&self) -> Vec<f64> {
        match self {
            Prop::Floats(v) => v.clone(),
            Prop::Ints(v) => v.iter().map(|&i| i as f64).collect(),
            p => vec![p.f64()],
        }
    }
    pub fn ints(&self) -> Vec<i64> {
        match self {
            Prop::Ints(v) => v.clone(),
            Prop::Floats(v) => v.iter().map(|&f| f as i64).collect(),
            p => vec![p.i64()],
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct Node {
    pub name: String,
    pub props: Vec<Prop>,
    pub children: Vec<Node>,
}

impl Node {
    pub fn child(&self, name: &str) -> Option<&Node> {
        self.children.iter().find(|c| c.name == name)
    }
    pub fn all<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Node> + 'a {
        self.children.iter().filter(move |c| c.name == name)
    }
    pub fn prop(&self, i: usize) -> Option<&Prop> {
        self.props.get(i)
    }
    /// A Properties70 entry's values ( after its name and three type strings ), by name.
    pub fn p70(&self, name: &str) -> Option<&[Prop]> {
        let ps = self.child("Properties70").or_else(|| self.child("Properties60"))?;
        ps.children.iter().find(|p| p.props.first().map(|x| x.str() == name).unwrap_or(false)).map(|p| if p.props.len() > 4 { &p.props[4..] } else { &p.props[..0] })
    }
    pub fn p70_vec(&self, name: &str, d: [f64; 3]) -> [f64; 3] {
        match self.p70(name) {
            Some(v) if v.len() >= 3 => [v[0].f64(), v[1].f64(), v[2].f64()],
            _ => d,
        }
    }
    pub fn p70_f(&self, name: &str, d: f64) -> f64 {
        self.p70(name).and_then(|v| v.first()).map(|p| p.f64()).unwrap_or(d)
    }
    pub fn p70_i(&self, name: &str, d: i64) -> i64 {
        self.p70(name).and_then(|v| v.first()).map(|p| p.i64()).unwrap_or(d)
    }
}

pub fn parse(data: &[u8]) -> Result<Node> {
    if data.starts_with(b"Kaydara FBX Binary") {
        binary(data)
    } else {
        ascii(&String::from_utf8_lossy(data))
    }
}

fn binary(d: &[u8]) -> Result<Node> {
    if d.len() < 27 {
        bail!("FBX file too short");
    }
    let version = u32::from_le_bytes(d[23..27].try_into().unwrap());
    let wide = version >= 7500;
    let mut p = 27;
    let mut root = Node::default();
    while let Some(n) = record(d, &mut p, wide)? {
        root.children.push(n);
    }
    Ok(root)
}

fn rd<const N: usize>(d: &[u8], p: &mut usize) -> Result<[u8; N]> {
    let s = d.get(*p..*p + N).context("FBX read past the end")?;
    *p += N;
    Ok(s.try_into().unwrap())
}

fn record(d: &[u8], p: &mut usize, wide: bool) -> Result<Option<Node>> {
    let (end, nprops, _plen) = if wide {
        (u64::from_le_bytes(rd(d, p)?) as usize, u64::from_le_bytes(rd(d, p)?) as usize, u64::from_le_bytes(rd(d, p)?) as usize)
    } else {
        (u32::from_le_bytes(rd(d, p)?) as usize, u32::from_le_bytes(rd(d, p)?) as usize, u32::from_le_bytes(rd(d, p)?) as usize)
    };
    let nl = rd::<1>(d, p)?[0] as usize;
    if end == 0 {
        return Ok(None);
    }
    let name = String::from_utf8_lossy(d.get(*p..*p + nl).context("FBX name")?).into_owned();
    *p += nl;
    let mut props = Vec::with_capacity(nprops);
    for _ in 0..nprops {
        props.push(property(d, p)?);
    }
    let mut children = vec![];
    while *p < end {
        match record(d, p, wide)? {
            Some(c) => children.push(c),
            None => break,
        }
    }
    *p = end;
    Ok(Some(Node { name, props, children }))
}

fn property(d: &[u8], p: &mut usize) -> Result<Prop> {
    let t = rd::<1>(d, p)?[0];
    Ok(match t {
        b'Y' => Prop::Int(i16::from_le_bytes(rd(d, p)?) as i64),
        b'C' => Prop::Bool(rd::<1>(d, p)?[0] != 0),
        b'I' => Prop::Int(i32::from_le_bytes(rd(d, p)?) as i64),
        b'F' => Prop::Float(f32::from_le_bytes(rd(d, p)?) as f64),
        b'D' => Prop::Float(f64::from_le_bytes(rd(d, p)?)),
        b'L' => Prop::Int(i64::from_le_bytes(rd(d, p)?)),
        b'S' | b'R' => {
            let n = u32::from_le_bytes(rd(d, p)?) as usize;
            let b = d.get(*p..*p + n).context("FBX string")?.to_vec();
            *p += n;
            if t == b'S' { Prop::Str(String::from_utf8_lossy(&b).into_owned()) } else { Prop::Raw(b) }
        }
        b'f' | b'd' | b'l' | b'i' | b'b' => {
            let n = u32::from_le_bytes(rd(d, p)?) as usize;
            let enc = u32::from_le_bytes(rd(d, p)?);
            let clen = u32::from_le_bytes(rd(d, p)?) as usize;
            let raw = d.get(*p..*p + clen).context("FBX array")?;
            *p += clen;
            let bytes = if enc == 1 {
                let mut out = vec![];
                flate2::read::ZlibDecoder::new(raw).read_to_end(&mut out)?;
                out
            } else {
                raw.to_vec()
            };
            let es = match t {
                b'f' | b'i' => 4,
                b'd' | b'l' => 8,
                _ => 1,
            };
            let n = n.min(bytes.len() / es);
            match t {
                b'f' => Prop::Floats((0..n).map(|i| f32::from_le_bytes(bytes[i * 4..i * 4 + 4].try_into().unwrap()) as f64).collect()),
                b'd' => Prop::Floats((0..n).map(|i| f64::from_le_bytes(bytes[i * 8..i * 8 + 8].try_into().unwrap())).collect()),
                b'l' => Prop::Ints((0..n).map(|i| i64::from_le_bytes(bytes[i * 8..i * 8 + 8].try_into().unwrap())).collect()),
                b'i' => Prop::Ints((0..n).map(|i| i32::from_le_bytes(bytes[i * 4..i * 4 + 4].try_into().unwrap()) as i64).collect()),
                _ => Prop::Ints(bytes[..n].iter().map(|&b| b as i64).collect()),
            }
        }
        o => bail!("FBX property type {:?}", o as char),
    })
}

// ---- ASCII

fn ascii(src: &str) -> Result<Node> {
    let toks = tokens(src);
    let mut i = 0;
    let mut root = Node::default();
    while i < toks.len() {
        match ascii_node(&toks, &mut i)? {
            Some(n) => root.children.push(n),
            None => i += 1,
        }
    }
    Ok(root)
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Key(String),
    Str(String),
    Num(String),
    Word(String),
    Open,
    Close,
    Comma,
    Star,
}

fn tokens(src: &str) -> Vec<Tok> {
    let b = src.as_bytes();
    let mut out = vec![];
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        match c {
            b';' => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
            }
            b' ' | b'\t' | b'\r' | b'\n' => i += 1,
            b'{' => {
                out.push(Tok::Open);
                i += 1;
            }
            b'}' => {
                out.push(Tok::Close);
                i += 1;
            }
            b',' => {
                out.push(Tok::Comma);
                i += 1;
            }
            b'*' => {
                out.push(Tok::Star);
                i += 1;
                while i < b.len() && b[i].is_ascii_digit() {
                    i += 1;
                }
            }
            b'"' => {
                let s0 = i + 1;
                i += 1;
                while i < b.len() && b[i] != b'"' {
                    i += 1;
                }
                out.push(Tok::Str(src[s0..i.min(b.len())].replace("&quot;", "\"")));
                i += 1;
            }
            _ => {
                let s0 = i;
                while i < b.len() && !matches!(b[i], b' ' | b'\t' | b'\r' | b'\n' | b',' | b'{' | b'}' | b'"' | b';') {
                    i += 1;
                }
                let w = &src[s0..i];
                if let Some(k) = w.strip_suffix(':') {
                    out.push(Tok::Key(k.to_string()));
                } else if w.starts_with(|ch: char| ch.is_ascii_digit() || ch == '-' || ch == '+' || ch == '.') {
                    out.push(Tok::Num(w.to_string()));
                } else {
                    out.push(Tok::Word(w.to_string()));
                }
            }
        }
    }
    out
}

fn ascii_node(t: &[Tok], i: &mut usize) -> Result<Option<Node>> {
    let Some(Tok::Key(name)) = t.get(*i) else { return Ok(None) };
    let mut n = Node { name: name.clone(), ..Default::default() };
    *i += 1;
    let num = |s: &str| -> Prop { if s.contains(['.', 'e', 'E']) { Prop::Float(s.parse().unwrap_or(0.0)) } else { Prop::Int(s.parse().unwrap_or(0)) } };
    let mut array = false;
    loop {
        match t.get(*i) {
            Some(Tok::Star) => {
                array = true;
                *i += 1;
            }
            Some(Tok::Str(s)) => {
                n.props.push(Prop::Str(s.clone()));
                *i += 1;
            }
            Some(Tok::Num(s)) => {
                n.props.push(num(s));
                *i += 1;
            }
            Some(Tok::Word(w)) => {
                n.props.push(Prop::Str(w.clone()));
                *i += 1;
            }
            Some(Tok::Comma) => *i += 1,
            _ => break,
        }
    }
    if t.get(*i) == Some(&Tok::Open) {
        *i += 1;
        while *i < t.len() && t[*i] != Tok::Close {
            match ascii_node(t, i)? {
                Some(c) => {
                    // ( an array's values: "a: 1,2,3" inside the braces )
                    if array && c.name == "a" {
                        let all: Vec<f64> = c.props.iter().map(|p| p.f64()).collect();
                        n.props.push(if c.props.iter().all(|p| matches!(p, Prop::Int(_))) { Prop::Ints(all.iter().map(|&f| f as i64).collect()) } else { Prop::Floats(all) });
                    } else {
                        n.children.push(c);
                    }
                }
                None => *i += 1,
            }
        }
        *i += 1;
    }
    Ok(Some(n))
}
