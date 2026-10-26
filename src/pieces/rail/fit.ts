// Colliders fitted to a piece's visible parts ( "Mesh collidable" ): a capsule for something long and round, a box
// otherwise, a chain of boxes for something curved; all kept clear of the rail's own tube.

import * as THREE from "three/webgpu";
import { type CustomCollider, type Rail, arr3, xyz } from "../../core/types";
import { railPath, unityEuler } from "./colliders";
import { PART_MARK, PROUD, clamp, vec } from "./common";
import { surfacePoints } from "./shape";

/**
 * The axes of a point cloud, longest spread first ( a symmetric 3×3's eigenvectors, by Jacobi turns ).
**/
function principalAxes( pts: THREE.Vector3[], centre: THREE.Vector3 ): THREE.Vector3[] {
  const a = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for ( const p of pts ) {
    const d = [p.x - centre.x, p.y - centre.y, p.z - centre.z];
    for ( let i = 0; i < 3; i++ ) for ( let j = 0; j < 3; j++ ) a[i][j] += d[i] * d[j];
  }
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for ( let sweep = 0; sweep < 24; sweep++ ) {
    for ( const [p, q] of [[0, 1], [0, 2], [1, 2]] ) {
      if ( Math.abs( a[p][q] ) < 1e-12 ) continue;
      const theta = ( a[q][q] - a[p][p] ) / ( 2 * a[p][q] );
      const t     = Math.sign( theta || 1 ) / ( Math.abs( theta ) + Math.sqrt( theta * theta + 1 ) );
      const c     = 1 / Math.sqrt( t * t + 1 ), s = t * c;
      for ( let k = 0; k < 3; k++ ) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p]   = c * akp - s * akq;
        a[k][q]   = s * akp + c * akq;
      }
      for ( let k = 0; k < 3; k++ ) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k]   = c * apk - s * aqk;
        a[q][k]   = s * apk + c * aqk;
      }
      for ( let k = 0; k < 3; k++ ) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p]   = c * vkp - s * vkq;
        v[k][q]   = s * vkp + c * vkq;
      }
    }
  }
  return [0, 1, 2]
    .sort( ( i, j ) => a[j][j] - a[i][i] )
    .map( ( i ) => new THREE.Vector3( v[0][i], v[1][i], v[2][i] ).normalize() );
}

// Where a rail runs and the top of its capsules ( its top, and halfway down either side, at each point along it ): the
// plain colliders keep out of that, so a rider coming down meets the rail — and is grabbed by it — not something
// plain around it.
interface RailGuard {
  centres:  THREE.Vector3[];
  tangents: THREE.Vector3[];
  tops:     THREE.Vector3[][];
  // the capsules' radius
  reach:    number;
  up:       THREE.Vector3;
}

function railGuard( rail: Rail ): RailGuard | null {
  // every 5 cm along it ( a straight rail's path is just its ends )
  const path = railPath( rail, 8 ).flatMap( ( p, i, all ) => {
    if ( i === 0 ) return [p];
    const n = Math.max( 1, Math.ceil( p.distanceTo( all[i - 1] ) / 0.05 ) );
    return Array.from( { length: n }, ( _, k ) => all[i - 1].clone().lerp( p, ( k + 1 ) / n ) );
  } );
  if ( path.length < 2 ) return null;
  const reach        = rail.radius + PROUD;
  const up           = vec( rail.up ?? [0, 1, 0] ).normalize();
  const g: RailGuard = { centres: [], tangents: [], tops: [], reach, up };
  path.forEach( ( p, i ) => {
    const t    = path[Math.min( i + 1, path.length - 1 )].clone().sub( path[Math.max( i - 1, 0 )] ).normalize();
    const side = new THREE.Vector3().crossVectors( t, up );
    if ( side.lengthSq() < 1e-6 ) return; // running straight up: no top to it
    side.normalize();
    const u = new THREE.Vector3().crossVectors( side, t ).normalize();
    g.centres.push( p );
    g.tangents.push( t );
    g.tops.push( [u, u.clone().add( side ).normalize(), u.clone().sub( side ).normalize()].map( ( d ) => p.clone().addScaledVector( d, reach ) ) );
  } );
  return g.centres.length ? g : null;
}

