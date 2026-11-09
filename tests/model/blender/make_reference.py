# The Edit Mode cases ( cases.json ) done in Blender, headless, for the studio's to be checked against ( parity.test.ts ):
#   blender -b --factory-startup --python tests/model/blender/make_reference.py
# Writes reference.json next to this file: each case's mesh, in the studio's coordinates ( Y up: Blender's Z ).

import bmesh, bpy, json, math, mathutils, os, sys

HERE = os.path.dirname( os.path.abspath( __file__ ) )
CASES = json.load( open( os.path.join( HERE, "cases.json" ), encoding="utf-8" ) )["cases"]

# ( the studio's coordinates and Blender's: its Y is Blender's Z )
def to_b( v ): return ( v[0], v[2], v[1] )
def to_s( v ): return [v[0], v[2], v[1]]

def holds( p, where ):
    s = to_s( p )
    for axis, op, val in where:
        x = s["xyz".index( axis )]
        if op == ">" and not x > val: return False
        if op == "<" and not x < val: return False
    return True

def add_prim( name ):
    ops = bpy.ops.mesh
    if name == "plane":     ops.primitive_plane_add( size=2 )
    if name == "cube":      ops.primitive_cube_add( size=2 )
    if name == "circle":    ops.primitive_circle_add( vertices=32, radius=1, fill_type="NOTHING" )
    if name == "uvsphere":  ops.primitive_uv_sphere_add( segments=32, ring_count=16, radius=1 )
    if name == "icosphere": ops.primitive_ico_sphere_add( subdivisions=2, radius=1 )
    if name == "cylinder":  ops.primitive_cylinder_add( vertices=32, radius=1, depth=2 )
    if name == "cone":      ops.primitive_cone_add( vertices=32, radius1=1, radius2=0, depth=2 )
    if name == "torus":     ops.primitive_torus_add()
    if name == "grid":      ops.primitive_grid_add( x_subdivisions=10, y_subdivisions=10, size=2 )
    return bpy.context.active_object

def select( obj, kind, where, add ):
    bm = bmesh.from_edit_mesh( obj.data )
    if not add:
        for e in [*bm.verts, *bm.edges, *bm.faces]: e.select_set( False )
    mode = { "verts": "VERT", "edges": "EDGE", "faces": "FACE" }[kind]
    bpy.context.tool_settings.mesh_select_mode = ( mode == "VERT", mode == "EDGE", mode == "FACE" )
    bm.select_mode = { mode }
    if kind == "verts":
        for v in bm.verts:
            if holds( v.co, where ): v.select_set( True )
    if kind == "edges":
        for e in bm.edges:
            if holds( ( e.verts[0].co + e.verts[1].co ) / 2, where ): e.select_set( True )
    if kind == "faces":
        for f in bm.faces:
            if holds( f.calc_center_median(), where ): f.select_set( True )
    bm.select_flush_mode()
    bmesh.update_edit_mesh( obj.data )

# The transform's settings as a case sets them ( Blender's header ): the pivot, the 3D cursor, proportional editing.
SETTINGS = { "pivot": "median", "prop": None }

def pivots( obj ):
    """Where each part of the selection turns and scales about, as the pivot setting says ( headless, Blender's own
    setting isn't read: each is given to the operator as its centre ): [( vertices, centre )]."""
    bm = bmesh.from_edit_mesh( obj.data )
    sel = [v for v in bm.verts if v.select]
    how = SETTINGS["pivot"]
    mean = lambda vs: sum( ( v.co for v in vs ), mathutils.Vector() ) / max( 1, len( vs ) )
    if how == "individual":
        # each group joined by selected edges, about its own middle
        left, groups = set( sel ), []
        while left:
            todo, grp = [left.pop()], []
            while todo:
                v = todo.pop(); grp.append( v )
                for e in v.link_edges:
                    if e.select:
                        o = e.other_vert( v )
                        if o in left: left.remove( o ); todo.append( o )
            groups.append( grp )
        return [( [v.index for v in g], mean( g ) ) for g in groups]
    if how == "bounds":
        lo = mathutils.Vector( [min( v.co[k] for v in sel ) for k in range( 3 )] ); hi = mathutils.Vector( [max( v.co[k] for v in sel ) for k in range( 3 )] )
        return [( sel, ( lo + hi ) / 2 )]
    if how == "cursor": return [( sel, bpy.context.scene.cursor.location.copy() )]
    if how == "active":
        act = bm.select_history.active
        return [( sel, act.co.copy() if isinstance( act, bmesh.types.BMVert ) else mean( list( act.verts ) ) )]
    return [( sel, mean( sel ) )]

