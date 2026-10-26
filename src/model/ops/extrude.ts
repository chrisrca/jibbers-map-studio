// Extrude ( E: faces, edges, vertices ), Spin, and Inset ( I ).

import { type Mesh, type V3, add, cloneMesh, compact, cross, dot, edgesOf, ek, ekv, faceNormal, len, mul, norm, recalcOutside, runs, sub } from "../mesh";
import { merge } from "./delete";
import { type OpResult, type Sel, selFromEdges, selFromFaces, selFromVerts, tidy } from "./selection";

/**
 * Edges on the border of a set of faces ( used by exactly one of them ), as each runs in its face.
**/
export function regionBorder( g: Mesh, faces: Set<number> ): [number, number][] {
  const count = new Map<string, number>();
  for ( const fi of faces ) {
    const f = g.f[fi];
    for ( let i = 0; i < f.length; i++ ) {
      const k = ek( f[i], f[( i + 1 ) % f.length] );
      count.set( k, ( count.get( k ) ?? 0 ) + 1 );
    }
  }
  const out: [number, number][] = [];
  for ( const fi of faces ) {
    const f = g.f[fi];
    for ( let i = 0; i < f.length; i++ ) {
      const a = f[i], b = f[( i + 1 ) % f.length];
      if ( count.get( ek( a, b ) ) === 1 ) out.push( [a, b] );
    }
  }
  return out;
}

/**
 * The average normal of some faces ( the way an extrusion goes ).
**/
export function regionNormal( g: Mesh, faces: Iterable<number> ): V3 {
  let n: V3 = [0, 0, 0];
  for ( const fi of faces ) n = add( n, faceNormal( g, fi ) );
  return norm( n );
}

/**
 * Extrude Region ( E on faces ): the faces lifted off with sides joining them to where they were ( not moved yet ).
**/
export function extrudeFaces( g0: Mesh, faces: Set<number> ): OpResult & { normal: V3 } {
  const g      = cloneMesh( g0 );
  const normal = regionNormal( g, faces );
  const copy   = new Map<number, number>();
  const dup    = ( v: number ) => {
    let c = copy.get( v );
    if ( c === undefined ) copy.set( v, ( c = g.v.push( [...g.v[v]] as V3 ) - 1 ) );
    return c;
  };
  const border = regionBorder( g0, faces );
  for ( const [a, b] of border ) {
    g.f.push( [a, b, dup( b ), dup( a )] );
    g.m.push( 0 );
    g.s.push( false );
  }
  // material and shading of the side faces from the face they come off
  const sideOf = new Map<string, number>();
  for ( const fi of faces ) {
    const f = g0.f[fi];
    for ( let i = 0; i < f.length; i++ ) sideOf.set( `${f[i]}>${f[( i + 1 ) % f.length]}`, fi );
  }
  border.forEach( ( [a, b], k ) => {
    const src            = sideOf.get( `${a}>${b}` ) ?? 0;
    g.m[g0.f.length + k] = g0.m[src] ?? 0;
    g.s[g0.f.length + k] = g0.s[src] ?? false;
  } );
  for ( const fi of faces ) g.f[fi] = g.f[fi].map( dup );
  // ( faces now unused corners, e.g. a region's inside, go with compact )
  const res = tidy( g, [...faces] );
  return { ...res, normal };
}

/**
 * Extrude on edges ( no faces selected ): a face off each edge.
**/
export function extrudeEdges( g0: Mesh, edges: Set<string> ): OpResult {
  const g    = cloneMesh( g0 );
  const info = edgesOf( g0 );
  const copy = new Map<number, number>();
  const dup  = ( v: number ) => {
    let c = copy.get( v );
    if ( c === undefined ) copy.set( v, ( c = g.v.push( [...g.v[v]] as V3 ) - 1 ) );
    return c;
  };
  const newEdges: string[] = [];
  for ( const k of edges ) {
    const [a, b]  = ekv( k );
    const e       = info.get( k );
    // against the face it borders, so the new one carries on its surface
    const forward = e?.faces.length ? runs( g0.f[e.faces[0]], a, b ) : false;
    g.f.push( forward ? [b, a, dup( a ), dup( b )] : [a, b, dup( b ), dup( a )] );
    g.m.push( e?.faces.length ? g0.m[e.faces[0]] : 0 );
    g.s.push( e?.faces.length ? g0.s[e.faces[0]] : false );
    newEdges.push( ek( dup( a ), dup( b ) ) );
  }
  g.w                 = g.w.filter( ( [a, b] ) => !edges.has( ek( a, b ) ) );
  const { mesh, map } = compact( g );
  return { mesh, sel: selFromEdges( mesh, newEdges.map( ( k ) => ekv( k ) ).map( ( [a, b] ) => ek( map[a], map[b] ) ) ) };
}

