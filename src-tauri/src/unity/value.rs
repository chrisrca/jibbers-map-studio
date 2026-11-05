//! What a Unity object reads as, from a binary file's type tree or a text file's YAML alike: fields in order, lists,
//! numbers and strings, and arrays of plain numbers kept as their bytes (a heightmap is 16 million of them).

/// The kind of number a plain array holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Prim {
    I8,
    U8,
    I16,
    U16,
    I32,
    U32,
    I64,
    U64,
    F32,
    F64,
    Bool,
}

impl Prim {
    pub fn size(self) -> usize {
        match self {
            Prim::I8 | Prim::U8 | Prim::Bool => 1,
            Prim::I16 | Prim::U16 => 2,
            Prim::I32 | Prim::U32 | Prim::F32 => 4,
            Prim::I64 | Prim::U64 | Prim::F64 => 8,
        }
    }

    /// The number at byte `o` of little-endian `b`.
    pub fn read(self, b: &[u8], o: usize) -> f64 {
        let a = |n: usize| -> [u8; 8] {
            let mut x = [0u8; 8];
            x[..n].copy_from_slice(&b[o..o + n]);
            x
        };
        match self {
            Prim::I8 => b[o] as i8 as f64,
            Prim::U8 | Prim::Bool => b[o] as f64,
            Prim::I16 => i16::from_le_bytes([b[o], b[o + 1]]) as f64,
            Prim::U16 => u16::from_le_bytes([b[o], b[o + 1]]) as f64,
            Prim::I32 => i32::from_le_bytes(b[o..o + 4].try_into().unwrap()) as f64,
            Prim::U32 => u32::from_le_bytes(b[o..o + 4].try_into().unwrap()) as f64,
            Prim::I64 => i64::from_le_bytes(a(8)) as f64,
            Prim::U64 => u64::from_le_bytes(a(8)) as f64,
            Prim::F32 => f32::from_le_bytes(b[o..o + 4].try_into().unwrap()) as f64,
            Prim::F64 => f64::from_le_bytes(a(8)),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    /// Raw bytes (TypelessData, a text file's hex string).
    Bytes(Vec<u8>),
    /// A plain array: its numbers' little-endian bytes.
    Prims(Prim, Vec<u8>),
    List(Vec<Value>),
    Map(Vec<(String, Value)>),
}

static NULL: Value = Value::Null;

impl Value {
    /// A field ( Null when there's none, or this isn't a map ).
    pub fn get(&self, key: &str) -> &Value {
        match self {
            Value::Map(m) => m.iter().find(|(k, _)| k == key).map(|(_, v)| v).unwrap_or(&NULL),
            _ => &NULL,
        }
    }

    /// A field down a path of keys ("m_Heightmap.m_Heights").
    pub fn at(&self, path: &str) -> &Value {
        path.split('.').fold(self, |v, k| v.get(k))
    }

    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }

    pub fn f64(&self) -> Option<f64> {
        match self {
            Value::Int(i) => Some(*i as f64),
            Value::Float(f) => Some(*f),
            Value::Bool(b) => Some(*b as i32 as f64),
            Value::Str(s) => s.trim().parse().ok(),
            _ => None,
        }
    }

    pub fn f32(&self) -> f32 {
        self.f64().unwrap_or(0.0) as f32
    }

    pub fn f32_or(&self, d: f32) -> f32 {
        self.f64().map(|v| v as f32).unwrap_or(d)
    }

    pub fn i64(&self) -> i64 {
        match self {
            Value::Int(i) => *i,
            Value::Float(f) => *f as i64,
            Value::Bool(b) => *b as i64,
            Value::Str(s) => s.trim().parse().unwrap_or(0),
            _ => 0,
        }
    }

    pub fn i32(&self) -> i32 {
        self.i64() as i32
    }

    pub fn i32_or(&self, d: i32) -> i32 {
        if self.is_null() { d } else { self.i32() }
    }

    pub fn bool(&self) -> bool {
        self.i64() != 0
    }

    pub fn bool_or(&self, d: bool) -> bool {
        if self.is_null() { d } else { self.bool() }
    }

    pub fn str(&self) -> &str {
        match self {
            Value::Str(s) => s,
            _ => "",
        }
    }

    pub fn list(&self) -> &[Value] {
        match self {
            Value::List(l) => l,
            _ => &[],
        }
    }

    pub fn fields(&self) -> &[(String, Value)] {
        match self {
            Value::Map(m) => m,
            _ => &[],
        }
    }

    /// A Vector2/3/4, Quaternion or Color's parts, by name ( missing ones 0 ).
    pub fn xyz(&self) -> [f32; 3] {
        [self.get("x").f32(), self.get("y").f32(), self.get("z").f32()]
    }

    pub fn xyzw(&self) -> [f32; 4] {
        [self.get("x").f32(), self.get("y").f32(), self.get("z").f32(), self.get("w").f32_or(1.0)]
    }

    pub fn rgba(&self) -> [f32; 4] {
        [self.get("r").f32(), self.get("g").f32(), self.get("b").f32(), self.get("a").f32_or(1.0)]
    }

    /// A reference to another object: its file ( 0 this one ) and id, and the asset's guid when a text file names
    /// it directly.
    pub fn pptr(&self) -> PPtr {
        PPtr {
            file: self.get("m_FileID").i32(),
            path: if self.get("m_PathID").is_null() { self.get("fileID").i64() } else { self.get("m_PathID").i64() },
            guid: self.get("guid").str().to_string(),
        }
    }

    /// The numbers of an array: from its bytes, a list, or a text file's hex string ( `p` the kind they're stored
    /// as there ).
    pub fn numbers(&self, p: Prim) -> Vec<f64> {
        match self {
            Value::Prims(k, b) => (0..b.len() / k.size()).map(|i| k.read(b, i * k.size())).collect(),
            Value::List(l) => l.iter().map(|v| v.f64().unwrap_or(0.0)).collect(),
            Value::Bytes(b) => (0..b.len() / p.size()).map(|i| p.read(b, i * p.size())).collect(),
            Value::Str(s) => {
                let b = hex(s);
                (0..b.len() / p.size()).map(|i| p.read(&b, i * p.size())).collect()
            }
            _ => vec![],
        }
    }

    /// The raw bytes of an array of plain numbers or of TypelessData ( a text file's hex decoded ).
    pub fn bytes(&self) -> Vec<u8> {
        match self {
            Value::Prims(_, b) | Value::Bytes(b) => b.clone(),
            Value::Str(s) => hex(s),
            Value::List(l) => l.iter().map(|v| v.i64() as u8).collect(),
            _ => vec![],
        }
    }
}

/// A reference to an object ( Unity's PPtr ): `file` 0 is the file it's in, else one of its externals; a text file
/// names an asset's `guid` instead.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PPtr {
    pub file: i32,
    pub path: i64,
    pub guid: String,
}

impl PPtr {
    pub fn is_null(&self) -> bool {
        self.path == 0
    }
}

fn hex(s: &str) -> Vec<u8> {
    let s = s.trim().as_bytes();
    let d = |c: u8| match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => 0,
    };
    s.chunks_exact(2).map(|p| d(p[0]) << 4 | d(p[1])).collect()
}
