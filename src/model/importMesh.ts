// A piece's meshes ( a library piece, the game's features, an import ) made into a model to edit: its triangles put
// in the piece's own space and welded, flat regions made into one face each and the rest paired back into quads
// ( as Blender's Tris to Quads ), with what each triangle looked like kept for baking into the model's paint.

import * as THREE from "three";
import type { Mesh, V3 } from "./mesh";

// A part's mesh as stored ( Unity space, the part's own ): positions and normals ×3, UVs ×2, triangles by submesh.
export interface SourceMesh {
  pos:       Float32Array;
  nrm:       Float32Array;
  uv:        Float32Array;
  idx:       Uint32Array;
  submeshes: number[];
}

// The triangles of all the parts, in the piece's own space ( Unity, unscaled ), with their UVs, corner normals and
// material slot.
export interface SourceTris {
  pos:     Float32Array;
  nrm:     Float32Array;
  uv:      Float32Array;
  slot:    Int32Array;
  // smooth or flat per triangle, when known ( else from how its corners' normals lean )
  smooth?: Uint8Array;
}

const F = new THREE.Matrix4().makeScale( 1, 1, -1 );

/**
 * A part's Unity-space mesh into the piece's space: `part` and `root` are their transforms as three.js matrices
 * ( core/transform composeUnity ).
**/
export function partToPiece( part: THREE.Matrix4, root: THREE.Matrix4 ) {
  return F.clone().multiply( root.clone().invert() ).multiply( part ).multiply( F );
}

/**
 * The parts' triangles together; each part's submesh i is slot `slotBase + i`.
**/
export function gatherTris( parts: { mesh: SourceMesh; matrix: THREE.Matrix4; slotBase: number; slots: number }[] ): SourceTris {
  let n = 0;
  for ( const p of parts ) n += p.mesh.idx.length / 3;
  const out: SourceTris = { pos: new Float32Array( n * 9 ), nrm: new Float32Array( n * 9 ), uv: new Float32Array( n * 6 ), slot: new Int32Array( n ) };
  let t                 = 0;
  const v               = new THREE.Vector3(), nm = new THREE.Matrix3();
  for ( const p of parts ) {
    nm.getNormalMatrix( p.matrix );
    let start = 0;
    p.mesh.submeshes.forEach( ( count, sub ) => {
      const slot = p.slotBase + Math.min( sub, Math.max( 0, p.slots - 1 ) );
      for ( let i = start; i + 2 < start + count; i += 3, t++ ) {
        for ( let c = 0; c < 3; c++ ) {
          const k = p.mesh.idx[i + c];
          v.set( p.mesh.pos[k * 3], p.mesh.pos[k * 3 + 1], p.mesh.pos[k * 3 + 2] ).applyMatrix4( p.matrix );
          out.pos.set( [v.x, v.y, v.z], t * 9 + c * 3 );
          v.set( p.mesh.nrm[k * 3], p.mesh.nrm[k * 3 + 1], p.mesh.nrm[k * 3 + 2] ).applyMatrix3( nm ).normalize();
          out.nrm.set( [v.x, v.y, v.z], t * 9 + c * 3 );
          out.uv.set( [p.mesh.uv[k * 2], p.mesh.uv[k * 2 + 1]], t * 6 + c * 2 );
        }
        out.slot[t] = slot;
      }
      start += count;
    } );
  }
  return out;
}

const sub3   = ( a: V3, b: V3 ): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = ( a: V3, b: V3 ): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3   = ( a: V3, b: V3 ) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3   = ( a: V3 ) => Math.hypot( a[0], a[1], a[2] );

