// What's selected ( vertices, edges and faces kept in step ), what an operator gives back, and linked / grouped picks.

import { type Mesh, compact, edgesOf, ek, ekv } from "../mesh";

export type SelectMode = "vert" | "edge" | "face";

// What's selected: vertices, edges ( keys ) and faces, kept in step ( an edge's ends, a face's corners ).
export interface Sel {
  v: Set<number>;
  e: Set<string>;
  f: Set<number>;
}

export const emptySel = (): Sel => ( { v: new Set(), e: new Set(), f: new Set() } );

/**
 * A selection filled in from faces ( their edges and corners ), or edges ( their ends ).
**/
export function selFromFaces( g: Mesh, faces: Iterable<number>, extraVerts: Iterable<number> = [] ): Sel {
  const s = emptySel();
  for ( const fi of faces ) {
    const f = g.f[fi];
    if ( !f ) continue;
    s.f.add( fi );
    for ( let i = 0; i < f.length; i++ ) {
      s.v.add( f[i] );
      s.e.add( ek( f[i], f[( i + 1 ) % f.length] ) );
    }
  }
  for ( const v of extraVerts ) s.v.add( v );
  return s;
}

export function selFromEdges( g: Mesh, edges: Iterable<string> ): Sel {
  const s = emptySel();
  for ( const k of edges ) {
    s.e.add( k );
    for ( const v of ekv( k ) ) s.v.add( v );
  }
  // faces all of whose edges are now selected
  g.f.forEach( ( f, fi ) => {
    if ( f.every( ( a, i ) => s.e.has( ek( a, f[( i + 1 ) % f.length] ) ) ) ) s.f.add( fi );
  } );
  return s;
}

export function selFromVerts( g: Mesh, verts: Iterable<number> ): Sel {
  const s = emptySel();
  for ( const v of verts ) s.v.add( v );
  for ( const e of edgesOf( g ).values() ) if ( s.v.has( e.a ) && s.v.has( e.b ) ) s.e.add( ek( e.a, e.b ) );
  g.f.forEach( ( f, fi ) => {
    if ( f.every( ( v ) => s.v.has( v ) ) ) s.f.add( fi );
  } );
  return s;
}

export interface OpResult {
  mesh: Mesh;
  sel:  Sel;
}

/**
 * compact() keeping track of where faces went ( by their corner lists ).
**/
export function tidy( g: Mesh, selFaces: number[], selVerts: Iterable<number> = [] ): OpResult {
  const keep              = new Set( selFaces );
  const marked            = g.f.map( ( _, fi ) => keep.has( fi ) );
  // compact drops faces in order; follow them
  const tmp: Mesh         = { ...g, f: g.f.map( ( f ) => f ) };
  const { mesh, map }     = compact( tmp );
  const faceIds: number[] = [];
  let k                   = 0;
  g.f.forEach( ( f, fi ) => {
    const out: number[] = [];
    for ( const i of f ) if ( out[out.length - 1] !== i ) out.push( i );
    while ( out.length > 1 && out[0] === out[out.length - 1] ) out.pop();
    if ( new Set( out ).size < 3 ) return;
    if ( marked[fi] ) faceIds.push( k );
    k++;
  } );
  const sel = selFromFaces( mesh, faceIds, [...selVerts].map( ( v ) => map[v] ).filter( ( v ) => v >= 0 ) );
  return { mesh, sel };
}

/**
 * Separates loose parts: each connected set of faces ( and loose edges ) by itself, for colliders and Select Linked.
**/
export function linked( g: Mesh, startVerts: Iterable<number> ): Set<number> {
  const nb: number[][] = g.v.map( () => [] );
  for ( const e of edgesOf( g ).values() ) {
    nb[e.a].push( e.b );
    nb[e.b].push( e.a );
  }
  const out = new Set<number>(), stack = [...startVerts];
  for ( const v of stack ) out.add( v );
  while ( stack.length ) {
    const v = stack.pop()!;
    for ( const x of nb[v] ) if ( !out.has( x ) ) { out.add( x ); stack.push( x ); }
  }
  return out;
}

/**
 * The vertices in connected groups ( for Individual Origins ), by the selected edges among them.
**/
export function selectedGroups( g: Mesh, sel: Sel ): number[][] {
  const verts = [...sel.v];
  const inSet = new Set( verts ), seen = new Set<number>(), out: number[][] = [];
  // ( joined by the selected edges: a box's top and bottom faces are two groups, not one through its sides )
  const nb    = new Map<number, number[]>();
  for ( const k of sel.e ) {
    const [a, b] = ekv( k );
    if ( !inSet.has( a ) || !inSet.has( b ) ) continue;
    ( nb.get( a ) ?? nb.set( a, [] ).get( a )! ).push( b );
    ( nb.get( b ) ?? nb.set( b, [] ).get( b )! ).push( a );
  }
  for ( const v of verts ) {
    if ( seen.has( v ) ) continue;
    const grp: number[] = [], stack = [v];
    seen.add( v );
    while ( stack.length ) {
      const x = stack.pop()!;
      grp.push( x );
      for ( const y of nb.get( x ) ?? [] ) if ( !seen.has( y ) ) { seen.add( y ); stack.push( y ); }
    }
    out.push( grp );
  }
  return out;
}
