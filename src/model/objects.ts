// Modelled pieces in the map: a custom object carrying its model ( model/build.ts ), drawn from it in the viewport and
// written into the map's library at export. Its one part's mesh is "Models/<uid>/mesh" ( a submesh per material
// slot ); its colliders come from its shape ( modelColliders ), convex meshes as "Models/<uid>/c<n>".

import * as THREE from "three";
import { quatToUnityEuler, toThree, toUnity, unityEulerToQuat, type V3 } from "../core/coords";
import { composeUnity } from "../core/transform";
import { arr3, xyz, type CustomCollider, type CustomMaterial, type CustomObjectEntry } from "../core/types";
import { buildMesh, modelColliders, newModel, packBuilt, type ModelData } from "./build";
import { samplePath, styleOf, type CurveData } from "./curve";
import { railColliders, withRail } from "../pieces/rail";
import type { Mesh } from "./mesh";
import { paintAtlas, pieceTexture, putPieceTexture } from "../texture/meshPaint";
import { simplify } from "./simplify";

export const meshKey     = ( uid: string ) => `Models/${uid}/mesh`;
export const lodMeshKey  = ( uid: string, level: number ) => `Models/${uid}/lod${level}`;
export const colliderKey = ( uid: string, n: number ) => `Models/${uid}/c${n}`;
export const isModel     = ( o: CustomObjectEntry ): o is CustomObjectEntry & { model: ModelData } => !!o.model;

/**
 * A piece copied under another uid ( duplicated, pasted ). A modelled piece's meshes, colliders and paint are kept by
 * its uid ( "Models/<uid>/…" ), so they come along under the new one: a copy keeping the old keys drew nothing.
**/
export function copyPiece( o: CustomObjectEntry, uid: string ): CustomObjectEntry {
  const from = `Models/${o.uid}/`, to = `Models/${uid}/`;
  const c    = JSON.parse( JSON.stringify( { ...o, uid } ).split( from ).join( to ) ) as CustomObjectEntry;
  if ( !isModel( c ) ) return c;
  const T = pieceTexture( o.uid );
  if ( T ) putPieceTexture( uid, T.sig, T.n, T.rgba.slice(), Object.fromEntries( Object.entries( T.ch ).map( ( [k, v] ) => [k, v!.slice()] ) ) );
  return withModel( c, c.model );
}

/**
 * A plain material ( Blender's default grey ) for new slots.
**/
export function defaultMaterial(): CustomMaterial {
  return {
    base_tex:    "", metallic_tex: "",  roughness_tex: "", normal_tex: "", emission_tex: "",
    render_mode: 0,  alpha_cutoff: 0.5, tiling:        { x: 1, y: 1 }, offset: { x: 0, y: 0 }, cull_mode: 2,
    base_color:  { r: 0.8, g: 0.8, b: 0.8, a: 1 }, emission_color: { r: 0, g: 0, b: 0, a: 1 },
    metallic:    0, smoothness: 0.3, lit: true, extra_props: {}, keywords: [],
  };
}

/**
 * A new curve piece at `at`: a rail, a pipe, a flat bar ( model/curve.ts ).
**/
export function newCurveObject( uid: string, curve: CurveData, at: V3, jib = true ): CustomObjectEntry {
  const o = newModelObject( uid, { v: [], f: [], m: [], s: [], w: [] }, at, { ...newModel( { v: [], f: [], m: [], s: [], w: [] } ), curve } );
  return withModel( jib ? { ...o, surface_type: "Jib", can_magnetize: true } : o, o.model! );
}

/**
 * A new modelled piece at `at` ( Unity ), from a mesh ( a primitive, usually ).
**/
export function newModelObject( uid: string, mesh: Mesh, at: V3, given?: ModelData ): CustomObjectEntry {
  const model                = given ?? newModel( mesh );
  const o: CustomObjectEntry = {
    uid, surface_type: "Generic", can_stabilize: false, can_rotate: false, can_magnetize: false, intended_up_method: 0,
    disable_distance_culling: false, timed_visibility: false, visible_from_hour: 0, visible_until_hour: 24,
    position: xyz( at ), rotation: xyz( [0, 0, 0] ), scale: xyz( [1, 1, 1] ),
    parts: [{ mesh: meshKey( uid ), local_position: xyz( at ), local_rotation: xyz( [0, 0, 0] ), local_scale: xyz( [1, 1, 1] ), materials: [defaultMaterial()], lod_group_index: -1, lod_index: 0, shadow_casting_mode: 1 }],
    colliders: [], lod_groups: [], lights: [], model,
  };
  return withModel( o, model );
}

