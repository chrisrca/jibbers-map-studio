"""One-time extraction of the official Map-Tools placeholder prefabs into the studio library.

Reads Unity's text-serialized prefabs directly (no Unity needed): GameObject/Transform hierarchy,
MeshFilters (built-in primitives or embedded hex meshes) and the root MapObject (id + parameters).
Writes one merged .glb per placeholder plus placeholders.json with ids, parameter schemas and bounds. A lift
(Map-Tools 0.5: chairlift, tbar, ropetow) has no geometry of its own: its base station, top station and mast are
templates switched off in the prefab, written as three .glb and, with the points its cable runs through, under
"lift" in its entry.

Coordinates: Unity is left-handed (+Z forward). Studio (three.js) is right-handed; we map
Unity (x, y, z) -> studio (x, y, -z) and reverse triangle winding. See src/core/coords.ts.

    python extract_placeholders.py <Placeholders dir> <out dir>
"""
import json
import math
import re
import struct
import sys
from pathlib import Path

DOC = re.compile(r"^--- !u!(\d+) &(-?\d+)", re.M)
NUM = r"(-?[\d.]+(?:e-?\d+)?)"


def vec(s, key, n=3):
    m = re.search(rf"{key}: \{{x: {NUM}, y: {NUM}, z: {NUM}" + (rf", w: {NUM}" if n == 4 else ""), s)
    return [float(v) for v in m.groups()] if m else None


def ref(s, key):
    m = re.search(rf"{key}: \{{fileID: (-?\d+)(?:, guid: ([0-9a-f]+))?", s)
    return (int(m.group(1)), m.group(2)) if m else (0, None)


def scalar(s, key, default=None):
    m = re.search(rf"^\s*{key}: (.*)$", s, re.M)
    return m.group(1).strip() if m else default


def parse_docs(text):
    starts = list(DOC.finditer(text))
    docs = {}
    for i, m in enumerate(starts):
        end = starts[i + 1].start() if i + 1 < len(starts) else len(text)
        docs[int(m.group(2))] = (int(m.group(1)), text[m.end():end])
    return docs


# ------------------------------------------------------------------ math (column vectors)

def mat_mul(a, b):
    return [[sum(a[r][k] * b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]


def trs(t, q, s):
    x, y, z, w = q
    r = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    return [[r[i][0] * s[0], r[i][1] * s[1], r[i][2] * s[2], t[i]] for i in range(3)] + [[0, 0, 0, 1]]


def xform(m, p, w=1.0):
    return [m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3] * w for i in range(3)]


def normalize(v):
    l = math.sqrt(sum(c * c for c in v)) or 1.0
    return [c / l for c in v]


def inv_transpose3(m):
    a = [[m[r][c] for c in range(3)] for r in range(3)]
    det = (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
           - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
           + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])) or 1e-12
    cof = [[(a[(r + 1) % 3][(c + 1) % 3] * a[(r + 2) % 3][(c + 2) % 3]
             - a[(r + 1) % 3][(c + 2) % 3] * a[(r + 2) % 3][(c + 1) % 3]) for c in range(3)] for r in range(3)]
    return [[cof[r][c] / det for c in range(3)] for r in range(3)]


# ------------------------------------------------------------------ built-in Unity primitives

def prim_cube():
    pos, nrm, idx = [], [], []
    for axis in range(3):
        for sign in (1, -1):
            n = [0, 0, 0]; n[axis] = sign
            u = [0, 0, 0]; u[(axis + 1) % 3] = 1
            v = [0, 0, 0]; v[(axis + 2) % 3] = 1
            base = len(pos)
            for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                pos.append([0.5 * (n[i] + a * u[i] + b * v[i]) for i in range(3)])
                nrm.append(n)
            quad = [base, base + 1, base + 2, base, base + 2, base + 3]
            # Unity winding is clockwise seen from outside (left-handed); emit CW for front faces.
            if sign > 0:
                quad = [base, base + 2, base + 1, base, base + 3, base + 2]
            idx += quad
    return pos, nrm, idx


def lathe(profile, segs=24):
    """profile: list of (radius, y, nr, ny) from bottom to top; returns CW-from-outside mesh."""
    pos, nrm, idx = [], [], []
    rings = len(profile)
    for (r, y, nr, ny) in profile:
        for s in range(segs + 1):
            a = 2 * math.pi * s / segs
            ca, sa = math.cos(a), math.sin(a)
            pos.append([r * ca, y, r * sa])
            nrm.append(normalize([nr * ca, ny, nr * sa]))
    for i in range(rings - 1):
        for s in range(segs):
            a = i * (segs + 1) + s
            b = a + segs + 1
            idx += [a, a + 1, b, b, a + 1, b + 1]
    return pos, nrm, idx


