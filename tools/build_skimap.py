"""
Builds public/skimap.bin.gz (bundled into the app): every downhill run, terrain park and ski lift in the world, small enough to ship with the
studio, so the real-mountain import shows a mountain's runs at once and imports them without asking a server.

Source: OpenSkiMap's daily exports of OpenStreetMap ski data (https://openskimap.org, © OpenStreetMap contributors,
ODbL): runs.geojson.gz and lifts.geojson.gz from https://tiles.openskimap.org/geojson/. Cross-country, hiking, sled
and touring trails are left out; of each run only its line (or area), difficulty, glade flag, name and the region's
colour convention are kept.

    python tools/build_skimap.py <folder with runs.geojson.gz and lifts.geojson.gz>

Format (little-endian), read by src/geo/skimap/skimap.ts:
  "JSKI" u32 version  u32 cells  u32 names
  cells x [i16 lon  i16 lat  u32 offset  u32 length]      1-degree cells, by their south-west corner
  names: [varint length, utf-8] each (index 0 = no name)
  cell data at offset: varint count, then per feature
     u8 kind (DIFFICULTY index, 9 = lift)  u8 flags (1 glade, 2 area, 4/8 convention: 0 north america 4 europe 8 japan)
     varint name  varint points  points as zigzag varint deltas in 1e-5 degrees from the cell's corner
A feature belongs to the cell its middle point is in.

Also public/skiareas.json.gz, the operating downhill ski areas (OpenSkiMap's ski_areas.geojson.gz, same folder), for
the map's pins and its search, read by src/geo/skimap/skiareas.ts: a JSON list of
  [name, lon, lat, west, south, east, north, country, region, runs, vertical metres]
the box being where its runs and lifts are (the area's own outline, or a point, when it has none mapped).
"""
import gzip, json, struct, sys, os, collections

DIFFICULTY = ["novice", "easy", "intermediate", "advanced", "expert", "extreme", "freeride", None, "park"]
LIFT = 9
CONVENTION = {"north_america": 0, "europe": 4, "japan": 8}
UNIT = 1e5


def varint(n, out):
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return


def zigzag(n):
    return (n << 1) ^ (n >> 63)


def lines_of(geom):
    t, c = geom["type"], geom["coordinates"]
    if t == "LineString":
        return [(c, False)]
    if t == "MultiLineString":
        return [(l, False) for l in c]
    if t == "Polygon":
        return [(c[0], True)]
    if t == "MultiPolygon":
        return [(p[0], True) for p in c]
    return []