/**
 * The piece with a changed model: its part's material slots and its colliders brought in line ( a curve piece's:
 * capsules along each spline, the first its grind rail when it's a jib ).
**/
export function withModel( o: CustomObjectEntry, model: ModelData ): CustomObjectEntry {
  const slots     = Math.max( 1, ...( model.curve ? [0] : model.mesh.m ).map( ( m ) => m + 1 ) );
  const part      = o.parts[0];
  const materials = [...part.materials];
  while ( materials.length < slots ) materials.push( defaultMaterial() );
  // its levels of detail: a part each ( the same place and materials ), all in one group
  const levels             = model.lods?.levels ?? 0;
  const first              = { ...part, mesh: meshKey( o.uid ), materials, lod_group_index: levels ? 0 : -1, lod_index: 0 };
  const parts              = [first, ...Array.from( { length: levels }, ( _, k ) => ( { ...first, mesh: lodMeshKey( o.uid, k + 1 ), lod_index: k + 1 } ) )];
  const next               = { ...o, model, parts, lod_groups: levels ? [lodGroup( model, levels )] : [] };
  const { rail, ...plain } = next;
  if ( model.colliders === "none" ) return { ...plain, colliders: [] };
  // the mesh's own ( a curve's tubes aside: they get capsules )
  const meshPart = { ...model, curve: undefined };
  const own      = model.mesh.f.length ? collidersFor( { ...next, model: meshPart } ) : [];
  if ( !model.curve ) {
    // a jib made from a piece with a rail ( a library rail made a model ) keeps it, its body solid round it
    if ( rail && o.surface_type === "Jib" ) {
      const { parts: _p, whole: _w, body: _b, ...line } = rail;
      return withRail( { ...plain, colliders: own }, line );
    }
    return { ...plain, colliders: own };
  }
  return curveColliders( next as CustomObjectEntry & { model: ModelData }, own );
}

/**
 * A curve's colliders: a chain of capsules along each spline ( as the game's own curved rails are made ), with the
 * mesh's own ( `own` ); on a jib, the first spline is its grind rail and the rest is plain solid ( legs, plates ).
**/
function curveColliders( o: CustomObjectEntry & { model: ModelData }, own: CustomCollider[] ): CustomObjectEntry {
  const c     = o.model.curve!;
  // ( a square tube or a flat bar is boxes along it, as wide and as high as it is )
  const rails = c.splines.map( ( s ) => {
    const st = styleOf( c, s );
    return { points: samplePath( s, Math.min( 8, c.resolution ) ).map( ( q ) => q.p ), radius: st.radius, ...( st.profile === "round" ? {} : { box: [st.radius, st.profile === "flat" ? st.thickness : st.radius] as [number, number] } ) };
  } );
  const jib   = o.surface_type === "Jib";
  const plain = jib ? ( "Generic" as const ) : o.surface_type;
  const caps  = rails.flatMap( ( r, i ) => railColliders( o, r ).map( ( x ) => ( { ...x, surface_type: jib && i === 0 ? ( "Jib" as const ) : plain } ) ) );
  const body  = own.map( ( x ) => ( { ...x, surface_type: plain } ) );
  if ( jib && rails[0]?.points.length >= 2 ) {
    const railed = withRail( { ...o, colliders: [] }, { ...rails[0], solid: false, ...( o.rail?.up ? { up: o.rail.up } : {} ) } );
    return { ...railed, colliders: [...body, ...caps] };
  }
  const { rail: _r, ...rest } = o;
  return { ...rest, colliders: [...body, ...caps] };
}

/**
 * A curve piece's rail as Edit Points shows it: its first spline's own points, not the curve sampled along them.
**/
export function railOfCurve( o: CustomObjectEntry ): CustomObjectEntry {
  const c = o.model?.curve, s = c?.splines[0];
  if ( !c || !s || !o.rail ) return o;
  return { ...o, rail: { ...o.rail, points: s.points.map( ( q ) => [...q.p] as V3 ) } };
}

/**
 * The curve piece with its first spline's points as Edit Points left them ( moved, added, taken away ), and its rail's
 * way up; each point keeps its size and sharpness, a new one is plain.
**/
export function withCurvePoints( o: CustomObjectEntry & { model: ModelData }, points: V3[], up?: V3 ): CustomObjectEntry {
  const c = o.model.curve;
  if ( !c?.splines.length ) return o;
  const old  = c.splines[0].points;
  const same = ( a: V3, b: V3 ) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const next = points.map( ( p, i ) => {
    const was = old.length === points.length ? old[i] : old.find( ( q ) => same( q.p, p ) );
    return { p: [...p] as V3, r: was?.r ?? 1, sharp: was?.sharp ?? false };
  } );
  const curve = { ...c, splines: [{ ...c.splines[0], points: next }, ...c.splines.slice( 1 )] };
  return withModel( o.rail && up ? { ...o, rail: { ...o.rail, up } } : o, { ...o.model, curve } );
}