/**
 * Spin ( Blender's ): the selected edges ( or lone vertices ) swept round `axis` through `centre` by `angle` radians in
 * `steps`, a ring of faces ( or edges ) per step. A whole turn closes up on itself.
**/
export function spin( g0: Mesh, sel: Sel, centre: V3, axis: V3, angle: number, steps: number ): OpResult {
  const k    = norm( axis ), n = Math.max( 1, Math.round( steps ) ), step = angle / n;
  const c    = Math.cos( step ), s = Math.sin( step );
  const turn = ( p: V3 ): V3 => {
    // Rodrigues: about k through the centre
    const v = sub( p, centre ), kv = cross( k, v ), kd = dot( k, v );
    return add( centre, add( add( mul( v, c ), mul( kv, s ) ), mul( k, kd * ( 1 - c ) ) ) );
  };
  const start = [...sel.v].map( ( v ) => g0.v[v] );
  let g       = g0, cur = sel;
  const made  = new Set<number>();
  for ( let i = 0; i < n; i++ ) {
    const r = cur.e.size ? extrudeEdges( g, cur.e ) : extrudeVerts( g, cur.v );
    for ( const v of r.sel.v ) r.mesh.v[v] = turn( r.mesh.v[v] );
    for ( let f = g.f.length; f < r.mesh.f.length; f++ ) made.add( f );
    g   = r.mesh;
    cur = r.sel;
  }
  // a whole turn: the last ring is the first
  if ( Math.abs( Math.abs( angle ) - Math.PI * 2 ) < 1e-6 ) {
    const near = ( p: V3 ) => start.some( ( q ) => len( sub( p, q ) ) < 1e-5 );
    const ring = g.v.map( ( _, i ) => i ).filter( ( i ) => near( g.v[i] ) );
    const r    = merge( g, ring, "distance", 1e-5 );
    return { mesh: recalcOutside( r.mesh ), sel: r.sel };
  }
  return { mesh: made.size ? recalcOutside( g, made ) : g, sel: cur };
}

/**
 * Extrude on lone vertices: a loose edge from each.
**/
export function extrudeVerts( g0: Mesh, verts: Set<number> ): OpResult {
  const g             = cloneMesh( g0 );
  const out: number[] = [];
  for ( const v of verts ) {
    const c = g.v.push( [...g.v[v]] as V3 ) - 1;
    g.w.push( [v, c] );
    out.push( c );
  }
  return { mesh: g, sel: selFromVerts( g, out ) };
}

/**
 * Inset Faces ( I ): a ring of faces inside the region's border, `thickness` in from it and `depth` out along its
 * normal. `individual`: each face on its own.
**/
export function inset( g0: Mesh, faces: Set<number>, thickness: number, depth = 0, individual = false ): OpResult {
  if ( individual && faces.size > 1 ) {
    let g                = g0;
    const keep: number[] = [];
    // one face at a time ( indices stay put: inset only appends )
    for ( const fi of faces ) {
      const r = insetRegion( g, new Set( [fi] ), thickness, depth );
      g       = r.mesh;
      keep.push( fi );
    }
    return { mesh: g, sel: selFromFaces( g, keep ) };
  }
  const r = insetRegion( g0, faces, thickness, depth );
  return { mesh: r.mesh, sel: selFromFaces( r.mesh, [...faces] ) };
}

function insetRegion( g0: Mesh, faces: Set<number>, thickness: number, depth: number ) {
  const g          = cloneMesh( g0 );
  const border     = regionBorder( g0, faces );
  const normal     = regionNormal( g0, faces );
  // for each border vertex: the way in ( the mitred sum of its border edges' inward sides, in their faces' planes )
  const faceOfEdge = new Map<string, number>();
  for ( const fi of faces ) {
    const f = g0.f[fi];
    for ( let i = 0; i < f.length; i++ ) faceOfEdge.set( `${f[i]}>${f[( i + 1 ) % f.length]}`, fi );
  }
  const ins = new Map<number, V3[]>();
  for ( const [a, b] of border ) {
    const n      = faceNormal( g0, faceOfEdge.get( `${a}>${b}` )! );
    const inward = norm( cross( n, norm( sub( g0.v[b], g0.v[a] ) ) ) );
    for ( const v of [a, b] ) {
      let l = ins.get( v );
      if ( !l ) ins.set( v, ( l = [] ) );
      l.push( inward );
    }
  }
  const copy = new Map<number, number>();
  for ( const [v, dirs] of ins ) {
    let m: V3 = [0, 0, 0];
    for ( const d of dirs ) m = add( m, d );
    m       = norm( m );
    const k = Math.max( 0.25, Math.min( ...dirs.map( ( d ) => dot( m, d ) ) ) );
    const p = add( add( g0.v[v], mul( m, thickness / k ) ), mul( normal, depth ) );
    copy.set( v, g.v.push( p ) - 1 );
  }
  // the region's inside vertices move out with it
  if ( depth ) {
    const inside = new Set<number>();
    for ( const fi of faces ) for ( const v of g0.f[fi] ) if ( !copy.has( v ) ) inside.add( v );
    for ( const v of inside ) g.v[v] = add( g.v[v], mul( normal, depth ) );
  }
  for ( const [a, b] of border ) {
    const src = faceOfEdge.get( `${a}>${b}` )!;
    g.f.push( [a, b, copy.get( b )!, copy.get( a )!] );
    g.m.push( g0.m[src] ?? 0 );
    g.s.push( g0.s[src] ?? false );
  }
  for ( const fi of faces ) g.f[fi] = g.f[fi].map( ( v ) => copy.get( v ) ?? v );
  return { mesh: g };
}
