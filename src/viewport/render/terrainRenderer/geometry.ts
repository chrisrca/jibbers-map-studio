// The tiles' grids: one per size and level of detail, shared by every tile ( heights come from each tile's texture ).

import * as THREE from "three/webgpu";
import { SKIRT_FLAG } from "./tile";

export class GeometryCache {
  private cache = new Map<string, THREE.BufferGeometry>();

  get( q: number, step: number ) {
    const key = `${q}:${step}`;
    let g     = this.cache.get( key );
    if ( !g ) this.cache.set( key, ( g = this.build( q, step ) ) );
    return g;
  }

  private build( q: number, step: number ) {
    const n              = q / step;
    const grid: number[] = [];
    const idx: number[]  = [];
    const v              = ( i: number, j: number, skirt: number ) => {
      grid.push( i * step, j * step, skirt );
      return grid.length / 3 - 1;
    };
    for ( let j = 0; j <= n; j++ ) for ( let i = 0; i <= n; i++ ) v( i, j, 0 );
    const at = ( i: number, j: number ) => j * ( n + 1 ) + i;
    for ( let j = 0; j < n; j++ )
      for ( let i = 0; i < n; i++ ) {
        const a = at( i, j ), b = at( i + 1, j ), c = at( i + 1, j + 1 ), d = at( i, j + 1 );
        idx.push( a, b, c, a, c, d );
      }
    // skirts along the 4 borders, emitted with both windings so they're never back-face culled
    const border: [number, number][][] = [
      Array.from( { length: n + 1 }, ( _, k ) => [k, 0] ),
      Array.from( { length: n + 1 }, ( _, k ) => [n, k] ),
      Array.from( { length: n + 1 }, ( _, k ) => [n - k, n] ),
      Array.from( { length: n + 1 }, ( _, k ) => [0, n - k] ),
    ];
    for ( const edge of border ) {
      const skirt = edge.map( ( [i, j] ) => v( i, j, SKIRT_FLAG ) );
      for ( let k = 0; k < edge.length - 1; k++ ) {
        const a = at( ...edge[k] ), b = at( ...edge[k + 1] ), c = skirt[k + 1], d = skirt[k];
        idx.push( a, b, c, a, c, d, a, c, b, a, d, c );
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute( "grid",     new THREE.Float32BufferAttribute( grid, 3 ) );
    // three needs a position attribute for bookkeeping; the real position comes from positionNode
    g.setAttribute( "position", new THREE.Float32BufferAttribute( new Float32Array( grid.length ), 3 ) );
    g.setIndex( idx );
    return g;
  }
}
