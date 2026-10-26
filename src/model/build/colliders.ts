// A model's colliders, made from it: a box for each box-like part, a convex hull otherwise.

import { type Mesh, type V3, add, bounds, cross, dot, edgesOf, ek, faceNormal, len, mul, norm, sub } from "../mesh";
import type { ModelData } from "./index";
import { evaluate } from "./modifiers";
import { triangulateFace } from "./triangles";

// A collider in the piece's own coordinates: a box ( centre, half sizes on its axes ), or a convex mesh's triangles.
export type ModelCollider = { kind: "box"; centre: V3; axes: [V3, V3, V3]; half: V3 } | { kind: "convex"; tris: Float32Array };

/**
 * Whether the faces make a convex solid: every corner on or behind every face ( its average plane: a rounded
 * bevel's corner faces aren't quite flat ), apart from the face's own corners.
**/
function isConvex( g: Mesh, faces: number[], verts: number[], tol: number ) {
  for ( const fi of faces ) {
    const n = faceNormal( g, fi );
    if ( len( n ) < 0.5 ) continue;
    let c: V3 = [0, 0, 0];
    for ( const v of g.f[fi] ) c = add( c, g.v[v] );
    c         = mul( c, 1 / g.f[fi].length );
    const own = new Set( g.f[fi] );
    for ( const v of verts ) if ( !own.has( v ) && dot( sub( g.v[v], c ), n ) > tol ) return false;
  }
  return true;
}

/**
 * The colliders of a modelled piece: each connected part that's a convex solid as one exact collider ( a box when it
 * is one, else its convex mesh: the game shrink-wraps a mesh, which for a convex part is exact ); a part that isn't
 * convex ( an L, a C, a wavy wall ) as a thin box under each flat face, so what you can land on is there as drawn.
**/
export function modelColliders( model: ModelData ): ModelCollider[] {
  if ( model.colliders === "none" ) return [];
  const g = evaluate( model );
  if ( !g.f.length ) return [];
  // connected parts
  const parent = g.v.map( ( _, i ) => i );
  const find   = ( a: number ): number => ( parent[a] === a ? a : ( parent[a] = find( parent[a] ) ) );
  for ( const f of g.f ) for ( let i = 1; i < f.length; i++ ) parent[find( f[i] )] = find( f[0] );
  const parts = new Map<number, number[]>();
  g.f.forEach( ( f, fi ) => ( parts.get( find( f[0] ) ) ?? parts.set( find( f[0] ), [] ).get( find( f[0] ) )! ).push( fi ) );
  const out: ModelCollider[] = [];
  for ( const faces of parts.values() ) {
    const verts        = [...new Set( faces.flatMap( ( fi ) => g.f[fi] ) )];
    const { min, max } = bounds( { ...g, v: verts.map( ( v ) => g.v[v] ) } );
    const size         = len( sub( max, min ) );
    if ( size < 0.01 ) continue;
    const closedPart = [...edgesOf( { ...g, f: faces.map( ( fi ) => g.f[fi] ) } ).values()].every( ( e ) => e.faces.length === 2 );
    if ( closedPart && isConvex( g, faces, verts, size * 0.005 ) ) {
      const box = boxOf( g, faces, verts );
      if ( box ) out.push( box );
      else {
        const tris: number[] = [];
        for ( const fi of faces ) for ( const t of triangulateFace( g, g.f[fi], faceNormal( g, fi ) ) ) for ( const v of t ) tris.push( ...g.v[v] );
        out.push( { kind: "convex", tris: new Float32Array( tris ) } );
      }
      continue;
    }
    // flat regions ( faces meeting within a degree ), each a thin box under it
    const done      = new Set<number>();
    const edgeFaces = edgesOf( g );
    const thick     = Math.min( 0.3, Math.max( 0.03, size * 0.05 ) );
    for ( const start of faces ) {
      if ( done.has( start ) ) continue;
      const n = faceNormal( g, start );
      if ( len( n ) < 0.5 ) continue;
      const region = [start];
      done.add( start );
      for ( let i = 0; i < region.length; i++ ) {
        const f = g.f[region[i]];
        for ( let k = 0; k < f.length; k++ )
          for ( const o of edgeFaces.get( ek( f[k], f[( k + 1 ) % f.length] ) )!.faces )
            if ( !done.has( o ) && dot( faceNormal( g, o ), n ) > 0.9998 ) { done.add( o ); region.push( o ); }
      }
      const pts = [...new Set( region.flatMap( ( fi ) => g.f[fi] ) )].map( ( v ) => g.v[v] );
      const u   = norm( Math.abs( n[1] ) < 0.9 ? cross( [0, 1, 0], n ) : cross( [1, 0, 0], n ) ), w = cross( n, u );
      // the region's own extent along its longest direction ( a rotated rectangle fits better than an axis box )
      let best: { u: V3; w: V3; area: number } = { u, w, area: Infinity };
      for ( let a = 0; a < 180; a += 5 ) {
        const t    = ( a * Math.PI ) / 180, uu = norm( add( mul( u, Math.cos( t ) ), mul( w, Math.sin( t ) ) ) ), ww = cross( n, uu );
        const xs   = pts.map( ( p ) => dot( p, uu ) ), ys = pts.map( ( p ) => dot( p, ww ) );
        const area = ( Math.max( ...xs ) - Math.min( ...xs ) ) * ( Math.max( ...ys ) - Math.min( ...ys ) );
        if ( area < best.area ) best = { u: uu, w: ww, area };
      }
      const xs     = pts.map( ( p ) => dot( p, best.u ) ), ys = pts.map( ( p ) => dot( p, best.w ) ), d = dot( pts[0], n );
      const cx     = ( Math.max( ...xs ) + Math.min( ...xs ) ) / 2, cy = ( Math.max( ...ys ) + Math.min( ...ys ) ) / 2;
      const centre = add( add( mul( best.u, cx ), mul( best.w, cy ) ), mul( n, d - thick / 2 ) );
      out.push( { kind: "box", centre, axes: [best.u, best.w, n], half: [( Math.max( ...xs ) - Math.min( ...xs ) ) / 2, ( Math.max( ...ys ) - Math.min( ...ys ) ) / 2, thick / 2] } );
    }
  }
  return out.slice( 0, 256 );
}

