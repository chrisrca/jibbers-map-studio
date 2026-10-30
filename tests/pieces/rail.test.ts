import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { autoRail, fitParts, insertAt, isRailCollider, keepClear, railColliders, railPath, recoverRail, unityEuler, withRail, withoutRail, type P3 } from "../../src/pieces/rail";
import { transformCustom } from "../../src/core/transform";
import { xyz, type CustomCollider, type CustomObjectEntry, type Rail } from "../../src/core/types";

/**
 * Points on a tube of radius `r` around `centre( t )`, t in 0..1, plus extra points ( legs ).
**/
function tube( centre: ( t: number ) => P3, r: number, extra: P3[] = [] ): Float32Array {
  const out: number[] = [];
  const steps         = 160, ring = 16;
  for ( let i = 0; i <= steps; i++ ) {
    const t     = i / steps;
    const c     = new THREE.Vector3( ...centre( t ) );
    const ahead = new THREE.Vector3( ...centre( Math.min( 1, t + 1e-3 ) ) ).sub( new THREE.Vector3( ...centre( Math.max( 0, t - 1e-3 ) ) ) ).normalize();
    const side  = new THREE.Vector3().crossVectors( ahead, new THREE.Vector3( 0, 1, 0 ) ).normalize();
    const up    = new THREE.Vector3().crossVectors( side,  ahead                        ).normalize();
    for ( let k = 0; k < ring; k++ ) {
      const a = ( k / ring ) * Math.PI * 2;
      const p = c.clone().addScaledVector( side, Math.cos( a ) * r ).addScaledVector( up, Math.sin( a ) * r );
      out.push( p.x, p.y, p.z );
    }
  }
  for ( const p of extra ) out.push( ...p );
  return new Float32Array( out );
}

const piece = ( o: Partial<CustomObjectEntry> = {} ): CustomObjectEntry => ( {
  uid:                      "p",   surface_type:     "Jib", can_stabilize:     true, can_rotate:         true, can_magnetize: true, intended_up_method: 0,
  disable_distance_culling: false, timed_visibility: false, visible_from_hour: 19,   visible_until_hour: 6,
  position:  { x: 10, y: 2, z: -4 }, rotation: { x: 0, y: 30, z: 0 }, scale: { x: 2, y: 2, z: 2 },
  parts:     [], lights: [], lod_groups: [],
  colliders: [{ shape: "Mesh", surface_type: "Jib", local_position: { x: 10, y: 2, z: -4 }, local_rotation: { x: 0, y: 30, z: 0 }, local_scale: { x: 2, y: 2, z: 2 }, center: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 }, radius: 0.5, height: 1, direction: 1, mesh_ref: "Features/c_rail/0" }],
  ...o,
} );

