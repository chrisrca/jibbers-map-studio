import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { colliderInView, railRuns, tweakFrom, withRail, withRailAgain, withTweak, type P3, type RailRun } from "../../src/pieces/rail";
import { composeUnity, transformCustom } from "../../src/core/transform";
import { type CustomObjectEntry, type Rail } from "../../src/core/types";
import { CURVE_PRESETS, presetCurve } from "../../src/model/curve";
import { newCurveObject, railOfCurve, withCurvePoints, withTweaks } from "../../src/model/objects";

const piece = ( o: Partial<CustomObjectEntry> = {} ): CustomObjectEntry => ( {
  uid:                      "p",   surface_type:     "Jib", can_stabilize:     true, can_rotate:         true, can_magnetize: true, intended_up_method: 0,
  disable_distance_culling: false, timed_visibility: false, visible_from_hour: 19,   visible_until_hour: 6,
  position:  { x: 10, y: 2, z: -4 }, rotation: { x: 0, y: 30, z: 0 }, scale: { x: 1, y: 1, z: 1 },
  parts:     [], lights: [], lod_groups: [], colliders: [],
  ...o,
} );

// ( a box rail along X with a bend in it, on a piece turned and off the origin )
const BENT: P3[] = [[-3, 0, 0], [-1, 0.3, 0.4], [1, 0.3, 0.4], [3, 0, 0]];
const railed     = ( points = BENT ) => withRail( piece(), { points, radius: 0.05, box: [0.08, 0.03] } );
const runsOf     = ( o: CustomObjectEntry ) => railRuns( o, o.rail! );

// ( how far a collider is turned from where the rail puts it, and its own axes in the view )
const turned = ( r: RailRun ) => colliderInView( r.auto ).q.angleTo( colliderInView( r.made ).q );
const axis   = ( r: RailRun, k: 0 | 1 | 2, made = true ) => new THREE.Vector3().setComponent( k, 1 ).applyQuaternion( colliderInView( made ? r.made : r.auto ).q );

// collider `i` rolled `deg` about its own length ( as the rotate gizmo turns it about its Y )
function rolled( o: CustomObjectEntry, i: number, deg: number ) {
  const run = runsOf( o )[i], c = colliderInView( run.made );
  const q   = new THREE.Quaternion().setFromAxisAngle( axis( run, 1 ), THREE.MathUtils.degToRad( deg ) ).multiply( c.q );
  return withRail( o, { ...o.rail!, tweaks: withTweak( o.rail!.tweaks, run, tweakFrom( run, c.at, q, [1, 1, 1] ) ) } );
}

// ( the tweaked one: there's one )
const tweaked = ( o: CustomObjectEntry ) => {
  const all = runsOf( o ).filter( ( r ) => r.tweak );
  expect( all ).toHaveLength( 1 );
  return all[0];
};