/**
 * The triangles as an editable mesh: corners closer than a tenth of a millimetre welded, flat regions of one slot
 * made into one face ( where they have a single outline ), the rest paired into quads across their longest edges
 * where the two are nearly flat and the quad is convex. Faces whose corners were shaded smooth are smooth.
**/
export function trisToMesh( src: SourceTris ): Mesh {
  const ids  = new Map<string, number>(), v: V3[] = [];
  const weld = ( x: number, y: number, z: number ) => {
    const key = `${Math.round( x * 1e4 )},${Math.round( y * 1e4 )},${Math.round( z * 1e4 )}`;
    let i     = ids.get( key );
    if ( i === undefined ) { ids.set( key, ( i = v.length ) ); v.push( [x, y, z] ); }
    return i;
  };
  // the triangles kept: welded, without slivers or a second copy ( the back of a two-sided face )
  type Tri          = { c: [number, number, number]; n: V3; slot: number; smooth: boolean };
  const tris: Tri[] = [];
  const seen        = new Set<string>();
  const nT          = src.slot.length;
  for ( let t = 0; t < nT; t++ ) {
    const c = [0, 1, 2].map( ( k ) => weld( src.pos[t * 9 + k * 3], src.pos[t * 9 + k * 3 + 1], src.pos[t * 9 + k * 3 + 2] ) ) as [number, number, number];
    if ( c[0] === c[1] || c[1] === c[2] || c[0] === c[2] ) continue;
    const n = cross3( sub3( v[c[1]], v[c[0]] ), sub3( v[c[2]], v[c[0]] ) );
    const l = len3( n );
    if ( l < 1e-10 ) continue;
    const key = [...c].sort( ( a, b ) => a - b ).join( "," );
    if ( seen.has( key ) ) continue;
    seen.add( key );
    const fn: V3 = [n[0] / l, n[1] / l, n[2] / l];
    // smooth: its corners' normals lean away from the face's
    let lean     = 0;
    for ( let k = 0; k < 3; k++ ) lean = Math.max( lean, 1 - dot3( fn, [src.nrm[t * 9 + k * 3], src.nrm[t * 9 + k * 3 + 1], src.nrm[t * 9 + k * 3 + 2]] ) );
    tris.push( { c, n: fn, slot: src.slot[t], smooth: src.smooth ? src.smooth[t] === 1 : lean > 1e-3 } );
  }
  // each directed edge's triangle ( an edge two triangles run the same way along isn't shared )
  const half = new Map<string, number>();
  tris.forEach( ( t, i ) => {
    for ( let k = 0; k < 3; k++ ) half.set( `${t.c[k]},${t.c[( k + 1 ) % 3]}`, i );
  } );
  const across = ( i: number, k: number ) => {
    const t = tris[i];
    return half.get( `${t.c[( k + 1 ) % 3]},${t.c[k]}` ) ?? -1;
  };
  // flat regions: neighbours in one plane with the same slot
  const parent = tris.map( ( _, i ) => i );
  const find   = ( i: number ): number => ( parent[i] === i ? i : ( parent[i] = find( parent[i] ) ) );
  tris.forEach( ( t, i ) => {
    for ( let k = 0; k < 3; k++ ) {
      const j = across( i, k );
      if ( j < 0 || j < i ) continue;
      const u = tris[j];
      if ( u.slot !== t.slot || dot3( u.n, t.n ) < 0.99999 ) continue;
      const far = u.c.find( ( x ) => !t.c.includes( x ) )!;
      if ( Math.abs( dot3( sub3( v[far], v[t.c[0]] ), t.n ) ) > 1e-4 ) continue;
      parent[find( j )] = find( i );
    }
  } );
  const groups = new Map<number, number[]>();
  tris.forEach( ( _, i ) => {
    const r = find( i );
    const g = groups.get( r );
    if ( g ) g.push( i );
    else groups.set( r, [i] );
  } );
  const f:     number[][] = [], m: number[] = [], s: boolean[] = [];
  const loose: number[]   = [];
  for ( const g of groups.values() ) {
    if ( g.length === 1 ) {
      loose.push( g[0] );
      continue;
    }
    // the region's outline: its edges no other triangle of it shares, walked round
    const inG = new Set( g ), next = new Map<number, number>();
    let ok    = true;
    for ( const i of g )
      for ( let k = 0; k < 3; k++ ) {
        const j = across( i, k );
        if ( j >= 0 && inG.has( j ) ) continue;
        const a = tris[i].c[k], b = tris[i].c[( k + 1 ) % 3];
        if ( next.has( a ) ) ok = false;
        next.set( a, b );
      }
    const loop: number[] = [];
    if ( ok && next.size ) {
      const first = next.keys().next().value as number;
      let at      = first;
      do {
        loop.push( at );
        at = next.get( at )!;
      } while ( at !== undefined && at !== first && loop.length <= next.size );
      ok = at === first && loop.length === next.size;
    }
    if ( !ok ) {
      loose.push( ...g );
      continue;
    }
    f.push( loop );
    m.push( tris[g[0]].slot );
    s.push( g.some( ( i ) => tris[i].smooth ) );
  }
  // the rest in pairs, across shared longest edges, best ( flattest ) first
  const longest = ( i: number ) => {
    const t  = tris[i];
    let best = 0, bl = -1;
    for ( let k = 0; k < 3; k++ ) {
      const l = len3( sub3( v[t.c[( k + 1 ) % 3]], v[t.c[k]] ) );
      if ( l > bl ) { bl = l; best = k; }
    }
    return best;
  };
  const isLoose = new Set( loose ), paired = new Set<number>();
  const pairs: { i: number; j: number; k: number; score: number }[] = [];
  for ( const i of loose ) {
    const k = longest( i ), j = across( i, k );
    if ( j < 0 || j < i || !isLoose.has( j ) ) continue;
    const t = tris[i], u = tris[j];
    if ( u.slot !== t.slot || dot3( u.n, t.n ) < Math.cos( ( 40 * Math.PI ) / 180 ) ) continue;
    // the same edge is the other's longest too
    const ku = longest( j );
    if ( u.c[ku] !== t.c[( k + 1 ) % 3] || u.c[( ku + 1 ) % 3] !== t.c[k] ) continue;
    const quad = quadOf( t.c, k, u.c );
    if ( !convex( v, quad ) ) continue;
    pairs.push( { i, j, k, score: dot3( u.n, t.n ) } );
  }
  pairs.sort( ( a, b ) => b.score - a.score );
  for ( const p of pairs ) {
    if ( paired.has( p.i ) || paired.has( p.j ) ) continue;
    paired.add( p.i );
    paired.add( p.j );
    f.push( quadOf( tris[p.i].c, p.k, tris[p.j].c ) );
    m.push( tris[p.i].slot );
    s.push( tris[p.i].smooth || tris[p.j].smooth );
  }
  for ( const i of loose ) {
    if ( paired.has( i ) ) continue;
    f.push( [...tris[i].c] );
    m.push( tris[i].slot );
    s.push( tris[i].smooth );
  }
  // only the vertices used, in order
  const used = new Map<number, number>(), vv: V3[] = [];
  const ff   = f.map( ( face ) => face.map( ( x ) => {
    let k = used.get( x );
    if ( k === undefined ) { used.set( x, ( k = vv.length ) ); vv.push( v[x] ); }
    return k;
  } ) );
  return { v: vv, f: ff, m, s, w: [] };
}

/**
 * The quad of triangle `a` and its neighbour `b` across a's edge k ( a[k] → a[k+1] ).
**/
function quadOf( a: [number, number, number], k: number, b: [number, number, number] ) {
  const p   = a[( k + 2 ) % 3], q = a[k], r = a[( k + 1 ) % 3];
  const far = b.find( ( x ) => x !== q && x !== r )!;
  return [p, q, far, r];
}

/**
 * Whether a quad turns the same way at every corner ( and is close to flat ).
**/
function convex( v: V3[], q: number[] ) {
  const n = cross3( sub3( v[q[2]], v[q[0]] ), sub3( v[q[3]], v[q[1]] ) );
  const l = len3( n );
  if ( l < 1e-12 ) return false;
  for ( let i = 0; i < 4; i++ ) {
    const a = v[q[i]], b = v[q[( i + 1 ) % 4]], c = v[q[( i + 2 ) % 4]];
    if ( dot3( cross3( sub3( b, a ), sub3( c, b ) ), n ) <= 0 ) return false;
  }
  return true;
}