// room left between a plain collider and the top of the rail
const CLEAR = 0.02;

// A fitted part: its axes ( the long one first ), how far it goes along each, and whether it's a capsule along the first.
interface Fitted {
  ax:     THREE.Vector3[];
  lo:     number[];
  hi:     number[];
  round:  boolean;
  radius: number;
}

/**
 * The rail's points ( by index ) with some of their top within reach of the part.
**/
function reached( f: Fitted, g: RailGuard ): number[] {
  const { ax, lo, hi, round, radius } = f;
  const m2                            = ( lo[1] + hi[1] ) / 2, m3 = ( lo[2] + hi[2] ) / 2;
  const near                          = ( t: THREE.Vector3 ) => {
    const c = ax.map( ( a ) => t.dot( a ) );
    if ( !round ) return c.every( ( v, k ) => v >= lo[k] - CLEAR && v <= hi[k] + CLEAR );
    // a capsule: within its radius of its middle line
    return Math.hypot( c[0] - clamp( c[0], lo[0] + radius, hi[0] - radius ), c[1] - m2, c[2] - m3 ) <= radius + CLEAR;
  };
  return g.tops.flatMap( ( tops, i ) => ( tops.some( near ) ? [i] : [] ) );
}

/**
 * The part kept out of the top of the rail, so a rider coming down meets the rail ( and is grabbed by it ), not the
 * part: the tube the rail is left to the rail's capsules ( solid too ), a tube or bar it runs over made thinner, and
 * anything else ( a post's top, a panel's edge ) ended short of the rail's middle, on the side it comes from. False when
 * that leaves nothing of it.
**/
function clearOfRail( f: Fitted, g: RailGuard ): boolean {
  const hit = reached( f, g );
  if ( !hit.length ) return true;
  const { ax, lo, hi } = f;
  const tops           = hit.flatMap( ( i ) => g.tops[i] );
  const along          = hit.some( ( i ) => Math.abs( ax[0].dot( g.tangents[i] ) ) > 0.7 );
  if ( f.round && ( along || Math.abs( ax[0].dot( g.up ) ) < 0.5 ) ) {
    const m2  = ( lo[1] + hi[1] ) / 2, m3 = ( lo[2] + hi[2] ) / 2;
    const off = ( p: THREE.Vector3 ) => Math.hypot( p.dot( ax[1] ) - m2, p.dot( ax[2] ) - m3 );
    if ( hit.some( ( i ) => off( g.centres[i] ) < g.reach ) ) return false;
    f.radius = Math.min( f.radius, ...tops.map( ( t ) => off( t ) - CLEAR - 1e-4 ) );
    return f.radius >= 0.01 && !reached( f, g ).length;
  }
  const k  = f.round ? 0 : [0, 1, 2].reduce( ( b, i ) => ( Math.abs( ax[i].dot( g.up ) ) > Math.abs( ax[b].dot( g.up ) ) ? i : b ), 0 );
  const at = hit.map( ( i ) => g.centres[i].dot( ax[k] ) );
  if ( at.reduce( ( s, v ) => s + v, 0 ) / at.length > ( lo[k] + hi[k] ) / 2 ) hi[k] = Math.min( hi[k], ...at, ...tops.map( ( t ) => t.dot( ax[k] ) - CLEAR - 1e-4 ) );
  else lo[k] = Math.max( lo[k], ...at, ...tops.map( ( t ) => t.dot( ax[k] ) + CLEAR + 1e-4 ) );
  return hi[k] - lo[k] >= ( f.round ? 2 * f.radius + 0.02 : 0.02 ) && !reached( f, g ).length;
}

