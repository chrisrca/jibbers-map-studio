import * as THREE from "three/webgpu";
import { describe, expect, it } from "vitest";
import { toUnity } from "../../src/core/coords";
import { composeUnity, transformCustom } from "../../src/core/transform";
import { arr3, type CustomObjectEntry } from "../../src/core/types";
import { recalcOutside } from "../../src/model/mesh";
import { newModel } from "../../src/model/build";
import { isRailCollider, withRail } from "../../src/pieces/rail";
import { withModel } from "../../src/model/objects";
import { FENCE_PRESETS, fenceOf, fenceShape, fenceWorld, isRepeat, newFence, postSpots, scaledSections, sectionFence, turnedSections, withFence, type FenceData, type FenceStyle } from "../../src/pieces/fence";

const style = ( name: string ): FenceStyle => structuredClone( FENCE_PRESETS.find( ( p ) => p.name === name )!.style );

describe( "a fence's posts", () => {
  it( "one at every point, more between so none are further apart than the spacing, spread evenly", () => {
    const s = postSpots( [[0, 0], [10, 0], [10, 3]], false, 4 );
    // ( 10 m: 3 gaps of 3.33; 3 m: 1 gap )
    expect( s.length ).toBe( 5 );
    expect( s[1][0] ).toBeCloseTo( 10 / 3, 5 );
    expect( s[3] ).toEqual( [10, 0] );
    expect( s[4] ).toEqual( [10, 3] );
  } );

  it( "a closed fence goes back to its first post ( no post twice )", () => {
    const s = postSpots( [[0, 0], [4, 0], [4, 4], [0, 4]], true, 5 );
    expect( s.length ).toBe( 4 );
  } );
} );

describe( "a fence's shape over the ground", () => {
  // ground sloping up 0.2 m a metre along X
  const ground = ( x: number ) => 0.2 * x;
  const fence  = ( s: FenceStyle ): FenceData => ( { points: [[0, 0], [9, 0]], closed: false, style: { ...s, spacing: 3 } } );

  it( "posts stand on the ground, sunk into it, as tall as asked", () => {
    const sh = fenceShape( fence( style( "Wooden roadside" ) ), ground );
    expect( sh.posts.map( ( p ) => p.at[1] ) ).toEqual( [0, 0.6000000000000001, 1.2000000000000002, 1.8] );
    const ys  = sh.mesh.v.filter( ( v ) => Math.abs( v[0] - 9 ) < 0.1 ).map( ( v ) => v[1] );
    expect( Math.min( ...ys ) ).toBeCloseTo( 1.8 - 0.3, 5 );
    expect( Math.max( ...ys ) ).toBeGreaterThanOrEqual( 1.8 + 0.95 );
  } );

  it( "rails: one for every height in every gap, following the slope; the top one is the rail", () => {
    const sh    = fenceShape( fence( style( "Wooden roadside" ) ), ground );
    const slots = sh.mesh.m;
    // ( 4 posts of 6 faces, 2 rails × 3 gaps of 6 faces )
    expect( slots.filter( ( m ) => m === 0 ).length ).toBe( 24 );
    expect( slots.filter( ( m ) => m === 1 ).length ).toBe( 36 );
    expect( sh.rail!.length ).toBe( 4 );
    expect( sh.rail![3][1] ).toBeCloseTo( 1.8 + 0.95, 5 );
  } );

  it( "ropes hang lowest mid-way between posts", () => {
    const s   = style( "Rope line" );
    const sh  = fenceShape( { points: [[0, 0], [8, 0]], closed: false, style: { ...s, spacing: 8 } }, () => 0 );
    const mid = sh.rail![4];
    expect( mid[0] ).toBeCloseTo( 4, 5 );
    expect( mid[1] ).toBeCloseTo( 1 - s.infill.sag, 5 );
  } );

  it( "a net: a sheet between each two posts, in its own see-through slot", () => {
    const sh = fenceShape( fence( style( "Safety net" ) ), ground );
    expect( sh.mesh.m.filter( ( m ) => m === 2 ).length ).toBe( 3 );
  } );
} );