describe( "rail colliders changed by hand", () => {
  it( "one rolled on the gizmo: that one turned so, about its own length, the rest as the rail makes them", () => {
    const o   = railed();
    const n   = runsOf( o ).length;
    const i   = Math.floor( n / 2 );
    const t   = rolled( o, i, 25 );
    const rs  = runsOf( t );
    expect( rs ).toHaveLength( n );
    expect( THREE.MathUtils.radToDeg( turned( rs[i] ) ) ).toBeCloseTo( 25, 3 );
    // ( about its length: that still along the rail, its width and height turned )
    expect( axis( rs[i], 1 ).dot( axis( rs[i], 1, false ) ) ).toBeCloseTo( 1, 6 );
    expect( axis( rs[i], 2 ).dot( axis( rs[i], 2, false ) ) ).toBeCloseTo( Math.cos( THREE.MathUtils.degToRad( 25 ) ), 5 );
    expect( rs.filter( ( _, k ) => k !== i ).every( ( r ) => turned( r ) < 1e-6 ) ).toBe( true );
    // ( the piece's colliders are those )
    const made = t.colliders.filter( ( c ) => c.mesh_ref === "studio-rail" );
    expect( made[i].local_rotation ).toEqual( rs[i].made.local_rotation );
  } );

  it( "moved and sized in its own axes: back where the gizmo put it, as big", () => {
    const o   = railed();
    const run = runsOf( o )[1], c = colliderInView( run.made );
    const to  = c.at.clone().addScaledVector( axis( run, 2 ), 0.1 );
    const t   = withRail( o, { ...o.rail!, tweaks: withTweak( undefined, run, tweakFrom( run, to, c.q, [1, 1, 2] ) ) } );
    const r   = runsOf( t )[1];
    expect( colliderInView( r.made ).at.distanceTo( to ) ).toBeLessThan( 1e-5 );
    expect( r.made.size.z ).toBeCloseTo( run.auto.size.z * 2, 5 );
    expect( r.made.size.x ).toBeCloseTo( run.auto.size.x, 5 );
  } );

  it( "keep their turn and place along the rail as the piece is moved, turned and scaled", () => {
    const o    = rolled( railed(), 2, 30 );
    const was  = tweaked( o );
    const move = composeUnity( [5, 1, -3], [0, 70, 0], [1.5, 1.5, 1.5] );
    const m    = withRailAgain( transformCustom( o, move ) );
    const now  = tweaked( m );
    expect( THREE.MathUtils.radToDeg( turned( now ) ) ).toBeCloseTo( 30, 3 );
    expect( now.lo ).toBeCloseTo( was.lo, 9 );
    expect( now.hi ).toBeCloseTo( was.hi, 9 );
  } );

  it( "keep their place as a point is moved, and as points are added and taken away", () => {
    const o   = rolled( railed(), 3, -20 );
    const was = tweaked( o ), at = colliderInView( was.made ).at;
    // a point moved: the same place along the rail
    const moved = withRail( o, { ...o.rail!, points: BENT.map( ( p, k ) => ( k === 3 ? [3.5, -0.2, 0.3] : p ) ) } );
    expect( THREE.MathUtils.radToDeg( turned( tweaked( moved ) ) ) ).toBeCloseTo( 20, 3 );
    expect( tweaked( moved ).tweak!.at ).toBe( was.tweak!.at );
    // one added ahead of it ( the rail runs as it did ): still the collider there
    const pts   = [...BENT.slice( 0, 1 ), [-2, 0.15, 0.2] as P3, ...BENT.slice( 1 )];
    const added = withRail( o, { ...o.rail!, points: pts } );
    const a     = tweaked( added );
    expect( THREE.MathUtils.radToDeg( turned( a ) ) ).toBeCloseTo( 20, 3 );
    expect( colliderInView( a.made ).at.distanceTo( at ) ).toBeLessThan( 0.3 );
    // and taken away again: back where it was
    const back = withRail( added, { ...added.rail!, points: BENT } );
    expect( colliderInView( tweaked( back ).made ).at.distanceTo( at ) ).toBeLessThan( 0.05 );
    // the far end's point taken away: still the collider where it was
    const fewer = withRail( o, { ...o.rail!, points: BENT.slice( 0, 3 ) } );
    expect( colliderInView( tweaked( fewer ).made ).at.distanceTo( at ) ).toBeLessThan( 0.3 );
    // the point beside it taken away ( its part of the rail gone ): the collider nearest where it was, still turned
    const gone = withRail( o, { ...o.rail!, points: BENT.slice( 1 ) } );
    expect( THREE.MathUtils.radToDeg( turned( tweaked( gone ) ) ) ).toBeCloseTo( 20, 3 );
  } );

  it( "put back: one, or all of them; made again from the shape, they go", () => {
    const o   = rolled( rolled( railed(), 1, 10 ), 3, 15 );
    expect( runsOf( o ).filter( ( r ) => r.tweak ) ).toHaveLength( 2 );
    const run = runsOf( o )[1];
    const one = withRail( o, { ...o.rail!, tweaks: withTweak( o.rail!.tweaks, run, null ) } );
    const rs  = runsOf( one );
    expect( rs.filter( ( r ) => r.tweak ).map( ( r ) => rs.indexOf( r ) ) ).toEqual( [3] );
    const none = withRail( o, { ...o.rail!, tweaks: [] } );
    expect( none.rail!.tweaks ).toBeUndefined();
    expect( runsOf( none ).every( ( r ) => turned( r ) < 1e-6 ) ).toBe( true );
    // ( a rail made over again without saying: its tweaks kept; saying none: gone )
    const { tweaks: _t, ...plain } = o.rail as Rail;
    expect( withRail( o, plain ).rail!.tweaks ).toHaveLength( 2 );
    expect( withRail( o, { ...plain, tweaks: undefined } ).rail!.tweaks ).toBeUndefined();
  } );

  it( "on a curve piece ( Add › Rail ): kept through its curve made again, a point added and the piece moved", () => {
    const c0  = newCurveObject( "c", presetCurve( CURVE_PRESETS.find( ( p ) => p.label === "Curved Rail" )! ), [0, 1, 0], true );
    const n   = runsOf( c0 ).length;
    const i   = Math.floor( n / 2 );
    const run = runsOf( c0 )[i], c = colliderInView( run.made );
    const q   = new THREE.Quaternion().setFromAxisAngle( axis( run, 1 ), THREE.MathUtils.degToRad( 40 ) ).multiply( c.q );
    const c1  = withTweaks( c0, withTweak( undefined, run, tweakFrom( run, c.at, q, [1, 1, 1] ) ) );
    const t1  = tweaked( c1 );
    expect( THREE.MathUtils.radToDeg( turned( t1 ) ) ).toBeCloseTo( 40, 3 );
    // ( the piece's own colliders: that one turned, on the grind rail )
    expect( c1.colliders.some( ( x ) => x.mesh_ref === "studio-rail" && x.local_rotation.x === t1.made.local_rotation.x && x.local_rotation.z === t1.made.local_rotation.z ) ).toBe( true );
    // a point added on its curve ( Edit Points ), far from it: still that collider, as turned
    const own = railOfCurve( c1 ).rail!.points;
    const c2  = withCurvePoints( c1 as CustomObjectEntry & { model: NonNullable<CustomObjectEntry["model"]> }, [own[0], [-2, 0, -0.6], ...own.slice( 1 )] as P3[] );
    const t2  = tweaked( c2 );
    expect( THREE.MathUtils.radToDeg( turned( t2 ) ) ).toBeCloseTo( 40, 3 );
    expect( colliderInView( t2.made ).at.distanceTo( colliderInView( t1.made ).at ) ).toBeLessThan( 0.3 );
    // moved and turned: as turned
    const c3 = withRailAgain( transformCustom( c2, composeUnity( [4, 0, 2], [0, -45, 0], [1, 1, 1] ) ) );
    expect( THREE.MathUtils.radToDeg( turned( tweaked( c3 ) ) ) ).toBeCloseTo( 40, 3 );
  } );

  it( "survive a box rail's thickness changed", () => {
    const o = rolled( railed(), 2, 12 );
    const t = withRail( o, { ...o.rail!, box: [0.12, 0.05] } );
    expect( THREE.MathUtils.radToDeg( turned( tweaked( t ) ) ) ).toBeCloseTo( 12, 3 );
  } );
} );
