// Blender's Select menu, worked out on a mesh: Select More / Less ( Ctrl+Numpad + / - ), Invert ( Ctrl+I ), the
// shortest path between two picks ( Ctrl+click ), as each select mode has it. Pure: the editor applies them.

import { type Mesh, type V3, edgesOf, ek, ekv, faceCenter, len, sub } from "../mesh";
import { type Sel, type SelectMode, selFromEdges, selFromFaces, selFromVerts } from "./selection";

/**
 * Select More ( Blender's, stepping by faces ): every corner of a face touching the selection; in face mode, every
 * face sharing a corner with a selected one.
**/
export function selectMore( g: Mesh, sel: Sel, mode: SelectMode ): Sel {
  if ( mode === "face" ) return selFromFaces( g, g.f.flatMap( ( f, fi ) => ( sel.f.has( fi ) || f.some( ( v ) => sel.v.has( v ) ) ? [fi] : [] ) ) );
  const more = new Set( sel.v );
  for ( const f of g.f ) if ( f.some( ( v ) => sel.v.has( v ) ) ) for ( const v of f ) more.add( v );
  // ( loose edges: their other ends )
  for ( const [a, b] of g.w ) if ( sel.v.has( a ) || sel.v.has( b ) ) { more.add( a ); more.add( b ); }
  return mode === "edge" ? selFromEdges( g, [...edgesOf( g ).keys(), ...g.w.map( ( [a, b] ) => ek( a, b ) )].filter( ( k ) => ekv( k ).every( ( v ) => more.has( v ) ) ) ) : selFromVerts( g, more );
}

/**
 * Select Less ( Blender's, stepping by faces ): off every corner sharing a face with an unselected one ( a mesh's
 * open border doesn't count: all of it selected stays so ); in face mode, every face sharing a corner with one.
**/
export function selectLess( g: Mesh, sel: Sel, mode: SelectMode ): Sel {
  const out = new Set<number>();
  for ( const f of g.f ) if ( f.some( ( v ) => !sel.v.has( v ) ) ) for ( const v of f ) out.add( v );
  for ( const [a, b] of g.w ) if ( !sel.v.has( a ) || !sel.v.has( b ) ) { out.add( a ); out.add( b ); }
  if ( mode === "face" ) return selFromFaces( g, [...sel.f].filter( ( fi ) => g.f[fi].every( ( v ) => !out.has( v ) ) ) );
  const keep = new Set( [...sel.v].filter( ( v ) => !out.has( v ) ) );
  return mode === "edge" ? selFromEdges( g, [...sel.e].filter( ( k ) => ekv( k ).every( ( v ) => keep.has( v ) ) ) ) : selFromVerts( g, keep );
}

/**
 * Invert ( Ctrl+I ): what isn't selected, of the select mode's own elements ( the hidden left out ).
**/
export function invertSel( g: Mesh, sel: Sel, mode: SelectMode, shown?: Set<number> ): Sel {
  const seen = ( f: number ) => !shown || shown.has( f );
  if ( mode === "face" ) return selFromFaces( g, g.f.flatMap( ( _, fi ) => ( !sel.f.has( fi ) && seen( fi ) ? [fi] : [] ) ) );
  if ( mode === "edge" ) {
    const all = [...edgesOf( g ).keys(), ...g.w.map( ( [a, b] ) => ek( a, b ) )];
    return selFromEdges( g, all.filter( ( k ) => !sel.e.has( k ) ) );
  }
  return selFromVerts( g, g.v.flatMap( ( _, i ) => ( sel.v.has( i ) ? [] : [i] ) ) );
}

/**
 * Pick Shortest Path ( Ctrl+click ): from the active element to the one clicked, along the mesh ( the shortest by
 * length: vertices along edges, edges between their middles, faces between their centres ), as elements of the mode.
**/
export function shortestPath( g: Mesh, from: number | string, to: number | string, mode: SelectMode ): ( number | string )[] {
  const info = edgesOf( g );
  // ( each element's neighbours and where it is )
  let nodes: ( number | string )[], at: ( n: number | string ) => V3, near: ( n: number | string ) => ( number | string )[];
  if ( mode === "vert" ) {
    const nb = g.v.map( (): number[] => [] );
    for ( const e of info.values() ) { nb[e.a].push( e.b ); nb[e.b].push( e.a ); }
    for ( const [a, b] of g.w ) { nb[a].push( b ); nb[b].push( a ); }
    nodes = g.v.map( ( _, i ) => i );
    at    = ( n ) => g.v[n as number];
    near  = ( n ) => nb[n as number];
  } else if ( mode === "edge" ) {
    const byV = new Map<number, string[]>();
    for ( const k of info.keys() ) for ( const v of ekv( k ) ) ( byV.get( v ) ?? byV.set( v, [] ).get( v )! ).push( k );
    nodes = [...info.keys()];
    at    = ( n ) => {
      const [a, b] = ekv( n as string );
      return g.v[a].map( ( x, i ) => ( x + g.v[b][i] ) / 2 ) as V3;
    };
    near  = ( n ) => ekv( n as string ).flatMap( ( v ) => byV.get( v ) ?? [] ).filter( ( k ) => k !== n );
  } else {
    nodes = g.f.map( ( _, i ) => i );
    at    = ( n ) => faceCenter( g, n as number );
    near  = ( n ) => {
      const f = g.f[n as number];
      return f.flatMap( ( v, i ) => info.get( ek( v, f[( i + 1 ) % f.length] ) )?.faces ?? [] ).filter( ( x ) => x !== n );
    };
  }
  // Dijkstra ( small meshes: a plain scan for the nearest left )
  const dist = new Map<number | string, number>( nodes.map( ( n ) => [n, Infinity] ) ), prev = new Map<number | string, number | string>();
  const done = new Set<number | string>();
  dist.set( from, 0 );
  for ( ;; ) {
    let cur: number | string | null = null, best = Infinity;
    for ( const [n, d] of dist ) if ( !done.has( n ) && d < best ) { best = d; cur = n; }
    if ( cur === null || cur === to ) break;
    done.add( cur );
    for ( const n of near( cur ) ) {
      const d = best + len( sub( at( n ), at( cur ) ) );
      if ( d < ( dist.get( n ) ?? Infinity ) - 1e-12 ) { dist.set( n, d ); prev.set( n, cur ); }
    }
  }
  if ( !Number.isFinite( dist.get( to ) ?? Infinity ) ) return [to];
  const path = [to];
  for ( let n = to; n !== from; ) {
    n = prev.get( n )!;
    path.push( n );
  }
  return path.reverse();
}