def features(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.strip().rstrip(",")
            if line.startswith('{"type":"Feature"') or line.startswith('{"type": "Feature"'):
                yield json.loads(line)


def main(folder):
    cells = collections.defaultdict(list)
    names = {"": 0}
    def name_index(n):
        n = (n or "").strip()
        if n not in names:
            names[n] = len(names)
        return names[n]

    kept = collections.Counter()
    # where each ski area's runs and lifts are: [west, south, east, north] by OpenSkiMap's ski area id
    reach = {}
    def reach_of(p, pts):
        for a in p.get("skiAreas") or []:
            aid = (a.get("properties") or {}).get("id")
            if not aid:
                continue
            b = reach.setdefault(aid, [180, 90, -180, -90])
            for x, y, *_ in pts:
                b[0], b[1], b[2], b[3] = min(b[0], x), min(b[1], y), max(b[2], x), max(b[3], y)
    for ft in features(os.path.join(folder, "runs.geojson.gz")):
        p = ft["properties"]
        uses = p.get("uses") or []
        if "downhill" in uses:
            d = p.get("difficulty")
            kind = DIFFICULTY.index(d) if d in DIFFICULTY else DIFFICULTY.index(None)
        elif "snow_park" in uses:
            kind = DIFFICULTY.index("park")
        else:
            continue
        flags = (1 if p.get("gladed") or p.get("grooming") == "backcountry" else 0) | CONVENTION.get(p.get("difficultyConvention"), 0)
        for pts, area in lines_of(ft["geometry"]):
            if len(pts) >= 2:
                cells_add(cells, kind, flags | (2 if area else 0), name_index(p.get("name")), pts)
                reach_of(p, pts)
                kept["run"] += 1
    for ft in features(os.path.join(folder, "lifts.geojson.gz")):
        p = ft["properties"]
        for pts, _ in lines_of(ft["geometry"]):
            if len(pts) >= 2:
                cells_add(cells, LIFT, 0, name_index(p.get("name")), pts)
                reach_of(p, pts)
                kept["lift"] += 1

    blobs, index = bytearray(), []
    for (cx, cy), feats in sorted(cells.items()):
        b = bytearray()
        varint(len(feats), b)
        ox, oy = cx * UNIT, cy * UNIT
        for kind, flags, name, pts in feats:
            b.append(kind)
            b.append(flags)
            varint(name, b)
            varint(len(pts), b)
            px, py = ox, oy
            for x, y, *_ in pts:
                qx, qy = round(x * UNIT), round(y * UNIT)
                varint(zigzag(int(qx - px)), b)
                varint(zigzag(int(qy - py)), b)
                px, py = qx, qy
        index.append((cx, cy, len(blobs), len(b)))
        blobs += b

    name_list = sorted(names, key=names.get)
    nb = bytearray()
    for n in name_list:
        e = n.encode("utf-8")
        varint(len(e), nb)
        nb += e
    head = b"JSKI" + struct.pack("<III", 1, len(index), len(name_list))
    table_size = len(index) * 12
    base = len(head) + table_size + len(nb)
    table = b"".join(struct.pack("<hhII", cx, cy, base + off, ln) for cx, cy, off, ln in index)
    data = head + table + nb + blobs
    out = os.path.join(os.path.dirname(__file__), "..", "public", "skimap.bin.gz")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with gzip.open(out, "wb", compresslevel=9) as f:
        f.write(data)
    print(f"{kept['run']} runs, {kept['lift']} lifts in {len(index)} cells, {len(name_list)} names: {len(data) / 1e6:.1f} MB, {os.path.getsize(out) / 1e6:.1f} MB gzipped -> {os.path.abspath(out)}")
    write_areas(folder, reach, os.path.join(os.path.dirname(out), "skiareas.json.gz"))


def write_areas(folder, reach, out):
    with gzip.open(os.path.join(folder, "ski_areas.geojson.gz"), "rt", encoding="utf-8") as f:
        feats = json.load(f)["features"]
    rows = []
    for ft in feats:
        p = ft["properties"]
        if "downhill" not in (p.get("activities") or []) or p.get("status") not in ("operating", None) or not p.get("name"):
            continue
        g = ft["geometry"]
        ring = g["coordinates"] if g["type"] == "Point" else None
        if g["type"] == "Polygon":
            pts = g["coordinates"][0]
        elif g["type"] == "MultiPolygon":
            pts = [q for poly in g["coordinates"] for q in poly[0]]
        else:
            pts = [g["coordinates"]]
        box = reach.get(p["id"])
        if not box or box[0] > box[2]:
            xs, ys = [q[0] for q in pts], [q[1] for q in pts]
            box = [min(xs), min(ys), max(xs), max(ys)]
        # the pin: the middle of its runs (or of its outline)
        lon, lat = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        place = ((p.get("places") or [{}])[0].get("localized") or {}).get("en") or {}
        stats = p.get("statistics") or {}
        downhill = (((stats.get("runs") or {}).get("byActivity") or {}).get("downhill") or {}).get("byDifficulty") or {}
        runs = sum(d.get("count", 0) for d in downhill.values())
        top, bottom = stats.get("maxElevation"), stats.get("minElevation")
        vertical = round(top - bottom) if top is not None and bottom is not None else 0
        r5 = lambda v: round(v, 5)
        rows.append([p["name"], r5(lon), r5(lat), *map(r5, box), place.get("country") or "", place.get("region") or "", runs, vertical])
    rows.sort(key=lambda r: -r[9])
    with gzip.open(out, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump(rows, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(rows)} ski areas -> {os.path.abspath(out)} ({os.path.getsize(out) / 1e3:.0f} kB)")


def cells_add(cells, kind, flags, name, pts):
    mx, my = pts[len(pts) // 2][:2]
    cells[(int(mx // 1), int(my // 1))].append((kind, flags, name, pts))


if __name__ == "__main__":
    main(sys.argv[1])