describe( "autoRail", () => {
  it( "follows a C-shaped rail on legs, off the piece's centre", () => {
    // a C bulging 0.4 to the side, its middle 0.4 away from the origin ( the piece's "centre point" )
    const centre     = ( t: number ): P3 => { const x = -1.8 + 3.6 * t; return [x, 0, 0.4 - 0.4 * ( 1 - ( x / 1.8 ) ** 2 )]; };
    const legs: P3[] = [];
    for ( let y = -0.6; y < -0.05; y += 0.05 ) legs.push( [-1.8, y, 0.4], [1.8, y, 0.4], [-1.8, y, 0.42], [1.8, y, 0.42] );
    const { rail } = autoRail( tube( centre, 0.05, legs ) );
    expect( rail         ).not.toBeNull();
    expect( rail!.radius ).toBeGreaterThan( 0.035 );
    expect( rail!.radius ).toBeLessThan( 0.065 );
    // the top of the rail ( where it's ridden ) is the tube's top, and it follows the C across
    for ( const p of rail!.points ) {
      const want = centre( ( p[0] + 1.8 ) / 3.6 );
      expect( Math.abs( p[1] + rail!.radius - ( want[1] + 0.05 ) ) ).toBeLessThan( 0.01 );
      expect( Math.abs( p[2] - want[2] )                           ).toBeLessThan( 0.02 );
    }
    expect( rail!.points[0][0]                       ).toBeLessThan( -1.7 );
    expect( rail!.points[rail!.points.length - 1][0] ).toBeGreaterThan( 1.7 );
  } );

  it( "makes a straight tube two points", () => {
    const { rail } = autoRail( tube( ( t ) => [0, 0.3, -1.3 + 2.6 * t], 0.125 ) );
    expect( rail!.points.length ).toBe( 2 );
    expect( rail!.points[0][1]  ).toBeCloseTo( 0.3, 1 );
    expect( rail!.radius        ).toBeGreaterThan( 0.1 );
    expect( rail!.radius        ).toBeLessThan( 0.15 );
  } );

  it( "makes a box's rail as wide as its top", () => {
    // a 0.44 wide, 0.85 tall, 4.6 long box: points over its faces
    const pts: number[] = [];
    for ( let z = -2.3; z <= 2.3; z += 0.05 ) {
      for ( let x = -0.22;  x <= 0.2201; x += 0.02 ) pts.push( x,     0.425, z, x,    -0.425, z );
      for ( let y = -0.425; y <= 0.4251; y += 0.02 ) pts.push( -0.22, y,     z, 0.22, y,      z );
    }
    const { rail } = autoRail( new Float32Array( pts ) );
    expect( rail!.radius                      ).toBeGreaterThan( 0.19 );
    expect( rail!.radius                      ).toBeLessThan( 0.25 );
    expect( rail!.points[0][1] + rail!.radius ).toBeCloseTo( 0.425, 2 );
  } );

  it( "won't guess at a spiral", () => {
    const { rail, why } = autoRail( tube( ( t ) => [Math.cos( t * Math.PI * 3 ) * 1.4, 3 - 3 * t, Math.sin( t * Math.PI * 3 ) * 1.4], 0.1 ) );
    expect( rail ).toBeNull();
    expect( why  ).toMatch( /doubles back/ );
    expect( autoRail( tube( ( t ) => [Math.cos( t * Math.PI * 3 ) * 1.4, 3 - 3 * t, Math.sin( t * Math.PI * 3 ) * 1.4], 0.1 ) ).radius ).toBeGreaterThan( 0.05 );
  } );
} );

