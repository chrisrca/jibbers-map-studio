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
  const touched  = new Set<number>();
  // ( how many bevelled edges meet at each vertex )
  const bevelled = new Map<number, number>();
  for ( const k of B ) for ( const v of k.split( "_" ).map( Number ) ) {
    touched.add( v );
    bevelled.set( v, ( bevelled.get( v ) ?? 0 ) + 1 );
  }

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

  // the strips along the bevelled edges, curved round the old edge: Blender's profile ( 0.5, a quarter circle ), drawn
  // in the parallelogram its two ends make with the old corner ( its middle the corner across from that )
  const stripFaces: number[] = [];
  // ( two strips meeting between the same two points share their profile there )
  const made                 = new Map<string, number[]>();
  const profile              = ( from: number, to: number, corner: V3, at: number ) => {
    const had = made.get( `${to}>${from}` ) ?? made.get( `${from}>${to}` );
    if ( had ) return had[0] === from ? had : [...had].reverse();
    const out = [from];
    made.set( `${from}>${to}`, out );
    const S   = g.v[from], E = g.v[to], M = sub( add( S, E ), corner );
    for ( let k = 1; k < segments; k++ ) {
      const a  = ( k / segments ) * ( Math.PI / 2 );
      const p  = add( M, add( mul( sub( S, M ), Math.cos( a ) ), mul( sub( E, M ), Math.sin( a ) ) ) );
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
    // ( a profile's corner: the old vertex; where three or more bevelled edges meet, where its cross-section meets the
    // old edge, nearest its two ends' middle )
    const on = ( v: number, w: number, from: number, to: number ): V3 => {
      if ( ( bevelled.get( v ) ?? 0 ) < 3 ) return g0.v[v];
      const P = g0.v[v], d = norm( sub( g0.v[w], P ) ), m = mul( add( g.v[from], g.v[to] ), 0.5 );
      return add( P, mul( d, dot( sub( m, P ), d ) ) );
    };
    const fa = at( f1, a ), ta = at( f2, a ), fb = at( f1, b ), tb = at( f2, b );
    const A  = profile( fa, ta, on( a, b, fa, ta ), a ), Bp = profile( fb, tb, on( b, a, fb, tb ), b );
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
  // ( faces by their edges, as each runs it )
  const byEdge = new Map<string, number>();
  g.f.forEach( ( f, fi ) => f.forEach( ( x, i ) => byEdge.set( `${x}>${f[( i + 1 ) % f.length]}`, fi ) ) );
  const strips = new Set( stripFaces );
  // a hole against one face along one edge ( where a bevelled edge ends at a plain corner ): that face takes the
  // profile in, as Blender's does, rather than a face of its own
  const absorb = ( loop: number[] ) => {
    const along = loop.flatMap( ( x, i ) => {
      const y = loop[( i + 1 ) % loop.length], fi = byEdge.get( `${y}>${x}` );
      return fi !== undefined && !strips.has( fi ) ? [{ i, fi }] : [];
    } );
    if ( along.length !== 1 ) return false;
    const { i, fi } = along[0], f = g.f[fi];
    const w         = loop[( i + 1 ) % loop.length];
    // the rest of the hole, from w round to the loop's corner before it
    const rest      = Array.from( { length: loop.length - 2 }, ( _, k ) => loop[( i + 2 + k ) % loop.length] );
    const at        = f.indexOf( w );
    g.f[fi]         = [...f.slice( 0, at + 1 ), ...rest, ...f.slice( at + 1 )];
    return true;
  };
  // ( the profiles' ends: the faces' corners )
  const ends = new Set( [...made.values()].flatMap( ( p ) => [p[0], p[p.length - 1]] ) );
  for ( const [v, ids] of created ) {
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
        if ( absorb( loop ) ) continue;
        // three bevelled edges meeting, curved: a grid, as Blender's; facing out past the old corner
        const grid = bevelled.get( v ) === 3 ? cornerGrid( g, loop, segments, g0.v[v], ( id ) => ends.has( id ) ) : null;
        for ( const f of grid ?? [loop] ) {
          const fi = g.f.push( f ) - 1;
          let c: V3 = [0, 0, 0];
          for ( const x of f ) c = add( c, g.v[x] );
          if ( grid && dot( faceNormal( g, fi ), sub( g0.v[v], mul( c, 1 / f.length ) ) ) < 0 ) g.f[fi] = [...f].reverse();
          patchFaces.push( fi );
          g.m.push( g0.m[0] ?? 0 );
          g.s.push( segments > 1 );
        }
      }
    }
  }
  const keep     = new Set( [...stripFaces, ...patchFaces] );
  const { mesh } = compact( g );
  // ( compact keeps faces in order and drops none here: the selection carries over )
  return { mesh, sel: selFromFaces( mesh, [...keep].filter( ( i ) => i < mesh.f.length ) ) };
}

