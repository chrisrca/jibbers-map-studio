// Where the game grabs a rider onto a jib ( "magnetize" ), drawn over the piece in the 3D view.
//
// A jib's "Intended up" ( the game's IntendedUpMethod ) tells the game which way its rail runs as well as which side is
// its top. Read from the game's own features, which all set it — tube_long: 0, one capsule along its Z; c_tube_narrow:
// 4, ten segments around the C, each with its Z up and its Y along the curve — and confirmed in game ( tube_long grinds
// on 0, and not upside down; c_tube_narrow, which runs along its X, grinds on 2 and not on 0 ):
//   0  Local Body                     along the piece's Z, its top the piece's Y
//   1  Local Body, Right Projected    along its Z, the top worked out across the rail ( rails that bend )
//   2  Local Body, Forward Projected  along its X, the top worked out across the rail
//   3  Per Body ( Y up, Z forward )     each collider along its Z, its top that collider's Y
//   4  Per Body ( Z up, Y forward )     each collider along its Y, its top that collider's Z
// and from Map-Tools 0.5 ( the game knows them too ), for rails built from pieces turned other ways:
//   5  Per Body ( Y up, X forward )     6  Per Body ( Z up, X forward )
//   7  Per Body ( X up, Y forward )     8  Per Body ( X up, Z forward )
//   9  Per Body Right Projected       each collider along its Z, the top worked out across it
//   10 Per Body Forward Projected     each collider along its X, the top worked out across it
// The guide traces the piece's top that way: green when that's the way the piece runs, red when the line runs across
// the piece.

import * as THREE from "three/webgpu";
import { toThree, unityEulerToQuat } from "../../core/coords";
import { arr3, type CustomObjectEntry } from "../../core/types";
import { isRailCollider } from "../../pieces/rail";

// The per-collider methods: the way each collider runs and its top, in its own axes ( Unity's; three's Z mirrored ).
const PER_BODY: Record<number, { along: "x" | "y" | "z"; up: "x" | "y" | "z" }> = {
  3:  { along: "z", up: "y" },
  4:  { along: "y", up: "z" },
  5:  { along: "x", up: "y" },
  6:  { along: "x", up: "z" },
  7:  { along: "y", up: "x" },
  8:  { along: "z", up: "x" },
  9:  { along: "z", up: "y" },
  10: { along: "x", up: "y" },
};

export interface GrindGuide {
  // world ( three ) points along the top, where the game grabs
  lines:   THREE.Vector3[][];
  ok:      boolean;
  problem: "across" | null;
  // the setting that follows the piece's shape, when the line runs across it
  suggest: number | null;
  // the side the game takes as the top ( world ), and where to show it
  up:      THREE.Vector3;
  mid:     THREE.Vector3;
  // the piece's size ( m ), for line thickness
  size:    number;
  // its grind rail's capsules as the game gets them ( world ), drawn round the rail to show how thick it is
  shells:  Shell[];
}

// A capsule ( three's coordinates ): its middle, its turn ( its length along Y ), its radius, its straight part's length.
export interface Shell {
  centre: THREE.Vector3;
  q:      THREE.Quaternion;
  radius: number;
  length: number;
}

// Unity's local axes in three's local coordinates ( three mirrors Z )
const UX         = new THREE.Vector3( 1, 0, 0  );
const UY         = new THREE.Vector3( 0, 1, 0  );
const UZ         = new THREE.Vector3( 0, 0, -1 );
const AXIS       = { x: UX, y: UY, z: UZ };
const AXIS_INDEX = { x: 0,  y: 1,  z: 2  };

// a slice's top: how far along, up and to the side
type Sample = [number, number, number];

interface Frame {
  origin: THREE.Vector3;
  q:      THREE.Quaternion;
  along:  THREE.Vector3;
  up:     THREE.Vector3;
}

interface Trace {
  line:     THREE.Vector3[];
  // a straight bar along the same way over the piece's top: what's drawn when that way is wrong
  bar:      THREE.Vector3[];
  extAlong: number;
  extSide:  number;
  // how far the top strays from a straight line, as a share of its length
  bend:     number;
}