describe( "a fence piece", () => {
  const flat = () => 0;

  it( "is grindable by default along its top rail, solid everywhere else", () => {
    const o = withFence( newFence( "f", [0, 0, 0], [[0, 0], [6, 0]] ), flat, () => undefined );
    expect( o.surface_type ).toBe( "Jib" );
    expect( o.rail?.points.length ).toBeGreaterThan( 1 );
    expect( o.colliders.some( ( c ) => c.surface_type === "Jib" ) ).toBe( true );
    expect( o.colliders.some( ( c ) => c.surface_type !== "Jib" ) ).toBe( true );
    expect( o.parts[0].materials.length ).toBe( 3 );
  } );

  it( "not grindable when switched off", () => {
    const f = newFence( "f", [0, 0, 0], [[0, 0], [6, 0]] );
    const o = withFence( { ...f, fence: { ...fenceOf( f )!, style: { ...fenceOf( f )!.style, grind: false } } } as CustomObjectEntry, flat, () => undefined );
    expect( o.surface_type ).toBe( "Generic" );
    expect( o.rail ).toBeUndefined();
  } );

  it( "posts made from one of the map's pieces: its parts and colliders copied to every post, kept through a model change and moved with the fence", () => {
    const post: CustomObjectEntry = {
      ...newFence( "p", [50, 0, 50], [] ), fence: undefined,
      parts:     [{ mesh: "Lib/post", local_position: { x: 50, y: 0.5, z: 50 }, local_rotation: { x: 0, y: 0, z: 0 }, local_scale: { x: 1, y: 1, z: 1 }, materials: [], lod_group_index: -1, lod_index: 0, shadow_casting_mode: 1 }],
      colliders: [{ shape: "Box", surface_type: "Generic", local_position: { x: 50, y: 0.5, z: 50 }, local_rotation: { x: 0, y: 0, z: 0 }, local_scale: { x: 1, y: 1, z: 1 }, center: { x: 0, y: 0, z: 0 }, size: { x: 0.1, y: 1, z: 0.1 }, radius: 0, height: 0, direction: 1, mesh_ref: "" }],
    } as CustomObjectEntry;
    const f   = newFence( "f", [0, 0, 0], [[0, 0], [6, 0]] ), s = fenceOf( f )!;
    const o   = withFence( { ...f, fence: { ...s, style: { ...s.style, spacing: 3, post: { ...s.style.post, kind: "piece", piece: "p" } } } } as CustomObjectEntry, flat, ( uid ) => ( uid === "p" ? post : undefined ) );
    const kit = o.parts.filter( ( p ) => p.mesh === "Lib/post" );
    expect( kit.map( ( p ) => [p.local_position.x, p.local_position.y] ) ).toEqual( [[0, 0.5], [3, 0.5], [6, 0.5]] );
    expect( o.kitColliders?.length ).toBe( 3 );
    // ( a change of its model, as a material edit makes: the copies stay )
    const again = withModel( o, o.model! );
    expect( again.parts.filter( ( p ) => p.mesh === "Lib/post" ).length ).toBe( 3 );
    expect( again.colliders.filter( ( c ) => Math.abs( c.size.y - 1 ) < 1e-6 ).length ).toBe( 3 );
    // ( moved: they go along )
    const moved = transformCustom( again, composeUnity( [10, 0, 0], [0, 0, 0], [1, 1, 1] ).multiply( composeUnity( [0, 0, 0], [0, 0, 0], [1, 1, 1] ).invert() ) );
    expect( arr3( moved.kitColliders![0].local_position )[0] ).toBeCloseTo( 10, 5 );
  } );
} );