/**
 * The patch where three bevelled edges meet, as Blender's: `loop` its edge round ( three profiles of `n` segments, as
 * the hole runs, `isEnd` their ends ), made a grid of quads ( a triangle in the middle for an odd count ). On the
 * sphere its edge lies on, if it does ( a box's corner, every width the same ), else filled in between its sides. Its
 * faces, their new corners added to `g`.
**/
function cornerGrid( g: Mesh, loop: number[], n: number, P: V3, isEnd: ( id: number ) => boolean ): number[][] | null {
  const L = loop.length;
  if ( L !== 3 * n || n < 2 ) return null;
  const s = loop.findIndex( ( _, i ) => [0, n, 2 * n].every( ( d ) => isEnd( loop[( i + d ) % L] ) ) );
  if ( s < 0 ) return null;
  const Pk  = ( k: number, j: number ) => loop[( s + ( ( k + 3 ) % 3 ) * n + j ) % L];
  const pos = ( id: number ) => g.v[id];
  // ( the sphere: its middle as far in from each face's corner as the corner's in from the old vertex )
  const F   = [0, 1, 2].map( ( k ) => pos( Pk( k, 0 ) ) );
  const O   = add( P, mul( sub( add( add( F[0], F[1] ), F[2] ), mul( P, 3 ) ), 0.5 ) ), r = len( sub( F[0], O ) );
  const ball = r > 1e-9 && loop.every( ( id ) => Math.abs( len( sub( pos( id ), O ) ) - r ) < r * 1e-3 );
  const snap = ( p: V3 ): V3 => ( ball ? add( O, mul( norm( sub( p, O ) ), r ) ) : p );
  const put  = ( p: V3 ) => g.v.push( snap( p ) ) - 1;
  const lerp = ( a: number, b: number, t: number ) => add( mul( pos( a ), 1 - t ), mul( pos( b ), t ) );
  const m    = Math.floor( n / 2 ), odd = n % 2 === 1;
  // each sector's two inner sides ( from its profiles' middles in ): shared between sectors for an even count; for an
  // odd one, each to its own corner of the middle triangle
  const side = ( a: number, b: number ) => Array.from( { length: m + 1 }, ( _, j ) => ( j === 0 ? a : j === m ? b : put( lerp( a, b, j / m ) ) ) );
  let right: number[][], top: number[][], mid: number[] = [];
  if ( !odd ) {
    let c: V3 = [0, 0, 0];
    for ( const id of loop ) c = add( c, pos( id ) );
    const C    = put( ball ? add( O, mul( norm( sub( P, O ) ), r ) ) : mul( c, 1 / L ) );
    const line = [0, 1, 2].map( ( k ) => side( Pk( k, m ), C ) );
    right      = line;
    top        = [0, 1, 2].map( ( k ) => line[( k + 2 ) % 3] );
  } else {
    mid   = [0, 1, 2].map( ( k ) => put( sub( add( pos( Pk( k, m ) ), pos( Pk( k - 1, n - m ) ) ), pos( Pk( k, 0 ) ) ) ) );
    right = [0, 1, 2].map( ( k ) => side( Pk( k, m ), mid[k] ) );
    top   = [0, 1, 2].map( ( k ) => side( Pk( k - 1, n - m ), mid[k] ) );
  }
  const faces: number[][] = [];
  for ( let k = 0; k < 3; k++ ) {
    // the sector round face corner k: its sides the two profiles out of it and its inner sides, filled between them
    const G = Array.from( { length: m + 1 }, () => Array.from( { length: m + 1 }, () => -1 ) );
    for ( let i = 0; i <= m; i++ ) { G[i][0] = Pk( k, i ); G[i][m] = top[k][i]; }
    for ( let j = 0; j <= m; j++ ) { G[0][j] = Pk( k - 1, n - j ); G[m][j] = right[k][j]; }
    for ( let i = 1; i < m; i++ )
      for ( let j = 1; j < m; j++ ) {
        const u = i / m, v = j / m;
        const e = add( add( mul( pos( G[0][j] ), 1 - u ), mul( pos( G[m][j] ), u ) ), add( mul( pos( G[i][0] ), 1 - v ), mul( pos( G[i][m] ), v ) ) );
        const c = add( add( mul( pos( G[0][0] ), ( 1 - u ) * ( 1 - v ) ), mul( pos( G[m][0] ), u * ( 1 - v ) ) ), add( mul( pos( G[0][m] ), ( 1 - u ) * v ), mul( pos( G[m][m] ), u * v ) ) );
        G[i][j]  = put( sub( e, c ) );
      }
    for ( let i = 0; i < m; i++ ) for ( let j = 0; j < m; j++ ) faces.push( [G[i][j], G[i + 1][j], G[i + 1][j + 1], G[i][j + 1]] );
    // ( an odd count: a strip from this sector to the next, across the profile's middle segment )
    if ( odd ) for ( let j = 0; j < m; j++ ) faces.push( [right[k][j], top[( k + 1 ) % 3][j], top[( k + 1 ) % 3][j + 1], right[k][j + 1]] );
  }
  if ( odd ) faces.push( [...mid] );
  return faces;
}