/**
 * The top of `pts` ( world xyz ) along `f.along`, in 32 slices; extents along and across.
**/
function trace( pts: Float32Array, f: Frame ): Trace | null {
  const qi   = f.q.clone().invert();
  const side = new THREE.Vector3().crossVectors( f.along, f.up );
  const v    = new THREE.Vector3();
  const n    = pts.length / 3;
  if ( !n ) return null;
  const A = new Float32Array( n ), U = new Float32Array( n ), S = new Float32Array( n );
  let a0  = Infinity, a1 = -Infinity, s0 = Infinity, s1 = -Infinity, u1 = -Infinity;
  for ( let i = 0; i < n; i++ ) {
    v.set( pts[i * 3] - f.origin.x, pts[i * 3 + 1] - f.origin.y, pts[i * 3 + 2] - f.origin.z ).applyQuaternion( qi );
    const a = ( A[i] = v.dot( f.along ) ), s = ( S[i] = v.dot( side ) );
    const u = ( U[i] = v.dot( f.up    ) );
    a0      = Math.min( a0, a );
    a1      = Math.max( a1, a );
    s0      = Math.min( s0, s );
    s1      = Math.max( s1, s );
    u1      = Math.max( u1, u );
  }
  const BINS = 32;
  const best = new Int32Array( BINS ).fill( -1 );
  for ( let i = 0; i < n; i++ ) {
    const b = Math.min( BINS - 1, Math.floor( ( ( A[i] - a0 ) / Math.max( a1 - a0, 1e-6 ) ) * BINS ) );
    if ( best[b] < 0 || U[i] > U[best[b]] ) best[b] = i;
  }
  const len             = a1 - a0;
  const lift            = Math.max( 0.02, len * 0.01 );
  const local: Sample[] = [];
  for ( const i of best ) if ( i >= 0 ) local.push( [A[i], U[i], S[i]] );
  // straightness: the largest distance of the top from the line through its ends
  let bend = 0;
  if ( local.length >= 3 ) {
    const [p, q] = [local[0], local[local.length - 1]];
    for ( const t of local ) {
      const k = ( t[0] - p[0] ) / Math.max( q[0] - p[0], 1e-6 );
      bend    = Math.max( bend, Math.hypot( t[1] - ( p[1] + ( q[1] - p[1] ) * k ), t[2] - ( p[2] + ( q[2] - p[2] ) * k ) ) );
    }
  }
  // the top can hop between parts from slice to slice ( legs, the far side of a curve ): evened out a little for drawing
  const even = local.map( ( [a], i ) => {
    const w = local.slice( Math.max( 0, i - 2 ), i + 3 );
    return [a, w.reduce( ( t, q ) => t + q[1], 0 ) / w.length, w.reduce( ( t, q ) => t + q[2], 0 ) / w.length] as const;
  } );
  const world = ( [a, u, s]: readonly [number, number, number] ) =>
    f.along.clone().multiplyScalar( a ).addScaledVector( f.up, u + lift ).addScaledVector( side, s ).applyQuaternion( f.q ).add( f.origin );
  const line = even.map( world );
  const bar  = [world( [a0, u1, ( s0 + s1 ) / 2] ), world( [a1, u1, ( s0 + s1 ) / 2] )];
  return { line, bar, extAlong: len, extSide: s1 - s0, bend: bend / Math.max( len, 1e-6 ) };
}

/**
 * The setting that follows the piece: along X → 2; along Z → 0, or 1 when it bends.
**/
function suggestFor( pts: Float32Array, origin: THREE.Vector3, q: THREE.Quaternion ) {
  const x = trace( pts, { origin, q, along: UX, up: UY } );
  const z = trace( pts, { origin, q, along: UZ, up: UY } );
  if ( !x || !z ) return null;
  if ( x.extAlong > z.extAlong ) return 2;
  return z.bend > 0.06 ? 1 : 0;
}

