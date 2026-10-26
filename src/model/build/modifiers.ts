// A model's modifiers ( Blender's: Mirror, Array, Weld, Solidify, Bevel, Subdivision Surface ), applied in order.

import { bevel } from "../bevel";
import { curveMesh } from "../curve";
import { type Mesh, type V3, add, bounds, cloneMesh, compact, dot, edgesOf, ek, faceNormal, len, mul, norm, runs, sub, vertexFaces } from "../mesh";
import type { ModelData } from "./index";

function mirror( g: Mesh, axis: number, merge: number ): Mesh {
  const on   = ( p: V3 ) => Math.abs( p[axis] ) <= merge;
  const out  = cloneMesh( g );
  // the copy's vertices, the ones on the mirror plane shared with the original
  const twin = g.v.map( ( p, i ) => {
    if ( on( p ) ) {
      out.v[i]       = [...p] as V3;
      out.v[i][axis] = 0;
      return i;
    }
    const q = [...p] as V3;
    q[axis] = -q[axis];
    return out.v.push( q ) - 1;
  } );
  g.f.forEach( ( f, fi ) => {
    // a face lying in the plane would be doubled back on itself
    if ( f.every( ( v ) => on( g.v[v] ) ) ) return;
    out.f.push( f.map( ( v ) => twin[v] ).reverse() );
    out.m.push( g.m[fi] );
    out.s.push( g.s[fi] );
  } );
  for ( const [a, b] of g.w ) out.w.push( [twin[a], twin[b]] );
  return compact( out ).mesh;
}

function array( g: Mesh, count: number, relative: V3, constant: V3, merge: boolean ): Mesh {
  const { min, max } = bounds( g );
  const size         = sub( max, min );
  const step: V3     = [relative[0] * size[0] + constant[0], relative[1] * size[1] + constant[1], relative[2] * size[2] + constant[2]];
  let out            = cloneMesh( g );
  for ( let c = 1; c < Math.max( 1, Math.round( count ) ); c++ ) {
    const base = out.v.length, off = mul( step, c );
    for ( const p of g.v ) out.v.push( add( p, off ) );
    g.f.forEach( ( f, fi ) => {
      out.f.push( f.map( ( v ) => v + base ) );
      out.m.push( g.m[fi] );
      out.s.push( g.s[fi] );
    } );
    for ( const [a, b] of g.w ) out.w.push( [a + base, b + base] );
  }
  if ( merge ) out = weld( out, 0.0005 );
  return out;
}

/**
 * Two meshes as one ( the second's faces after the first's ).
**/
export function joinMeshes( a: Mesh, b: Mesh ): Mesh {
  const n = a.v.length;
  return {
    v: [...a.v, ...b.v], f: [...a.f, ...b.f.map( ( f ) => f.map( ( v ) => v + n ) )], m: [...a.m, ...b.m], s: [...a.s, ...b.s],
    w: [...a.w, ...b.w.map( ( [x, y] ) => [x + n, y + n] as [number, number] )],
  };
}

/**
 * Joins vertices closer than `d` ( Merge by Distance ), dropping faces that close up.
**/
export function weld( g: Mesh, d: number ): Mesh {
  const into = new Int32Array( g.v.length ).map( ( _, i ) => i );
  const cell = new Map<string, number[]>();
  const key  = ( p: V3 ) => p.map( ( x ) => Math.round( x / Math.max( d, 1e-9 ) ) ).join( "," );
  g.v.forEach( ( p, i ) => {
    const k = key( p );
    for ( const j of cell.get( k ) ?? [] ) if ( len( sub( g.v[j], p ) ) <= d ) {
      into[i] = j;
      return;
    }
    ( cell.get( k ) ?? cell.set( k, [] ).get( k )! ).push( i );
  } );
  const out  = cloneMesh( g );
  out.f      = out.f.map( ( f ) => f.map( ( v ) => into[v] ) );
  out.w      = out.w.map( ( [a, b] ) => [into[a], into[b]] as [number, number] );
  // two faces now back to back ( an array's touching ends ) cancel out
  const seen = new Map<string, number>();
  const drop = new Set<number>();
  out.f.forEach( ( f, fi ) => {
    const k = [...f].sort( ( a, b ) => a - b ).join( "," );
    const j = seen.get( k );
    if ( j !== undefined ) {
      drop.add( j  );
      drop.add( fi );
    } else seen.set( k, fi );
  } );
  out.f = out.f.filter( ( _, i ) => !drop.has( i ) );
  out.m = out.m.filter( ( _, i ) => !drop.has( i ) );
  out.s = out.s.filter( ( _, i ) => !drop.has( i ) );
  return compact( out ).mesh;
}

/**
 * Vertex normals ( the average of the faces round each ).
**/
function vertexNormals( g: Mesh ): V3[] {
  const n: V3[] = g.v.map( () => [0, 0, 0] );
  g.f.forEach( ( f, fi ) => {
    const fn = faceNormal( g, fi );
    for ( const v of f ) n[v] = add( n[v], fn );
  } );
  return n.map( norm );
}

