// Whole-terrain operations ( Map-Tools' "Mirror" button and friends ).

import { history } from "../map/history";
import { resetShapes, type Shape } from "./shapes/shapes";
import { useEditor } from "../map/store";
import { Terrain, terrain } from "./terrain";

/**
 * Map bounds in Unity XZ.
**/
function bounds() {
  let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
  for ( const c of terrain.chunks ) {
    minx = Math.min( minx, c.position[0] );
    minz = Math.min( minz, c.position[2] );
    maxx = Math.max( maxx, c.position[0] + c.size[0] );
    maxz = Math.max( maxz, c.position[2] + c.size[2] );
  }
  return { minx, minz, maxx, maxz };
}

function mirrorShape( s: Shape, axis: "x" | "z", sx: number, sz: number ): Shape {
  const m = ( [x, z]: [number, number] ): [number, number] => ( axis === "x" ? [sx - x, z] : [x, sz - z] );
  if ( s.kind === "curve"  ) return { ...s, start:  m( s.start  ), end: m( s.end ) };
  if ( s.kind === "circle" ) return { ...s, center: m( s.center ), tiltDirection: axis === "x" ? -s.tiltDirection : 180 - s.tiltDirection };
  return { ...s, center: m( s.center ), rotation: -s.rotation, mirrorX: axis === "x" ? !s.mirrorX : s.mirrorX, mirrorZ: axis === "z" ? !s.mirrorZ : s.mirrorZ };
}

function mirrorOnce( axis: "x" | "z" ) {
  const { minx, minz, maxx, maxz } = bounds();
  const sx                         = minx + maxx, sz = minz + maxz;
  // read from an untouched copy while writing the mirror image
  const src                        = new Terrain();
  src.setChunks( terrain.chunks.map( ( c ) => ( { key: c.key, position: c.position, size: c.size, res: c.res, heights: c.heights.slice() } ) ) );
  terrain.chunks.forEach( ( c ) => {
    const x0 = c.position[0], z0 = c.position[2], sp = c.spacing, res = c.res, base = c.position[1], top = c.size[1];
    for ( let j = 0; j < res; j++ )
      for ( let i = 0; i < res; i++ ) {
        const x = x0 + i * sp, z = z0 + j * sp;
        const h = axis === "x" ? src.heightAt( sx - x, z ) : src.heightAt( x, sz - z );
        if ( Number.isNaN( h ) ) continue;
        const v                = h - base;
        c.heights[j * res + i] = v < 0 ? 0 : v > top ? top : v;
      }
  } );
  terrain.markAllDirty();
  // shapes follow the terrain; their recorded changes no longer line up with the samples, so they count as baked
  resetShapes();
  useEditor.setState( ( st ) => ( { shapes: st.shapes.map( ( s ) => mirrorShape( s, axis, sx, sz ) ), dirty: true } ) );
}

/**
 * Mirrors the whole terrain left↔right ( "x" ) or front↔back ( "z" ); undo mirrors it back.
**/
export function mirrorTerrain( axis: "x" | "z" ) {
  mirrorOnce( axis );
  history.push( { label: axis === "x" ? "Mirror terrain left/right" : "Mirror terrain front/back", undo: () => mirrorOnce( axis ), redo: () => mirrorOnce( axis ) } );
}