/**
 * A fitted part's collider ( piece coordinates ).
**/
function colliderOf( { ax, lo, hi, round, radius }: Fitted ): CustomCollider {
  const [a1, a2, a3] = ax;
  const size         = [0, 1, 2].map( ( i ) => Math.max( 0.02, hi[i] - lo[i] ) );
  const mid          = new THREE.Vector3();
  ax.forEach( ( a, i ) => mid.addScaledVector( a, ( lo[i] + hi[i] ) / 2 ) );
  const base = {
    surface_type: "Generic" as const, local_position: xyz( [mid.x, mid.y, mid.z] ), local_scale: xyz( [1, 1, 1] ),
    center:       xyz( [0, 0, 0] ), mesh_ref: PART_MARK,
  };
  if ( round ) {
    // long and round ( a post, a pole, a bar ): a capsule along it, its Y the long way
    const x = new THREE.Vector3().crossVectors( a1, a3 ).normalize();
    return { ...base, shape: "Capsule", local_rotation: xyz( unityEuler( x, a1, a3 ) ), size: xyz( [0, 0, 0] ), radius, height: size[0], direction: 1 };
  }
  return { ...base, shape: "Box", local_rotation: xyz( unityEuler( a1, a2, a3 ) ), size: xyz( size ), radius: 0.5, height: 1, direction: 1 };
}

/**
 * A fitted part's collider ( colliderOf's ) back as the part.
**/
function fittedOf( c: CustomCollider ): Fitted {
  const d = THREE.MathUtils.DEG2RAD;
  // Unity turns about Z, then X, then Y
  const m = new THREE.Matrix4()
    .makeRotationY( c.local_rotation.y * d )
    .multiply( new THREE.Matrix4().makeRotationX( c.local_rotation.x * d ) )
    .multiply( new THREE.Matrix4().makeRotationZ( c.local_rotation.z * d ) );
  const x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
  m.extractBasis( x, y, z );
  const p     = vec( arr3( c.local_position ) );
  const round = c.shape === "Capsule";
  // a capsule's Y is the part's length, its X the part's second axis turned round
  const ax    = round ? [y, x.negate(), z] : [x, y, z];
  const half  = round ? [c.height / 2, c.radius, c.radius] : [c.size.x / 2, c.size.y / 2, c.size.z / 2];
  return { ax, lo: ax.map( ( a, i ) => p.dot( a ) - half[i] ), hi: ax.map( ( a, i ) => p.dot( a ) + half[i] ), round, radius: c.radius };
}

/**
 * Fitted parts ( fitParts' ) kept out of the top of `rail` ( see clearOfRail ): the same array when none reach it.
**/
export function keepClear( parts: CustomCollider[], rail: Rail ): CustomCollider[] {
  const g = railGuard( rail );
  if ( !g ) return parts;
  let changed = false;
  const out   = parts.flatMap( ( c ) => {
    if ( c.mesh_ref !== PART_MARK || ( c.shape !== "Box" && c.shape !== "Capsule" ) ) return [c];
    const f = fittedOf( c );
    if ( !reached( f, g ).length ) return [c];
    changed = true;
    return clearOfRail( f, g ) ? [colliderOf( f )] : [];
  } );
  return changed ? out : parts;
}

/**
 * The part around `pts` ( piece coordinates ), along `axes` ( the long one first ): a capsule if long and round, a box otherwise.
**/
function fitted( pts: THREE.Vector3[], axes: THREE.Vector3[] ): Fitted {
  const [a1, a2] = axes;
  const a3       = new THREE.Vector3().crossVectors( a1, a2 ).normalize();
  const ax       = [a1, a2, a3];
  const lo       = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for ( const p of pts ) {
    ax.forEach( ( a, i ) => {
      const t = p.dot( a );
      lo[i]   = Math.min( lo[i], t );
      hi[i]   = Math.max( hi[i], t );
    } );
  }
  // round across, or square? a round thing leaves the corners of its outline ( seen end-on ) empty
  const [s1, s2, s3] = [0, 1, 2].map( ( i ) => Math.max( 0.02, hi[i] - lo[i] ) );
  const m2           = ( lo[1] + hi[1] ) / 2, m3 = ( lo[2] + hi[2] ) / 2;
  const inCorners    = pts.filter( ( p ) => Math.abs( ( p.dot( a2 ) - m2 ) / ( s2 / 2 ) ) > 0.8 && Math.abs( ( p.dot( a3 ) - m3 ) / ( s3 / 2 ) ) > 0.8 ).length;
  return { ax, lo, hi, round: s2 <= s3 * 1.4 && s1 >= s2 * 1.3 && inCorners <= pts.length * 0.02, radius: ( s2 + s3 ) / 4 };
}

