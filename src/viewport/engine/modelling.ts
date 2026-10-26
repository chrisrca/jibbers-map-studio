// The Modelling workspace's operators on whole pieces: Edit Mode in and out, Convert to Model / Mesh, Boolean, Join.

import * as THREE from "three/webgpu";
import { toThree, toUnity, type V3 } from "../../core/coords";
import { composeUnity } from "../../core/transform";
import { arr3, type CustomMaterial, type CustomObjectEntry } from "../../core/types";
import { history } from "../../map/history";
import { useEditor } from "../../map/store";
import { booleanMesh, meshPolys, trisPolys } from "../../model/booleanOps";
import { buildMesh, evaluate, joinMeshes, newModel, type ModelData } from "../../model/build";
import type { BoolOp, Poly } from "../../model/csg";
import { curveMesh, styleOf, type CurveData } from "../../model/curve";
import { gatherTris, partToPiece, trisToMesh, type SourceTris } from "../../model/importMesh";
import type { Mesh } from "../../model/mesh";
import { defaultMaterial, meshKey, withModel } from "../../model/objects";
import { bakeLook, type BakeMaterial } from "../../texture/bake";
import { pieceTexture, prepare, setBakedLook } from "../../texture/meshPaint";
import type { Engine } from "./engine";

// Operators on whole modelled pieces.
export class Modelling {
  constructor( private engine: Engine ) {}

  // For a piece with a mesh and a curve: which Tab went into last ( the next goes into the other ).
  private lastEdit: "mesh" | "curve" = "curve";

  /**
   * Tab: into Edit Mode on the selected modelled piece ( its mesh, or its curve ), or back out.
  **/
  toggleEditMode() {
    const st = useEditor.getState();
    if ( this.engine.editing ) {
      this.engine.editing.exit();
      this.engine.gizmo.sync();
      return;
    }
    const sel = st.selection.find( ( s ) => s.kind === "custom" && st.customObjects.find( ( o ) => o.uid === s.uid )?.model );
    if ( !sel ) {
      // a piece that isn't a model yet: made one, then edited ( Blender edits any mesh )
      const other = st.selection.find( ( s ) => s.kind === "custom" );
      if ( other ) void this.convertToModel( [other.uid] ).then( ( u ) => u?.length && this.toggleEditMode() );
      else st.toast( "No modelled piece selected", "info" );
      return;
    }
    const o = st.customObjects.find( ( x ) => x.uid === sel.uid )!;
    // a piece with both: its curve when it has no mesh, or when its mesh was edited last time round
    const m = o.model!;
    if ( m.curve && ( !m.mesh.f.length || this.lastEdit === "mesh" ) ) {
      this.engine.curveEd.enter( sel.uid );
      this.lastEdit = "curve";
    } else {
      this.engine.modelEd.enter( sel.uid );
      this.lastEdit = "mesh";
    }
    this.engine.gizmo.sync();
  }

  /**
   * Object › Convert to Model: the selected pieces that aren't models ( library pieces, the game's, imports ) become
   * models to edit, their look baked into their paint; one undo step.
  **/
  async convertToModel( uids?: string[] ) {
    const st     = useEditor.getState();
    const pieces = ( uids ?? st.selection.filter( ( s ) => s.kind === "custom" ).map( ( s ) => s.uid ) )
      .map( ( u ) => st.customObjects.find( ( o ) => o.uid === u ) )
      .filter( ( o ): o is CustomObjectEntry => !!o && !o.model && !st.locked[o.uid] && !o.parts.some( ( p ) => p.mesh.startsWith( "Scenery/" ) ) );
    if ( !pieces.length ) return st.toast( "No piece to convert selected", "info" );
    st.setBusy( "Making a model…" );
    await new Promise( ( r ) => requestAnimationFrame( () => requestAnimationFrame( r ) ) );
    try {
      const made: { o: CustomObjectEntry & { model: ModelData }; src: SourceTris; mats: CustomMaterial[] }[] = [];
      for ( const o of pieces ) {
        const root     = composeUnity( arr3( o.position ), arr3( o.rotation ), arr3( o.scale ) );
        const parts    = o.parts.filter( ( p ) => p.lod_index <= 0 && p.mesh );
        const gathered = [], mats: CustomMaterial[] = [];
        for ( const p of parts ) {
          const mesh = await this.engine.customR.sourceMesh( p.mesh );
          if ( !mesh ) continue;
          const slots = Math.max( 1, p.materials.length );
          gathered.push( { mesh, matrix: partToPiece( composeUnity( arr3( p.local_position ), arr3( p.local_rotation ), arr3( p.local_scale ) ), root ), slotBase: mats.length, slots } );
          mats.push( ...( p.materials.length ? p.materials : [defaultMaterial()] ) );
        }
        if ( !gathered.length ) continue;
        const src              = gatherTris( gathered );
        const model: ModelData = { ...newModel( trisToMesh( src ) ), smoothAngle: 50 };
        const part             = { ...parts[0], mesh: meshKey( o.uid ), local_position: o.position, local_rotation: o.rotation, local_scale: o.scale, materials: mats, lod_group_index: -1, lod_index: 0 };
        made.push( { o: withModel( { ...o, parts: [part], lod_groups: [] }, model ) as CustomObjectEntry & { model: ModelData }, src, mats } );
      }
      if ( !made.length ) return st.toast( "Its meshes couldn't be read", "error" );
      // one undo step for the change and the bake together
      const before = useEditor.getState().customObjects;
      const byUid  = new Map( made.map( ( x ) => [x.o.uid, x.o] ) );
      useEditor.setState( { customObjects: before.map( ( o ) => byUid.get( o.uid ) ?? o ), dirty: true } );
      for ( const { o, src, mats } of made ) await this.bakeLookOf( o.uid, src, mats );
      const after = useEditor.getState().customObjects;
      history.push( {
        label: made.length > 1 ? `Convert ${made.length} pieces to models` : "Convert to model",
        undo:  () => useEditor.setState( { customObjects: before, dirty: true } ),
        redo:  () => useEditor.setState( { customObjects: after, dirty: true } ),
      } );
      return made.map( ( x ) => x.o.uid );
    } finally {
      st.setBusy( null );
    }
  }