describe( "making a fence", () => {
  it( "its posts and rails face out, as the mesh's own outside-finder makes them ( every preset, a bend and a slope )", () => {
    for ( const p of FENCE_PRESETS ) {
      const f: FenceData = { points: [[0, 0], [7, 2], [9, 9], [2, 12]], closed: false, style: structuredClone( p.style ) };
      const m            = fenceShape( f, ( x, z ) => x * 0.2 + z * 0.1 ).mesh;
      // ( the posts' and rails' closed prisms; a net's panels are single open faces, either way )
      const solid        = ( g: typeof m ) => g.f.filter( ( _, k ) => g.m[k] !== 2 );
      expect( solid( m ), p.name ).toEqual( solid( recalcOutside( m ) ) );
    }
  } );

  it( "while a point's being moved: made without colliders or grind rail, then in full", () => {
    const o     = newFence( "f", [0, 0, 0], [[0, 0], [10, 0]], style( "Wooden roadside" ) );
    const quick = withFence( o, () => 0, () => undefined, true ), full = withFence( o, () => 0, () => undefined );
    expect( quick.colliders.length ).toBe( 0 );
    expect( quick.rail ).toBeUndefined();
    expect( full.colliders.length ).toBeGreaterThan( 0 );
    expect( full.rail ).toBeDefined();
    expect( quick.model!.mesh.v ).toEqual( full.model!.mesh.v );
    // ( a fence that had its rail keeps it while it's moved )
    expect( withFence( full, () => 0, () => undefined, true ).rail ).toEqual( full.rail );
  } );
} );

