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
  if ( s.kind === "curve" || s.kind === "paint" ) return { ...s, start: m( s.start ), end: m( s.end ) };
  if ( s.kind === "circle" ) return { ...s, center: m( s.center ), tiltDirection: axis === "x" ? -s.tiltDirection : 180 - s.tiltDirection };
  // ( its noise mirrored the same way: made again later, it's the mirror image of what was mirrored )
  if ( s.kind === "formation" ) {
    const was = s.noiseMirror ?? { x: null, z: null };
    return { ...s, points: s.points.map( m ), noiseMirror: axis === "x" ? { ...was, x: was.x === null ? sx : null } : { ...was, z: was.z === null ? sz : null } };
  }
  // ( a ski line's left and right swapped with it: its cross-section turned round, its rolls and features' offsets the
  // other way, its stripes along it on the other side )
  if ( s.kind === "skiline" ) {
    const turned = s.cross.map( ( c ) => ( { ...c, t: 1 - c.t, ti: c.to === undefined ? undefined : -c.to, to: c.ti === undefined ? undefined : -c.ti } ) ).reverse();
    return {
      ...s,
      cross:    turned,
      nodes:    s.nodes.map( ( n ) => { const [x, z] = m( [n.p[0], n.p[2]] ); return { ...n, p: [x, n.p[1], z] as [number, number, number], roll: -n.roll }; } ),
      features: s.features.map( ( f ) => ( { ...f, lateral: -f.lateral, stripes: f.stripes.map( ( st ) => ( st.across ? st : { ...st, position: 1 - st.position } ) ) } ) ),
    };
  }
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