  /**
   * Object › Boolean ( Blender's Bool Tool, Ctrl − / Ctrl + / Ctrl * ): the last picked piece cut by the others,
   * joined with them or kept where they overlap; the others go. One undo step.
  **/
  async booleanSelected( op: BoolOp ) {
    const st   = useEditor.getState();
    const uids = st.selection.filter( ( s ) => s.kind === "custom" && !st.locked[s.uid] ).map( ( s ) => s.uid );
    if ( uids.length < 2 ) return st.toast( "Select two or more pieces", "info" );
    const target = uids[uids.length - 1];
    if ( !st.customObjects.find( ( o ) => o.uid === target )?.model && !( await this.convertToModel( [target] ) )?.length ) return;
    const now             = useEditor.getState();
    const t               = now.customObjects.find( ( o ) => o.uid === target ) as CustomObjectEntry & { model: ModelData };
    const root            = composeUnity( arr3( t.position ), arr3( t.rotation ), arr3( t.scale ) );
    const slots           = Math.max( 1, t.parts[0].materials.length );
    const cutters: Poly[] = [];
    for ( const uid of uids.slice( 0, -1 ) ) {
      const o = now.customObjects.find( ( x ) => x.uid === uid );
      if ( !o ) continue;
      if ( o.model ) {
        cutters.push( ...meshPolys( evaluate( o.model ), partToPiece( composeUnity( arr3( o.position ), arr3( o.rotation ), arr3( o.scale ) ), root ), slots ) );
        continue;
      }
      const parts = [];
      for ( const p of o.parts.filter( ( x ) => x.lod_index <= 0 && x.mesh ) ) {
        const mesh = await this.engine.customR.sourceMesh( p.mesh );
        if ( mesh ) parts.push( { mesh, matrix: partToPiece( composeUnity( arr3( p.local_position ), arr3( p.local_rotation ), arr3( p.local_scale ) ), root ), slotBase: 0, slots: 1 } );
      }
      cutters.push( ...trisPolys( gatherTris( parts ), slots ) );
    }
    const t0   = performance.now();
    const mesh = booleanMesh( t.model.mesh, cutters, op );
    console.info( `boolean ${op}: ${mesh.f.length} faces in ${( performance.now() - t0 ).toFixed( 0 )} ms` );
    if ( !mesh.f.length && op !== "intersect" ) return now.toast( "Nothing was left", "error" );
    const gone = new Set( uids.slice( 0, -1 ) );
    now.commit( { union: "Boolean union", difference: "Boolean difference", intersect: "Boolean intersect" }[op], {
      customObjects: now.customObjects.filter( ( o ) => !gone.has( o.uid ) ).map( ( o ) => ( o.uid === target ? withModel( o, { ...t.model, mesh } ) : o ) ),
    } );
    useEditor.setState( { selection: [{ kind: "custom", uid: target }] } );
  }

  /**
   * A model about to be painted for the first time, whose materials have textures: they're baked into the paint
   * ( as they lie on it now ), so painting starts from how it looks.
  **/
  async bakeTexturedModel( uid: string ) {
    const o = useEditor.getState().customObjects.find( ( x ) => x.uid === uid );
    if ( !o?.model || pieceTexture( uid ) || !o.parts[0].materials.some( ( m ) => m.base_tex || m.metallic_tex || m.roughness_tex ) ) return;
    const b     = buildMesh( o.model );
    const slots = o.parts[0].materials.length;
    const src   = gatherTris( [{ mesh: b, matrix: new THREE.Matrix4(), slotBase: 0, slots }] );
    await this.bakeLookOf( uid, src, o.parts[0].materials );
  }