/**
 * A convex part that is a box ( six faces in three pairs of parallel sides ): its box.
**/
function boxOf( g: Mesh, faces: number[], verts: number[] ): ModelCollider | null {
  if ( faces.length !== 6 || verts.length !== 8 || faces.some( ( fi ) => g.f[fi].length !== 4 ) ) return null;
  const ns         = faces.map( ( fi ) => faceNormal( g, fi ) );
  const axes: V3[] = [];
  for ( const n of ns ) if ( !axes.some( ( a ) => Math.abs( dot( a, n ) ) > 0.9999 ) ) axes.push( n );
  if ( axes.length !== 3 || Math.abs( dot( axes[0], axes[1] ) ) > 1e-4 || Math.abs( dot( axes[0], axes[2] ) ) > 1e-4 || Math.abs( dot( axes[1], axes[2] ) ) > 1e-4 ) return null;
  // right-handed axes, so the box's rotation is a rotation
  const A: [V3, V3, V3] = [axes[0], axes[1], dot( cross( axes[0], axes[1] ), axes[2] ) > 0 ? axes[2] : mul( axes[2], -1 )];
  const ext             = A.map( ( a ) => {
    const d = verts.map( ( v ) => dot( g.v[v], a ) );
    return [Math.min( ...d ), Math.max( ...d )];
  } );
  const centre = add( add( mul( A[0], ( ext[0][0] + ext[0][1] ) / 2 ), mul( A[1], ( ext[1][0] + ext[1][1] ) / 2 ) ), mul( A[2], ( ext[2][0] + ext[2][1] ) / 2 ) );
  return { kind: "box", centre, axes: A, half: [( ext[0][1] - ext[0][0] ) / 2, ( ext[1][1] - ext[1][0] ) / 2, ( ext[2][1] - ext[2][0] ) / 2] };
}
