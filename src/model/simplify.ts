// A model's lower levels of detail: its triangles simplified by collapsing edges ( Garland & Heckbert's quadric error,
// each edge folded onto one of its ends so every corner keeps its own normal and UV ). Corners where the mesh is cut
// for its texture or its material slots, and open edges, stay where they are: the paint and the slots line up on
// every level, and nothing opens up.

import type { Built } from "./build";

// A min-heap of edges by cost ( stale entries skipped by their stamp ).
class Heap {
  private a: { c: number; u: number; v: number; s: number }[] = [];
  get size() {
    return this.a.length;
  }
  push( x: { c: number; u: number; v: number; s: number } ) {
    const a = this.a;
    a.push( x );
    let i = a.length - 1;
    while ( i > 0 ) {
      const p = ( i - 1 ) >> 1;
      if ( a[p].c <= a[i].c ) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop()!;
    if ( a.length ) {
      a[0]  = last;
      let i = 0;
      for ( ;; ) {
        const l = 2 * i + 1, r = l + 1;
        let m   = i;
        if ( l < a.length && a[l].c < a[m].c ) m = l;
        if ( r < a.length && a[r].c < a[m].c ) m = r;
        if ( m === i ) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * The mesh with about `ratio` of its triangles ( 0..1 ), fewer where they matter least.
**/
export function simplify( b: Built, ratio: number ): Built {
  const nV               = b.pos.length / 3;
  // the triangles and their slots
  const tris: number[][] = [], slotOf: number[] = [];
  let start              = 0;
  b.submeshes.forEach( ( count, s ) => {
    for ( let i = start; i + 2 < start + count; i += 3 ) { tris.push( [b.idx[i], b.idx[i + 1], b.idx[i + 2]] ); slotOf.push( s ); }
    start += count;
  } );
  const target = Math.max( 4, Math.floor( tris.length * ratio ) );
  // corners in the same place ( a seam's two sides ) count as one point: those, and open or slot-border edges, are kept
  const pkey   = ( v: number ) => `${Math.round( b.pos[v * 3] * 1e4 )},${Math.round( b.pos[v * 3 + 1] * 1e4 )},${Math.round( b.pos[v * 3 + 2] * 1e4 )}`;
  const at     = new Map<string, number[]>();
  for ( let v = 0; v < nV; v++ ) {
    const k = pkey( v );
    ( at.get( k ) ?? at.set( k, [] ).get( k )! ).push( v );
  }
  const locked = new Uint8Array( nV );
  for ( const vs of at.values() ) if ( vs.length > 1 ) for ( const v of vs ) locked[v] = 1;
  const edgeTris = new Map<string, number[]>();
  const ek       = ( a: number, c: number ) => ( a < c ? `${a},${c}` : `${c},${a}` );
  tris.forEach( ( t, i ) => {
    for ( let k = 0; k < 3; k++ ) {
      const e = ek( t[k], t[( k + 1 ) % 3] );
      ( edgeTris.get( e ) ?? edgeTris.set( e, [] ).get( e )! ).push( i );
    }
  } );
  for ( const [e, ts] of edgeTris ) {
    if ( ts.length === 2 && slotOf[ts[0]] === slotOf[ts[1]] ) continue;
    const [a, c] = e.split( "," ).map( Number );
    locked[a]    = locked[c] = 1;
  }
  // each corner's quadric: the planes of its triangles, by area
  const Q     = new Float64Array( nV * 10 );
  const P     = ( v: number, k: number ) => b.pos[v * 3 + k];
  const plane = ( t: number[] ) => {
    const e1 = [0, 1, 2].map( ( k ) => P( t[1], k ) - P( t[0], k ) ), e2 = [0, 1, 2].map( ( k ) => P( t[2], k ) - P( t[0], k ) );
    const n  = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l  = Math.hypot( n[0], n[1], n[2] );
    return { n: l > 0 ? n.map( ( x ) => x / l ) : [0, 0, 0], area: l / 2 };
  };
  tris.forEach( ( t ) => {
    const { n, area } = plane( t );
    const d           = -( n[0] * P( t[0], 0 ) + n[1] * P( t[0], 1 ) + n[2] * P( t[0], 2 ) );
    const q           = [n[0] * n[0], n[0] * n[1], n[0] * n[2], n[0] * d, n[1] * n[1], n[1] * n[2], n[1] * d, n[2] * n[2], n[2] * d, d * d];
    for ( const v of t ) for ( let k = 0; k < 10; k++ ) Q[v * 10 + k] += q[k] * area;
  } );
  const err = ( q: Float64Array, o: number, x: number, y: number, z: number ) =>
    q[o] * x * x + 2 * q[o + 1] * x * y + 2 * q[o + 2] * x * z + 2 * q[o + 3] * x + q[o + 4] * y * y + 2 * q[o + 5] * y * z + 2 * q[o + 6] * y + q[o + 7] * z * z + 2 * q[o + 8] * z + q[o + 9];
  // which triangles each corner is in
  const vt: Set<number>[] = Array.from( { length: nV }, () => new Set() );
  tris.forEach( ( t, i ) => t.forEach( ( v ) => vt[v].add( i ) ) );
  const alive = new Uint8Array( tris.length ).fill( 1 );
  let left    = tris.length;
  const stamp = new Uint32Array( nV );
  const heap  = new Heap();
  const cost  = ( u: number, v: number ) => {
    // u folds onto v: the error of u's and v's planes at v
    const q = new Float64Array( 10 );
    for ( let k = 0; k < 10; k++ ) q[k] = Q[u * 10 + k] + Q[v * 10 + k];
    return err( q, 0, P( v, 0 ), P( v, 1 ), P( v, 2 ) );
  };
  const offer = ( u: number ) => {
    if ( locked[u] ) return;
    const near = new Set<number>();
    for ( const t of vt[u] ) for ( const w of tris[t] ) if ( w !== u ) near.add( w );
    for ( const v of near ) heap.push( { c: cost( u, v ), u, v, s: stamp[u] } );
  };
  for ( let v = 0; v < nV; v++ ) offer( v );
  const normalOf = ( t: number[] ) => plane( t ).n;
  while ( left > target && heap.size ) {
    const { u, v, s } = heap.pop();
    if ( s !== stamp[u] || locked[u] || !vt[u].size ) continue;
    // still an edge?
    let shared = 0;
    for ( const t of vt[u] ) if ( tris[t].includes( v ) ) shared++;
    if ( !shared ) continue;
    // u's other neighbours may only share the edge's own triangles' corners with v ( no folds or pinches )
    const nu = new Set<number>(), nv = new Set<number>();
    for ( const t of vt[u] ) for ( const w of tris[t] ) nu.add( w );
    for ( const t of vt[v] ) for ( const w of tris[t] ) nv.add( w );
    let common = 0;
    for ( const w of nu ) if ( w !== u && w !== v && nv.has( w ) ) common++;
    if ( common > shared ) continue;
    // no triangle may turn over
    let flips = false;
    for ( const t of vt[u] ) {
      const tri = tris[t];
      if ( tri.includes( v ) ) continue;
      const before = normalOf( tri ), after = normalOf( tri.map( ( w ) => ( w === u ? v : w ) ) );
      if ( before[0] * after[0] + before[1] * after[1] + before[2] * after[2] < 0.3 ) {
        flips = true;
        break;
      }
    }
    if ( flips ) {
      stamp[u]++;
      continue;
    }
    for ( const t of [...vt[u]] ) {
      const tri = tris[t];
      if ( tri.includes( v ) ) {
        alive[t] = 0;
        left--;
        for ( const w of tri ) vt[w].delete( t );
      } else {
        tri[tri.indexOf( u )] = v;
        vt[v].add( t );
      }
    }
    vt[u].clear();
    for ( let k = 0; k < 10; k++ ) Q[v * 10 + k] += Q[u * 10 + k];
    // the costs round v are new
    const round = new Set<number>( [v] );
    for ( const t of vt[v] ) for ( const w of tris[t] ) round.add( w );
    for ( const w of round ) {
      stamp[w]++;
      offer( w );
    }
  }
  // what's left, its corners renumbered
  const map                = new Int32Array( nV ).fill( -1 ), pos: number[] = [], nrm: number[] = [], uv: number[] = [];
  const bySlot: number[][] = b.submeshes.map( () => [] );
  tris.forEach( ( t, i ) => {
    if ( !alive[i] ) return;
    for ( const v of t ) {
      if ( map[v] < 0 ) {
        map[v] = pos.length / 3;
        pos.push( b.pos[v * 3], b.pos[v * 3 + 1], b.pos[v * 3 + 2] );
        nrm.push( b.nrm[v * 3], b.nrm[v * 3 + 1], b.nrm[v * 3 + 2] );
        uv.push( b.uv[v * 2], b.uv[v * 2 + 1] );
      }
      bySlot[slotOf[i]].push( map[v] );
    }
  } );
  return { pos: new Float32Array( pos ), nrm: new Float32Array( nrm ), uv: new Float32Array( uv ), idx: new Uint32Array( bySlot.flat() ), submeshes: bySlot.map( ( x ) => x.length ) };
}