  /**
   * A model's paint made from how its triangles looked ( their textures through their materials ).
  **/
  async bakeLookOf( uid: string, src: SourceTris, mats: CustomMaterial[] ) {
    const img                = ( k: string | undefined ) => ( k ? this.engine.customR.sourcePixels( k ) : Promise.resolve( null ) );
    const bm: BakeMaterial[] = await Promise.all(
      mats.map( async ( m ) => ( {
        colour:     [m.base_color.r, m.base_color.g, m.base_color.b] as [number, number, number],
        tex:        await img( m.base_tex ),
        tiling:     [m.tiling.x, m.tiling.y] as [number, number],
        offset:     [m.offset.x, m.offset.y] as [number, number],
        metallic:   m.metallic,
        smoothness: m.smoothness,
        metalTex:   await img( m.metallic_tex as string | undefined ),
        roughTex:   await img( m.roughness_tex as string | undefined ),
      } ) ),
    );
    const o = useEditor.getState().customObjects.find( ( x ) => x.uid === uid );
    if ( !o?.model ) return;
    const piece   = o as CustomObjectEntry & { model: ModelData };
    const { map } = prepare( piece );
    setBakedLook( piece, bakeLook( map, src, bm ) );
  }

  /**
   * Object › Convert to Mesh: the selected curve pieces become mesh pieces ( their tube, to edit as a mesh ).
  **/
  convertToMesh() {
    const st   = useEditor.getState();
    const uids = st.selection.filter( ( s ) => st.customObjects.find( ( o ) => o.uid === s.uid )?.model?.curve ).map( ( s ) => s.uid );
    if ( !uids.length ) return st.toast( "No curve piece selected", "info" );
    st.updateCustom( "Convert to mesh", uids, ( o ) => {
      const { curve, ...model }   = o.model!;
      const mesh                  = joinMeshes( model.mesh, curveMesh( curve! ) );
      const { rail: _r, ...rest } = o;
      return withModel( { ...rest, intended_up_method: o.surface_type === "Jib" ? o.intended_up_method : 0 }, { ...model, mesh } );
    } );
  }

  /**
   * Ctrl+J: the selected modelled pieces joined into the last picked ( curves as their tubes ), one piece.
  **/
  joinSelected() {
    const st     = useEditor.getState();
    const pieces = st.selection.map( ( s ) => st.customObjects.find( ( o ) => o.uid === s.uid ) ).filter( ( o ) => o?.model ) as ( CustomObjectEntry & { model: NonNullable<CustomObjectEntry["model"]> } )[];
    if ( pieces.length < 2 ) return st.toast( "Select two or more modelled pieces", "info" );
    const target    = pieces[pieces.length - 1];
    const Minv      = composeUnity( arr3( target.position ), arr3( target.rotation ), arr3( target.scale ) ).invert();
    const out: Mesh = { v: [], f: [], m: [], s: [], w: [] };
    const materials = [...target.parts[0].materials];
    // curves stay curves ( each spline keeping its own tube ), the target's first: its first spline stays the rail
    let curve: CurveData | undefined;
    for ( const o of [target, ...pieces.slice( 0, -1 )] ) {
      const g    = o.model.mesh;
      const M    = composeUnity( arr3( o.position ), arr3( o.rotation ), arr3( o.scale ) );
      const here = ( p: V3 ): V3 => ( o === target ? p : toUnity( toThree( p ).applyMatrix4( M ).applyMatrix4( Minv ) ) );
      const base = out.v.length, slot0 = o === target ? 0 : materials.length;
      if ( o !== target ) materials.push( ...o.parts[0].materials );
      for ( const p of g.v ) out.v.push( here( p ) );
      g.f.forEach( ( f, fi ) => {
        out.f.push( f.map( ( v ) => v + base ) );
        out.m.push( ( g.m[fi] ?? 0 ) + slot0 );
        out.s.push( g.s[fi] ?? false );
      } );
      for ( const [a, b] of g.w ) out.w.push( [a + base, b + base] );
      const c = o.model.curve;
      if ( c ) {
        const splines = c.splines.map( ( s ) => ( { ...s, style: styleOf( c, s ), points: s.points.map( ( q ) => ( { ...q, p: here( q.p ) } ) ) } ) );
        curve         = curve ? { ...curve, splines: [...curve.splines, ...splines] } : { ...c, splines };
      }
    }
    const gone                    = new Set( pieces.slice( 0, -1 ).map( ( o ) => o.uid ) );
    const { curve: _c, ...model } = target.model;
    const joined                  = withModel( { ...target, parts: [{ ...target.parts[0], materials }, ...target.parts.slice( 1 )] }, { ...model, mesh: out, ...( curve ? { curve } : {} ) } );
    st.commit( "Join", { customObjects: st.customObjects.filter( ( o ) => !gone.has( o.uid ) ).map( ( o ) => ( o.uid === target.uid ? joined : o ) ) } );
    st.setSelection( [{ kind: "custom", uid: target.uid }] );
  }
}
