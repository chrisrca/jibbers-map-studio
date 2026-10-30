// The modelling workspace's meshes: polygons ( any number of sides ) over shared vertices, as Blender's edit mesh, in
// a piece's own coordinates ( Unity's: metres, Y up ). Faces are wound as Unity's front faces: their normal is
// cross( b - a, c - a ) summed round the face. Loose edges ( `w` ) are kept for vertex extrusion and filling.

export type V3 = [number, number, number];

export interface Mesh {
  v: V3[];
  f: number[][];
  // material slot of each face
  m: number[];
  // shade smooth, per face
  s: boolean[];
  // loose edges ( no face )
  w: [number, number][];
  // edge creases ( Shift+E ): how sharp Subdivision Surface keeps an edge, 0..1, by its key ( missing: none )
  c?: Record<string, number>;
  // UVs ( the UV Editor's, an unwrap's ): each face's corners' u, v in turn ( a face without, or with the wrong
  // number: a box projection )
  u?: number[][];
}

/**
 * Face `fi`'s own UVs, when it has them for every corner.
**/
export const faceUvs = ( g: Mesh, fi: number ) => ( g.u?.[fi]?.length === g.f[fi].length * 2 ? g.u[fi] : null );

export const add   = ( a: V3, b: V3     ): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub   = ( a: V3, b: V3     ): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul   = ( a: V3, k: number ): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot   = ( a: V3, b: V3 ) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = ( a: V3, b: V3 ): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len   = ( a: V3 ) => Math.hypot( a[0], a[1], a[2] );
export const norm  = ( a: V3 ): V3 => {
  const l = len( a );
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
export const lerp3 = ( a: V3, b: V3, t: number ): V3 => [a[0] + ( b[0] - a[0] ) * t, a[1] + ( b[1] - a[1] ) * t, a[2] + ( b[2] - a[2] ) * t];

export const cloneMesh = ( g: Mesh ): Mesh => ( {
  v: g.v.map( ( p ) => [...p] as V3 ), f: g.f.map( ( f ) => [...f] ), m: [...g.m], s: [...g.s], w: g.w.map( ( e ) => [...e] as [number, number] ),
  ...( g.c ? { c: { ...g.c } } : {} ),
  ...( g.u ? { u: g.u.map( ( x ) => [...( x ?? [] )] ) } : {} ),
} );

/**
 * Creases carried over to new vertex numbers ( `to` a vertex's new number, -1 when it's gone ); only those still
 * edges of `g` kept ( none: no creases ).
**/
export function moveCreases( c: Record<string, number> | undefined, to: ( v: number ) => number, g?: Mesh ): Record<string, number> | undefined {
  if ( !c ) return undefined;
  const out: Record<string, number> = {}, edges = g ? edgesOf( g ) : null;
  for ( const [k, w] of Object.entries( c ) ) {
    const [a, b] = ekv( k ), x = to( a ), y = to( b );
    if ( x < 0 || y < 0 || x === y || w <= 0 ) continue;
    const n = ek( x, y );
    if ( !edges || edges.has( n ) ) out[n] = Math.max( out[n] ?? 0, w );
  }
  return Object.keys( out ).length ? out : undefined;
}

/**
 * An edge's key ( its two vertices, lower first ).
**/
export const ek  = ( a: number, b: number ) => ( a < b ? `${a}_${b}` : `${b}_${a}` );
export const ekv = ( k: string ) => k.split( "_" ).map( Number ) as [number, number];

/**
 * The face's normal ( unit; zero for a degenerate face ).
**/
export function faceNormal( g: Mesh, fi: number ): V3 {
  const f   = g.f[fi];
  let n: V3 = [0, 0, 0];
  const a   = g.v[f[0]];
  for ( let i = 1; i + 1 < f.length; i++ ) n = add( n, cross( sub( g.v[f[i]], a ), sub( g.v[f[i + 1]], a ) ) );
  return norm( n );
}
export function faceCenter( g: Mesh, fi: number ): V3 {
  const f   = g.f[fi];
  let c: V3 = [0, 0, 0];
  for ( const i of f ) c = add( c, g.v[i] );
  return mul( c, 1 / f.length );
}

export interface EdgeInfo {
  a:     number;
  b:     number;
  // faces using it
  faces: number[];
}
/**
 * Every edge ( faces' and loose ), by key.
**/
export function edgesOf( g: Mesh ): Map<string, EdgeInfo> {
  const out = new Map<string, EdgeInfo>();
  g.f.forEach( ( f, fi ) => {
    for ( let i = 0; i < f.length; i++ ) {
      const a = f[i], b = f[( i + 1 ) % f.length], k = ek( a, b );
      let e   = out.get( k );
      if ( !e ) out.set( k, ( e = { a: Math.min( a, b ), b: Math.max( a, b ), faces: [] } ) );
      e.faces.push( fi );
    }
  } );
  for ( const [a, b] of g.w ) if ( !out.has( ek( a, b ) ) ) out.set( ek( a, b ), { a: Math.min( a, b ), b: Math.max( a, b ), faces: [] } );
  return out;
}

/**
 * The faces round each vertex.
**/
export function vertexFaces( g: Mesh ): number[][] {
  const out: number[][] = g.v.map( () => [] );
  g.f.forEach( ( f, fi ) => f.forEach( ( i ) => out[i].push( fi ) ) );
  return out;
}

/**
 * Whether face `fi` runs a → b ( in that order ) somewhere.
**/
export function runs( f: number[], a: number, b: number ) {
  for ( let i = 0; i < f.length; i++ ) if ( f[i] === a && f[( i + 1 ) % f.length] === b ) return true;
  return false;
}

/**
 * Drops vertices no face or loose edge uses, faces with fewer than 3 distinct corners, repeated corners.
**/
export function compact( g: Mesh ): { mesh: Mesh; map: Int32Array } {
  const f: number[][] = [], m: number[] = [], s: boolean[] = [], u: number[][] = [];
  g.f.forEach( ( face, fi ) => {
    // ( each corner kept with its UV, when the face has them )
    const out: number[] = [], uv = faceUvs( g, fi ), outUv: number[] = [];
    face.forEach( ( i, k ) => {
      if ( out[out.length - 1] === i ) return;
      out.push( i );
      if ( uv ) outUv.push( uv[k * 2], uv[k * 2 + 1] );
    } );
    while ( out.length > 1 && out[0] === out[out.length - 1] ) {
      out.pop();
      outUv.splice( -2, 2 );
    }
    if ( new Set( out ).size < 3 ) return;
    f.push( out );
    m.push( g.m[fi] ?? 0 );
    s.push( g.s[fi] ?? false );
    u.push( uv ? outUv : [] );
  } );
  const used = new Uint8Array( g.v.length );
  for ( const face of f ) for ( const i of face ) used[i] = 1;
  const w = g.w.filter( ( [a, b] ) => a !== b );
  for ( const [a, b] of w ) used[a] = used[b] = 1;
  const map     = new Int32Array( g.v.length ).fill( -1 );
  const v: V3[] = [];
  g.v.forEach( ( p, i ) => {
    if ( used[i] ) {
      map[i] = v.length;
      v.push( p );
    }
  } );
  // loose edges a face now has are no longer loose
  const faceEdges = new Set<string>();
  for ( const face of f ) for ( let i = 0; i < face.length; i++ ) faceEdges.add( ek( face[i], face[( i + 1 ) % face.length] ) );
  const wSeen      = new Set<string>();
  const mesh: Mesh = {
    v,
    f: f.map( ( face ) => face.map( ( i ) => map[i] ) ),
    m,
    s,
    w: w
      .filter( ( [a, b] ) => !faceEdges.has( ek( a, b ) ) && !wSeen.has( ek( a, b ) ) && ( wSeen.add( ek( a, b ) ), true ) )
      .map( ( [a, b] ) => [map[a], map[b]] as [number, number] ),
  };
  const c = moveCreases( g.c, ( i ) => map[i], mesh );
  if ( c ) mesh.c = c;
  if ( g.u && u.some( ( x ) => x.length ) ) mesh.u = u;
  return { mesh, map };
}

/**
 * The mesh's bounds.
**/
export function bounds( g: Mesh ): { min: V3; max: V3 } {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for ( const p of g.v )
    for ( let k = 0; k < 3; k++ ) {
      if ( p[k] < min[k] ) min[k] = p[k];
      if ( p[k] > max[k] ) max[k] = p[k];
    }
  return { min, max };
}

// ---------------------------------------------------------------- primitives ( Blender's Add › Mesh )

export type PrimitiveId = "plane" | "cube" | "circle" | "cylinder" | "cone" | "uvsphere" | "icosphere" | "torus" | "grid";
export const PRIMITIVES: { id: PrimitiveId; label: string }[] = [
  { id: "plane",     label: "Plane"      },
  { id: "cube",      label: "Cube"       },
  { id: "circle",    label: "Circle"     },
  { id: "uvsphere",  label: "UV Sphere"  },
  { id: "icosphere", label: "Ico Sphere" },
  { id: "cylinder",  label: "Cylinder"   },
  { id: "cone",      label: "Cone"       },
  { id: "torus",     label: "Torus"      },
  { id: "grid",      label: "Grid"       },
];

/**
 * A mesh from vertices and faces wound counter-clockwise seen from outside ( as maths draws them, which is also
 * Unity's front-face order: only the viewport's mirroring of Z reverses it ).
**/
function fromCCW( v: V3[], faces: number[][], w: [number, number][] = [] ): Mesh {
  return { v, f: faces, m: faces.map( () => 0 ), s: faces.map( () => false ), w };
}

const CLOSED = new Set<PrimitiveId>( ["cube", "cylinder", "cone", "uvsphere", "icosphere", "torus"] );

// A primitive's settings ( Blender's Add panel ): segments ( vertices round; a grid's cuts, a torus' major ones ),
// rings ( an ico sphere's subdivisions ), its size across, a cylinder's or cone's depth, a torus' minor segments.
export interface PrimitiveOpts {
  segments?: number;
  rings?:    number;
  size?:     number;
  depth?:    number;
  minor?:    number;
}

/**
 * Blender's primitives at their default sizes ( 2 m across; a feature is usually scaled from there ), facing out.
**/
export function primitive( id: PrimitiveId, opts: PrimitiveOpts = {} ): Mesh {
  const g = rawPrimitive( id, opts );
  return CLOSED.has( id ) ? recalcOutside( g ) : g;
}

function rawPrimitive( id: PrimitiveId, opts: PrimitiveOpts ): Mesh {
  const r   = ( opts.size ?? 2 ) / 2;
  const seg = Math.max( 3, Math.round( opts.segments ?? 32 ) );
  switch ( id ) {
    case "plane":
      return fromCCW( [[-r, 0, -r], [r, 0, -r], [r, 0, r], [-r, 0, r]], [[0, 3, 2, 1]] );
    case "grid": {
      const n = Math.max( 1, Math.round( opts.segments ?? 10 ) ), v: V3[] = [], f: number[][] = [];
      for ( let j = 0; j <= n; j++ ) for ( let i = 0; i <= n; i++ ) v.push( [-r + ( 2 * r * i ) / n, 0, -r + ( 2 * r * j ) / n] );
      for ( let j = 0; j < n; j++ ) for ( let i = 0; i < n; i++ ) f.push( [j * ( n + 1 ) + i, ( j + 1 ) * ( n + 1 ) + i, ( j + 1 ) * ( n + 1 ) + i + 1, j * ( n + 1 ) + i + 1] );
      return fromCCW( v, f );
    }
    case "cube": {
      const v: V3[] = [];
      for ( const y of [-r, r] ) for ( const [x, z] of [[-r, -r], [r, -r], [r, r], [-r, r]] ) v.push( [x, y, z] );
      // 0-3 bottom, 4-7 top ( counter-clockwise from above )
      return fromCCW( v, [[0, 1, 2, 3].reverse(), [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]].map( ( f ) => f ) );
    }
    case "circle": {
      const v: V3[] = [];
      for ( let i = 0; i < seg; i++ ) {
        const a = ( i / seg ) * Math.PI * 2;
        v.push( [Math.sin( a ) * r, 0, Math.cos( a ) * r] );
      }
      return fromCCW( v, [], v.map( ( _, i ) => [i, ( i + 1 ) % seg] as [number, number] ) );
    }
    case "cylinder":
    case "cone": {
      const top     = id === "cone" ? 0 : r;
      const h       = ( opts.depth ?? 2 * r ) / 2;
      const v: V3[] = [], f: number[][] = [];
      for ( let i = 0; i < seg; i++ ) {
        const a = ( i / seg ) * Math.PI * 2;
        v.push( [Math.sin( a ) * r, -h, Math.cos( a ) * r] );
      }
      if ( top > 0 ) {
        for ( let i = 0; i < seg; i++ ) {
          const a = ( i / seg ) * Math.PI * 2;
          v.push( [Math.sin( a ) * top, h, Math.cos( a ) * top] );
        }
        for ( let i = 0; i < seg; i++ ) f.push( [i, ( i + 1 ) % seg, seg + ( ( i + 1 ) % seg ), seg + i].reverse() );
        f.push( Array.from( { length: seg }, ( _, i ) => seg + i ).reverse() );
      } else {
        v.push( [0, h, 0] );
        for ( let i = 0; i < seg; i++ ) f.push( [i, ( i + 1 ) % seg, seg].reverse() );
      }
      f.push( Array.from( { length: seg }, ( _, i ) => i ) );
      return fromCCW( v, f );
    }
    case "uvsphere": {
      const rings = Math.max( 2, Math.round( opts.rings ?? 16 ) ), v: V3[] = [[0, -r, 0]], f: number[][] = [];
      for ( let j = 1; j < rings; j++ ) {
        const t = Math.PI * ( j / rings - 0.5 );
        for ( let i = 0; i < seg; i++ ) {
          const a = ( i / seg ) * Math.PI * 2;
          v.push( [Math.sin( a ) * Math.cos( t ) * r, Math.sin( t ) * r, Math.cos( a ) * Math.cos( t ) * r] );
        }
      }
      v.push( [0, r, 0] );
      const at = ( j: number, i: number ) => 1 + ( j - 1 ) * seg + ( i % seg );
      for ( let i = 0; i < seg; i++ ) f.push( [0, at( 1, i + 1 ), at( 1, i )] );
      for ( let j = 1; j + 1 < rings; j++ ) for ( let i = 0; i < seg; i++ ) f.push( [at( j, i ), at( j, i + 1 ), at( j + 1, i + 1 ), at( j + 1, i )] );
      const top = v.length - 1;
      for ( let i = 0; i < seg; i++ ) f.push( [at( rings - 1, i ), at( rings - 1, i + 1 ), top] );
      return fromCCW( v, f.map( ( x ) => [...x].reverse() ) );
    }
    case "icosphere": {
      const t     = ( 1 + Math.sqrt( 5 ) ) / 2;
      let v: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
      let f       = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
      v           = v.map( ( p ) => mul( norm( p ), r ) );
      // one subdivision ( Blender's default is 2: close enough for a feature )
      for ( let k = 0; k < Math.min( 6, Math.round( opts.rings ?? 2 ) ) - 1; k++ ) {
        const mid = new Map<string, number>();
        const m   = ( a: number, b: number ) => {
          const key = ek( a, b );
          let i     = mid.get( key );
          if ( i === undefined ) mid.set( key, ( i = v.push( mul( norm( add( v[a], v[b] ) ), r ) ) - 1 ) );
          return i;
        };
        f = f.flatMap( ( [a, b, c] ) => {
          const ab = m( a, b ), bc = m( b, c ), ca = m( c, a );
          return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
        } );
      }
      return fromCCW( v, f );
    }
    case "torus": {
      const R = r * 0.75, rr = r * 0.25, minor = Math.max( 3, Math.round( opts.minor ?? 12 ) ), v: V3[] = [], f: number[][] = [];
      for ( let i = 0; i < seg; i++ )
        for ( let j = 0; j < minor; j++ ) {
          const a = ( i / seg ) * Math.PI * 2, b = ( j / minor ) * Math.PI * 2, d = R + Math.cos( b ) * rr;
          v.push( [Math.sin( a ) * d, Math.sin( b ) * rr, Math.cos( a ) * d] );
        }
      const at = ( i: number, j: number ) => ( i % seg ) * minor + ( j % minor );
      for ( let i = 0; i < seg; i++ ) for ( let j = 0; j < minor; j++ ) f.push( [at( i, j ), at( i, j + 1 ), at( i + 1, j + 1 ), at( i + 1, j )] );
      return fromCCW( v, f );
    }
  }
}

/**
 * Every face's winding made to agree with its neighbours', then the whole made to face outwards ( by its volume ):
 * Blender's Recalculate Outside, for each connected piece.
**/
export function recalcOutside( g: Mesh, only?: Set<number> ): Mesh {
  const out   = cloneMesh( g );
  const edges = edgesOf( out );
  const done  = new Uint8Array( out.f.length );
  for ( let start = 0; start < out.f.length; start++ ) {
    if ( done[start] || ( only && !only.has( start ) ) ) continue;
    const piece: number[] = [];
    const queue           = [start];
    done[start]           = 1;
    while ( queue.length ) {
      const fi = queue.pop()!;
      piece.push( fi );
      const f = out.f[fi];
      for ( let i = 0; i < f.length; i++ ) {
        const a = f[i], b = f[( i + 1 ) % f.length];
        for ( const nf of edges.get( ek( a, b ) )!.faces ) {
          if ( done[nf] || nf === fi || ( only && !only.has( nf ) ) ) continue;
          // a neighbour that agrees runs the shared edge the other way
          if ( runs( out.f[nf], a, b ) ) out.f[nf].reverse();
          done[nf] = 1;
          queue.push( nf );
        }
      }
    }
    // the piece's signed volume: negative means it faces inwards
    let vol = 0;
    for ( const fi of piece ) {
      const f = out.f[fi], a = out.v[f[0]];
      for ( let i = 1; i + 1 < f.length; i++ ) vol += dot( a, cross( out.v[f[i]], out.v[f[i + 1]] ) );
    }
    if ( vol < 0 ) for ( const fi of piece ) out.f[fi].reverse();
  }
  return out;
}
