"""Blender's icons for the Assets workspace, into src/ui/blender/icons.generated.ts.

- Interface icons: Blender's release/datafiles/icons_svg/<name>.svg (white drawn in the theme's text colour).
- Toolbar icons: Blender's release/datafiles/icons/<op>.dat (its "VCO" vector triangles, with their colours), made SVG.

Blender's icons are CC-BY-SA 4.0 (see THIRD_PARTY.md). Run with the folder of Blender's sources (a sparse checkout of
release/datafiles/icons_svg is enough) and a folder of the .dat files (Git LFS: projects.blender.org serves them at
https://projects.blender.org/blender/blender/media/branch/main/release/datafiles/icons/<name>.dat):

    python tools/build_blender_icons.py <blender>/release/datafiles/icons_svg <dat folder>
"""

import json
import os
import re
import sys

UI = """
sculptmode_hlt rightarrow rightarrow_thin filter collection_new copydown pastedown restrict_render_off restrict_render_on mesh_monkey object_origin orientation_cursor smoothcurve hide_off grip file_tick current_file object_datamode editmode_hlt tpaint_hlt vpaint_hlt shading_wire shading_solid shading_texture shading_rendered xray
overlay hide_off hide_on restrict_select_off restrict_select_on modifier material mesh_data object_data vertexsel
edgesel facesel orientation_global orientation_local orientation_normal orientation_view pivot_median
pivot_boundbox pivot_individual pivot_active pivot_cursor snap_off snap_on snap_increment snap_vertex snap_face
prop_off prop_on prop_con mesh_cube mesh_plane mesh_uvsphere mesh_icosphere mesh_cylinder mesh_cone mesh_torus
mesh_grid mesh_circle curve_bezcurve curve_path outliner_ob_mesh outliner_data_mesh outliner_ob_curve view3d physics
properties outliner scene_data world tool_settings outliner_collection gizmo hand zoom_in camera_data view_zoom
view_pan checkbox_hlt checkbox_dehlt add remove x tria_down tria_right tria_up tria_left downarrow_hlt
mod_mirror mod_array mod_solidify mod_bevel mod_subsurf mod_decim mod_boolean triangulate disclosure_tri_down
disclosure_tri_right file_new file_folder filebrowser export import asset_manager texture image brush_data
modifier_on modifier_off shading_bbox snap_edge snap_midpoint pinned unpinned dot lock locked unlocked
select_set select_extend select_subtract select_difference select_intersect axis_front axis_side axis_top cursor
duplicate grid trash view_ortho view_perspective restrict_view_off restrict_view_on object_origin info
""".split()

TOOLS = """
ops.generic.select_box ops.generic.select ops.generic.select_circle ops.generic.select_lasso ops.generic.cursor
ops.transform.translate ops.transform.rotate ops.transform.resize ops.transform.transform
ops.mesh.primitive_cube_add_gizmo ops.mesh.extrude_region_move ops.mesh.inset ops.mesh.bevel ops.mesh.loopcut_slide
ops.mesh.knife_tool ops.mesh.spin ops.mesh.vertices_smooth ops.transform.edge_slide ops.transform.vert_slide
ops.transform.shrink_fatten ops.transform.push_pull ops.transform.shear ops.transform.tosphere ops.mesh.rip
ops.mesh.bisect ops.mesh.extrude_faces_move ops.mesh.offset_edge_loops_slide brush.draw brush.paint_texture.fill
brush.paint_texture.soften brush.paint_texture.smear brush.paint_texture.clone brush.paint_texture.mask
ops.paint.weight_gradient ops.paint.eyedropper_add
""".split()


def svg_inner(path):
    s = open(path, encoding="utf-8").read()
    vb = re.search(r'viewBox="([^"]*)"', s).group(1)
    body = s[s.index(">", s.index("<svg")) + 1 : s.rindex("</svg>")]
    # (a named view with a grid inside closes after it; one without, on itself)
    body = re.sub(r"<sodipodi:namedview[\s\S]*?</sodipodi:namedview>", "", body)
    body = re.sub(r"<sodipodi:namedview[^>]*/>", "", body)
    body = re.sub(r'\s(inkscape|sodipodi):[a-z-]+="[^"]*"', "", body)
    body = re.sub(r"<metadata[\s\S]*?</metadata>", "", body)
    # white is the theme's text colour
    # (some write it without the #)
    body = re.sub(r'(fill|stroke)="#?(fff|ffffff)"', r'\1="currentColor"', body, flags=re.I)
    body = re.sub(r"(fill|stroke):#(fff|ffffff)\b", r"\1:currentColor", body, flags=re.I)
    return vb, re.sub(r"\s+", " ", body).strip()


def tool_svg(path):
    b = open(path, "rb").read()
    assert b[:3] == b"VCO", path
    n = (len(b) - 8) // 18
    co, cl = b[8 : 8 + n * 6], b[8 + n * 6 : 8 + n * 18]
    out = []
    for t in range(n):
        pts = " ".join(f"{co[t * 6 + k * 2]},{255 - co[t * 6 + k * 2 + 1]}" for k in range(3))
        c = [sum(cl[t * 12 + k * 4 + i] for k in range(3)) // 3 for i in range(4)]
        fill = f"#{c[0]:02x}{c[1]:02x}{c[2]:02x}"
        op = "" if c[3] >= 250 else f' fill-opacity="{c[3] / 255:.2f}"'
        # (each triangle a hair larger, so their shared edges don't show as hairlines)
        out.append(f'<polygon points="{pts}" fill="{fill}" stroke="{fill}" stroke-width="0.6"{op}/>')
    return "".join(out)


def main(svg_dir, dat_dir, out):
    ui = {}
    for name in UI:
        p = os.path.join(svg_dir, name + ".svg")
        if os.path.exists(p):
            ui[name] = svg_inner(p)
        else:
            print("no icon", name)
    tools = {}
    for name in TOOLS:
        p = os.path.join(dat_dir, name + ".dat")
        if os.path.exists(p):
            tools[name] = tool_svg(p)
        else:
            print("no tool icon", name)
    with open(out, "w", encoding="utf-8") as f:
        f.write("// Generated by tools/build_blender_icons.py from Blender's icons (CC-BY-SA 4.0, see THIRD_PARTY.md). Don't edit.\n\n")
        f.write("/** interface icons: [viewBox, inner SVG] */\n")
        f.write("export const BL_ICONS: Record<string, [string, string]> = " + json.dumps({k: list(v) for k, v in ui.items()}, indent=0) + ";\n\n")
        f.write("/** toolbar icons (256 × 256), inner SVG */\n")
        f.write("export const BL_TOOL_ICONS: Record<string, string> = " + json.dumps(tools, indent=0) + ";\n")
    print(f"{len(ui)} interface icons, {len(tools)} toolbar icons -> {out}")


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    main(sys.argv[1], sys.argv[2], os.path.join(here, "..", "src", "ui", "blender", "icons.generated.ts"))