/**
 * A collider as a box in its own frame ( three-local ): centre and half sizes.
**/
function colliderBox( c: CustomObjectEntry["colliders"][number] ) {
  const s      = new THREE.Vector3( Math.abs( c.local_scale.x ), Math.abs( c.local_scale.y ), Math.abs( c.local_scale.z ) );
  const centre = new THREE.Vector3( c.center.x,                  c.center.y,                  -c.center.z                 ).multiply( s );
  let half: THREE.Vector3;
  if ( c.shape === "Box" ) half = new THREE.Vector3( c.size.x / 2, c.size.y / 2, c.size.z / 2 );
  else if ( c.shape === "Sphere" ) half = new THREE.Vector3( c.radius, c.radius, c.radius );
  else {
    half = new THREE.Vector3( c.radius, c.radius, c.radius );
    half.setComponent( c.direction ?? 1, Math.max( c.height / 2, c.radius ) );
  }
  return { centre, half: half.multiply( s ) };
}

/**
 * Rail capsules ( world colliders ) as shapes to draw.
**/
export function railShells( colliders: CustomObjectEntry["colliders"] ): Shell[] {
  return colliders.filter( ( c ) => isRailCollider( c ) && c.shape === "Capsule" ).map( ( c ) => {
    const q                = unityEulerToQuat( arr3( c.local_rotation ) );
    const { centre, half } = colliderBox( c );
    const axis             = c.direction ?? 1;
    const radius           = Math.max( ...[0, 1, 2].filter( ( k ) => k !== axis ).map( ( k ) => half.getComponent( k ) ) );
    // turned so its length runs along Y, as a capsule is drawn
    const turn             = axis === 0 ? new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 0, 1 ), Math.PI / 2 )
      : axis === 2 ? new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), Math.PI / 2 )
      : new THREE.Quaternion();
    return {
      centre: centre.applyQuaternion( q ).add( toThree( arr3( c.local_position ) ) ),
      q:      q.clone().multiply( turn ),
      radius,
      length: Math.max( 0, 2 * ( half.getComponent( axis ) - radius ) ),
    };
  } );
}

/**
 * See-through capsules for `shells`, drawn over everything ( a rail's thickness, as the game takes it ).
**/
export function shellObject( shells: Shell[], mat: THREE.Material ): THREE.Group {
  const group = new THREE.Group();
  for ( const s of shells ) {
    const m = new THREE.Mesh( new THREE.CapsuleGeometry( s.radius, s.length, 6, 16 ), mat );
    m.position.copy( s.centre );
    m.quaternion.copy( s.q );
    m.renderOrder = 999;
    group.add( m );
  }
  return group;
}

export const shellMaterial = () =>
  new THREE.MeshBasicNodeMaterial( { color: 0xbfefff, depthTest: false, depthWrite: false, transparent: true, opacity: 0.18 } );

