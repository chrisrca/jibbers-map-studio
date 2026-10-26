// Booleans ( union, difference, intersection ) of two solids by BSP trees, after Evan Wallace's csg.js ( MIT; see
// THIRD_PARTY.md ): convex polygons split by each other's planes, the parts inside ( or outside ) the other dropped.
// Iterative where csg.js recurses, so big meshes don't run out of stack.

export type P3 = [number, number, number];

// A convex polygon, its plane, and what it carries through ( its slot and smoothing ).
export interface Poly {
  v:      P3[];
  n:      P3;
  w:      number;
  slot:   number;
  smooth: boolean;
}

const EPS      = 1e-5;
const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;

const dot  = ( a: P3, b: P3 ) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp = ( a: P3, b: P3, t: number ): P3 => [a[0] + ( b[0] - a[0] ) * t, a[1] + ( b[1] - a[1] ) * t, a[2] + ( b[2] - a[2] ) * t];

/**
 * A polygon from its corners ( null if they don't make one ).
**/
export function poly( v: P3[], slot: number, smooth: boolean ): Poly | null {
  const [a, b, c] = v;
  const e1: P3    = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2: P3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n:  P3    = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l         = Math.hypot( n[0], n[1], n[2] );
  if ( l < 1e-12 ) return null;
  const nn: P3 = [n[0] / l, n[1] / l, n[2] / l];
  return { v, n: nn, w: dot( nn, a ), slot, smooth };
}

const flipped = ( p: Poly ): Poly => ( { ...p, v: [...p.v].reverse(), n: [-p.n[0], -p.n[1], -p.n[2]], w: -p.w } );

/**
 * Puts `p` into the lists by which side of the plane ( n, w ) it's on, split across it when it spans it.
**/
function split( n: P3, w: number, p: Poly, coFront: Poly[], coBack: Poly[], front: Poly[], back: Poly[] ) {
  let type              = 0;
  const types: number[] = [];
  for ( const v of p.v ) {
    const t = dot( n, v ) - w;
    const k = t < -EPS ? BACK : t > EPS ? FRONT : COPLANAR;
    type   |= k;
    types.push( k );
  }
  switch ( type ) {
    case COPLANAR:
      ( dot( n, p.n ) > 0 ? coFront : coBack ).push( p );
      break;
    case FRONT:
      front.push( p );
      break;
    case BACK:
      back.push( p );
      break;
    case SPANNING: {
      const f: P3[] = [], b: P3[] = [];
      for ( let i = 0; i < p.v.length; i++ ) {
        const j  = ( i + 1 ) % p.v.length;
        const ti = types[i], tj = types[j], vi = p.v[i], vj = p.v[j];
        if ( ti !== BACK  ) f.push( vi );
        if ( ti !== FRONT ) b.push( ti !== BACK ? [...vi] as P3 : vi );
        if ( ( ti | tj ) === SPANNING ) {
          const t = ( w - dot( n, vi ) ) / dot( n, [vj[0] - vi[0], vj[1] - vi[1], vj[2] - vi[2]] );
          const m = lerp( vi, vj, t );
          f.push( m );
          b.push( [...m] as P3 );
        }
      }
      if ( f.length >= 3 ) front.push( { ...p, v: f } );
      if ( b.length >= 3 ) back.push( { ...p, v: b } );
    }
  }
}

class Node {
  plane: { n: P3; w: number } | null = null;
  front: Node | null                 = null;
  back:  Node | null                 = null;
  polys: Poly[]                      = [];

  constructor( polys?: Poly[] ) {
    if ( polys ) this.build( polys );
  }

  /**
   * Every node below this one ( this one too ).
  **/
  private nodes() {
    const out: Node[] = [], stack: Node[] = [this];
    while ( stack.length ) {
      const n = stack.pop()!;
      out.push( n );
      if ( n.front ) stack.push( n.front );
      if ( n.back  ) stack.push( n.back  );
    }
    return out;
  }

  invert() {
    for ( const n of this.nodes() ) {
      n.polys = n.polys.map( flipped );
      if ( n.plane ) n.plane = { n: [-n.plane.n[0], -n.plane.n[1], -n.plane.n[2]], w: -n.plane.w };
      [n.front, n.back] = [n.back, n.front];
    }
  }

  /**
   * The parts of `polys` outside this tree's solid.
  **/
  clipPolygons( polys: Poly[] ): Poly[] {
    const out:   Poly[]           = [];
    const stack: [Node, Poly[]][] = [[this, polys]];
    while ( stack.length ) {
      const [node, list] = stack.pop()!;
      if ( !node.plane ) {
        out.push( ...list );
        continue;
      }
      const front: Poly[] = [], back: Poly[] = [];
      for ( const p of list ) split( node.plane.n, node.plane.w, p, front, back, front, back );
      if ( node.front ) stack.push( [node.front, front] );
      else out.push( ...front );
      // what's behind a leaf is inside: dropped
      if ( node.back ) stack.push( [node.back, back] );
    }
    return out;
  }

  /**
   * Removes everything of this tree inside `bsp`'s solid.
  **/
  clipTo( bsp: Node ) {
    for ( const n of this.nodes() ) n.polys = bsp.clipPolygons( n.polys );
  }

  allPolygons() {
    return this.nodes().flatMap( ( n ) => n.polys );
  }

  build( polys: Poly[] ) {
    const stack: [Node, Poly[]][] = [[this, polys]];
    while ( stack.length ) {
      const [node, list] = stack.pop()!;
      if ( !list.length ) continue;
      if ( !node.plane ) node.plane = { n: list[0].n, w: list[0].w };
      const front: Poly[] = [], back: Poly[] = [];
      for ( const p of list ) split( node.plane.n, node.plane.w, p, node.polys, node.polys, front, back );
      if ( front.length ) stack.push( [( node.front ??= new Node() ), front] );
      if ( back.length  ) stack.push( [( node.back  ??= new Node() ), back ] );
    }
  }
}

export type BoolOp = "union" | "difference" | "intersect";

/**
 * `a` combined with `b` ( both closed solids, the same space ).
**/
export function boolean( a: Poly[], b: Poly[], op: BoolOp ): Poly[] {
  const A = new Node( a ), B = new Node( b );
  if ( op === "union" ) {
    A.clipTo( B );
    B.clipTo( A );
    B.invert();
    B.clipTo( A );
    B.invert();
    A.build( B.allPolygons() );
    return A.allPolygons();
  }
  if ( op === "difference" ) {
    A.invert();
    A.clipTo( B );
    B.clipTo( A );
    B.invert();
    B.clipTo( A );
    B.invert();
    A.build( B.allPolygons() );
    A.invert();
    return A.allPolygons();
  }
  A.invert();
  B.clipTo( A );
  B.invert();
  A.clipTo( B );
  B.clipTo( A );
  A.build( B.allPolygons() );
  A.invert();
  return A.allPolygons();
}