def prim_sphere(r=0.5, rings=16):
    prof = []
    for i in range(rings + 1):
        t = -math.pi / 2 + math.pi * i / rings
        prof.append((r * math.cos(t), r * math.sin(t), math.cos(t), math.sin(t)))
    return lathe(prof)


def prim_cylinder():
    side = lathe([(0.5, -1, 1, 0), (0.5, 1, 1, 0)])
    pos, nrm, idx = side
    for y, ny in ((-1, -1), (1, 1)):
        c = len(pos)
        pos.append([0, y, 0]); nrm.append([0, ny, 0])
        for s in range(25):
            a = 2 * math.pi * s / 24
            pos.append([0.5 * math.cos(a), y, 0.5 * math.sin(a)]); nrm.append([0, ny, 0])
        for s in range(24):
            tri = [c, c + 1 + s, c + 2 + s]
            idx += tri if ny > 0 else [tri[0], tri[2], tri[1]]
    return pos, nrm, idx


def prim_capsule():
    prof = []
    for i in range(9):
        t = -math.pi / 2 + (math.pi / 2) * i / 8
        prof.append((0.5 * math.cos(t), -0.5 + 0.5 * math.sin(t), math.cos(t), math.sin(t)))
    for i in range(9):
        t = (math.pi / 2) * i / 8
        prof.append((0.5 * math.cos(t), 0.5 + 0.5 * math.sin(t), math.cos(t), math.sin(t)))
    return lathe(prof)


BUILTIN = {10202: prim_cube, 10206: prim_cylinder, 10207: prim_sphere, 10208: prim_capsule}


# ------------------------------------------------------------------ embedded meshes

FMT = {0: ("f", 4), 1: ("e", 2), 2: ("B", 1), 3: ("b", 1), 4: ("H", 2), 5: ("h", 2)}