/**
 * Bevel Vertices ( Shift+Ctrl+B ): each selected corner cut off, a point `width` along each of its edges ( short of
 * the far end ), its faces taking the two on their own edges instead of it, and a face over the cut. ( Blender's
 * rounds the cut with more segments; here it's flat at any. )
**/
export function bevelVerts( g0: Mesh, verts: Set<number>, width: number ): OpResult {
  if ( !verts.size || width <= 0 ) return { mesh: g0, sel: selFromFaces( g0, [] ) };
  const g   = cloneMesh( g0 );
  const cut = new Map<string, number>();
  const at  = ( v: number, o: number ) => {
    const k = `${v}>${o}`;
    let id  = cut.get( k );
    if ( id === undefined ) {
      const d = sub( g0.v[o], g0.v[v] ), l = len( d );
      cut.set( k, ( id = g.v.push( add( g0.v[v], mul( d, Math.min( width, l * 0.95 ) / Math.max( l, 1e-12 ) ) ) ) - 1 ) );
    }
    return id;
  };
  // the cut's edges, as the faces round it run them ( the cap runs each the other way )
  const back = new Map<number, Map<number, number>>();
  g.f        = g0.f.map( ( f ) =>
    f.flatMap( ( v, i ) => {
      if ( !verts.has( v ) ) return [v];
      const p = f[( i - 1 + f.length ) % f.length], n = f[( i + 1 ) % f.length];
      const a = at( v, p ), b = at( v, n );
      ( back.get( v ) ?? back.set( v, new Map() ).get( v )! ).set( b, a );
      return [a, b];
    } ),
  );
  const caps: number[] = [];
  for ( const [, next] of back ) {
    const start = next.keys().next().value!, loop = [start];
    for ( let x = next.get( start ); x !== undefined && x !== start && loop.length <= next.size; x = next.get( x ) ) loop.push( x );
    if ( loop.length < 3 || next.get( loop[loop.length - 1] ) !== start ) continue;
    caps.push( g.f.length );
    g.f.push( loop );
    g.m.push( g0.m[0] ?? 0 );
    g.s.push( false );
  }
  // ( a corner's loose edges follow it to the nearest cut )
  g.w            = g0.w.map( ( [a, b] ) => [verts.has( a ) ? at( a, b ) : a, verts.has( b ) ? at( b, a ) : b] as [number, number] );
  const { mesh } = compact( g );
  return { mesh, sel: selFromFaces( mesh, caps ) };
}