/**
 * The piece's level-of-detail group, as Unity's LODGroup has it ( on the piece itself ): its size and middle from the
 * shape, and the screen heights each level shows down to ( the last: where it's no longer drawn ); cross-fading
 * ( CustomObjectLit's dither, Map-Tools 0.5 ) over a fifth of each level's range, else switching outright.
**/
function lodGroup( model: ModelData, levels: number ) {
  const b   = builtOf( model );
  const pos = new Float32Array( b.buf, 0, b.n * 3 );
  const lo  = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for ( let i = 0; i < pos.length; i += 3 ) for ( let k = 0; k < 3; k++ ) { lo[k] = Math.min( lo[k], pos[i + k] ); hi[k] = Math.max( hi[k], pos[i + k] ); }
  const ok          = Number.isFinite( lo[0] );
  const transitions = [...Array.from( { length: levels }, ( _, k ) => 0.3 * 0.45 ** k ), 0.004];
  return {
    local_position:        xyz( [0, 0, 0] ),
    local_reference_point: xyz( ok ? ( [0, 1, 2].map( ( k ) => ( lo[k] + hi[k] ) / 2 ) as V3 ) : [0, 0, 0] ),
    size:                  ok ? Math.max( 0.01, ...[0, 1, 2].map( ( k ) => hi[k] - lo[k] ) ) : 1,
    fade_mode:             model.lods?.crossFade ? 1 : 0,
    animate_crossfading:   false,
    transitions,
    fade_widths:           transitions.map( () => ( model.lods?.crossFade ? 0.2 : 0 ) ),
  };
}

/**
 * The colliders the game rides, in world space ( like parts ): from the model's shape, under the piece's transform.
**/
export function collidersFor( o: CustomObjectEntry & { model: ModelData } ): CustomCollider[] {
  const M       = composeUnity( arr3( o.position ), arr3( o.rotation ), arr3( o.scale ) );
  const rot     = unityEulerToQuat( arr3( o.rotation ) );
  const scl     = new THREE.Vector3( ...arr3( o.scale ).map( Math.abs ) );
  const surface = o.surface_type;
  let mesh      = 0;
  return modelColliders( o.model ).map( ( c ): CustomCollider => {
    const base = { surface_type: surface, radius: 0.5, height: 1, direction: 1 };
    if ( c.kind === "convex" ) {
      return {
        ...base, shape: "Mesh", mesh_ref: colliderKey( o.uid, mesh++ ),
        local_position: o.position, local_rotation: o.rotation, local_scale: xyz( arr3( o.scale ).map( Math.abs ) as V3 ),
        center:         xyz( [0, 0, 0] ), size: xyz( [1, 1, 1] ),
      };
    }
    // the box's own turn, as three.js sees it ( Z mirrored on both sides keeps it a rotation )
    const m    = new THREE.Matrix4().makeBasis( toThree( c.axes[0] ), toThree( c.axes[1] ), toThree( c.axes[2] ).negate() );
    const q    = rot.clone().multiply( new THREE.Quaternion().setFromRotationMatrix( m ) );
    // its size under the piece's scale, along its own axes
    const size = c.axes.map( ( a, k ) => 2 * c.half[k] * new THREE.Vector3( ...a ).multiply( scl ).length() ) as V3;
    return {
      ...base, shape: "Box", mesh_ref: "",
      local_position: xyz( toUnity( toThree( c.centre ).applyMatrix4( M ) ) ), local_rotation: xyz( quatToUnityEuler( q ) ), local_scale: xyz( [1, 1, 1] ),
      center:         xyz( [0, 0, 0] ), size: xyz( size ),
    };
  } );
}

// The model as viewport-ready buffers ( the asset cache's layout ), cached per model; a lower level of detail's
// with `level`.
const built = new WeakMap<ModelData, Map<number, { buf: ArrayBuffer; n: number; submeshes: number[]; tris: number }>>();
export function builtOf( model: ModelData, level = 0 ) {
  let byLevel = built.get( model );
  if ( !byLevel ) built.set( model, ( byLevel = new Map() ) );
  let b = byLevel.get( level );
  if ( !b ) {
    const m = levelMesh( model, level );
    byLevel.set( level, ( b = { buf: packBuilt( m ), n: m.pos.length / 3, submeshes: m.submeshes, tris: m.idx.length / 3 } ) );
  }
  return b;
}

/**
 * The model's triangles at a level of detail ( 0: all of them; a painted piece's laid out for its texture ).
**/
export function levelMesh( model: ModelData, level: number ) {
  const full = buildMesh( model, model.paint ? ( g ) => paintAtlas( model, g ) : undefined );
  if ( !level ) return full;
  return simplify( full, ( model.lods?.keep ?? 0.5 ) ** level );
}

// The level of detail each piece shows in the viewport ( Properties' preview ), when not the full one.
export const lodPreview = new Map<string, number>();