describe( "a fence of your own section", () => {
  // ( a section 2 m long along its own X, 1 m tall: a part at each end; turned 30 degrees, out on the map )
  const end     = ( mesh: string, x: number ) => ( { mesh, local_position: { x, y: 0, z: 0 }, local_rotation: { x: 0, y: 0, z: 0 }, local_scale: { x: 1, y: 1, z: 1 }, materials: [], lod_group_index: -1, lod_index: 0 } );
  const flat    = { ...newFence( "s", [0, 0, 0], [] ), fence: undefined, parts: [end( "A", -1 ), end( "B", 1 )], colliders: [] } as CustomObjectEntry;
  const at      = composeUnity( [20, 5, 10], [0, 30, 0], [1, 1, 1] );
  const piece   = transformCustom( flat, at );
  const local   = new Float32Array( [-1, 0, 0, 1, 0, 0, 0, 1, 0] );
  const ground  = ( x: number, z: number ) => 0.3 * x + 0.1 * z;
  const near    = ( p: { x: number; y: number; z: number }, q: number[] ) => Math.hypot( p.x - q[0], p.y - q[1], p.z - q[2] ) < 1e-3;

  it( "starts as that one section where the piece stood, spaced its length, posts none, riding as the piece did", () => {
    const f = sectionFence( "f", { ...piece, surface_type: "Jib", can_rotate: true } as CustomObjectEntry, local ), d = fenceOf( f )!;
    expect( d.style.spacing ).toBeCloseTo( 2, 5 );
    expect( d.style.infill.length ).toBeCloseTo( 2, 5 );
    expect( d.style.post.kind ).toBe( "none" );
    expect( isRepeat( d ) ).toBe( true );
    expect( [f.surface_type, f.can_rotate] ).toEqual( ["Jib", true] );
    // ( made again over the ground: still as it was set to ride, its rail its own )
    const rail = { points: [[-1, 1, 0], [1, 1, 0]] as [number, number, number][], radius: 0.05 };
    const o    = withFence( { ...f, rail } as CustomObjectEntry, ground, () => undefined );
    expect( o.surface_type ).toBe( "Jib" );
    expect( o.rail?.points ).toEqual( rail.points );
    expect( withFence( { ...f, surface_type: "Generic" } as CustomObjectEntry, ground, () => undefined ).surface_type ).toBe( "Generic" );
    const [a, b] = d.points.map( ( p ) => fenceWorld( f, p ) );
    expect( [a, b].map( ( w ) => w.map( ( v ) => Math.round( v * 1e4 ) / 1e4 ) ) ).toEqual( [toUnity( new THREE.Vector3( -1, 0, 0 ).applyMatrix4( at ) ), toUnity( new THREE.Vector3( 1, 0, 0 ).applyMatrix4( at ) )].map( ( w ) => w.map( ( v ) => Math.round( v * 1e4 ) / 1e4 ) ) );
  } );

  it( "repeated along it: every section from one foot on the ground to the next, up the slope, either way it runs", () => {
    const f  = sectionFence( "f", piece, local ), d = fenceOf( f )!;
    // ( made 6 m long, then turned back on itself: three sections each way )
    for ( const pts of [[d.points[0], [d.points[0][0] + ( d.points[1][0] - d.points[0][0] ) * 3, d.points[0][1] + ( d.points[1][1] - d.points[0][1] ) * 3]], null] ) {
      const run   = pts ?? [d.points[0], [d.points[0][0] - ( d.points[1][0] - d.points[0][0] ) * 3, d.points[0][1] - ( d.points[1][1] - d.points[0][1] ) * 3]];
      const o     = withFence( { ...f, fence: { ...d, points: run } } as CustomObjectEntry, ground, () => undefined );
      const feet  = postSpots( run as [number, number][], false, 2 ).map( ( p ) => { const w = fenceWorld( f, p ); return [w[0], ground( w[0], w[2] ), w[2]]; } );
      const A     = o.parts.filter( ( p ) => p.mesh === "A" ), B = o.parts.filter( ( p ) => p.mesh === "B" );
      expect( feet.length ).toBe( 4 );
      expect( A.length ).toBe( 3 );
      for ( let i = 0; i < 3; i++ ) {
        expect( near( A[i].local_position, feet[i] ), `section ${i}'s start` ).toBe( true );
        expect( near( B[i].local_position, feet[i + 1] ), `section ${i}'s end` ).toBe( true );
      }
    }
  } );
  it( "a point raised or sunk: its sections' ends that far off the ground there, those between it and the next as far along", () => {
    const f = sectionFence( "f", piece, local ), d = fenceOf( f )!;
    const run: [number, number][] = [d.points[0], [d.points[0][0] + ( d.points[1][0] - d.points[0][0] ) * 3, d.points[0][1] + ( d.points[1][1] - d.points[0][1] ) * 3]];
    const o    = withFence( { ...f, fence: { ...d, points: run, lift: [0, -0.6] } } as CustomObjectEntry, ground, () => undefined );
    const feet = postSpots( run, false, 2 ).map( ( p ) => { const w = fenceWorld( f, p ); return [w[0], ground( w[0], w[2] ), w[2]]; } );
    const A    = o.parts.filter( ( p ) => p.mesh === "A" ), B = o.parts.filter( ( p ) => p.mesh === "B" );
    for ( let i = 0; i < 3; i++ ) {
      expect( near( A[i].local_position, [feet[i][0], feet[i][1] - 0.2 * i, feet[i][2]] ), `section ${i}'s start` ).toBe( true );
      expect( near( B[i].local_position, [feet[i + 1][0], feet[i + 1][1] - 0.2 * ( i + 1 ), feet[i + 1][2]] ), `section ${i}'s end` ).toBe( true );
    }
  } );

  it( "its sections turned ( a quarter about the up ): each about its own middle, still one to a gap", () => {
    const f    = sectionFence( "f", flat, local ), d = fenceOf( f )!;
    const q    = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), Math.PI / 2 );
    const run: [number, number][] = [d.points[0], [d.points[0][0] + 4, d.points[0][1]]];
    const o    = withFence( { ...f, fence: { ...turnedSections( d, q ), points: run } } as CustomObjectEntry, () => 0, () => undefined );
    const A    = o.parts.filter( ( p ) => p.mesh === "A" ), B = o.parts.filter( ( p ) => p.mesh === "B" );
    const mids = postSpots( run, false, 2 ).slice( 0, 2 ).map( ( p ) => fenceWorld( f, [p[0] + 1, p[1]] )[0] );
    expect( A.length ).toBe( 2 );
    for ( let i = 0; i < 2; i++ ) {
      // ( across the path now: at the gap's middle along it, a metre either side )
      expect( A[i].local_position.x ).toBeCloseTo( mids[i], 5 );
      expect( B[i].local_position.x ).toBeCloseTo( mids[i], 5 );
      expect( Math.abs( A[i].local_position.z - B[i].local_position.z ) ).toBeCloseTo( 2, 5 );
    }
  } );

  it( "a jib's repeat: its rail the section's, laid along every gap, so it follows a bent path ( not across it )", () => {
    const jib  = { ...piece, surface_type: "Jib", rail: { points: [[-1, 1, 0], [0, 1, 0], [1, 1, 0]], radius: 0.05 } } as CustomObjectEntry;
    const f    = sectionFence( "f", jib, local ), d = fenceOf( f )!;
    expect( d.style.infill.sectionRail?.points.length ).toBe( 3 );
    // ( a V: 6 m one way, 6 m back the other )
    const [x0, z0] = d.points[0];
    const run: [number, number][] = [[x0, z0], [x0 + 6, z0 + 3], [x0, z0 + 6]];
    const o    = withFence( { ...f, fence: { ...d, points: run } } as CustomObjectEntry, () => 0, () => undefined );
    const off  = ( p: number[] ) => Math.min( ...run.slice( 1 ).map( ( b, i ) => {
      const a = run[i], ux = b[0] - a[0], uz = b[1] - a[1], t = Math.max( 0, Math.min( 1, ( ( p[0] - a[0] ) * ux + ( p[2] - a[1] ) * uz ) / ( ux * ux + uz * uz ) ) );
      return Math.hypot( p[0] - a[0] - ux * t, p[2] - a[1] - uz * t );
    } ) );
    expect( o.rail!.points.length ).toBeGreaterThan( 6 );
    for ( const p of o.rail!.points ) {
      expect( off( p ) ).toBeLessThan( 1e-6 );
      // ( the fence's own space: the ground, at 0, is its level below it )
      expect( p[1] + f.position.y ).toBeCloseTo( 1, 5 );
    }
  } );

  it( "a jib's repeat grinds on its rail alone: the copies' own colliders solid round it, as soon as it's made", () => {
    const box  = { shape: "Box" as const, surface_type: "Jib" as const, local_position: { x: 0, y: 0.5, z: 0 }, local_rotation: { x: 0, y: 0, z: 0 }, local_scale: { x: 1, y: 1, z: 1 }, center: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 1, z: 0.5 }, radius: 0, height: 0, direction: 1, mesh_ref: "" };
    const jib  = transformCustom( { ...flat, model: undefined, surface_type: "Jib", colliders: [box], rail: { points: [[-1, 1, 0], [1, 1, 0]], radius: 0.05 } } as CustomObjectEntry, at );
    const f    = sectionFence( "f", jib, local ), d = fenceOf( f )!;
    const run: [number, number][] = [d.points[0], [d.points[0][0] + ( d.points[1][0] - d.points[0][0] ) * 3, d.points[0][1] + ( d.points[1][1] - d.points[0][1] ) * 3]];
    const o    = withFence( { ...f, fence: { ...d, points: run } } as CustomObjectEntry, ground, () => undefined );
    expect( o.rail ).toBeDefined();
    expect( o.colliders.filter( ( c ) => c.surface_type === "Jib" ).every( isRailCollider ) ).toBe( true );
    expect( o.colliders.filter( ( c ) => !isRailCollider( c ) ).length ).toBeGreaterThanOrEqual( 3 );
  } );

  it( "a piece with its rail on ( its own colliders set aside ): the repeat solid with them, not just its rail", () => {
    const box  = { shape: "Box" as const, surface_type: "Jib" as const, local_position: { x: 0, y: 0.5, z: 0 }, local_rotation: { x: 0, y: 0, z: 0 }, local_scale: { x: 1, y: 1, z: 1 }, center: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 1, z: 0.5 }, radius: 0, height: 0, direction: 1, mesh_ref: "" };
    const jib  = withRail( transformCustom( { ...flat, model: undefined, surface_type: "Jib", colliders: [box] } as CustomObjectEntry, at ), { points: [[-1, 1, 0], [1, 1, 0]], radius: 0.05 } );
    expect( jib.colliders.every( isRailCollider ) || jib.colliders.some( ( c ) => c.surface_type === "Generic" ) ).toBe( true );
    const f    = sectionFence( "f", jib, local ), d = fenceOf( f )!;
    expect( d.style.infill.section!.colliders.some( isRailCollider ) ).toBe( false );
    const run: [number, number][] = [d.points[0], [d.points[0][0] + ( d.points[1][0] - d.points[0][0] ) * 3, d.points[0][1] + ( d.points[1][1] - d.points[0][1] ) * 3]];
    const o    = withFence( { ...f, fence: { ...d, points: run } } as CustomObjectEntry, ground, () => undefined );
    expect( o.colliders.filter( ( c ) => !isRailCollider( c ) && c.shape === "Box" ).length ).toBe( 3 );
  } );

  it( "its sections scaled: each about its own middle, longer along the path as well ( fewer of them )", () => {
    const f = sectionFence( "f", flat, local ), d = fenceOf( f )!;
    const k = scaledSections( d, [2, 1.5, 1] );
    expect( k.style.infill.length ).toBeCloseTo( 4, 5 );
    expect( k.style.spacing ).toBeCloseTo( 4, 5 );
    const run: [number, number][] = [d.points[0], [d.points[0][0] + 8, d.points[0][1]]];
    const o = withFence( { ...f, fence: { ...k, points: run } } as CustomObjectEntry, () => 0, () => undefined );
    expect( o.parts.filter( ( p ) => p.mesh === "A" ).length ).toBe( 2 );
  } );

  it( "a section that runs along its own Z, off its origin: turned to run along the fence just the same, from where it stood", () => {
    const zEnd  = ( mesh: string, z: number ) => ( { ...end( mesh, 0 ), local_position: { x: 0, y: 0, z } } );
    const along = transformCustom( { ...flat, parts: [zEnd( "A", 3 ), zEnd( "B", 5 )] } as CustomObjectEntry, at );
    // ( its vertices in its own space, Unity's, as the renderer gives them )
    const f     = sectionFence( "f", along, new Float32Array( [0, 0, 3, 0, 0, 5, 0, 1, 4] ) ), d = fenceOf( f )!;
    const ends  = d.points.map( ( p ) => fenceWorld( f, p ) );
    const stood = [3, 5].map( ( z ) => toUnity( new THREE.Vector3( 0, 0, -z ).applyMatrix4( at ) ) );
    expect( d.style.infill.length ).toBeCloseTo( 2, 5 );
    for ( const e of ends ) expect( stood.some( ( q ) => Math.hypot( e[0] - q[0], e[2] - q[2] ) < 1e-3 ) ).toBe( true );
    const o     = withFence( f, ground, () => undefined );
    const feet  = d.points.map( ( p ) => { const w = fenceWorld( f, p ); return [w[0], ground( w[0], w[2] ), w[2]]; } );
    const parts = o.parts.filter( ( p ) => p.mesh === "A" || p.mesh === "B" );
    expect( parts.length ).toBe( 2 );
    for ( const e of parts ) expect( feet.some( ( q ) => near( e.local_position, q ) ), e.mesh ).toBe( true );
  } );

  it( "a section modelled here: its mesh laid into the fence's own, foot to foot up the slope, in its own materials", () => {
    // ( a bar 2 m long along X, 1 m up; its ends' vertices )
    const bar   = withModel( newFence( "m", [0, 0, 0], [] ), newModel( { v: [[-1, 0, 0], [1, 0, 0], [1, 1, 0], [-1, 1, 0]], f: [[0, 1, 2, 3]], m: [0], s: [false], w: [] } ) );
    const moved = transformCustom( { ...bar, fence: undefined } as CustomObjectEntry, at );
    const f     = sectionFence( "f", moved, new Float32Array( [-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0] ) ), d = fenceOf( f )!;
    const run   = [d.points[0], [d.points[0][0] + ( d.points[1][0] - d.points[0][0] ) * 2, d.points[0][1] + ( d.points[1][1] - d.points[0][1] ) * 2]] as [number, number][];
    const o     = withFence( { ...f, fence: { ...d, points: run } } as CustomObjectEntry, ground, () => undefined );
    const v     = o.model!.mesh.v.map( ( p ) => toUnity( new THREE.Vector3( p[0], p[1], -p[2] ).applyMatrix4( composeUnity( arr3( o.position ), arr3( o.rotation ), arr3( o.scale ) ) ) ) );
    const feet  = postSpots( run, false, 2 ).map( ( p ) => { const w = fenceWorld( f, p ); return [w[0], ground( w[0], w[2] ), w[2]]; } );
    expect( o.parts.some( ( p ) => p.mesh.startsWith( "Models/m/" ) ) ).toBe( false );
    expect( o.parts[0].materials.length ).toBe( 1 );
    expect( o.model!.mesh.m ).toEqual( [0, 0] );
    // ( every foot met by a bottom corner, the middle one by two )
    for ( const [k, q] of feet.entries() ) expect( v.filter( ( p ) => Math.hypot( p[0] - q[0], p[1] - q[1], p[2] - q[2] ) < 1e-3 ).length, `foot ${k}` ).toBe( k === 1 ? 2 : 1 );
  } );

} );
