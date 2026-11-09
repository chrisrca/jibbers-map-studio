import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { composeUnity, transformCustom } from "../../src/core/transform";
import type { CustomObjectEntry } from "../../src/core/types";
import { packTrees, treesOf } from "../../src/map/trees";
import { useEditor } from "../../src/map/store";
import { ScatterStroke } from "../../src/viewport/tools/scatter";
import { terrain } from "../../src/terrain/terrain";

const chunk = { key: "a", position: [100, 0, -200] as [number, number, number], size: [400, 300, 400] as [number, number, number] };
const part  = { mesh: "M/Tree_A_01/Tree_A_01_LOD0", local_position: { x: 0, y: 0, z: 0 }, local_rotation: { x: 0, y: 0, z: 0 }, local_scale: { x: 1, y: 1, z: 1 }, materials: [], lod_group_index: -1, lod_index: 0, shadow_casting_mode: 1 };

// trees' bytes, as Map-Tools packs them
function bytes( list: number[][] ) {
  const b = new Uint8Array( list.length * 28 ), d = new DataView( b.buffer );
  list.forEach( ( t, i ) => {
    t.slice( 0, 6 ).forEach( ( v, k ) => d.setFloat32( i * 28 + k * 4, v, true ) );
    b.set( t.slice( 6 ), i * 28 + 24 );
  } );
  return Array.from( b );
}

// ( a library piece, at the origin, plain )
const piece0 = () => ( {
  surface_type: "Generic", can_stabilize: false, can_rotate: false, can_magnetize: false, intended_up_method: 0, disable_distance_culling: false, timed_visibility: false, visible_from_hour: 0, visible_until_hour: 24,
  position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, parts: [part], colliders: [], lod_groups: [], lights: [],
} );

