// Ground paint: the snow masks the game reads, per chunk, painted in the editor.
//
//  snow mask ( masks/<chunk>.png, RGBA ):  R = snow ( 255 ) vs rock ( 0 ) · G = marking colour ( hue ) · B = marking coverage
//                                        · A = powder depth ( shown with the "4-channel" flag, set once G/B/A are painted )
//  flow mask ( masks/<chunk>_2.png ):      R = the corduroy direction, 0..1 = 0..360° from +Z towards +X
//
// ( From the Map-Tools terrain shader, BasicSnowTerrain.shader. ) PNG row 0 is the chunk's −Z edge; pixel ( i, j ) sits
// at ( ( i + 0.5 ) / m, ( j + 0.5 ) / m ) of the chunk.
//
// Grip: the game feels powder from the alpha alone ( TerrainPainter's contact, for maps of version 0.4 on ), but only
// draws it, and markings, on a chunk with the flag. Alpha on a chunk without it is powder the rider feels and nobody
// sees, so a chunk holds either markings and powder or grip.

import { ipc, joinPath } from "../../core/ipc";
import { encodePng } from "../../core/png";
import { useEditor } from "../../map/store";
import { terrain } from "../../terrain/terrain";
import { spreadHue } from "./channels";
import { layers } from "./layers";

export { DEFAULT_PAINT, MARKING_COLOURS, type PaintSettings, type PaintTool } from "../settings";
export { type PaintLayer, onPaintChange, defaultMaskSize, layerOf, upsampleMask, ensureLayer, resetPaint, gripBlocked } from "./layers";
export { PaintStroke } from "./stroke";
export { spreadHue, encodeAngle, decodeAngle } from "./channels";
export { layerEdit, rockOnSteep, allSnow, clearMarkings, clearPowder, clearGrip } from "./fills";

/**
 * Writes every changed layer's PNGs and points the chunks at them ( part of saving the project ).
**/
export async function savePaint( dir: string ) {
  const st   = useEditor.getState();
  let extras = st.chunkExtras;
  for ( const L of layers.values() ) {
    if ( !L.dirty ) continue;
    const ci = terrain.indexOf( L.key );
    const c  = terrain.chunks[ci];
    if ( !c ) continue;
    const rel = `masks/${L.key}.png`;
    // markings painted before their edges were handled ( or brought in from elsewhere ) get soft edges too
    if ( L.four ) spreadHue( L.rgba, L.m );
    await ipc.writeBinary( joinPath( dir, rel ), await encodePng( L.m, L.m, L.rgba ) );
    c.snowMask                 = rel;
    let flowRel: string | null = ( extras[L.key] as { snowMask2?: string | null } | undefined )?.snowMask2 ?? null;
    if ( L.flow ) {
      flowRel  = `masks/${L.key}_2.png`;
      const px = new Uint8Array( L.m * L.m * 4 );
      for ( let k = 0; k < L.m * L.m; k++ ) {
        px[k * 4]     = L.flow[k];
        px[k * 4 + 3] = 255;
      }
      await ipc.writeBinary( joinPath( dir, flowRel ), await encodePng( L.m, L.m, px ) );
    }
    extras  = { ...extras, [L.key]: { ...extras[L.key], snowMask4Channel: L.four, snowMask2: flowRel } };
    L.dirty = false;
  }
  if ( extras !== st.chunkExtras ) useEditor.setState( { chunkExtras: extras } );
}
