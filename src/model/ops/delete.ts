// Delete and Dissolve ( X ), and Merge ( M ).

import { type Mesh, type V3, add, cloneMesh, compact, edgesOf, ek, ekv, len, mul, runs, sub } from "../mesh";
import { type OpResult, type Sel, emptySel, selFromVerts } from "./selection";

export type DeleteKind = "verts" | "edges" | "faces" | "onlyFaces" | "dissolveVerts" | "dissolveEdges" | "dissolveFaces";

export function remove( g0: Mesh, sel: Sel, kind: DeleteKind ): OpResult {
  const g = cloneMesh( g0 );
  switch ( kind ) {
    case "verts": {
      const drop = g.f.map( ( f ) => f.some( ( v ) => sel.v.has( v ) ) );
      g.f        = g.f.filter( ( _, i ) => !drop[i] );
      g.m        = g.m.filter( ( _, i ) => !drop[i] );
      g.s        = g.s.filter( ( _, i ) => !drop[i] );
      g.w        = g.w.filter( ( [a, b] ) => !sel.v.has( a ) && !sel.v.has( b ) );
      break;
    }
    case "edges": {
      const drop = g.f.map( ( f ) => f.some( ( v, i ) => sel.e.has( ek( v, f[( i + 1 ) % f.length] ) ) ) );
      g.f        = g.f.filter( ( _, i ) => !drop[i] );
      g.m        = g.m.filter( ( _, i ) => !drop[i] );
      g.s        = g.s.filter( ( _, i ) => !drop[i] );
      g.w        = g.w.filter( ( [a, b] ) => !sel.e.has( ek( a, b ) ) );
      break;
    }
    case "faces":
    case "onlyFaces": {
      const gone  = g.f.filter( ( _, i ) => sel.f.has( i ) );
      const keepI = g.f.map( ( _, i ) => !sel.f.has( i ) );
      g.f         = g.f.filter( ( _, i ) => keepI[i] );
      g.m         = g.m.filter( ( _, i ) => keepI[i] );
      g.s         = g.s.filter( ( _, i ) => keepI[i] );
      if ( kind === "onlyFaces" ) for ( const f of gone ) for ( let i = 0; i < f.length; i++ ) g.w.push( [f[i], f[( i + 1 ) % f.length]] );
      break;
    }
    case "dissolveEdges": {
      for ( const k of sel.e ) dissolveEdge( g, k );
      // ( Blender's "Dissolve Vertices", on by default: the dissolved edges' ends left joining two edges go too )
      const ends = new Set( [...sel.e].flatMap( ( k ) => ekv( k ) ) );
      const deg  = new Map<number, number>();
      for ( const e of edgesOf( g ).values() ) for ( const v of [e.a, e.b] ) deg.set( v, ( deg.get( v ) ?? 0 ) + 1 );
      const lone = new Set( [...ends].filter( ( v ) => deg.get( v ) === 2 ) );
      g.f        = g.f.map( ( f ) => ( f.length - f.filter( ( v ) => lone.has( v ) ).length >= 3 ? f.filter( ( v ) => !lone.has( v ) ) : f ) );
      break;
    }
    case "dissolveFaces": {
      // each joined region one face, round its outline ( as Blender's: the edges and vertices inside it go )
      for ( const region of faceRegions( g, sel.f ) ) {
        const loop = outline( g, region );
        if ( !loop ) {
          // ( a region with holes, or that meets itself: its edges dissolved one by one, as far as they go )
          for ( const [k, e] of edgesOf( g ) ) if ( e.faces.length === 2 && e.faces.every( ( f ) => region.has( f ) ) ) dissolveEdge( g, k );
          continue;
        }
        const first = Math.min( ...region );
        for ( const fi of region ) g.f[fi] = fi === first ? loop : [];
      }
      break;
    }
    case "dissolveVerts": {
      for ( const v of sel.v ) {
        for ( const [k, e] of edgesOf( g ) ) if ( ( e.a === v || e.b === v ) && e.faces.length === 2 ) dissolveEdge( g, k );
        g.f = g.f.map( ( f ) => ( f.length > 3 ? f.filter( ( x ) => x !== v ) : f ) );
      }
      break;
    }
  }
  const { mesh } = compact( g );
  return { mesh, sel: emptySel() };
}

/**
 * The selected faces in groups joined by edges.
**/
function faceRegions( g: Mesh, faces: Set<number> ): Set<number>[] {
  const info = edgesOf( g ), seen = new Set<number>(), out: Set<number>[] = [];
  for ( const f0 of faces ) {
    if ( seen.has( f0 ) ) continue;
    const region = new Set<number>( [f0] ), stack = [f0];
    seen.add( f0 );
    while ( stack.length ) {
      const f = g.f[stack.pop()!];
      for ( let i = 0; i < f.length; i++ )
        for ( const n of info.get( ek( f[i], f[( i + 1 ) % f.length] ) )?.faces ?? [] )
          if ( faces.has( n ) && !seen.has( n ) ) { seen.add( n ); region.add( n ); stack.push( n ); }
    }
    out.push( region );
  }
  return out;
}