function solidify( g: Mesh, thickness: number ): Mesh {
  const out  = cloneMesh( g );
  const vn   = vertexNormals( g );
  const base = out.v.length;
  // the inner shell, facing in
  g.v.forEach( ( p, i ) => out.v.push( add( p, mul( vn[i], -thickness ) ) ) );
  g.f.forEach( ( f, fi ) => {
    out.f.push( f.map( ( v ) => v + base ).reverse() );
    out.m.push( g.m[fi] );
    out.s.push( g.s[fi] );
  } );
  // the rim joining them along the open edges
  for ( const e of edgesOf( g ).values() ) {
    if ( e.faces.length !== 1 ) continue;
    const f      = g.f[e.faces[0]];
    const [a, b] = runs( f, e.a, e.b ) ? [e.a, e.b] : [e.b, e.a];
    out.f.push( [b, a, a + base, b + base] );
    out.m.push( g.m[e.faces[0]] );
    out.s.push( false );
  }
  return out;
}

/**
 * Bevel modifier: the edges sharper than `angle` bevelled.
**/
function bevelSharp( g: Mesh, width: number, segments: number, angle: number ): Mesh {
  const cos   = Math.cos( ( angle * Math.PI ) / 180 );
  const sharp = new Set<string>();
  for ( const [k, e] of edgesOf( g ) ) if ( e.faces.length === 2 && dot( faceNormal( g, e.faces[0] ), faceNormal( g, e.faces[1] ) ) < cos ) sharp.add( k );
  return bevel( g, sharp, width, segments ).mesh;
}

/**
 * One level of Catmull-Clark subdivision ( open borders kept along their curve ).
**/
function catmullClark( g: Mesh ): Mesh {
  const edges     = edgesOf( g );
  const fp        = g.f.map( ( f ) => mul( f.reduce( ( s, v ) => add( s, g.v[v] ), [0, 0, 0] as V3 ), 1 / f.length ) );
  const out: Mesh = { v: [], f: [], m: [], s: [], w: [] };
  const vf        = vertexFaces( g );
  // edge points
  const ep        = new Map<string, number>();
  const border    = new Set<number>();
  for ( const [k, e] of edges ) {
    const mid = mul( add( g.v[e.a], g.v[e.b] ), 0.5 );
    const p   = e.faces.length === 2 ? mul( add( add( g.v[e.a], g.v[e.b] ), add( fp[e.faces[0]], fp[e.faces[1]] ) ), 0.25 ) : mid;
    if ( e.faces.length !== 2 ) { border.add( e.a ); border.add( e.b ); }
    ep.set( k, out.v.push( p ) - 1 );
  }
  // moved original vertices
  const vEdges = new Map<number, string[]>();
  for ( const [k, e] of edges ) for ( const v of [e.a, e.b] ) ( vEdges.get( v ) ?? vEdges.set( v, [] ).get( v )! ).push( k );
  const vp = g.v.map( ( p, i ) => {
    const es = vEdges.get( i ) ?? [];
    if ( border.has( i ) ) {
      const be = es.filter( ( k ) => edges.get( k )!.faces.length !== 2 );
      if ( be.length !== 2 ) return out.v.push( [...p] as V3 ) - 1;
      const [a, b] = be.map( ( k ) => {
        const e = edges.get( k )!;
        return g.v[e.a === i ? e.b : e.a];
      } );
      return out.v.push( add( mul( p, 0.75 ), mul( add( a, b ), 0.125 ) ) ) - 1;
    }
    const n = vf[i].length;
    if ( !n ) return out.v.push( [...p] as V3 ) - 1;
    const F = mul( vf[i].reduce( ( s, f ) => add( s, fp[f] ), [0, 0, 0] as V3 ), 1 / n );
    const R = mul( es.reduce( ( s, k ) => {
      const e = edges.get( k )!;
      return add( s, mul( add( g.v[e.a], g.v[e.b] ), 0.5 ) );
    }, [0, 0, 0] as V3 ), 1 / es.length );
    return out.v.push( mul( add( add( F, mul( R, 2 ) ), mul( p, n - 3 ) ), 1 / n ) ) - 1;
  } );
  const fc = fp.map( ( p ) => out.v.push( p ) - 1 );
  g.f.forEach( ( f, fi ) => {
    const k = f.length;
    for ( let i = 0; i < k; i++ ) {
      const prev = f[( i - 1 + k ) % k], cur = f[i], next = f[( i + 1 ) % k];
      out.f.push( [vp[cur], ep.get( ek( cur, next ) )!, fc[fi], ep.get( ek( prev, cur ) )!] );
      out.m.push( g.m[fi] );
      out.s.push( true );
    }
  } );
  return out;
}

/**
 * The mesh with its modifiers applied, in order ( a curve piece's: its tube ).
**/
export function evaluate( model: ModelData ): Mesh {
  let g = model.curve ? ( model.mesh.f.length || model.mesh.w.length ? joinMeshes( model.mesh, curveMesh( model.curve ) ) : curveMesh( model.curve ) ) : model.mesh;
  for ( const m of model.modifiers ) {
    if ( !m.on ) continue;
    switch ( m.type ) {
      case "mirror":
        m.axes.forEach( ( on, axis ) => on && ( g = mirror( g, axis, m.merge ) ) );
        break;
      case "array":
        g = array( g, m.count, m.relative, m.constant, m.merge );
        break;
      case "solidify":
        g = solidify( g, m.thickness );
        break;
      case "bevel":
        g = bevelSharp( g, m.width, m.segments, m.angle );
        break;
      case "subsurf":
        for ( let l = 0; l < Math.min( 4, m.levels ); l++ ) g = catmullClark( g );
        break;
    }
  }
  return g;
}
