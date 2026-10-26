// Fill ( F ) and Bridge Edge Loops.

import { type Mesh, type V3, add, cloneMesh, cross, dot, edgesOf, ek, ekv, faceNormal, len, mul, norm, runs, sub, vertexFaces } from "../mesh";
import { type OpResult, selFromEdges, selFromFaces, selFromVerts } from "./selection";

/**
 * Fill ( F ): an edge between two vertices, or a face through the selected ones ( along their open border when they
 * make one, else round their middle ), facing the way its neighbours do.
**/
export function fill( g0: Mesh, verts: number[] ): OpResult {
  const g = cloneMesh( g0 );
  if ( verts.length < 2 ) return { mesh: g, sel: selFromVerts( g, verts ) };
  if ( verts.length === 2 ) {
    const k = ek( verts[0], verts[1] );
    if ( !edgesOf( g ).has( k ) ) g.w.push( [verts[0], verts[1]] );
    return { mesh: g, sel: selFromVerts( g, verts ) };
  }
  const edges = edgesOf( g ), inSet = new Set( verts );
  // the open border ( edges with one face, or loose ) among them, walked round
  const nb    = new Map<number, number[]>();
  for ( const e of edges.values() )
    if ( e.faces.length <= 1 && inSet.has( e.a ) && inSet.has( e.b ) ) {
      ( nb.get( e.a ) ?? nb.set( e.a, [] ).get( e.a )! ).push( e.b );
      ( nb.get( e.b ) ?? nb.set( e.b, [] ).get( e.b )! ).push( e.a );
    }
  let loop: number[] | null = null;
  if ( verts.every( ( v ) => nb.get( v )?.length === 2 ) ) {
    loop     = [verts[0]];
    let prev = -1, cur = verts[0];
    for ( let k = 1; k < verts.length; k++ ) {
      const next = nb.get( cur )!.find( ( x ) => x !== prev )!;
      if ( next === verts[0] ) break;
      loop.push( next );
      prev = cur;
      cur  = next;
    }
    if ( loop.length !== verts.length ) loop = null;
  }
  let c: V3 = [0, 0, 0];
  for ( const v of verts ) c = add( c, g.v[v] );
  c = mul( c, 1 / verts.length );
  // the plane they lie nearest ( Newell's normal of their order round the middle )
  if ( !loop ) {
    let n: V3 = [0, 0, 0];
    for ( let i = 0; i < verts.length; i++ ) for ( let j = i + 1; j < verts.length; j++ ) n = add( n, cross( sub( g.v[verts[i]], c ), sub( g.v[verts[j]], c ) ) );
    n = norm( n );
    if ( len( n ) < 0.5 ) n = [0, 1, 0];
    const u = norm( Math.abs( n[1] ) < 0.9 ? cross( n, [0, 1, 0] ) : cross( n, [1, 0, 0] ) ), w = cross( n, u );
    loop    = [...verts].sort( ( a, b ) => {
      const da = sub( g.v[a], c ), db = sub( g.v[b], c );
      return Math.atan2( dot( da, w ), dot( da, u ) ) - Math.atan2( dot( db, w ), dot( db, u ) );
    } );
  }
  // facing: against any face already on one of its edges, else the way the vertices' faces face
  let flip = false, decided = false;
  for ( let i = 0; i < loop.length && !decided; i++ ) {
    const a = loop[i], b = loop[( i + 1 ) % loop.length];
    for ( const fi of edges.get( ek( a, b ) )?.faces ?? [] ) {
      flip    = runs( g.f[fi], a, b );
      decided = true;
    }
  }
  if ( !decided ) {
    const vf       = vertexFaces( g );
    let around: V3 = [0, 0, 0];
    for ( const v of loop ) for ( const fi of vf[v] ) around = add( around, faceNormal( g, fi ) );
    let n: V3 = [0, 0, 0];
    for ( let i = 1; i + 1 < loop.length; i++ ) n = add( n, cross( sub( g.v[loop[i]], g.v[loop[0]] ), sub( g.v[loop[i + 1]], g.v[loop[0]] ) ) );
    flip = len( around ) > 0.1 ? dot( n, around ) < 0 : n[1] < 0;
  }
  if ( flip ) loop.reverse();
  g.f.push( loop  );
  g.m.push( 0     );
  g.s.push( false );
  g.w = g.w.filter( ( [a, b] ) => !( inSet.has( a ) && inSet.has( b ) ) );
  return { mesh: g, sel: selFromFaces( g, [g.f.length - 1] ) };
}