/**
 * Triangles ( 9 numbers each ) of a tube from a to b, radius r: its side.
**/
function cylinder( a: P3, b: P3, r: number, sides = 12 ): number[] {
  const A             = new THREE.Vector3( ...a ), B = new THREE.Vector3( ...b );
  const axis          = B.clone().sub( A ).normalize();
  const u             = new THREE.Vector3().crossVectors( axis, Math.abs( axis.y ) < 0.9 ? new THREE.Vector3( 0, 1, 0 ) : new THREE.Vector3( 1, 0, 0 ) ).normalize();
  const w             = new THREE.Vector3().crossVectors( axis, u );
  const ring          = ( c: THREE.Vector3, k: number ) => c.clone().addScaledVector( u, Math.cos( ( k / sides ) * Math.PI * 2 ) * r ).addScaledVector( w, Math.sin( ( k / sides ) * Math.PI * 2 ) * r );
  const out: number[] = [];
  for ( let k = 0; k < sides; k++ ) {
    const p = [ring( A, k ), ring( A, k + 1 ), ring( B, k + 1 ), ring( B, k )];
    for ( const [i, j, l] of [[0, 1, 2], [0, 2, 3]] ) out.push( ...p[i].toArray(), ...p[j].toArray(), ...p[l].toArray() );
  }
  return out;
}
/**
 * Triangles of a flat panel from corner a along u and v.
**/
function panel( a: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3 ): number[] {
  const p = [a, a.clone().add( u ), a.clone().add( u ).add( v ), a.clone().add( v )];
  return [0, 1, 2, 0, 2, 3].flatMap( ( i ) => p[i].toArray() );
}
/**
 * A collider's turn ( Unity Euler: Y, then X, then Z ).
**/
function turn( c: { local_rotation: { x: number; y: number; z: number } } ) {
  const d = THREE.MathUtils.DEG2RAD;
  return new THREE.Matrix4().makeRotationY( c.local_rotation.y * d ).multiply( new THREE.Matrix4().makeRotationX( c.local_rotation.x * d ) ).multiply( new THREE.Matrix4().makeRotationZ( c.local_rotation.z * d ) );
}
/**
 * Whether `p` is inside collider `c` ( piece coordinates ).
**/
function inside( c: CustomCollider, p: THREE.Vector3 ) {
  const l = p.clone().sub( new THREE.Vector3( c.local_position.x, c.local_position.y, c.local_position.z ) ).applyMatrix4( turn( c ).transpose() );
  if ( c.shape === "Box" ) return Math.abs( l.x ) <= c.size.x / 2 && Math.abs( l.y ) <= c.size.y / 2 && Math.abs( l.z ) <= c.size.z / 2;
  const h = Math.max( 0, c.height / 2 - c.radius );
  return Math.hypot( l.x, l.y - THREE.MathUtils.clamp( l.y, -h, h ), l.z ) <= c.radius;
}
/**
 * How many points every 5 cm along the top of a rail ( where a rider lands on it ) are inside one of `cols`.
**/
function railTopsIn( cols: CustomCollider[], rail: Rail ): number {
  const path = railPath( rail );
  let n      = 0;
  for ( let i = 1; i < path.length; i++ ) {
    const steps = Math.max( 1, Math.ceil( path[i].distanceTo( path[i - 1] ) / 0.05 ) );
    for ( let k = i === 1 ? 0 : 1; k <= steps; k++ ) {
      const top = path[i - 1].clone().lerp( path[i], k / steps ).add( new THREE.Vector3( 0, rail.radius + 0.012, 0 ) );
      if ( cols.some( ( c ) => inside( c, top ) ) ) n++;
    }
  }
  return n;
}
/**
 * Where a fitted collider's local Y points ( Unity Euler: Y, then X, then Z ).
**/
function yAxis( c: { local_rotation: { x: number; y: number; z: number } } ) {
  const d = THREE.MathUtils.DEG2RAD;
  const m = new THREE.Matrix4().makeRotationY( c.local_rotation.y * d ).multiply( new THREE.Matrix4().makeRotationX( c.local_rotation.x * d ) ).multiply( new THREE.Matrix4().makeRotationZ( c.local_rotation.z * d ) );
  return new THREE.Vector3().setFromMatrixColumn( m, 1 );
}