/**
 * Colliders for one part: `corners` its corners ( each once: they set its axes ), `surface` points spread over it. A
 * part that bends ( or is an L ) needs a box far deeper across than any slice of it is: it's halved along its length
 * and each half fitted the same way, so a curved wall becomes a chain of boxes along it, nothing across the curve.
 * Kept out of the top of the rail ( `guard`, see clearOfRail ). A box cut down for it that leaves some of the part
 * under the rail bare ( a panel under a wave: cut to the lowest the rail comes over it ) is halved along the rail
 * instead ( `axes` kept ), each half cut only as far as the rail comes down over it.
**/
function fitPart( corners: THREE.Vector3[], surface: THREE.Vector3[], depth = 0, guard: RailGuard | null = null, axes: THREE.Vector3[] | null = null ): CustomCollider[] {
  const pts = corners.length >= 4 ? corners : surface;
  if ( pts.length < 3 ) return [];
  const all    = [...corners, ...surface];
  // halves along `a`, overlapping a little so they meet
  const halves = ( a: THREE.Vector3, keep: THREE.Vector3[] | null ) => {
    const t    = all.map( ( p ) => p.dot( a ) );
    const u0   = Math.min( ...t ), u1 = Math.max( ...t );
    const cut  = ( u0 + u1 ) / 2, lap = ( u1 - u0 ) * 0.02;
    const half = ( on: ( x: number ) => boolean ) => fitPart( corners.filter( ( p ) => on( p.dot( a ) ) ), surface.filter( ( p ) => on( p.dot( a ) ) ), depth + 1, guard, keep );
    return [...half( ( x ) => x <= cut + lap ), ...half( ( x ) => x >= cut - lap )];
  };
  if ( !axes ) {
    const centre   = pts.reduce( ( s, p ) => s.add( p ), new THREE.Vector3() ).divideScalar( pts.length );
    axes           = principalAxes( pts, centre );
    const [a1, a2] = axes;
    const a3       = new THREE.Vector3().crossVectors( a1, a2 );
    const along    = surface.map( ( p ) => p.dot( a1 ) );
    const u0       = Math.min( ...all.map( ( p ) => p.dot( a1 ) ) ), u1 = Math.max( ...all.map( ( p ) => p.dot( a1 ) ) );
    if ( depth < 5 && surface.length >= 16 && u1 - u0 > 0.1 ) {
      const S     = 8;
      const bends = [a2, a3].some( ( ax ) => {
        const t  = surface.map( ( p ) => p.dot( ax ) );
        const lo = Array.from( { length: S }, () => Infinity ), hi = Array.from( { length: S }, () => -Infinity );
        t.forEach( ( x, i ) => {
          const k = Math.min( S - 1, Math.floor( ( ( along[i] - u0 ) / ( u1 - u0 ) ) * S ) );
          lo[k]   = Math.min( lo[k], x );
          hi[k]   = Math.max( hi[k], x );
        } );
        const slices = lo.map( ( l, k ) => hi[k] - l ).filter( ( e ) => e >= 0 ).sort( ( x, y ) => x - y );
        return Math.max( ...t ) - Math.min( ...t ) > 1.6 * ( slices[slices.length >> 1] ?? 0 ) + 0.03;
      } );
      if ( bends ) return halves( a1, null );
    }
  }
  const f   = fitted( all, axes );
  const hit = guard ? reached( f, guard ) : [];
  if ( !guard || !hit.length ) return [colliderOf( f )];
  const was  = [...f.lo, ...f.hi];
  const kept = clearOfRail( f, guard );
  if ( !f.round && depth < 5 && surface.length >= 16 ) {
    // which side was cut, towards the rail ( s: +1 its top, -1 its bottom )
    const j       = [...f.lo, ...f.hi].findIndex( ( v, i ) => v !== was[i] );
    const k       = j % 3, s = j >= 3 ? 1 : -1, edge = j >= 3 ? f.hi[k] : f.lo[k];
    const nearest = ( p: THREE.Vector3 ) => guard.centres.reduce( ( b, c ) => ( c.distanceToSquared( p ) < b.distanceToSquared( p ) ? c : b ) );
    const bare    = !kept || ( j >= 0 && surface.some( ( p ) => {
      const t = p.dot( f.ax[k] );
      return s * ( t - edge ) > 0.05 && s * ( nearest( p ).dot( f.ax[k] ) - t ) > guard.reach;
    } ) );
    if ( bare ) {
      const run = hit.reduce( ( r, i ) => r.addScaledVector( guard.tangents[i], Math.sign( guard.tangents[i].dot( guard.tangents[hit[0]] ) ) || 1 ), new THREE.Vector3() );
      return halves( f.ax.reduce( ( b, a ) => ( Math.abs( a.dot( run ) ) > Math.abs( b.dot( run ) ) ? a : b ) ), axes );
    }
  }
  return kept ? [colliderOf( f )] : [];
}