/**
 * The selected edges as chains of vertices ( closed when they come round to their start ).
**/
export function edgeChains( edges: Set<string> ): { verts: number[]; closed: boolean }[] {
  const nb = new Map<number, number[]>();
  for ( const k of edges ) {
    const [a, b] = ekv( k );
    ( nb.get( a ) ?? nb.set( a, [] ).get( a )! ).push( b );
    ( nb.get( b ) ?? nb.set( b, [] ).get( b )! ).push( a );
  }
  const seen   = new Set<number>(), out: { verts: number[]; closed: boolean }[] = [];
  // open chains from their ends first, then the loops left
  const starts = [...nb.keys()].sort( ( a, b ) => ( nb.get( a )!.length === 1 ? 0 : 1 ) - ( nb.get( b )!.length === 1 ? 0 : 1 ) );
  for ( const s of starts ) {
    if ( seen.has( s ) ) continue;
    const verts = [s];
    seen.add( s );
    let cur = s, closed = false;
    for ( ;; ) {
      const next = nb.get( cur )!.find( ( x ) => !seen.has( x ) );
      if ( next === undefined ) {
        closed = verts.length > 2 && nb.get( cur )!.includes( s );
        break;
      }
      verts.push( next );
      seen.add( next );
      cur = next;
    }
    out.push( { verts, closed } );
  }
  return out;
}

/**
 * Bridge Edge Loops: two selected loops ( or chains ) of the same length joined by a band of quads, lined up by their
 * nearest vertices and running the way that keeps the band untwisted, facing as their neighbours do.
**/
export function bridge( g0: Mesh, edges: Set<string> ): OpResult {
  const chains = edgeChains( edges );
  if ( chains.length !== 2 || chains[0].verts.length !== chains[1].verts.length || chains[0].closed !== chains[1].closed )
    return { mesh: g0, sel: selFromEdges( g0, [...edges] ) };
  const g            = cloneMesh( g0 );
  const A            = chains[0].verts;
  let B              = [...chains[1].verts];
  const n            = A.length, closed = chains[0].closed;
  const d            = ( a: number, b: number ) => len( sub( g.v[a], g.v[b] ) );
  // B turned and started to fit A best
  let best: number[] = B, bd = Infinity;
  for ( const rev of [false, true] ) {
    const base = rev ? [...B].reverse() : B;
    for ( let off = 0; off < ( closed ? n : 1 ); off++ ) {
      const cand = base.map( ( _, i ) => base[( i + off ) % n] );
      const cost = A.reduce( ( s, a, i ) => s + d( a, cand[i] ), 0 );
      if ( cost < bd ) { bd = cost; best = cand; }
    }
  }
  B                     = best;
  const info            = edgesOf( g0 );
  const faces: number[] = [];
  const segs            = closed ? n : n - 1;
  for ( let i = 0; i < segs; i++ ) {
    const a0   = A[i], a1 = A[( i + 1 ) % n], b0 = B[i], b1 = B[( i + 1 ) % n];
    // against the face already on A's edge ( it runs it one way; the band runs it the other )
    const nf   = info.get( ek( a0, a1 ) )?.faces[0];
    const quad = nf !== undefined && runs( g0.f[nf], a0, a1 ) ? [a1, a0, b0, b1] : [a0, a1, b1, b0];
    faces.push( g.f.length );
    g.f.push( quad );
    g.m.push( nf !== undefined ? g0.m[nf] : 0 );
    g.s.push( nf !== undefined ? g0.s[nf] : false );
  }
  g.w = g.w.filter( ( [a, b] ) => !edges.has( ek( a, b ) ) );
  return { mesh: g, sel: selFromFaces( g, faces ) };
}