def transform( obj, fn ):
    """A transform done about each pivot ( one at a time for Individual Origins: the rest left out of it )."""
    groups = pivots( obj )
    prop = SETTINGS["prop"]
    extra = { "use_proportional_edit": True, "proportional_edit_falloff": "SMOOTH", "proportional_size": prop } if prop else {}
    for verts, centre in groups:
        if len( groups ) > 1:
            bm = bmesh.from_edit_mesh( obj.data )
            # ( by index: the mesh's own objects don't last past an operator )
            keep = set( verts )
            bm.verts.ensure_lookup_table()
            # ( faces and edges too: in face select, Blender takes the selection from them )
            for x in [*bm.faces, *bm.edges, *bm.verts]: x.select_set( False )
            for x in [*bm.faces, *bm.edges, *bm.verts]:
                if all( v.index in keep for v in ( x.verts if not isinstance( x, bmesh.types.BMVert ) else [x] ) ): x.select_set( True )
            bmesh.update_edit_mesh( obj.data )
        fn( centre, extra )

def step( obj, s ):
    m = bpy.ops.mesh
    if "pivot" in s: SETTINGS["pivot"] = s["pivot"]; return
    if "prop" in s: SETTINGS["prop"] = s["prop"]; return
    if "cursor" in s: bpy.context.scene.cursor.location = to_b( s["cursor"] ); return
    if "active" in s:
        bm = bmesh.from_edit_mesh( obj.data )
        el = next( v for v in bm.verts if holds( v.co, s["where"] ) )
        bm.select_history.add( el ); return
    if "sel" in s: return select( obj, s["sel"], s["where"], False )
    if "add" in s: return select( obj, s["add"], s["where"], True )
    op = s["op"]
    if op == "extrude": m.extrude_region()
    elif op == "move": bpy.ops.transform.translate( value=to_b( s["by"] ) )
    elif op == "inset": m.inset( thickness=s["thickness"], depth=s.get( "depth", 0 ), use_individual=s.get( "individual", False ) )
    elif op == "bevel": m.bevel( offset=s["width"], segments=s["segments"], affect="VERTICES" if s.get( "verts" ) else "EDGES" )
    elif op == "loopcut":
        # ( Loop Cut needs a view to aim with: the same cut is its edge ring subdivided )
        bm = bmesh.from_edit_mesh( obj.data )
        for e in [*bm.verts, *bm.edges, *bm.faces]: e.select_set( False )
        bpy.context.tool_settings.mesh_select_mode = ( False, True, False )
        bm.select_mode = { "EDGE" }
        edge = next( e for e in bm.edges if holds( ( e.verts[0].co + e.verts[1].co ) / 2, s["edge"] ) )
        # its ring: across each quad to the opposite edge, both ways, till it comes round or meets something else
        ring, todo = { edge }, [edge]
        while todo:
            e = todo.pop()
            for f in e.link_faces:
                if len( f.edges ) != 4: continue
                loop = next( l for l in f.loops if l.edge == e )
                o = loop.link_loop_next.link_loop_next.edge
                if o not in ring: ring.add( o ); todo.append( o )
        for e in ring: e.select_set( True )
        bmesh.update_edit_mesh( obj.data )
        m.subdivide( number_cuts=s["cuts"] )
    elif op == "subdivide": m.subdivide( number_cuts=1 )
    elif op == "merge":
        if s["kind"] == "distance": m.remove_doubles( threshold=s.get( "distance", 0.0001 ) )
        else: m.merge( type={ "center": "CENTER", "collapse": "COLLAPSE", "first": "FIRST", "last": "LAST" }[s["kind"]] )
    elif op == "delete":
        k = s["kind"]
        if k == "verts": m.delete( type="VERT" )
        elif k == "edges": m.delete( type="EDGE" )
        elif k == "faces": m.delete( type="FACE" )
        elif k == "onlyFaces": m.delete( type="ONLY_FACE" )
        elif k == "dissolveVerts": m.dissolve_verts()
        elif k == "dissolveEdges": m.dissolve_edges()
        elif k == "dissolveFaces": m.dissolve_faces()
    elif op == "fill": m.edge_face_add()
    elif op == "bridge": m.bridge_edge_loops()
    elif op == "spin": m.spin( steps=s["steps"], angle=math.radians( s["deg"] ), center=to_b( s["center"] ), axis=to_b( s["axis"] ) )
    elif op == "smooth": m.vertices_smooth( factor=s["factor"], repeat=s["repeat"] )
    elif op == "shrinkfatten": bpy.ops.transform.shrink_fatten( value=s["d"] )
    elif op == "flip": m.flip_normals()
    elif op == "recalc": m.normals_make_consistent( inside=False )
    elif op == "duplicate": m.duplicate()
    elif op == "crease":
        bm = bmesh.from_edit_mesh( obj.data )
        layer = bm.edges.layers.float.get( "crease_edge" ) or bm.edges.layers.float.new( "crease_edge" )
        for e in bm.edges:
            if e.select: e[layer] = s["value"]
        bmesh.update_edit_mesh( obj.data )
    # ( typed as a user types them: R and an axis ( Blender's letters ) and degrees, S and a factor, G and metres )
    elif op == "rotate": transform( obj, lambda c, x: bpy.ops.transform.rotate( value=math.radians( s["deg"] ), orient_axis=s["axis"].upper(), orient_type="GLOBAL", center_override=c, **x ) )
    elif op == "scale":
        k = s["by"]; ax = s.get( "axis" )
        v = ( k, k, k ) if not ax else tuple( k if a == ax else 1 for a in "xyz" )
        transform( obj, lambda c, x: bpy.ops.transform.resize( value=v, orient_type="GLOBAL", center_override=c, **( { "constraint_axis": tuple( a == ax for a in "xyz" ) } if ax else {} ), **x ) )
    elif op == "grab":
        ax = s["axis"]; d = s["by"]
        transform( obj, lambda c, x: bpy.ops.transform.translate( value=tuple( d if a == ax else 0 for a in "xyz" ), orient_type="GLOBAL", constraint_axis=tuple( a == ax for a in "xyz" ), **x ) )
    elif op == "uv":
        # ( Blender's defaults, as the U menu gives them )
        if s["kind"] == "reset": bpy.ops.uv.reset()
        elif s["kind"] == "cube": bpy.ops.uv.cube_project()
        elif s["kind"] == "smart": bpy.ops.uv.smart_project()
    elif op == "apply":
        # ( a modifier's Apply: by its place in the list )
        bpy.ops.object.mode_set( mode="OBJECT" )
        bpy.ops.object.modifier_apply( modifier=obj.modifiers[s["index"]].name )
        bpy.ops.object.mode_set( mode="EDIT" )
    elif op == "separate": m.separate( type={ "selection": "SELECTED", "loose": "LOOSE", "material": "MATERIAL" }[s["kind"]] )
    elif op == "materials":
        # ( the faces given a second material slot )
        bpy.ops.object.mode_set( mode="OBJECT" )
        for name in ( "a", "b" ): obj.data.materials.append( bpy.data.materials.new( name ) )
        for poly in obj.data.polygons:
            if holds( obj.data.vertices[poly.vertices[0]].co * 0 + poly.center, s["where"] ): poly.material_index = 1
        bpy.ops.object.mode_set( mode="EDIT" )
    elif op == "selmore": m.select_more( use_face_step=True )
    elif op == "selless": m.select_less( use_face_step=True )
    elif op == "invert": m.select_all( action="INVERT" )
    elif op == "linked": m.select_linked( delimit=set() )
    elif op == "edgeloop": m.select_edge_loop_multi()
    elif op == "edgering": m.select_edge_ring_multi()
    elif op == "path": m.shortest_path_select( use_topology_distance=False )
    elif op == "mode": m.select_mode( type={ "verts": "VERT", "edges": "EDGE", "faces": "FACE" }[s["to"]] )
    elif op == "modifier":
        bpy.ops.object.mode_set( mode="OBJECT" )
        t = s["type"]
        if t == "subsurf":
            md = obj.modifiers.new( "m", "SUBSURF" )
            md.levels = s["levels"]
        elif t == "mirror":
            md = obj.modifiers.new( "m", "MIRROR" )
            md.use_mirror_merge = True
        elif t == "array":
            md = obj.modifiers.new( "m", "ARRAY" )
            md.count = s["count"]
        elif t == "solidify":
            md = obj.modifiers.new( "m", "SOLIDIFY" )
            md.thickness = s["thickness"]
        elif t == "bevel":
            md = obj.modifiers.new( "m", "BEVEL" )
            md.width, md.segments, md.limit_method, md.angle_limit = s["width"], s["segments"], "ANGLE", math.radians( s["angle"] )
        bpy.ops.object.mode_set( mode="EDIT" )
    else:
        raise ValueError( op )