/**
 * Whether triangles make one convex shape: every corner on the inside of every face ( within `tol` ).
**/
function convex( tris: Float32Array, tol: number ): boolean {
  const n = tris.length / 9;
  if ( n > 3000 ) return false; // ( too many to check: taken as not )
  const corners: THREE.Vector3[] = [];
  for ( let i = 0; i < tris.length; i += 3 ) corners.push( new THREE.Vector3( tris[i], tris[i + 1], tris[i + 2] ) );
  const centre = corners.reduce( ( s, p ) => s.add( p ), new THREE.Vector3() ).divideScalar( corners.length );
  const ab     = new THREE.Vector3(), ac = new THREE.Vector3(), d = new THREE.Vector3();
  for ( let t = 0; t < n; t++ ) {
    const a      = corners[t * 3];
    const normal = ab.subVectors( corners[t * 3 + 1], a ).cross( ac.subVectors( corners[t * 3 + 2], a ) );
    if ( normal.lengthSq() < 1e-12 ) continue;
    normal.normalize();
    const inside = Math.sign( d.subVectors( centre, a ).dot( normal ) ) || 1;
    for ( const p of corners ) if ( d.subVectors( p, a ).dot( normal ) * inside < -tol ) return false;
  }
  return true;
}

/**
 * Plain solid colliders fitted to a piece's visible parts ( `tris`: its triangles in its own coordinates, 9 numbers
 * each ): the mesh split into the pieces it's made of ( parts sharing no corner ), the rail's own tube left out ( the rail
 * has that ), each part a capsule or a box — or, where it bends, a chain of them along it. The largest 64 parts.
**/
export function fitParts( tris: Float32Array, rail: Rail ): { parts: CustomCollider[]; whole: boolean } {
  const n                       = Math.floor( tris.length / 9 );
  const guard                   = railGuard( rail );
  const path                    = railPath( rail, 8 );
  const reach                   = rail.radius * 1.5 + 0.02;
  const on                      = new THREE.Vector3(), c = new THREE.Vector3();
  const segs                    = path.slice( 1 ).map( ( p, i ) => new THREE.Line3( path[i], p ) );
  const nearRail                = ( p: THREE.Vector3 ) => segs.some( ( s ) => s.closestPointToPoint( p, true, on ).distanceToSquared( p ) < reach * reach );
  // corners shared by position ( a mesh repeats them for its normals and UVs ), joined triangle by triangle
  const ids                     = new Map<string, number>();
  const where:  THREE.Vector3[] = [];
  const parent: number[]        = [];
  const find                    = ( a: number ): number => ( parent[a] === a ? a : ( parent[a] = find( parent[a] ) ) );
  const corner                  = ( t: number, k: number ) => {
    const i   = t * 9 + k * 3;
    const key = `${Math.round( tris[i] * 1000 )},${Math.round( tris[i + 1] * 1000 )},${Math.round( tris[i + 2] * 1000 )}`;
    let id    = ids.get( key );
    if ( id === undefined ) {
      ids.set( key, ( id = parent.length ) );
      parent.push( id );
      where.push( new THREE.Vector3( tris[i], tris[i + 1], tris[i + 2] ) );
    }
    return id;
  };
  const kept: number[] = [];
  for ( let t = 0; t < n; t++ ) {
    // the rail's own tube ( thin rails only: a box's rail runs over its top, which stays part of the box )
    c.set( ( tris[t * 9] + tris[t * 9 + 3] + tris[t * 9 + 6] ) / 3, ( tris[t * 9 + 1] + tris[t * 9 + 4] + tris[t * 9 + 7] ) / 3, ( tris[t * 9 + 2] + tris[t * 9 + 5] + tris[t * 9 + 8] ) / 3 );
    if ( rail.radius <= 0.15 && segs.length && nearRail( c ) ) continue;
    const a           = corner( t, 0 ), b = corner( t, 1 ), d = corner( t, 2 );
    parent[find( a )] = find( b );
    parent[find( b )] = find( d );
    kept.push( t );
  }
  const groups = new Map<number, { tris: number[]; corners: Set<number> }>();
  for ( const t of kept ) {
    const g = find( corner( t, 0 ) );
    let e   = groups.get( g );
    if ( !e ) groups.set( g, ( e = { tris: [], corners: new Set() } ) );
    e.tris.push( t );
    for ( let k = 0; k < 3; k++ ) e.corners.add( corner( t, k ) );
  }
  const parts = [...groups.values()]
    .map( ( e ) => ( { ...e, size: new THREE.Box3().setFromPoints( [...e.corners].map( ( i ) => where[i] ) ).getSize( new THREE.Vector3() ).length() } ) )
    .filter( ( e ) => e.size > 0.03 ) // bolts and specks
    .sort( ( p, q ) => q.size - p.size )
    .slice( 0, 64 );
  // all of it one closed convex solid ( a box, a ledge, a hump ): the piece's own collider fits it exactly, as the
  // game shrink-wraps it — nothing to fill in. ( Closed: a curved wall bends one way too, but it's a sheet, and
  // shrink-wrapped it would fill the curve. )
  if ( kept.length === n && parts.length === 1 ) {
    const edges = new Map<string, number>();
    for ( let t = 0; t < n; t++ ) {
      const k = [corner( t, 0 ), corner( t, 1 ), corner( t, 2 )];
      for ( const [x, y] of [[k[0], k[1]], [k[1], k[2]], [k[2], k[0]]] ) {
        if ( x === y ) continue;
        const e = x < y ? `${x}|${y}` : `${y}|${x}`;
        edges.set( e, ( edges.get( e ) ?? 0 ) + 1 );
      }
    }
    // closed, or open only on one flat side ( a box or hump with no bottom, sitting on the ground: shrink-wrapped, the
    // bottom closes flat, just as it looks )
    const open = new Set<number>();
    for ( const [e, count] of edges ) if ( count !== 2 ) for ( const id of e.split( "|" ) ) open.add( +id );
    let flatOpening = open.size === 0;
    if ( !flatOpening && open.size >= 3 ) {
      const rim    = [...open].map( ( id ) => where[id] );
      const mid    = rim.reduce( ( acc, p ) => acc.add( p ), new THREE.Vector3() ).divideScalar( rim.length );
      const normal = principalAxes( rim, mid )[2];
      flatOpening  = rim.every( ( p ) => Math.abs( p.clone().sub( mid ).dot( normal ) ) < parts[0].size * 0.01 );
    }
    if ( flatOpening && convex( tris, parts[0].size * 0.01 ) ) return { parts: [], whole: true };
  }
  return { whole: false, parts: parts.flatMap( ( e ) => {
    const flat = new Float32Array( e.tris.length * 9 );
    e.tris.forEach( ( t, i ) => flat.set( tris.subarray( t * 9, t * 9 + 9 ), i * 9 ) );
    let area = 0;
    for ( let i = 0; i < flat.length; i += 9 ) {
      const ab = new THREE.Vector3( flat[i + 3] - flat[i], flat[i + 4] - flat[i + 1], flat[i + 5] - flat[i + 2] );
      const ac = new THREE.Vector3( flat[i + 6] - flat[i], flat[i + 7] - flat[i + 1], flat[i + 8] - flat[i + 2] );
      area    += ab.cross( ac ).length() / 2;
    }
    const spread                   = surfacePoints( flat, null, 1500 / Math.max( area, 1e-6 ) );
    const surface: THREE.Vector3[] = [];
    for ( let i = 0; i < spread.length; i += 3 ) surface.push( new THREE.Vector3( spread[i], spread[i + 1], spread[i + 2] ) );
    return fitPart( [...e.corners].map( ( i ) => where[i] ), surface, 0, guard );
  } ) };
}