describe( "colliders fitted to the visible parts", () => {
  it( "make a fence's posts solid, each its own capsule, with nothing between them", () => {
    const tris = [...cylinder( [-2, 1, 0], [2, 1, 0], 0.05 )];
    for ( const x of [-1.5, 0, 1.5] ) tris.push( ...cylinder( [x, 0, 0], [x, 0.95, 0], 0.04 ) );
    const { parts } = fitParts( new Float32Array( tris ), { points: [[-2, 1, 0], [2, 1, 0]], radius: 0.05 } );
    expect( parts.length ).toBe( 3 );
    for ( const c of parts ) {
      expect( c.shape                  ).toBe( "Capsule" );
      expect( Math.abs( yAxis( c ).y ) ).toBeGreaterThan( 0.95 );
      expect( c.radius                 ).toBeGreaterThan( 0.03 );
      expect( c.radius                 ).toBeLessThan( 0.05 );
    }
    expect( parts.map( ( c ) => c.local_position.x ).sort( ( a, b ) => a - b ).map( ( x ) => Math.round( x * 10 ) / 10 ) ).toEqual( [-1.5, 0, 1.5] );
  } );

  it( "follow a curved wall panel by panel, nothing across the curve", () => {
    const curve          = ( t: number ) => new THREE.Vector3( -2 + 4 * t, 0, 1.2 * ( 1 - ( 2 * t - 1 ) ** 2 ) );
    const tris: number[] = [];
    for ( let k = 0; k < 8; k++ ) {
      const a = curve( k / 8 ), b = curve( ( k + 1 ) / 8 );
      tris.push( ...panel( a, b.clone().sub( a ), new THREE.Vector3( 0, 0.8, 0 ) ) );
    }
    const { parts } = fitParts( new Float32Array( tris ), { points: [[-2, 0.85, 0], [0, 0.85, 1.2], [2, 0.85, 0]], radius: 0.04 } );
    expect( parts.length ).toBeGreaterThanOrEqual( 6 );
    for ( const c of parts ) {
      // each sits on the wall, not out in the middle of the C
      const t = ( c.local_position.x + 2 ) / 4;
      expect( Math.abs( c.local_position.z - curve( t ).z ) ).toBeLessThan( 0.08 );
      expect( Math.min( c.size.x, c.size.y, c.size.z )      ).toBeLessThan( 0.15 );
    }
  } );

  it( "keep a box's own collider: one convex shape, which the game fits exactly", () => {
    const tris: number[] = [];
    const s              = [0.22, 0.425, 2.3];
    for ( const [ax, sign] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]] as const ) {
      const [u, v] = [0, 1, 2].filter( ( i ) => i !== ax );
      const o      = new THREE.Vector3(), du = new THREE.Vector3(), dv = new THREE.Vector3();
      o.setComponent( ax, sign * s[ax] ).setComponent( u, -s[u] ).setComponent( v, -s[v] );
      du.setComponent( u, 2 * s[u] );
      dv.setComponent( v, 2 * s[v] );
      tris.push( ...panel( o, du, dv ) );
    }
    expect( fitParts( new Float32Array( tris ), { points: [[0, 0.21, -2.3], [0, 0.21, 2.3]], radius: 0.21 } ) ).toEqual( { parts: [], whole: true } );
  } );

  it( "keep a hump with no bottom whole too (shrink-wrapped, its open bottom closes flat)", () => {
    // an arched top over a flat footprint, its bottom left open, as game models sitting on the ground often are
    const top            = ( x: number ) => 0.3 + 0.4 * ( 1 - x * x );
    const tris: number[] = [];
    for ( let k = 0; k < 8; k++ ) {
      const x0 = -1 + k / 4, x1 = -1 + ( k + 1 ) / 4;
      tris.push( ...panel( new THREE.Vector3( x0, top( x0 ), -0.5 ), new THREE.Vector3( x1 - x0, top( x1 ) - top( x0 ), 0 ), new THREE.Vector3( 0, 0, 1 ) ) ); // top
      for ( const z of [-0.5, 0.5] ) {
        tris.push( x0, 0, z, x1, 0, z, x1, top( x1 ), z, x0, 0, z, x1, top( x1 ), z, x0, top( x0 ), z ); // sides
      }
    }
    for ( const x of [-1, 1] ) tris.push( ...panel( new THREE.Vector3( x, 0, -0.5 ), new THREE.Vector3( 0, top( x ), 0 ), new THREE.Vector3( 0, 0, 1 ) ) ); // ends
    expect( fitParts( new Float32Array( tris ), { points: [[-1, 0.3, 0], [0, 0.7, 0], [1, 0.3, 0]], radius: 0.3 } ).whole ).toBe( true );
  } );

  it( "give a square bar a box, not a capsule", () => {
    const tris: number[] = [];
    const s              = [0.05, 0.05, 1];
    for ( const [ax, sign] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]] as const ) {
      const [u, v] = [0, 1, 2].filter( ( i ) => i !== ax );
      const o      = new THREE.Vector3(), du = new THREE.Vector3(), dv = new THREE.Vector3();
      o.setComponent( ax, sign * s[ax] ).setComponent( u, -s[u] ).setComponent( v, -s[v] );
      du.setComponent( u, 2 * s[u] );
      dv.setComponent( v, 2 * s[v] );
      tris.push( ...panel( o, du, dv ) );
    }
    // two bars, so it's not one convex shape
    const two       = [...tris, ...tris.map( ( x, i ) => ( i % 3 === 0 ? x + 1 : x ) )];
    const { parts } = fitParts( new Float32Array( two ), { points: [[0, 2, 0], [1, 2, 0]], radius: 0.05 } );
    expect( parts.map( ( c ) => c.shape ) ).toEqual( ["Box", "Box"] );
  } );

  it( "keep out of the top of the rail, so a rider lands on the rail (and is grabbed by it), not on them", () => {
    // a thick tube that is the rail, on two posts reaching into it: the tube is the rail's, the posts stay
    const tubed = [...cylinder( [-2, 1, 0], [2, 1, 0], 0.28 )];
    for ( const x of [-1.5, 1.5] ) tubed.push( ...cylinder( [x, 0, 0], [x, 0.75, 0], 0.05 ) );
    const thick: Rail = { points: [[-2, 1, 0], [2, 1, 0]], radius: 0.28 };
    const posts       = fitParts( new Float32Array( tubed ), thick ).parts;
    expect( posts.map( ( c ) => c.shape ) ).toEqual( ["Capsule", "Capsule"] );
    expect( railTopsIn( posts, thick )    ).toBe( 0 );
    // a panel rising past a thin rail ( a wave's crest ), and a post off to one side
    const waved      = [...panel( new THREE.Vector3( -2, 0, 0 ), new THREE.Vector3( 4, 0, 0 ), new THREE.Vector3( 0, 1.15, 0 ) ), ...cylinder( [0, 0, 1], [0, 0.9, 1], 0.04 )];
    const thin: Rail = { points: [[-2, 1, 0], [2, 1, 0]], radius: 0.03 };
    const parts      = fitParts( new Float32Array( waved ), thin ).parts;
    expect( parts.length              ).toBe( 2 );
    expect( railTopsIn( parts, thin ) ).toBe( 0 );
    const wall = parts.find( ( c ) => c.shape === "Box" )!;
    expect( wall.local_position.y + wall.size.y / 2 ).toBeCloseTo( 1, 2 ); // up to the rail's middle
    expect( wall.local_position.y - wall.size.y / 2 ).toBeCloseTo( 0, 2 );
  } );

  it( "follow a wavy rail down in steps, the panel under it still solid", () => {
    // a panel up to the underside of a rail waving 25 cm up and down
    const y              = ( x: number ) => 1 + 0.25 * Math.cos( Math.PI * x );
    const rail: Rail     = { points: Array.from( { length: 9 }, ( _, i ): P3 => [-2 + i / 2, y( -2 + i / 2 ), 0] ), radius: 0.05 };
    const tris: number[] = [];
    for ( let i = 0; i < 32; i++ ) {
      const x0 = -2 + i / 8, x1 = x0 + 1 / 8;
      tris.push( x0, 0, 0, x1, 0, 0, x1, y( x1 ) - 0.05, 0, x0, 0, 0, x1, y( x1 ) - 0.05, 0, x0, y( x0 ) - 0.05, 0 );
    }
    // and a post off to one side ( so it's not one convex shape )
    tris.push( ...cylinder( [0, 0, 1], [0, 0.9, 1], 0.04 ) );
    const parts = fitParts( new Float32Array( tris ), rail ).parts.filter( ( c ) => c.shape === "Box" );
    expect( railTopsIn( parts, rail ) ).toBe( 0 );
    expect( parts.length              ).toBeLessThanOrEqual( 32 );
    // all of it but the top few centimetres under the rail
    let under = 0, solid = 0;
    for ( let x = -1.975; x < 2; x += 0.05 ) {
      for ( let h = 0.025; h < y( x ) - 0.05 - 0.12; h += 0.05 ) {
        under++;
        if ( parts.some( ( c ) => inside( c, new THREE.Vector3( x, h, 0 ) ) ) ) solid++;
      }
    }
    expect( solid / under ).toBeGreaterThan( 0.97 );
  } );

  it( "keep parts fitted before out of the top of the rail too, wherever it's moved", () => {
    // turned 30° about Y: a panel's box rising past the rail and a post up through it, as fitted before
    const c                   = Math.cos( Math.PI / 6 ), s = Math.sin( Math.PI / 6 );
    const run                 = new THREE.Vector3( c, 0, s ), up = new THREE.Vector3( 0, 1, 0 );
    const across              = new THREE.Vector3().crossVectors( run, up );
    const box: CustomCollider = {
      shape:       "Box", surface_type: "Generic", local_position: xyz( [0, 0.6, 0] ), local_rotation: xyz( unityEuler( run, up, across ) ),
      local_scale: xyz( [1, 1, 1] ), center: xyz( [0, 0, 0] ), size: xyz( [4, 1.2, 0.04] ), radius: 0.5, height: 1, direction: 1, mesh_ref: "studio-part",
    };
    const side                 = new THREE.Vector3().crossVectors( up, run );
    const post: CustomCollider = {
      ...box, shape: "Capsule", local_position: xyz( [run.x, 0.65, run.z] ), local_rotation: xyz( unityEuler( new THREE.Vector3().crossVectors( up, side ), up, side ) ),
      size: xyz( [0, 0, 0] ), radius: 0.04, height: 1.3,
    };
    const rail: Rail = { points: [[-2 * c, 1, -2 * s], [2 * c, 1, 2 * s]], radius: 0.03 };
    const at0        = piece( { position: xyz( [0, 0, 0] ), rotation: xyz( [0, 0, 0] ), scale: xyz( [1, 1, 1] ) } );
    const o          = withRail( at0, { ...rail, parts: [box, post] } );
    const fitted     = o.colliders.filter( ( x ) => x.mesh_ref === "studio-part" );
    expect( fitted.map( ( x ) => x.shape )                    ).toEqual( ["Box", "Capsule"] );
    expect( railTopsIn( [box, post], rail )                   ).toBeGreaterThan( 10 );
    expect( railTopsIn( fitted, rail )                        ).toBe( 0 );
    expect( fitted[0].local_position.y + fitted[0].size.y / 2 ).toBeCloseTo( 1, 2 );
    expect( fitted[1].local_position.y + fitted[1].height / 2 ).toBeCloseTo( 1, 2 );
    // as fitted, in the rail: moved up, the panel's all there again under it
    expect( o.rail!.parts ).toEqual( [box, post] );
    const higher: Rail = { ...rail, points: rail.points.map( ( p ) => [p[0], 1.5, p[2]] as P3 ) };
    const moved        = withRail( o, higher ).colliders.filter( ( x ) => x.mesh_ref === "studio-part" );
    expect( moved[0].size.y                  ).toBeCloseTo( 1.2, 5 );
    expect( keepClear( [box, post], higher ) ).toEqual( [box, post] );
  } );
} );