def embedded_mesh(body):
    vc = int(scalar(body, "m_VertexCount", "0"))
    chans = [tuple(int(x) for x in m) for m in re.findall(
        r"- stream: (\d+)\n\s+offset: (\d+)\n\s+format: (\d+)\n\s+dimension: (\d+)", body)]
    data = bytes.fromhex(scalar(body, "_typelessdata", "") or "")
    ib = bytes.fromhex(scalar(body, "m_IndexBuffer", "") or "")
    idx_fmt = int(scalar(body, "m_IndexFormat", "0"))
    # stream layout: streams stored back-to-back, each 16-byte aligned
    streams = {}
    for (st, off, fmt, dim) in chans:
        if dim == 0:
            continue
        size = FMT[fmt][1] * (dim & 0xF)
        streams[st] = max(streams.get(st, 0), off + size)
    stream_base, cursor = {}, 0
    for st in sorted(streams):
        stream_base[st] = cursor
        cursor += streams[st] * vc
        cursor = (cursor + 15) & ~15

    def channel(i):
        if i >= len(chans) or chans[i][3] == 0:
            return None
        st, off, fmt, dim = chans[i]
        dim &= 0xF
        code, sz = FMT[fmt]
        stride = streams[st]
        out = []
        for v in range(vc):
            p = stream_base[st] + v * stride + off
            out.append(list(struct.unpack_from("<" + code * dim, data, p)))
        return out

    pos, nrm = channel(0), channel(1)
    indices = list(struct.unpack_from("<" + ("I" if idx_fmt else "H") * (len(ib) // (4 if idx_fmt else 2)), ib))
    tris = []
    for sm in re.finditer(r"firstByte: (\d+)\n\s+indexCount: (\d+)\n\s+topology: (\d+)\n\s+baseVertex: (\d+)", body):
        first, count, topo, basev = (int(x) for x in sm.groups())
        if topo != 0:
            continue
        start = first // (4 if idx_fmt else 2)
        tris += [i + basev for i in indices[start:start + count]]
    if nrm is None:
        nrm = [[0, 1, 0]] * len(pos)
    return pos, nrm, tris


# ------------------------------------------------------------------ prefab -> merged mesh

# Map-Tools 0.5 lift scripts (by their .meta guids)
LIFT_SETUP = "8156bba4b24e45c41875ad229a0cb0e0"
LIFT_STATION = "21f83706af323084180f54a37837996f"
LIFT_MAST = "3df6e203ef334124f980ad2912e53265"
CABLE_WHEEL = "d666b7b2068b2d848a8271f443588de5"
CABLE_SLOT = "169a8ae16ecbc4440822fe2764e32d07"


class Prefab:
    """A prefab's objects: transforms (with their children in order), components, renderers."""

    def __init__(self, path):
        self.docs = parse_docs(path.read_text(encoding="utf-8"))
        self.gos = {fid: body for fid, (cls, body) in self.docs.items() if cls == 1}
        self.transforms = {}
        for fid, (cls, body) in self.docs.items():
            if cls == 4:
                self.transforms[ref(body, "m_GameObject")[0]] = dict(
                    fid=fid, father=ref(body, "m_Father")[0],
                    t=vec(body, "m_LocalPosition"), q=vec(body, "m_LocalRotation", 4), s=vec(body, "m_LocalScale"),
                    children=[int(c) for c in re.findall(r"- \{fileID: (-?\d+)\}", body.split("m_Children:", 1)[1].split("m_Father", 1)[0])]
                    if "m_Children:" in body else [])
        self.tf_by_fid = {t["fid"]: (go, t) for go, t in self.transforms.items()}
        self.root_go = next(go for go, t in self.transforms.items() if t["father"] not in self.tf_by_fid)
        self.renderers_enabled = {ref(b, "m_GameObject")[0]: scalar(b, "m_Enabled", "1") == "1"
                                  for (c, b) in self.docs.values() if c == 23}
        # MonoBehaviours: (game object, script guid, body)
        self.monos = [(ref(b, "m_GameObject")[0], ref(b, "m_Script")[1], b, fid) for fid, (c, b) in self.docs.items() if c == 114]

    def active(self, go):
        return scalar(self.gos.get(go, ""), "m_IsActive", "1") == "1"

    def relative(self, go, root):
        """`go`'s transform relative to `root` (whose own TRS is left out), whether it's switched on below it (root
        counts as on), or None when it isn't under root."""
        identity = [[1 if r == c else 0 for c in range(4)] for r in range(4)]
        if go == root:
            return identity, True
        t = self.transforms.get(go)
        if not t or t["father"] not in self.tf_by_fid:
            return None
        up = self.relative(self.tf_by_fid[t["father"]][0], root)
        if up is None:
            return None
        return mat_mul(up[0], trs(t["t"], t["q"], t["s"])), up[1] and self.active(go)

    def mono(self, go, guid):
        return next((b for (g, sg, b, _) in self.monos if g == go and sg == guid), None)

    def go_of_component(self, fid):
        return ref(self.docs[fid][1], "m_GameObject")[0] if fid in self.docs else 0

    def go_of_transform(self, fid):
        return self.tf_by_fid[fid][0] if fid in self.tf_by_fid else 0


def geometry(pf, root):
    """The meshes under `root` merged, relative to it (studio axes)."""
    P, N, I = [], [], []
    for fid, (cls, body) in pf.docs.items():
        if cls != 33:
            continue
        go = ref(body, "m_GameObject")[0]
        if not pf.renderers_enabled.get(go, False):
            continue
        mfid, guid = ref(body, "m_Mesh")
        if guid == "0000000000000000e000000000000000" and mfid in BUILTIN:
            pos, nrm, tri = BUILTIN[mfid]()
        elif mfid in pf.docs and pf.docs[mfid][0] == 43:
            pos, nrm, tri = embedded_mesh(pf.docs[mfid][1])
        else:
            continue
        rel = pf.relative(go, root)
        if rel is None:
            continue
        m, is_active = rel
        if not is_active:
            continue
        # relative to the prefab root (root transform itself is ignored at placement time)
        it = inv_transpose3(m)
        det = sum(m[0][i] * (m[1][(i + 1) % 3] * m[2][(i + 2) % 3] - m[1][(i + 2) % 3] * m[2][(i + 1) % 3]) for i in range(3))
        base = len(P)
        for p, n in zip(pos, nrm):
            wp = xform(m, p)
            wn = normalize([it[r][0] * n[0] + it[r][1] * n[1] + it[r][2] * n[2] for r in range(3)])
            P.append([wp[0], wp[1], -wp[2]])  # Unity -> studio: flip Z
            N.append([wn[0], wn[1], -wn[2]])
        tris = []
        for k in range(0, len(tri) - 2, 3):
            a, b, c = tri[k] + base, tri[k + 1] + base, tri[k + 2] + base
            # Z flip mirrors; negative-scale transforms mirror again
            tris.append((a, b, c) if det < 0 else (a, c, b))
        # Builtin primitives and embedded meshes don't agree on winding, so settle each mesh by its normals:
        # glTF front faces are counter-clockwise, i.e. the face normal points the way the vertex normals do.
        agree = 0
        for a, b, c in tris:
            e1 = [P[b][i] - P[a][i] for i in range(3)]
            e2 = [P[c][i] - P[a][i] for i in range(3)]
            fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
            vn = [N[a][i] + N[b][i] + N[c][i] for i in range(3)]
            agree += 1 if sum(fn[i] * vn[i] for i in range(3)) >= 0 else -1
        for a, b, c in tris:
            I += [a, b, c] if agree >= 0 else [a, c, b]
    return P, N, I


def cable_points(pf, path_go, root):
    """The points a cable runs through under `path_go` (its switched-on children, in order), relative to `root`, in
    Unity axes: a wheel's arc, a slot it may slide along, or a fixed point."""
    out = []
    t = pf.transforms.get(path_go)
    if not t:
        return out
    for cfid in t["children"]:
        go = pf.go_of_transform(cfid)
        if not go or not pf.active(go):
            continue
        m, _ = pf.relative(go, root)
        p = xform(m, [0, 0, 0])
        up = normalize(xform(m, [0, 1, 0], 0.0))
        fwd = normalize(xform(m, [0, 0, 1], 0.0))
        r3 = lambda v: [round(x, 5) for x in v]
        wheel, slot = pf.mono(go, CABLE_WHEEL), pf.mono(go, CABLE_SLOT)
        if wheel is not None:
            out.append(dict(kind="wheel", p=r3(p), up=r3(up), fwd=r3(fwd),
                            radius=float(scalar(wheel, "radius", "0.5")), arc=float(scalar(wheel, "arcDegrees", "180"))))
        elif slot is not None:
            out.append(dict(kind="slot", p=r3(p), up=r3(up), min=float(scalar(slot, "min", "0")), max=float(scalar(slot, "max", "0.5"))))
        else:
            out.append(dict(kind="fixed", p=r3(p)))
    return out


def lift_parts(pf):
    """A lift prefab's base station, top station and mast (if it has masts): their roots and cable points (None for
    anything else)."""
    setup = next((b for (g, sg, b, _) in pf.monos if sg == LIFT_SETUP), None)
    if setup is None:
        return None
    parts = {}
    for key, field, kind in (("base", "baseStation", LIFT_STATION), ("top", "topStation", LIFT_STATION), ("mast", "mastTemplate", LIFT_MAST)):
        go = pf.go_of_component(ref(setup, field)[0])
        comp = pf.mono(go, kind)
        if not go or comp is None:
            # (a rope tow has no masts)
            if key == "mast":
                continue
            return None
        if kind == LIFT_STATION:
            pt = lambda f: (lambda g: (lambda m: [round(x, 5) for x in xform(m, [0, 0, 0])])(pf.relative(g, go)[0]) if g else None)(pf.go_of_transform(ref(comp, f)[0]))
            wheel_go = pf.go_of_transform(ref(comp, "wheelCenter")[0])
            wheel = None
            if wheel_go:
                wm = pf.relative(wheel_go, go)[0]
                wheel = dict(p=[round(x, 5) for x in xform(wm, [0, 0, 0])], up=[round(x, 5) for x in normalize(xform(wm, [0, 1, 0], 0.0))])
            path_go = pf.go_of_transform(ref(comp, "cablePath")[0])
            parts[key] = dict(go=go, cable=dict(inPoint=pt("inPoint"), outPoint=pt("outPoint"), wheel=wheel,
                                                route=cable_points(pf, path_go, go) if path_go else []))
        else:
            parts[key] = dict(go=go, cable=dict(up=cable_points(pf, pf.go_of_transform(ref(comp, "upPath")[0]), go),
                                                down=cable_points(pf, pf.go_of_transform(ref(comp, "downPath")[0]), go)))
    return parts


def extract(prefab_path):
    pf = Prefab(prefab_path)
    P, N, I = geometry(pf, pf.root_go)
    docs, gos, root_go = pf.docs, pf.gos, pf.root_go

    mono = next((b for (c, b) in docs.values() if c == 114 and re.search(r"^\s*id: ", b, re.M)), "")
    params = []
    for pm in re.finditer(
            r"- name: (.*)\n\s+type: (\d+)\n\s+intValue: (-?\d+)\n\s+floatValue: ([-\d.e]+)\n\s+boolValue: (\d)\n"
            r"\s+stringValue: ?(.*)\n\s+optionsString: ?(.*)", mono):
        name, typ, iv, fv, bv, sv, opts = pm.groups()
        typ = int(typ)
        kind = {1: "int", 2: "float", 3: "bool", 4: "string", 5: "selection", 6: "color"}.get(typ, "string")
        # (YAML quotes a string starting with '#')
        default = {"int": int(iv), "float": float(fv), "bool": bv == "1"}.get(kind, sv.strip().strip("'\""))
        p = {"name": name.strip(), "type": kind, "default": default}
        if kind == "selection":
            p["options"] = [o.strip() for o in opts.split(",") if o.strip()]
        params.append(p)
    pid = scalar(mono, "id", prefab_path.stem.replace("_placeholder", ""))
    meta = dict(id=pid, name=scalar(gos[root_go], "m_Name", pid),
                forceUniformScale=scalar(mono, "forceUniformScale", "0") == "1",
                parameters=params)
    lift = lift_parts(pf)
    if lift:
        meta["lift"] = {k: dict(cable=v["cable"], geometry=geometry(pf, v["go"])) for k, v in lift.items()}
    return meta, P, N, I


# ------------------------------------------------------------------ GLB writer

def write_glb(path, P, N, I, name):
    pos = b"".join(struct.pack("<3f", *p) for p in P)
    nrm = b"".join(struct.pack("<3f", *n) for n in N)
    idx = b"".join(struct.pack("<I", i) for i in I)
    bin_ = pos + nrm + idx
    mn = [min(p[i] for p in P) for i in range(3)]
    mx = [max(p[i] for p in P) for i in range(3)]
    gltf = {
        "asset": {"version": "2.0", "generator": "jibbers-studio extract_placeholders"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": name}],
        "meshes": [{"name": name, "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2, "material": 0}]}],
        "materials": [{"name": "placeholder", "pbrMetallicRoughness": {"baseColorFactor": [0.8, 0.8, 0.82, 1], "metallicFactor": 0, "roughnessFactor": 0.7}}],
        "buffers": [{"byteLength": len(bin_)}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos), "byteLength": len(nrm), "target": 34962},
            {"buffer": 0, "byteOffset": len(pos) + len(nrm), "byteLength": len(idx), "target": 34963},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(P), "type": "VEC3", "min": mn, "max": mx},
            {"bufferView": 1, "componentType": 5126, "count": len(N), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5125, "count": len(I), "type": "SCALAR"},
        ],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    bin_ += b"\0" * (-len(bin_) % 4)
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_))
    out += struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(bin_), 0x004E4942) + bin_
    path.write_bytes(out)
    return mn, mx


def main(src, out):
    src, out = Path(src), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    index = []
    for prefab in sorted(src.glob("*_placeholder.prefab")):
        meta, P, N, I = extract(prefab)
        lift = meta.pop("lift", None)
        if lift:
            # (the lift drawn at its object is its base station; its top and masts are placed along it)
            for k, v in lift.items():
                gP, gN, gI = v.pop("geometry")
                mn, mx = write_glb(out / f"{meta['id']}_{k}.glb", gP, gN, gI, f"{meta['id']}_{k}")
                v.update(file=f"{meta['id']}_{k}.glb", boundsMin=mn, boundsMax=mx)
            meta["lift"] = lift
            P, N, I = [], [], []
            b = lift["base"]
            meta.update(file=b["file"], boundsMin=b["boundsMin"], boundsMax=b["boundsMax"], triangles=0)
            index.append(meta)
            print(f"{meta['id']:36s} lift: {'/'.join(lift)}, cable points {sum(len(x) for v in lift.values() for x in v['cable'].values() if isinstance(x, list))}")
            continue
        if not P:
            print(f"!! {prefab.name}: no geometry")
            continue
        mn, mx = write_glb(out / f"{meta['id']}.glb", P, N, I, meta["id"])
        meta.update(file=f"{meta['id']}.glb", boundsMin=mn, boundsMax=mx, triangles=len(I) // 3)
        index.append(meta)
        size = [round(mx[i] - mn[i], 2) for i in range(3)]
        print(f"{meta['id']:36s} tris={len(I)//3:6d} size={size} params={[p['name'] for p in meta['parameters']]}")
    (out / "placeholders.json").write_text(json.dumps(index, indent=1))
    print(f"{len(index)} placeholders")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
