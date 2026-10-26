// Bevel ( Ctrl+B ) on edges, after Blender's: each face's corners move in off the bevelled edges ( where two meet in a
// face, to where their offset lines cross; where one meets a plain edge, sliding along it ), a strip of `segments`
// faces joins the two sides along each bevelled edge ( curved round the old edge ), and the hole left at each corner
// gets a face. Only edges between two faces bevel.

import { add, cloneMesh, compact, dot, edgesOf, ek, faceNormal, len, mul, norm, runs, sub, type Mesh, type V3 } from "./mesh";
import { selFromFaces, type OpResult } from "./ops";

export function bevel( g0: Mesh, edges: Set<string>, width: number, segments = 1 ): OpResult {
  const info = edgesOf( g0 );
  const B    = new Set( [...edges].filter( ( k ) => info.get( k )?.faces.length === 2 ) );
  if ( !B.size || width <= 0 ) return { mesh: g0, sel: selFromFaces( g0, [] ) };
  const g       = cloneMesh( g0 );
  const isB     = ( a: number, b: number ) => B.has( ek( a, b ) );
  const touched = new Set<number>();
  for ( const k of B ) for ( const v of k.split( "_" ).map( Number ) ) touched.add( v );

  // A point on edge ( v, other ), slid from v: averaged over the faces that put one there.
  const slid  = new Map<string, { sum: V3; n: number; id: number }>();
  const slide = ( v: number, other: number, p: V3 ) => {
    const k = `${v}>${other}`;
    const s = slid.get( k );
    if ( s ) {
      s.sum = add( s.sum, p );
      s.n++;
    } else slid.set( k, { sum: p, n: 1, id: -1 } );
  };
  // The point each face corner moves to, by face and corner: a vertex id, or an edge's slid point.
  type Corner               = { kind: "point"; p: V3; id: number } | { kind: "slid"; v: number; other: number } | { kind: "keep" };
  const corners: Corner[][] = g0.f.map( ( f, fi ) => {
    const N = faceNormal( g0, fi );
    return f.map( ( v, i ) => {
      if ( !touched.has( v ) ) return { kind: "keep" };
      const p   = f[( i - 1 + f.length ) % f.length], n = f[( i + 1 ) % f.length];
      const bin = isB( p, v ), bout = isB( v, n );
      const P   = g0.v[v];
      const d1  = norm( sub( P, g0.v[p] ) ), d2 = norm( sub( g0.v[n], P ) );
      // inward sides of the corner's two edges, in the face's plane
      const in1 = norm( [N[1] * d1[2] - N[2] * d1[1], N[2] * d1[0] - N[0] * d1[2], N[0] * d1[1] - N[1] * d1[0]] );
      const in2 = norm( [N[1] * d2[2] - N[2] * d2[1], N[2] * d2[0] - N[0] * d2[2], N[0] * d2[1] - N[1] * d2[0]] );
      if ( bin && bout ) {
        const k   = 1 + dot( in1, in2 );
        const off = k > 1e-3 ? mul( add( in1, in2 ), width / k ) : mul( in1, width );
        return { kind: "point", p: add( P, off ), id: -1 };
      }
      if ( bin ) {
        // along the plain edge out of the corner, to where the bevel's offset line crosses it
        const reach = len( sub( g0.v[n], P ) ) * 0.95;
        const u     = Math.min( reach, width / Math.max( 0.05, dot( d2, in1 ) ) );
        slide( v, n, add( P, mul( d2, u ) ) );
        return { kind: "slid", v, other: n };
      }
      if ( bout ) {
        const back = mul( d1, -1 ), reach = len( sub( g0.v[p], P ) ) * 0.95;
        const u    = Math.min( reach, width / Math.max( 0.05, dot( back, in2 ) ) );
        slide( v, p, add( P, mul( back, u ) ) );
        return { kind: "slid", v, other: p };
      }
      return { kind: "keep" };
    } );
  } );
  for ( const s of slid.values() ) s.id = g.v.push( mul( s.sum, 1 / s.n ) ) - 1;
  for ( const cs of corners ) for ( const c of cs ) if ( c.kind === "point" ) c.id = g.v.push( c.p ) - 1;
  const idOf = ( c: Corner, v: number ) => ( c.kind === "point" ? c.id : c.kind === "slid" ? slid.get( `${c.v}>${c.other}` )!.id : v );

  // faces with their corners moved; a plain corner beside slid points takes them instead of itself
  const created = new Map<number, Set<number>>();
  const mark    = ( v: number, id: number ) => ( created.get( v ) ?? created.set( v, new Set() ).get( v )! ).add( id );
  g.f           = g0.f.map( ( f, fi ) =>
    f.flatMap( ( v, i ) => {
      const c = corners[fi][i];
      if ( c.kind !== "keep" ) {
        const id = idOf( c, v );
        mark( v, id );
        return [id];
      }
      if ( !touched.has( v ) ) return [v];
      const p             = f[( i - 1 + f.length ) % f.length], n = f[( i + 1 ) % f.length];
      const out: number[] = [];
      const a             = slid.get( `${v}>${p}` ), b = slid.get( `${v}>${n}` );
      if ( a ) out.push( a.id );
      if ( b ) out.push( b.id );
      if ( !out.length ) {
        mark( v, v );
        return [v];
      }
      for ( const x of out ) mark( v, x );
      return out;
    } ),
  );

  // the strips along the bevelled edges, curved round the old edge
  const stripFaces: number[] = [];
  const profile              = ( from: number, to: number, corner: V3, at: number ) => {
    const out = [from];
    for ( let k = 1; k < segments; k++ ) {
      const t  = k / segments;
      const p  = add( add( mul( g.v[from], ( 1 - t ) * ( 1 - t ) ), mul( corner, 2 * t * ( 1 - t ) ) ), mul( g.v[to], t * t ) );
      const id = g.v.push( p ) - 1;
      mark( at, id );
      out.push( id );
    }
    out.push( to );
    return out;
  };
  for ( const k of B ) {
    const e      = info.get( k )!;
    let [f1, f2] = e.faces;
    let a        = e.a, b = e.b;
    if ( !runs( g0.f[f1], a, b ) ) [a,  b ] = [b,  a ];
    if ( !runs( g0.f[f2], b, a ) ) [f1, f2] = [f2, f1];
    const at = ( fi: number, v: number ) => idOf( corners[fi][g0.f[fi].indexOf( v )], v );
    const A  = profile( at( f1, a ), at( f2, a ), g0.v[a], a ), Bp = profile( at( f1, b ), at( f2, b ), g0.v[b], b );
    for ( let s = 0; s < segments; s++ ) {
      stripFaces.push( g.f.length );
      g.f.push( [Bp[s], A[s], A[s + 1], Bp[s + 1]] );
      g.m.push( g0.m[f1] );
      g.s.push( segments > 1 || g0.s[f1] );
    }
  }

  // the corner patches: the holes left round each vertex, found by their open edges
  const use = new Map<string, number>();
  const dir = new Map<number, number[]>();
  g.f.forEach( ( f ) => {
    for ( let i = 0; i < f.length; i++ ) {
      const x = f[i], y = f[( i + 1 ) % f.length];
      use.set( ek( x, y ), ( use.get( ek( x, y ) ) ?? 0 ) + 1 );
    }
  } );
  g.f.forEach( ( f ) => {
    for ( let i = 0; i < f.length; i++ ) {
      const x = f[i], y = f[( i + 1 ) % f.length];
      // the patch runs an open edge the other way: y → x
      if ( use.get( ek( x, y ) ) === 1 ) ( dir.get( y ) ?? dir.set( y, [] ).get( y )! ).push( x );
    }
  } );
  const patchFaces: number[] = [];
  for ( const [, ids] of created ) {
    const left = new Set( [...ids].filter( ( id ) => dir.has( id ) ) );
    while ( left.size ) {
      const start = left.values().next().value!;
      const loop  = [start];
      let cur     = start;
      for ( let guard = 0; guard < 1000; guard++ ) {
        const next = ( dir.get( cur ) ?? [] ).find( ( x ) => ids.has( x ) );
        left.delete( cur );
        if ( next === undefined || next === start ) break;
        loop.push( next );
        cur = next;
      }
      if ( loop.length >= 3 && dir.get( cur )?.includes( start ) ) {
        patchFaces.push( g.f.length );
        g.f.push( loop );
        g.m.push( g0.m[0] ?? 0 );
        g.s.push( segments > 1 );
      }
    }
  }
  const keep     = new Set( [...stripFaces, ...patchFaces] );
  const { mesh } = compact( g );
  // ( compact keeps faces in order and drops none here: the selection carries over )
  return { mesh, sel: selFromFaces( mesh, [...keep].filter( ( i ) => i < mesh.f.length ) ) };
}