describe( "rail colliders", () => {
  it( "are capsules along the rail, Y along it and Z up, placed with the piece", () => {
    const rail = { points: [[-1, 0, 0], [0, 0.2, 0.5], [1, 0, 0]] as P3[], radius: 0.05 };
    const o    = piece();
    const caps = railColliders( o, rail );
    expect( caps.length ).toBeGreaterThan( 4 );
    const deg = THREE.MathUtils.DEG2RAD;
    for ( const c of caps ) {
      expect( c.shape     ).toBe( "Capsule" );
      expect( c.direction ).toBe( 1         );
      // world rotation, back to its axes ( Unity: Y, then X, then Z ): the up axis ( Z ) points mostly up
      const { x, y, z } = c.local_rotation;
      const m           = new THREE.Matrix4().makeRotationY( y * deg ).multiply( new THREE.Matrix4().makeRotationX( x * deg ) ).multiply( new THREE.Matrix4().makeRotationZ( z * deg ) );
      const zAxis       = new THREE.Vector3().setFromMatrixColumn( m, 2 );
      expect( zAxis.y         ).toBeGreaterThan( 0.8 );
      expect( c.local_scale.x ).toBeCloseTo( 2, 5 );
    }
  } );

  it( "are boxes along a box rail, end to end, its width across and its height up", () => {
    const o     = piece( { position: xyz( [0, 0, 0] ), rotation: xyz( [0, 0, 0] ), scale: xyz( [1, 1, 1] ) } );
    const boxes = railColliders( o, { points: [[-1, 0, 0], [0, 0, 0], [1, 0, 0]], radius: 0.05, box: [0.08, 0.02] } );
    expect( boxes.length                                         ).toBeGreaterThan( 2 );
    expect( boxes.every( ( c ) => c.shape === "Box" )            ).toBe( true );
    expect( boxes.every( ( c ) => c.mesh_ref === "studio-rail" ) ).toBe( true );
    for ( const c of boxes ) {
      expect( c.size.x ).toBeCloseTo( 2 * ( 0.08 + 0.012 ), 5 );
      expect( c.size.z ).toBeCloseTo( 2 * ( 0.02 + 0.012 ), 5 );
    }
    // ( lying along X, Y along the rail: its ends are where the rail's are, square, not rounded off short )
    const ends = boxes.flatMap( ( c ) => [c.local_position.x - c.size.y / 2, c.local_position.x + c.size.y / 2] );
    expect( Math.min( ...ends ) ).toBeCloseTo( -1, 4 );
    expect( Math.max( ...ends ) ).toBeCloseTo( 1,  4 );
    // ( no gaps between them )
    const sorted = [...boxes].sort( ( a, b ) => a.local_position.x - b.local_position.x );
    for ( let i = 1; i < sorted.length; i++ ) expect( sorted[i].local_position.x - sorted[i].size.y / 2 ).toBeLessThan( sorted[i - 1].local_position.x + sorted[i - 1].size.y / 2 );
  } );

  it( "keep a box rail's boxes through a change of thickness, and turn back into capsules", () => {
    const railed = withRail( piece(), { points: [[-1, 0, 0], [1, 0, 0]], radius: 0.05, box: [0.05, 0.05] } );
    expect( railed.rail!.box ).toEqual( [0.05, 0.05] );
    expect( railed.colliders.filter( isRailCollider ).every( ( c ) => c.shape === "Box" ) ).toBe( true );
    const { box: _b, ...line } = railed.rail!;
    const round                = withRail( railed, line );
    expect( round.rail!.box ).toBeUndefined();
    expect( round.colliders.filter( isRailCollider ).every( ( c ) => c.shape === "Capsule" ) ).toBe( true );
  } );

  it( "unityEuler turns back into the same axes", () => {
    const deg = THREE.MathUtils.DEG2RAD;
    for ( const [ax, ay, az] of [[0.3, 1.1, -0.4], [Math.PI / 2, 0.7, 0], [-Math.PI / 2, -2, 0], [0.01, 3, 2]] ) {
      const m         = new THREE.Matrix4().makeRotationY( ay ).multiply( new THREE.Matrix4().makeRotationX( ax ) ).multiply( new THREE.Matrix4().makeRotationZ( az ) );
      const [x, y, z] = [0, 1, 2].map( ( i ) => new THREE.Vector3().setFromMatrixColumn( m, i ) );
      const e         = unityEuler( x, y, z );
      const back      = new THREE.Matrix4().makeRotationY( e[1] * deg ).multiply( new THREE.Matrix4().makeRotationX( e[0] * deg ) ).multiply( new THREE.Matrix4().makeRotationZ( e[2] * deg ) );
      for ( let i = 0; i < 16; i++ ) expect( back.elements[i] ).toBeCloseTo( m.elements[i], 5 );
    }
  } );

  it( "set the piece's own collider aside (the game would shrink-wrap it into a slab), and give it back", () => {
    const o      = piece();
    const railed = withRail( o, { points: [[-1, 0, 0], [1, 0, 0]], radius: 0.05, solid: false } );
    expect( railed.intended_up_method                ).toBe( 4    );
    expect( railed.colliders.every( isRailCollider ) ).toBe( true );
    expect( railed.rail!.body                        ).toEqual( o.colliders );
    // moved with the piece while it's set aside
    const moved = transformCustom( railed, new THREE.Matrix4().makeTranslation( 5, 0, 0 ) );
    expect( moved.rail!.body![0].local_position.x ).toBeCloseTo( o.colliders[0].local_position.x + 5, 4 );
    const back = withoutRail( railed );
    expect( back.rail               ).toBeUndefined();
    expect( back.intended_up_method ).toBe( 0 );
    expect( back.colliders          ).toEqual( o.colliders );
  } );

  it( "keep the piece's own collider, as plain solid, by default", () => {
    const railed = withRail( piece(), { points: [[-1, 0, 0], [1, 0, 0]], radius: 0.05 } );
    expect( railed.rail!.solid ).toBe( true );
    expect( railed.colliders.filter( ( c ) => !isRailCollider( c ) ).map( ( c ) => c.surface_type ) ).toEqual( ["Generic"] );
    expect( withoutRail( railed ).colliders[0].surface_type                                         ).toBe( "Jib" );
  } );

  it( "never make a capsule with no straight part (the game's physics refuses it, and you fall through the map)", () => {
    for ( const points of [
      [[0, 0, 0], [1,    0,   0  ], [1.02, 0.01, 0]],            // a tiny last stretch
      [[0, 0, 0], [0.03, 0,   0  ]],                             // a rail shorter than it is thick
      [[0, 0, 0], [0.5,  0.3, 0.2], [0.5, 0.3, 0.2], [1, 0, 0]], // two points on top of each other
    ] as P3[][] ) {
      const caps = railColliders( piece(), { points, radius: 0.09 } );
      expect( caps.length ).toBeGreaterThan( 0 );
      for ( const c of caps ) expect( c.height - 2 * c.radius ).toBeGreaterThan( 0.009 );
    }
  } );

  it( "get a rail back from its capsules when saving had dropped it (and the piece's own collider with it)", () => {
    const o                            = piece( { parts: [{ mesh: "Features/c_rail/0", local_position: { x: 10, y: 2, z: -4 }, local_rotation: { x: 0, y: 30, z: 0 }, local_scale: { x: -2, y: 2, z: 2 }, materials: [], lod_group_index: -1, lod_index: 0 } as never] } );
    const made                         = withRail( o, { points: [[-1, 0, 0], [0, 0.2, 0.6], [1, 0, 0]], radius: 0.05, solid: false } );
    // what a save used to leave: the capsules, no rail, no body
    const { rail: _dropped, ...saved } = made;
    const back                         = recoverRail( saved as CustomObjectEntry )!;
    expect( back.rail!.radius        ).toBeCloseTo( 0.05, 3 );
    expect( back.rail!.points.length ).toBeGreaterThanOrEqual( 3 );
    for ( const [want, got] of [[made.rail!.points[0], back.rail!.points[0]], [made.rail!.points[2], back.rail!.points[back.rail!.points.length - 1]]] ) {
      for ( let k = 0; k < 3; k++ ) expect( got[k] ).toBeCloseTo( want[k], 2 );
    }
    // its own collider is back: one mesh collider for its part, positive scale, kept solid
    const body = back.colliders.filter( ( c ) => !isRailCollider( c ) );
    expect( body.map( ( c ) => [c.shape, c.mesh_ref, c.surface_type, c.local_scale.x] ) ).toEqual( [["Mesh", "Features/c_rail/0", "Generic", 2]] );
    expect( recoverRail( back ) ).toBeNull();
  } );

  it( "puts a new point between the two it's nearest", () => {
    const pts: P3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0]];
    expect( insertAt( pts, [1.5,  0.1, 0] ) ).toBe( 2 );
    expect( insertAt( pts, [-0.5, 0,   0] ) ).toBe( 0 );
    expect( insertAt( pts, [2.6,  0,   0] ) ).toBe( 3 );
  } );
} );