/**
 * The guide for one piece. `pts`: the piece's mesh vertices in world ( three ) coordinates, as drawn.
**/
export function grindGuide( o: CustomObjectEntry, pts: Float32Array ): GrindGuide | null {
  const method                       = o.intended_up_method;
  const rootOrigin                   = toThree( arr3( o.position ) );
  const rootQ                        = unityEulerToQuat( arr3( o.rotation ) );
  const lines: THREE.Vector3[][]     = [];
  // the side taken as the top, for each line
  const ups:   THREE.Vector3[]       = [];
  let problem: GrindGuide["problem"] = null;
  let size                           = 0;

  // ( a rail can climb as steep as it likes, and its top face any way: that's set with the arrow )
  const judge = ( _f: Frame, extAlong: number, extSide: number ) => {
    if ( extAlong < extSide * 0.75 ) problem ??= "across";
  };

  const per = PER_BODY[method];
  if ( per ) {
    for ( const c of o.colliders ) {
      if ( c.surface_type !== "Jib" ) continue; // posts and feet
      const f: Frame = {
        origin: toThree( arr3( c.local_position ) ),
        q:      unityEulerToQuat( arr3( c.local_rotation ) ),
        along: AXIS[per.along],
        up:    AXIS[per.up   ],
      };
      const up = f.up.clone().applyQuaternion( f.q );
      if ( c.shape === "Mesh" ) {
        const t = trace( pts, f );
        if ( !t ) continue;
        const before = problem;
        judge( f, t.extAlong, t.extSide );
        lines.push( problem !== before ? t.bar : t.line );
        ups.push( up );
        size = Math.max( size, t.extAlong, t.extSide );
      } else {
        const { centre, half } = colliderBox( c );
        const side             = new THREE.Vector3().crossVectors( f.along, f.up );
        const ha               = Math.abs( half.dot( f.along ) ), hu = Math.abs( half.dot( f.up ) ), hs = Math.abs( half.dot( side ) );
        const lift             = Math.max( 0.02, ha * 0.02 );
        const end              = ( k: number ) => centre.clone().addScaledVector( f.along, ha * k ).addScaledVector( f.up, hu + lift ).applyQuaternion( f.q ).add( f.origin );
        lines.push( [end( -1 ), end( 1 )] );
        ups.push( up );
        size              = Math.max( size, ha * 2, hs * 2 );
        // a capsule lying the way the setting says runs along itself, however short and thick it is
        const alongItself = c.shape === "Capsule" && c.direction === AXIS_INDEX[per.along];
        judge( f, alongItself ? Infinity : ha * 2, hs * 2 );
      }
    }
  } else {
    const f: Frame = { origin: rootOrigin, q: rootQ, along: method === 2 ? UX : UZ, up: UY };
    const t        = trace( pts, f );
    if ( !t ) return null;
    judge( f, t.extAlong, t.extSide );
    // the wrong way round: a straight bar shows which way the game looks; upside down: the top line, underneath
    lines.push( problem === "across" ? t.bar : t.line );
    ups.push( UY.clone().applyQuaternion( rootQ ) );
    size = Math.max( t.extAlong, t.extSide );
  }
  if ( !lines.length ) return null;
  // line thickness from the whole piece, not one segment of it
  const all   = new THREE.Box3().setFromPoints( lines.flat() );
  size        = Math.max( size, all.max.x - all.min.x, all.max.y - all.min.y, all.max.z - all.min.z );
  // the arrow halfway along the whole line, all its segments together ( by length, in the rail's order )
  const total = lines.reduce( ( sum, l ) => sum + l.slice( 1 ).reduce( ( d, p, k ) => d + p.distanceTo( l[k] ), 0 ), 0 );
  let left    = total / 2, mid = lines[0][0].clone(), up = ups[0];
  walk: for ( let i = 0; i < lines.length; i++ ) {
    for ( let k = 1; k < lines[i].length; k++ ) {
      const a = lines[i][k - 1], b = lines[i][k], d = a.distanceTo( b );
      if ( left <= d ) {
        mid = a.clone().lerp( b, d > 0 ? left / d : 0 );
        up  = ups[i];
        break walk;
      }
      left -= d;
    }
  }
  const suggest = problem === "across" ? suggestFor( pts, rootOrigin, rootQ ) : null;
  return { lines, ok: !problem, problem, suggest: suggest === method ? null : suggest, up: up.clone().normalize(), mid, size, shells: railShells( o.colliders ) };
}

const GREEN = 0x37d67a;
const RED   = 0xff5252;

/**
 * The guide drawn: a tube along each line and an arrow at the middle pointing to the side taken as the top.
 * Always drawn in front, so it shows through the piece.
**/
export function guideObject( g: GrindGuide ): THREE.Group {
  const group = new THREE.Group();
  if ( g.shells.length ) group.add( shellObject( g.shells, shellMaterial() ) );
  const mat = new THREE.MeshBasicNodeMaterial( { color: g.ok ? GREEN : RED, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 } );
  const r   = THREE.MathUtils.clamp( g.size * 0.008, 0.012, 0.12 );
  for ( const line of g.lines ) {
    if ( line.length < 2 ) continue;
    const curve      = new THREE.CatmullRomCurve3( line, false, "centripetal" );
    const mesh       = new THREE.Mesh( new THREE.TubeGeometry( curve, Math.max( 8, line.length * 3 ), r, 8, false ), mat );
    mesh.renderOrder = 1000;
    group.add( mesh );
  }
  const cone = new THREE.Mesh( new THREE.ConeGeometry( r * 3, r * 8, 16 ), mat );
  cone.position.copy( g.mid ).addScaledVector( g.up, r * 7 );
  cone.quaternion.setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), g.up );
  cone.renderOrder = 1000;
  group.add( cone );
  return group;
}

export function disposeGuide( group: THREE.Object3D ) {
  group.traverse( ( x ) => {
    if ( x instanceof THREE.Mesh ) {
      x.geometry.dispose();
      ( x.material as THREE.Material ).dispose();
    }
  } );
}