def sel_of( obj ):
    # ( what's selected: vertices where they are, edges by their middles, faces by their centres )
    bm = bmesh.from_edit_mesh( obj.data )
    return {
        "v": [to_s( v.co ) for v in bm.verts if v.select],
        "e": [to_s( ( e.verts[0].co + e.verts[1].co ) / 2 ) for e in bm.edges if e.select],
        "f": [to_s( f.calc_center_median() ) for f in bm.faces if f.select],
    }

def mesh_of( obj ):
    bpy.ops.object.mode_set( mode="OBJECT" )
    dg = bpy.context.evaluated_depsgraph_get()
    me = obj.evaluated_get( dg ).to_mesh()
    out = {
        "v": [to_s( v.co ) for v in me.vertices],
        "f": [list( p.vertices ) for p in me.polygons],
        "e": [list( e.vertices ) for e in me.edges],
    }
    obj.evaluated_get( dg ).to_mesh_clear()
    return out

result = {}
for c in CASES:
    bpy.ops.wm.read_factory_settings( use_empty=True )
    SETTINGS.update( pivot="median", prop=None )
    obj = add_prim( c["prim"] )
    bpy.ops.object.mode_set( mode="EDIT" )
    try:
        for s in c["steps"]: step( obj, s )
        picked = sel_of( obj ) if c.get( "selection" ) else None
        result[c["name"]] = mesh_of( obj )
        if picked is not None: result[c["name"]]["sel"] = picked
        # ( its UVs: each face's corners, where each is and its u, v )
        if c.get( "uv" ):
            bpy.ops.object.mode_set( mode="OBJECT" )
            me, uvl = obj.data, obj.data.uv_layers.active.data
            result[c["name"]]["uv"] = [[[to_s( me.vertices[me.loops[li].vertex_index].co ), list( uvl[li].uv )] for li in p.loop_indices] for p in me.polygons]
        # ( every mesh in the scene after it: a separate's parts, by their counts )
        if c.get( "parts" ):
            bpy.ops.object.mode_set( mode="OBJECT" )
            result[c["name"]]["parts"] = sorted( [len( o.data.vertices ), len( o.data.edges ), len( o.data.polygons )] for o in bpy.context.scene.objects if o.type == "MESH" )
    except Exception as e:
        result[c["name"]] = { "error": str( e ) }
        print( "FAILED", c["name"], e )

json.dump( { "blender": bpy.app.version_string, "cases": result }, open( os.path.join( HERE, "reference.json" ), "w", encoding="utf-8" ) )
print( "wrote", len( result ), "cases" )
