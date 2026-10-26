"""The layouts of the Unity classes the studio reads from the game's files (src-tauri/src/gamelook/unityfile.rs), for the
game's Unity version: the game ships without them (its type trees are stripped), so they come from UnityPy's tables.

Writes src-tauri/src/gamelook/unity_typetrees.json: {"version": "6000.3.12f1", "classes": {class id: [node...]}}, each node
[level, type, name, byteSize, metaFlag] in file order (a node's children follow it, one level deeper).

Run again (with the game's Unity version, from Jibbers_Data/globalgamemanagers) when the game moves to another one:
    python tools/dump_unity_typetrees.py 6000.3.12f1
"""
import json
import os
import re
import sys

import UnityPy.helpers.Tpk as tpk

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src-tauri", "src", "gamelook", "unity_typetrees.json")
# GameObject, Transform, Material, MeshRenderer, Texture2D, MeshFilter, Mesh, Shader, Light, LODGroup
CLASSES = [1, 4, 21, 23, 28, 33, 43, 48, 104, 108, 115, 141, 205]


def main(version: str):
    m = re.match(r"(\d+)\.(\d+)\.(\d+)[a-z]?(\d+)?", version)
    v = tuple(int(x or 0) for x in m.groups())
    out = {}
    for cid in CLASSES:
        nodes = []

        def walk(n, level):
            nodes.append([level, n.m_Type, n.m_Name, n.m_ByteSize, n.m_MetaFlag or 0])
            for c in n.m_Children or []:
                walk(c, level + 1)

        walk(tpk.get_typetree_node(cid, v), 0)
        out[str(cid)] = nodes
    json.dump({"version": version, "classes": out}, open(OUT, "w"), separators=(",", ":"))
    print(f"{len(out)} classes for {version} -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "6000.3.12f1")
