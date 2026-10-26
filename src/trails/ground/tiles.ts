// Ground made where the trails go off the map ( tiles where there are none ).

import { groundRes } from "../../terrain/generate";
import { type ChunkInit, terrain } from "../../terrain/terrain";
import { ABOVE, BELOW } from "./apply";
import type { Rect } from "./types";

/**
 * Tiles ( on the map's grid, its size and detail; 1 km at 0.24 m when it has none ) wherever `box` reaches and the
 * map hasn't any: carrying on the ground at the map's nearest edge, or flat at `level` on a map with none ( a flat
 * tile beside ground would pull the ground's edge to meet it ). Returns the keys added.
**/
export function addTilesFor( box: Rect, level: number ): string[] {
  const c0                 = terrain.chunks[0];
  const S                  = c0 ? c0.size[0] : 1000, res = c0 ? c0.res : groundRes( 1000 );
  const mod                = ( v: number ) => ( ( v % S ) + S ) % S;
  const ox                 = c0 ? mod( c0.position[0] ) : 500, oz = c0 ? mod( c0.position[2] ) : 500;
  const have               = new Set( terrain.chunks.map( ( c ) => `${Math.round( ( c.position[0] - ox ) / S )},${Math.round( ( c.position[2] - oz ) / S )}` ) );
  const fresh: ChunkInit[] = [];
  for ( let cz = Math.floor( ( box[1] - oz ) / S ); cz <= Math.floor( ( box[3] - oz ) / S ); cz++ )
    for ( let cx = Math.floor( ( box[0] - ox ) / S ); cx <= Math.floor( ( box[2] - ox ) / S ); cx++ ) {
      if ( have.has( `${cx},${cz}` ) ) continue;
      // ( an untouched spot is free of anything the ground beneath could have )
      let key = `c_${cx}_${cz}`;
      while ( terrain.indexOf( key ) >= 0 ) key += "b";
      const px = ox + cx * S, pz = oz + cz * S;
      if ( !c0 ) {
        const base = Math.floor( level - BELOW );
        fresh.push( { key, position: [px, base, pz], size: [S, BELOW + ABOVE, S], res, heights: new Float32Array( res * res ).fill( level - base ), snowMask: null } );
        continue;
      }
      const heights = new Float32Array( res * res );
      {
        // ( read on a coarse grid, then filled in between: the map's edge smeared outwards needs no more )
        const b = terrain.bounds(), n = 65, cs = S / ( n - 1 ), sp = S / ( res - 1 ), g = new Float32Array( n * n );
        for ( let j = 0; j < n; j++ )
          for ( let i = 0; i < n; i++ ) {
            const v      = terrain.heightAt( Math.min( b.x1, Math.max( b.x0, px + i * cs ) ), Math.min( b.z1, Math.max( b.z0, pz + j * cs ) ) );
            g[j * n + i] = Number.isNaN( v ) ? level : v;
          }
        // ( filled in between, its range the coarse grid's: what's between them lies within it )
        let lo = Infinity, hi = -Infinity;
        for ( const v of g ) { lo = Math.min( lo, v ); hi = Math.max( hi, v ); }
        const base = Math.floor( lo - BELOW );
        for ( let j = 0; j < res; j++ ) {
          const fz = Math.min( n - 1.0001, ( j * sp ) / cs ), b0 = Math.floor( fz ), tz = fz - b0;
          for ( let i = 0; i < res; i++ ) {
            const fx             = Math.min( n - 1.0001, ( i * sp ) / cs ), a0 = Math.floor( fx ), tx = fx - a0, k = b0 * n + a0;
            const top            = g[k] + ( g[k + 1] - g[k] ) * tx, bot = g[k + n] + ( g[k + n + 1] - g[k + n] ) * tx;
            heights[j * res + i] = top + ( bot - top ) * tz - base;
          }
        }
        fresh.push( { key, position: [px, base, pz], size: [S, Math.ceil( hi - base + ABOVE ), S], res, heights, snowMask: null } );
      }
    }
  if ( fresh.length ) {
    const plain = terrain.chunks.map( ( c ): ChunkInit => ( { key: c.key, position: c.position, size: c.size, res: c.res, heights: c.heights, snowMask: c.snowMask } ) );
    terrain.setChunks( [...plain, ...fresh] );
  }
  return fresh.map( ( f ) => f.key );
}
