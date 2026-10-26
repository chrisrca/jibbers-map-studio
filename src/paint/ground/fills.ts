// Whole-map fills: all snow, rock on the steep, markings, powder or grip cleared ( each one undo step ).

import { history } from "../../map/history";
import { type TerrainChunk, terrain } from "../../terrain/terrain";
import { type PaintLayer, changed, ensureLayer } from "./layers";

/**
 * Runs `f` on every chunk's layer as one undo step.
**/
async function fill( label: string, f: ( L: PaintLayer, c: TerrainChunk ) => void ) {
  const all    = await Promise.all( terrain.chunks.map( ( c ) => ensureLayer( c ) ) );
  const before = all.map( ( L ) => ( { L, rgba: L.rgba.slice(), flow: L.flow?.slice() ?? null, four: L.four } ) );
  terrain.chunks.forEach( ( c, k ) => f( all[k], c ) );
  const after = all.map( ( L ) => ( { L, rgba: L.rgba.slice(), flow: L.flow?.slice() ?? null, four: L.four } ) );
  all.forEach( ( L ) => changed( L ) );
  const put = ( list: typeof before ) =>
    list.forEach( ( b ) => {
      b.L.rgba.set( b.rgba );
      b.L.flow = b.flow ? b.flow.slice() : null;
      b.L.four = b.four;
      changed( b.L );
    } );
  const bytes = [...before, ...after].reduce( ( n, b ) => n + b.rgba.byteLength + ( b.flow?.byteLength ?? 0 ), 0 );
  history.push( { label, undo: () => put( before ), redo: () => put( after ), bytes } );
}

/**
 * A chunk's layer changed by `f`: how to undo and redo it ( for an edit that does something else too, as one step ).
**/
export async function layerEdit( c: TerrainChunk, f: ( L: PaintLayer ) => void ) {
  const L      = await ensureLayer( c );
  const before = { rgba: L.rgba.slice(), flow: L.flow?.slice() ?? null };
  f( L );
  const after = { rgba: L.rgba.slice(), flow: L.flow?.slice() ?? null };
  changed( L );
  const put = ( s: typeof before ) => {
    L.rgba.set( s.rgba );
    L.flow = s.flow ? s.flow.slice() : null;
    changed( L );
  };
  return { undo: () => put( before ), redo: () => put( after ), bytes: before.rgba.byteLength * 2 + ( before.flow?.byteLength ?? 0 ) * 2 };
}

/**
 * Ground height at a mask pixel, with the gradient over `d` metres.
**/
function slopeAt( c: TerrainChunk, x: number, z: number, d: number ): [number, number] {
  const h = ( ux: number, uz: number ) => {
    const [fx, fz] = c.toSample( Math.min( c.position[0] + c.size[0], Math.max( c.position[0], ux ) ), Math.min( c.position[2] + c.size[2], Math.max( c.position[2], uz ) ) );
    return c.sampleBilinear( fx, fz );
  };
  return [( h( x + d, z ) - h( x - d, z ) ) / ( 2 * d ), ( h( x, z + d ) - h( x, z - d ) ) / ( 2 * d )];
}

/**
 * Rock where the ground is steeper than `minDeg` ( fading in over `softDeg` ), snow elsewhere stays as painted.
**/
export function rockOnSteep( minDeg: number, softDeg = 6 ) {
  return fill( `Rock on slopes over ${minDeg}°`, ( L, c ) => {
    const m = L.m, px = c.size[0] / m, d = Math.max( px, c.spacing );
    for ( let j = 0; j < m; j++ )
      for ( let i = 0; i < m; i++ ) {
        const [gx, gz] = slopeAt( c, c.position[0] + ( i + 0.5 ) * px, c.position[2] + ( j + 0.5 ) * px, d );
        const deg      = ( Math.atan( Math.hypot( gx, gz ) ) * 180 ) / Math.PI;
        const t        = Math.min( 1, Math.max( 0, ( deg - minDeg ) / softDeg ) );
        const o        = ( j * m + i ) * 4;
        L.rgba[o]      = Math.min( L.rgba[o], Math.round( 255 * ( 1 - t * t * ( 3 - 2 * t ) ) ) );
      }
  } );
}

export const allSnow = () => fill( "All snow", ( L ) => { for ( let k = 0; k < L.m * L.m; k++ ) L.rgba[k * 4] = 255; } );

export const clearMarkings = () => fill( "Clear markings", ( L ) => { if ( L.four ) for ( let k = 0; k < L.m * L.m; k++ ) L.rgba[k * 4 + 2] = 0; } );

export const clearPowder = () => fill( "Clear powder", ( L ) => { if ( L.four ) for ( let k = 0; k < L.m * L.m; k++ ) L.rgba[k * 4 + 3] = 0; } );

export const clearGrip = () => fill( "Clear grip", ( L ) => { if ( !L.four ) for ( let k = 0; k < L.m * L.m; k++ ) L.rgba[k * 4 + 3] = 0; } );