/**
 * A region's outline as one face ( its corners in its faces' order round ), if it's one loop.
**/
function outline( g: Mesh, region: Set<number> ): number[] | null {
  const count = new Map<string, number>();
  for ( const fi of region ) for ( let i = 0; i < g.f[fi].length; i++ ) {
    const k = ek( g.f[fi][i], g.f[fi][( i + 1 ) % g.f[fi].length] );
    count.set( k, ( count.get( k ) ?? 0 ) + 1 );
  }
  const next = new Map<number, number>();
  let n      = 0;
  for ( const fi of region ) for ( let i = 0; i < g.f[fi].length; i++ ) {
    const a = g.f[fi][i], b = g.f[fi][( i + 1 ) % g.f[fi].length];
    if ( count.get( ek( a, b ) ) !== 1 ) continue;
    if ( next.has( a ) ) return null;
    next.set( a, b );
    n++;
  }
  if ( n < 3 ) return null;
  const start = next.keys().next().value!, loop = [start];
  for ( let v = next.get( start ); v !== start; v = next.get( v ) ) {
    if ( v === undefined || loop.length > n ) return null;
    loop.push( v );
  }
  return loop.length === n ? loop : null;
}

/**
 * Joins the two faces either side of an edge into one ( the edge goes ).
**/
function dissolveEdge( g: Mesh, k: string ) {
  const [a, b] = ekv( k );
  const fs     = g.f.map( ( f, i ) => [f, i] as const ).filter( ( [f] ) => f.length && ( runs( f, a, b ) || runs( f, b, a ) ) );
  if ( fs.length !== 2 ) return;
  let [f1, i1] = fs[0], [f2, i2] = fs[1];
  if ( !runs( f1, a, b ) ) [f1, i1, f2, i2] = [f2, i2, f1, i1];
  if ( !runs( f2, b, a ) ) return;
  // f1 from b round to a ( not across a→b ), then f2 from a round to b
  const path = ( f: readonly number[], from: number, to: number ) => {
    const out: number[] = [];
    for ( let i = f.indexOf( from ); ; i = ( i + 1 ) % f.length ) {
      out.push( f[i] );
      if ( f[i] === to ) break;
    }
    return out;
  };
  const p1     = path( f1, b, a ), p2 = path( f2, a, b );
  const merged = [...p1, ...p2.slice( 1, -1 )];
  g.f[i1]      = merged;
  g.f[i2]      = [];
}

export type MergeKind = "center" | "first" | "last" | "collapse" | "distance";

/**
 * Merge ( M ): the selected vertices into one ( at their centre, or the first or last picked ), each group joined by
 * selected edges into one ( collapse: by `edges`, else by any edges among them ), or any within `distance` of each
 * other. A face left the same as another goes ( as Blender's ).
**/
export function merge( g0: Mesh, verts: number[], kind: MergeKind, distance = 0.0001, edges?: Set<string> ): OpResult {
  const g    = cloneMesh( g0 );
  const into = new Int32Array( g.v.length ).map( ( _, i ) => i );
  if ( kind === "distance" ) {
    for ( let i = 0; i < verts.length; i++ )
      for ( let j = 0; j < i; j++ ) {
        const a = verts[i], b = verts[j];
        if ( into[b] === b && into[a] === a && len( sub( g.v[a], g.v[b] ) ) <= distance ) into[a] = b;
      }
  } else {
    const groups: number[][] = kind === "collapse" ? connectedGroups( g0, verts, edges ) : [verts];
    for ( const grp of groups ) {
      if ( !grp.length ) continue;
      const target = kind === "last" ? grp[grp.length - 1] : grp[0];
      if ( kind === "center" || kind === "collapse" ) {
        let c: V3 = [0, 0, 0];
        for ( const v of grp ) c = add( c, g.v[v] );
        g.v[target] = mul( c, 1 / grp.length );
      }
      for ( const v of grp ) into[v] = target;
    }
  }
  g.f                 = g.f.map( ( f ) => f.map( ( v ) => into[v] ) );
  // ( a face merged onto another, corner for corner: one of them )
  const had           = new Set<string>();
  g.f                 = g.f.map( ( f ) => {
    const k = [...new Set( f )].sort( ( a, b ) => a - b ).join( "," );
    if ( new Set( f ).size >= 3 && had.has( k ) ) return [];
    had.add( k );
    return f;
  } );
  g.w                 = g.w.map( ( [a, b] ) => [into[a], into[b]] as [number, number] );
  const { mesh, map } = compact( g );
  const kept          = [...new Set( verts.map( ( v ) => map[into[v]] ).filter( ( v ) => v >= 0 ) )];
  return { mesh, sel: selFromVerts( mesh, kept ) };
}

/**
 * The vertices in groups joined by edges among them ( only those in `only`, if given ).
**/
function connectedGroups( g: Mesh, verts: number[], only?: Set<string> ): number[][] {
  const inSet = new Set( verts ), seen = new Set<number>(), out: number[][] = [];
  const nb    = new Map<number, number[]>();
  for ( const [k, e] of edgesOf( g ) )
    if ( inSet.has( e.a ) && inSet.has( e.b ) && ( !only || only.has( k ) ) ) {
      ( nb.get( e.a ) ?? nb.set( e.a, [] ).get( e.a )! ).push( e.b );
      ( nb.get( e.b ) ?? nb.set( e.b, [] ).get( e.b )! ).push( e.a );
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