describe( "terrain trees as features and pieces", () => {
  const pines  = bytes( [[0.25, 0.1, 0.5, 1.2, 0.8, 1.5, 255, 200, 100, 255], [0.75, 0.2, 0.9, 1, 1, 0, 10, 20, 30, 40]] );
  const birch  = bytes( [[0.5, 0.5, 0.5, 2, 3, 0.25, 1, 2, 3, 4]] );
  const extras = { a: { treePrototypes: [{ object_id: "", parts: [part], lod_groups: [], colliders: [], instances: pines }, { object_id: "Birch", instances: birch }] } };
  let n        = 0;
  const uid    = () => `u${n++}`;

  it( "the map's own trees pieces, the game's features: where they stand, turned and sized", () => {
    n = 0;
    const t = treesOf( [chunk], extras, uid );
    expect( t.pieces ).toHaveLength( 2 );
    expect( t.objects ).toHaveLength( 1 );
    const p = t.pieces[0];
    expect( [p.position.x, p.position.y, p.position.z] ).toEqual( [expect.closeTo( 200 ), expect.closeTo( 30 ), expect.closeTo( 0 )] );
    expect( p.rotation.y ).toBeCloseTo( ( 1.5 * 180 ) / Math.PI, 4 );
    expect( [p.scale.x, p.scale.y, p.scale.z] ).toEqual( [expect.closeTo( 1.2 ), expect.closeTo( 0.8 ), expect.closeTo( 1.2 )] );
    expect( p.tree?.color ).toEqual( [255, 200, 100, 255] );
    // ( a piece's parts are where they are in the world )
    expect( [p.parts[0].local_position.x, p.parts[0].local_position.z] ).toEqual( [expect.closeTo( 200 ), expect.closeTo( 0 )] );
    // ( the game draws its own trees at half their feature's size )
    expect( t.objects[0].id ).toBe( "Birch" );
    expect( t.objects[0].scale ).toEqual( [1, 1.5, 1] );
    expect( [...t.pieces, ...t.objects].map( ( x ) => x.uid ) ).toEqual( ["u0", "u1", "u2"] );
  } );

  it( "packs them back as they were ( to a float's last bits ), their uids in the order they're read", () => {
    n = 0;
    const t    = treesOf( [chunk], extras, uid );
    const back = packTrees( [chunk], t.objects, t.pieces );
    expect( back.objects ).toEqual( [] );
    expect( back.pieces ).toEqual( [] );
    expect( back.protos.a.map( ( p ) => p.object_id ) ).toEqual( ["Birch", ""] );
    const near = ( got: number[] | null | undefined, want: number[] ) => {
      const g = new DataView( Uint8Array.from( got ?? [] ).buffer ), w = new DataView( Uint8Array.from( want ).buffer );
      expect( g.byteLength ).toBe( w.byteLength );
      for ( let o = 0; o < w.byteLength; o += 28 ) {
        for ( let k = 0; k < 6; k++ ) expect( g.getFloat32( o + k * 4, true ) ).toBeCloseTo( w.getFloat32( o + k * 4, true ), 4 );
        for ( let k = 24; k < 28; k++ ) expect( g.getUint8( o + k ) ).toBe( w.getUint8( o + k ) );
      }
    };
    near( back.protos.a[1].instances, pines );
    near( back.protos.a[0].instances, birch );
    // ( the parts back in the tree's own space: one prototype for both )
    expect( back.protos.a[1].parts?.[0].local_position.x ).toBeCloseTo( 0, 4 );
    const again = treesOf( [chunk], { a: { treePrototypes: back.protos.a } }, ( i ) => back.uids[i] );
    expect( again.pieces.map( ( x ) => x.uid ) ).toEqual( ["u0", "u1"] );
    expect( again.objects.map( ( x ) => x.uid ) ).toEqual( ["u2"] );
  } );

  it( "a tree tipped over, stretched or off the ground's chunks saved as an ordinary piece", () => {
    n = 0;
    const t      = treesOf( [chunk], extras, uid );
    const tipped = { ...t.pieces[0], rotation: { x: 20, y: 0, z: 0 } };
    const far    = { ...t.pieces[1], position: { x: 9000, y: 0, z: 0 } };
    const back   = packTrees( [chunk], t.objects, [tipped, far] );
    expect( back.pieces.map( ( p ) => p.uid ) ).toEqual( ["u0", "u1"] );
    expect( back.pieces.every( ( p ) => !p.tree ) ).toBe( true );
    expect( back.protos.a.map( ( p ) => p.object_id ) ).toEqual( ["Birch"] );
  } );

  it( "moved and turned on the gizmo, still the same kind of tree", () => {
    n = 0;
    const t     = treesOf( [chunk], extras, uid );
    const at    = t.pieces[0].position;
    const about = new THREE.Matrix4().makeTranslation( 12, 0, -7 ).multiply( composeUnity( [at.x, at.y, at.z], [0, 33, 0], [1, 1, 1] ) ).multiply( composeUnity( [at.x, at.y, at.z], [0, 0, 0], [1, 1, 1] ).invert() );
    const back  = packTrees( [chunk], [], [transformCustom( t.pieces[0], about ), t.pieces[1]] );
    expect( back.pieces ).toEqual( [] );
    expect( back.protos.a ).toHaveLength( 1 );
    expect( back.protos.a[0].instances ).toHaveLength( 56 );
  } );

  it( "stretched with a tipped collider, the kind it came as; its look changed, a kind of its own, the change kept", () => {
    n = 0;
    const capsule = { shape: "Capsule" as const, surface_type: "Generic" as const, local_position: { x: 0, y: 3, z: 0.04 }, local_rotation: { x: 4.35874, y: 0, z: 0 }, local_scale: { x: 1, y: 1, z: 1 }, center: { x: 0, y: 0, z: 0 }, size: { x: 0, y: 0, z: 0 }, radius: 1.5, height: 7.16, direction: 1, mesh_ref: "" };
    const tall    = bytes( [[0.25, 0.1, 0.5, 0.7, 1.9, 2.2, 255, 255, 255, 255], [0.3, 0.1, 0.5, 1.4, 0.6, 0.4, 255, 255, 255, 255]] );
    const t       = treesOf( [chunk], { a: { treePrototypes: [{ object_id: "", parts: [part], lod_groups: [], colliders: [capsule], instances: tall }] } }, uid );
    expect( packTrees( [chunk], [], t.pieces ).protos.a ).toHaveLength( 1 );
    const red     = { ...t.pieces[1], parts: t.pieces[1].parts.map( ( q ) => ( { ...q, materials: [{ base_color: [1, 0, 0, 1] }] } ) ) } as unknown as typeof t.pieces[1];
    const back    = packTrees( [chunk], [], [t.pieces[0], red] );
    expect( back.protos.a ).toHaveLength( 2 );
    expect( back.protos.a[1].parts?.[0].materials ).toEqual( [{ base_color: [1, 0, 0, 1] }] );
  } );

  it( "turned all the way over on both other axes, still upright", () => {
    n = 0;
    const t    = treesOf( [chunk], extras, uid );
    const back = packTrees( [chunk], [], [{ ...t.pieces[0], rotation: { x: 180, y: 10, z: -180 } }] );
    expect( back.pieces ).toEqual( [] );
    const again = treesOf( [chunk], { a: { treePrototypes: back.protos.a } }, uid );
    expect( again.pieces[0].rotation.y ).toBeCloseTo( 190, 3 );
  } );

  it( "scattered as terrain trees: saved as one prototype, its LODs kept; opened again, the brush takes them away", () => {
    const lod   = ( i: number ) => ( { ...part, mesh: `Library/pine/LOD${i}`, lod_group_index: 0, lod_index: i } );
    const box   = { shape: "Box" as const, surface_type: "Generic" as const, local_position: { x: 0, y: 2, z: 0 }, local_rotation: { x: 0, y: 0, z: 0 }, local_scale: { x: 1, y: 1, z: 1 }, center: { x: 0, y: 0, z: 0 }, size: { x: 0.6, y: 4, z: 0.6 }, radius: 0, height: 0, direction: 1, mesh_ref: "" };
    const pine  = {
      // ( as My assets keeps a piece: its own settings on, which a terrain tree hasn't )
      surface_type: "Generic", can_stabilize: true, can_rotate: true, can_magnetize: true, intended_up_method: 0, disable_distance_culling: false, timed_visibility: false, visible_from_hour: 0, visible_until_hour: 24,
      position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
      parts: [lod( 0 ), lod( 1 )], colliders: [box], lod_groups: [{ local_position: { x: 0, y: 0, z: 0 }, lods: [{ screen_relative_height: 0.4 }, { screen_relative_height: 0.05 }] }], lights: [],
    } as unknown as Omit<CustomObjectEntry, "uid">;
    const templates = [{ id: "pine", name: "Pine", object: pine }];
    useEditor.setState( { customObjects: [], scatter: { ...useEditor.getState().scatter, instanced: true, scaleJitter: 0.2 } } );
    const stroke = new ScatterStroke( templates, false ) as unknown as { drop: ( t: unknown, at: number[] ) => void; end: () => void };
    stroke.drop( templates[0], [200, 30, 0] );
    stroke.drop( templates[0], [260, 40, 50] );
    stroke.end();
    const pieces = useEditor.getState().customObjects;
    expect( pieces.every( ( o ) => o.tree?.kind && Math.abs( o.rotation.x ) < 1e-6 && Math.abs( o.rotation.z ) < 1e-6 && Math.abs( o.scale.x - o.scale.z ) < 1e-9 ) ).toBe( true );
    const back = packTrees( [chunk], [], pieces );
    expect( back.pieces ).toEqual( [] );
    expect( back.protos.a ).toHaveLength( 1 );
    expect( back.protos.a[0].lod_groups ).toEqual( pine.lod_groups );
    expect( back.protos.a[0].parts?.map( ( q ) => [q.mesh, q.lod_index, q.local_position.x] ) ).toEqual( [["Library/pine/LOD0", 0, 0], ["Library/pine/LOD1", 1, 0]] );
    expect( back.protos.a[0].instances ).toHaveLength( 56 );
    // opened again ( no longer from the library piece ): Ctrl over one takes it away
    const again = treesOf( [chunk], { a: { treePrototypes: back.protos.a } }, ( i ) => back.uids[i] );
    expect( again.pieces[1].position.x ).toBeCloseTo( 260, 3 );
    useEditor.setState( { customObjects: again.pieces } );
    const erase = new ScatterStroke( templates, true );
    erase.dab( 260, 50 );
    erase.end();
    expect( useEditor.getState().customObjects.map( ( o ) => o.position.x ) ).toEqual( [expect.closeTo( 200, 3 )] );
  } );

  it( "Instanced ( on by default ): a piece with a riding surface or set hours is dropped as a piece of its own", () => {
    expect( useEditor.getState().scatter.instanced ).toBe( true );
    const box   = { ...piece0(), surface_type: "Jib" } as unknown as Omit<CustomObjectEntry, "uid">;
    const lamp  = { ...piece0(), timed_visibility: true, visible_from_hour: 18 } as unknown as Omit<CustomObjectEntry, "uid">;
    useEditor.setState( { customObjects: [] } );
    // ( flat ground, for a piece dropped the ordinary way: it leans with it )
    ( terrain as unknown as { normalAt: () => { x: number; y: number; z: number } } ).normalAt = () => ( { x: 0, y: 1, z: 0 } );
    const stroke = new ScatterStroke( [{ id: "box", name: "Box", object: box }, { id: "lamp", name: "Lamp", object: lamp }], false ) as unknown as { drop: ( t: unknown, at: number[] ) => void; end: () => void };
    stroke.drop( { id: "box", name: "Box", object: box }, [200, 30, 0] );
    stroke.drop( { id: "lamp", name: "Lamp", object: lamp }, [210, 30, 0] );
    stroke.end();
    const got = useEditor.getState().customObjects;
    expect( got.map( ( o ) => !!o.tree ) ).toEqual( [false, false] );
    expect( got[0].surface_type ).toBe( "Jib" );
  } );
} );
